import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { scheduledMessageDeletions, type ScheduledDeletionStatus } from '../../infra/schema.js';
import {
  PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS,
  paymentMessageAutoDeleteHours,
  type SettingReader,
} from './FeatureSettings.js';

export type ScheduledDeletionReason =
  'payment_card' | 'forapp_invoice' | 'nowpayments_invoice' | 'payment_info';

export const MAX_SCHEDULED_DELETION_ATTEMPTS = 5;

export interface ScheduledMessageDeletionRecord {
  id: string;
  chatId: number;
  messageId: number;
  reason: string;
  deleteAt: Date;
  status: ScheduledDeletionStatus;
  attempts: number;
  lastError: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleDeletionInput {
  chatId: number;
  messageId: number;
  reason: ScheduledDeletionReason;
  delayHours: number;
  now?: Date;
}

export interface ScheduleIfEnabledInput {
  chatId: number;
  messageId: number;
  reason: ScheduledDeletionReason;
  now?: Date;
}

function mapRow(
  row: typeof scheduledMessageDeletions.$inferSelect
): ScheduledMessageDeletionRecord {
  return {
    id: row.id,
    chatId: row.chatId,
    messageId: row.messageId,
    reason: row.reason,
    deleteAt: row.deleteAt,
    status: row.status as ScheduledDeletionStatus,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    processedAt: row.processedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Persists and manages delayed Telegram message deletions (used for payment /
 * card-number messages so sensitive payment instructions auto-expire safely).
 */
export class ScheduledMessageDeletionService {
  /**
   * Schedule a Telegram message for deletion `delayHours` from `now`.
   * Re-scheduling the same `(chatId, messageId)` resets its status/timer via upsert.
   * Returns `null` when `delayHours <= 0` or identifiers are invalid.
   */
  async scheduleDeletion(
    input: ScheduleDeletionInput
  ): Promise<ScheduledMessageDeletionRecord | null> {
    if (!Number.isSafeInteger(input.chatId) || input.chatId === 0) return null;
    if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) return null;
    if (!Number.isFinite(input.delayHours) || input.delayHours <= 0) return null;

    const clampedHours = Math.min(
      PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS,
      Math.max(1, Math.trunc(input.delayHours))
    );
    const now = input.now ?? new Date();
    const deleteAt = new Date(now.getTime() + clampedHours * 3_600_000);

    const [row] = await getDb()
      .insert(scheduledMessageDeletions)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        reason: input.reason,
        deleteAt,
        status: 'pending',
        attempts: 0,
        lastError: null,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [scheduledMessageDeletions.chatId, scheduledMessageDeletions.messageId],
        set: {
          reason: input.reason,
          deleteAt,
          status: 'pending',
          attempts: 0,
          lastError: null,
          processedAt: null,
          updatedAt: now,
        },
      })
      .returning();

    return row ? mapRow(row) : null;
  }

  /** Convenience helper reading `payment_message_auto_delete_hours` from settings. */
  async scheduleIfEnabled(
    settings: SettingReader,
    input: ScheduleIfEnabledInput
  ): Promise<ScheduledMessageDeletionRecord | null> {
    const hours = paymentMessageAutoDeleteHours(settings, 0);
    if (hours <= 0) return null;
    return this.scheduleDeletion({
      ...input,
      delayHours: hours,
    });
  }

  /** Cancel a pending deletion (e.g. if the user dismissed the message early). */
  async cancelForMessage(chatId: number, messageId: number, now = new Date()): Promise<boolean> {
    if (!Number.isSafeInteger(chatId) || chatId === 0) return false;
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return false;

    const updated = await getDb()
      .update(scheduledMessageDeletions)
      .set({
        status: 'cancelled',
        processedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledMessageDeletions.chatId, chatId),
          eq(scheduledMessageDeletions.messageId, messageId),
          eq(scheduledMessageDeletions.status, 'pending')
        )
      )
      .returning({ id: scheduledMessageDeletions.id });

    return updated.length > 0;
  }

  /** Fetch due pending deletion jobs ordered oldest-due first. */
  async listDue(now = new Date(), limit = 100): Promise<ScheduledMessageDeletionRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await getDb()
      .select()
      .from(scheduledMessageDeletions)
      .where(
        and(
          eq(scheduledMessageDeletions.status, 'pending'),
          lte(scheduledMessageDeletions.deleteAt, now)
        )
      )
      .orderBy(asc(scheduledMessageDeletions.deleteAt))
      .limit(safeLimit);

    return rows.map(mapRow);
  }

  /** Mark a scheduled deletion as completed (either deleted now or already missing). */
  async markDeleted(id: string, now = new Date(), note: string | null = null): Promise<void> {
    await getDb()
      .update(scheduledMessageDeletions)
      .set({
        status: 'deleted',
        lastError: note ? note.slice(0, 500) : null,
        processedAt: now,
        updatedAt: now,
      })
      .where(eq(scheduledMessageDeletions.id, id));
  }

  /** Record a failed deletion attempt and transition to `'failed'` when non-retryable or exhausted. */
  async markAttemptFailed(
    id: string,
    errorMessage: string,
    options: { retryable: boolean; now?: Date; maxAttempts?: number }
  ): Promise<'pending' | 'failed'> {
    const now = options.now ?? new Date();
    const maxAttempts = options.maxAttempts ?? MAX_SCHEDULED_DELETION_ATTEMPTS;
    const summary = errorMessage.slice(0, 500) || 'UNKNOWN_ERROR';

    const nextStatusExpr = options.retryable
      ? sql<string>`CASE WHEN ${scheduledMessageDeletions.attempts} + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END`
      : sql<string>`'failed'`;

    const nextProcessedExpr = options.retryable
      ? sql<Date | null>`CASE WHEN ${scheduledMessageDeletions.attempts} + 1 >= ${maxAttempts} THEN ${now} ELSE NULL END`
      : sql<Date | null>`${now}`;

    const [updated] = await getDb()
      .update(scheduledMessageDeletions)
      .set({
        attempts: sql`${scheduledMessageDeletions.attempts} + 1`,
        status: nextStatusExpr,
        lastError: summary,
        processedAt: nextProcessedExpr,
        updatedAt: now,
      })
      .where(eq(scheduledMessageDeletions.id, id))
      .returning({ status: scheduledMessageDeletions.status });

    return updated?.status === 'failed' ? 'failed' : 'pending';
  }
}
