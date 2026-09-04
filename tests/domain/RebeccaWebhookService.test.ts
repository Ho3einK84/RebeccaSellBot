import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  RebeccaWebhookService,
  type RebeccaWebhookPayload,
} from '../../src/domain/services/RebeccaWebhookService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { Api } from 'grammy';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

describe('RebeccaWebhookService', () => {
  const getDbMock = vi.mocked(getDb);
  let telegramApiMock: { sendMessage: ReturnType<typeof vi.fn> };
  let translationServiceMock: {
    resolveLocale: ReturnType<typeof vi.fn>;
    t: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    telegramApiMock = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    };
    translationServiceMock = {
      resolveLocale: vi.fn().mockReturnValue('fa'),
      t: vi.fn((key: string) => key),
      get: vi.fn((key: string) => key),
    };
  });

  function createService(secret?: string, dedupeWindowMs?: number) {
    return new RebeccaWebhookService({
      panels: {} as unknown as RebeccaPanelRegistry,
      translationService: translationServiceMock as unknown as TranslationService,
      telegramApi: telegramApiMock as unknown as Api,
      secret,
      dedupeWindowMs,
    });
  }

  describe('Secret verification', () => {
    it('accepts valid secret header when secret is configured', async () => {
      const service = createService('my_webhook_secret_123');
      expect(service.verifySecret('my_webhook_secret_123')).toBe(true);
      expect(service.verifySecret(['my_webhook_secret_123'])).toBe(true);
    });

    it('rejects invalid or missing secret header when secret is configured', async () => {
      const service = createService('my_webhook_secret_123');
      expect(service.verifySecret(undefined)).toBe(false);
      expect(service.verifySecret('wrong_secret')).toBe(false);
      expect(service.verifySecret(['wrong_secret'])).toBe(false);
      expect(service.verifySecret('')).toBe(false);
    });

    it('allows all requests when no secret is configured', async () => {
      const service = createService(undefined);
      expect(service.verifySecret(undefined)).toBe(true);
      expect(service.verifySecret('any_secret')).toBe(true);
    });
  });

  describe('handleWebhook', () => {
    it('returns 401 when secret does not match', async () => {
      const service = createService('required_secret');
      const result = await service.handleWebhook(
        { username: 'test_user', action: 'user_limited' },
        'wrong_secret'
      );
      expect(result.handled).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(telegramApiMock.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed payloads', async () => {
      const service = createService();
      const result = await service.handleWebhook(null as unknown as RebeccaWebhookPayload);
      expect(result.handled).toBe(false);
      expect(result.statusCode).toBe(400);

      const resultMissingUser = await service.handleWebhook({
        action: 'user_limited',
      } as unknown as RebeccaWebhookPayload);
      expect(resultMissingUser.handled).toBe(false);
      expect(resultMissingUser.statusCode).toBe(400);
    });

    it('returns 200 with 0 matched configs when config is not found in database', async () => {
      const service = createService();
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      getDbMock.mockReturnValue(mockQuery as any);

      const result = await service.handleWebhook({
        username: 'nonexistent_user',
        action: 'user_limited',
      });

      expect(result.handled).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.matchedConfigs).toBe(0);
      expect(telegramApiMock.sendMessage).not.toHaveBeenCalled();
    });

    it('alerts user on user_limited and provides direct renewal button', async () => {
      const service = createService();
      const mockConfig = {
        configId: 'cfg-101',
        panelId: 'panel-main',
        serviceId: 1,
        configUsername: 'vip_user_01',
        telegramId: 987654321,
        autoRenewEnabled: false,
        autoRenewPackageId: null,
        autoRenewPrice: null,
        locale: 'fa',
      };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockConfig]),
      };
      getDbMock.mockReturnValue(mockQuery as any);

      const result = await service.handleWebhook({
        username: 'vip_user_01',
        action: 'user_limited',
      });

      expect(result.handled).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.matchedConfigs).toBe(1);
      expect(telegramApiMock.sendMessage).toHaveBeenCalledTimes(1);

      const [chatId, text, options] = telegramApiMock.sendMessage.mock.calls[0];
      expect(chatId).toBe(987654321);
      expect(text).toContain('vip\\_user\\_01');
      expect(options.reply_markup.inline_keyboard[0][0].callback_data).toBe('sub:detail:cfg-101');
    });

    it('alerts user on user_expired and deduplicates duplicate webhook events', async () => {
      const service = createService('secret_123', 60_000);
      const mockConfig = {
        configId: 'cfg-202',
        panelId: 'panel-main',
        serviceId: 1,
        configUsername: 'expiring_user',
        telegramId: 11223344,
        autoRenewEnabled: false,
        autoRenewPackageId: null,
        autoRenewPrice: null,
        locale: 'en',
      };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockConfig]),
      };
      getDbMock.mockReturnValue(mockQuery as any);

      const first = await service.handleWebhook(
        { username: 'expiring_user', action: 'user_expired' },
        'secret_123',
        1000
      );
      expect(first.statusCode).toBe(200);
      expect(telegramApiMock.sendMessage).toHaveBeenCalledTimes(1);

      // Duplicate event 10 seconds later should be suppressed
      const duplicate = await service.handleWebhook(
        { username: 'expiring_user', action: 'user_expired' },
        'secret_123',
        11000
      );
      expect(duplicate.statusCode).toBe(200);
      expect(telegramApiMock.sendMessage).toHaveBeenCalledTimes(1); // Still 1

      // Event after dedupe window expires (70 seconds later) should notify again
      const later = await service.handleWebhook(
        { username: 'expiring_user', action: 'user_expired' },
        'secret_123',
        80000
      );
      expect(later.statusCode).toBe(200);
      expect(telegramApiMock.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('logs without failing on non-alert actions such as user_deleted or user_updated', async () => {
      const service = createService();
      const mockConfig = {
        configId: 'cfg-303',
        panelId: 'panel-main',
        serviceId: 1,
        configUsername: 'deleted_user',
        telegramId: 55667788,
        autoRenewEnabled: false,
        autoRenewPackageId: null,
        autoRenewPrice: null,
        locale: 'fa',
      };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockConfig]),
      };
      getDbMock.mockReturnValue(mockQuery as any);

      const result = await service.handleWebhook({
        username: 'deleted_user',
        action: 'user_deleted',
      });

      expect(result.handled).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(telegramApiMock.sendMessage).not.toHaveBeenCalled();
      expect(result.actionsPerformed).toContain('recorded_remote_deletion:cfg-303');
    });
  });
});
