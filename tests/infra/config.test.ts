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
});
