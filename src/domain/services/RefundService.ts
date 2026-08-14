import crypto from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  notificationDeliveries,
  purchaseIntents,
  refundIntents,
  userConfigs,
  users,
  walletTransactions,
} from '../../infra/schema.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
  type RebeccaService,
} from './RebeccaService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { TranslationService } from './TranslationService.js';
import {
  purchaseOwnershipMarker,
  remoteFingerprint,
  remoteMatchesOwnershipMarker,
} from './RebeccaOwnership.js';
import { logger } from '../../infra/logger.js';
import {
  normalizeRebeccaPanelAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';

const NON_TERMINAL_REFUND_STATUSES = ['pending', 'reconciliation_required'] as const;
const REFUND_RECONCILIATION_MIN_AGE_MS = 60_000;
const REFUND_OPERATION_LEASE_MS = 12 * 60 * 1000;

export type RefundIneligibilityReason =
  | 'config_not_found'
  | 'remote_unavailable'
  | 'already_used'
  | 'not_purchased_here'
  | 'ownership_mismatch'
  | 'renewed_service'
  | 'refund_window_expired'
  | 'referral_reward_attached'
  | 'already_refunded'
  | 'refund_in_progress';

export type RefundQuote =
  | {
      eligible: true;
      configId: string;
      configUsername: string;
      panelId: string;
      grossAmount: number;
      cashbackWithheld: number;
      refundAmount: number;
      purchaseIntentId: string;
      purchasedAt: Date;
    }
  | { eligible: false; reason: RefundIneligibilityReason };

export class RefundOutcomePendingError extends Error {
  constructor(
    readonly refundIntentId: string,
    options?: ErrorOptions
  ) {
    super('REFUND_OUTCOME_PENDING', options);
    this.name = 'RefundOutcomePendingError';
  }
}

/** Delete-on-panel + wallet refund saga for never-used paid subscriptions. */
export class RefundService {
  constructor(
    panels: RebeccaPanelRegistry | RebeccaService,
    private readonly translationService: TranslationService
  ) {
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  private readonly panels: NormalizedRebeccaPanelAccess;

  async quote(telegramId: number, configId: string): Promise<RefundQuote> {
    const db = getDb();
    const [config] = await db
      .select()
      .from(userConfigs)
      .where(and(eq(userConfigs.id, configId), eq(userConfigs.telegramId, telegramId)))
      .limit(1);
    if (!config) return { eligible: false, reason: 'config_not_found' };

    let remote;
    try {
      remote = await this.panels.getService(config.panelId).getUser(config.configUsername);
    } catch (err) {
      if (
        err instanceof RebeccaApiError ||
        err instanceof RebeccaContractError ||
        err instanceof RebeccaOriginDownError
      ) {
        return { eligible: false, reason: 'remote_unavailable' };
      }
      throw err;
    }
    if (remote.used_traffic > 0 || remote.lifetime_used_traffic > 0) {
      return { eligible: false, reason: 'already_used' };
    }

    const intents = await db
      .select()
      .from(purchaseIntents)
      .where(
        and(
          eq(purchaseIntents.telegramId, telegramId),
          eq(purchaseIntents.panelId, config.panelId),
          eq(purchaseIntents.configUsername, config.configUsername),
          eq(purchaseIntents.status, 'completed')
        )
      )
      .orderBy(asc(purchaseIntents.createdAt));
    const initial = intents.find((intent) => intent.type === 'new_config');
    if (!initial) return { eligible: false, reason: 'not_purchased_here' };
    if (config.remoteCreatedAt && remoteFingerprint(remote) !== config.remoteCreatedAt) {
      return { eligible: false, reason: 'ownership_mismatch' };
    }
    if (
      remote.note?.startsWith('rsbot:') &&
      !remoteMatchesOwnershipMarker(remote, purchaseOwnershipMarker(initial.id))
    ) {
      return { eligible: false, reason: 'ownership_mismatch' };
    }
    if (intents.some((intent) => intent.type === 'renew_config')) {
      // Refunding a renewed service requires reversing multiple historical
      // purchases and reward settlements; keep that case manual and safe.
      return { eligible: false, reason: 'renewed_service' };
    }

    const [existingRefund] = await db
      .select({ status: refundIntents.status })
      .from(refundIntents)
      .where(eq(refundIntents.purchaseIntentId, initial.id))
      .limit(1);
    if (existingRefund?.status === 'completed') {
      return { eligible: false, reason: 'already_refunded' };
    }
    if (
      existingRefund?.status === 'pending' ||
      existingRefund?.status === 'reconciliation_required'
    ) {
      return { eligible: false, reason: 'refund_in_progress' };
    }

    const windowHours = this.translationService.getSettingNum('refund_window_hours', 0);
    const completedAt = initial.completedAt ?? initial.createdAt;
    if (
      Number.isFinite(windowHours) &&
      windowHours > 0 &&
      Date.now() - completedAt.getTime() > windowHours * 60 * 60 * 1000
    ) {
      return { eligible: false, reason: 'refund_window_expired' };
    }

    const [referralReward] = await db
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(eq(walletTransactions.referenceId, `ref_bonus_${initial.id}`))
      .limit(1);
    if (referralReward) {
      // Do not create a referral-farming primitive. An administrator can still
      // perform a manual adjustment after reviewing the linked accounts.
      return { eligible: false, reason: 'referral_reward_attached' };
    }

    const [cashback] = await db
      .select({ amount: walletTransactions.amount })
      .from(walletTransactions)
      .where(eq(walletTransactions.referenceId, `cashback_${initial.id}`))
      .limit(1);
    const cashbackWithheld = Math.max(0, cashback?.amount ?? 0);
    const refundAmount = Math.max(0, initial.amount - cashbackWithheld);
    return {
      eligible: true,
      configId: config.id,
      configUsername: config.configUsername,
      panelId: config.panelId,
      grossAmount: initial.amount,
      cashbackWithheld,
      refundAmount,
      purchaseIntentId: initial.id,
      purchasedAt: completedAt,
    };
  }

  async executeDeleteWithRefund(telegramId: number, configId: string): Promise<RefundQuote> {
    const db = getDb();
    const quote = await this.quote(telegramId, configId);
    if (!quote.eligible) return quote;

    const refundId = await this.acquireRefundIntent(telegramId, quote);
    if (!refundId) return { eligible: false, reason: 'refund_in_progress' };

    // Usage can change between rendering the confirmation button and the user
    // pressing it. Re-check immediately before the destructive call so a
    // service that started carrying traffic is never auto-refunded from a
    // stale quote. A 404 is already the desired deleted state.
    let deleteRequired: boolean;
    const rebeccaService = this.panels.getService(quote.panelId);
    try {
      await this.refreshLease(refundId);
      const latest = await rebeccaService.getUser(quote.configUsername);
      if (latest.used_traffic > 0 || latest.lifetime_used_traffic > 0) {
        await this.failIntent(refundId, 'Refund rejected: traffic appeared before deletion');
        return { eligible: false, reason: 'already_used' };
      }
      const [localConfig] = await db
        .select({ remoteCreatedAt: userConfigs.remoteCreatedAt })
        .from(userConfigs)
        .where(eq(userConfigs.id, quote.configId))
        .limit(1);
      if (
        localConfig?.remoteCreatedAt &&
        remoteFingerprint(latest) !== localConfig.remoteCreatedAt
      ) {
        await this.failIntent(refundId, 'Refund rejected: remote config incarnation mismatch');
        return { eligible: false, reason: 'ownership_mismatch' };
      }
      deleteRequired = latest.status !== 'deleted';
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) {
        deleteRequired = false;
      } else {
        await this.failIntent(refundId, `Pre-delete verification failed: ${errorMessage(err)}`);
        throw err;
      }
    }

    try {
      if (deleteRequired) {
        await this.refreshLease(refundId);
        await rebeccaService.deleteUser(quote.configUsername);
      }
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) {
        // The quote verified the remote user immediately before intent creation;
        // a 404 here means the desired deleted state has already converged.
      } else if (
        err instanceof RebeccaContractError ||
        (err instanceof RebeccaApiError && err.status >= 500) ||
        (err instanceof RebeccaOriginDownError && err.requestDispatched)
      ) {
        await this.markForReconciliation(refundId, 'Remote delete outcome is unknown');
        throw new RefundOutcomePendingError(refundId, { cause: err });
      } else {
        await this.failIntent(refundId, errorMessage(err));
        throw err;
      }
    }

    try {
      const completed = await completeRefundIntent(refundId, telegramId);
      if (!completed) throw new Error('REFUND_INTENT_NO_LONGER_ACTIVE');
    } catch (err) {
      logger.error({ err, refundId }, 'Remote config delete succeeded but refund commit failed');
      await this.markForReconciliation(
        refundId,
        'Remote delete confirmed; local wallet settlement requires reconciliation'
      ).catch(() => undefined);
      throw new RefundOutcomePendingError(refundId, { cause: err });
    }
    return quote;
  }

  private async acquireRefundIntent(
    telegramId: number,
    quote: Extract<RefundQuote, { eligible: true }>
  ): Promise<string | undefined> {
    const db = getDb();
    const freshId = `ri_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    try {
      const [inserted] = await db
        .insert(refundIntents)
        .values({
          id: freshId,
          purchaseIntentId: quote.purchaseIntentId,
          telegramId,
          panelId: quote.panelId,
          configUsername: quote.configUsername,
          grossAmount: quote.grossAmount,
          cashbackWithheld: quote.cashbackWithheld,
          refundAmount: quote.refundAmount,
          status: 'pending',
          operationStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + REFUND_OPERATION_LEASE_MS),
        })
        .returning({ id: refundIntents.id });
      return inserted?.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    // A known remote failure is retryable. Re-arm the same durable intent
    // atomically; only one concurrent retry can transition failed -> pending.
    const [retried] = await db
      .update(refundIntents)
      .set({
        status: 'pending',
        errorMessage: null,
        grossAmount: quote.grossAmount,
        cashbackWithheld: quote.cashbackWithheld,
        refundAmount: quote.refundAmount,
        operationStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + REFUND_OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(refundIntents.purchaseIntentId, quote.purchaseIntentId),
          eq(refundIntents.status, 'failed')
        )
      )
      .returning({ id: refundIntents.id });
    return retried?.id;
  }

  async reconcilePendingRefunds(): Promise<number> {
    const cutoff = new Date(Date.now() - REFUND_RECONCILIATION_MIN_AGE_MS);
    const now = new Date();
    const pending = await getDb()
      .select()
      .from(refundIntents)
      .where(
        and(
          inArray(refundIntents.status, NON_TERMINAL_REFUND_STATUSES),
          lt(refundIntents.updatedAt, cutoff),
          or(isNull(refundIntents.leaseExpiresAt), lte(refundIntents.leaseExpiresAt, now))
        )
      )
      .orderBy(asc(refundIntents.createdAt))
      .limit(100);
    let resolved = 0;
    for (const intent of pending) {
      try {
        const [claimed] = await getDb()
          .update(refundIntents)
          .set({
            leaseExpiresAt: new Date(Date.now() + REFUND_OPERATION_LEASE_MS),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(refundIntents.id, intent.id),
              inArray(refundIntents.status, NON_TERMINAL_REFUND_STATUSES),
              or(isNull(refundIntents.leaseExpiresAt), lte(refundIntents.leaseExpiresAt, now))
            )
          )
          .returning({ id: refundIntents.id });
        if (!claimed) continue;
        const remoteExists = await this.remoteExists(intent.panelId, intent.configUsername);
        if (remoteExists === undefined) continue;
        if (remoteExists) {
          await this.failIntent(intent.id, 'Reconciled: remote delete was not applied');
        } else {
          const completed = await completeRefundIntent(intent.id, intent.telegramId);
          if (!completed) continue;
        }
        resolved += 1;
      } catch (err) {
        logger.error({ err, refundId: intent.id }, 'Refund reconciliation deferred');
      }
    }
    return resolved;
  }

  private async remoteExists(
    panelId: string,
    configUsername: string
  ): Promise<boolean | undefined> {
    try {
      const remote = await this.panels.getService(panelId).getUser(configUsername);
      return remote.status !== 'deleted';
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) return false;
      if (err instanceof RebeccaOriginDownError) return undefined;
      logger.warn({ err, configUsername }, 'Could not establish remote refund state');
      return undefined;
    }
  }

  private async failIntent(refundId: string, message: string): Promise<void> {
    await getDb()
      .update(refundIntents)
      .set({
        status: 'failed',
        errorMessage: message.slice(0, 1_000),
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(refundIntents.id, refundId),
          inArray(refundIntents.status, NON_TERMINAL_REFUND_STATUSES)
        )
      );
  }

  private async markForReconciliation(refundId: string, message: string): Promise<void> {
    await getDb()
      .update(refundIntents)
      .set({
        status: 'reconciliation_required',
        errorMessage: message.slice(0, 1_000),
        leaseExpiresAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(refundIntents.id, refundId));
  }

  private async refreshLease(refundId: string): Promise<void> {
    const [updated] = await getDb()
      .update(refundIntents)
      .set({
        leaseExpiresAt: new Date(Date.now() + REFUND_OPERATION_LEASE_MS),
        updatedAt: new Date(),
      })
      .where(and(eq(refundIntents.id, refundId), eq(refundIntents.status, 'pending')))
      .returning({ id: refundIntents.id });
    if (!updated) throw new Error('REFUND_INTENT_NO_LONGER_ACTIVE');
  }
}

async function completeRefundIntent(refundId: string, telegramId: number): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(refundIntents)
      .where(eq(refundIntents.id, refundId))
      .limit(1);
    if (!intent) return false;
    if (intent.status === 'completed') return true;
    if (intent.status === 'failed') return false;

    const [transitioned] = await tx
      .update(refundIntents)
      .set({
        status: 'completed',
        errorMessage: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(refundIntents.id, refundId),
          inArray(refundIntents.status, NON_TERMINAL_REFUND_STATUSES)
        )
      )
      .returning({ id: refundIntents.id });
    if (!transitioned) return false;

    const [updated] = await tx
      .update(users)
      .set({
        balance: sql`${users.balance} + ${intent.refundAmount}`,
        totalSpend: sql`GREATEST(0, ${users.totalSpend} - ${intent.grossAmount})`,
        updatedAt: new Date(),
      })
      .where(eq(users.telegramId, telegramId))
      .returning({ balance: users.balance });
    if (!updated) throw new Error('REFUND_USER_NOT_FOUND');

    await tx.insert(walletTransactions).values({
      id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      telegramId,
      amount: intent.refundAmount,
      balanceAfter: updated.balance,
      type: 'refund',
      referenceId: `refund_${intent.purchaseIntentId}`,
      description: `Unused subscription refund ${intent.configUsername}; gross=${intent.grossAmount}; cashback_withheld=${intent.cashbackWithheld}`,
    });

    await tx
      .delete(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.panelId, intent.panelId),
          eq(notificationDeliveries.configUsername, intent.configUsername)
        )
      );
    await tx
      .delete(userConfigs)
      .where(
        and(
          eq(userConfigs.panelId, intent.panelId),
          eq(userConfigs.configUsername, intent.configUsername)
        )
      );
    await tx
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

    await tx.insert(auditLogs).values({
      id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      actorTelegramId: telegramId,
      action: 'subscription_refunded_deleted',
      entityType: 'user_config',
      entityId: intent.configUsername,
      targetTelegramId: telegramId,
      metadata: JSON.stringify({
        refundIntentId: intent.id,
        purchaseIntentId: intent.purchaseIntentId,
        grossAmount: intent.grossAmount,
        cashbackWithheld: intent.cashbackWithheld,
        refundAmount: intent.refundAmount,
        panelId: intent.panelId,
      }),
    });
    return true;
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const target = (err as { cause?: object }).cause ?? err;
  return (
    typeof target === 'object' &&
    target !== null &&
    'code' in target &&
    (target as { code?: unknown }).code === '23505'
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
