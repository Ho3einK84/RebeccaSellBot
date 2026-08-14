import crypto from 'node:crypto';
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

export function remoteFingerprint(remote: {
  created_at?: string | null;
  subscription_url?: string | null;
}): string {
  const createdAt = remote.created_at?.trim();
  if (createdAt) return `created:${createdAt}`;
  return `sub:${crypto
    .createHash('sha256')
    .update(remote.subscription_url || '')
    .digest('hex')}`;
}
