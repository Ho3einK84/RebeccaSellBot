/**
 * Small action-specific cooldown registry.
 *
 * The general update limiter protects Telegram from rapid updates. This adds a
 * longer guard around operations with business effects (for example a one-tap
 * renewal), while the database saga remains the source of truth for
 * idempotency across processes.
 */
const actionTimestamps = new Map<string, number>();

export function acquireUserActionCooldown(
  telegramId: number,
  action: string,
  cooldownMs: number
): boolean {
  const now = Date.now();
  const key = `${action}:${telegramId}`;
  const previous = actionTimestamps.get(key) ?? 0;
  if (now - previous < cooldownMs) return false;

  actionTimestamps.set(key, now);
  if (actionTimestamps.size > 10_000) {
    for (const [entry, timestamp] of actionTimestamps) {
      if (now - timestamp >= cooldownMs) actionTimestamps.delete(entry);
    }
  }
  return true;
}

/** Test-only/reset helper; not used by application code. */
export function resetActionCooldowns(): void {
  actionTimestamps.clear();
}
