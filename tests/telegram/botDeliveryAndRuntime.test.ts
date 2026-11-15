import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bot } from 'grammy';
import type { Config } from '../../src/infra/config.js';
import { startHealthCheckServer, stopHealthCheckServer } from '../../src/infra/healthcheck.js';
import {
  clearWebhook,
  conversationContextMiddleware,
  createWebhookHandler,
  registerWebhook,
  startBot,
  startWebhookServer,
} from '../../src/telegram/bot.js';
import { isAdminCallbackData } from '../../src/telegram/botRuntime.js';
import { adminSetBalanceConversation } from '../../src/telegram/conversations/adminConversations.js';
import { clearTransientConversationSession, requireAdminCallback } from '../../src/telegram/ui.js';
import type {
  BotServices,
  ConversationContext,
  MenuContext,
  MyConversation,
  SessionData,
} from '../../src/telegram/types.js';
import { createBotHarness, createMockServices } from './helpers/botHarness.js';

function createMockBot() {
  const bot = new Bot<MenuContext>('123456:mock_token_for_tests');
  bot.api.deleteWebhook = vi.fn().mockResolvedValue(true as never);
  bot.api.setWebhook = vi.fn().mockResolvedValue(true as never);
  bot.init = vi.fn().mockResolvedValue(undefined as never);
  bot.handleUpdate = vi.fn().mockResolvedValue(undefined as never);
  bot.start = vi.fn().mockResolvedValue(undefined as never);
  return bot;
}

function createBaseConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    BOT_TOKEN: '123456:mock_token_for_tests',
    ADMIN_IDS: [123456789],
    DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
    DATABASE_POOL_SIZE: 10,
    HEALTH_CHECK_PORT: 3001,
    DEFAULT_LOCALE: 'fa',
    INSTANCE_NAME: 'test',
    BOT_DELIVERY_MODE: 'webhook',
    WEBHOOK_URL: 'https://example.com/rsbot/webhook',
    WEBHOOK_SECRET_TOKEN: 'test_secret_token_123',
    WEBHOOK_PORT: 3000,
    WEBHOOK_PATH: '/rsbot/webhook',
    WEBHOOK_HOST: '127.0.0.1',
    ...overrides,
  };
}

afterEach(async () => {
  await stopHealthCheckServer();
  vi.restoreAllMocks();
});

