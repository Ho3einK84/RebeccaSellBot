import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rateLimitMiddleware,
  resetRateLimits,
  getTrackedRateLimitUserCount,
} from '../../src/telegram/middleware/rateLimit.js';
import {
  acquireUserActionCooldown,
  resetActionCooldowns,
} from '../../src/telegram/middleware/actionCooldown.js';
import type { MenuContext } from '../../src/telegram/types.js';

describe('P2 — Rate limit and action cooldown cleanup correctness', () => {
  beforeEach(() => {
    resetRateLimits();
    resetActionCooldowns();
    vi.useRealTimers();
  });

  describe('rateLimitMiddleware', () => {
    it('purges expired entries across the Map without stopping on non-expired elements', async () => {
      vi.useFakeTimers();
      const middleware = rateLimitMiddleware({ messageCooldownMs: 1000 });
      const next = vi.fn();

      const makeCtx = (telegramId: number): MenuContext =>
        ({
          from: { id: telegramId },
          message: { text: 'hello' },
        }) as unknown as MenuContext;

      // User 1 sends message at t=0 (expires at t=1000)
      await middleware(makeCtx(1), next);
      expect(getTrackedRateLimitUserCount()).toBe(1);

      // Advance 600ms (t=600)
      vi.advanceTimersByTime(600);

      // User 2 sends message at t=600 (expires at t=1600)
      await middleware(makeCtx(2), next);
      expect(getTrackedRateLimitUserCount()).toBe(2);

      // User 1 sends message at t=600 (blocked, updates User 1 expiresAt to t=1600)
      await middleware(makeCtx(1), next);
      // Wait: in our implementation, if blocked, it does not re-insert or update expiresAt

      // Advance to t=1100 (User 1's initial cooldown at t=0 has expired, User 2's cooldown is still active)
      vi.advanceTimersByTime(500);

      // User 3 sends message at t=1100 -> triggers purgeElapsedCooldowns(1100)
      await middleware(makeCtx(3), next);

      // User 1 should have been purged because t=1100 > t=1000. User 2 is active until 1600.
      // User 1 can now send a message freely
      next.mockClear();
      await middleware(makeCtx(1), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('acquireUserActionCooldown', () => {
    it('evaluates each entry against its own explicit expiration time', () => {
      vi.useFakeTimers();

      // Action A with long cooldown (5000ms)
      expect(acquireUserActionCooldown(101, 'action_a', 5000)).toBe(true);
      expect(acquireUserActionCooldown(101, 'action_a', 5000)).toBe(false);

      // Action B with short cooldown (1000ms)
      expect(acquireUserActionCooldown(101, 'action_b', 1000)).toBe(true);
      expect(acquireUserActionCooldown(101, 'action_b', 1000)).toBe(false);

      // Advance 2000ms: action_b has expired, action_a is still on cooldown
      vi.advanceTimersByTime(2000);

      expect(acquireUserActionCooldown(101, 'action_b', 1000)).toBe(true);
      expect(acquireUserActionCooldown(101, 'action_a', 5000)).toBe(false);

      // Advance 4000ms: action_a has expired
      vi.advanceTimersByTime(4000);
      expect(acquireUserActionCooldown(101, 'action_a', 5000)).toBe(true);
    });
  });
});
