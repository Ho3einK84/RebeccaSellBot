import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiClientError,
  getAuthToken,
  setAuthToken,
} from '../../webapp/src/shared/lib/api.js';
import {
  minimizeOrCloseWebApp,
  openTelegramLinkAndMinimize,
} from '../../webapp/src/shared/lib/telegramNavigation.js';
import { dequeueToast, enqueueToast, Toast } from '../../webapp/src/shared/components/ui/Toast.js';
import { appendDownloadQuery } from '../../webapp/src/features/admin/receipts/components/ReceiptPhotoModal.js';
import {
  buildPackageKey,
  checkoutReducer,
  computeRemainingSeconds,
  formatCountdown,
  INITIAL_CHECKOUT_STATE,
  resolveRetryAction,
} from '../../webapp/src/features/user-portal/components/checkoutState.js';
import type {
  UserCheckoutResponse,
  UserPackageItem,
} from '../../webapp/src/shared/types/userPortal.js';

describe('Webapp API Client, Token Refresh & Transport Helpers', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    setAuthToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    setAuthToken(null);
  });

  it('manages in-memory auth token with setAuthToken and getAuthToken', () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken('test-bearer-token-123');
    expect(getAuthToken()).toBe('test-bearer-token-123');
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it('attaches Authorization: Bearer <token> and credentials: same-origin by default', async () => {
    setAuthToken('jwt-session-xyz');

    const mockFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await api.getUserProfile();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-session-xyz');
    expect(init?.credentials).toBe('same-origin');
  });

  it('preserves explicit Authorization header without overwriting it with default token', async () => {
    setAuthToken('default-token');

    const mockFetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const blob = await api.fetchBlob('/api/admin/receipts/r1/photo', {
      headers: { Authorization: 'Bearer explicit-override-token' },
    });
    expect(blob.size).toBe(3);

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer explicit-override-token');
  });

  it('stores token automatically upon successful validateTelegramAuth response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              token: 'returned-backend-jwt-token',
              role: 'user',
              user: { id: 12345, first_name: 'Test' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    );

    const res = await api.validateTelegramAuth('dummy-init-data');
    expect(res.token).toBe('returned-backend-jwt-token');
    expect(getAuthToken()).toBe('returned-backend-jwt-token');
  });

  it('deduplicates concurrent 401 token refreshes with a single-flight lock', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      Telegram: { WebApp: { initData: 'fresh_signed_init_data' } },
    };

    let authRefreshCalls = 0;
    let statsAttempts = 0;
    let panelsAttempts = 0;

    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/telegram-validate')) {
        authRefreshCalls += 1;
        return new Response(
          JSON.stringify({
            token: 'refreshed-jwt-token',
            role: 'admin',
            user: { id: 12345, first_name: 'Admin' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('/api/admin/stats')) {
        statsAttempts += 1;
        if (statsAttempts === 1) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer refreshed-jwt-token');
        return new Response(JSON.stringify({ stats: { totalUsers: 1 } }), { status: 200 });
      }

      if (url.includes('/api/admin/panels')) {
        panelsAttempts += 1;
        if (panelsAttempts === 1) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer refreshed-jwt-token');
        return new Response(JSON.stringify({ panels: [] }), { status: 200 });
      }

      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', mockFetch);

    const [statsRes, panelsRes] = await Promise.all([api.getAdminStats(), api.getAdminPanels()]);
    expect(statsRes.stats.totalUsers).toBe(1);
    expect(panelsRes.panels).toEqual([]);
    expect(authRefreshCalls).toBe(1);
    expect(getAuthToken()).toBe('refreshed-jwt-token');
  });

  it('handles 401 cleanly in non-browser SSR environments when window is undefined', async () => {
    (globalThis as unknown as { window: unknown }).window = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTH' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    await expect(api.getAdminStats()).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 401,
      code: 'UNAUTH',
      message: 'Unauthorized',
    });
  });

  it('URI-encodes receiptId, configUsername, and panelId route segments and surfaces fetchBlob errors', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes('fail-blob')) {
          return new Response(JSON.stringify({ error: 'Photo missing', code: 'NOT_FOUND' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    await api.performReceiptAction('rec 1/a?b', { action: 'approve' });
    await api.deleteAdminPanel('panel 1/a');
    await api.toggleUserConfig(55555, 'user#1/cfg');

    expect(requestedUrls[0]).toBe('/api/admin/receipts/rec%201%2Fa%3Fb/action');
    expect(requestedUrls[1]).toBe('/api/admin/panels/panel%201%2Fa');
    expect(requestedUrls[2]).toBe('/api/admin/users/55555/configs/user%231%2Fcfg/toggle');

    await expect(api.fetchBlob('/api/fail-blob')).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.fetchBlob('/api/fail-blob')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Photo missing',
    });
  });

  it('appends download=1 with ? or & cleanly in appendDownloadQuery', () => {
    expect(appendDownloadQuery('/api/admin/receipts/r1/photo')).toBe(
      '/api/admin/receipts/r1/photo?download=1'
    );
    expect(appendDownloadQuery('/api/admin/receipts/r1/photo?token=abc')).toBe(
      '/api/admin/receipts/r1/photo?token=abc&download=1'
    );
  });
});

