/**
 * WalletService — handles balances, top-ups, atomic purchase sagas, and post-purchase bonuses.
 *
 * Financial integrity principles:
 *  - Integer minor-units for all amounts (Toman/Rial)
 *  - Strict saga pattern for purchase/renewal:
 *      1. In one DB transaction, insert a `pending` intent and reserve funds
 *         (`balance - reserved_balance >= amount`).
 *      3. Call Rebecca API (with Cloudflare 521 resilience built into RebeccaService/RebeccaApiClient)
 *      4. On API success: DB transaction -> debit wallet (`WHERE balance >= amount`),
 *         mark intent `completed`, write `wallet_transactions` audit log, bind `user_configs`.
 *      5. On API failure: mark intent `failed`, rethrow error (so UI can report "not charged, origin down").
 *      6. On DB commit failure after API success: compensate (delete user from API if new_config),
 *         mark intent `failed`.
 *  - Centralized & Idempotent bonus processing:
 *      - Referral bonus: paid to referrer on first completed purchase only.
 *      - Cashback: auto-credited to buyer's wallet.
 *      - Both use deterministic `referenceId` (`ref_bonus_<intentId>`, `cashback_<intentId>`)
 *        backed by `wallet_transactions.reference_id` UNIQUE constraint to guarantee idempotency.
 */

import { and, count, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  users,
  walletTransactions,
  topupReceipts,
  userConfigs,
  auditLogs,
} from '../../infra/schema.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { SupportedLocale, TranslationService } from './TranslationService.js';
import type { ReferralService } from './ReferralService.js';
import type { PromoService } from './PromoService.js';
import { dbIntegerToSafeNumber } from './DbNumber.js';
import crypto from 'crypto';
import { WalletPurchaseSaga } from './WalletPurchaseSaga.js';
import type { RebeccaService } from './RebeccaService.js';
import { isRebeccaPanelRegistryAccess, normalizeRebeccaPanelAccess } from './RebeccaPanelAccess.js';

import {
  PendingTopupReceiptError,
  type AdminBalanceAdjustment,
  type DashboardStats,
  type PurchaseSagaParams,
  type PurchaseSagaResult,
} from './WalletContracts.js';
import {
  assertAdminBalanceAdjustment,
  assertPositiveSafeInteger,
  sanitizeRegistrationSource,
} from './WalletSupport.js';

