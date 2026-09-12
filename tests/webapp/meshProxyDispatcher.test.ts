import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { DomainRegistryService } from '../../src/domain/services/DomainRegistryService.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../src/telegram/types.js';

describe('Multi-Instance Mesh Proxy Dispatcher & Caddy Integration', () => {
  let tempRegistryDir: string;
  let registryService: DomainRegistryService;
  let mainApp: FastifyInstance;
  let shop2App: FastifyInstance;
  let shop2Port: number;

  beforeAll(async () => {
    tempRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsbot-mesh-test-'));
    registryService = new DomainRegistryService(tempRegistryDir);

    // 1. Setup shop2 Fastify instance (simulating secondary bot)
    const shop2Config: Config = {
      NODE_ENV: 'test',
      BOT_TOKEN: '11111:shop2_token',
      ADMIN_IDS: [12345],
      DATABASE_URL: 'postgres://rsbot_user:pass@localhost:5432/rsbot_shop2',
      PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
      REBECCA_ADMIN_USERNAME: 'admin',
      REBECCA_SERVICE_ID: 1,
      DEFAULT_LOCALE: 'fa',
      INSTANCE_NAME: 'shop2',
      BOT_DELIVERY_MODE: 'polling',
      WEBHOOK_PORT: 3000,
      WEBHOOK_HOST_PORT: 3000,
      WEBHOOK_HOST: '0.0.0.0',
      WEBAPP_PORT: 0, // dynamic ephemeral port
      WEBAPP_HOST_PORT: 3003,
      WEBAPP_HOST: '127.0.0.1',
      WEBAPP_URL: 'https://shop2.example.com',
      ADMIN_SESSION_SECRET: 'b'.repeat(32),
      REGISTRY_DIR: tempRegistryDir,
    };

    const shop2Services: BotServices = {
      walletService: {} as any,
      configService: {} as any,
      pricingService: {} as any,
      packageCategoryService: {} as any,
      paymentService: {} as any,
      purchaseCheckoutService: {} as any,
      promoService: {} as any,
      referralService: {} as any,
      trialService: {} as any,
      translationService: {
        getSetting: (key: string) => (key === 'webapp_url' ? 'https://shop2.example.com' : ''),
        getSettingBool: (key: string) => (key === 'webapp_enabled' ? true : false),
      } as any,
      panelRegistry: {} as any,
      userService: {} as any,
      adminService: { adminIds: [12345], isAdmin: () => true } as any,
      refundService: {} as any,
      configTransferService: {} as any,
      configReconciliationService: {} as any,
      broadcastService: {} as any,
      backupService: {} as any,
      luckyWheelService: {} as any,
      webAppUrl: 'https://shop2.example.com',
      domainRegistryService: registryService,
      adminIds: [12345],
      isAdmin: () => true,
    };

    shop2App = await createWebAppServer(shop2Config, shop2Services);
    // Add a test endpoint on shop2 to verify routed requests
    shop2App.get('/api/test-shop2', async (_req, reply) => {
      return reply.send({ instance: 'shop2', message: 'Hello from shop2!' });
    });

    const shop2Address = await shop2App.listen({ port: 0, host: '127.0.0.1' });
    const parsedUrl = new URL(shop2Address);
    shop2Port = Number(parsedUrl.port);

    // Register shop2 in shared registry with its actual listening target
    registryService.register({
      instance: 'shop2',
      domain: 'shop2.example.com',
      url: 'https://shop2.example.com',
      target: `http://127.0.0.1:${shop2Port}`,
      hostPort: 3003,
    });

    // 2. Setup main Fastify instance (simulating primary ingress container)
    const mainConfig: Config = {
      NODE_ENV: 'test',
      BOT_TOKEN: '22222:main_token',
      ADMIN_IDS: [12345],
      DATABASE_URL: 'postgres://rsbot_user:pass@localhost:5432/rsbot_main',
      PANEL_CREDENTIALS_KEY: 'a'.repeat(64),
      REBECCA_ADMIN_USERNAME: 'admin',
      REBECCA_SERVICE_ID: 1,
      DEFAULT_LOCALE: 'fa',
      INSTANCE_NAME: 'main',
      BOT_DELIVERY_MODE: 'polling',
      WEBHOOK_PORT: 3000,
      WEBHOOK_HOST_PORT: 3000,
      WEBHOOK_HOST: '0.0.0.0',
      WEBAPP_PORT: 0,
      WEBAPP_HOST_PORT: 3002,
      WEBAPP_HOST: '127.0.0.1',
      WEBAPP_URL: 'https://main.example.com',
      ADMIN_SESSION_SECRET: 'c'.repeat(32),
      REGISTRY_DIR: tempRegistryDir,
    };

    const mainServices: BotServices = {
      walletService: {} as any,
      configService: {} as any,
      pricingService: {} as any,
      packageCategoryService: {} as any,
      paymentService: {} as any,
      purchaseCheckoutService: {} as any,
      promoService: {} as any,
      referralService: {} as any,
      trialService: {} as any,
      translationService: {
        getSetting: (key: string) => (key === 'webapp_url' ? 'https://main.example.com' : ''),
        getSettingBool: (key: string) => (key === 'webapp_enabled' ? true : false),
      } as any,
      panelRegistry: {} as any,
      userService: {} as any,
      adminService: { adminIds: [12345], isAdmin: () => true } as any,
      refundService: {} as any,
      configTransferService: {} as any,
      configReconciliationService: {} as any,
      broadcastService: {} as any,
      backupService: {} as any,
      luckyWheelService: {} as any,
      webAppUrl: 'https://main.example.com',
      domainRegistryService: registryService,
      adminIds: [12345],
      isAdmin: () => true,
    };

    mainApp = await createWebAppServer(mainConfig, mainServices);
    // Add a test endpoint on main
    mainApp.get('/api/test-main', async (_req, reply) => {
      return reply.send({ instance: 'main', message: 'Hello from main!' });
    });

    await mainApp.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await mainApp?.close();
    await shop2App?.close();
    try {
      fs.rmSync(tempRegistryDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Caddy TLS Verification Endpoint (/api/caddy-check)', () => {
    it('approves main domain (local instance)', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/caddy-check?domain=main.example.com',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allowed).toBe(true);
      expect(body.domain).toBe('main.example.com');
    });

    it('approves shop2 domain via shared multi-instance registry', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/caddy-check?domain=shop2.example.com',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allowed).toBe(true);
      expect(body.instance).toBe('shop2');
    });

    it('denies unknown unregistered domains with 403 Forbidden', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/caddy-check?domain=unregistered.example.com',
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.allowed).toBe(false);
    });

    it('rejects missing domain query parameter with 400 Bad Request', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/caddy-check',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Multi-Instance Mesh Reverse Proxy Dispatching', () => {
    it('handles local main request directly on main instance', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/test-main',
        headers: {
          host: 'main.example.com',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instance).toBe('main');
      expect(body.message).toBe('Hello from main!');
    });

    it('transparently proxies shop2 domain request from mainApp to shop2App', async () => {
      // An incoming request hits mainApp (as Caddy forwards all HTTPS traffic to main_bot:3002)
      // but with Host: shop2.example.com
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/test-shop2',
        headers: {
          host: 'shop2.example.com',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instance).toBe('shop2');
      expect(body.message).toBe('Hello from shop2!');
    });

    it('proxies health check for shop2 domain during automated SSL verification probe', async () => {
      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          host: 'shop2.example.com',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.component).toBe('webapp');
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
      const body = res.json();
      expect(body.error).toContain('Loop detected');
    });

    it('handles unreachable peer instances gracefully with 502 Bad Gateway', async () => {
      // Register an instance with an unused/closed port
      registryService.register({
        instance: 'dead_instance',
        domain: 'dead.example.com',
        url: 'https://dead.example.com',
        target: 'http://127.0.0.1:59999', // nothing listening
        hostPort: 3004,
      });

      const res = await mainApp.inject({
        method: 'GET',
        url: '/api/any-endpoint',
        headers: {
          host: 'dead.example.com',
        },
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error).toContain("Target instance 'dead_instance' is temporarily unreachable");
    });
  });
});
