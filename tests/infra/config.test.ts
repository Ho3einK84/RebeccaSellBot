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

describe('loadConfig', () => {
  const requiredConfig = {
    BOT_TOKEN: '123456:valid_test_token',
    ADMIN_IDS: '123456789',
    DATABASE_URL: 'postgres://user:password@localhost:5432/rsbot_test',
    REBECCA_API_URL: 'https://panel.example.com',
    REBECCA_API_KEY: 'test-api-key',
    PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
  };

  it('allows startup without ADMIN_IDS in env (returns empty array)', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      ADMIN_IDS: '',
    });

    expect(loadConfig().ADMIN_IDS).toEqual([]);
  });

  it('accepts at least one numeric administrator ID in production', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      ADMIN_IDS: '123456789, 987654321',
    });

    expect(loadConfig().ADMIN_IDS).toEqual([123456789, 987654321]);
  });

  it('rejects zero, negative, malformed, and partially numeric administrator IDs', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      ADMIN_IDS: '123456789, 0, -42, not-a-number, 123abc',
    });

    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('requires PANEL_CREDENTIALS_KEY in production', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      PANEL_CREDENTIALS_KEY: '',
    });

    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('allows PANEL_CREDENTIALS_KEY to be omitted in development or test', async () => {
    const loadConfigDev = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'development',
      PANEL_CREDENTIALS_KEY: '',
    });
    expect(loadConfigDev().PANEL_CREDENTIALS_KEY).toBeUndefined();

    const loadConfigTest = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'test',
      PANEL_CREDENTIALS_KEY: '',
    });
    expect(loadConfigTest().PANEL_CREDENTIALS_KEY).toBeUndefined();
  });

  it('handles SUPPORT_URL properly when empty, valid, or invalid', async () => {
    const loadConfigEmpty = await loadConfigWithEnv({
      ...requiredConfig,
      SUPPORT_URL: '',
    });
    expect(loadConfigEmpty().SUPPORT_URL).toBeUndefined();

    const loadConfigValid = await loadConfigWithEnv({
      ...requiredConfig,
      SUPPORT_URL: 'https://t.me/support_bot',
    });
    expect(loadConfigValid().SUPPORT_URL).toBe('https://t.me/support_bot');

    const loadConfigInvalid = await loadConfigWithEnv({
      ...requiredConfig,
      SUPPORT_URL: 'not-a-valid-url',
    });
    expect(() => loadConfigInvalid()).toThrow('Invalid environment configuration');
  });

  it('requires an API key or an explicit Rebecca administrator password in production', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      REBECCA_API_KEY: '',
      REBECCA_ADMIN_PASSWORD: '',
    });

    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('allows explicit Rebecca administrator credentials when no API key is configured', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      REBECCA_API_KEY: '',
      REBECCA_ADMIN_PASSWORD: 'explicit-test-password',
    });

    expect(loadConfig().REBECCA_API_KEY).toBeUndefined();
    expect(loadConfig().REBECCA_ADMIN_PASSWORD).toBe('explicit-test-password');
  });

  it('rejects a malformed health-check port', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      HEALTH_CHECK_PORT: '3001oops',
    });

    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('falls back to default admin username and service id when empty environment variables are provided', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      REBECCA_ADMIN_USERNAME: '',
      REBECCA_SERVICE_ID: '',
      HEALTH_CHECK_PORT: '',
    });

    const config = loadConfig();
    expect(config.REBECCA_ADMIN_USERNAME).toBe('admin');
    expect(config.REBECCA_SERVICE_ID).toBe(1);
    expect(config.HEALTH_CHECK_PORT).toBe(3001);
    expect(config.DATABASE_POOL_SIZE).toBe(20);
  });

  it('accepts a custom DATABASE_POOL_SIZE', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      DATABASE_POOL_SIZE: '40',
    });

    const config = loadConfig();
    expect(config.DATABASE_POOL_SIZE).toBe(40);
  });

  it('allows a fresh production install to defer Rebecca panel setup', async () => {
    const loadConfig = await loadConfigWithEnv({
      ...requiredConfig,
      NODE_ENV: 'production',
      REBECCA_API_URL: '',
      REBECCA_API_KEY: '',
      REBECCA_ADMIN_PASSWORD: '',
      PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
    });

    expect(loadConfig().REBECCA_API_URL).toBeUndefined();
  });

  it('rejects an out-of-range legacy service ID and a weak explicit credential key', async () => {
    const loadWithBadService = await loadConfigWithEnv({
      ...requiredConfig,
      REBECCA_SERVICE_ID: '2147483648',
    });
    expect(() => loadWithBadService()).toThrow('Invalid environment configuration');

    const loadWithWeakKey = await loadConfigWithEnv({
      ...requiredConfig,
      PANEL_CREDENTIALS_KEY: 'too-short',
    });
    expect(() => loadWithWeakKey()).toThrow('Invalid environment configuration');
  });

  describe('BOT_DELIVERY_MODE and webhook configuration', () => {
    it('defaults to polling mode with default webhook port and path when unset', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...requiredConfig,
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBHOOK_PORT).toBe(3000);
      expect(config.WEBHOOK_PATH).toBe('/webhook');
      expect(config.WEBHOOK_HOST).toBe('0.0.0.0');
      expect(config.WEBHOOK_URL).toBeUndefined();
      expect(config.WEBHOOK_SECRET_TOKEN).toBeUndefined();
    });

    it('infers webhook mode when WEBHOOK_URL is configured without BOT_DELIVERY_MODE', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...requiredConfig,
        WEBHOOK_URL: 'https://example.com/rsbot/webhook',
        WEBHOOK_SECRET_TOKEN: 'valid_secret_123',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('webhook');
      expect(config.WEBHOOK_URL).toBe('https://example.com/rsbot/webhook');
      expect(config.WEBHOOK_PATH).toBe('/rsbot/webhook');
      expect(config.WEBHOOK_SECRET_TOKEN).toBe('valid_secret_123');
    });

    it('honors explicit BOT_DELIVERY_MODE=polling even when WEBHOOK_URL is provided', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'polling',
        WEBHOOK_URL: 'https://example.com/rsbot/webhook',
        // In polling mode, WEBHOOK_SECRET_TOKEN is not required even if URL is provided
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBHOOK_URL).toBe('https://example.com/rsbot/webhook');
    });

    it('requires WEBHOOK_URL and WEBHOOK_SECRET_TOKEN when BOT_DELIVERY_MODE is webhook', async () => {
      const loadMissingUrl = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_SECRET_TOKEN: 'valid_secret_123',
      });
      expect(() => loadMissingUrl()).toThrow('Invalid environment configuration');

      const loadMissingSecret = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://example.com/rsbot/webhook',
      });
      expect(() => loadMissingSecret()).toThrow('Invalid environment configuration');
    });

    it('rejects insecure HTTP WEBHOOK_URL', async () => {
      const loadInsecure = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'http://example.com/rsbot/webhook',
        WEBHOOK_SECRET_TOKEN: 'valid_secret_123',
      });
      expect(() => loadInsecure()).toThrow('Invalid environment configuration');
    });

    it('validates WEBHOOK_SECRET_TOKEN format (rejects spaces, special disallowed chars)', async () => {
      const loadBadChars = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://example.com/rsbot/webhook',
        WEBHOOK_SECRET_TOKEN: 'bad secret token with spaces!',
      });
      expect(() => loadBadChars()).toThrow('Invalid environment configuration');
    });

    it('normalizes explicit WEBHOOK_PATH without leading slash', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://example.com/custom',
        WEBHOOK_SECRET_TOKEN: 'valid_secret_123',
        WEBHOOK_PATH: 'my-path/webhook',
      });

      const config = loadConfig();
      expect(config.WEBHOOK_PATH).toBe('/my-path/webhook');
    });

    it('rejects equal WEBHOOK_PORT and HEALTH_CHECK_PORT in webhook mode', async () => {
      const loadPortConflict = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://example.com/rsbot/webhook',
        WEBHOOK_SECRET_TOKEN: 'valid_secret_123',
        WEBHOOK_PORT: '3001',
        HEALTH_CHECK_PORT: '3001',
      });
      expect(() => loadPortConflict()).toThrow('Invalid environment configuration');
    });

    it('accepts custom WEBHOOK_PORT, WEBHOOK_HOST, and WEBHOOK_PATH in webhook mode', async () => {
      const loadConfig = await loadConfigWithEnv({
        ...requiredConfig,
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://example.com/rsbot/hook',
        WEBHOOK_SECRET_TOKEN: 'secret_ABC-123_xyz',
        WEBHOOK_PORT: '8443',
        WEBHOOK_HOST: '127.0.0.1',
        WEBHOOK_PATH: '/custom/hook',
      });

      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('webhook');
      expect(config.WEBHOOK_PORT).toBe(8443);
      expect(config.WEBHOOK_HOST).toBe('127.0.0.1');
      expect(config.WEBHOOK_PATH).toBe('/custom/hook');
      expect(config.WEBHOOK_SECRET_TOKEN).toBe('secret_ABC-123_xyz');
    });
  });
});
