import http from 'node:http';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Bot } from 'grammy';
import type { Config } from '../../src/infra/config.js';
import type { MenuContext } from '../../src/telegram/types.js';
import {
  clearWebhook,
  registerWebhook,
  createWebhookHandler,
  startWebhookServer,
  startBot,
} from '../../src/telegram/bot.js';

function createMockBot() {
  const bot = new Bot<MenuContext>('123456:mock_token_for_tests');
  bot.api.deleteWebhook = vi.fn().mockResolvedValue(true as any);
  bot.api.setWebhook = vi.fn().mockResolvedValue(true as any);
  bot.init = vi.fn().mockResolvedValue(undefined as any);
  bot.handleUpdate = vi.fn().mockResolvedValue(undefined as any);
  bot.start = vi.fn().mockResolvedValue(undefined as any);
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

afterEach(() => {
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
      // Listen on loopback port 0 (OS allocates free ephemeral port)
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

      // 1. Check health endpoint
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson).toEqual({ status: 'ok', mode: 'webhook' });

      // 2. Check missing secret token returns 401 Unauthorized
      const unauthorizedRes = await fetch(`http://127.0.0.1:${port}/test-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(unauthorizedRes.status).toBe(401);

      // 3. Check invalid secret token returns 401 Unauthorized
      const badTokenRes = await fetch(`http://127.0.0.1:${port}/test-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong_token',
        },
        body: JSON.stringify({ update_id: 2 }),
      });
      expect(badTokenRes.status).toBe(401);

      // 4. Check matching secret token passes update to bot.handleUpdate and returns 200
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

      // 5. Close gracefully
      await handle.close();
      expect(handle.server.listening).toBe(false);
    });
  });
});
