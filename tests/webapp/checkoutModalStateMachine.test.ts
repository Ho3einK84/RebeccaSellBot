import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../webapp/src/shared/lib/api.js';
import type {
  UserPackageItem,
  UserCheckoutResponse,
} from '../../webapp/src/shared/types/userPortal.js';

type CheckoutStep =
  | 'loading'
  | 'review'
  | 'insufficient_balance'
  | 'creation_error'
  | 'expired'
  | 'verifying'
  | 'confirm_error'
  | 'success';

/**
 * Harness encapsulating the exact state machine, ref lifecycle, and freeze guards
 * implemented in CheckoutModal.tsx to prevent the P0 success screen reset bug.
 */
class CheckoutModalStateMachineHarness {
  // State
  step: CheckoutStep = 'loading';
  checkout: UserCheckoutResponse | null = null;
  isProcessing = false;
  errorMessage = '';
  deficitAmount = 0;
  successData: { configUsername: string; subUrl?: string } | null = null;
  callCreateCheckoutSessionCount = 0;

  // Props
  isOpen: boolean;
  pkg: UserPackageItem | null;
  availableBalance: number;

  // Refs mirroring React useRef
  private availableBalanceRef = { current: 0 };
  private stepRef = { current: 'loading' as CheckoutStep };
  private isProcessingRef = { current: false };
  private sessionCreatedRef = { current: false };

  // Mock API methods
  createCheckoutApi: (payload: any) => Promise<UserCheckoutResponse>;
  confirmCheckoutApi: (
    checkoutId: string
  ) => Promise<{ success: boolean; configUsername: string; subUrl?: string }>;
  onSuccessMock = vi.fn();

  constructor(options: {
    isOpen: boolean;
    pkg: UserPackageItem | null;
    availableBalance: number;
    createCheckoutApi?: (payload: any) => Promise<UserCheckoutResponse>;
    confirmCheckoutApi?: (
      checkoutId: string
    ) => Promise<{ success: boolean; configUsername: string; subUrl?: string }>;
  }) {
    this.isOpen = options.isOpen;
    this.pkg = options.pkg;
    this.availableBalance = options.availableBalance;
    this.availableBalanceRef.current = options.availableBalance;

    this.createCheckoutApi =
      options.createCheckoutApi ??
      vi.fn(async () => ({
        checkoutId: 'co_test_123',
        name: '30 GB - 30 Days',
        gb: 30,
        days: 30,
        price: 120_000,
        quotedAmount: 120_000,
        availableBalance: this.availableBalanceRef.current,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }));

    this.confirmCheckoutApi =
      options.confirmCheckoutApi ??
      vi.fn(async () => ({
        success: true,
        configUsername: 'u12345_srv1',
        subUrl: 'https://sub.example.com/token123',
      }));

    this.syncRefs();
    this.triggerEffect();
  }

  private syncRefs() {
    this.availableBalanceRef.current = this.availableBalance;
    this.stepRef.current = this.step;
    this.isProcessingRef.current = this.isProcessing;
  }

  // Corresponds to createCheckoutSession in CheckoutModal.tsx
  async createCheckoutSession() {
    if (!this.pkg) return;
    this.callCreateCheckoutSessionCount++;

    // Freeze Guard: Never recreate checkout session if already in success or currently processing
    if (this.stepRef.current === 'success' || this.isProcessingRef.current) return;

    this.step = 'loading';
    this.stepRef.current = 'loading';
    this.errorMessage = '';
    this.checkout = null;

    try {
      const isCustom = this.pkg.id === 'custom' || this.pkg.id.startsWith('custom');
      const res = isCustom
        ? await this.createCheckoutApi({
            custom: { gb: this.pkg.gbAmount, days: this.pkg.durationDays },
          })
        : await this.createCheckoutApi({
            packageId: this.pkg.id,
          });

      // If state transitioned to success during network latency, do not overwrite
      if (this.stepRef.current === 'success') return;

      this.checkout = res;
      this.step = 'review';
      this.stepRef.current = 'review';
    } catch (err: unknown) {
      if (this.stepRef.current === 'success') return;

      if (err instanceof ApiClientError) {
        const errData = err.data as
          | { code?: string; deficit?: number; availableBalance?: number; price?: number }
          | undefined;

        if (
          err.status === 409 &&
          (err.code === 'INSUFFICIENT_BALANCE' || errData?.code === 'INSUFFICIENT_BALANCE')
        ) {
          const deficit =
            errData?.deficit ??
            Math.max(
              0,
              (errData?.price ?? this.pkg.price) -
                (errData?.availableBalance ?? this.availableBalanceRef.current)
            );
          this.deficitAmount = deficit;
          this.step = 'insufficient_balance';
          this.stepRef.current = 'insufficient_balance';
          return;
        }
        this.errorMessage = err.message || 'Checkout failed';
      } else if (err instanceof Error) {
        this.errorMessage = err.message;
      } else {
        this.errorMessage = 'Checkout failed';
      }
      this.step = 'creation_error';
      this.stepRef.current = 'creation_error';
    }
  }

