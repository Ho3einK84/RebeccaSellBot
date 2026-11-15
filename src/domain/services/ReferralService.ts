/**
 * ReferralService owns referral-code resolution and retry-safe referral/cashback
 * credits. WalletService owns the purchase saga and invokes this service only
 * after its purchase transaction has completed.
 */
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import { purchaseIntents, refundIntents, users, walletTransactions } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { TranslationService } from './TranslationService.js';
import { dbIntegerToSafeNumber } from './DbNumber.js';

export type BonusSnapshot = {
  cashbackPercent: number;
  cashbackAmount: number;
  referrerTelegramId: number | null;
  referralBonusAmount: number;
};

type DbInstance = ReturnType<typeof getDb>;
type DbTransaction = Parameters<Parameters<DbInstance['transaction']>[0]>[0];

export class ReferralService {
  private readonly invalidationHooks: Array<(telegramId: number) => void> = [];

  constructor(private readonly translationService: TranslationService) {}

  /** Register a callback invoked post-commit whenever bonuses credit a user's wallet. */
  registerInvalidationHook(hook: (telegramId: number) => void): void {
    this.invalidationHooks.push(hook);
  }

  private notifyInvalidation(telegramId: number): void {
    for (const hook of this.invalidationHooks) {
      hook(telegramId);
    }
  }

  /**
   * Resolve a deep-link payload to its exact, existing referral code. The
   * complete stored code is required; accepting only its numeric segment would
   * let callers fabricate referrals for arbitrary Telegram IDs.
   *
   * Binding the returned ID is deliberately owned by user creation, where an
   * insert-once operation preserves the user's first touch permanently.
   */
  async resolveReferrerId(
    rawReferralCode: string | undefined,
    recipientTelegramId: number
  ): Promise<number | undefined> {
    const referralCode = rawReferralCode?.trim();
    if (!referralCode || referralCode.length > 128) return undefined;

    const [referrer] = await getDb()
      .select({ telegramId: users.telegramId })
      .from(users)
      .where(eq(users.referralCode, referralCode))
      .limit(1);

    if (!referrer || referrer.telegramId === recipientTelegramId) return undefined;
    return referrer.telegramId;
  }

