import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRACKED_USERS,
  getTrackedRateLimitUserCount,
  rateLimitMiddleware,
  resetRateLimits,
} from '../../src/telegram/middleware/rateLimit.js';
import {
  acquireUserActionCooldown,
  resetActionCooldowns,
} from '../../src/telegram/middleware/actionCooldown.js';
import type { MenuContext } from '../../src/telegram/types.js';

function messageContext(telegramId: number, text = 'hello'): MenuContext {
  return {
    from: { id: telegramId, is_bot: false, first_name: 'Test' },
    message: { text },
  } as unknown as MenuContext;
}

function callbackContext(telegramId: number): MenuContext {
  return {
    from: { id: telegramId, is_bot: false, first_name: 'Test' },
    callbackQuery: { id: 'callback', data: 'admin-menu:stats' },
  } as unknown as MenuContext;
}

afterEach(() => {
  resetRateLimits();
  resetActionCooldowns();
  vi.useRealTimers();
});

describe('rateLimitMiddleware', () => {
  it('keeps callbacks responsive while lightly limiting rapid plain text', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const middleware = rateLimitMiddleware({ messageCooldownMs: 500 });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(callbackContext(42), next);
    await middleware(callbackContext(42), next);
    expect(next).toHaveBeenCalledTimes(2);

    await middleware(messageContext(42), next);
    await middleware(messageContext(42), next);
    expect(next).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(500);
    await middleware(messageContext(42), next);
    expect(next).toHaveBeenCalledTimes(4);
  });

  it('does not delay commands', async () => {
    const middleware = rateLimitMiddleware();
    const ctx = messageContext(42, '/admin');
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('never tracks more users than the fixed process-local cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const middleware = rateLimitMiddleware({ messageCooldownMs: 60_000 });
    const next = vi.fn().mockResolvedValue(undefined);

    for (let telegramId = 1; telegramId <= MAX_TRACKED_USERS + 1; telegramId += 1) {
      await middleware(messageContext(telegramId), next);
    }

    expect(getTrackedRateLimitUserCount()).toBe(MAX_TRACKED_USERS);

    await middleware(messageContext(1), next);
    expect(next).toHaveBeenCalledTimes(MAX_TRACKED_USERS + 2);
  });

  it('purges entries as soon as their cooldown window has elapsed without stopping on active ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const middleware = rateLimitMiddleware({ messageCooldownMs: 1000 });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(messageContext(1), next);
    expect(getTrackedRateLimitUserCount()).toBe(1);

    vi.advanceTimersByTime(600);
    await middleware(messageContext(2), next);
    expect(getTrackedRateLimitUserCount()).toBe(2);

    // User 1 blocked at t=600 (expiresAt stays t=1000)
    await middleware(messageContext(1), next);
    expect(next).toHaveBeenCalledTimes(2);

    // Advance to t=1100: User 1 expired (t=1000), User 2 active until 1600
    vi.advanceTimersByTime(500);
    await middleware(messageContext(3), next);

    next.mockClear();
    await middleware(messageContext(1), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves timestamp order when a blocked user is touched', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const middleware = rateLimitMiddleware({ messageCooldownMs: 500 });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(messageContext(1), next);
    vi.setSystemTime(1_100);
    await middleware(messageContext(2), next);
    vi.setSystemTime(1_200);
    await middleware(messageContext(1), next);
    vi.setSystemTime(1_500);
    await middleware(messageContext(3), next);

    expect(getTrackedRateLimitUserCount()).toBe(2);
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe('acquireUserActionCooldown', () => {
  it('blocks repeated action within window and isolates users and action names', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(true);
    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(false);
    expect(acquireUserActionCooldown(101, 'renewal', 5_000)).toBe(true);
    expect(acquireUserActionCooldown(100, 'short_action', 1_000)).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(acquireUserActionCooldown(100, 'short_action', 1_000)).toBe(true);
    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(false);

    vi.advanceTimersByTime(3_000);
    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(true);
  });
});
