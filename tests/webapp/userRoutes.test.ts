import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../src/telegram/types.js';

describe('WebApp User Routes (/api/user/*)', () => {
  let app: FastifyInstance;

  const mockAdminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => id === 12345),
  };

  const mockWalletService = {
    getOrCreateUser: vi.fn(async (telegramId: number) => ({
      telegramId,
      username: 'sample_user',
      balance: 100_000,
      reservedBalance: 0,
      referralCode: 'ref_123',
    })),
    listTransactionsForUser: vi.fn(async (telegramId: number, page = 1, _pageSize = 10) => ({
      transactions: [
        {
          id: 'tx_101',
          telegramId,
          amount: 50_000,
          balanceAfter: 150_000,
          type: 'topup',
          description: 'شارژ کیف پول',
          createdAt: new Date('2026-03-01T12:00:00Z'),
        },
      ],
      total: 1,
      totalPages: 1,
      page,
    })),
  };

  const mockUserService = {
    findProfile: vi.fn(async (query: string) => {
      const parsedId = Number(query);
      if (parsedId === 55555) {
        return {
          id: 'u-55555-uuid',
          telegramId: 55555,
          username: 'test_user',
          firstName: 'Ali',
          lastName: 'Reza',
          balance: 75_000,
          reservedBalance: 10_000,
          referralCode: 'ref_55555',
          totalSpend: 250_000,
          activeSubscriptionCount: 2,
          transactionCount: 5,
          referredUserCount: 3,
          referralBonusEarned: 15_000,
          cashbackEarned: 5_000,
          hasUsedTrial: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      return null;
    }),
    getLocale: vi.fn(async () => 'fa' as const),
    updateLocale: vi.fn(async () => {}),
  };

  const mockConfigService = {
    listConfigsForOwner: vi.fn(async (telegramId: number) => {
      if (telegramId === 55555) {
        return [
          {
            id: 'cfg_1',
            telegramId: 55555,
            configUsername: 'u55555_srv1',
            subUrl: 'https://sub.example.com/token123',
            panelStatus: 'active',
            panelDataLimit: 50 * 1024 * 1024 * 1024,
            panelUsedTraffic: 12 * 1024 * 1024 * 1024,
            panelExpire: Math.floor(Date.now() / 1000) + 86400 * 20,
            autoRenewEnabled: true,
            createdAt: new Date('2026-02-01T10:00:00Z'),
            updatedAt: new Date('2026-02-01T10:00:00Z'),
          },
        ];
      }
      return [];
    }),
  };

  const mockPricingService = {
    getPackages: vi.fn(() => [
      {
        id: 'pkg_30gb_30d',
        name: '30 GB - 30 Days',
        gbAmount: 30,
        durationDays: 30,
        price: 120_000,
        enabled: true,
      },
      {
        id: 'pkg_disabled',
        name: 'Disabled Pkg',
        gbAmount: 10,
        durationDays: 10,
        price: 50_000,
        enabled: false,
      },
    ]),
  };

  const mockTranslationService = {
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((key: string, defaultValue?: string) => {
      if (key === 'currency') return 'تومان';
      if (key === 'card_number') return '6037997911112222';
      if (key === 'card_holder') return 'حسین کمالی';
      if (key === 'support_destination') return '@RebeccaSupport';
      return defaultValue;
    }),
    getSettingBool: vi.fn((key: string, defaultValue = true) => {
      if (key === 'support_enabled') return true;
      return defaultValue;
    }),
  };

  const mockPanelRegistry = {
    healthSummary: vi.fn(async () => ({ configured: 1, healthy: 1 })),
  };

  const mockConfig = {
    NODE_ENV: 'test',
    BOT_TOKEN: '123456:test_token',
    ADMIN_IDS: [12345],
    DEFAULT_LOCALE: 'fa',
    INSTANCE_NAME: 'test',
    WEBAPP_URL: 'https://app.example.com',
    WEBAPP_PORT: 3002,
    WEBAPP_HOST: '0.0.0.0',
    ADMIN_SESSION_SECRET: 'test_session_secret_at_least_32_characters_long!!',
  } as unknown as Config;

  const mockServices = {
    adminService: mockAdminService,
    walletService: mockWalletService,
    userService: mockUserService,
    configService: mockConfigService,
    pricingService: mockPricingService,
    translationService: mockTranslationService,
    panelRegistry: mockPanelRegistry,
    botUsername: 'RebeccaSellBot',
  } as unknown as BotServices;

  beforeEach(async () => {
    app = await createWebAppServer(mockConfig, mockServices);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  const getUserToken = (telegramId = 55555) => {
    return app.jwt.sign({ telegramId, role: 'user' });
  };

  it('rejects unauthenticated requests to /api/user/* with 401', async () => {
    const endpoints = [
      '/api/user/profile',
      '/api/user/configs',
      '/api/user/packages',
      '/api/user/transactions',
    ];

    for (const url of endpoints) {
      const res = await app.inject({
        method: 'GET',
        url,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('returns user profile and system settings on GET /api/user/profile', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.telegramId).toBe(55555);
    expect(body.user.username).toBe('test_user');
    expect(body.user.balance).toBe(75_000);
    expect(body.user.availableBalance).toBe(65_000);
    expect(body.user.referralCode).toBe('ref_55555');
    expect(body.user.totalSpend).toBe(250_000);
    expect(body.user.referredUserCount).toBe(3);

    expect(body.settings).toBeDefined();
    expect(body.settings.currency).toBe('تومان');
    expect(body.settings.cardNumber).toBe('6037997911112222');
    expect(body.settings.cardHolder).toBe('حسین کمالی');
    expect(body.settings.supportUsername).toBe('RebeccaSupport');
    expect(body.settings.botUsername).toBe('RebeccaSellBot');
    expect(body.settings.customVolume).toBeDefined();
    expect(body.settings.customVolume.enabled).toBe(true);
    expect(body.settings.customVolume.pricePerGb).toBe(5000);
    expect(body.pendingReceipt).toBeNull();
  });

  it('returns user configs on GET /api/user/configs', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/configs',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configs).toBeDefined();
    expect(body.configs).toHaveLength(1);
    expect(body.configs[0].configUsername).toBe('u55555_srv1');
    expect(body.configs[0].subUrl).toBe('https://sub.example.com/token123');
    expect(body.configs[0].panelStatus).toBe('active');
  });

  it('returns active packages on GET /api/user/packages', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/packages',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.packages).toBeDefined();
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0].id).toBe('pkg_30gb_30d');
    expect(body.packages[0].gbAmount).toBe(30);
    expect(body.packages[0].price).toBe(120_000);
  });

  it('returns paginated transactions on GET /api/user/transactions', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/transactions?page=1&limit=10',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transactions).toBeDefined();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].amount).toBe(50_000);
    expect(body.transactions[0].type).toBe('topup');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
  });

  it('calculates custom volume pricing quote on GET /api/user/quote', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=50&days=30',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gbAmount).toBe(50);
    expect(body.durationDays).toBe(30);
    expect(body.totalPrice).toBe(250_000); // 50 GB * 5000 = 250,000
    expect(body.pricePerGb).toBe(5000);
  });

  it('returns pending receipt details when user has a pending deposit', async () => {
    (mockWalletService as Record<string, unknown>).getPendingReceiptForUser = vi.fn(
      async (telegramId: number) => ({
        id: 'rec_test_123',
        telegramId,
        amount: 200_000,
        status: 'pending',
        createdAt: new Date('2026-03-01T15:30:00Z'),
      })
    );

    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      cookies: { session: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pendingReceipt).toBeDefined();
    expect(body.pendingReceipt.id).toBe('rec_test_123');
    expect(body.pendingReceipt.amount).toBe(200_000);
    expect(body.pendingReceipt.status).toBe('pending');
  });
});
