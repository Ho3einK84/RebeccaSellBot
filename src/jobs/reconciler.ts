/**
 * Reconciler job — settles purchase intents that remain pending after a remote
 * request or local process outcome was indeterminate.
 *
 * Safety rule: never release a reservation merely because time elapsed. The
 * panel must prove that a mutation did not happen. This is especially critical
 * for renewals: a timeout can occur after Rebecca has already applied traffic
 * or expiry changes.
 */

import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../infra/db.js';
import {
  purchaseIntents,
  trialClaims,
  users,
  userConfigs,
  walletTransactions,
} from '../infra/schema.js';
import type { RebeccaService, RebeccaUserDetail } from '../domain/services/RebeccaService.js';
import { RebeccaApiError, RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import {
  activeConfigCountSql,
  observedConfigLifecycle,
} from '../domain/services/ConfigLifecycle.js';
import { logger } from '../infra/logger.js';
import { forEachConcurrent, jobRunner } from './workerRuntime.js';
import crypto from 'crypto';
import type { PromoService } from '../domain/services/PromoService.js';
import type { ReferralService } from '../domain/services/ReferralService.js';
import type { TrialService } from '../domain/services/TrialService.js';
import type { RefundService } from '../domain/services/RefundService.js';
import type { ConfigReconciliationService } from '../domain/services/ConfigReconciliationService.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import {
  getRebeccaService,
  isRebeccaPanelRegistryAccess,
} from '../domain/services/RebeccaPanelAccess.js';
import {
  purchaseOwnershipMarker,
  remoteMatchesOwnershipMarker,
} from '../domain/services/RebeccaOwnership.js';

/** Pending intents are not inspected until a full five minutes have elapsed. */
export const PENDING_INTENT_MIN_AGE_MS = 5 * 60 * 1000;
const ORPHAN_SCAN_INTERVAL_MS = 15 * 60 * 1000;
const RECONCILIATION_LEASE_MS = 12 * 60 * 1000;

type PurchaseIntent = typeof purchaseIntents.$inferSelect;
type RenewalOutcome = 'applied' | 'not_applied' | 'ambiguous';
const NON_TERMINAL_INTENT_STATUSES = ['pending', 'reconciliation_required'] as const;

export interface ReconciliationServices {
  promoService?: PromoService;
  referralService?: ReferralService;
  trialService?: TrialService;
  refundService?: RefundService;
  configReconciliationService?: ConfigReconciliationService;
}

