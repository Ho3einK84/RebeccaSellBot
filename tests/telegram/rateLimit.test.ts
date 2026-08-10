import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRACKED_USERS,
  getTrackedRateLimitUserCount,
  rateLimitMiddleware,
  resetRateLimits,
} from '../../src/telegram/middleware/rateLimit.js';
import type { MenuContext } from '../../src/telegram/types.js';

function messageContext(telegramId: number): MenuContext {
  return {
    from: { id: telegramId, is_bot: false, first_name: 'Test' },
    message: { text: 'hello' },
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
  vi.useRealTimers();
});

describe('rateLimitMiddleware', () => {
  it('keeps every callback responsive while lightly limiting rapid plain text', async () => {
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
    const ctx = messageContext(42);
    ctx.message = { text: '/admin' } as MenuContext['message'];
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

  it('purges entries as soon as their cooldown window has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const middleware = rateLimitMiddleware({ messageCooldownMs: 500 });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(messageContext(1), next);
    expect(getTrackedRateLimitUserCount()).toBe(1);

    vi.advanceTimersByTime(500);
    await middleware(messageContext(2), next);

    expect(getTrackedRateLimitUserCount()).toBe(1);
    expect(next).toHaveBeenCalledTimes(2);
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