export {
  ADMIN_BALANCE_OPERATIONS,
  PendingTopupReceiptError,
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from './WalletContracts.js';
export type {
  AdminBalanceAdjustment,
  AdminBalanceOperation,
  DashboardStats,
  PurchaseSagaParams,
  PurchaseSagaResult,
} from './WalletContracts.js';

export class WalletService {
  private readonly purchaseSaga: WalletPurchaseSaga;

  constructor(
    panels: RebeccaPanelRegistry | RebeccaService,
    private translationService: TranslationService,
    private referralService: ReferralService,
    promoService: PromoService
  ) {
    this.purchaseSaga = new WalletPurchaseSaga(
      normalizeRebeccaPanelAccess(panels),
      referralService,
      promoService,
      isRebeccaPanelRegistryAccess(panels)
    );
  }
  async getOrCreateUser(
    telegramId: number,
    username?: string,
    firstName?: string,
    lastName?: string,
    referralCode?: string,
    locale?: SupportedLocale,
    registrationSource = 'telegram'
  ) {
    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (existing.length > 0) {
      const current = existing[0]!;
      const changes: {
        username?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        locale?: SupportedLocale;
        lastSeenAt: Date;
        updatedAt: Date;
      } = {
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      };
      const nextUsername = username ?? null;
      const nextFirstName = firstName ?? null;
      const nextLastName = lastName ?? null;
      if (current.username !== nextUsername) changes.username = nextUsername;
      if (current.firstName !== nextFirstName) changes.firstName = nextFirstName;
      if (current.lastName !== nextLastName) changes.lastName = nextLastName;
      if (locale && !current.localeManual && current.locale !== locale) changes.locale = locale;

      const [updated] = await db
        .update(users)
        .set(changes)
        .where(eq(users.telegramId, telegramId))
        .returning();
      return updated ?? current;
    }

    // The full stored code—not a Telegram ID parsed out of the payload—is
    // verified by ReferralService. An existing user's referrer never changes.
    const validReferrer = await this.referralService.resolveReferrerId(referralCode, telegramId);

    // Multiple /start updates can arrive concurrently. The primary-key
    // conflict is handled by selecting the winner; the highly unlikely random
    // referral-code collision is retried without ever changing its referrer.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const refCode = `ref_${telegramId}_${crypto.randomBytes(8).toString('hex')}`;
      const [newUser] = await db
        .insert(users)
        .values({
          telegramId,
          username: username ?? null,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          balance: 0,
          // Telegram does not always supply a language code on a user's first
          // update. Persist the configured product default in that case so
          // background notifications use the same locale as the live UI.
          locale: locale ?? this.translationService.resolveLocale(),
          registrationSource: sanitizeRegistrationSource(registrationSource),
          referralCode: refCode,
          referrerId: validReferrer ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (newUser) return newUser;

      const [winner] = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      if (winner) return winner;
    }

    throw new Error('USER_CREATE_CONFLICT');
  }

  async getBalance(telegramId: number): Promise<number> {
    const db = getDb();
    const res = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    return res.length > 0 ? res[0]!.balance : 0;
  }

  /** Backward-compatible set operation used by older admin entry points. */
  async setBalanceAdmin(
    telegramId: number,
    newBalance: number,
    adminId: number,
    description: string
  ): Promise<number> {
    return this.adjustBalanceAdmin({
      telegramId,
      operation: 'set',
      amount: newBalance,
      adminId,
      description,
    });
  }

  /**
   * Perform an administrator wallet operation and write its immutable audit
   * record in the same transaction. The row lock serializes concurrent admin
   * actions with purchase reservations, so no operation can set/deduct below
   * the amount currently reserved by an in-flight purchase.
   */
  async adjustBalanceAdmin(params: AdminBalanceAdjustment): Promise<number> {
    assertAdminBalanceAdjustment(params);
    const db = getDb();
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.telegramId, params.telegramId))
        .for('update')
        .limit(1);
      if (!user) throw new Error('ADMIN_BALANCE_USER_NOT_FOUND');

      const targetBalance =
        params.operation === 'add'
          ? user.balance + params.amount
          : params.operation === 'deduct'
            ? user.balance - params.amount
            : params.amount;
      if (!Number.isSafeInteger(targetBalance) || targetBalance < user.reservedBalance) {
        throw new Error('ADMIN_BALANCE_BELOW_RESERVED');
      }

      const diff = targetBalance - user.balance;
      if (diff === 0) return user.balance;

      const [updated] = await tx
        .update(users)
        .set({ balance: targetBalance, updatedAt: new Date() })
        .where(eq(users.telegramId, params.telegramId))
        .returning();
      if (!updated) throw new Error('ADMIN_BALANCE_UPDATE_FAILED');

      const txId = `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await tx.insert(walletTransactions).values({
        id: txId,
        telegramId: params.telegramId,
        amount: diff,
        balanceAfter: targetBalance,
        type: 'admin_adjustment',
        description: `Admin ${params.adminId}: ${params.operation}; ${params.description}`,
      });
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.adminId,
        action: `wallet_${params.operation}`,
        entityType: 'user_wallet',
        entityId: String(params.telegramId),
        targetTelegramId: params.telegramId,
        metadata: JSON.stringify({
          amount: params.amount,
          previousBalance: user.balance,
          balanceAfter: targetBalance,
        }),
      });

      return updated.balance;
    });
  }

  // Top-up approval by admin
  async approveTopup(
    receiptId: string,
    adminId: number
  ): Promise<{ telegramId: number; amount: number } | null> {
    const db = getDb();
    let result: { telegramId: number; amount: number } | null = null;
    await db.transaction(async (tx) => {
      const [rec] = await tx
        .update(topupReceipts)
        .set({ status: 'approved', reviewedBy: adminId, updatedAt: new Date() })
        .where(
          sql`${topupReceipts.id} = ${receiptId}
            AND ${topupReceipts.status} = 'pending'
            AND ${topupReceipts.amount} > 0`
        )
        .returning();
      if (!rec) return;

      const updatedUsers = await tx
        .update(users)
        .set({ balance: sql`${users.balance} + ${rec.amount}`, updatedAt: new Date() })
        .where(eq(users.telegramId, rec.telegramId))
        .returning();

      const txId = `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await tx.insert(walletTransactions).values({
        id: txId,
        telegramId: rec.telegramId,
        amount: rec.amount,
        balanceAfter: updatedUsers[0]!.balance,
        type: 'topup',
        referenceId: receiptId,
        description: `Top-up receipt approved by admin ${adminId}`,
      });
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: adminId,
        action: 'topup_receipt_approved',
        entityType: 'topup_receipt',
        entityId: rec.id,
        targetTelegramId: rec.telegramId,
        metadata: JSON.stringify({ amount: rec.amount }),
      });

      result = { telegramId: rec.telegramId, amount: rec.amount };
    });
    return result;
  }

  async getPendingReceiptForUser(telegramId: number) {
    const db = getDb();
    const [pending] = await db
      .select()
      .from(topupReceipts)
      .where(and(eq(topupReceipts.telegramId, telegramId), eq(topupReceipts.status, 'pending')))
      .limit(1);
    return pending ?? null;
  }

  async submitTopupReceipt(
    telegramId: number,
    amount: number,
    photoFileId: string
  ): Promise<string> {
    assertPositiveSafeInteger(amount, 'INVALID_TOPUP_AMOUNT');
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !photoFileId.trim()) {
      throw new Error('INVALID_TOPUP_RECEIPT');
    }

    const receiptId = `rec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await getDb().transaction(async (tx) => {
      // Serialize submissions per wallet owner. This prevents two bot workers
      // from accepting duplicate pending receipts for the same user.
      const [owner] = await tx
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .for('update')
        .limit(1);
      if (!owner) throw new Error('USER_NOT_FOUND');
      const [pending] = await tx
        .select({ id: topupReceipts.id })
        .from(topupReceipts)
        .where(and(eq(topupReceipts.telegramId, telegramId), eq(topupReceipts.status, 'pending')))
        .limit(1);
      if (pending) throw new PendingTopupReceiptError(pending.id);
      await tx.insert(topupReceipts).values({
        id: receiptId,
        telegramId,
        amount,
        photoFileId,
        status: 'pending',
      });
    });
    return receiptId;
  }

  async rejectTopup(receiptId: string, adminId: number): Promise<{ telegramId: number } | null> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [rejected] = await tx
        .update(topupReceipts)
        .set({ status: 'rejected', reviewedBy: adminId, updatedAt: new Date() })
        .where(sql`${topupReceipts.id} = ${receiptId} AND ${topupReceipts.status} = 'pending'`)
        .returning({ id: topupReceipts.id, telegramId: topupReceipts.telegramId });
      if (!rejected) return null;

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: adminId,
        action: 'topup_receipt_rejected',
        entityType: 'topup_receipt',
        entityId: rejected.id,
        targetTelegramId: rejected.telegramId,
      });
      return { telegramId: rejected.telegramId };
    });
  }

  async listPendingTopups(limit = 5) {
    const db = getDb();
    return db
      .select()
      .from(topupReceipts)
      .where(eq(topupReceipts.status, 'pending'))
      .orderBy(desc(topupReceipts.createdAt))
      .limit(limit);
  }

  async listPendingTopupsPage(
    page = 1,
    pageSize = 4
  ): Promise<{
    items: Array<typeof topupReceipts.$inferSelect>;
    total: number;
    page: number;
    totalPages: number;
  }> {
    const safePage = Math.max(1, Math.trunc(page));
    const safePageSize = Math.max(1, Math.min(Math.trunc(pageSize), 10));
    const db = getDb();
    const [[totalRow], items] = await Promise.all([
      db.select({ value: count() }).from(topupReceipts).where(eq(topupReceipts.status, 'pending')),
      db
        .select()
        .from(topupReceipts)
        .where(eq(topupReceipts.status, 'pending'))
        .orderBy(desc(topupReceipts.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
    ]);
    const total = Number(totalRow?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    if (safePage > totalPages) return this.listPendingTopupsPage(totalPages, safePageSize);
    return { items, total, page: safePage, totalPages };
  }

  async getPendingTopup(receiptId: string) {
    const [receipt] = await getDb()
      .select()
      .from(topupReceipts)
      .where(and(eq(topupReceipts.id, receiptId), eq(topupReceipts.status, 'pending')))
      .limit(1);
    return receipt;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const db = getDb();
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const purchaseSum = (since?: Date) =>
      db
        .select({ value: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)` })
        .from(walletTransactions)
        .where(
          since
            ? sql`${walletTransactions.type} = 'purchase' AND ${walletTransactions.createdAt} >= ${since}`
            : eq(walletTransactions.type, 'purchase')
        );
    const [
      [userCount],
      [purchaseTotal],
      [dailyRevenue],
      [weeklyRevenue],
      [monthlyRevenue],
      [referralTotal],
      [cashbackTotal],
      [activeSubscriptions],
      [inactiveSubscriptions],
      [pendingReceipts],
    ] = await Promise.all([
      db.select({ value: count() }).from(users),
      purchaseSum(),
      purchaseSum(dayStart),
      purchaseSum(weekStart),
      purchaseSum(monthStart),
      db
        .select({ value: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)` })
        .from(walletTransactions)
        .where(eq(walletTransactions.type, 'referral_bonus')),
      db
        .select({ value: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)` })
        .from(walletTransactions)
        .where(eq(walletTransactions.type, 'cashback')),
      db
        .select({ value: sql<number>`COALESCE(SUM(${users.activeSubscriptionCount}), 0)` })
        .from(users),
      db
        .select({ value: count() })
        .from(userConfigs)
        .where(
          sql`${userConfigs.panelStatus} IS NOT NULL AND ${userConfigs.panelStatus} <> 'active'`
        ),
      db.select({ value: count() }).from(topupReceipts).where(eq(topupReceipts.status, 'pending')),
    ]);
    return {
      totalUsers: dbIntegerToSafeNumber(userCount?.value ?? 0, 'dashboard_total_users'),
      totalSales: Math.abs(
        dbIntegerToSafeNumber(purchaseTotal?.value ?? 0, 'dashboard_total_sales')
      ),
      dailyRevenue: Math.abs(
        dbIntegerToSafeNumber(dailyRevenue?.value ?? 0, 'dashboard_daily_revenue')
      ),
      weeklyRevenue: Math.abs(
        dbIntegerToSafeNumber(weeklyRevenue?.value ?? 0, 'dashboard_weekly_revenue')
      ),
      monthlyRevenue: Math.abs(
        dbIntegerToSafeNumber(monthlyRevenue?.value ?? 0, 'dashboard_monthly_revenue')
      ),
      totalReferralBonus: dbIntegerToSafeNumber(
        referralTotal?.value ?? 0,
        'dashboard_referral_bonus'
      ),
      totalCashback: dbIntegerToSafeNumber(cashbackTotal?.value ?? 0, 'dashboard_cashback'),
      activeSubscriptions: dbIntegerToSafeNumber(
        activeSubscriptions?.value ?? 0,
        'dashboard_active_subscriptions'
      ),
      inactiveSubscriptions: dbIntegerToSafeNumber(
        inactiveSubscriptions?.value ?? 0,
        'dashboard_inactive_subscriptions'
      ),
      pendingReceipts: dbIntegerToSafeNumber(
        pendingReceipts?.value ?? 0,
        'dashboard_pending_receipts'
      ),
    };
  }

  // Purchase orchestration lives in WalletPurchaseSaga so balance/top-up
  // operations stay independent from remote mutation/reconciliation logic.
  async executePurchaseSaga(params: PurchaseSagaParams): Promise<PurchaseSagaResult> {
    return this.purchaseSaga.execute(params);
  }
}
