import crypto from 'node:crypto';
import { and, asc, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  broadcastJobs,
  broadcastRecipients,
  purchaseIntents,
  userConfigs,
  users,
} from '../../infra/schema.js';

export const BROADCAST_AUDIENCES = [
  'all',
  'active_subscription',
  'no_subscription',
  'no_purchase_30d',
  'no_active_subscription',
] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];
export type BroadcastJob = typeof broadcastJobs.$inferSelect;

const RUNNABLE_STATUSES = ['queued', 'running', 'cancel_requested'] as const;
const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Durable audience snapshots and progress state for Telegram broadcasts. */
export class BroadcastService {
  async countAudience(audience: BroadcastAudience): Promise<number> {
    const [row] = await getDb()
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.isBanned, false), audienceCondition(audience)));
    return row?.value ?? 0;
  }

  async createJob(params: {
    actorTelegramId: number;
    audience: BroadcastAudience;
    message: string;
  }): Promise<BroadcastJob> {
    assertMessage(params.message);
    const db = getDb();
    const jobId = crypto.randomUUID();
    return db.transaction(async (tx) => {
      await tx.insert(broadcastJobs).values({
        id: jobId,
        actorTelegramId: params.actorTelegramId,
        audience: params.audience,
        message: params.message,
        status: 'queued',
      });

      const condition = audienceCondition(params.audience);
      await tx.execute(sql`
        INSERT INTO ${broadcastRecipients} (
          "job_id",
          "telegram_id",
          "status",
          "attempts",
          "updated_at"
        )
        SELECT
          ${jobId}::uuid,
          ${users.telegramId},
          'pending',
          0,
          NOW()
        FROM ${users}
        WHERE ${users.isBanned} = false AND ${condition}
        ON CONFLICT DO NOTHING
      `);

      const [recipientRow] = await tx
        .select({ value: count() })
        .from(broadcastRecipients)
        .where(eq(broadcastRecipients.jobId, jobId));
      const recipientCount = recipientRow?.value ?? 0;
      const terminal = recipientCount === 0;
      const [job] = await tx
        .update(broadcastJobs)
        .set({
          recipientCount,
          status: terminal ? 'completed' : 'queued',
          completedAt: terminal ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(broadcastJobs.id, jobId))
        .returning();
      if (!job) throw new Error('BROADCAST_JOB_CREATE_FAILED');

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.actorTelegramId,
        action: 'broadcast_queued',
        entityType: 'broadcast',
        entityId: jobId,
        metadata: JSON.stringify({
          audience: params.audience,
          recipientCount,
          messageLength: params.message.length,
        }),
      });
      return job;
    });
  }

  async getJob(jobId: string): Promise<BroadcastJob | undefined> {
    const [job] = await getDb()
      .select()
      .from(broadcastJobs)
      .where(eq(broadcastJobs.id, jobId))
      .limit(1);
    return job;
  }

  async nextRunnableJob(): Promise<BroadcastJob | undefined> {
    const [job] = await getDb()
      .select()
      .from(broadcastJobs)
      .where(inArray(broadcastJobs.status, RUNNABLE_STATUSES))
      .orderBy(asc(broadcastJobs.createdAt))
      .limit(1);
    return job;
  }

  async markRunning(jobId: string): Promise<BroadcastJob | undefined> {
    const now = new Date();
    const [updated] = await getDb()
      .update(broadcastJobs)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'queued')))
      .returning();
    if (updated) return updated;
    return this.getJob(jobId);
  }

  async requestCancel(jobId: string, actorTelegramId: number): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [job] = await tx
        .update(broadcastJobs)
        .set({ status: 'cancel_requested', updatedAt: new Date() })
        .where(
          and(eq(broadcastJobs.id, jobId), inArray(broadcastJobs.status, ['queued', 'running']))
        )
        .returning({ id: broadcastJobs.id });
      if (!job) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'broadcast_cancel_requested',
        entityType: 'broadcast',
        entityId: jobId,
      });
      return true;
    });
  }

  async requeueStaleClaims(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
    const rows = await getDb()
      .update(broadcastRecipients)
      .set({ status: 'pending', claimedAt: null, updatedAt: now })
      .where(
        and(eq(broadcastRecipients.status, 'sending'), lt(broadcastRecipients.claimedAt, cutoff))
      )
      .returning({ telegramId: broadcastRecipients.telegramId });
    return rows.length;
  }

  async claimBatch(jobId: string, requestedLimit = 20): Promise<number[]> {
    const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 100));
    const db = getDb();
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ telegramId: broadcastRecipients.telegramId })
        .from(broadcastRecipients)
        .where(and(eq(broadcastRecipients.jobId, jobId), eq(broadcastRecipients.status, 'pending')))
        .orderBy(asc(broadcastRecipients.telegramId))
        .limit(limit);
      if (candidates.length === 0) return [];
      const ids = candidates.map((row) => row.telegramId);
      const claimed = await tx
        .update(broadcastRecipients)
        .set({
          status: 'sending',
          attempts: sql`${broadcastRecipients.attempts} + 1`,
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(broadcastRecipients.jobId, jobId),
            eq(broadcastRecipients.status, 'pending'),
            inArray(broadcastRecipients.telegramId, ids)
          )
        )
        .returning({ telegramId: broadcastRecipients.telegramId });
      return claimed.map((row) => row.telegramId);
    });
  }

  async markRecipientSent(jobId: string, telegramId: number): Promise<boolean> {
    return this.finishRecipient(jobId, telegramId, 'sent');
  }

  async markRecipientFailed(jobId: string, telegramId: number, error: unknown): Promise<boolean> {
    return this.finishRecipient(jobId, telegramId, 'failed', errorMessage(error));
  }

  async finalizeCompleted(jobId: string): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [remaining] = await tx
        .select({ value: count() })
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.jobId, jobId),
            inArray(broadcastRecipients.status, ['pending', 'sending'])
          )
        );
      if ((remaining?.value ?? 0) > 0) return false;
      const [job] = await tx
        .update(broadcastJobs)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'running')))
        .returning({ actorTelegramId: broadcastJobs.actorTelegramId });
      if (!job) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: job.actorTelegramId,
        action: 'broadcast_completed',
        entityType: 'broadcast',
        entityId: jobId,
      });
      return true;
    });
  }

  async finalizeCancelled(jobId: string): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select({ actorTelegramId: broadcastJobs.actorTelegramId })
        .from(broadcastJobs)
        .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'cancel_requested')))
        .limit(1);
      if (!job) return false;

      const [remaining] = await tx
        .select({ value: count() })
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.jobId, jobId),
            inArray(broadcastRecipients.status, ['pending', 'sending'])
          )
        );
      // Cancellation can race the final delivery batch. If nothing remains,
      // report the truthful terminal state: the broadcast actually completed.
      if ((remaining?.value ?? 0) === 0) {
        const [completed] = await tx
          .update(broadcastJobs)
          .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'cancel_requested')))
          .returning({ id: broadcastJobs.id });
        if (!completed) return false;
        await tx.insert(auditLogs).values({
          id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          actorTelegramId: job.actorTelegramId,
          action: 'broadcast_completed',
          entityType: 'broadcast',
          entityId: jobId,
          metadata: JSON.stringify({ cancellationArrivedAfterDelivery: true }),
        });
        return true;
      }

      await tx
        .update(broadcastRecipients)
        .set({ status: 'cancelled', claimedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(broadcastRecipients.jobId, jobId),
            inArray(broadcastRecipients.status, ['pending', 'sending'])
          )
        );
      const [updated] = await tx
        .update(broadcastJobs)
        .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'cancel_requested')))
        .returning({ id: broadcastJobs.id });
      if (!updated) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: job.actorTelegramId,
        action: 'broadcast_cancelled',
        entityType: 'broadcast',
        entityId: jobId,
      });
      return true;
    });
  }

  private async finishRecipient(
    jobId: string,
    telegramId: number,
    status: 'sent' | 'failed',
    lastError?: string
  ): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [recipient] = await tx
        .update(broadcastRecipients)
        .set({
          status,
          sentAt: status === 'sent' ? new Date() : null,
          claimedAt: null,
          lastError: lastError?.slice(0, 1_000) ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(broadcastRecipients.jobId, jobId),
            eq(broadcastRecipients.telegramId, telegramId),
            eq(broadcastRecipients.status, 'sending')
          )
        )
        .returning({ telegramId: broadcastRecipients.telegramId });
      if (!recipient) return false;
      await tx
        .update(broadcastJobs)
        .set({
          ...(status === 'sent'
            ? { sentCount: sql`${broadcastJobs.sentCount} + 1` }
            : { failedCount: sql`${broadcastJobs.failedCount} + 1` }),
          updatedAt: new Date(),
        })
        .where(eq(broadcastJobs.id, jobId));
      return true;
    });
  }
}

