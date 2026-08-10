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