export async function reconcilePendingIntents(
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService,
  services: Pick<ReconciliationServices, 'promoService' | 'referralService'> = {}
): Promise<number> {
  const db = getDb();
  const timeoutCutoff = new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS);
  const now = new Date();

  if (services.referralService) {
    await reconcileDeferredBonuses(db, services.referralService);
  }

  const stuckIntents = await db
    .select()
    .from(purchaseIntents)
    .where(
      and(
        inArray(purchaseIntents.status, NON_TERMINAL_INTENT_STATUSES),
        lt(purchaseIntents.updatedAt, timeoutCutoff),
        or(isNull(purchaseIntents.leaseExpiresAt), lte(purchaseIntents.leaseExpiresAt, now))
      )
    );

  if (stuckIntents.length === 0) return 0;

  logger.info(
    { count: stuckIntents.length, minAgeMs: PENDING_INTENT_MIN_AGE_MS },
    'Reconciliation job checking pending purchase intents'
  );

  let resolvedCount = 0;
  for (const intent of stuckIntents) {
    try {
      if (isRebeccaPanelRegistryAccess(panels)) {
        const [claimed] = await db
          .update(purchaseIntents)
          .set({
            leaseExpiresAt: new Date(Date.now() + RECONCILIATION_LEASE_MS),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(purchaseIntents.id, intent.id),
              inArray(purchaseIntents.status, NON_TERMINAL_INTENT_STATUSES),
              or(isNull(purchaseIntents.leaseExpiresAt), lte(purchaseIntents.leaseExpiresAt, now))
            )
          )
          .returning({ id: purchaseIntents.id });
        if (!claimed) continue;
      }
      const rebeccaService = getRebeccaService(panels, intent.panelId);
      const remote = await lookupRemoteUser(rebeccaService, intent);
      if (remote.kind === 'unknown') {
        if (isRebeccaPanelRegistryAccess(panels)) {
          await releaseReconciliationLease(db, intent.id);
        }
        continue;
      }

      if (intent.type === 'new_config') {
        if (remote.user && remote.user.status !== 'deleted') {
          const expectedMarker = purchaseOwnershipMarker(intent.id);
          if (!remoteMatchesOwnershipMarker(remote.user, expectedMarker)) {
            await keepIntentPending(
              db,
              intent.id,
              'Manual review required: Rebecca user ownership marker does not match this purchase'
            );
            logger.error(
              { intentId: intent.id, configUsername: intent.configUsername },
              'Reconciliation refused to bind a Rebecca user with a mismatched ownership marker'
            );
            continue;
          }

          const completed = await completePendingIntent(
            db,
            intent,
            remote.user,
            services.promoService,
            isRebeccaPanelRegistryAccess(panels)
          );
          if (completed) {
            await settleRecoveredBonuses(services.referralService, intent);
            resolvedCount++;
            logger.info(
              { intentId: intent.id, configUsername: intent.configUsername },
              'Reconciliation completed confirmed new-config purchase'
            );
          }
        } else {
          const released = await failAndReleaseIntent(
            db,
            intent,
            'Reconciled: Rebecca confirms the configuration is absent',
            services.promoService
          );
          if (released) {
            resolvedCount++;
            logger.info(
              { intentId: intent.id, configUsername: intent.configUsername },
              'Reconciliation released failed new-config purchase'
            );
          }
        }
        continue;
      }

      const renewalOutcome = determineRenewalOutcome(intent, remote.user);
      if (renewalOutcome === 'applied') {
        const completed = await completePendingIntent(
          db,
          intent,
          remote.user!,
          services.promoService,
          isRebeccaPanelRegistryAccess(panels)
        );
        if (completed) {
          await settleRecoveredBonuses(services.referralService, intent);
          resolvedCount++;
          logger.info(
            { intentId: intent.id, configUsername: intent.configUsername },
            'Reconciliation completed confirmed renewal'
          );
        }
      } else if (renewalOutcome === 'not_applied') {
        const released = await failAndReleaseIntent(
          db,
          intent,
          'Reconciled: Rebecca confirms the renewal was not applied',
          services.promoService
        );
        if (released) {
          resolvedCount++;
          logger.info(
            { intentId: intent.id, configUsername: intent.configUsername },
            'Reconciliation released confirmed unapplied renewal'
          );
        }
      } else {
        await keepIntentPending(
          db,
          intent.id,
          'Reconciliation deferred: renewal state is ambiguous on Rebecca'
        );
        logger.warn(
          { intentId: intent.id, configUsername: intent.configUsername },
          'Reconciliation retained ambiguous renewal reservation'
        );
      }
    } catch (err) {
      // A DB issue or a competing reconciler must leave the intent pending.
      // The conditional state changes inside the helpers make subsequent runs
      // safe and prevent double debits/releases.
      logger.error({ err, intentId: intent.id }, 'Error reconciling pending purchase intent');
    }
  }

  return resolvedCount;
}

/**
 * Refresh locally-owned configuration lifecycle state from Rebecca. This cache
 * is deliberately observational: failures leave the last known state intact,
 * and every mutation still goes through Rebecca rather than trusting the
 * cache. The bounded batch keeps the regular reconciliation tick predictable.
 */