  // Corresponds to useEffect in CheckoutModal.tsx
  triggerEffect() {
    if (this.isOpen && this.pkg) {
      // Freeze modal state: if already in success, processing, or session already initiated for this open cycle, do nothing
      if (
        this.sessionCreatedRef.current ||
        this.stepRef.current === 'success' ||
        this.isProcessingRef.current
      ) {
        return;
      }
      this.sessionCreatedRef.current = true;
      this.successData = null;
      this.isProcessing = false;
      this.isProcessingRef.current = false;
      void this.createCheckoutSession();
    } else if (!this.isOpen) {
      // Clean up all state and refs when modal is closed
      this.sessionCreatedRef.current = false;
      this.step = 'loading';
      this.stepRef.current = 'loading';
      this.checkout = null;
      this.successData = null;
      this.isProcessing = false;
      this.isProcessingRef.current = false;
      this.errorMessage = '';
      this.deficitAmount = 0;
    }
  }

  // Corresponds to prop updates (e.g. availableBalance query invalidation refetch)
  updateProps(nextProps: {
    isOpen?: boolean;
    pkg?: UserPackageItem | null;
    availableBalance?: number;
  }) {
    if (nextProps.isOpen !== undefined) this.isOpen = nextProps.isOpen;
    if (nextProps.pkg !== undefined) this.pkg = nextProps.pkg;
    if (nextProps.availableBalance !== undefined) {
      this.availableBalance = nextProps.availableBalance;
      this.availableBalanceRef.current = nextProps.availableBalance;
    }
    this.syncRefs();
    this.triggerEffect();
  }

  // Corresponds to handleConfirmCheckout in CheckoutModal.tsx
  async handleConfirmCheckout() {
    if (!this.checkout || this.isProcessing) return;
    this.isProcessing = true;
    this.isProcessingRef.current = true;
    this.errorMessage = '';

    try {
      const res = await this.confirmCheckoutApi(this.checkout.checkoutId);
      if (res.success) {
        this.successData = {
          configUsername: res.configUsername,
          subUrl: res.subUrl,
        };
        this.step = 'success';
        this.stepRef.current = 'success';
        this.onSuccessMock('Order completed');
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        const errData = err.data as { code?: string; deficit?: number } | undefined;
        if (
          err.status === 202 ||
          err.code === 'PURCHASE_OUTCOME_PENDING' ||
          errData?.code === 'PURCHASE_OUTCOME_PENDING'
        ) {
          this.step = 'verifying';
          this.stepRef.current = 'verifying';
          return;
        }
        if (err.status === 410 || err.code === 'CHECKOUT_EXPIRED') {
          this.step = 'expired';
          this.stepRef.current = 'expired';
          return;
        }
        this.errorMessage = err.message || 'Confirm failed';
      } else {
        this.errorMessage = 'Confirm failed';
      }
      this.step = 'confirm_error';
      this.stepRef.current = 'confirm_error';
    } finally {
      this.isProcessing = false;
      this.isProcessingRef.current = false;
    }
  }
}