  async calculateBonusSnapshot(
    tx: Pick<DbTransaction, 'select'>,
    telegramId: number,
    purchaseAmount: number
  ): Promise<BonusSnapshot> {
    let referrerTelegramId: number | null = null;
    let referralBonusAmount = 0;

    const [user] = await tx
      .select({ referrerId: users.referrerId })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (user?.referrerId && user.referrerId !== telegramId) {
      const [previousPaid] = await tx
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.telegramId, telegramId),
            eq(walletTransactions.type, 'purchase'),
            lt(walletTransactions.amount, 0)
          )
        )
        .limit(1);

      if (!previousPaid) {
        referralBonusAmount = asPositiveSafeInteger(
          this.translationService.getSettingNum('referral_bonus_toman', 10000)
        );
        referrerTelegramId = user.referrerId;
      }
    }

    const cashbackPercent = asPercent(this.translationService.getSettingNum('cashback_percent', 0));
    const safeAmount = asPositiveSafeInteger(purchaseAmount);
    const cashbackAmount =
      cashbackPercent > 0 && safeAmount > 0 ? percentOf(safeAmount, cashbackPercent) : 0;

    return {
      cashbackPercent,
      cashbackAmount,
      referrerTelegramId,
      referralBonusAmount,
    };
  }

  async processCompletedPurchase(
    telegramId: number,
    amount: number,
    intentId: string
  ): Promise<void> {
    const db = getDb();
    const creditedUsers = new Set<number>();

    await db.transaction(async (tx) => {
      // 1. Lock the purchase intent row
      const [intent] = await tx
        .select()
        .from(purchaseIntents)
        .where(
          and(
            eq(purchaseIntents.id, intentId),
            eq(purchaseIntents.status, 'completed'),
            isNull(purchaseIntents.refundedAt)
          )
        )
        .for('update')
        .limit(1);

      if (!intent) {
        // Either not found, not completed, or already refunded
        return;
      }

      // Check if any refund intent is pending or completed for this purchase
      const [activeRefund] = await tx
        .select({ id: refundIntents.id })
        .from(refundIntents)
        .where(
          and(
            eq(refundIntents.purchaseIntentId, intentId),
            inArray(refundIntents.status, ['completed', 'pending', 'reconciliation_required'])
          )
        )
        .limit(1);

      if (activeRefund) {
        // Mark bonuses terminal so reconciler will not re-attempt
        await tx
          .update(purchaseIntents)
          .set({ bonusesProcessedAt: new Date(), updatedAt: new Date() })
          .where(eq(purchaseIntents.id, intentId));
        return;
      }

      // Resolve snapshotted or fallback values:
      // Modern intents always populate non-null numeric snapshot columns (even
      // when referrerTelegramId is null because there was no referrer or it was
      // a repeat purchase). Only legacy rows with NULL numeric snapshot columns
      // need the fallback query.
      let referralBonus = intent.referralBonusAmount;
      let referrerId = intent.referrerTelegramId;
      let cashbackAmount = intent.cashbackAmount;
      let cashbackPercent = intent.cashbackPercent;

      if (referralBonus === null || cashbackAmount === null || cashbackPercent === null) {
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.telegramId, telegramId))
          .limit(1);
        if (user?.referrerId && user.referrerId !== telegramId && referrerId === null) {
          const [firstPurchase] = await tx
            .select({ intentId: walletTransactions.referenceId })
            .from(walletTransactions)
            .where(
              and(
                eq(walletTransactions.telegramId, telegramId),
                eq(walletTransactions.type, 'purchase'),
                lt(walletTransactions.amount, 0)
              )
            )
            .orderBy(asc(walletTransactions.createdAt), asc(walletTransactions.id))
            .limit(1);
          if (firstPurchase?.intentId === intentId) {
            referrerId = user.referrerId;
            referralBonus = asPositiveSafeInteger(
              this.translationService.getSettingNum('referral_bonus_toman', 10000)
            );
          }
        }
        if (cashbackPercent === null) {
          cashbackPercent = asPercent(this.translationService.getSettingNum('cashback_percent', 0));
        }
        if (cashbackAmount === null) {
          const purchaseAmount = asPositiveSafeInteger(amount);
          cashbackAmount =
            cashbackPercent > 0 && purchaseAmount > 0
              ? percentOf(purchaseAmount, cashbackPercent)
              : 0;
        }
      }

      if (referrerId && (referralBonus ?? 0) > 0) {
        const referenceId = `ref_bonus_${intentId}`;
        const awarded = await this.creditWalletInTransaction(tx, {
          telegramId: referrerId,
          amount: referralBonus!,
          type: 'referral_bonus',
          referenceId,
          description: `Referral bonus for user ${telegramId}`,
        });
        if (awarded) {
          creditedUsers.add(referrerId);
          logger.info(
            { referrerId, bonusAmount: referralBonus, referenceId },
            'Referral bonus awarded'
          );
        }
      }

      if ((cashbackAmount ?? 0) > 0) {
        const referenceId = `cashback_${intentId}`;
        const awarded = await this.creditWalletInTransaction(tx, {
          telegramId,
          amount: cashbackAmount!,
          type: 'cashback',
          referenceId,
          description: `Cashback ${cashbackPercent ?? 0}% for purchase ${intentId}`,
        });
        if (awarded) {
          creditedUsers.add(telegramId);
          logger.info({ telegramId, cashbackAmount, referenceId }, 'Cashback awarded');
        }
      }

      await tx
        .update(purchaseIntents)
        .set({ bonusesProcessedAt: new Date(), updatedAt: new Date() })
        .where(eq(purchaseIntents.id, intentId));
    });

    for (const id of creditedUsers) {
      this.notifyInvalidation(id);
    }
  }

  /**
   * Credit a wallet exactly once using a SQL savepoint inside the outer
   * transaction so a concurrent 23505 unique conflict rolls back only the
   * conflicting credit without aborting the surrounding PostgreSQL transaction.
   */
  private async creditWalletInTransaction(
    tx: Pick<DbTransaction, 'select' | 'update' | 'insert'> &
      Partial<Pick<DbTransaction, 'execute'>>,
    params: {
      telegramId: number;
      amount: number;
      type: 'referral_bonus' | 'cashback';
      referenceId: string;
      description: string;
    }
  ): Promise<boolean> {
    const savepoint = 'sp_referral_wallet_credit';
    const hasSavepoint = typeof tx.execute === 'function';
    if (hasSavepoint) {
      await tx.execute!(sql.raw(`SAVEPOINT ${savepoint}`));
    }
    try {
      const [alreadyCredited] = await tx
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(eq(walletTransactions.referenceId, params.referenceId))
        .limit(1);
      if (alreadyCredited) {
        if (hasSavepoint) {
          await tx.execute!(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
        }
        return false;
      }

      const [updatedUser] = await tx
        .update(users)
        .set({
          balance: sql`${users.balance} + ${params.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.telegramId, params.telegramId))
        .returning({ balance: users.balance });
      if (!updatedUser) throw new Error('REFERRAL_CREDIT_USER_NOT_FOUND');

      await tx.insert(walletTransactions).values({
        id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        telegramId: params.telegramId,
        amount: params.amount,
        balanceAfter: updatedUser.balance,
        type: params.type,
        referenceId: params.referenceId,
        description: params.description,
      });
      if (hasSavepoint) {
        await tx.execute!(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
      }
      return true;
    } catch (err) {
      if (hasSavepoint) {
        await tx.execute!(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`)).catch(() => undefined);
      }
      if (isUniqueViolation(err)) {
        logger.debug(
          { referenceId: params.referenceId },
          'Idempotent wallet credit already exists'
        );
        return false;
      }
      logger.error({ err, referenceId: params.referenceId }, 'Failed to apply wallet credit');
      throw err;
    }
  }

  async getReferralStats(telegramId: number): Promise<{
    totalInvited: number;
    activeBuyers: number;
    totalReferralBonus: number;
    totalCashback: number;
  }> {
    const db = getDb();
    const [invitedRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.referrerId, telegramId));
    const totalInvited = dbIntegerToSafeNumber(
      invitedRes?.count ?? 0,
      'referral_stats.totalInvited'
    );

    const [activeBuyersRes] = await db
      .select({ count: sql<number>`count(distinct ${users.telegramId})` })
      .from(users)
      .innerJoin(purchaseIntents, eq(users.telegramId, purchaseIntents.telegramId))
      .where(
        and(
          eq(users.referrerId, telegramId),
          eq(purchaseIntents.status, 'completed'),
          isNull(purchaseIntents.refundedAt),
          gt(purchaseIntents.amount, 0)
        )
      );
    const activeBuyers = dbIntegerToSafeNumber(
      activeBuyersRes?.count ?? 0,
      'referral_stats.activeBuyers'
    );

    const [bonusRes] = await db
      .select({ sum: sql<number>`COALESCE(sum(${walletTransactions.amount}), 0)` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.telegramId, telegramId),
          eq(walletTransactions.type, 'referral_bonus')
        )
      );
    const totalReferralBonus = dbIntegerToSafeNumber(
      bonusRes?.sum ?? 0,
      'referral_stats.totalReferralBonus'
    );

    const [cashbackRes] = await db
      .select({ sum: sql<number>`COALESCE(sum(${walletTransactions.amount}), 0)` })
      .from(walletTransactions)
      .where(
        and(eq(walletTransactions.telegramId, telegramId), eq(walletTransactions.type, 'cashback'))
      );
    const totalCashback = dbIntegerToSafeNumber(
      cashbackRes?.sum ?? 0,
      'referral_stats.totalCashback'
    );

    return { totalInvited, activeBuyers, totalReferralBonus, totalCashback };
  }
}

function asPositiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return value;
}

function asPercent(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) return 0;
  return value;
}

/**
 * Integer-exact `amount * percent / 100` without float division or
 * `amount * percent` overflow: split into quotient + remainder parts.
 */
function percentOf(amount: number, percent: number): number {
  const quotient = Math.floor(amount / 100);
  const remainder = amount % 100;
  return quotient * percent + Math.floor((remainder * percent) / 100);
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
