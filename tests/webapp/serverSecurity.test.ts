import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  createWebAppServer,
  resolveCorsAllowlist,
  resolveCorsOptions,
  resolveTrustProxy,
  extractClientIdentity,
  resolveRateLimitKey,
} from '../../src/webapp/server/server.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../telegram/types.js';

describe('T5 & T6: Server Security — CORS, trustProxy, and Rate Limiting', () => {
  const baseConfig = {
    NODE_ENV: 'test',
    BOT_TOKEN: '123456:test_token',
    ADMIN_IDS: [12345],
    DEFAULT_LOCALE: 'fa',
    INSTANCE_NAME: 'test',
    WEBAPP_URL: 'https://app.example.com',
    WEBHOOK_URL: 'https://webhook.example.com/bot',
    WEBAPP_PORT: 3002,
    WEBAPP_HOST: '0.0.0.0',
    ADMIN_SESSION_SECRET: 'test_session_secret_at_least_32_characters_long!!',
  } as unknown as Config;

  const mockServices = {
    adminService: { isAdmin: vi.fn(() => false) },
    walletService: {},
    userService: {},
    configService: {},
    pricingService: {},
    translationService: { getDefaultLocale: () => 'fa' },
    panelRegistry: {},
    botUsername: 'TestBot',
  } as unknown as BotServices;

  describe('T5: CORS Fail-Closed Semantics', () => {
    it('resolves allowlist from WEBAPP_URL and WEBHOOK_URL', () => {
      const allowlist = resolveCorsAllowlist(baseConfig);
      expect(allowlist).toContain('https://app.example.com');
      expect(allowlist).toContain('https://webhook.example.com');
      expect(allowlist).toHaveLength(2);
    });

    it('returns empty array when no URLs are configured (fail-closed)', () => {
      const emptyConfig = {
        ...baseConfig,
        WEBAPP_URL: '',
        WEBHOOK_URL: '',
      } as unknown as Config;
      const allowlist = resolveCorsAllowlist(emptyConfig);
      expect(allowlist).toEqual([]);

      const corsOpts = resolveCorsOptions(emptyConfig);
      expect(corsOpts.origin).toBe(false);
      expect(corsOpts.credentials).toBe(false);
    });

    it('allows wildcard only via explicit opt-in and NEVER with credentials', () => {
      const wildcardConfig = {
        ...baseConfig,
        CORS_ALLOW_ALL: 'true',
      } as unknown as Config;
      const corsOpts = resolveCorsOptions(wildcardConfig);
      expect(corsOpts.origin).toBe('*');
      expect(corsOpts.credentials).toBe(false);
    });

    it('permits authorized origin with credentials: true', async () => {
      const app = await createWebAppServer(baseConfig, mockServices);
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
      const app = await createWebAppServer(baseConfig, mockServices);
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
      const emptyConfig = {
        ...baseConfig,
        WEBAPP_URL: '',
        WEBHOOK_URL: '',
      } as unknown as Config;

      const app = await createWebAppServer(emptyConfig, mockServices);
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

  describe('T6: trustProxy & Rate Limit Key Resolution', () => {
    it('constrains default trustProxy to Caddy / loopback / private subnets instead of arbitrary true', () => {
      const trusted = resolveTrustProxy(baseConfig);
      expect(Array.isArray(trusted)).toBe(true);
      expect(trusted).toContain('127.0.0.1');
      expect(trusted).toContain('::1');
      expect(trusted).toContain('10.0.0.0/8');
      expect(trusted).toContain('172.16.0.0/12');
      expect(trusted).toContain('192.168.0.0/16');
    });

    it('extracts client identity: authenticated user with session uses user:<telegramId>', () => {
      const req = {
        userSession: { telegramId: 98765, role: 'user' },
        ip: '198.51.100.20',
        headers: {},
        raw: { socket: { remoteAddress: '198.51.100.20' } },
      } as unknown as FastifyRequest;

      const identity = extractClientIdentity(req);
      expect(identity).toBe('user:98765');
    });

    it('extracts client identity: authenticated user with JWT cookie uses user:<telegramId>', () => {
      const req = {
        cookies: { session: 'mock_jwt_token' },
        headers: {},
        ip: '198.51.100.20',
        server: {
          jwt: {
            decode: vi.fn(() => ({ telegramId: 443322 })),
          },
        },
        raw: { socket: { remoteAddress: '198.51.100.20' } },
      } as unknown as FastifyRequest;

      const identity = extractClientIdentity(req);
      expect(identity).toBe('user:443322');
    });

    it('extracts client identity: unauthenticated request falls back to validated ip:<ip>', () => {
      const req = {
        ip: '203.0.113.50',
        headers: {},
        raw: { socket: { remoteAddress: '203.0.113.50' } },
      } as unknown as FastifyRequest;

      const identity = extractClientIdentity(req);
      expect(identity).toBe('ip:203.0.113.50');
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

      // Each is distinct!
      expect(keyProfile1).not.toBe(keyConfigs1);
      expect(keyProfile1).not.toBe(keyProfile2);
      expect(keyProfile1).not.toBe(keyProfileAnon);
    });
  });
});
