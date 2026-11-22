import type { UserCheckoutResponse, UserPackageItem } from '@/shared/types/userPortal.js';

export type CheckoutStep =
  | 'loading'
  | 'review'
  | 'insufficient_balance'
  | 'phone_required'
  | 'creation_error'
  | 'expired'
  | 'verifying'
  | 'confirm_error'
  | 'success';

export interface CheckoutState {
  step: CheckoutStep;
  checkout: UserCheckoutResponse | null;
  isProcessing: boolean;
  errorMessage: string;
  deficitAmount: number;
  remainingSeconds: number;
  successData: {
    configUsername: string;
    subUrl?: string;
    kind?: 'new_config' | 'renew_config';
    startOnFirstUse?: boolean;
    availableBalanceAfter?: number;
  } | null;
  qrSrc: string;
  activePkgKey: string | null;
}

export type CheckoutAction =
  | { type: 'RESET' }
  | { type: 'CREATE_START'; pkgKey: string }
  | { type: 'CREATE_SUCCESS'; checkout: UserCheckoutResponse }
  | { type: 'CREATE_INSUFFICIENT_BALANCE'; deficit: number }
  | { type: 'CREATE_PHONE_REQUIRED' }
  | { type: 'CREATE_ERROR'; message: string }
  | { type: 'TICK_EXPIRY'; nowMs: number }
  | { type: 'CONFIRM_START' }
  | {
      type: 'CONFIRM_SUCCESS';
      data: {
        configUsername: string;
        subUrl?: string;
        kind?: 'new_config' | 'renew_config';
        startOnFirstUse?: boolean;
        availableBalanceAfter?: number;
      };
    }
  | { type: 'SET_QR'; qrSrc: string }
  | { type: 'CONFIRM_VERIFYING' }
  | { type: 'CONFIRM_EXPIRED' }
  | { type: 'CONFIRM_INSUFFICIENT_BALANCE'; deficit: number }
  | { type: 'CONFIRM_PHONE_REQUIRED' }
  | { type: 'CONFIRM_ERROR'; message: string };

export const INITIAL_CHECKOUT_STATE: CheckoutState = {
  step: 'loading',
  checkout: null,
  isProcessing: false,
  errorMessage: '',
  deficitAmount: 0,
  remainingSeconds: 0,
  successData: null,
  qrSrc: '',
  activePkgKey: null,
};

export function buildPackageKey(pkg: UserPackageItem | null): string | null {
  if (!pkg) return null;
  return `${pkg.id}:${pkg.gbAmount}:${pkg.durationDays}:${pkg.price}`;
}

export function computeRemainingSeconds(
  expiresAt: string,
  nowMs = Date.now()
): { valid: boolean; remainingSeconds: number } {
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) {
    return { valid: false, remainingSeconds: 0 };
  }
  return {
    valid: true,
    remainingSeconds: Math.max(0, Math.floor((expiresMs - nowMs) / 1000)),
  };
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Retrying from either `creation_error` or `confirm_error` must initiate a fresh
 * checkout session because a failed confirmation consumes the previous checkout ID.
 */
export function resolveRetryAction(): 'create_new_session' {
  return 'create_new_session';
}

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case 'RESET':
      return { ...INITIAL_CHECKOUT_STATE };

    case 'CREATE_START':
      if (state.step === 'success' || state.isProcessing) {
        return state;
      }
      return {
        ...state,
        step: 'loading',
        errorMessage: '',
        checkout: null,
        successData: null,
        qrSrc: '',
        activePkgKey: action.pkgKey,
      };

    case 'CREATE_SUCCESS':
      if (state.step === 'success') {
        return state;
      }
      return {
        ...state,
        step: 'review',
        checkout: action.checkout,
      };

    case 'CREATE_INSUFFICIENT_BALANCE':
      if (state.step === 'success') {
        return state;
      }
      return {
        ...state,
        step: 'insufficient_balance',
        deficitAmount: action.deficit,
      };

    case 'CREATE_PHONE_REQUIRED':
      if (state.step === 'success') {
        return state;
      }
      return {
        ...state,
        step: 'phone_required',
        isProcessing: false,
      };

    case 'CREATE_ERROR':
      if (state.step === 'success') {
        return state;
      }
      return {
        ...state,
        step: 'creation_error',
        errorMessage: action.message,
      };

    case 'TICK_EXPIRY': {
      if (state.step !== 'review' || !state.checkout?.expiresAt) {
        return state;
      }
      const { valid, remainingSeconds } = computeRemainingSeconds(
        state.checkout.expiresAt,
        action.nowMs
      );
      if (!valid) {
        return state.remainingSeconds === 0 ? state : { ...state, remainingSeconds: 0 };
      }
      if (remainingSeconds <= 0) {
        return {
          ...state,
          remainingSeconds: 0,
          step: 'expired',
        };
      }
      if (remainingSeconds === state.remainingSeconds) {
        return state;
      }
      return {
        ...state,
        remainingSeconds,
      };
    }

    case 'CONFIRM_START':
      if (!state.checkout || state.isProcessing || state.step === 'success') {
        return state;
      }
      return {
        ...state,
        isProcessing: true,
        errorMessage: '',
      };

    case 'CONFIRM_SUCCESS':
      return {
        ...state,
        step: 'success',
        isProcessing: false,
        successData: action.data,
      };

    case 'SET_QR':
      return {
        ...state,
        qrSrc: action.qrSrc,
      };

    case 'CONFIRM_VERIFYING':
      return {
        ...state,
        step: 'verifying',
        isProcessing: false,
      };

    case 'CONFIRM_EXPIRED':
      return {
        ...state,
        step: 'expired',
        isProcessing: false,
      };

    case 'CONFIRM_INSUFFICIENT_BALANCE':
      return {
        ...state,
        step: 'insufficient_balance',
        isProcessing: false,
        deficitAmount: action.deficit,
      };

    case 'CONFIRM_PHONE_REQUIRED':
      return {
        ...state,
        step: 'phone_required',
        isProcessing: false,
      };

    case 'CONFIRM_ERROR':
      return {
        ...state,
        step: 'confirm_error',
        isProcessing: false,
        errorMessage: action.message,
      };

    default:
      return state;
  }
}
