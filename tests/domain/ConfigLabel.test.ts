import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigLabelValidationError,
  ConfigService,
  MAX_CONFIG_USER_LABEL_LENGTH,
  sanitizeConfigUserLabel,
} from '../../src/domain/services/ConfigService.js';
import { ConfigTransferService } from '../../src/domain/services/ConfigTransferService.js';
import { RebeccaWebhookService } from '../../src/domain/services/RebeccaWebhookService.js';
import {
  formatConfigButtonTitle,
  formatTelegramConfigRef,
} from '../../src/domain/services/TelegramFormatting.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { getDb, getPool } from '../../src/infra/db.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('Service personal labels (user_label)', () => {
  const getDbMock = vi.mocked(getDb);
  const getPoolMock = vi.mocked(getPool);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes user labels while preserving Persian ZWNJ and enforcing the 40-char limit', () => {
    expect(MAX_CONFIG_USER_LABEL_LENGTH).toBe(40);
    expect(sanitizeConfigUserLabel(null)).toEqual({ valid: true, value: null });
    expect(sanitizeConfigUserLabel(undefined)).toEqual({ valid: true, value: null });
    expect(sanitizeConfigUserLabel('   \n\t  ')).toEqual({ valid: true, value: null });

    // Preserves ZWNJ (\u200c), collapses whitespace/newlines, strips bidi override/control chars
    const dirtyPersian = '  گوشی\u200c\u202eشخصی\n\tمن \u200b  \u0007 ';
    expect(sanitizeConfigUserLabel(dirtyPersian)).toEqual({
      valid: true,
      value: 'گوشی\u200cشخصی من',
    });

    const exact40 = 'آ'.repeat(40);
    expect(sanitizeConfigUserLabel(exact40)).toEqual({ valid: true, value: exact40 });

    const exact40Emoji = '🔑'.repeat(40);
    expect(sanitizeConfigUserLabel(exact40Emoji)).toEqual({ valid: true, value: exact40Emoji });

    expect(sanitizeConfigUserLabel('a'.repeat(41))).toEqual({
      valid: false,
      reason: 'too_long',
    });
    expect(sanitizeConfigUserLabel(123 as unknown as string)).toEqual({
      valid: false,
      reason: 'invalid',
    });
  });

  it('formats Telegram config references & compact button titles safely', () => {
    expect(formatTelegramConfigRef('alice_1', null)).toBe('`alice_1`');
    expect(formatTelegramConfigRef('alice_1', '   ')).toBe('`alice_1`');
    expect(formatTelegramConfigRef('alice_1', 'My_Phone *1*')).toBe(
      '`alice_1` (My\\_Phone \\*1\\*)'
    );
    expect(formatTelegramConfigRef('alice`2', 'خانه')).toBe('`alice2` (خانه)');

    expect(formatConfigButtonTitle('alice_1', null, 28)).toBe('alice_1');
    expect(formatConfigButtonTitle('alice_1', 'Phone', 28)).toBe('Phone (alice_1)');
    expect(
      [...formatConfigButtonTitle('very_long_username_here', 'My Very Long Personal Label', 20)]
        .length
    ).toBeLessThanOrEqual(20);
  });

  it('updates only user_label locally without mutating configUsername or touching Rebecca panel API', async () => {
    const ownedRow = {
      id: 'uc_cfg_1',
      telegramId: 55555,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'u55555_1',
      userLabel: null,
      subUrl: 'https://sub.example/u55555_1',
    };
    const updatedRow = {
      id: 'uc_cfg_1',
      configUsername: 'u55555_1',
      userLabel: 'لپ‌تاپ کاری',
    };

    const mockDb = createMockDb({
      selectResults: [[ownedRow]],
      returningResults: [[updatedRow]],
    });
    getDbMock.mockReturnValue(mockDb.db as never);

    const rebeccaUpdateUser = vi.fn();
    const service = new ConfigService(
      { updateUser: rebeccaUpdateUser, getUser: vi.fn() } as never,
      { getSetting: vi.fn() } as never
    );

    const saved = await service.setUserLabel(55555, 'uc_cfg_1', '  لپ\u200cتاپ\nکاری  ');
    expect(saved).toEqual(updatedRow);
    expect(rebeccaUpdateUser).not.toHaveBeenCalled();
    expect(mockDb.state.updateCalls).toHaveLength(1);
    expect(mockDb.state.updateCalls[0]?.set).toMatchObject({ userLabel: 'لپ‌تاپ کاری' });
    expect(mockDb.state.updateCalls[0]?.set).not.toHaveProperty('configUsername');

    await expect(service.setUserLabel(55555, 'uc_cfg_1', 'x'.repeat(41))).rejects.toBeInstanceOf(
      ConfigLabelValidationError
    );
  });

  it('clears user_label when service ownership is transferred', async () => {
    const client = {
      query: vi.fn(async (sqlText: string) => {
        if (sqlText.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sqlText.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);

    const configRow = {
      id: 'uc_cfg_1',
      telegramId: 1001,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'u1001_1',
      userLabel: 'My Private Tag',
      autoRenewEnabled: true,
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };

    const rebeccaUpdateUser = vi.fn().mockResolvedValue({
      username: 'u1001_1',
      created_at: '2026-01-01T00:00:00Z',
    });
    const rebeccaGetUser = vi.fn().mockResolvedValue({
      username: 'u1001_1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      subscription_url: 'https://sub.example/u1001_1',
      subscription_urls: {},
    });

    const mockDb = createMockDb({
      selectResults: [[{ telegramId: 1002, isBanned: false }], [configRow]],
      returningResults: [[{ configUsername: 'u1001_1' }]],
    });
    getDbMock.mockReturnValue(mockDb.db as never);

    const transferService = new ConfigTransferService({
      getUser: rebeccaGetUser,
      updateUser: rebeccaUpdateUser,
    } as never);

    const result = await transferService.transfer({
      configId: 'uc_cfg_1',
      fromTelegramId: 1001,
      toTelegramId: 1002,
      actorTelegramId: 1001,
    });

    expect(result.toTelegramId).toBe(1002);
    const configUpdate = mockDb.state.updateCalls.find((call) => 'userLabel' in call.set);
    expect(configUpdate?.set.userLabel).toBeNull();
  });

  it('includes userLabel in RebeccaWebhookService user_limited / user_expired notifications', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 99 });
    const mockDb = createMockDb({
      selectResults: [
        [
          {
            configId: 'cfg_1',
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'u1001_1',
            userLabel: 'My Tag',
            telegramId: 1001,
            autoRenewEnabled: false,
            autoRenewPackageId: null,
            autoRenewPrice: null,
            locale: 'en',
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(mockDb.db as never);

    const webhookService = new RebeccaWebhookService({
      panels: {} as never,
      translationService: {
        resolveLocale: vi.fn(() => 'en'),
        get: vi.fn((key: string) => key),
      } as unknown as TranslationService,
      telegramApi: { sendMessage },
    });

    const res = await webhookService.handleWebhook({ username: 'u1001_1', action: 'user_limited' });
    expect(res.statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toContain('`u1001_1` (My Tag)');
  });
});