export async function syncSubscriptionStatuses(
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService,
  pageSize = 250
): Promise<number> {
  const db = getDb();
  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 1_000));
  const affectedOwners = new Set<number>();
  let synced = 0;
  let cursor: string | undefined;

  for (;;) {
    const configs = await db
      .select()
      .from(userConfigs)
      .where(cursor ? gt(userConfigs.id, cursor) : undefined)
      .orderBy(asc(userConfigs.id))
      .limit(safePageSize);
    if (configs.length === 0) break;

    await forEachConcurrent(configs, 8, async (config) => {
      try {
        const remote = await getRebeccaService(panels, config.panelId).getUser(
          config.configUsername
        );
        await db
          .update(userConfigs)
          .set({
            panelStatus: remote.status,
            panelDataLimit: remote.data_limit,
            panelExpire: remote.expire,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(userConfigs.id, config.id));
        affectedOwners.add(config.telegramId);
        synced += 1;
      } catch (err) {
        // A deleted config is still a useful terminal state. Any other panel
        // error must not overwrite an otherwise valid cached observation.
        if (err instanceof RebeccaApiError && err.status === 404) {
          await db
            .update(userConfigs)
            .set({ panelStatus: 'deleted', lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(eq(userConfigs.id, config.id));
          affectedOwners.add(config.telegramId);
          synced += 1;
        } else {
          logger.warn(
            { err, configUsername: config.configUsername },
            'Subscription lifecycle sync deferred for panel error'
          );
        }
      }
    });

    cursor = configs.at(-1)?.id;
    if (!cursor || configs.length < safePageSize) break;
  }

  for (const telegramId of affectedOwners) {
    await db
      .update(users)
      .set({
        activeSubscriptionCount: sql`(
          SELECT COUNT(*)::integer FROM ${userConfigs}
          WHERE ${userConfigs.telegramId} = ${telegramId}
            AND ${userConfigs.panelStatus} = 'active'
        )`,
        updatedAt: new Date(),
      })
      .where(eq(users.telegramId, telegramId));
  }
  return synced;
}

async function lookupRemoteUser(
  rebeccaService: RebeccaService,
  intent: PurchaseIntent
): Promise<{ kind: 'known'; user: RebeccaUserDetail | null } | { kind: 'unknown' }> {
  if (!intent.configUsername) {
    // A malformed legacy intent cannot establish remote absence safely.
    // Keep it reserved for manual review instead of silently freeing funds.
    logger.error({ intentId: intent.id }, 'Pending purchase intent has no config username');
    return { kind: 'unknown' };
  }

  try {
    return { kind: 'known', user: await rebeccaService.getUser(intent.configUsername) };
  } catch (err) {
    if (err instanceof RebeccaOriginDownError) {
      logger.warn({ intentId: intent.id }, 'Reconciliation deferred: Rebecca is unavailable');
      return { kind: 'unknown' };
    }
    if (err instanceof RebeccaApiError && err.status === 404) {
      return { kind: 'known', user: null };
    }

    // Authentication, validation, and unexpected panel errors cannot prove an
    // operation failed, so preserve the reservation and retry later.
    logger.warn({ err, intentId: intent.id }, 'Reconciliation deferred: remote state unavailable');
    return { kind: 'unknown' };
  }
}

/**
 * Resolve a renewal using the state snapshot persisted before the remote PUT.
 *
 * `not_applied` is intentionally narrow: either the config is absent, or all
 * relevant fields exactly match the pre-renewal snapshot. Any third state may
 * include a successful update plus an independent panel/admin change, so it
 * stays pending rather than releasing potentially spent funds.
 */
function determineRenewalOutcome(
  intent: PurchaseIntent,
  remote: RebeccaUserDetail | null
): RenewalOutcome {
  if (!remote || remote.status === 'deleted') return 'not_applied';

  // New rows always record this before the remote update. Older rows without
  // it are inherently ambiguous and must be reviewed rather than auto-freed.
  if (
    intent.expectedStatus === null ||
    intent.previousStatus === null ||
    intent.expectedExpire === null
  ) {
    return 'ambiguous';
  }

  const matchesTarget =
    sameNullableNumber(remote.data_limit, intent.expectedDataLimit) &&
    sameNullableNumber(remote.expire, intent.expectedExpire);
  const matchesPrevious =
    sameNullableNumber(remote.data_limit, intent.previousDataLimit) &&
    sameNullableNumber(remote.expire, intent.previousExpire) &&
    remote.status === intent.previousStatus;

  // Status can legitimately become limited/expired soon after an otherwise
  // successful update, so changed target limits/expiry are sufficient proof.
  if (matchesTarget) return 'applied';
  if (
    matchesPrevious &&
    !intent.errorMessage?.startsWith(
      'Traffic reset applied but renewal update outcome is unresolved'
    )
  ) {
    return 'not_applied';
  }
  return 'ambiguous';
}

async function completePendingIntent(
  db: ReturnType<typeof getDb>,
  intent: PurchaseIntent,
  remote: RebeccaUserDetail,
  promoService?: PromoService,
  verifyBindingConflict = true
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const observedAt = new Date();
    const subUrl = subscriptionUrl(remote);
    // Claim the intent first. If another worker or the original saga settled
    // it, its transaction owns the only possible debit and we do nothing.
    const transitioned = await tx
      .update(purchaseIntents)
      .set({
        status: 'completed',
        errorMessage: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${purchaseIntents.id} = ${intent.id}
          AND ${purchaseIntents.status} IN ('pending', 'reconciliation_required')`
      )
      .returning({ id: purchaseIntents.id });
    if (transitioned.length === 0) return false;

    const updatedUsers = await tx
      .update(users)
      .set({
        balance: sql`${users.balance} - ${intent.amount}`,
        reservedBalance: sql`${users.reservedBalance} - ${intent.amount}`,
        totalSpend: sql`${users.totalSpend} + ${intent.amount}`,
        updatedAt: new Date(),
      })
      .where(
        sql`${users.telegramId} = ${intent.telegramId}
          AND ${users.balance} >= ${intent.amount}
          AND ${users.reservedBalance} >= ${intent.amount}`
      )
      .returning();
    if (updatedUsers.length === 0) throw new Error('RESERVATION_INVARIANT_VIOLATION');

    await tx.insert(walletTransactions).values({
      id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      telegramId: intent.telegramId,
      amount: -intent.amount,
      balanceAfter: updatedUsers[0]!.balance,
      type: 'purchase',
      referenceId: intent.id,
      description: `Reconciled purchase ${intent.type}: ${intent.configUsername ?? 'unknown'} (${intent.gbAmount ?? 0}GB / ${intent.durationDays ?? 0}d)`,
    });

    if (intent.type === 'new_config' && intent.configUsername) {
      await tx
        .insert(userConfigs)
        .values({
          id: `uc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          telegramId: intent.telegramId,
          panelId: intent.panelId,
          serviceId: intent.serviceId,
          configUsername: intent.configUsername,
          subUrl,
          isClaimed: true,
          claimedAt: new Date(),
          ...observedConfigLifecycle(remote, observedAt),
        })
        .onConflictDoNothing();
      if (verifyBindingConflict) {
        const [binding] = await tx
          .select({ telegramId: userConfigs.telegramId })
          .from(userConfigs)
          .where(
            and(
              eq(userConfigs.panelId, intent.panelId),
              eq(userConfigs.configUsername, intent.configUsername)
            )
          )
          .limit(1);
        if (!binding || binding.telegramId !== intent.telegramId) {
          throw new Error('CONFIG_BINDING_CONFLICT');
        }
      }
    } else if (intent.type === 'renew_config' && intent.configUsername) {
      await tx
        .update(trialClaims)
        .set({ status: 'converted', updatedAt: new Date() })
        .where(
          and(
            eq(trialClaims.panelId, intent.panelId),
            eq(trialClaims.configUsername, intent.configUsername),
            eq(trialClaims.status, 'completed')
          )
        );
    }

    if (intent.configUsername) {
      await tx
        .update(userConfigs)
        .set({
          ...(subUrl ? { subUrl } : {}),
          serviceId: remote.service_id ?? intent.serviceId,
          ...observedConfigLifecycle(remote, observedAt),
        })
        .where(
          and(
            eq(userConfigs.panelId, intent.panelId),
            eq(userConfigs.configUsername, intent.configUsername),
            eq(userConfigs.telegramId, intent.telegramId)
          )
        );
    }
    await tx
      .update(users)
      .set({
        activeSubscriptionCount: activeConfigCountSql(intent.telegramId),
        updatedAt: observedAt,
      })
      .where(eq(users.telegramId, intent.telegramId));

    if (promoService) {
      await promoService.finalizeReservedPurchasePromo(tx, intent.id);
    }

    return true;
  });
}

