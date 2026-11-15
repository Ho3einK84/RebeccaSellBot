import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, resetConfigForTesting } from '../../src/infra/config.js';
import { validateRebeccaBaseUrl } from '../../src/infra/rebeccaBaseUrl.js';

const ALL_CONFIG_KEYS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'PORT',
  'BOT_TOKEN',
  'ADMIN_IDS',
  'DATABASE_URL',
  'DATABASE_POOL_SIZE',
  'BOT_DELIVERY_MODE',
  'WEBHOOK_URL',
  'WEBHOOK_PORT',
  'WEBHOOK_HOST',
  'WEBHOOK_PATH',
  'WEBHOOK_SECRET_TOKEN',
  'WEBHOOK_HOST_PORT',
  'WEBAPP_URL',
  'WEBAPP_PORT',
  'WEBAPP_HOST',
  'WEBAPP_HOST_PORT',
  'WEBAPP_TARGET_URL',
  'WEBAPP_SESSION_SECRET',
  'ADMIN_SESSION_SECRET',
  'PANEL_CREDENTIALS_KEY',
  'HEALTH_CHECK_PORT',
  'REBECCA_API_URL',
  'REBECCA_API_KEY',
  'REBECCA_ADMIN_USERNAME',
  'REBECCA_ADMIN_PASSWORD',
  'REBECCA_SERVICE_ID',
  'REBECCA_WEBHOOK_SECRET',
  'REBECCA_WEBHOOK_PATH',
  'DEFAULT_LOCALE',
  'INSTANCE_NAME',
  'REGISTRY_DIR',
  'SUPPORT_URL',
] as const;

const VALID_ADMIN_SECRET = 'a'.repeat(32);

