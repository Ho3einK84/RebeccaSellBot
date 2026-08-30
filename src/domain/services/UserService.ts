import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  topupReceipts,
  userConfigs,
  users,
  walletTransactions,
} from '../../infra/schema.js';
import type { SupportedLocale } from './TranslationService.js';
import { dbIntegerToSafeNumber } from './DbNumber.js';

export type LocalUserProfile = typeof users.$inferSelect & {
  transactionCount: number;
  referredUserCount: number;
  referralBonusEarned: number;
  cashbackEarned: number;
};

export type UserLocale = SupportedLocale;

export type UserInvalidationHook = (telegramId: number) => void;

/** Domain access to Telegram-account state, including administrative lookups. */
export class UserService {
  private invalidationHooks: UserInvalidationHook[] = [];

  registerInvalidationHook(hook: UserInvalidationHook): void {
    this.invalidationHooks.push(hook);
  }

  private notifyInvalidation(telegramId: number): void {
    for (const hook of this.invalidationHooks) {
      try {
        hook(telegramId);
      } catch {
        // hook errors must not prevent domain return
      }
    }
  }

  async isBanned(telegramId: number): Promise<boolean> {
    const db = getDb();
    const [user] = await db
      .select({ isBanned: users.isBanned })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    return user?.isBanned ?? false;
  }

