import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import type { ConfigReconciliationService } from '../../src/domain/services/ConfigReconciliationService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import {
  RebeccaWebhookService,
  type RebeccaWebhookPayload,
  type WebhookTelegramSender,
} from '../../src/domain/services/RebeccaWebhookService.js';
import {
  escapeTelegramMarkdown,
  formatWebhookAlertScreen,
  sanitizeTelegramInlineCode,
} from '../../src/domain/services/TelegramFormatting.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('RebeccaWebhookService & TelegramFormatting', () => {
  const getDbMock = vi.mocked(getDb);
  let telegramSender: { sendMessage: ReturnType<typeof vi.fn> } & WebhookTelegramSender;
  let translationServiceMock: TranslationService;
  let scanMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    telegramSender = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    };
    scanMock = vi
      .fn()
      .mockResolvedValue({ localMissingRemote: 0, remoteUnbound: 0, remoteIgnored: 0 });
    translationServiceMock = {
      resolveLocale: vi.fn().mockReturnValue('fa'),
      t: vi.fn((key: string) => key),
      get: vi.fn((key: string) => key),
    } as unknown as TranslationService;
  });

  function createService(secret?: string, dedupeWindowMs?: number, withRecon = false) {
    return new RebeccaWebhookService({
      panels: {} as unknown as RebeccaPanelRegistry,
      translationService: translationServiceMock,
      telegramApi: telegramSender,
      configReconciliationService: withRecon
        ? ({ scan: scanMock } as unknown as ConfigReconciliationService)
        : undefined,
      secret,
      dedupeWindowMs,
    });
  }

  it('escapes MarkdownV1 characters, strips backticks for inline code, and builds alert screens', () => {
    expect(escapeTelegramMarkdown('vip_user*[v1]`code')).toBe('vip\\_user\\*\\[v1]\\`code');
    expect(sanitizeTelegramInlineCode('my_`inst`_1')).toBe('my_inst_1');
    expect(
      formatWebhookAlertScreen({
        emoji: '⚠️',
        title: 'Title',
        subtitle: 'Sub',
        primary: { emoji: '📱', label: 'Service', value: '`vip\\_1`' },
      })
    ).toBe('⚠️ *Title*\n_Sub_\n\n📱 *Service*\n`vip\\_1`');
  });

  it('verifies timing-safe webhook secrets', () => {
    const guarded = createService('my_webhook_secret_123');
    expect(guarded.verifySecret('my_webhook_secret_123')).toBe(true);
    expect(guarded.verifySecret(['  my_webhook_secret_123  '])).toBe(true);
    expect(guarded.verifySecret(undefined)).toBe(false);
    expect(guarded.verifySecret('wrong_secret')).toBe(false);
    expect(guarded.verifySecret('')).toBe(false);

    const open = createService(undefined);
    expect(open.verifySecret(undefined)).toBe(true);
    expect(open.verifySecret('any_secret')).toBe(true);
  });

  it('rejects unauthorized (401) and malformed (400) webhook payloads', async () => {
    const service = createService('required_secret');
    await expect(
      service.handleWebhook({ username: 'test_user', action: 'user_limited' }, 'wrong_secret')
    ).resolves.toMatchObject({ handled: false, statusCode: 401 });

    const open = createService();
    await expect(
      open.handleWebhook(null as unknown as RebeccaWebhookPayload)
    ).resolves.toMatchObject({ handled: false, statusCode: 400 });
    await expect(
      open.handleWebhook([
        { username: 'valid_user', action: 'user_limited' },
        { action: 'user_expired' } as RebeccaWebhookPayload,
      ])
    ).resolves.toMatchObject({ handled: false, statusCode: 400 });
    await expect(open.handleWebhook([])).resolves.toMatchObject({
      handled: true,
      statusCode: 200,
      matchedConfigs: 0,
    });
    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
  });

  it('alerts users with plain inline keyboard markup, scopes dedupe by panelId, and does not poison cache on failed send', async () => {
    const service = createService('secret_123', 60_000);
    const panelACfg = {
      configId: 'cfg-101',
      panelId: 'panel-a',
      serviceId: 1,
      configUsername: 'vip_user_01',
      telegramId: 987654321,
      autoRenewEnabled: false,
      autoRenewPackageId: null,
      autoRenewPrice: null,
      locale: 'en',
    };
    const panelBCfg = { ...panelACfg, configId: 'cfg-202', panelId: 'panel-b' };

    const mock = createMockDb({
      selectResults: [[], [panelACfg], [panelACfg], [panelACfg], [panelACfg], [panelBCfg]],
    });
    getDbMock.mockReturnValue(mock.db as never);

    // Unknown config returns 200 with 0 matches
    await expect(
      service.handleWebhook({ username: 'missing', action: 'user_limited' }, 'secret_123', 500)
    ).resolves.toMatchObject({ handled: true, statusCode: 200, matchedConfigs: 0 });

    // Failed Telegram delivery must NOT record dedupe entry
    telegramSender.sendMessage.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await expect(
      service.handleWebhook(
        { username: 'vip_user_01', action: 'user_limited', panelId: 'panel-a' },
        'secret_123',
        1_000
      )
    ).resolves.toMatchObject({
      handled: true,
      statusCode: 200,
      matchedConfigs: 1,
      actionsPerformed: [],
    });

    // Retry within dedupe window succeeds and sends!
    const retry = await service.handleWebhook(
      { username: 'vip_user_01', action: 'user_limited', panelId: 'panel-a' },
      'secret_123',
      2_000
    );
    expect(retry.actionsPerformed).toEqual(['notified_user_user_limited:cfg-101']);
    const [chatId, text, options] = telegramSender.sendMessage.mock.calls[1]!;
    expect(chatId).toBe(987654321);
    expect(text).toContain('`vip_user_01`');
    expect(text).not.toContain('\\_');
    expect(options.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'webhook_renew_button', callback_data: 'sub:detail:cfg-101' }]],
    });

    // Duplicate on same panel-a suppressed at 10_000, allowed again after window expires at 70_000
    await service.handleWebhook(
      { username: 'vip_user_01', action: 'user_limited', panelId: 'panel-a' },
      'secret_123',
      10_000
    );
    expect(telegramSender.sendMessage).toHaveBeenCalledTimes(2);

    await service.handleWebhook(
      { username: 'vip_user_01', action: 'user_limited', panelId: 'panel-a' },
      'secret_123',
      70_000
    );
    expect(telegramSender.sendMessage).toHaveBeenCalledTimes(3);

    // Same username on panel-b is NOT suppressed by panel-a's dedupe entry
    await service.handleWebhook(
      { username: 'vip_user_01', action: 'user_limited', panel_id: 'panel-b' },
      'secret_123',
      70_500
    );
    expect(telegramSender.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('evicts expired and oldest dedupe entries beyond 2000 entries and coalesces user_deleted scans', async () => {
    const service = createService(undefined, 1_000, true);
    const mock = createMockDb({
      selectHandler: () => [
        {
          configId: 'cfg-del',
          panelId: 'panel-main',
          serviceId: 1,
          configUsername: 'u_deleted',
          telegramId: 100,
          autoRenewEnabled: false,
          autoRenewPackageId: null,
          autoRenewPrice: null,
          locale: 'fa',
        },
        {
          configId: 'cfg-del-2',
          panelId: 'panel-main',
          serviceId: 1,
          configUsername: 'u_deleted',
          telegramId: 101,
          autoRenewEnabled: false,
          autoRenewPackageId: null,
          autoRenewPrice: null,
          locale: 'fa',
        },
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    let resolveScan!: (val: unknown) => void;
    scanMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve;
        })
    );

    const deleted = await service.handleWebhook({ username: 'u_deleted', action: 'user_deleted' });
    expect(deleted.actionsPerformed).toEqual([
      'recorded_remote_deletion:cfg-del',
      'recorded_remote_deletion:cfg-del-2',
    ]);
    // Coalesced across multiple configs AND across a second overlapping event while scan is in flight
    await service.handleWebhook({ username: 'u_deleted', action: 'user_deleted' });
    expect(scanMock).toHaveBeenCalledTimes(1);
    resolveScan({ localMissingRemote: 1, remoteUnbound: 0, remoteIgnored: 0 });
    await Promise.resolve();

    // Eviction test (>2000 keys): old timestamp key is evicted when cache exceeds MAX_DEDUPE_CACHE_SIZE
    let idx = 0;
    const bulkMock = createMockDb({
      selectHandler: () => {
        idx += 1;
        return [
          {
            configId: `cfg-${idx}`,
            panelId: 'panel-main',
            serviceId: 1,
            configUsername: `u_${idx}`,
            telegramId: idx,
            autoRenewEnabled: false,
            autoRenewPackageId: null,
            autoRenewPrice: null,
            locale: 'en',
          },
        ];
      },
    });
    getDbMock.mockReturnValue(bulkMock.db as never);
    const cacheMap = (service as unknown as { recentAlertTimestamps: Map<string, number> })
      .recentAlertTimestamps;
    cacheMap.clear();
    for (let i = 0; i <= 2002; i += 1) {
      await service.handleWebhook(
        { username: `u_${i}`, action: 'user_limited' },
        undefined,
        i < 50 ? 100 : 5_000
      );
    }
    expect(cacheMap.size).toBeLessThanOrEqual(2000);
  });
});
