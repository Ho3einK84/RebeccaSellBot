import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { purchaseIntents, userConfigs } from '../../infra/schema.js';
import type { RebeccaUserDetail } from './RebeccaService.js';
import {
  purchaseOwnershipMarker,
  remoteFingerprint,
  trialOwnershipMarker,
} from './RebeccaOwnership.js';

export type IncarnationConfigRecord = Pick<
  typeof userConfigs.$inferSelect,
  'id' | 'telegramId' | 'panelId' | 'configUsername' | 'subUrl' | 'remoteCreatedAt'
>;

/**
 * The users-list endpoint already contains every immutable/credential field
 * needed for the common verification path. `note` exists only on full user
 * detail responses, so it stays optional and is used as an additional legacy
 * continuity proof when available.
 */
export type IncarnationRemoteRecord = Pick<
  RebeccaUserDetail,
  'created_at' | 'subscription_url' | 'subscription_urls'
> &
  Partial<Pick<RebeccaUserDetail, 'note'>>;

export class ConfigIncarnationMismatchError extends Error {
  constructor() {
    super('CONFIG_INCARNATION_MISMATCH');
    this.name = 'ConfigIncarnationMismatchError';
  }
}

export class ConfigIncarnationUnverifiedError extends Error {
  constructor() {
    super('CONFIG_INCARNATION_UNVERIFIED');
    this.name = 'ConfigIncarnationUnverifiedError';
  }
}

/**
 * Verify that a local binding still refers to the same immutable Rebecca user.
 *
 * Bindings created before the incarnation migration have no stored fingerprint.
 * They are upgraded only when we can prove continuity using data the old bot
 * already knew: the exact subscription credential, the purchase ownership note,
 * or the deterministic trial ownership note.  A username match alone is never
 * enough because Rebecca usernames may be reused after deletion.
 */
export async function verifyOrEstablishConfigIncarnation(
  config: IncarnationConfigRecord,
  remote: IncarnationRemoteRecord
): Promise<string> {
  const fingerprint = remoteFingerprint(remote);
  const stored = config.remoteCreatedAt?.trim() || null;

  if (stored?.startsWith('created:')) {
    if (stored !== fingerprint) throw new ConfigIncarnationMismatchError();
    return fingerprint;
  }

  // `sub:` was used briefly as a fallback by the first hardening pass.  It is
  // mutable when revoke_sub rotates credentials, so treat it like an unverified
  // legacy binding and upgrade it only after independent continuity proof.
  if (!(await legacyBindingProvesContinuity(config, remote))) {
    throw new ConfigIncarnationUnverifiedError();
  }

  const db = getDb();
  const [updated] = await db
    .update(userConfigs)
    .set({ remoteCreatedAt: fingerprint, updatedAt: new Date() })
    .where(and(eq(userConfigs.id, config.id), isNull(userConfigs.remoteCreatedAt)))
    .returning({ remoteCreatedAt: userConfigs.remoteCreatedAt });

  if (updated?.remoteCreatedAt === fingerprint) {
    config.remoteCreatedAt = fingerprint;
    return fingerprint;
  }

  // A concurrent verifier may have won the conditional update, or an old
  // `sub:` fingerprint may need replacement.  Re-read before deciding.
  const [current] = await db
    .select({ remoteCreatedAt: userConfigs.remoteCreatedAt })
    .from(userConfigs)
    .where(eq(userConfigs.id, config.id))
    .limit(1);
  const currentFingerprint = current?.remoteCreatedAt?.trim() || null;

  if (currentFingerprint === fingerprint) {
    config.remoteCreatedAt = fingerprint;
    return fingerprint;
  }

  if (stored?.startsWith('sub:') && currentFingerprint === stored) {
    const [replaced] = await db
      .update(userConfigs)
      .set({ remoteCreatedAt: fingerprint, updatedAt: new Date() })
      .where(and(eq(userConfigs.id, config.id), eq(userConfigs.remoteCreatedAt, stored)))
      .returning({ remoteCreatedAt: userConfigs.remoteCreatedAt });
    if (replaced?.remoteCreatedAt === fingerprint) {
      config.remoteCreatedAt = fingerprint;
      return fingerprint;
    }
  }

  // If the row disappeared, ownership changed, or another fingerprint was
  // established concurrently, never mutate the remote account on stale proof.
  if (currentFingerprint && currentFingerprint !== fingerprint) {
    throw new ConfigIncarnationMismatchError();
  }
  throw new ConfigIncarnationUnverifiedError();
}

async function legacyBindingProvesContinuity(
  config: IncarnationConfigRecord,
  remote: IncarnationRemoteRecord
): Promise<boolean> {
  if (subscriptionCredentialMatches(config.subUrl, remote)) return true;

  if (remote.note === trialOwnershipMarker(config.telegramId, config.configUsername)) {
    return true;
  }

  const recentPurchases = await getDb()
    .select({ id: purchaseIntents.id })
    .from(purchaseIntents)
    .where(
      and(
        eq(purchaseIntents.telegramId, config.telegramId),
        eq(purchaseIntents.panelId, config.panelId),
        eq(purchaseIntents.configUsername, config.configUsername),
        eq(purchaseIntents.type, 'new_config'),
        eq(purchaseIntents.status, 'completed')
      )
    )
    .limit(3);

  return recentPurchases.some((purchase) => remote.note === purchaseOwnershipMarker(purchase.id));
}

function subscriptionCredentialMatches(
  localSubUrl: string | null,
  remote: Pick<RebeccaUserDetail, 'subscription_url' | 'subscription_urls'>
): boolean {
  const local = normalizeSubscriptionUrlForIdentity(localSubUrl);
  if (!local) return false;
  const candidates = [remote.subscription_url, ...Object.values(remote.subscription_urls ?? {})];
  return candidates.some((candidate) => normalizeSubscriptionUrlForIdentity(candidate) === local);
}

function normalizeSubscriptionUrlForIdentity(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