describe('telegramNavigation', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { window: unknown }).window = {
      open: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('calls openTelegramLink and minimizes if minimize is available', () => {
    const openTelegramLinkMock = vi.fn();
    const minimizeMock = vi.fn();
    const closeMock = vi.fn();

    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        openTelegramLink: openTelegramLinkMock,
        minimize: minimizeMock,
        close: closeMock,
      },
    };

    openTelegramLinkAndMinimize('https://t.me/test_bot?start=renew_123', 100);
    expect(openTelegramLinkMock).toHaveBeenCalledWith('https://t.me/test_bot?start=renew_123');
    expect(minimizeMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(minimizeMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('falls back to close if minimize is not a function and window.open when openTelegramLink absent', () => {
    const openTelegramLinkMock = vi.fn();
    const closeMock = vi.fn();

    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        openTelegramLink: openTelegramLinkMock,
        close: closeMock,
      },
    };

    openTelegramLinkAndMinimize('https://t.me/test_bot?start=transfer_456', 150);
    vi.advanceTimersByTime(150);
    expect(closeMock).toHaveBeenCalledTimes(1);

    const openMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = {
      open: openMock,
      close: vi.fn(),
    };
    openTelegramLinkAndMinimize('https://t.me/test_bot?start=delete_789');
    expect(openMock).toHaveBeenCalledWith(
      'https://t.me/test_bot?start=delete_789',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('minimizeOrCloseWebApp handles minimize, close, and window.close fallbacks', () => {
    const minimizeMock = vi.fn();
    const closeMock = vi.fn();
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: { minimize: minimizeMock, close: closeMock },
    };
    minimizeOrCloseWebApp();
    expect(minimizeMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();

    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: { close: closeMock },
    };
    minimizeOrCloseWebApp();
    expect(closeMock).toHaveBeenCalledTimes(1);

    const windowCloseMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = {
      open: vi.fn(),
      close: windowCloseMock,
    };
    minimizeOrCloseWebApp();
    expect(windowCloseMock).toHaveBeenCalledTimes(1);
  });
});

describe('Toast Queue Helpers & Component SSR', () => {
  it('deduplicates identical message+type in enqueueToast and supports dequeueToast', () => {
    const first = enqueueToast([], 'Saved successfully', 'success', 't1');
    expect(first.added).toBe(true);
    expect(first.id).toBe('t1');
    expect(first.toasts).toEqual([{ id: 't1', message: 'Saved successfully', type: 'success' }]);

    const dup = enqueueToast(first.toasts, 'Saved successfully', 'success', 't2');
    expect(dup.added).toBe(false);
    expect(dup.id).toBe('t1');
    expect(dup.toasts).toHaveLength(1);

    const diffType = enqueueToast(first.toasts, 'Saved successfully', 'error', 't3');
    expect(diffType.added).toBe(true);
    expect(diffType.toasts).toHaveLength(2);

    const afterRemove = dequeueToast(diffType.toasts, 't1');
    expect(afterRemove).toEqual([{ id: 't3', message: 'Saved successfully', type: 'error' }]);
  });

  it('renders Toast variants and optional dismiss button cleanly in SSR markup', () => {
    const successHtml = renderToStaticMarkup(
      React.createElement(Toast, { message: 'Action completed', type: 'success' })
    );
    expect(successHtml).toContain('role="status"');
    expect(successHtml).toContain('Action completed');
    expect(successHtml).toContain('border-s-ok');
    expect(successHtml).toContain('bg-ok-soft');
    expect(successHtml).not.toContain('aria-label="Dismiss"');

    const errorHtml = renderToStaticMarkup(
      React.createElement(Toast, {
        message: 'Operation failed',
        type: 'error',
        onDismiss: () => undefined,
      })
    );
    expect(errorHtml).toContain('Operation failed');
    expect(errorHtml).toContain('border-s-danger');
    expect(errorHtml).toContain('bg-danger-soft');
    expect(errorHtml).toContain('aria-label="Dismiss"');
  });
});

describe('Checkout State Machine (checkoutState.ts)', () => {
  const pkg30: UserPackageItem = {
    id: 'pkg_30gb_30d',
    name: '30 GB - 30 Days',
    gbAmount: 30,
    durationDays: 30,
    price: 120_000,
    enabled: true,
  };

  const pkg10: UserPackageItem = {
    id: 'pkg_10gb_10d',
    name: '10 GB - 10 Days',
    gbAmount: 10,
    durationDays: 10,
    price: 40_000,
    enabled: true,
  };

  const sampleCheckout: UserCheckoutResponse = {
    checkoutId: 'co_test_123',
    name: '30 GB - 30 Days',
    gb: 30,
    days: 30,
    price: 120_000,
    quotedAmount: 120_000,
    availableBalance: 200_000,
    expiresAt: '2026-06-01T12:15:00.000Z',
  };

  it('builds deterministic package keys and transitions through loading -> review -> success', () => {
    expect(buildPackageKey(null)).toBeNull();
    const key30 = buildPackageKey(pkg30)!;
    expect(key30).toBe('pkg_30gb_30d:30:30:120000');
    expect(buildPackageKey(pkg10)).not.toBe(key30);

    let state = checkoutReducer(INITIAL_CHECKOUT_STATE, { type: 'CREATE_START', pkgKey: key30 });
    expect(state.step).toBe('loading');
    expect(state.activePkgKey).toBe(key30);

    state = checkoutReducer(state, { type: 'CREATE_SUCCESS', checkout: sampleCheckout });
    expect(state.step).toBe('review');
    expect(state.checkout).toEqual(sampleCheckout);

    state = checkoutReducer(state, { type: 'CONFIRM_START' });
    expect(state.isProcessing).toBe(true);

    // Duplicate confirm click is ignored by reducer/guard
    const duplicateConfirm = checkoutReducer(state, { type: 'CONFIRM_START' });
    expect(duplicateConfirm).toBe(state);

    state = checkoutReducer(state, {
      type: 'CONFIRM_SUCCESS',
      data: { configUsername: 'u12345_srv1', subUrl: 'https://sub.example.com/token123' },
    });
    expect(state.step).toBe('success');
    expect(state.isProcessing).toBe(false);
    expect(state.successData?.configUsername).toBe('u12345_srv1');
  });

  it('freezes success and processing states against balance-refetch restarts or late session responses (P0 Bug 1)', () => {
    const key30 = buildPackageKey(pkg30)!;
    const key10 = buildPackageKey(pkg10)!;

    let state = checkoutReducer(INITIAL_CHECKOUT_STATE, { type: 'CREATE_START', pkgKey: key30 });
    state = checkoutReducer(state, { type: 'CREATE_SUCCESS', checkout: sampleCheckout });
    state = checkoutReducer(state, { type: 'CONFIRM_START' });

    // While processing, CREATE_START is ignored
    expect(checkoutReducer(state, { type: 'CREATE_START', pkgKey: key10 })).toBe(state);

    state = checkoutReducer(state, {
      type: 'CONFIRM_SUCCESS',
      data: { configUsername: 'u12345_srv1' },
    });

    // After success, CREATE_START, CREATE_SUCCESS, CREATE_ERROR, CREATE_INSUFFICIENT_BALANCE are all ignored
    expect(checkoutReducer(state, { type: 'CREATE_START', pkgKey: key10 })).toBe(state);
    expect(checkoutReducer(state, { type: 'CREATE_SUCCESS', checkout: sampleCheckout })).toBe(
      state
    );
    expect(checkoutReducer(state, { type: 'CREATE_ERROR', message: 'Late error' })).toBe(state);
    expect(checkoutReducer(state, { type: 'CREATE_INSUFFICIENT_BALANCE', deficit: 50_000 })).toBe(
      state
    );

    // Closing modal dispatches RESET, allowing a new cycle
    const reset = checkoutReducer(state, { type: 'RESET' });
    expect(reset).toEqual(INITIAL_CHECKOUT_STATE);
  });

  it('handles insufficient balance, confirm outcomes, and forces new session on confirm_error retry', () => {
    expect(resolveRetryAction()).toBe('create_new_session');

    let state = checkoutReducer(INITIAL_CHECKOUT_STATE, {
      type: 'CREATE_INSUFFICIENT_BALANCE',
      deficit: 70_000,
    });
    expect(state.step).toBe('insufficient_balance');
    expect(state.deficitAmount).toBe(70_000);

    state = checkoutReducer(INITIAL_CHECKOUT_STATE, {
      type: 'CONFIRM_ERROR',
      message: 'Backend error',
    });
    expect(state.step).toBe('confirm_error');
    expect(state.isProcessing).toBe(false);
    expect(state.errorMessage).toBe('Backend error');

    // Retrying creates a fresh session instead of re-submitting stale checkout ID
    const retried = checkoutReducer(state, {
      type: 'CREATE_START',
      pkgKey: buildPackageKey(pkg30)!,
    });
    expect(retried.step).toBe('loading');
    expect(retried.errorMessage).toBe('');

    state = checkoutReducer(state, { type: 'CONFIRM_VERIFYING' });
    expect(state.step).toBe('verifying');

    state = checkoutReducer(state, { type: 'CONFIRM_EXPIRED' });
    expect(state.step).toBe('expired');

    state = checkoutReducer(state, { type: 'CONFIRM_INSUFFICIENT_BALANCE', deficit: 15_000 });
    expect(state.step).toBe('insufficient_balance');
    expect(state.deficitAmount).toBe(15_000);

    state = checkoutReducer(state, { type: 'SET_QR', qrSrc: 'data:image/png;base64,abc' });
    expect(state.qrSrc).toBe('data:image/png;base64,abc');

    state = checkoutReducer(INITIAL_CHECKOUT_STATE, { type: 'CREATE_PHONE_REQUIRED' });
    expect(state.step).toBe('phone_required');

    state = checkoutReducer(state, { type: 'CONFIRM_PHONE_REQUIRED' });
    expect(state.step).toBe('phone_required');

    // Phone required never overrides an already-succeeded checkout
    const succeeded = checkoutReducer(INITIAL_CHECKOUT_STATE, {
      type: 'CONFIRM_SUCCESS',
      data: { configUsername: 'u1_done' },
    });
    expect(checkoutReducer(succeeded, { type: 'CREATE_PHONE_REQUIRED' })).toBe(succeeded);
  });

  it('computes expiry countdown safely without NaN and transitions to expired when deadline elapses', () => {
    const baseMs = Date.parse('2026-06-01T12:00:00.000Z');
    const expiresAt = '2026-06-01T12:02:05.000Z';

    expect(computeRemainingSeconds(expiresAt, baseMs)).toEqual({
      valid: true,
      remainingSeconds: 125,
    });
    expect(formatCountdown(125)).toBe('2:05');

    // Malformed expiresAt never yields NaN or bogus expiration
    expect(computeRemainingSeconds('not-a-valid-date', baseMs)).toEqual({
      valid: false,
      remainingSeconds: 0,
    });
    expect(formatCountdown(Number.NaN)).toBe('0:00');
    expect(formatCountdown(-10)).toBe('0:00');

    let state = checkoutReducer(INITIAL_CHECKOUT_STATE, {
      type: 'CREATE_SUCCESS',
      checkout: { ...sampleCheckout, expiresAt },
    });
    state = checkoutReducer(state, { type: 'TICK_EXPIRY', nowMs: baseMs });
    expect(state.step).toBe('review');
    expect(state.remainingSeconds).toBe(125);

    state = checkoutReducer(state, { type: 'TICK_EXPIRY', nowMs: baseMs + 126_000 });
    expect(state.step).toBe('expired');
    expect(state.remainingSeconds).toBe(0);

    // Invalid date keeps review step at 0 seconds rather than spuriously jumping to expired
    const invalidState = checkoutReducer(INITIAL_CHECKOUT_STATE, {
      type: 'CREATE_SUCCESS',
      checkout: { ...sampleCheckout, expiresAt: 'invalid-date' },
    });
    const tickedInvalid = checkoutReducer(invalidState, { type: 'TICK_EXPIRY', nowMs: baseMs });
    expect(tickedInvalid.step).toBe('review');
    expect(tickedInvalid.remainingSeconds).toBe(0);
  });
});