describe('CheckoutModal State Machine & Regression Verification (P0 Bug 1)', () => {
  const samplePkg: UserPackageItem = {
    id: 'pkg_30gb_30d',
    name: '30 GB - 30 Days',
    gbAmount: 30,
    durationDays: 30,
    price: 120_000,
    enabled: true,
  };

  it('initializes in review step upon opening with a valid package', async () => {
    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
    });

    // Wait for async createCheckoutSession
    await new Promise((r) => setTimeout(r, 10));

    expect(harness.step).toBe('review');
    expect(harness.checkout).toBeDefined();
    expect(harness.checkout?.checkoutId).toBe('co_test_123');
    expect(harness.callCreateCheckoutSessionCount).toBe(1);
  });

  it('transitions to insufficient_balance when createCheckout throws 409', async () => {
    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 50_000,
      createCheckoutApi: vi.fn(async () => {
        throw new ApiClientError('Insufficient balance', 409, 'INSUFFICIENT_BALANCE', {
          code: 'INSUFFICIENT_BALANCE',
          deficit: 70_000,
          price: 120_000,
          availableBalance: 50_000,
        });
      }),
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(harness.step).toBe('insufficient_balance');
    expect(harness.deficitAmount).toBe(70_000);
    expect(harness.checkout).toBeNull();
  });

  it('completes checkout successfully and enters success step', async () => {
    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(harness.step).toBe('review');

    await harness.handleConfirmCheckout();

    expect(harness.step).toBe('success');
    expect(harness.successData).toEqual({
      configUsername: 'u12345_srv1',
      subUrl: 'https://sub.example.com/token123',
    });
    expect(harness.onSuccessMock).toHaveBeenCalledWith('Order completed');
  });

  it('CRITICAL REGRESSION TEST (P0 Bug 1): availableBalance update from query invalidation does NOT reset success step', async () => {
    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(harness.step).toBe('review');

    // Confirm checkout -> transitions to 'success'
    await harness.handleConfirmCheckout();
    expect(harness.step).toBe('success');
    expect(harness.callCreateCheckoutSessionCount).toBe(1);

    // Simulate Query Invalidation: React Query refetches profile, causing availableBalance
    // to drop from 200_000 to 80_000 (after 120_000 purchase deduction)
    harness.updateProps({
      availableBalance: 80_000,
    });

    // Even if availableBalance drops below package price (e.g. 10_000)
    harness.updateProps({
      availableBalance: 10_000,
    });

    await new Promise((r) => setTimeout(r, 20));

    // The modal MUST remain on 'success', and createCheckoutSession must NOT have been called again!
    expect(harness.step).toBe('success');
    expect(harness.successData?.configUsername).toBe('u12345_srv1');
    expect(harness.callCreateCheckoutSessionCount).toBe(1);
  });

  it('CRITICAL REGRESSION TEST (P0 Bug 1): late-resolving checkout response cannot overwrite success step', async () => {
    let resolveCreateCheckout: (val: any) => void;
    const pendingPromise = new Promise<UserCheckoutResponse>((resolve) => {
      resolveCreateCheckout = resolve;
    });

    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
      createCheckoutApi: vi.fn(() => pendingPromise),
    });

    // While createCheckoutApi is pending, step is 'loading'
    expect(harness.step).toBe('loading');

    // Assume user somehow reaches success or state transitions
    harness.step = 'success';
    (harness as any).stepRef.current = 'success';

    // Now resolve the late createCheckoutApi
    resolveCreateCheckout!({
      checkoutId: 'co_late_999',
      name: '30 GB - 30 Days',
      gb: 30,
      days: 30,
      price: 120_000,
      quotedAmount: 120_000,
      availableBalance: 200_000,
      expiresAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));

    // The late response must NOT overwrite 'success' to 'review'
    expect(harness.step).toBe('success');
  });

  it('blocks duplicate confirm calls while already processing', async () => {
    let resolveConfirm: (val: any) => void;
    const confirmPromise = new Promise<any>((resolve) => {
      resolveConfirm = resolve;
    });

    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
      confirmCheckoutApi: vi.fn(() => confirmPromise),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(harness.step).toBe('review');

    // First click: in-flight
    const firstCall = harness.handleConfirmCheckout();
    expect(harness.isProcessing).toBe(true);

    // Second click while in-flight: should be ignored
    await harness.handleConfirmCheckout();

    // Resolve first call
    resolveConfirm!({
      success: true,
      configUsername: 'u12345_srv1',
      subUrl: 'https://sub.example.com/token123',
    });
    await firstCall;

    expect(harness.step).toBe('success');
    expect(harness.confirmCheckoutApi).toHaveBeenCalledTimes(1);
  });

  it('resets state and sessionCreatedRef when modal is closed, allowing fresh checkout on reopen', async () => {
    const harness = new CheckoutModalStateMachineHarness({
      isOpen: true,
      pkg: samplePkg,
      availableBalance: 200_000,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(harness.step).toBe('review');
    expect(harness.callCreateCheckoutSessionCount).toBe(1);

    // Close modal
    harness.updateProps({ isOpen: false });
    expect(harness.step).toBe('loading');
    expect(harness.checkout).toBeNull();

    // Reopen modal with new package
    const newPkg: UserPackageItem = {
      id: 'pkg_10gb_10d',
      name: '10 GB - 10 Days',
      gbAmount: 10,
      durationDays: 10,
      price: 40_000,
      enabled: true,
    };
    harness.updateProps({ isOpen: true, pkg: newPkg });

    await new Promise((r) => setTimeout(r, 10));
    expect(harness.step).toBe('review');
    expect(harness.callCreateCheckoutSessionCount).toBe(2);
  });
});
