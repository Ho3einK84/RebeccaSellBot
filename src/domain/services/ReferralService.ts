/**
 * ReferralService owns referral-code resolution and retry-safe referral/cashback
 * credits. WalletService owns the purchase saga and invokes this service only
 * after its purchase transaction has completed.
 */
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import { purchaseIntents, refundIntents, users, walletTransactions } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { TranslationService } from './TranslationService.js';

export type BonusSnapshot = {
  cashbackPercent: number;
  cashbackAmount: number;
  referrerTelegramId: number | null;
  referralBonusAmount: number;
};

export class ReferralService {
  constructor(private readonly translationService: TranslationService) {}

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
    tx: {
      select: (args?: any) => any;
    },
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
      cashbackPercent > 0 && safeAmount > 0 ? Math.floor((safeAmount / 100) * cashbackPercent) : 0;

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
      // If snapshot is present in row, use it unconditionally (never re-read global settings).
      // For legacy rows where snapshot columns are NULL, calculate safely once or default to 0.
      let referralBonus = intent.referralBonusAmount;
      let referrerId = intent.referrerTelegramId;
      let cashbackAmount = intent.cashbackAmount;
      let cashbackPercent = intent.cashbackPercent;

      if (
        referralBonus === null ||
        referrerId === null ||
        cashbackAmount === null ||
        cashbackPercent === null
      ) {
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
              ? Math.floor((purchaseAmount / 100) * cashbackPercent)
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
          logger.info({ telegramId, cashbackAmount, referenceId }, 'Cashback awarded');
        }
      }

      await tx
        .update(purchaseIntents)
        .set({ bonusesProcessedAt: new Date(), updatedAt: new Date() })
        .where(eq(purchaseIntents.id, intentId));
    });
  }

  /**
   * Credit a wallet exactly once. The ledger's unique reference ID is the
   * idempotency key. A concurrent retry that races after the pre-check may hit
   * the unique constraint; PostgreSQL rolls back its balance update together
   * with the failed insert, so no duplicate credit can escape. Unexpected
   * failures propagate so the durable reconciliation retry can see them.
   */
  private async creditWalletInTransaction(
    tx: {
      select: (args?: any) => any;
      update: (table: any) => any;
      insert: (table: any) => any;
    },
    params: {
      telegramId: number;
      amount: number;
      type: 'referral_bonus' | 'cashback';
      referenceId: string;
      description: string;
    }
  ): Promise<boolean> {
    try {
      const [alreadyCredited] = await tx
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(eq(walletTransactions.referenceId, params.referenceId))
        .limit(1);
      if (alreadyCredited) return false;

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
      return true;
    } catch (err) {
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
}

function asPositiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return value;
}

function asPercent(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) return 0;
  return value;
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
