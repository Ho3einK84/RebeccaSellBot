import { describe, expect, it, vi } from 'vitest';
import {
  classifyTelegramDeleteError,
  runScheduledMessageDeletionPass,
} from '../../src/jobs/scheduledMessageDeletion.js';
import type {
  ScheduledMessageDeletionRecord,
  ScheduledMessageDeletionService,
} from '../../src/domain/services/ScheduledMessageDeletionService.js';
import {
  runForAppFallbackNudgeCycle,
  type ForAppFallbackNudgeStore,
} from '../../src/jobs/forappFallbackNudge.js';
import { FORAPP_MANUAL_HINT_DELAY_MS } from '../../src/domain/services/AutomatedPaymentService.js';
import { deleteOrderTelegramMessages } from '../../src/telegram/features/admin/adminNotifications.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';

function makeDueRow(
  overrides: Partial<ScheduledMessageDeletionRecord> = {}
): ScheduledMessageDeletionRecord {
  const now = new Date('2026-11-24T08:00:00Z');
  return {
    id: 'smd_1',
    chatId: 55555,
    messageId: 401,
    reason: 'payment_card',
    deleteAt: new Date(now.getTime() - 60_000),
    status: 'pending',
    attempts: 0,
    lastError: null,
    processedAt: null,
    createdAt: new Date(now.getTime() - 3_600_000),
    updatedAt: new Date(now.getTime() - 3_600_000),
    ...overrides,
  };
}

describe('Scheduled payment message deletion worker & hooks', () => {
  it('classifies Telegram deleteMessage errors accurately', () => {
    expect(
      classifyTelegramDeleteError({
        error_code: 400,
        description: 'Bad Request: message to delete not found',
      }).disposition
    ).toBe('already_deleted');
    expect(classifyTelegramDeleteError(new Error('MESSAGE_ID_INVALID')).disposition).toBe(
      'already_deleted'
    );

    expect(
      classifyTelegramDeleteError({
        error_code: 400,
        description: "Bad Request: message can't be deleted",
      }).disposition
    ).toBe('permanent_failure');
    expect(
      classifyTelegramDeleteError({
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }).disposition
    ).toBe('permanent_failure');
    expect(classifyTelegramDeleteError(new Error('Bad Request: chat not found')).disposition).toBe(
      'permanent_failure'
    );

    expect(
      classifyTelegramDeleteError({
        error_code: 429,
        description: 'Too Many Requests: retry after 5',
      }).disposition
    ).toBe('retryable');
    expect(classifyTelegramDeleteError(new Error('ECONNRESET')).disposition).toBe('retryable');
  });

  it('processes due rows, handles permanent/transient errors, and records outcomes cleanly', async () => {
    const dueRows = [
      makeDueRow({ id: 'smd_ok', chatId: 101, messageId: 11 }),
      makeDueRow({ id: 'smd_gone', chatId: 102, messageId: 12 }),
      makeDueRow({ id: 'smd_old', chatId: 103, messageId: 13 }),
      makeDueRow({ id: 'smd_retry', chatId: 104, messageId: 14 }),
      makeDueRow({ id: 'smd_exhausted', chatId: 105, messageId: 15, attempts: 4 }),
    ];

    const service = {
      listDue: vi.fn(async () => dueRows),
      markDeleted: vi.fn(async () => {}),
      markAttemptFailed: vi.fn(async (id: string, _err: string, opts: { retryable: boolean }) => {
        if (!opts.retryable || id === 'smd_exhausted') return 'failed';
        return 'pending';
      }),
    } as unknown as ScheduledMessageDeletionService;

    const telegramApi = {
      deleteMessage: vi.fn(async (_chatId: number, msgId: number) => {
        if (msgId === 11) return true;
        if (msgId === 12) {
          throw { error_code: 400, description: 'Bad Request: message to delete not found' };
        }
        if (msgId === 13) {
          throw {
            error_code: 400,
            description: "Bad Request: message can't be deleted for everyone",
          };
        }
        if (msgId === 14 || msgId === 15) {
          throw { error_code: 429, description: 'Too Many Requests: retry after 3' };
        }
        return true;
      }),
    };

    const summary = await runScheduledMessageDeletionPass({
      service,
      telegramApi,
      now: () => new Date('2026-11-24T08:00:00Z'),
    });

    expect(summary).toEqual({
      scanned: 5,
      deleted: 1,
      alreadyDeleted: 1,
      failed: 2,
      retried: 1,
    });
    expect(service.markDeleted).toHaveBeenCalledTimes(2);
    expect(service.markAttemptFailed).toHaveBeenCalledWith(
      'smd_old',
      expect.stringContaining("message can't be deleted"),
      expect.objectContaining({ retryable: false })
    );
    expect(service.markAttemptFailed).toHaveBeenCalledWith(
      'smd_retry',
      expect.stringContaining('Too Many Requests'),
      expect.objectContaining({ retryable: true })
    );
  });

  it('cancels scheduled deletion when deleteOrderTelegramMessages deletes a message', async () => {
    const deleteMessage = vi.fn(async () => true);
    const cancelForMessage = vi.fn(async () => true);

    await deleteOrderTelegramMessages(
      { deleteMessage },
      55555,
      JSON.stringify({ telegramMessageIds: [901, 902] }),
      [],
      { cancelForMessage } as unknown as ScheduledMessageDeletionService
    );

    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(cancelForMessage).toHaveBeenCalledWith(55555, 901);
    expect(cancelForMessage).toHaveBeenCalledWith(55555, 902);
  });

  it('schedules ForApp fallback nudge deletion when auto-delete hours setting > 0', async () => {
    const now = new Date('2026-11-24T08:00:00Z');
    const ts = new TranslationService();
    vi.spyOn(ts, 'getSetting').mockImplementation((key, fallback = '') => {
      if (key === 'forapp_enabled') return 'true';
      if (key === 'payment_message_auto_delete_hours') return '6';
      return fallback;
    });

    const store: ForAppFallbackNudgeStore = {
      listCandidates: vi.fn(async () => [
        {
          id: 'po_nudge_1',
          telegramId: 55555,
          payableAmount: 50_000,
          metadata: null,
          createdAt: new Date(now.getTime() - FORAPP_MANUAL_HINT_DELAY_MS - 10_000),
          expiresAt: new Date(now.getTime() + 600_000),
          locale: 'en',
        },
      ]),
      claimManualHint: vi.fn(async () => true),
      recordSentMessageId: vi.fn(async () => {}),
    };

    const scheduleIfEnabled = vi.fn(async () => null);
    await runForAppFallbackNudgeCycle(
      {
        translationService: ts,
        telegramApi: {
          sendMessage: vi.fn(async () => ({ message_id: 777 }) as never),
        },
        store,
        scheduledMessageDeletionService: {
          scheduleIfEnabled,
        } as unknown as ScheduledMessageDeletionService,
      },
      now
    );

    expect(scheduleIfEnabled).toHaveBeenCalledWith(ts, {
      chatId: 55555,
      messageId: 777,
      reason: 'payment_info',
      now,
    });
  });
});