function applyEnv(
  overrides: Partial<Record<(typeof ALL_CONFIG_KEYS)[number], string | undefined>>
) {
  for (const key of ALL_CONFIG_KEYS) {
    vi.stubEnv(key, undefined as unknown as string);
  }
  const base: Record<string, string> = {
    NODE_ENV: 'production',
    BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    ADMIN_IDS: '1001',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/rsbot',
    PANEL_CREDENTIALS_KEY: 'test-panel-credentials-key-0123456789',
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
  resetConfigForTesting();
}

describe('loadConfig — core validation, production rules, and port derivation', () => {
  beforeEach(() => {
    resetConfigForTesting();
  });

  afterEach(() => {
    resetConfigForTesting();
  });

  it('allows startup without ADMIN_IDS and defaults to empty array', () => {
    applyEnv({ ADMIN_IDS: undefined });
    expect(loadConfig().ADMIN_IDS).toEqual([]);
  });

  it('parses numeric administrator IDs and rejects invalid values', () => {
    applyEnv({ ADMIN_IDS: ' 1001, 2002 ,3003 ' });
    expect(loadConfig().ADMIN_IDS).toEqual([1001, 2002, 3003]);

    for (const invalid of ['0', '-5', '123abc', 'abc']) {
      applyEnv({ ADMIN_IDS: invalid });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');
    }
  });

  it('requires PANEL_CREDENTIALS_KEY in production but allows omission in test/dev', () => {
    applyEnv({ NODE_ENV: 'production', PANEL_CREDENTIALS_KEY: undefined });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');

    applyEnv({ NODE_ENV: 'test', PANEL_CREDENTIALS_KEY: undefined });
    expect(loadConfig().PANEL_CREDENTIALS_KEY).toBeUndefined();

    applyEnv({ NODE_ENV: 'production', PANEL_CREDENTIALS_KEY: 'too-short' });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('validates SUPPORT_URL and rejects malformed values', () => {
    applyEnv({ SUPPORT_URL: '' });
    expect(loadConfig().SUPPORT_URL).toBeUndefined();

    applyEnv({ SUPPORT_URL: 'https://t.me/support_user' });
    expect(loadConfig().SUPPORT_URL).toBe('https://t.me/support_user');

    applyEnv({ SUPPORT_URL: 'not-a-url' });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('allows deferred panel setup in production or accepts explicit admin credentials without API key', () => {
    applyEnv({});
    const deferred = loadConfig();
    expect(deferred.REBECCA_API_URL).toBeUndefined();
    expect(deferred.REBECCA_ADMIN_USERNAME).toBe('admin');

    applyEnv({
      REBECCA_API_URL: 'https://panel.example.com',
      REBECCA_ADMIN_PASSWORD: 'strong-password-123',
    });
    expect(loadConfig().REBECCA_API_URL).toBe('https://panel.example.com');

    applyEnv({ REBECCA_API_URL: 'https://panel.example.com' });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('falls back to default admin username and validates service ID and pool size bounds', () => {
    applyEnv({
      REBECCA_ADMIN_USERNAME: '',
      REBECCA_SERVICE_ID: '',
      DATABASE_POOL_SIZE: '35',
    });
    const config = loadConfig();
    expect(config.REBECCA_ADMIN_USERNAME).toBe('admin');
    expect(config.REBECCA_SERVICE_ID).toBe(1);
    expect(config.DATABASE_POOL_SIZE).toBe(35);

    applyEnv({ REBECCA_SERVICE_ID: '0' });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');
  });

  it('rejects malformed or NaN ports without leaking NaN into host ports', () => {
    applyEnv({ HEALTH_CHECK_PORT: 'abc' });
    expect(() => loadConfig()).toThrow('Invalid environment configuration');

    applyEnv({
      WEBHOOK_HOST_PORT: '',
      WEBAPP_HOST_PORT: '',
    });
    const clean = loadConfig();
    expect(clean.WEBHOOK_HOST_PORT).toBe(3000);
    expect(clean.WEBAPP_HOST_PORT).toBe(3002);
    expect(Number.isNaN(clean.WEBHOOK_HOST_PORT)).toBe(false);
    expect(Number.isNaN(clean.WEBAPP_HOST_PORT)).toBe(false);
  });

  describe('delivery mode, unified PORT, and WebApp port combinations', () => {
    it('1. Polling + WebApp OFF (defaults)', () => {
      applyEnv({});
      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBHOOK_PORT).toBe(3000);
      expect(config.HEALTH_CHECK_PORT).toBe(3001);
      expect(config.WEBAPP_PORT).toBe(3002);
      expect(config.WEBHOOK_HOST_PORT).toBe(3000);
      expect(config.WEBAPP_HOST_PORT).toBe(3002);
    });

    it('2. Polling + WebApp ON', () => {
      applyEnv({
        WEBAPP_URL: 'https://app.example.com/',
        ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET,
      });
      const config = loadConfig();
      expect(config.BOT_DELIVERY_MODE).toBe('polling');
      expect(config.WEBAPP_URL).toBe('https://app.example.com/');
      expect(config.WEBAPP_PORT).toBe(3002);
    });

    it('3. Webhook + WebApp OFF (explicit and inferred from WEBHOOK_URL)', () => {
      applyEnv({
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
      });
      const inferred = loadConfig();
      expect(inferred.BOT_DELIVERY_MODE).toBe('webhook');
      expect(inferred.WEBHOOK_PATH).toBe('/webhook');

      applyEnv({
        BOT_DELIVERY_MODE: 'polling',
        WEBHOOK_URL: 'https://bot.example.com',
      });
      expect(loadConfig().BOT_DELIVERY_MODE).toBe('polling');
    });

    it('4. Webhook + WebApp ON with custom host/port/path and distinct ports', () => {
      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        WEBHOOK_HOST: '0.0.0.0',
        WEBHOOK_PORT: '8443',
        WEBHOOK_HOST_PORT: '18443',
        WEBHOOK_PATH: 'hooks/telegram',
        HEALTH_CHECK_PORT: '8081',
        WEBAPP_URL: 'https://app.example.com',
        WEBAPP_PORT: '8082',
        WEBAPP_HOST_PORT: '18082',
        ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET,
        REBECCA_WEBHOOK_SECRET: 'rebecca-secret-xyz',
      });
      const config = loadConfig();
      expect(config.WEBHOOK_PORT).toBe(8443);
      expect(config.WEBHOOK_HOST_PORT).toBe(18443);
      expect(config.WEBHOOK_PATH).toBe('/hooks/telegram');
      expect(config.WEBAPP_HOST_PORT).toBe(18082);
      expect(config.REBECCA_WEBHOOK_PATH).toBe('/api/rebecca-webhook');
      expect(config.REBECCA_WEBHOOK_SECRET).toBe('rebecca-secret-xyz');
    });

    it('supports unified PORT in webhook mode while enforcing non-collision when WEBHOOK_PORT overrides PORT', () => {
      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        PORT: '8080',
      });
      const unified = loadConfig();
      expect(unified.WEBHOOK_PORT).toBe(8080);
      expect(unified.HEALTH_CHECK_PORT).toBe(8080);
      expect(unified.WEBHOOK_HOST_PORT).toBe(8080);

      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        PORT: '8080',
        WEBHOOK_PORT: '9000',
      });
      const split = loadConfig();
      expect(split.WEBHOOK_PORT).toBe(9000);
      expect(split.HEALTH_CHECK_PORT).toBe(8080);
      expect(split.WEBHOOK_HOST_PORT).toBe(9000);

      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        PORT: '8080',
        WEBHOOK_PORT: '9000',
        HEALTH_CHECK_PORT: '9000',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');
    });

    it('enforces webhook and WebApp security/port-collision rules', () => {
      // Missing secret or URL in webhook mode
      applyEnv({ BOT_DELIVERY_MODE: 'webhook', WEBHOOK_URL: 'https://bot.example.com' });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // Insecure HTTP webhook URL
      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'http://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // Disallowed chars in WEBHOOK_SECRET_TOKEN
      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'has space!',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // Equal WEBHOOK_PORT and HEALTH_CHECK_PORT without unified PORT
      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        WEBHOOK_PORT: '3001',
        HEALTH_CHECK_PORT: '3001',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // WebApp requires 32-char ADMIN_SESSION_SECRET and HTTPS URL
      applyEnv({ WEBAPP_URL: 'https://app.example.com', ADMIN_SESSION_SECRET: 'short' });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      applyEnv({ WEBAPP_URL: 'http://app.example.com', ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // WEBAPP_PORT cannot collide with HEALTH_CHECK_PORT, nor WEBHOOK_PORT in webhook mode
      applyEnv({
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET,
        WEBAPP_PORT: '3001',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      applyEnv({
        BOT_DELIVERY_MODE: 'webhook',
        WEBHOOK_URL: 'https://bot.example.com',
        WEBHOOK_SECRET_TOKEN: 'secret_token_123456',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET,
        WEBAPP_PORT: '3000',
      });
      expect(() => loadConfig()).toThrow('Invalid environment configuration');

      // Allowed in polling mode because webhook listener does not bind WEBHOOK_PORT
      applyEnv({
        BOT_DELIVERY_MODE: 'polling',
        WEBAPP_URL: 'https://app.example.com',
        ADMIN_SESSION_SECRET: VALID_ADMIN_SECRET,
        WEBAPP_PORT: '3000',
      });
      expect(loadConfig().WEBAPP_PORT).toBe(3000);
    });
  });

  it('caches parsed config until resetConfigForTesting() is called', () => {
    applyEnv({ DEFAULT_LOCALE: 'en' });
    const first = loadConfig();
    expect(first.DEFAULT_LOCALE).toBe('en');

    vi.stubEnv('DEFAULT_LOCALE', 'fa');
    expect(loadConfig().DEFAULT_LOCALE).toBe('en');

    resetConfigForTesting();
    expect(loadConfig().DEFAULT_LOCALE).toBe('fa');
  });
});

describe('validateRebeccaBaseUrl', () => {
  it('normalizes clean HTTPS origins and rejects non-root paths, query/hash, credentials, and HTTP', () => {
    expect(validateRebeccaBaseUrl('https://panel.example.com:8443/')).toBe(
      'https://panel.example.com:8443'
    );
    expect(() => validateRebeccaBaseUrl('https://panel.example.com/dashboard/login')).toThrow();
    expect(() => validateRebeccaBaseUrl('https://panel.example.com/api')).toThrow();
    expect(() => validateRebeccaBaseUrl('https://user:pass@panel.example.com')).toThrow();
    expect(() => validateRebeccaBaseUrl('https://panel.example.com?x=1')).toThrow();
    expect(() => validateRebeccaBaseUrl('http://panel.example.com')).toThrow();
  });
});
