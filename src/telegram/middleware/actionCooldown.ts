/**
 * Small action-specific cooldown registry.
 *
 * The general update limiter protects Telegram from rapid updates. This adds a
 * longer guard around operations with business effects (for example a one-tap
 * renewal), while the database saga remains the source of truth for
 * idempotency across processes.
 */
const actionExpirations = new Map<string, number>();

export function acquireUserActionCooldown(
  telegramId: number,
  action: string,
  cooldownMs: number
): boolean {
  const now = Date.now();
  const key = `${action}:${telegramId}`;
  const expiresAt = actionExpirations.get(key) ?? 0;
  if (expiresAt > now) return false;

  actionExpirations.set(key, now + cooldownMs);
  if (actionExpirations.size > 10_000) {
    for (const [entry, expiry] of actionExpirations) {
      if (expiry <= now) actionExpirations.delete(entry);
    }
  }
  return true;
}

/** Test-only/reset helper; not used by application code. */
export function resetActionCooldowns(): void {
  actionExpirations.clear();
}
