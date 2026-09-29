import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices } from '../../src/telegram/types.js';
import { PurchaseCheckoutUnavailableError } from '../../src/domain/services/PurchaseCheckoutService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../../src/domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../../src/domain/services/RebeccaService.js';
import { normalizeSupportUsername } from '../../src/webapp/server/routes/userRoutes.js';

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
    executePurchaseSaga: vi.fn(
      async (params: { telegramId: number; amount: number; configUsername: string }) => ({
        success: true,
        configUsername: params.configUsername,
        subUrl: 'https://sub.example.com/token123',
      })
    ),
    getPendingReceiptForUser: vi.fn(async (_telegramId: number) => null as any),
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
      if (parsedId === 66666) {
        return {
          id: 'u-66666-uuid',
          telegramId: 66666,
          username: 'rich_user',
          firstName: 'Rich',
          lastName: 'User',
          balance: 500_000,
          reservedBalance: 0,
          referralCode: 'ref_66666',
          totalSpend: 1_000_000,
          activeSubscriptionCount: 5,
          transactionCount: 10,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      if (parsedId === 99999) {
        return {
          id: 'u-99999-uuid',
          telegramId: 99999,
          username: 'banned_user',
          firstName: 'Banned',
          lastName: 'User',
          balance: 100_000,
          reservedBalance: 0,
          referralCode: 'ref_99999',
          totalSpend: 0,
          activeSubscriptionCount: 0,
          transactionCount: 0,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      return null;
    }),
    isBanned: vi.fn(async (telegramId: number) => telegramId === 99999),
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
    generateConfigName: vi.fn(async (telegramId: number) => `u${telegramId}_auto1`),
  };

  const mockPricingService = {
    getPackages: vi.fn((_panelId, _serviceId, includeDisabled = false) => {
      const pkgs = [
        {
          id: 'pkg_30gb_30d',
          name: '30 GB - 30 Days',
          gbAmount: 30,
          durationDays: 30,
          price: 120_000,
          enabled: true,
        },
        {
          id: 'pkg_10gb_10d',
          name: '10 GB - 10 Days',
          gbAmount: 10,
          durationDays: 10,
          price: 40_000,
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
      ];
      return includeDisabled ? pkgs : pkgs.filter((p) => p.enabled !== false);
    }),
    getPackageById: vi.fn((id: string | null | undefined) => {
      if (id === 'pkg_30gb_30d') {
        return {
          id: 'pkg_30gb_30d',
          name: '30 GB - 30 Days',
          gbAmount: 30,
          durationDays: 30,
          price: 120_000,
          enabled: true,
        };
      }
      if (id === 'pkg_10gb_10d') {
        return {
          id: 'pkg_10gb_10d',
          name: '10 GB - 10 Days',
          gbAmount: 10,
          durationDays: 10,
          price: 40_000,
          enabled: true,
        };
      }
      if (id === 'pkg_disabled') {
        return {
          id: 'pkg_disabled',
          name: 'Disabled Pkg',
          gbAmount: 10,
          durationDays: 10,
          price: 50_000,
          enabled: false,
        };
      }
      return undefined;
    }),
    getCustomPriceQuote: vi.fn((gb: number, _days: number) => ({
      totalPrice: gb * 5000,
      volumePrice: gb * 5000,
      durationPrice: 0,
      pricePerGb: 5000,
      pricePerDay: 0,
    })),
    getCustomVolumeTarget: vi.fn(() => ({ panelId: 'panel_test', serviceId: 1 })),
  };

  const mockPurchaseCheckoutService = {
    create: vi.fn(
      async (input: {
        telegramId: number;
        kind: string;
        pkg: {
          id: string;
          name: string;
          gbAmount: number;
          durationDays: number;
          price: number;
        };
        panelId?: string;
        serviceId?: number;
        quotedAmount?: number;
      }) => ({
        id: 'co_test_123',
        telegramId: input.telegramId,
        kind: input.kind,
        configId: null,
        packageId: input.pkg.id,
        packageName: input.pkg.name,
        panelId: input.panelId ?? 'panel_test',
        serviceId: input.serviceId ?? 1,
        amount: input.pkg.price,
        quotedAmount: input.quotedAmount ?? input.pkg.price,
        gbAmount: input.pkg.gbAmount,
        durationDays: input.pkg.durationDays,
        promoCode: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        claimedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ),
    claim: vi.fn(async (checkoutId: string, telegramId: number) => {
      if (checkoutId === 'co_missing') {
        throw new PurchaseCheckoutUnavailableError('missing');
      }
      if (checkoutId === 'co_expired') {
        throw new PurchaseCheckoutUnavailableError('expired');
      }
      if (checkoutId === 'co_consumed') {
        throw new PurchaseCheckoutUnavailableError('consumed');
      }
      if (checkoutId === 'co_other_user') {
        throw new PurchaseCheckoutUnavailableError('owner_mismatch');
      }
      return {
        id: checkoutId,
        telegramId,
        kind: 'new_config',
        configId: null,
        packageId: 'pkg_10gb_10d',
        packageName: '10 GB - 10 Days',
        panelId: 'panel_test',
        serviceId: 1,
        amount: 40_000,
        quotedAmount: 40_000,
        gbAmount: 10,
        durationDays: 10,
        promoCode: null,
        status: 'processing',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        claimedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };

  const mockTranslationService = {
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((key: string, defaultValue?: string) => {
      if (key === 'currency') return 'تومان';
      if (key === 'card_number') return '6037997911112222';
      if (key === 'card_holder') return 'حسین کمالی';
      if (key === 'support_destination') return '@RebeccaSupport';
      if (key === 'custom_volume_enabled') return 'true';
      return defaultValue;
    }),
    getSettingBool: vi.fn((key: string, defaultValue = true) => {
      if (key === 'support_enabled') return true;
      return defaultValue;
    }),
    getSettingNum: vi.fn((key: string, defaultValue?: number) => {
      if (key === 'custom_min_gb') return 5;
      if (key === 'custom_max_gb') return 500;
      if (key === 'custom_default_days') return 30;
      if (key === 'price_per_gb') return 5000;
      if (key === 'price_per_day') return 0;
      if (key === 'topup_min_amount') return 10_000;
      if (key === 'topup_max_amount') return 10_000_000;
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
    purchaseCheckoutService: mockPurchaseCheckoutService,
    panelRegistry: mockPanelRegistry,
    botUsername: 'RebeccaSellBot',
  } as unknown as BotServices;

  beforeEach(async () => {
    vi.clearAllMocks();
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
      '/api/user/quote',
    ];

    for (const url of endpoints) {
      const res = await app.inject({
        method: 'GET',
        url,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects requests with query token in authGuard with 401', async () => {
    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: `/api/user/profile?token=${token}`,
    });
    expect(res.statusCode).toBe(401);
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
    expect(body.settings.customVolume.defaultDays).toBe(30);
    expect(body.settings.customVolume.minGb).toBe(5);
    expect(body.settings.customVolume.maxGb).toBe(500);
    expect(body.pendingReceipt).toBeNull();
  });

  it('normalizes support destination URLs properly', async () => {
    expect(normalizeSupportUsername('https://t.me/SkyLinkSupport')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('https://t.me/SkyLinkSupport/')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('http://t.me/SkyLinkSupport')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('t.me/SkyLinkSupport')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('@SkyLinkSupport')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('https://telegram.me/SkyLinkSupport?start=help')).toBe(
      'SkyLinkSupport'
    );
    expect(normalizeSupportUsername('SkyLinkSupport')).toBe('SkyLinkSupport');
    expect(normalizeSupportUsername('')).toBe('');
    expect(normalizeSupportUsername(undefined)).toBe('');

    mockTranslationService.getSetting.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'support_destination') return 'https://t.me/CustomSupportChannel/';
      return defaultValue;
    });

    const token = getUserToken(55555);
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      cookies: { session: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.supportUsername).toBe('CustomSupportChannel');
  });

  it('rejects banned users with 403 USER_BANNED on all user routes', async () => {
    const bannedToken = getUserToken(99999);

    const routes = [
      { method: 'GET' as const, url: '/api/user/profile' },
      { method: 'GET' as const, url: '/api/user/configs' },
      { method: 'GET' as const, url: '/api/user/packages' },
      { method: 'GET' as const, url: '/api/user/transactions' },
      { method: 'GET' as const, url: '/api/user/quote?gb=10&days=30' },
      {
        method: 'POST' as const,
        url: '/api/user/checkout',
        payload: { packageId: 'pkg_10gb_10d' },
      },
      {
        method: 'POST' as const,
        url: '/api/user/checkout/co_test_123/confirm',
      },
    ];

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        payload: route.payload,
        cookies: { session: bannedToken },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('User is banned');
      expect(body.code).toBe('USER_BANNED');
    }
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
    expect(body.packages.length).toBeGreaterThanOrEqual(1);
    expect(body.packages.find((p: any) => p.id === 'pkg_disabled')).toBeUndefined();
    expect(body.packages.find((p: any) => p.id === 'pkg_30gb_30d')).toBeDefined();
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

  it('enforces bounds on GET /api/user/quote', async () => {
    const token = getUserToken(55555);

    // Below minGb (min is 5)
    const resLow = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=2&days=30',
      cookies: { session: token },
    });
    expect(resLow.statusCode).toBe(400);
    expect(resLow.json().code).toBe('INVALID_CUSTOM_BOUNDS');

    // Above maxGb (max is 500)
    const resHigh = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=600&days=30',
      cookies: { session: token },
    });
    expect(resHigh.statusCode).toBe(400);
    expect(resHigh.json().code).toBe('INVALID_CUSTOM_BOUNDS');

    // Days out of bounds (< 1)
    const resDays = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=10&days=0',
      cookies: { session: token },
    });
    expect(resDays.statusCode).toBe(400);
    expect(resDays.json().code).toBe('INVALID_CUSTOM_BOUNDS');
  });

  it('returns pending receipt details when user has a pending deposit', async () => {
    mockWalletService.getPendingReceiptForUser = vi.fn(async (telegramId: number) => ({
      id: 'rec_test_123',
      telegramId,
      amount: 200_000,
      status: 'pending',
      createdAt: new Date('2026-03-01T15:30:00Z'),
    }));

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

  describe('POST /api/user/checkout', () => {
    it('successfully initiates checkout for a package (happy path)', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'pkg_10gb_10d' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.checkoutId).toBe('co_test_123');
      expect(body.name).toBe('10 GB - 10 Days');
      expect(body.gb).toBe(10);
      expect(body.days).toBe(10);
      expect(body.price).toBe(40_000);
      expect(body.quotedAmount).toBe(40_000);
      expect(body.availableBalance).toBe(65_000);
      expect(body.expiresAt).toBeDefined();
      expect(mockPurchaseCheckoutService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramId: 55555,
          kind: 'new_config',
          quotedAmount: 40_000,
        })
      );
    });

    it('successfully initiates checkout for custom volume (happy path)', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { custom: { gb: 10, days: 30 } },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.checkoutId).toBe('co_test_123');
      expect(body.name).toBe('10 GB (30 days)');
      expect(body.gb).toBe(10);
      expect(body.days).toBe(30);
      expect(body.price).toBe(50_000);
      expect(body.quotedAmount).toBe(50_000);
      expect(body.availableBalance).toBe(65_000);
      expect(mockPurchaseCheckoutService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramId: 55555,
          kind: 'new_config',
          pkg: expect.objectContaining({
            id: 'custom_10gb_30d',
            gbAmount: 10,
            durationDays: 30,
            price: 50_000,
          }),
          panelId: 'panel_test',
          serviceId: 1,
          quotedAmount: 50_000,
        })
      );
    });

    it('returns 409 INSUFFICIENT_BALANCE when available balance is less than quoted price and does not create checkout', async () => {
      const token = getUserToken(55555); // available balance is 65,000
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'pkg_30gb_30d' }, // price is 120,000
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe('INSUFFICIENT_BALANCE');
      expect(body.error).toBe('Insufficient balance');
      expect(body.availableBalance).toBe(65_000);
      expect(body.price).toBe(120_000);
      expect(body.deficit).toBe(55_000);
      expect(mockPurchaseCheckoutService.create).not.toHaveBeenCalled();
    });

    it('ignores tampered price or quotedAmount in request payload', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: {
          packageId: 'pkg_10gb_10d',
          price: 1,
          quotedAmount: 1,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.price).toBe(40_000);
      expect(body.quotedAmount).toBe(40_000);
      expect(mockPurchaseCheckoutService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          quotedAmount: 40_000,
          pkg: expect.objectContaining({ price: 40_000 }),
        })
      );
    });

    it('rejects disabled or nonexistent package', async () => {
      const token = getUserToken(55555);

      const resDisabled = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'pkg_disabled' },
      });
      expect(resDisabled.statusCode).toBe(404);

      const resMissing = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'pkg_nonexistent' },
      });
      expect(resMissing.statusCode).toBe(404);
    });

    it('rejects out of bounds custom volume', async () => {
      const token = getUserToken(55555);

      // gb below minGb (5)
      const resLow = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { custom: { gb: 1, days: 30 } },
      });
      expect(resLow.statusCode).toBe(400);
      expect(resLow.json().code).toBe('INVALID_CUSTOM_BOUNDS');

      // gb above maxGb (500)
      const resHigh = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { custom: { gb: 600, days: 30 } },
      });
      expect(resHigh.statusCode).toBe(400);
      expect(resHigh.json().code).toBe('INVALID_CUSTOM_BOUNDS');

      // days out of bounds
      const resDays = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { custom: { gb: 10, days: 400 } },
      });
      expect(resDays.statusCode).toBe(400);
      expect(resDays.json().code).toBe('INVALID_CUSTOM_BOUNDS');
    });

    it('rejects custom volume when feature is disabled', async () => {
      mockTranslationService.getSetting.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'custom_volume_enabled') return 'false';
        return defaultValue;
      });

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { custom: { gb: 10, days: 30 } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CUSTOM_VOLUME_DISABLED');
    });

    it('rejects malformed payload (missing both packageId and custom, or providing both)', async () => {
      const token = getUserToken(55555);

      const resNeither = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: {},
      });
      expect(resNeither.statusCode).toBe(400);

      const resBoth = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: {
          packageId: 'pkg_10gb_10d',
          custom: { gb: 10, days: 30 },
        },
      });
      expect(resBoth.statusCode).toBe(400);
    });
  });

  describe('POST /api/user/checkout/:id/confirm', () => {
    it('successfully confirms checkout (happy path)', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.configUsername).toBe('u55555_auto1');
      expect(body.subUrl).toBe('https://sub.example.com/token123');

      expect(mockPurchaseCheckoutService.claim).toHaveBeenCalledWith('co_test_123', 55555);
      expect(mockPurchaseCheckoutService.complete).toHaveBeenCalledWith('co_test_123');
      expect(mockWalletService.executePurchaseSaga).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramId: 55555,
          amount: 40_000,
          maxAmount: 40_000,
          type: 'new_config',
          configUsername: 'u55555_auto1',
          checkoutId: 'co_test_123',
        })
      );
    });

    it('rejects confirmation with 409 INSUFFICIENT_BALANCE and fails checkout when balance drops', async () => {
      mockUserService.findProfile.mockResolvedValueOnce({
        id: 'u-55555-uuid',
        telegramId: 55555,
        balance: 10_000,
        reservedBalance: 0,
      } as any);

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INSUFFICIENT_BALANCE');
      expect(mockPurchaseCheckoutService.fail).toHaveBeenCalledWith('co_test_123');
      expect(mockWalletService.executePurchaseSaga).not.toHaveBeenCalled();
    });

    it('handles checkout unavailable errors properly', async () => {
      const token = getUserToken(55555);

      // Missing
      const resMissing = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_missing/confirm',
        cookies: { session: token },
      });
      expect(resMissing.statusCode).toBe(404);
      expect(resMissing.json().code).toBe('CHECKOUT_NOT_FOUND');

      // Expired
      const resExpired = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_expired/confirm',
        cookies: { session: token },
      });
      expect(resExpired.statusCode).toBe(410);
      expect(resExpired.json().code).toBe('CHECKOUT_EXPIRED');

      // Consumed (e.g. double confirm)
      const resConsumed = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_consumed/confirm',
        cookies: { session: token },
      });
      expect(resConsumed.statusCode).toBe(409);
      expect(resConsumed.json().code).toBe('CHECKOUT_CONSUMED');

      // Owner mismatch
      const resMismatch = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_other_user/confirm',
        cookies: { session: token },
      });
      expect(resMismatch.statusCode).toBe(403);
      expect(resMismatch.json().code).toBe('OWNER_MISMATCH');
    });

    it('handles double confirm gracefully (already consumed -> 409)', async () => {
      const token = getUserToken(55555);
      mockPurchaseCheckoutService.claim.mockRejectedValueOnce(
        new PurchaseCheckoutUnavailableError('consumed')
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CHECKOUT_CONSUMED');
    });

    it('returns 202 when purchase outcome is pending', async () => {
      mockWalletService.executePurchaseSaga.mockRejectedValueOnce(
        new PurchaseOutcomePendingError('intent_pending_1')
      );

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.code).toBe('PURCHASE_OUTCOME_PENDING');
      expect(body.message).toContain('being verified, funds stay reserved');
      expect(mockPurchaseCheckoutService.fail).toHaveBeenCalledWith('co_test_123');
    });

    it('returns 503 when Rebecca panel origin is down', async () => {
      mockWalletService.executePurchaseSaga.mockRejectedValueOnce(
        new RebeccaOriginDownError('/api/user', 503, 1)
      );

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.code).toBe('PANEL_DOWN');
      expect(mockPurchaseCheckoutService.fail).toHaveBeenCalledWith('co_test_123');
    });

    it('returns 409 when purchase is already in progress', async () => {
      mockWalletService.executePurchaseSaga.mockRejectedValueOnce(
        new PurchaseInProgressError('intent_dup')
      );

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('PURCHASE_IN_PROGRESS');
      expect(mockPurchaseCheckoutService.fail).toHaveBeenCalledWith('co_test_123');
    });

    it('does not leak internal error body or stack trace on generic failure', async () => {
      mockWalletService.executePurchaseSaga.mockRejectedValueOnce(
        new Error(
          'Sensitive PostgreSQL connection failed at postgres://admin:secretPass@10.0.0.1:5432'
        )
      );

      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout/co_test_123/confirm',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.code).toBe('PURCHASE_FAILED');
      expect(body.error).toBe('Purchase failed');
      const rawText = res.body;
      expect(rawText).not.toContain('PostgreSQL');
      expect(rawText).not.toContain('secretPass');
      expect(rawText).not.toContain('10.0.0.1');
      expect(mockPurchaseCheckoutService.fail).toHaveBeenCalledWith('co_test_123');
    });
  });
});
