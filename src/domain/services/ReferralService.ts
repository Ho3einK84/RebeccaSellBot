/**
 * ReferralService owns referral-code resolution and retry-safe referral/cashback
 * credits. WalletService owns the purchase saga and invokes this service only
 * after its purchase transaction has completed.
 */
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import { users, walletTransactions } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { TranslationService } from './TranslationService.js';

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

  async processCompletedPurchase(
    telegramId: number,
    amount: number,
    intentId: string
  ): Promise<void> {
    const db = getDb();
    const userList = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (userList.length === 0) return;
    const user = userList[0]!;

    if (user.referrerId && user.referrerId !== telegramId) {
      // Find the first committed purchase, rather than assuming this callback
      // arrives in purchase order. If an earlier callback was interrupted, a
      // later successful purchase still settles the one eligible bonus.
      const [firstPurchase] = await db
        .select({ intentId: walletTransactions.referenceId })
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.telegramId, telegramId),
            eq(walletTransactions.type, 'purchase'),
            // A 100% promotional purchase has a zero debit. It is a valid
            // config issuance but must not be used to farm a paid referral
            // reward; the first actual debit remains eligible later.
            lt(walletTransactions.amount, 0)
          )
        )
        .orderBy(asc(walletTransactions.createdAt), asc(walletTransactions.id))
        .limit(1);

      if (firstPurchase?.intentId) {
        const bonusAmount = asPositiveSafeInteger(
          this.translationService.getSettingNum('referral_bonus_toman', 10000)
        );
        const referenceId = `ref_bonus_${firstPurchase.intentId}`;
        if (bonusAmount > 0) {
          const awarded = await this.creditWallet({
            telegramId: user.referrerId,
            amount: bonusAmount,
            type: 'referral_bonus',
            referenceId,
            description: `Referral bonus for user ${telegramId}`,
          });
          if (awarded) {
            logger.info(
              { referrerId: user.referrerId, bonusAmount, referenceId },
              'Referral bonus awarded'
            );
          }
        }
      }
    }

    const cashbackPercent = asPercent(this.translationService.getSettingNum('cashback_percent', 0));
    const purchaseAmount = asPositiveSafeInteger(amount);
    if (cashbackPercent <= 0 || purchaseAmount <= 0) return;

    // Divide first so a malformed-but-finite setting cannot overflow a JS
    // safe integer. The percentage is constrained to 0–100.
    const cashbackAmount = Math.floor((purchaseAmount / 100) * cashbackPercent);
    if (cashbackAmount <= 0) return;

    const referenceId = `cashback_${intentId}`;
    const awarded = await this.creditWallet({
      telegramId,
      amount: cashbackAmount,
      type: 'cashback',
      referenceId,
      description: `Cashback ${cashbackPercent}% for purchase ${intentId}`,
    });
    if (awarded) {
      logger.info({ telegramId, cashbackAmount, referenceId }, 'Cashback awarded');
    }
  }

  /**
   * Credit a wallet exactly once. The ledger's unique reference ID is the
   * idempotency key. A concurrent retry that races after the pre-check may hit
   * the unique constraint; PostgreSQL rolls back its balance update together
   * with the failed insert, so no duplicate credit can escape. Unexpected
   * failures propagate so the durable reconciliation retry can see them.
   */
  private async creditWallet(params: {
    telegramId: number;
    amount: number;
    type: 'referral_bonus' | 'cashback';
    referenceId: string;
    description: string;
  }): Promise<boolean> {
    const db = getDb();
    try {
      return await db.transaction(async (tx) => {
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
      });
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
