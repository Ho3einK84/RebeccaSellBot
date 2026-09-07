import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadConfigWithEnv(values: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...values };
  const module = await import('../../src/infra/config.js');
  return module.loadConfig;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('WebApp Config Validation', () => {
  const baseConfig = {
    BOT_TOKEN: '123456:valid_token',
    ADMIN_IDS: '123456789',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/rsbot_test',
    PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
  };

  const validSessionSecret = 's'.repeat(32);

  describe('4 combinations of {polling, webhook} × {webapp off, webapp on}', () => {
    it('1. Polling + WebApp OFF (default)', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'polling',
        WEBAPP_URL: '',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBAPP_URL).toBeUndefined();
      expect(config.WEBAPP_PORT).toBe(3002);
      expect(config.WEBAPP_HOST).toBe('0.0.0.0');
    });

    it('2. Polling + WebApp ON', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'polling',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
        WEBAPP_PORT: '3002',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBAPP_URL).toBe('https://app.example.com');
      expect(config.WEBAPP_PORT).toBe(3002);
      expect(config.ADMIN_SESSION_SECRET).toBe(validSessionSecret);
    });

    it('3. Webhook + WebApp OFF', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com/webhook',
        WEBHOOK_SECRET_TOKEN: 'webhook_secret_123',
        WEBHOOK_PORT: '3000',
        WEBAPP_URL: '',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('webhook');
      expect(config.WEBHOOK_PORT).toBe(3000);
      expect(config.WEBAPP_URL).toBeUndefined();
    });

    it('4. Webhook + WebApp ON (distinct ports 3000, 3001, 3002)', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com/webhook',
        WEBHOOK_SECRET_TOKEN: 'webhook_secret_123',
        WEBHOOK_PORT: '3000',
        HEALTH_CHECK_PORT: '3001',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
        WEBAPP_PORT: '3002',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('webhook');
      expect(config.WEBHOOK_PORT).toBe(3000);
      expect(config.HEALTH_CHECK_PORT).toBe(3001);
      expect(config.WEBAPP_PORT).toBe(3002);
      expect(config.WEBAPP_URL).toBe('https://app.example.com');
      expect(config.ADMIN_SESSION_SECRET).toBe(validSessionSecret);
    });
  });

  describe('Validation and rejection rules', () => {
    it('requires ADMIN_SESSION_SECRET with at least 32 chars when WEBAPP_URL is set', async () => {
      const loadMissingSecret = await loadConfigWithEnv({
        ...baseConfig,
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: '',
      });
      expect(() => loadMissingSecret()).toThrow('Invalid environment configuration');

      const loadShortSecret = await loadConfigWithEnv({
        ...baseConfig,
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: 'short_secret_under_32_chars',
      });
      expect(() => loadShortSecret()).toThrow('Invalid environment configuration');
    });

    it('rejects non-HTTPS WEBAPP_URL', async () => {
      const loadHttpUrl = await loadConfigWithEnv({
        ...baseConfig,
        WEBAPP_URL: 'http://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
      });
      expect(() => loadHttpUrl()).toThrow('Invalid environment configuration');
    });

    it('rejects WEBAPP_PORT collision with HEALTH_CHECK_PORT', async () => {
      const loadHealthCollision = await loadConfigWithEnv({
        ...baseConfig,
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
        HEALTH_CHECK_PORT: '3001',
        WEBAPP_PORT: '3001',
      });
      expect(() => loadHealthCollision()).toThrow('Invalid environment configuration');
    });

    it('rejects WEBAPP_PORT collision with WEBHOOK_PORT under webhook mode', async () => {
      const loadWebhookCollision = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com/webhook',
        WEBHOOK_SECRET_TOKEN: 'webhook_secret_123',
        WEBHOOK_PORT: '3000',
        HEALTH_CHECK_PORT: '3001',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
        WEBAPP_PORT: '3000', // Collides with WEBHOOK_PORT
      });
      expect(() => loadWebhookCollision()).toThrow('Invalid environment configuration');
    });

    it('allows same WEBAPP_PORT as default WEBHOOK_PORT under polling mode (no listener conflict)', async () => {
      const loadPollingSamePort = await loadConfigWithEnv({
        ...baseConfig,
        BOT_DELIVERY_MODE: 'polling',
        HEALTH_CHECK_PORT: '3001',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: validSessionSecret,
        WEBAPP_PORT: '3000', // 3000 is default WEBHOOK_PORT, but webhook listener is NOT active in polling
      });

      const config = loadPollingSamePort();
      expect(config.WEBAPP_PORT).toBe(3000);
    });
  });
});
