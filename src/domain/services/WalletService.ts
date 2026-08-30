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
  type WalletTransferParams,
  type WalletTransferResult,
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
  WalletTransferParams,
  WalletTransferResult,
} from './WalletContracts.js';

export class WalletService {
  private readonly purchaseSaga: WalletPurchaseSaga;
  private readonly userCache = new Map<
    number,
    { user: typeof users.$inferSelect; expiresAt: number }
  >();
  private readonly USER_CACHE_TTL_MS = 60_000; // 60 seconds

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

  public invalidateUserCache(telegramId?: number): void {
    if (telegramId !== undefined) {
      this.userCache.delete(telegramId);
    } else {
      this.userCache.clear();
    }
  }

  private setUserCache(telegramId: number, user: typeof users.$inferSelect): void {
    this.userCache.set(telegramId, {
      user,
      expiresAt: Date.now() + this.USER_CACHE_TTL_MS,
    });
    if (this.userCache.size > 5_000) {
      const oldest = this.userCache.keys().next().value as number | undefined;
      if (oldest !== undefined) this.userCache.delete(oldest);
    }
  }

  async getOrCreateUser(
    telegramId: number,
    username?: string | null,
    firstName?: string | null,
    lastName?: string | null,
    referralCode?: string,
    locale?: SupportedLocale,
    registrationSource = 'telegram'
  ) {
    const now = Date.now();
    const cached = this.userCache.get(telegramId);
    if (cached && now < cached.expiresAt) {
      const current = cached.user;
      const nextUsername = username === undefined ? current.username : username;
      const nextFirstName = firstName === undefined ? current.firstName : firstName;
      const nextLastName = lastName === undefined ? current.lastName : lastName;
      const profileChanged =
        current.username !== nextUsername ||
        current.firstName !== nextFirstName ||
        current.lastName !== nextLastName ||
        Boolean(locale && !current.localeManual && current.locale !== locale);

      if (!profileChanged) {
        return current;
      }
    }

    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (existing.length > 0) {
      const current = existing[0]!;
      const nextUsername = username === undefined ? current.username : username;
      const nextFirstName = firstName === undefined ? current.firstName : firstName;
      const nextLastName = lastName === undefined ? current.lastName : lastName;
      const profileChanged =
        current.username !== nextUsername ||
        current.firstName !== nextFirstName ||
        current.lastName !== nextLastName ||
        Boolean(locale && !current.localeManual && current.locale !== locale);

      const lastSeenMs = current.lastSeenAt ? new Date(current.lastSeenAt).getTime() : 0;
      const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
      const shouldUpdateLastSeen = now - lastSeenMs >= LAST_SEEN_THROTTLE_MS;

      if (!profileChanged && !shouldUpdateLastSeen) {
        this.setUserCache(telegramId, current);
        return current;
      }

      const changes: {
        username?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        locale?: SupportedLocale;
        lastSeenAt?: Date;
        updatedAt: Date;
      } = {
        updatedAt: new Date(now),
      };
      if (current.username !== nextUsername) changes.username = nextUsername;
      if (current.firstName !== nextFirstName) changes.firstName = nextFirstName;
      if (current.lastName !== nextLastName) changes.lastName = nextLastName;
      if (locale && !current.localeManual && current.locale !== locale) changes.locale = locale;
      if (shouldUpdateLastSeen) changes.lastSeenAt = new Date(now);

      const [updated] = await db
        .update(users)
        .set(changes)
        .where(eq(users.telegramId, telegramId))
        .returning();
      const finalUser = updated ?? current;
      this.setUserCache(telegramId, finalUser);
      return finalUser;
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
      if (newUser) {
        this.setUserCache(telegramId, newUser);
        return newUser;
      }

      const [winner] = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      if (winner) {
        this.setUserCache(telegramId, winner);
        return winner;
      }
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

      const auditDescription = `Admin ${params.adminId}: ${params.operation}; ${params.description}`;
      if (params.referenceId) {
        const [existing] = await tx
          .select({
            telegramId: walletTransactions.telegramId,
            amount: walletTransactions.amount,
            balanceAfter: walletTransactions.balanceAfter,
            type: walletTransactions.type,
            description: walletTransactions.description,
          })
          .from(walletTransactions)
          .where(eq(walletTransactions.referenceId, params.referenceId))
          .limit(1);
        if (existing) {
          const expectedAmount =
            params.operation === 'add'
              ? params.amount
              : params.operation === 'deduct'
                ? -params.amount
                : undefined;
          if (
            existing.telegramId !== params.telegramId ||
            existing.type !== 'admin_adjustment' ||
            existing.description !== auditDescription ||
            (expectedAmount !== undefined && existing.amount !== expectedAmount) ||
            (params.operation === 'set' && existing.balanceAfter !== params.amount)
          ) {
            throw new Error('ADMIN_BALANCE_REFERENCE_CONFLICT');
          }
          return existing.balanceAfter;
        }
      }

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
        referenceId: params.referenceId,
        description: auditDescription,
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

      this.invalidateUserCache(params.telegramId);
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

      this.invalidateUserCache(rec.telegramId);
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

  async getPendingReceiptCount(): Promise<number> {
    const [row] = await getDb()
      .select({ value: count() })
      .from(topupReceipts)
      .where(eq(topupReceipts.status, 'pending'));
    return Number(row?.value ?? 0);
  }

  async submitTopupReceipt(
    telegramId: number,
    amount: number,
    photoFileId: string,
    mediaType: 'photo' | 'document' = 'photo'
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
        mediaType,
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
    const IRAN_TZ_OFFSET_MS = 3.5 * 60 * 60 * 1000;
    const tehranNowMs = now.getTime() + IRAN_TZ_OFFSET_MS;
    const tehranDayStartMs = tehranNowMs - (tehranNowMs % (24 * 60 * 60 * 1000));
    const dayStart = new Date(tehranDayStartMs - IRAN_TZ_OFFSET_MS);
    const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
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

  /**
   * Atomically transfer wallet funds from one user to another.
   *
   * Financial integrity guarantees:
   *  - Sender and recipient rows are locked in ascending telegram_id order (FOR UPDATE)
   *    to completely prevent database deadlocks and double-spending.
   *  - Validates balance - reservedBalance >= amount so in-flight purchases are protected.
   *  - Writes immutable auditLog and two wallet_transactions entries (transfer_sent and transfer_received)
   *    in the same database transaction.
   *  - Optional referenceId ensures deterministic idempotent transfers.
   */
  async transferBalance(params: WalletTransferParams): Promise<WalletTransferResult> {
    if (params.fromTelegramId === params.toTelegramId) {
      throw new Error('TRANSFER_TO_SELF');
    }
    assertPositiveSafeInteger(params.amount, 'INVALID_TRANSFER_AMOUNT');

    const db = getDb();
    return db.transaction(async (tx) => {
      // Deterministic lock order by telegramId (ascending) to prevent deadlocks
      const [firstId, secondId] =
        params.fromTelegramId < params.toTelegramId
          ? [params.fromTelegramId, params.toTelegramId]
          : [params.toTelegramId, params.fromTelegramId];

      const [firstUser] = await tx
        .select()
        .from(users)
        .where(eq(users.telegramId, firstId))
        .for('update')
        .limit(1);

      const [secondUser] = await tx
        .select()
        .from(users)
        .where(eq(users.telegramId, secondId))
        .for('update')
        .limit(1);

      const fromUser = firstUser?.telegramId === params.fromTelegramId ? firstUser : secondUser;
      const toUser = firstUser?.telegramId === params.toTelegramId ? firstUser : secondUser;

      if (!fromUser) throw new Error('USER_NOT_FOUND');
      if (fromUser.isBanned) throw new Error('SENDER_BANNED');
      if (!toUser) throw new Error('TRANSFER_TARGET_NOT_FOUND');
      if (toUser.isBanned) throw new Error('TRANSFER_TARGET_BANNED');

      // Check available balance (excluding reserved funds for active purchases)
      const availableBalance = fromUser.balance - fromUser.reservedBalance;
      if (availableBalance < params.amount) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      const fromBalanceAfter = fromUser.balance - params.amount;
      const toBalanceAfter = toUser.balance + params.amount;

      if (!Number.isSafeInteger(fromBalanceAfter) || fromBalanceAfter < 0) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
      if (!Number.isSafeInteger(toBalanceAfter) || toBalanceAfter > 9007199254740991) {
        throw new Error('BALANCE_OVERFLOW');
      }

      const sentRefId = params.referenceId ? `transfer_sent_${params.referenceId}` : undefined;
      const recvRefId = params.referenceId ? `transfer_recv_${params.referenceId}` : undefined;

      if (sentRefId) {
        const [existing] = await tx
          .select({ id: walletTransactions.id })
          .from(walletTransactions)
          .where(eq(walletTransactions.referenceId, sentRefId))
          .limit(1);
        if (existing) {
          throw new Error('TRANSFER_ALREADY_PROCESSED');
        }
      }

      await tx
        .update(users)
        .set({ balance: fromBalanceAfter, updatedAt: new Date() })
        .where(eq(users.telegramId, params.fromTelegramId));

      await tx
        .update(users)
        .set({ balance: toBalanceAfter, updatedAt: new Date() })
        .where(eq(users.telegramId, params.toTelegramId));

      const txIdSender = `tx_ts_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const txIdRecipient = `tx_tr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      const senderDesc = params.description?.trim()
        ? `Transfer to ${params.toTelegramId}: ${params.description.trim()}`
        : `Transfer to ${params.toTelegramId}`;
      const recipientDesc = params.description?.trim()
        ? `Transfer from ${params.fromTelegramId}: ${params.description.trim()}`
        : `Transfer from ${params.fromTelegramId}`;

      await tx.insert(walletTransactions).values({
        id: txIdSender,
        telegramId: params.fromTelegramId,
        amount: -params.amount,
        balanceAfter: fromBalanceAfter,
        type: 'transfer_sent',
        referenceId: sentRefId,
        description: senderDesc,
      });

      await tx.insert(walletTransactions).values({
        id: txIdRecipient,
        telegramId: params.toTelegramId,
        amount: params.amount,
        balanceAfter: toBalanceAfter,
        type: 'transfer_received',
        referenceId: recvRefId,
        description: recipientDesc,
      });

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.fromTelegramId,
        action: 'wallet_transfer',
        entityType: 'user_wallet',
        entityId: String(params.fromTelegramId),
        targetTelegramId: params.toTelegramId,
        metadata: JSON.stringify({
          amount: params.amount,
          fromTelegramId: params.fromTelegramId,
          toTelegramId: params.toTelegramId,
          fromBalanceAfter,
          toBalanceAfter,
          txIdSender,
          txIdRecipient,
        }),
      });

      this.invalidateUserCache(params.fromTelegramId);
      this.invalidateUserCache(params.toTelegramId);

      return {
        success: true,
        fromTelegramId: params.fromTelegramId,
        toTelegramId: params.toTelegramId,
        amount: params.amount,
        fromBalanceAfter,
        toBalanceAfter,
        txIdSender,
        txIdRecipient,
      };
    });
  }

  /**
   * List paginated wallet transactions for a specific user.
   */
  async listTransactionsForUser(
    telegramId: number,
    page = 1,
    pageSize = 5
  ): Promise<{
    transactions: Array<typeof walletTransactions.$inferSelect>;
    total: number;
    totalPages: number;
    page: number;
  }> {
    const db = getDb();
    const [countRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(walletTransactions)
      .where(eq(walletTransactions.telegramId, telegramId));
    const total = Number(countRes?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const rows = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.telegramId, telegramId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(pageSize)
      .offset((safePage - 1) * pageSize);
    return { transactions: rows, total, totalPages, page: safePage };
  }
}