async function failAndReleaseIntent(
  db: ReturnType<typeof getDb>,
  intent: PurchaseIntent,
  errorMessage: string,
  promoService?: PromoService
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const transitioned = await tx
      .update(purchaseIntents)
      .set({ status: 'failed', errorMessage, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        sql`${purchaseIntents.id} = ${intent.id}
          AND ${purchaseIntents.status} IN ('pending', 'reconciliation_required')`
      )
      .returning({ id: purchaseIntents.id });
    if (transitioned.length === 0) return false;

    if (promoService) {
      await promoService.releaseReservedPurchasePromoInTransaction(tx, intent.id);
    }

    const released = await tx
      .update(users)
      .set({
        reservedBalance: sql`${users.reservedBalance} - ${intent.amount}`,
        updatedAt: new Date(),
      })
      .where(
        sql`${users.telegramId} = ${intent.telegramId}
          AND ${users.reservedBalance} >= ${intent.amount}`
      )
      .returning({ telegramId: users.telegramId });
    if (released.length === 0) throw new Error('RESERVATION_INVARIANT_VIOLATION');
    return true;
  });
}

async function keepIntentPending(
  db: ReturnType<typeof getDb>,
  intentId: string,
  errorMessage: string
): Promise<void> {
  await db
    .update(purchaseIntents)
    .set({ errorMessage, leaseExpiresAt: new Date(), updatedAt: new Date() })
    .where(
      sql`${purchaseIntents.id} = ${intentId}
        AND ${purchaseIntents.status} IN ('pending', 'reconciliation_required')`
    );
}

