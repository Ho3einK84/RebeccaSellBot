import type { RebeccaUserDetail } from './RebeccaService.js';

const MARKER_PREFIX = 'rsbot:';

export function purchaseOwnershipMarker(intentId: string): string {
  return `${MARKER_PREFIX}${intentId}`;
}

export function trialOwnershipMarker(telegramId: number, configUsername: string): string {
  return `${MARKER_PREFIX}trial:${telegramId}:${configUsername}`;
}

export function remoteMatchesOwnershipMarker(
  remote: Pick<RebeccaUserDetail, 'note'>,
  expectedMarker: string
): boolean {
  return remote.note === expectedMarker;
}

export function remoteFingerprint(remote: { created_at?: string | null }): string {
  const createdAt = remote.created_at?.trim();
  if (createdAt) return `created:${createdAt}`;
  // Subscription credentials are rotated by revoke_sub and therefore cannot
  // identify a Rebecca user incarnation.  Callers must fail closed when the
  // immutable creation timestamp is unavailable instead of pinning identity to
  // a mutable secret.
  throw new Error('REMOTE_INCARNATION_UNAVAILABLE');
}
