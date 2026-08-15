import type { Middleware } from 'grammy';
import type { MenuContext } from '../types.js';

/**
 * A 10k cap comfortably exceeds the bot's concurrently active plain-text users
 * while placing a small, deterministic ceiling on process memory.
 */
export const MAX_TRACKED_USERS = 10_000;

const userCooldowns = new Map<number, number>();

function purgeElapsedCooldowns(now: number): void {
  for (const [telegramId, expiresAt] of userCooldowns) {
    if (expiresAt <= now) {
      userCooldowns.delete(telegramId);
    }
  }
}

function evictOldestUserIfFull(): void {
  if (userCooldowns.size < MAX_TRACKED_USERS) return;
  const oldestTelegramId = userCooldowns.keys().next().value;
  if (oldestTelegramId !== undefined) userCooldowns.delete(oldestTelegramId);
}

export type RateLimitOptions = {
  /** Text updates outside conversations; menu callbacks are deliberately exempt. */
  messageCooldownMs?: number;
};

/**
 * A light guard for repeated plain-text updates. Buttons must stay immediate:
 * menu navigation and conversations already have domain-specific idempotency
 * guards for operations that change data. This limiter intentionally remains
 * per-process: the documented deployment has one long-polling Telegram update
 * consumer, so a shared store such as Redis would add complexity without
 * changing the effective behavior.
 */
export function rateLimitMiddleware({
  messageCooldownMs = 500,
}: RateLimitOptions = {}): Middleware<MenuContext> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!telegramId || ctx.callbackQuery || !text || text.startsWith('/')) {
      return next();
    }

    const now = Date.now();
    purgeElapsedCooldowns(now);
    const expiresAt = userCooldowns.get(telegramId);

    if (expiresAt !== undefined && expiresAt > now) return;

    evictOldestUserIfFull();
    userCooldowns.set(telegramId, now + messageCooldownMs);
    return next();
  };
}

/** Test-only inspection helper; not used by application code. */
export function getTrackedRateLimitUserCount(): number {
  return userCooldowns.size;
}

/** Test-only/reset helper; not used by application code. */
export function resetRateLimits(): void {
  userCooldowns.clear();
}