async function releaseReconciliationLease(
  db: ReturnType<typeof getDb>,
  intentId: string
): Promise<void> {
  await db
    .update(purchaseIntents)
    .set({ leaseExpiresAt: new Date(), updatedAt: new Date() })
    .where(
      sql`${purchaseIntents.id} = ${intentId}
        AND ${purchaseIntents.status} IN ('pending', 'reconciliation_required')`
    );
}

function sameNullableNumber(actual: number | null, expected: number | null): boolean {
  return actual === expected;
}

function subscriptionUrl(user: RebeccaUserDetail): string | undefined {
  return user.subscription_url || Object.values(user.subscription_urls ?? {})[0];
}

async function settleRecoveredBonuses(
  referralService: ReferralService | undefined,
  intent: PurchaseIntent
): Promise<void> {
  if (!referralService) return;
  try {
    await referralService.processCompletedPurchase(intent.telegramId, intent.amount, intent.id);
    await getDb()
      .update(purchaseIntents)
      .set({ bonusesProcessedAt: new Date(), updatedAt: new Date() })
      .where(sql`${purchaseIntents.id} = ${intent.id} AND ${purchaseIntents.status} = 'completed'`);
  } catch (err) {
    logger.error({ err, intentId: intent.id }, 'Recovered purchase bonus processing deferred');
  }
}

async function reconcileDeferredBonuses(
  db: ReturnType<typeof getDb>,
  referralService: ReferralService
): Promise<void> {
  try {
    const deferred = await db
      .select()
      .from(purchaseIntents)
      .where(
        and(eq(purchaseIntents.status, 'completed'), isNull(purchaseIntents.bonusesProcessedAt))
      )
      .orderBy(purchaseIntents.createdAt)
      .limit(100);
    for (const intent of deferred) {
      await settleRecoveredBonuses(referralService, intent);
    }
  } catch (err) {
    logger.error({ err }, 'Deferred purchase bonus sweep failed');
  }
}

let reconciliationTimer: NodeJS.Timeout | null = null;
let lastOrphanScanAt = 0;
export function startReconciliationCron(
  panels: RebeccaPanelRegistry,
  servicesOrInterval: ReconciliationServices | number = {},
  configuredIntervalMs = 60_000
): void {
  stopReconciliationCron();
  lastOrphanScanAt = 0;
  const services =
    typeof servicesOrInterval === 'number' ? ({} as ReconciliationServices) : servicesOrInterval;
  const intervalMs =
    typeof servicesOrInterval === 'number' ? servicesOrInterval : configuredIntervalMs;

  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('reconciliation', async () => {
        await reconcilePendingIntents(panels, services);
        await syncSubscriptionStatuses(panels);
        if (services.refundService) await services.refundService.reconcilePendingRefunds();
        if (
          services.configReconciliationService &&
          Date.now() - lastOrphanScanAt >= ORPHAN_SCAN_INTERVAL_MS
        ) {
          await services.configReconciliationService.scan();
          lastOrphanScanAt = Date.now();
        }
        if (services.trialService) await services.trialService.reconcilePendingClaims();
      });
    } catch (err) {
      logger.error({ err }, 'Error in reconciliation cron worker');
    }
  };

  void run();
  reconciliationTimer = setInterval(() => {
    void run();
  }, intervalMs);
  logger.info(
    { intervalMs, minIntentAgeMs: PENDING_INTENT_MIN_AGE_MS },
    'Reconciliation cron worker started'
  );
}

export function stopReconciliationCron(): void {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
}
