import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, getPool } from '../../src/infra/db.js';
import { scheduledMessageDeletions, userConfigs } from '../../src/infra/schema.js';
import { ScheduledMessageDeletionService } from '../../src/domain/services/ScheduledMessageDeletionService.js';
import { ConfigService } from '../../src/domain/services/ConfigService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

describeIntegration('PostgreSQL integration — Payment auto-delete schedule & user_label', () => {
  registerIntegrationLifecycleHooks();

  const userId = 9_100_001;
  const otherUserId = 9_100_002;

  beforeEach(async () => {
    await seedIntegrationUser(userId, { locale: 'fa' });
    await seedIntegrationUser(otherUserId, { locale: 'en' });
  });

  it('persists, deduplicates, cancels, lists due, and retries scheduled_message_deletions with constraints', async () => {
    const deletionService = new ScheduledMessageDeletionService();
    const baseTime = new Date('2026-11-24T00:00:00Z');

    const first = await deletionService.scheduleDeletion({
      chatId: userId,
      messageId: 7001,
      reason: 'payment_card',
      delayHours: 6,
      now: baseTime,
    });
    expect(first).not.toBeNull();
    expect(first?.status).toBe('pending');
    expect(first?.deleteAt.getTime()).toBe(baseTime.getTime() + 6 * 3_600_000);

    // Upsert on same (chatId, messageId) replaces due time without duplicate rows
    const updated = await deletionService.scheduleDeletion({
      chatId: userId,
      messageId: 7001,
      reason: 'forapp_invoice',
      delayHours: 2,
      now: baseTime,
    });
    expect(updated?.id).toBe(first?.id);
    expect(updated?.reason).toBe('forapp_invoice');
    expect(updated?.deleteAt.getTime()).toBe(baseTime.getTime() + 2 * 3_600_000);

    await deletionService.scheduleDeletion({
      chatId: userId,
      messageId: 7002,
      reason: 'nowpayments_invoice',
      delayHours: 12,
      now: baseTime,
    });

    const dueAtThreeHours = await deletionService.listDue(
      new Date(baseTime.getTime() + 3 * 3_600_000)
    );
    expect(dueAtThreeHours.map((r) => r.messageId)).toEqual([7001]);

    expect(
      await deletionService.markAttemptFailed(first!.id, 'Transient 429', {
        retryable: true,
        now: baseTime,
      })
    ).toBe('pending');
    expect(
      await deletionService.markAttemptFailed(first!.id, 'Permanent 403', {
        retryable: false,
        now: baseTime,
      })
    ).toBe('failed');

    expect(await deletionService.cancelForMessage(userId, 7002, baseTime)).toBe(true);
    const dueAfterCancel = await deletionService.listDue(
      new Date(baseTime.getTime() + 24 * 3_600_000)
    );
    expect(dueAfterCancel).toEqual([]);

    // Database CHECK constraints reject invalid message_id or status
    await expect(
      getPool().query(
        `INSERT INTO scheduled_message_deletions (chat_id, message_id, reason, delete_at, status)
         VALUES ($1, 0, 'payment_card', NOW(), 'pending')`,
        [userId]
      )
    ).rejects.toThrow();

    await expect(
      getPool().query(`UPDATE scheduled_message_deletions SET status = 'bogus' WHERE id = $1`, [
        first!.id,
      ])
    ).rejects.toThrow();

    const rows = await getDb()
      .select()
      .from(scheduledMessageDeletions)
      .where(eq(scheduledMessageDeletions.chatId, userId));
    expect(rows).toHaveLength(2);
  });

  it('persists sanitized user_label without altering config_username and enforces length/blank CHECK constraints', async () => {
    const db = getDb();
    await db.insert(userConfigs).values({
      id: 'uc_int_label_1',
      telegramId: userId,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'u9100001_1',
      subUrl: 'https://panel.example/sub/u9100001_1',
    });

    const mockRebeccaUpdate = vi.fn();
    const configService = new ConfigService(
      { updateUser: mockRebeccaUpdate } as never,
      { getSetting: vi.fn() } as unknown as TranslationService
    );

    const saved = await configService.setUserLabel(userId, 'uc_int_label_1', '  گوشی\u200cمن  ');
    expect(saved).toEqual({
      id: 'uc_int_label_1',
      configUsername: 'u9100001_1',
      userLabel: 'گوشی\u200cمن',
    });
    expect(mockRebeccaUpdate).not.toHaveBeenCalled();

    // Another user cannot change the label
    const denied = await configService.setUserLabel(otherUserId, 'uc_int_label_1', 'hijack');
    expect(denied).toBeNull();

    // DB CHECK constraint rejects blank whitespace or >40 characters
    await expect(
      getPool().query(`UPDATE user_configs SET user_label = '   ' WHERE id = 'uc_int_label_1'`)
    ).rejects.toThrow();

    await expect(
      getPool().query(`UPDATE user_configs SET user_label = $1 WHERE id = 'uc_int_label_1'`, [
        'x'.repeat(41),
      ])
    ).rejects.toThrow();

    // Clearing restores NULL
    const cleared = await configService.setUserLabel(userId, 'uc_int_label_1', null);
    expect(cleared?.userLabel).toBeNull();
  });
});
