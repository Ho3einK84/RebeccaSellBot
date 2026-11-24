import cron from 'node-cron';
import type { ScheduledMessageDeletionService } from '../domain/services/ScheduledMessageDeletionService.js';
import { logger } from '../infra/logger.js';
import { jobRunner, type JobRunner } from './workerRuntime.js';

export interface ScheduledMessageDeletionApi {
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
}

export type TelegramDeleteErrorDisposition = 'already_deleted' | 'permanent_failure' | 'retryable';

export interface ClassifiedTelegramDeleteError {
  disposition: TelegramDeleteErrorDisposition;
  summary: string;
}

export interface ScheduledMessageDeletionDeps {
  service: ScheduledMessageDeletionService;
  telegramApi: ScheduledMessageDeletionApi;
  now?: () => Date;
  batchSize?: number;
}

export interface ScheduledMessageDeletionPassSummary {
  scanned: number;
  deleted: number;
  alreadyDeleted: number;
  failed: number;
  retried: number;
}

/**
 * Classify a Telegram `deleteMessage` failure so already-deleted or permanently
 * non-deletable messages (e.g. >48h old or blocked bot) terminate cleanly
 * without noisy infinite retry loops, while rate-limit / 5xx errors retry up
 * to the attempt cap.
 */
export function classifyTelegramDeleteError(err: unknown): ClassifiedTelegramDeleteError {
  const errObj =
    typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : undefined;
  const errorCode =
    errObj && typeof errObj.error_code === 'number' && Number.isFinite(errObj.error_code)
      ? errObj.error_code
      : undefined;
  const description =
    errObj && typeof errObj.description === 'string' ? errObj.description.trim() : '';
  const baseMessage = err instanceof Error ? err.message : String(err ?? '');
  const combined = [description, baseMessage].filter(Boolean).join(' ').trim();
  const lower = combined.toLowerCase();
  const summary = errorCode !== undefined ? `[${errorCode}] ${combined}` : combined || 'UNKNOWN';

  if (
    lower.includes('message to delete not found') ||
    lower.includes('message_id_invalid') ||
    lower.includes('message not found')
  ) {
    return { disposition: 'already_deleted', summary };
  }

  if (
    errorCode === 403 ||
    lower.includes("message can't be deleted") ||
    lower.includes('message cant be deleted') ||
    lower.includes('chat not found') ||
    lower.includes('bot was blocked') ||
    lower.includes('user is deactivated') ||
    lower.includes('chat_write_forbidden') ||
    lower.includes('peer_id_invalid') ||
    lower.includes('forbidden')
  ) {
    return { disposition: 'permanent_failure', summary };
  }

  return { disposition: 'retryable', summary };
}

/**
 * Execute one background sweep deleting every due pending payment/card message.
 */
export async function runScheduledMessageDeletionPass(
  deps: ScheduledMessageDeletionDeps
): Promise<ScheduledMessageDeletionPassSummary> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const batchSize = deps.batchSize ?? 100;

  const summary: ScheduledMessageDeletionPassSummary = {
    scanned: 0,
    deleted: 0,
    alreadyDeleted: 0,
    failed: 0,
    retried: 0,
  };

  let dueRows;
  try {
    dueRows = await deps.service.listDue(now, batchSize);
  } catch (err) {
    logger.error({ err }, 'Scheduled message deletion: failed to list due deletions');
    return summary;
  }

  summary.scanned = dueRows.length;

  for (const row of dueRows) {
    const attemptNow = nowFn();
    try {
      await deps.telegramApi.deleteMessage(row.chatId, row.messageId);
      await deps.service.markDeleted(row.id, attemptNow);
      summary.deleted += 1;
    } catch (err) {
      const classified = classifyTelegramDeleteError(err);
      if (classified.disposition === 'already_deleted') {
        await deps.service.markDeleted(row.id, attemptNow, classified.summary).catch(() => {});
        summary.alreadyDeleted += 1;
      } else if (classified.disposition === 'permanent_failure') {
        await deps.service
          .markAttemptFailed(row.id, classified.summary, { retryable: false, now: attemptNow })
          .catch(() => {});
        summary.failed += 1;
        logger.debug(
          { chatId: row.chatId, messageId: row.messageId, error: classified.summary },
          'Scheduled message deletion: message cannot be deleted permanently'
        );
      } else {
        const nextStatus = await deps.service
          .markAttemptFailed(row.id, classified.summary, { retryable: true, now: attemptNow })
          .catch(() => 'pending' as const);
        if (nextStatus === 'failed') {
          summary.failed += 1;
        } else {
          summary.retried += 1;
        }
        logger.warn(
          {
            chatId: row.chatId,
            messageId: row.messageId,
            nextStatus,
            error: classified.summary,
          },
          'Scheduled message deletion: transient error deleting payment message'
        );
      }
    }
  }

  return summary;
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startScheduledMessageDeletionJob(
  deps: ScheduledMessageDeletionDeps & { runner?: JobRunner; schedule?: string }
): void {
  stopScheduledMessageDeletionJob();
  const schedule = deps.schedule ?? '* * * * *';
  const runner = deps.runner ?? jobRunner;

  const run = async (): Promise<void> => {
    try {
      await runner.run('scheduled-message-deletion', async () => {
        await runScheduledMessageDeletionPass(deps);
      });
    } catch (err) {
      logger.error({ err }, 'Scheduled message deletion cron worker failed');
    }
  };

  task = cron.schedule(schedule, () => {
    void run();
  });
  logger.info({ schedule }, 'Scheduled payment message deletion worker started (every minute)');
}

export function stopScheduledMessageDeletionJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