function audienceCondition(audience: BroadcastAudience) {
  switch (audience) {
    case 'all':
      return sql`TRUE`;
    case 'active_subscription':
      return sql`EXISTS (
        SELECT 1 FROM ${userConfigs}
        WHERE ${userConfigs.telegramId} = ${users.telegramId}
          AND ${userConfigs.panelStatus} = 'active'
      )`;
    case 'no_subscription':
      return sql`NOT EXISTS (
        SELECT 1 FROM ${userConfigs}
        WHERE ${userConfigs.telegramId} = ${users.telegramId}
      )`;
    case 'no_purchase_30d':
      return sql`NOT EXISTS (
        SELECT 1 FROM ${purchaseIntents}
        WHERE ${purchaseIntents.telegramId} = ${users.telegramId}
          AND ${purchaseIntents.status} = 'completed'
          AND ${purchaseIntents.createdAt} >= NOW() - INTERVAL '30 days'
      )`;
    case 'no_active_subscription':
      return sql`EXISTS (
          SELECT 1 FROM ${userConfigs}
          WHERE ${userConfigs.telegramId} = ${users.telegramId}
        ) AND NOT EXISTS (
          SELECT 1 FROM ${userConfigs}
          WHERE ${userConfigs.telegramId} = ${users.telegramId}
            AND ${userConfigs.panelStatus} = 'active'
        )`;
  }
  const exhaustive: never = audience;
  throw new Error(`Unsupported broadcast audience: ${String(exhaustive)}`);
}

function assertMessage(message: string): void {
  const length = [...message].length;
  if (length === 0 || length > 4_096) throw new Error('INVALID_BROADCAST_MESSAGE');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