describe('Telegram Dual-Mode Delivery (Polling & Webhook)', () => {
  describe('clearWebhook', () => {
    it('deletes existing webhook with drop_pending_updates false', async () => {
      const bot = createMockBot();
      await clearWebhook(bot);
      expect(bot.api.deleteWebhook).toHaveBeenCalledWith({ drop_pending_updates: false });
    });
  });

  describe('registerWebhook', () => {
    it('registers webhook using configured URL and secret token', async () => {
      const bot = createMockBot();
      const config = createBaseConfig();

      await registerWebhook(bot, config);
      expect(bot.api.setWebhook).toHaveBeenCalledWith('https://example.com/rsbot/webhook', {
        secret_token: 'test_secret_token_123',
        drop_pending_updates: false,
      });
    });

    it('throws if WEBHOOK_URL or WEBHOOK_SECRET_TOKEN are missing', async () => {
      const bot = createMockBot();
      const configNoUrl = createBaseConfig({ WEBHOOK_URL: undefined });
      await expect(registerWebhook(bot, configNoUrl)).rejects.toThrow('WEBHOOK_URL is required');

      const configNoSecret = createBaseConfig({ WEBHOOK_SECRET_TOKEN: undefined });
      await expect(registerWebhook(bot, configNoSecret)).rejects.toThrow(
        'WEBHOOK_SECRET_TOKEN is required'
      );
    });
  });

  describe('startBot (long polling)', () => {
    it('clears lingering webhook prior to starting polling', async () => {
      const bot = createMockBot();
      await startBot(bot);

      expect(bot.api.deleteWebhook).toHaveBeenCalledWith({ drop_pending_updates: false });
      expect(bot.start).toHaveBeenCalled();
    });

    it('proceeds with polling even if deleteWebhook fails with a non-fatal warning', async () => {
      const bot = createMockBot();
      bot.api.deleteWebhook = vi.fn().mockRejectedValue(new Error('Network temporary hiccup'));

      await expect(startBot(bot)).resolves.not.toThrow();
      expect(bot.start).toHaveBeenCalled();
    });
  });

  describe('createWebhookHandler', () => {
    it('responds 200 OK on internal health probe paths', async () => {
      const bot = createMockBot();
      const config = createBaseConfig();
      const handler = createWebhookHandler(bot, config);

      for (const path of ['/health', '/healthz', '/ready', '/readyz']) {
        const req = { method: 'GET', url: path } as http.IncomingMessage;
        let statusCode = 0;
        let responseBody = '';
        const res = {
          writeHead: vi.fn((status: number) => {
            statusCode = status;
          }),
          end: vi.fn((body: string) => {
            responseBody = body;
          }),
          headersSent: false,
        } as unknown as http.ServerResponse;

        await handler(req, res);
        expect(statusCode).toBe(200);
        expect(JSON.parse(responseBody)).toEqual({ status: 'ok', mode: 'webhook' });
      }
    });

    it('responds 404 Not Found on unknown paths', async () => {
      const bot = createMockBot();
      const config = createBaseConfig();
      const handler = createWebhookHandler(bot, config);

      const req = { method: 'POST', url: '/unknown/endpoint' } as http.IncomingMessage;
      let statusCode = 0;
      let responseBody = '';
      const res = {
        writeHead: vi.fn((status: number) => {
          statusCode = status;
        }),
        end: vi.fn((body: string) => {
          responseBody = body;
        }),
        headersSent: false,
      } as unknown as http.ServerResponse;

      await handler(req, res);
      expect(statusCode).toBe(404);
      expect(responseBody).toBe('Not Found');
    });

    it('responds 405 Method Not Allowed when method is not POST on webhook path', async () => {
      const bot = createMockBot();
      const config = createBaseConfig();
      const handler = createWebhookHandler(bot, config);

      const req = { method: 'GET', url: '/rsbot/webhook' } as http.IncomingMessage;
      let statusCode = 0;
      let responseBody = '';
      const res = {
        writeHead: vi.fn((status: number) => {
          statusCode = status;
        }),
        end: vi.fn((body: string) => {
          responseBody = body;
        }),
        headersSent: false,
      } as unknown as http.ServerResponse;

      await handler(req, res);
      expect(statusCode).toBe(405);
      expect(responseBody).toBe('Method Not Allowed');
    });
  });

  describe('startWebhookServer and live HTTP lifecycle', () => {
    it('starts listening, serves requests, validates secret token, and closes gracefully', async () => {
      const bot = createMockBot();
      const config = createBaseConfig({
        WEBHOOK_PORT: 0,
        WEBHOOK_HOST: '127.0.0.1',
        WEBHOOK_PATH: '/test-webhook',
        WEBHOOK_SECRET_TOKEN: 'secure_token_xyz',
      });

      const handle = await startWebhookServer(bot, config);
      const address = handle.server.address();
      expect(address).toBeTruthy();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);

      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ status: 'ok', mode: 'webhook' });

      const unauthorizedRes = await fetch(`http://127.0.0.1:${port}/test-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(unauthorizedRes.status).toBe(401);

      const badTokenRes = await fetch(`http://127.0.0.1:${port}/test-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong_token',
        },
        body: JSON.stringify({ update_id: 2 }),
      });
      expect(badTokenRes.status).toBe(401);

      const validRes = await fetch(`http://127.0.0.1:${port}/test-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'secure_token_xyz',
        },
        body: JSON.stringify({ update_id: 3, message: { text: '/start' } }),
      });
      expect(validRes.status).toBe(200);
      expect(bot.handleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ update_id: 3 }),
        expect.any(Object)
      );

      await handle.close();
      expect(handle.server.listening).toBe(false);
    });

    it('routes requests on REBECCA_WEBHOOK_PATH to the rebecca webhook handler', async () => {
      const bot = createMockBot();
      const rebeccaHandler = vi.fn().mockImplementation(async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'rebecca_ok' }));
        return true;
      });

      const config = createBaseConfig({
        REBECCA_WEBHOOK_PATH: '/custom/rebecca-webhook',
      });
      const handler = createWebhookHandler(bot, config, rebeccaHandler);

      const req = {
        method: 'POST',
        url: '/custom/rebecca-webhook',
      } as http.IncomingMessage;
      let statusCode = 0;
      let responseBody = '';
      const res = {
        writeHead: vi.fn((status: number) => {
          statusCode = status;
        }),
        end: vi.fn((body: string) => {
          responseBody = body;
        }),
        headersSent: false,
      } as unknown as http.ServerResponse;

      await handler(req, res);
      expect(rebeccaHandler).toHaveBeenCalled();
      expect(statusCode).toBe(200);
      expect(responseBody).toBe(JSON.stringify({ status: 'rebecca_ok' }));
    });

    it('attaches to existing healthcheck server when ephemeral ports match instead of opening duplicate server', async () => {
      const bot = createMockBot();
      const baseServer = await startHealthCheckServer(0);
      const addr = baseServer.address();
      const testPort = typeof addr === 'object' && addr ? addr.port : 0;
      expect(testPort).toBeGreaterThan(0);

      const config = createBaseConfig({
        WEBHOOK_PORT: testPort,
        WEBHOOK_HOST: '127.0.0.1',
        WEBHOOK_PATH: '/unified-webhook',
        WEBHOOK_SECRET_TOKEN: 'unified_secret',
      });

      const handle = await startWebhookServer(bot, config);
      expect(handle.server).toBe(baseServer);

      const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
      expect(healthRes.status).toBe(200);

      const webhookRes = await fetch(`http://127.0.0.1:${testPort}/unified-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'unified_secret',
        },
        body: JSON.stringify({ update_id: 10 }),
      });
      expect(webhookRes.status).toBe(200);

      await handle.close();
      expect(baseServer.listening).toBe(true);

      await stopHealthCheckServer();
      expect(baseServer.listening).toBe(false);
    });
  });
});

