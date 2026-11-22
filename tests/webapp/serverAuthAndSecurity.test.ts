import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateTelegramInitData } from '../../src/webapp/server/auth.js';
import {
  createWebAppServer,
  extractClientIdentity,
  resolveCorsAllowlist,
  resolveCorsOptions,
  resolveRateLimitKey,
  resolveTrustProxy,
} from '../../src/webapp/server/server.js';
import { DomainRegistryService } from '../../src/domain/services/DomainRegistryService.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../src/telegram/types.js';
import {
  TEST_BOT_TOKEN,
  createMockBaseServices,
  createResettableRateLimitStore,
  createSignedInitData,
  createTestConfig,
} from './helpers/webappTestHarness.js';

describe('WebApp Server Auth, Security & Mesh Proxy', () => {
  describe('validateTelegramInitData', () => {
    const testBotToken = '123456789:ABCDefghIJKLmnOPqrstUVwxyz';
    const validUser = {
      id: 987654321,
      first_name: 'Test',
      last_name: 'Admin',
      username: 'testadmin',
    };

    it('validates authentic and fresh initData correctly', () => {
      const now = Math.floor(Date.now() / 1000);
      const rawInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now - 60),
          query_id: 'AAHdF6IQAAAAAN0XohD_xxxx',
          user: JSON.stringify(validUser),
        },
      });

      const result = validateTelegramInitData(rawInitData, testBotToken);
      expect(result).not.toBeNull();
      expect(result?.user.id).toBe(987654321);
      expect(result?.user.username).toBe('testadmin');
      expect(result?.authDate).toBe(now - 60);
      expect(result?.queryId).toBe('AAHdF6IQAAAAAN0XohD_xxxx');
    });

    it('rejects tampered hash with timingSafeEqual', () => {
      const now = Math.floor(Date.now() / 1000);
      const rawInitData = createSignedInitData({
        botToken: testBotToken,
        tamperHash: true,
        fields: {
          auth_date: String(now),
          user: JSON.stringify(validUser),
        },
      });

      expect(validateTelegramInitData(rawInitData, testBotToken)).toBeNull();
    });

    it('rejects tampered payload fields', () => {
      const now = Math.floor(Date.now() / 1000);
      const rawInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now),
          user: JSON.stringify(validUser),
        },
      });

      const tampered = rawInitData.replace('987654321', '111111111');
      expect(validateTelegramInitData(tampered, testBotToken)).toBeNull();
    });

    it('rejects expired auth_date (older than 24 hours)', () => {
      const now = Math.floor(Date.now() / 1000);
      const rawInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now - 86_500),
          user: JSON.stringify(validUser),
        },
      });

      expect(validateTelegramInitData(rawInitData, testBotToken)).toBeNull();
    });

    it('rejects future auth_date (> 5 minutes in future)', () => {
      const now = Math.floor(Date.now() / 1000);
      const rawInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now + 600),
          user: JSON.stringify(validUser),
        },
      });

      expect(validateTelegramInitData(rawInitData, testBotToken)).toBeNull();
    });

    it('rejects missing hash, empty string, or malformed user JSON', () => {
      expect(validateTelegramInitData('', testBotToken)).toBeNull();
      expect(validateTelegramInitData('auth_date=123456&user={}', testBotToken)).toBeNull();
      expect(
        validateTelegramInitData(
          createSignedInitData({
            botToken: testBotToken,
            fields: {
              auth_date: String(Math.floor(Date.now() / 1000)),
              user: 'not-valid-json',
            },
          }),
          testBotToken
        )
      ).toBeNull();
    });

    it('rejects empty or non-string botToken before deriving HMAC secret', () => {
      const rawInitData = createSignedInitData({ botToken: testBotToken });
      expect(validateTelegramInitData(rawInitData, '')).toBeNull();
      expect(validateTelegramInitData(rawInitData, '   ')).toBeNull();
      expect(validateTelegramInitData(rawInitData, null as unknown as string)).toBeNull();
    });

    it('rejects duplicate parameter keys (parameter pollution defense)', () => {
      const now = Math.floor(Date.now() / 1000);
      const signed = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now),
          user: JSON.stringify(validUser),
        },
      });
      const polluted = `${signed}&user=${encodeURIComponent(JSON.stringify({ id: 1 }))}`;
      expect(validateTelegramInitData(polluted, testBotToken)).toBeNull();
    });

    it('rejects array or invalid user ID payloads inside signed user JSON', () => {
      const now = Math.floor(Date.now() / 1000);
      const arrayUserInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now),
          user: JSON.stringify([123, 'bad']),
        },
      });
      const zeroIdInitData = createSignedInitData({
        botToken: testBotToken,
        fields: {
          auth_date: String(now),
          user: JSON.stringify({ id: 0, first_name: 'Bad' }),
        },
      });

      expect(validateTelegramInitData(arrayUserInitData, testBotToken)).toBeNull();
      expect(validateTelegramInitData(zeroIdInitData, testBotToken)).toBeNull();
    });
  });

  describe('Auth & Locale Endpoints', () => {
    let app: FastifyInstance;
    let mockUserService: ReturnType<typeof createMockBaseServices>['mockUserService'];
    let mockTranslationService: ReturnType<typeof createMockBaseServices>['mockTranslationService'];
    const rateLimits = createResettableRateLimitStore();

    beforeAll(async () => {
      const base = createMockBaseServices();
      mockUserService = base.mockUserService;
      mockTranslationService = base.mockTranslationService;
      app = await createWebAppServer(createTestConfig(), base.mockServices, {
        serveStatic: false,
        rateLimitStore: rateLimits.Store,
      });
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      rateLimits.reset();
      mockTranslationService.getSettingBool.mockImplementation(
        (key: string, defaultValue = false) => {
          if (key === 'language_selection_enabled') return true;
          if (key === 'webapp_enabled') return true;
          return defaultValue;
        }
      );
    });

    it('authenticates admin user, sets session cookie, and returns Bearer token', async () => {
      const initData = createSignedInitData({ userId: 12345, botToken: TEST_BOT_TOKEN });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('admin');
      expect(body.user.id).toBe(12345);
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(10);
      expect(response.cookies.some((c) => c.name === 'session')).toBe(true);

      const localeResponse = await app.inject({
        method: 'POST',
        url: '/api/user/locale',
        headers: {
          authorization: `Bearer ${body.token}`,
        },
        payload: { locale: 'en' },
      });
      expect(localeResponse.statusCode).toBe(200);
      expect(mockUserService.updateLocale).toHaveBeenCalledWith(12345, 'en');
    });

    it('authenticates regular user with user role, returning token, locale and settings', async () => {
      const initData = createSignedInitData({ userId: 55555, botToken: TEST_BOT_TOKEN });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('user');
      expect(body.user.id).toBe(55555);
      expect(typeof body.token).toBe('string');
      expect(body.locale).toBe('en');
      expect(body.languageSelectionEnabled).toBe(true);
      expect(response.cookies.some((c) => c.name === 'session')).toBe(true);
    });

    it('falls back to default locale if user has no stored locale', async () => {
      const initData = createSignedInitData({ userId: 99999, botToken: TEST_BOT_TOKEN });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.locale).toBe('fa');
      expect(body.languageSelectionEnabled).toBe(true);
    });

    it('rejects invalid or tampered initData with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData: 'auth_date=123&user={}&hash=fakehash' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('enforces per-route strict rate limiting on POST /api/auth/telegram-validate (429 after 10 attempts)', async () => {
      const initData = createSignedInitData({ userId: 55555, botToken: TEST_BOT_TOKEN });

      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/telegram-validate',
          payload: { initData },
        });
        expect(res.statusCode).toBe(200);
      }

      const rateLimited = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });
      expect(rateLimited.statusCode).toBe(429);
    });

    describe('POST /api/user/locale', () => {
      it('returns 401 for unauthenticated request', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/user/locale',
          payload: { locale: 'en' },
        });
        expect(response.statusCode).toBe(401);
      });

      it('returns 400 for invalid locale value', async () => {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });
        const response = await app.inject({
          method: 'POST',
          url: '/api/user/locale',
          headers: { authorization: `Bearer ${token}` },
          payload: { locale: 'invalid' },
        });
        expect(response.statusCode).toBe(400);
      });

      it('updates user locale when language_selection_enabled is true', async () => {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });
        const response = await app.inject({
          method: 'POST',
          url: '/api/user/locale',
          headers: { authorization: `Bearer ${token}` },
          payload: { locale: 'en' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, locale: 'en' });
        expect(mockUserService.updateLocale).toHaveBeenCalledWith(55555, 'en');
      });

      it('returns 403 when language_selection_enabled is false', async () => {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });
        mockTranslationService.getSettingBool.mockImplementation((key: string) => {
          if (key === 'language_selection_enabled') return false;
          return true;
        });

        const response = await app.inject({
          method: 'POST',
          url: '/api/user/locale',
          headers: { authorization: `Bearer ${token}` },
          payload: { locale: 'en' },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toContain('disabled');
      });
    });
  });

  describe('Server Security — CORS, trustProxy, JWT Identity & Rate Limiting', () => {
    const baseConfig = createTestConfig({
      WEBAPP_URL: 'https://app.example.com',
      WEBHOOK_URL: 'https://webhook.example.com/bot',
    } as Partial<Config>);

    const { mockServices } = createMockBaseServices();

    describe('CORS Fail-Closed Semantics', () => {
      it('resolves allowlist from WEBAPP_URL and WEBHOOK_URL', () => {
        const allowlist = resolveCorsAllowlist(baseConfig);
        expect(allowlist).toContain('https://app.example.com');
        expect(allowlist).toContain('https://webhook.example.com');
        expect(allowlist).toHaveLength(2);
      });

      it('returns empty array when no URLs are configured (fail-closed)', () => {
        const emptyConfig = createTestConfig({
          WEBAPP_URL: '',
          WEBHOOK_URL: '',
        } as Partial<Config>);
        expect(resolveCorsAllowlist(emptyConfig)).toEqual([]);

        const corsOpts = resolveCorsOptions(emptyConfig);
        expect(corsOpts.origin).toBe(false);
        expect(corsOpts.credentials).toBe(false);
      });

      it('allows wildcard only via explicit opt-in and NEVER with credentials', () => {
        const wildcardConfig = createTestConfig({
          WEBAPP_URL: 'https://app.example.com',
          CORS_ALLOW_ALL: 'true',
        } as Partial<Config>);
        const corsOpts = resolveCorsOptions(wildcardConfig);
        expect(corsOpts.origin).toBe('*');
        expect(corsOpts.credentials).toBe(false);
      });

      it('permits authorized origin with credentials: true', async () => {
        const app = await createWebAppServer(baseConfig, mockServices, { serveStatic: false });
        try {
          const res = await app.inject({
            method: 'OPTIONS',
            url: '/api/caddy-check',
            headers: {
              origin: 'https://app.example.com',
              'access-control-request-method': 'GET',
            },
          });
          expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
          expect(res.headers['access-control-allow-credentials']).toBe('true');
        } finally {
          await app.close();
        }
      });

      it('rejects unauthorized origin by omitting Access-Control-Allow-Origin', async () => {
        const app = await createWebAppServer(baseConfig, mockServices, { serveStatic: false });
        try {
          const res = await app.inject({
            method: 'OPTIONS',
            url: '/api/caddy-check',
            headers: {
              origin: 'https://evil-attacker.com',
              'access-control-request-method': 'GET',
            },
          });
          expect(res.headers['access-control-allow-origin']).toBeUndefined();
        } finally {
          await app.close();
        }
      });

      it('fail-closed: rejects all origins when allowlist is empty', async () => {
        const emptyConfig = createTestConfig({
          WEBAPP_URL: '',
          WEBHOOK_URL: '',
        } as Partial<Config>);
        const app = await createWebAppServer(emptyConfig, mockServices, { serveStatic: false });
        try {
          const res = await app.inject({
            method: 'OPTIONS',
            url: '/api/caddy-check',
            headers: {
              origin: 'https://app.example.com',
              'access-control-request-method': 'GET',
            },
          });
          expect(res.headers['access-control-allow-origin']).toBeUndefined();
        } finally {
          await app.close();
        }
      });
    });

    describe('trustProxy, Verified JWT Identity & Rate Limit Keys', () => {
      it('constrains default trustProxy to Caddy / loopback / private subnets instead of arbitrary true', () => {
        const trusted = resolveTrustProxy(baseConfig);
        expect(Array.isArray(trusted)).toBe(true);
        expect(trusted).toContain('127.0.0.1');
        expect(trusted).toContain('::1');
        expect(trusted).toContain('10.0.0.0/8');
        expect(trusted).toContain('172.16.0.0/12');
        expect(trusted).toContain('192.168.0.0/16');
      });

      it('extracts user:<telegramId> for verified userSession or cryptographically verified JWT', async () => {
        const app = await createWebAppServer(baseConfig, mockServices, { serveStatic: false });
        try {
          const validToken = app.jwt.sign({ telegramId: 443322, role: 'user' });

          const sessionReq = {
            userSession: { telegramId: 98765, role: 'user' },
            ip: '198.51.100.20',
            headers: {},
            raw: { socket: { remoteAddress: '198.51.100.20' } },
          } as unknown as FastifyRequest;
          expect(extractClientIdentity(sessionReq)).toBe('user:98765');

          const cookieReq = {
            cookies: { session: validToken },
            headers: {},
            ip: '198.51.100.20',
            server: app,
            raw: { socket: { remoteAddress: '198.51.100.20' } },
          } as unknown as FastifyRequest;
          expect(extractClientIdentity(cookieReq)).toBe('user:443322');

          const mixedCaseBearerReq = {
            cookies: {},
            headers: { authorization: `bEaReR ${validToken}` },
            ip: '198.51.100.20',
            server: app,
            raw: { socket: { remoteAddress: '198.51.100.20' } },
          } as unknown as FastifyRequest;
          expect(extractClientIdentity(mixedCaseBearerReq)).toBe('user:443322');
        } finally {
          await app.close();
        }
      });

      it('rejects forged, wrong-secret, or non-positive JWT identities and falls back to ip:<ip>', async () => {
        const app = await createWebAppServer(baseConfig, mockServices, { serveStatic: false });
        const wrongSecretApp = await createWebAppServer(
          createTestConfig({
            ADMIN_SESSION_SECRET: 'wrong_secret_definitely_different_from_real_32',
          }),
          mockServices,
          { serveStatic: false }
        );
        try {
          const forgedToken = wrongSecretApp.jwt.sign({ telegramId: 55555, role: 'user' });
          const zeroIdToken = app.jwt.sign({ telegramId: 0, role: 'user' });

          const forgedReq = {
            cookies: { session: forgedToken },
            headers: { authorization: `Bearer ${forgedToken}` },
            ip: '203.0.113.50',
            server: app,
            raw: { socket: { remoteAddress: '203.0.113.50' } },
          } as unknown as FastifyRequest;
          expect(extractClientIdentity(forgedReq)).toBe('ip:203.0.113.50');

          const zeroIdReq = {
            cookies: { session: zeroIdToken },
            headers: {},
            ip: '203.0.113.51',
            server: app,
            raw: { socket: { remoteAddress: '203.0.113.51' } },
          } as unknown as FastifyRequest;
          expect(extractClientIdentity(zeroIdReq)).toBe('ip:203.0.113.51');
        } finally {
          await wrongSecretApp.close();
          await app.close();
        }
      });

      it('isolates forged-JWT callers from legitimate user rate-limit buckets in live Fastify server', async () => {
        const app = await createWebAppServer(baseConfig, mockServices, { serveStatic: false });
        const wrongApp = await createWebAppServer(
          createTestConfig({
            ADMIN_SESSION_SECRET: 'attacker_forged_secret_at_least_32_characters!!',
          }),
          mockServices,
          { serveStatic: false }
        );
        try {
          let customHits = 0;
          app.get(
            '/api/test-rate-limit',
            { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
            async () => {
              customHits += 1;
              return { hits: customHits };
            }
          );

          const forgedToken = wrongApp.jwt.sign({ telegramId: 55555, role: 'user' });
          const legitimateToken = app.jwt.sign({ telegramId: 55555, role: 'user' });

          // Attacker exhausts IP rate-limit using a forged token claiming telegramId=55555
          expect(
            (
              await app.inject({
                method: 'GET',
                url: '/api/test-rate-limit',
                headers: { authorization: `Bearer ${forgedToken}` },
              })
            ).statusCode
          ).toBe(200);
          expect(
            (
              await app.inject({
                method: 'GET',
                url: '/api/test-rate-limit',
                headers: { authorization: `Bearer ${forgedToken}` },
              })
            ).statusCode
          ).toBe(200);
          expect(
            (
              await app.inject({
                method: 'GET',
                url: '/api/test-rate-limit',
                headers: { authorization: `Bearer ${forgedToken}` },
              })
            ).statusCode
          ).toBe(429);

          // Real user 55555 still has their own untouched rate-limit bucket!
          const legitRes = await app.inject({
            method: 'GET',
            url: '/api/test-rate-limit',
            headers: { authorization: `Bearer ${legitimateToken}` },
          });
          expect(legitRes.statusCode).toBe(200);
        } finally {
          await wrongApp.close();
          await app.close();
        }
      });

      it('differentiates rate limit keys per-route and per-identity', () => {
        const reqProfileUser1 = {
          routeOptions: { url: '/api/user/profile' },
          userSession: { telegramId: 1001 },
          ip: '203.0.113.1',
        } as unknown as FastifyRequest;

        const reqConfigsUser1 = {
          routeOptions: { url: '/api/user/configs' },
          userSession: { telegramId: 1001 },
          ip: '203.0.113.1',
        } as unknown as FastifyRequest;

        const reqProfileUser2 = {
          routeOptions: { url: '/api/user/profile' },
          userSession: { telegramId: 1002 },
          ip: '203.0.113.1',
        } as unknown as FastifyRequest;

        const reqProfileAnon = {
          routeOptions: { url: '/api/user/profile' },
          ip: '203.0.113.1',
          raw: { socket: { remoteAddress: '203.0.113.1' } },
        } as unknown as FastifyRequest;

        const keyProfile1 = resolveRateLimitKey(reqProfileUser1);
        const keyConfigs1 = resolveRateLimitKey(reqConfigsUser1);
        const keyProfile2 = resolveRateLimitKey(reqProfileUser2);
        const keyProfileAnon = resolveRateLimitKey(reqProfileAnon);

        expect(keyProfile1).toBe('/api/user/profile:user:1001');
        expect(keyConfigs1).toBe('/api/user/configs:user:1001');
        expect(keyProfile2).toBe('/api/user/profile:user:1002');
        expect(keyProfileAnon).toBe('/api/user/profile:ip:203.0.113.1');

        expect(keyProfile1).not.toBe(keyConfigs1);
        expect(keyProfile1).not.toBe(keyProfile2);
        expect(keyProfile1).not.toBe(keyProfileAnon);
      });
    });
  });

  describe('Caddy TLS Check & Multi-Instance Mesh Reverse Proxy', () => {
    let tempRegistryDir: string;
    let registryService: DomainRegistryService;
    let mainApp: FastifyInstance;
    let shop2App: FastifyInstance;
    let shop2Port: number;
    let mainSettingOverride: string | undefined;

    beforeAll(async () => {
      tempRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsbot-mesh-test-'));
      registryService = new DomainRegistryService(tempRegistryDir);

      const shop2Config: Config = createTestConfig({
        BOT_TOKEN: '11111:shop2_token',
        DATABASE_URL: 'postgres://rsbot_user:pass@localhost:5432/rsbot_shop2',
        PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
        INSTANCE_NAME: 'shop2',
        WEBHOOK_HOST_PORT: 3000,
        WEBAPP_PORT: 0,
        WEBAPP_HOST_PORT: 3003,
        WEBAPP_HOST: '127.0.0.1',
        WEBAPP_URL: 'https://shop2.example.com',
        ADMIN_SESSION_SECRET: 'b'.repeat(32),
        REGISTRY_DIR: tempRegistryDir,
      } as Partial<Config>);

      const { mockServices: shop2Services } = createMockBaseServices({
        translationService: {
          getDefaultLocale: () => 'fa',
          getSetting: (key: string) => (key === 'webapp_url' ? 'https://shop2.example.com' : ''),
          getSettingBool: (key: string) => key === 'webapp_enabled',
        } as any,
        adminService: { adminIds: [12345], isAdmin: () => true } as any,
        webAppUrl: 'https://shop2.example.com',
        domainRegistryService: registryService,
        adminIds: [12345],
        isAdmin: () => true,
      } as Partial<BotServices>);

      shop2App = await createWebAppServer(shop2Config, shop2Services);
      shop2App.get('/api/test-shop2', async (_req, reply) => {
        return reply.send({ instance: 'shop2', message: 'Hello from shop2!' });
      });
      shop2App.get('/api/caddy-check-other', async (_req, reply) => {
        return reply.send({ instance: 'shop2', path: '/api/caddy-check-other' });
      });
      shop2App.get('/api/inspect-headers', async (req, reply) => {
        return reply.send({ headers: req.headers });
      });

      const shop2Address = await shop2App.listen({ port: 0, host: '127.0.0.1' });
      shop2Port = Number(new URL(shop2Address).port);

      registryService.register({
        instance: 'shop2',
        domain: 'shop2.example.com',
        url: 'https://shop2.example.com',
        target: `http://127.0.0.1:${shop2Port}`,
        hostPort: 3003,
      });

      const mainConfig: Config = createTestConfig({
        BOT_TOKEN: '22222:main_token',
        DATABASE_URL: 'postgres://rsbot_user:pass@localhost:5432/rsbot_main',
        PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
        INSTANCE_NAME: 'main',
        WEBHOOK_HOST_PORT: 3000,
        WEBAPP_PORT: 0,
        WEBAPP_HOST_PORT: 3002,
        WEBAPP_HOST: '127.0.0.1',
        WEBAPP_URL: 'https://main.example.com',
        ADMIN_SESSION_SECRET: 'c'.repeat(32),
        REGISTRY_DIR: tempRegistryDir,
      } as Partial<Config>);

      const { mockServices: mainServices } = createMockBaseServices({
        translationService: {
          getDefaultLocale: () => 'fa',
          getSetting: (key: string) =>
            key === 'webapp_url' ? (mainSettingOverride ?? 'https://main.example.com') : '',
          getSettingBool: (key: string) => key === 'webapp_enabled',
        } as any,
        adminService: { adminIds: [12345], isAdmin: () => true } as any,
        webAppUrl: 'https://main.example.com',
        domainRegistryService: registryService,
        adminIds: [12345],
        isAdmin: () => true,
      } as Partial<BotServices>);

      mainApp = await createWebAppServer(mainConfig, mainServices);
      mainApp.get('/api/test-main', async (_req, reply) => {
        return reply.send({ instance: 'main', message: 'Hello from main!' });
      });

      await mainApp.listen({ port: 0, host: '127.0.0.1' });
    });

    afterEach(() => {
      mainSettingOverride = undefined;
    });

    afterAll(async () => {
      await mainApp?.close();
      await shop2App?.close();
      try {
        fs.rmSync(tempRegistryDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    });

    describe('Caddy TLS Verification Endpoint (/api/caddy-check)', () => {
      it('returns 400 when domain parameter is missing', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check',
        });
        expect(res.statusCode).toBe(400);
      });

      it('approves local instance domain including dynamic webapp_url setting override', async () => {
        const directRes = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check?domain=main.example.com',
        });
        expect(directRes.statusCode).toBe(200);
        expect(directRes.json()).toMatchObject({ allowed: true, domain: 'main.example.com' });

        mainSettingOverride = 'https://rs.netiva.ir';
        const overrideRes = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check?domain=rs.netiva.ir',
        });
        expect(overrideRes.statusCode).toBe(200);
        expect(overrideRes.json()).toEqual({ allowed: true, domain: 'rs.netiva.ir' });
      });

      it('approves shop2 domain via shared multi-instance registry', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check?domain=shop2.example.com',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ allowed: true, instance: 'shop2' });
      });

      it('returns 403 for unregistered or malicious domains', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check?domain=malicious.com',
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ allowed: false, domain: 'malicious.com' });
      });
    });

    describe('Mesh Reverse Proxy Dispatching', () => {
      it('handles local main request directly on main instance', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/test-main',
          headers: { host: 'main.example.com' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ instance: 'main', message: 'Hello from main!' });
      });

      it('transparently proxies shop2 domain request from mainApp to shop2App', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/test-shop2',
          headers: { host: 'shop2.example.com' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ instance: 'shop2', message: 'Hello from shop2!' });
      });

      it('does NOT bypass mesh proxy on path prefix collision (/api/caddy-check-other)', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/caddy-check-other',
          headers: { host: 'shop2.example.com' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ instance: 'shop2', path: '/api/caddy-check-other' });
      });

      it('proxies health check for shop2 domain during SSL probe', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/health',
          headers: { host: 'shop2.example.com' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'ok', component: 'webapp' });
      });

      it('strips standard and Connection-listed hop-by-hop headers before proxying upstream', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/inspect-headers',
          headers: {
            host: 'shop2.example.com',
            connection: 'keep-alive, x-secret-hop',
            'x-secret-hop': 'must-be-stripped',
            'proxy-authorization': 'Basic secret',
            upgrade: 'websocket',
            'x-preserved-header': 'keep-me',
          },
        });
        expect(res.statusCode).toBe(200);
        const forwardedHeaders = res.json().headers as Record<string, string>;
        expect(forwardedHeaders['x-preserved-header']).toBe('keep-me');
        expect(forwardedHeaders['x-secret-hop']).toBeUndefined();
        expect(forwardedHeaders['proxy-authorization']).toBeUndefined();
        expect(forwardedHeaders['upgrade']).toBeUndefined();
        expect(forwardedHeaders['x-rsbot-proxy-hops']).toBe('1');
      });

      it('rejects malformed or negative x-rsbot-proxy-hops with 400 Bad Request', async () => {
        for (const badValue of ['abc', '-1', '1.5']) {
          const res = await mainApp.inject({
            method: 'GET',
            url: '/api/test-shop2',
            headers: {
              host: 'shop2.example.com',
              'x-rsbot-proxy-hops': badValue,
            },
          });
          expect(res.statusCode).toBe(400);
          expect(res.json().error).toBe('Invalid proxy hop header');
        }
      });

      it('detects proxy loops and returns 508 Loop Detected', async () => {
        const res = await mainApp.inject({
          method: 'GET',
          url: '/api/test-shop2',
          headers: {
            host: 'shop2.example.com',
            'x-rsbot-proxy-hops': '3',
          },
        });
        expect(res.statusCode).toBe(508);
        expect(res.json().error).toContain('Loop detected');
      });

      it('rejects unsupported upstream protocols and handles unreachable HTTP/HTTPS peers cleanly', async () => {
        registryService.register({
          instance: 'bad_proto',
          domain: 'badproto.example.com',
          url: 'https://badproto.example.com',
          target: 'ftp://127.0.0.1:2121',
          hostPort: 3005,
        });
        const badProtoRes = await mainApp.inject({
          method: 'GET',
          url: '/api/any',
          headers: { host: 'badproto.example.com' },
        });
        expect(badProtoRes.statusCode).toBe(502);
        expect(badProtoRes.json().error).toContain('Unsupported peer target protocol');

        registryService.register({
          instance: 'dead_http',
          domain: 'dead.example.com',
          url: 'https://dead.example.com',
          target: 'http://127.0.0.1:59999',
          hostPort: 3004,
        });
        const deadHttpRes = await mainApp.inject({
          method: 'GET',
          url: '/api/any-endpoint',
          headers: { host: 'dead.example.com' },
        });
        expect(deadHttpRes.statusCode).toBe(502);
        expect(deadHttpRes.json().error).toContain(
          "Target instance 'dead_http' is temporarily unreachable"
        );

        registryService.register({
          instance: 'dead_https',
          domain: 'deadhttps.example.com',
          url: 'https://deadhttps.example.com',
          target: 'https://127.0.0.1:59998',
          hostPort: 3006,
        });
        const deadHttpsRes = await mainApp.inject({
          method: 'GET',
          url: '/api/any-endpoint',
          headers: { host: 'deadhttps.example.com' },
        });
        expect(deadHttpsRes.statusCode).toBe(502);
        expect(deadHttpsRes.json().error).toContain(
          "Target instance 'dead_https' is temporarily unreachable"
        );
      });
    });
  });
});