  /**
   * Omnisearch: Find a user profile by Telegram ID, UUID, username (exact or partial),
   * display name, Rebecca config username, subscription link, topup receipt ID,
   * or transaction ID.
   */
  async findProfile(rawQuery: string): Promise<LocalUserProfile | null> {
    const db = getDb();
    const query = rawQuery.trim().replace(/^@/, '');
    if (!query) return null;
    const parsedTelegramId = /^\d+$/.test(query) ? Number(query) : Number.NaN;
    const telegramId = Number.isSafeInteger(parsedTelegramId) ? parsedTelegramId : null;
    const normalizedUuid = isUuid(query) ? query.toLowerCase() : undefined;

    // 1. Direct search on users table by ID, UUID, or exact username
    let [user] = await db
      .select()
      .from(users)
      .where(
        telegramId !== null
          ? eq(users.telegramId, telegramId)
          : normalizedUuid
            ? eq(users.id, normalizedUuid)
            : sql`LOWER(${users.username}) = LOWER(${query})`
      )
      .limit(1);

    // 2. Search on user_configs table by exact subUrl or configUsername
    if (!user) {
      const [owner] = await db
        .select({ telegramId: userConfigs.telegramId })
        .from(userConfigs)
        .where(
          /^https?:\/\//iu.test(rawQuery.trim())
            ? eq(userConfigs.subUrl, rawQuery.trim())
            : sql`LOWER(${userConfigs.configUsername}) = LOWER(${query})`
        )
        .limit(1);
      if (owner) {
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.telegramId, owner.telegramId))
          .limit(1);
      }
    }

    // 3. Search on topup_receipts table by receipt ID
    if (!user && (query.startsWith('rec_') || query.length >= 6)) {
      const [receipt] = await db
        .select({ telegramId: topupReceipts.telegramId })
        .from(topupReceipts)
        .where(
          sql`LOWER(${topupReceipts.id}) = LOWER(${query}) OR LOWER(${topupReceipts.id}) = LOWER(${'rec_' + query})`
        )
        .limit(1);
      if (receipt) {
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.telegramId, receipt.telegramId))
          .limit(1);
      }
    }

    // 4. Search on wallet_transactions by referenceId or transaction ID
    if (!user && (query.startsWith('tx_') || query.startsWith('ref_') || query.length >= 6)) {
      const [txRow] = await db
        .select({ telegramId: walletTransactions.telegramId })
        .from(walletTransactions)
        .where(
          sql`LOWER(${walletTransactions.id}) = LOWER(${query}) OR LOWER(${walletTransactions.referenceId}) = LOWER(${query})`
        )
        .limit(1);
      if (txRow) {
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.telegramId, txRow.telegramId))
          .limit(1);
      }
    }

    // 5. Fuzzy match on username, firstName, or lastName
    if (!user && query.length >= 2) {
      const pattern = `%${query.toLowerCase()}%`;
      [user] = await db
        .select()
        .from(users)
        .where(
          sql`LOWER(${users.username}) LIKE ${pattern} OR LOWER(${users.firstName}) LIKE ${pattern} OR LOWER(${users.lastName}) LIKE ${pattern}`
        )
        .limit(1);
    }

    if (!user) return null;

    const [[transactionCount], [referredUserCount], [referralBonus], [cashback]] =
      await Promise.all([
        db
          .select({ value: sql<number>`COUNT(*)` })
          .from(walletTransactions)
          .where(eq(walletTransactions.telegramId, user.telegramId)),
        db
          .select({ value: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.referrerId, user.telegramId)),
        db
          .select({ value: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)` })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.telegramId, user.telegramId),
              eq(walletTransactions.type, 'referral_bonus')
            )
          ),
        db
          .select({ value: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)` })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.telegramId, user.telegramId),
              eq(walletTransactions.type, 'cashback')
            )
          ),
      ]);
    return {
      ...user,
      transactionCount: dbIntegerToSafeNumber(
        transactionCount?.value ?? 0,
        'profile_transaction_count'
      ),
      referredUserCount: dbIntegerToSafeNumber(
        referredUserCount?.value ?? 0,
        'profile_referred_user_count'
      ),
      referralBonusEarned: dbIntegerToSafeNumber(
        referralBonus?.value ?? 0,
        'profile_referral_bonus'
      ),
      cashbackEarned: dbIntegerToSafeNumber(cashback?.value ?? 0, 'profile_cashback'),
    };
  }

  async setBanned(
    telegramId: number,
    isBanned: boolean,
    actorTelegramId?: number
  ): Promise<boolean> {
    const db = getDb();
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ isBanned, updatedAt: new Date() })
        .where(eq(users.telegramId, telegramId))
        .returning({ telegramId: users.telegramId });
      if (!row) return false;
      if (actorTelegramId !== undefined) {
        await tx.insert(auditLogs).values({
          id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          actorTelegramId,
          action: isBanned ? 'user_banned' : 'user_unbanned',
          entityType: 'telegram_user',
          entityId: String(telegramId),
          targetTelegramId: telegramId,
        });
      }
      return true;
    });
    if (updated) {
      this.notifyInvalidation(telegramId);
    }
    return updated;
  }

  async recordAdminAction(params: {
    actorTelegramId: number;
    action: string;
    entityType: string;
    entityId: string;
    targetTelegramId?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await getDb()
      .insert(auditLogs)
      .values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.actorTelegramId,
        action: params.action.slice(0, 100),
        entityType: params.entityType.slice(0, 100),
        entityId: params.entityId.slice(0, 200),
        targetTelegramId: params.targetTelegramId,
        metadata: params.metadata ? JSON.stringify(params.metadata).slice(0, 4_000) : null,
      });
  }

  async listAuditForUser(telegramId: number, limit = 10) {
    return getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetTelegramId, telegramId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.max(1, Math.min(limit, 50)));
  }

  /** Persist an explicit language choice from the bot's language menu. */
  async updateLocale(telegramId: number, locale: UserLocale): Promise<void> {
    const db = getDb();
    const result = await db
      .update(users)
      .set({ locale, localeManual: true, updatedAt: new Date() })
      .where(eq(users.telegramId, telegramId))
      .returning({ telegramId: users.telegramId });
    if (result.length > 0) {
      this.notifyInvalidation(telegramId);
    }
  }

  /**
   * Keep the initial Telegram app locale in sync only until a user chooses a
   * language from the bot menu.
   */
  async updateObservedLocale(telegramId: number, locale: UserLocale): Promise<void> {
    const db = getDb();
    const result = await db
      .update(users)
      .set({ locale, updatedAt: new Date() })
      .where(
        and(
          eq(users.telegramId, telegramId),
          eq(users.localeManual, false),
          ne(users.locale, locale)
        )
      )
      .returning({ telegramId: users.telegramId });
    if (result.length > 0) {
      this.notifyInvalidation(telegramId);
    }
  }

  /** Returns a stored locale when the Telegram account has been seen by the bot. */
  async getLocale(telegramId: number): Promise<UserLocale | undefined> {
    const db = getDb();
    const [user] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    return user?.locale === 'en' ? 'en' : user?.locale === 'fa' ? 'fa' : undefined;
  }

  async exists(telegramId: number): Promise<boolean> {
    const db = getDb();
    const [user] = await db
      .select({ telegramId: users.telegramId })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    return user !== undefined;
  }

  async listRecipientIds(): Promise<number[]> {
    const db = getDb();
    const recipients = await db.select({ telegramId: users.telegramId }).from(users);
    return recipients.map((user) => user.telegramId);
  }

  async listUsers(
    page = 1,
    limit = 6
  ): Promise<{
    users: Array<typeof users.$inferSelect>;
    total: number;
    page: number;
    totalPages: number;
  }> {
    const db = getDb();
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * limit;

    const [[totalRow], items] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    ]);

    const total = totalRow?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (safePage > totalPages) return this.listUsers(totalPages, limit);

    return {
      users: items,
      total,
      page: safePage,
      totalPages,
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
