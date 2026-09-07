import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../src/telegram/types.js';

describe('WebApp Server & Admin Routes', () => {
  let app: FastifyInstance;

  const mockAdminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => id === 12345),
  };

  const mockWalletService = {
    getDashboardStats: vi.fn(async () => ({
      totalUsers: 100,
      totalSales: 500_000,
      dailyRevenue: 50_000,
      weeklyRevenue: 200_000,
      monthlyRevenue: 400_000,
      totalReferralBonus: 10_000,
      totalCashback: 5_000,
      activeSubscriptions: 80,
      inactiveSubscriptions: 20,
      pendingReceipts: 2,
    })),
    listPendingTopupsPage: vi.fn(async (page = 1, _limit = 10) => ({
      items: [
        {
          id: 'rec_1001',
          telegramId: 55555,
          amount: 100_000,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page,
      totalPages: 1,
    })),
    approveTopup: vi.fn(async (id: string, _adminId: number) => {
      if (id === 'rec_1001') return { telegramId: 55555, amount: 100_000 };
      return null;
    }),
    rejectTopup: vi.fn(async (id: string, _adminId: number) => {
      if (id === 'rec_1001') return { telegramId: 55555 };
      return null;
    }),
    adjustBalanceAdmin: vi.fn(async () => 150_000),
  };

  const mockUserService = {
    listUsers: vi.fn(async (page = 1) => ({
      users: [
        {
          telegramId: 55555,
          username: 'testuser',
          firstName: 'User',
          lastName: null,
          balance: 50_000,
          totalSpend: 100_000,
          activeSubscriptionCount: 1,
          createdAt: new Date(),
        },
      ],
      total: 1,
      page,
      totalPages: 1,
    })),
    searchProfiles: vi.fn(async () => [
      {
        telegramId: 55555,
        username: 'testuser',
        firstName: 'User',
        lastName: null,
        balance: 50_000,
        totalSpend: 100_000,
        activeSubscriptionCount: 1,
        createdAt: new Date(),
      },
    ]),
    getUserReportSummary: vi.fn(async (telegramId: number) => {
      if (telegramId !== 55555) return null;
      return {
        user: {
          telegramId: 55555,
          username: 'testuser',
          firstName: 'User',
          lastName: null,
          balance: 50_000,
          totalSpend: 100_000,
          activeSubscriptionCount: 1,
          createdAt: new Date(),
        },
        totalDeposit: 150_000,
        totalSpend: 100_000,
        totalRefund: 0,
        totalCashback: 5_000,
        totalReferralBonus: 0,
        totalLuckyWheel: 0,
        totalTransactions: 3,
        activeConfigsCount: 1,
        totalConfigsCount: 1,
        totalOrdersCount: 1,
        receiptsApprovedCount: 1,
        receiptsRejectedCount: 0,
        receiptsPendingCount: 0,
        totalReceiptsCount: 1,
        auditEventsCount: 2,
      };
    }),
    listOrdersForUser: vi.fn(async () => ({ orders: [], total: 0, totalPages: 1, page: 1 })),
    listReceiptsForUser: vi.fn(async () => ({ receipts: [], total: 0, totalPages: 1, page: 1 })),
    recordAdminAction: vi.fn(async () => {}),
    getLocale: vi.fn(async (telegramId: number) => (telegramId === 55555 ? 'en' : undefined)),
    updateLocale: vi.fn(async () => {}),
  };

  const mockTranslationService = {
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((_key: string) => undefined as string | undefined),
    getSettingBool: vi.fn((key: string, defaultValue = false) => {
      if (key === 'language_selection_enabled') return true;
      return defaultValue;
    }),
  };

  const mockPanelRegistry = {
    healthSummary: vi.fn(async () => ({ configured: 2, healthy: 2 })),
    listPanels: vi.fn(() => [
      {
        id: 'panel_1',
        name: 'Main Germany Panel',
        baseUrl: 'https://panel.example.com',
        enabled: true,
        isDefault: true,
        credentialConfigured: true,
        credentialMode: 'api_key' as const,
        services: [{ serviceId: 1, name: 'V2Ray Service', isDefault: true }],
      },
    ]),
    getPanelUsage: vi.fn(async () => ({ activeConfigsCount: 5 })),
    getService: vi.fn(() => ({ checkHealth: vi.fn(async () => true) })),
  };

  const mockConfig = {
    NODE_ENV: 'test',
    BOT_TOKEN: '123456:test_token',
    ADMIN_IDS: [12345],
    DATABASE_URL: 'postgres://localhost/test',
    DATABASE_POOL_SIZE: 10,
    HEALTH_CHECK_PORT: 3001,
    DEFAULT_LOCALE: 'fa',
    INSTANCE_NAME: 'test',
    BOT_DELIVERY_MODE: 'polling',
    WEBHOOK_PORT: 3000,
    WEBHOOK_HOST: '0.0.0.0',
    WEBHOOK_PATH: '/webhook',
    REBECCA_SERVICE_ID: 1,
    REBECCA_ADMIN_USERNAME: 'admin',
    WEBAPP_URL: 'https://app.example.com',
    WEBAPP_PORT: 3002,
    WEBAPP_HOST: '0.0.0.0',
    ADMIN_SESSION_SECRET: 'test_session_secret_at_least_32_characters_long!!',
  } as unknown as Config;

  const mockServices = {
    adminService: mockAdminService,
    walletService: mockWalletService,
    userService: mockUserService,
    translationService: mockTranslationService,
    panelRegistry: mockPanelRegistry,
  } as unknown as BotServices;

  beforeEach(async () => {
    app = await createWebAppServer(mockConfig, mockServices);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  const getAdminToken = () => {
    return app.jwt.sign({ telegramId: 12345, role: 'admin' });
  };

  const getUserToken = () => {
    return app.jwt.sign({ telegramId: 55555, role: 'user' });
  };

  describe('Auth Guard (403 on every /api/admin/* route)', () => {
    const adminEndpoints = [
      { method: 'GET' as const, url: '/api/admin/stats' },
      { method: 'GET' as const, url: '/api/admin/receipts' },
      {
        method: 'POST' as const,
        url: '/api/admin/receipts/rec_1/action',
        payload: { action: 'approve' },
      },
      { method: 'GET' as const, url: '/api/admin/users' },
      { method: 'GET' as const, url: '/api/admin/users/55555' },
      {
        method: 'POST' as const,
        url: '/api/admin/users/55555/balance',
        payload: { operation: 'add', amount: 100, reason: 'test' },
      },
      { method: 'GET' as const, url: '/api/admin/panels' },
    ];

    for (const ep of adminEndpoints) {
      it(`returns 403 for unauthenticated ${ep.method} ${ep.url}`, async () => {
        const response = await app.inject({
          method: ep.method,
          url: ep.url,
          payload: ep.payload,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Forbidden' });
      });

      it(`returns 403 for non-admin user session on ${ep.method} ${ep.url}`, async () => {
        const userToken = getUserToken();
        const response = await app.inject({
          method: ep.method,
          url: ep.url,
          headers: {
            authorization: `Bearer ${userToken}`,
          },
          payload: ep.payload,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Forbidden' });
      });
    }
  });

  describe('Admin Endpoints with Admin Session', () => {
    it('GET /api/admin/stats returns dashboard metrics and panel health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/stats',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.stats.totalUsers).toBe(100);
      expect(data.stats.dailyRevenue).toBe(50_000);
      expect(data.panelHealth.healthy).toBe(2);
    });

    it('GET /api/admin/receipts returns pending receipts queue', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts?page=1&limit=10',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe('rec_1001');
    });

    it('POST /api/admin/receipts/:id/action approves receipt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        result: { telegramId: 55555, amount: 100_000 },
      });
      expect(mockWalletService.approveTopup).toHaveBeenCalledWith('rec_1001', 12345);
    });

    it('POST /api/admin/receipts/:id/action rejects receipt and records audit action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'reject', reason: 'Unreadable receipt screenshot' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockWalletService.rejectTopup).toHaveBeenCalledWith('rec_1001', 12345);
      expect(mockUserService.recordAdminAction).toHaveBeenCalled();
    });

    it('GET /api/admin/users lists users and supports search', async () => {
      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/users?page=1&limit=10',
        cookies: { session: getAdminToken() },
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().users.length).toBe(1);

      const searchResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/users?search=testuser',
        cookies: { session: getAdminToken() },
      });
      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.json().users[0].username).toBe('testuser');
      expect(mockUserService.searchProfiles).toHaveBeenCalledWith('testuser', 10);
    });

    it('GET /api/admin/users/:id returns user summary report', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/users/55555',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.summary.totalDeposit).toBe(150_000);
      expect(data.summary.user.telegramId).toBe(55555);
    });

    it('POST /api/admin/users/:id/balance modifies balance with mandatory reason', async () => {
      // Missing / empty reason should fail with 400
      const emptyReasonRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/balance',
        cookies: { session: getAdminToken() },
        payload: { operation: 'add', amount: 50_000, reason: '' },
      });
      expect(emptyReasonRes.statusCode).toBe(400);

      // Valid adjustment
      const validRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/balance',
        cookies: { session: getAdminToken() },
        payload: { operation: 'add', amount: 50_000, reason: 'Compensation bonus' },
      });
      expect(validRes.statusCode).toBe(200);
      expect(validRes.json()).toEqual({ success: true, balance: 150_000 });
      expect(mockWalletService.adjustBalanceAdmin).toHaveBeenCalledWith({
        telegramId: 55555,
        operation: 'add',
        amount: 50_000,
        adminId: 12345,
        description: 'Compensation bonus',
      });
      expect(mockUserService.recordAdminAction).toHaveBeenCalled();
    });

    it('GET /api/admin/panels returns panel registry list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/panels',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.panels.length).toBe(1);
      expect(data.panels[0].name).toBe('Main Germany Panel');
    });
  });

  describe('Auth Endpoint (POST /api/auth/telegram-validate)', () => {
    function createSignedInitData(userId: number): string {
      const now = Math.floor(Date.now() / 1000);
      const fields: Record<string, string> = {
        auth_date: String(now),
        user: JSON.stringify({ id: userId, first_name: 'Test' }),
      };
      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(mockConfig.BOT_TOKEN)
        .digest();
      const sortedKeys = Object.keys(fields).sort();
      const dataCheckString = sortedKeys.map((k) => `${k}=${fields[k]}`).join('\n');
      const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      const params = new URLSearchParams(fields);
      params.set('hash', hash);
      return params.toString();
    }

    it('authenticates admin user and sets session cookie', async () => {
      const initData = createSignedInitData(12345);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('admin');
      expect(body.user.id).toBe(12345);
      expect(response.cookies.some((c) => c.name === 'session')).toBe(true);
    });

    it('authenticates regular user with user role, returning locale and settings', async () => {
      const initData = createSignedInitData(55555);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('user');
      expect(body.user.id).toBe(55555);
      expect(body.locale).toBe('en');
      expect(body.languageSelectionEnabled).toBe(true);
    });

    it('falls back to default locale if user has no stored locale', async () => {
      const initData = createSignedInitData(99999);

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
      const response = await app.inject({
        method: 'POST',
        url: '/api/user/locale',
        headers: {
          authorization: `Bearer ${getUserToken()}`,
        },
        payload: { locale: 'invalid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('updates user locale when language_selection_enabled is true', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/user/locale',
        headers: {
          authorization: `Bearer ${getUserToken()}`,
        },
        payload: { locale: 'en' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.locale).toBe('en');
      expect(mockUserService.updateLocale).toHaveBeenCalledWith(55555, 'en');
    });

    it('returns 403 when language_selection_enabled is false', async () => {
      mockTranslationService.getSettingBool.mockImplementationOnce((key: string) => {
        if (key === 'language_selection_enabled') return false;
        return true;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/user/locale',
        headers: {
          authorization: `Bearer ${getUserToken()}`,
        },
        payload: { locale: 'en' },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toContain('disabled');
    });
  });

  describe('GET /api/admin/panels', () => {
    it('returns enriched panels list with health and usage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/panels',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.panels).toHaveLength(1);
      expect(data.panels[0].id).toBe('panel_1');
      expect(data.panels[0].activeConfigsCount).toBe(5);
      expect(data.panels[0].healthy).toBe(true);
      expect(typeof data.panels[0].latencyMs).toBe('number');
    });
  });

  describe('POST /api/admin/panels/:id/test', () => {
    it('tests panel connection successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_1/test',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.healthy).toBe(true);
      expect(typeof data.latencyMs).toBe('number');
    });
  });

  describe('GET /api/caddy-check (Caddy on-demand TLS validation)', () => {
    it('returns 400 when domain parameter is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/caddy-check',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 when domain matches configured webapp url', async () => {
      mockTranslationService.getSetting.mockImplementationOnce((key: string) => {
        if (key === 'webapp_url') return 'https://rs.netiva.ir';
        return undefined;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/caddy-check?domain=rs.netiva.ir',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ allowed: true, domain: 'rs.netiva.ir' });
    });

    it('returns 403 when domain is unauthorized', async () => {
      mockTranslationService.getSetting.mockImplementationOnce((key: string) => {
        if (key === 'webapp_url') return 'https://rs.netiva.ir';
        return undefined;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/caddy-check?domain=malicious.com',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ allowed: false, domain: 'malicious.com' });
    });
  });
});
