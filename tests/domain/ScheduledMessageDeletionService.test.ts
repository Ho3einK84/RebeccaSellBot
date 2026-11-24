import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS,
  PAYMENT_MESSAGE_AUTO_DELETE_MIN_HOURS,
  paymentMessageAutoDeleteHours,
} from '../../src/domain/services/FeatureSettings.js';
import { ScheduledMessageDeletionService } from '../../src/domain/services/ScheduledMessageDeletionService.js';
import { getDb } from '../../src/infra/db.js';
import { scheduledMessageDeletions } from '../../src/infra/schema.js';
import { validateAdminSetting } from '../../src/telegram/conversations/adminConversations/settings/validation.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

describe('ScheduledMessageDeletionService & auto-delete settings', () => {
  const getDbMock = vi.mocked(getDb);
  let service: ScheduledMessageDeletionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScheduledMessageDeletionService();
  });

  it('enforces 0..48 hour bounds and normalizes Persian digits on payment_message_auto_delete_hours', () => {
    expect(PAYMENT_MESSAGE_AUTO_DELETE_MIN_HOURS).toBe(0);
    expect(PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS).toBe(48);

    const reader = (val?: string) => ({
      getSetting: vi.fn((k: string, fallback = '') =>
        k === 'payment_message_auto_delete_hours' && val !== undefined ? val : fallback
      ),
    });

    expect(paymentMessageAutoDeleteHours(reader(undefined), 0)).toBe(0);
    expect(paymentMessageAutoDeleteHours(reader('0'), 0)).toBe(0);
    expect(paymentMessageAutoDeleteHours(reader('12'), 0)).toBe(12);
    expect(paymentMessageAutoDeleteHours(reader('۶'), 0)).toBe(6);
    expect(paymentMessageAutoDeleteHours(reader('48'), 0)).toBe(48);
    expect(paymentMessageAutoDeleteHours(reader('72'), 0)).toBe(0);
    expect(paymentMessageAutoDeleteHours(reader('-5'), 0)).toBe(0);
    expect(paymentMessageAutoDeleteHours(reader('abc'), 0)).toBe(0);

    expect(validateAdminSetting('payment_message_auto_delete_hours', '0')).toBe('0');
    expect(validateAdminSetting('payment_message_auto_delete_hours', '۱۲')).toBe('12');
    expect(validateAdminSetting('payment_message_auto_delete_hours', '48')).toBe('48');
    expect(validateAdminSetting('payment_message_auto_delete_hours', '49')).toBeUndefined();
    expect(validateAdminSetting('payment_message_auto_delete_hours', '-1')).toBeUndefined();
    expect(validateAdminSetting('payment_message_auto_delete_hours', 'abc')).toBeUndefined();
  });

  it('skips scheduling when disabled or given invalid IDs, and upserts valid schedules', async () => {
    const now = new Date('2026-11-24T08:00:00Z');
    const disabledSettings = {
      getSetting: vi.fn((_k: string, fallback = '') => (fallback === '0' ? '0' : '0')),
    };
    const disabledRes = await service.scheduleIfEnabled(disabledSettings, {
      chatId: 55555,
      messageId: 100,
      reason: 'payment_card',
      now,
    });
    expect(disabledRes).toBeNull();
    expect(getDbMock).not.toHaveBeenCalled();

    const expectedRow = {
      id: 'smd_row_1',
      chatId: 55555,
      messageId: 100,
      reason: 'forapp_invoice',
      deleteAt: new Date(now.getTime() + 12 * 3_600_000),
      status: 'pending',
      attempts: 0,
      lastError: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const mockDb = createMockDb({ returningResults: [[expectedRow]] });
    getDbMock.mockReturnValue(mockDb.db as never);

    const enabledSettings = {
      getSetting: vi.fn((key: string, fallback = '') =>
        key === 'payment_message_auto_delete_hours' ? '12' : fallback
      ),
    };
    const created = await service.scheduleIfEnabled(enabledSettings, {
      chatId: 55555,
      messageId: 100,
      reason: 'forapp_invoice',
      now,
    });

    expect(created).toEqual(expectedRow);
    expect(mockDb.state.insertCalls).toHaveLength(1);
    expect(mockDb.state.insertCalls[0]?.table).toBe(scheduledMessageDeletions);
    expect(mockDb.state.insertCalls[0]?.onConflict).toBe('update');

    // Invalid IDs are rejected safely before touching DB
    expect(
      await service.scheduleDeletion({
        chatId: 0,
        messageId: 10,
        reason: 'payment_card',
        delayHours: 1,
      })
    ).toBeNull();
    expect(
      await service.scheduleDeletion({
        chatId: 55555,
        messageId: 0,
        reason: 'payment_card',
        delayHours: 1,
      })
    ).toBeNull();
  });

  it('cancels pending deletions, lists due deletions, marks deleted, and records failures', async () => {
    const now = new Date('2026-11-24T09:00:00Z');
    const mockDb = createMockDb({
      returningResults: [[{ id: 'smd_1' }], [], [{ status: 'failed' }], [{ status: 'pending' }]],
      selectResults: [
        [
          {
            id: 'smd_due',
            chatId: 55555,
            messageId: 200,
            reason: 'payment_card',
            deleteAt: now,
            status: 'pending',
            attempts: 0,
            lastError: null,
            processedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(mockDb.db as never);

    expect(await service.cancelForMessage(55555, 200, now)).toBe(true);
    expect(await service.cancelForMessage(55555, 999, now)).toBe(false);
    expect(await service.cancelForMessage(55555, -1, now)).toBe(false);

    const due = await service.listDue(now, 50);
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe('smd_due');

    await service.markDeleted('smd_due', now, 'removed');
    expect(await service.markAttemptFailed('smd_2', 'blocked', { retryable: false, now })).toBe(
      'failed'
    );
    expect(await service.markAttemptFailed('smd_3', '429', { retryable: true, now })).toBe(
      'pending'
    );
  });
});
