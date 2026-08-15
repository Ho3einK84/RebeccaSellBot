import crypto from 'node:crypto';
import { asc, count, eq, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { auditLogs, botAdmins } from '../../infra/schema.js';

export class LastAdminRemovalError extends Error {
  constructor() {
    super('LAST_ADMIN_CANNOT_BE_REMOVED');
    this.name = 'LastAdminRemovalError';
  }
}

/**
 * Database-backed administrator registry.
 *
 * ADMIN_IDS remains a disaster-recovery/bootstrap input only: it seeds this
 * table when the table is empty. Once seeded, in-bot add/remove operations are
 * authoritative and survive restarts without rewriting .env.
 */
export class AdminService {
  /** Stable mutable reference retained by BotServices for notification fanout. */
  readonly adminIds: number[] = [];

  async initialize(bootstrapAdminIds: readonly number[]): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72623859790382856)`);
      const [row] = await tx.select({ value: count() }).from(botAdmins);
      if ((row?.value ?? 0) > 0) return;
      if (bootstrapAdminIds.length === 0) throw new Error('ADMIN_BOOTSTRAP_REQUIRED');
      await tx
        .insert(botAdmins)
        .values(bootstrapAdminIds.map((telegramId) => ({ telegramId, addedBy: null })))
        .onConflictDoNothing();
    });
    await this.refreshCache();
  }

  isAdmin(telegramId: number): boolean {
    return this.adminIds.includes(telegramId);
  }

  async listAdmins(): Promise<Array<typeof botAdmins.$inferSelect>> {
    return getDb().select().from(botAdmins).orderBy(asc(botAdmins.createdAt));
  }

  async addAdmin(telegramId: number, actorTelegramId: number): Promise<boolean> {
    assertTelegramId(telegramId);
    const db = getDb();
    const inserted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72623859790382856)`);
      const [row] = await tx
        .insert(botAdmins)
        .values({ telegramId, addedBy: actorTelegramId })
        .onConflictDoNothing()
        .returning({ telegramId: botAdmins.telegramId });
      if (!row) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'admin_added',
        entityType: 'bot_admin',
        entityId: String(telegramId),
        targetTelegramId: telegramId,
      });
      return true;
    });
    if (inserted) await this.refreshCache();
    return inserted;
  }

  async removeAdmin(telegramId: number, actorTelegramId: number): Promise<boolean> {
    assertTelegramId(telegramId);
    const db = getDb();
    const removed = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72623859790382856)`);
      const [row] = await tx.select({ value: count() }).from(botAdmins);
      if ((row?.value ?? 0) <= 1) throw new LastAdminRemovalError();
      const [deleted] = await tx
        .delete(botAdmins)
        .where(eq(botAdmins.telegramId, telegramId))
        .returning({ telegramId: botAdmins.telegramId });
      if (!deleted) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'admin_removed',
        entityType: 'bot_admin',
        entityId: String(telegramId),
        targetTelegramId: telegramId,
      });
      return true;
    });
    if (removed) await this.refreshCache();
    return removed;
  }

  private async refreshCache(): Promise<void> {
    const rows = await getDb()
      .select({ telegramId: botAdmins.telegramId })
      .from(botAdmins)
      .orderBy(asc(botAdmins.createdAt));
    this.adminIds.splice(0, this.adminIds.length, ...rows.map((row) => row.telegramId));
    if (this.adminIds.length === 0) throw new Error('ADMIN_REGISTRY_EMPTY');
  }
}

function assertTelegramId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_TELEGRAM_ID');
}