describe('Admin callback authorization and session hygiene', () => {
  it('recognizes grammY admin submenus and admin route prefixes as protected data', () => {
    expect(isAdminCallbackData('admin-menu/0/0//')).toBe(true);
    expect(isAdminCallbackData('admin-daily-menu/0/1//')).toBe(true);
    expect(isAdminCallbackData('admin-sales-menu/1/0//')).toBe(true);
    expect(isAdminCallbackData('admin-panels-menu/0/0//')).toBe(true);
    expect(isAdminCallbackData('admin-system-menu/0/1//')).toBe(true);
    expect(isAdminCallbackData('set-group:system')).toBe(true);
    expect(isAdminCallbackData('nm-set:mode')).toBe(true);
    expect(isAdminCallbackData('pfx:toggle')).toBe(true);
    expect(isAdminCallbackData('tmpl:preset:1')).toBe(true);
    expect(isAdminCallbackData('rcpt:app:id:1')).toBe(true);
    expect(isAdminCallbackData('main-menu/0/0//')).toBe(false);
  });

  it('rejects direct admin-conversation invocation from an ID outside ADMIN_IDS', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const waitFor = vi.fn();
    const external = vi.fn(async (task: (ctx: { session: Record<string, unknown> }) => unknown) =>
      task({ session: {} })
    );
    const ctx = {
      from: { id: 123, is_bot: false, first_name: 'Untrusted' },
      reply,
      services: {
        isAdmin: vi.fn(() => false),
        translationService: {
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as MenuContext;

    await adminSetBalanceConversation({ waitFor, external } as unknown as MyConversation, ctx);

    expect(ctx.services?.isAdmin).toHaveBeenCalledWith(123);
    expect(reply).toHaveBeenCalledWith('admin_access_denied', expect.any(Object));
    expect(waitFor).not.toHaveBeenCalled();
  });

  it('fails closed in requireAdminCallback when services.isAdmin rejects or is omitted', async () => {
    const services = createMockServices({ adminIds: [1] });
    const harness = createBotHarness({ services });

    harness.bot.callbackQuery(/^nm-set:/u, async (ctx) => {
      if (!(await requireAdminCallback(ctx))) return;
      await ctx.reply('should_not_run');
    });

    await harness.sendCallback('nm-set:test', { userId: 999 });
    expect(harness.callsFor('sendMessage')).toHaveLength(0);
    const answers = harness.callsFor('answerCallbackQuery');
    expect(answers[0]?.payload.text).toBe('access_denied');
    expect(answers[0]?.payload.show_alert).toBe(true);
  });

  it('clears all transient conversation state keys without touching durable artifacts or UI IDs', () => {
    const session: SessionData = {
      uiMessageIds: [10],
      artifactMessageIds: [20],
      adminPromoEditId: 'p1',
      adminBalanceTargetTelegramId: 123,
      adminDirectMessageTargetTelegramId: 123,
      transferConfigId: 'c1',
      transferConfigOwnerTelegramId: 123,
      orphanAssignIssueId: 'o1',
      renewConfigId: 'c2',
      renewConfigUsername: 'usr',
      pendingAutoRenew: { configId: 'c1', packageId: 'p1', price: 10 },
      adminPanelId: 'pan1',
      adminPanelAction: 'await_api_key',
      adminPanelActionAt: Date.now(),
      adminPanelDraft: { name: 'n', baseUrl: 'https://x', serviceId: 1, serviceName: 's' },
      adminReceiptBatch: { ids: ['r1'], page: 1 },
      adminQuickTopup: { token: 't', targetTelegramId: 1, amount: 5000, status: 'pending' },
    };

    clearTransientConversationSession(session);

    expect(session.uiMessageIds).toEqual([10]);
    expect(session.artifactMessageIds).toEqual([20]);
    expect(session.adminPromoEditId).toBeUndefined();
    expect(session.adminPanelDraft).toBeUndefined();
    expect(session.adminPanelAction).toBeUndefined();
    expect(session.adminQuickTopup).toBeUndefined();
    expect(session.adminReceiptBatch).toBeUndefined();
    expect(session.pendingAutoRenew).toBeUndefined();
    expect(session.renewConfigUsername).toBeUndefined();
  });

  it('reinjects services and saved locale in conversationContextMiddleware', async () => {
    const services = {
      userService: { getLocale: vi.fn().mockResolvedValue('fa') },
      translationService: {
        resolveLocale: vi.fn((locale?: string) => (locale?.startsWith('en') ? 'en' : 'fa')),
      },
    } as unknown as BotServices;
    const ctx = {
      from: { id: 123, is_bot: false, first_name: 'Test', language_code: 'en-US' },
    } as ConversationContext;
    const next = vi.fn().mockResolvedValue(undefined);

    await conversationContextMiddleware(services)(ctx, next);

    expect(ctx.services).toBe(services);
    expect(ctx.userLocale).toBe('fa');
    expect(next).toHaveBeenCalledOnce();
  });
});
