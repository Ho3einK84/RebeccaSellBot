import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { PurchaseCheckoutUnavailableError } from '../../src/domain/services/PurchaseCheckoutService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../../src/domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../../src/domain/services/RebeccaService.js';
import { normalizeSupportUsername } from '../../src/webapp/server/routes/userRoutes.js';
import {
  createMockUserServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';

describe('WebApp User Routes (/api/user/*)', () => {
  let app: FastifyInstance;
  const rateLimits = createResettableRateLimitStore();
  const {
    mockServices,
    mockWalletService,
    mockUserService,
    mockConfigService,
    mockPricingService,
    mockPurchaseCheckoutService,
    mockTranslationService,
  } = createMockUserServices();
  const mockConfig = createTestConfig();
  const defaultGetSetting = mockTranslationService.getSetting.getMockImplementation();
  const defaultGetPendingReceiptForUser = mockWalletService.getPendingReceiptForUser;

  beforeAll(async () => {
    app = await createWebAppServer(mockConfig, mockServices, {
      serveStatic: false,
      rateLimitStore: rateLimits.Store,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    if (defaultGetSetting) {
      mockTranslationService.getSetting.mockImplementation(defaultGetSetting);
    }
    mockWalletService.getPendingReceiptForUser = defaultGetPendingReceiptForUser;
    rateLimits.reset();
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
    expect(body.settings.bankName).toBe('بانک ملی');
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

    it('T3: rejects tampered price or quotedAmount in request payload (mismatch client vs server)', async () => {
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

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('PRICE_MISMATCH');
    });

    it('T3: accepts checkout when client price matches server quote exactly', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: {
          packageId: 'pkg_10gb_10d',
          price: 40_000,
          quotedAmount: 40_000,
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

      // T2: Also reject custom package via packageId pattern when custom volume is disabled
      const resPkgId = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'custom_10gb_30d' },
      });
      expect(resPkgId.statusCode).toBe(400);
      expect(resPkgId.json().code).toBe('CUSTOM_VOLUME_DISABLED');
    });

    it('rejects out of bounds custom volume via packageId pattern', async () => {
      mockTranslationService.getSetting.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'custom_volume_enabled') return 'true';
        return defaultValue;
      });

      const token = getUserToken(55555);

      // GB out of bounds via packageId (10000 GB > 500)
      const resHigh = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'custom_10000gb_30d' },
      });
      expect(resHigh.statusCode).toBe(400);
      expect(resHigh.json().code).toBe('INVALID_CUSTOM_BOUNDS');

      // Duration out of bounds via packageId (3650 days > 365)
      const resDays = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: { packageId: 'custom_10gb_3650d' },
      });
      expect(resDays.statusCode).toBe(400);
      expect(resDays.json().code).toBe('INVALID_CUSTOM_BOUNDS');
    });

    it('T3: rejects client vs server price mismatch', async () => {
      const token = getUserToken(55555);

      // Client specifies manipulated price 1000 instead of server quote 10000
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/checkout',
        cookies: { session: token },
        payload: {
          packageId: 'pkg_10gb_10d',
          price: 1000,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('PRICE_MISMATCH');
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

  describe('Service Management Routes (/api/user/configs/:id/*)', () => {
    it('returns 404 CONFIG_NOT_FOUND when config does not exist', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/configs/cfg_nonexistent/refresh',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('CONFIG_NOT_FOUND');
    });

    it('returns 403 OWNER_MISMATCH when config belongs to another user', async () => {
      const token = getUserToken(55555);
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/configs/cfg_other_user/refresh',
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('OWNER_MISMATCH');
    });

    describe('POST /api/user/configs/:id/auto-renew', () => {
      it('disables auto-renew when enabled is false', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: false },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, autoRenewEnabled: false });
        expect(mockConfigService.setAutoRenew).toHaveBeenCalledWith(55555, 'cfg_1', false);
      });

      it('enables auto-renew with explicit packageId and price', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true, packageId: 'pkg_10gb_10d', price: 40_000 },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          success: true,
          autoRenewEnabled: true,
          packageId: 'pkg_10gb_10d',
          packageName: '10 GB - 10 Days',
          price: 40_000,
        });
        expect(mockConfigService.setAutoRenew).toHaveBeenCalledWith(
          55555,
          'cfg_1',
          true,
          'pkg_10gb_10d',
          40_000
        );
      });

      it('T4: ignores client-supplied manipulated price in body and sets price strictly from pricingService', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true, packageId: 'pkg_10gb_10d', price: 1 }, // client attempts price 1
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          success: true,
          autoRenewEnabled: true,
          packageId: 'pkg_10gb_10d',
          packageName: '10 GB - 10 Days',
          price: 40_000,
        });
        // Price must be server-side 40_000, NOT the client's 1!
        expect(mockConfigService.setAutoRenew).toHaveBeenCalledWith(
          55555,
          'cfg_1',
          true,
          'pkg_10gb_10d',
          40_000
        );
      });

      it('T4: returns 404 PACKAGE_NOT_FOUND when requested package is disabled or nonexistent', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true, packageId: 'pkg_disabled' },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('PACKAGE_NOT_FOUND');
      });

      it('enables auto-renew using existing config package when none provided', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          success: true,
          autoRenewEnabled: true,
          packageId: 'pkg_30gb_30d',
          packageName: '30 GB - 30 Days',
          price: 120_000,
        });
        expect(mockConfigService.setAutoRenew).toHaveBeenCalledWith(
          55555,
          'cfg_1',
          true,
          'pkg_30gb_30d',
          120_000
        );
      });

      it('enables auto-renew falling back to first package from pricingService when config has no autoRenewPackage', async () => {
        mockConfigService.getOwnedConfigById.mockResolvedValueOnce({
          id: 'cfg_1',
          telegramId: 55555,
          configUsername: 'u55555_srv1',
          panelId: 'panel_1',
          serviceId: 1,
          autoRenewEnabled: false,
          autoRenewPackageId: null,
          autoRenewPrice: null,
        } as any);

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          success: true,
          autoRenewEnabled: true,
          packageId: 'pkg_30gb_30d',
          packageName: '30 GB - 30 Days',
          price: 120_000,
        });
        expect(mockConfigService.setAutoRenew).toHaveBeenCalledWith(
          55555,
          'cfg_1',
          true,
          'pkg_30gb_30d',
          120_000
        );
      });

      it('returns 400 PACKAGE_NOT_FOUND when no packages are available', async () => {
        mockConfigService.getOwnedConfigById.mockResolvedValueOnce({
          id: 'cfg_1',
          telegramId: 55555,
          configUsername: 'u55555_srv1',
          panelId: 'panel_empty',
          serviceId: 1,
          autoRenewEnabled: false,
          autoRenewPackageId: null,
          autoRenewPrice: null,
        } as any);
        mockPricingService.getPackages.mockReturnValueOnce([]);

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('PACKAGE_NOT_FOUND');
      });

      it('returns 404 CONFIG_NOT_FOUND when config does not exist', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_nonexistent/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('CONFIG_NOT_FOUND');
      });

      it('returns 403 OWNER_MISMATCH when config belongs to another user', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_other_user/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('OWNER_MISMATCH');
      });
    });

    describe('POST /api/user/configs/:id/toggle-status', () => {
      it('toggles status when no body is provided', async () => {
        mockConfigService.toggleConfig.mockResolvedValueOnce('disabled');

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/toggle-status',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, status: 'disabled' });
        expect(mockConfigService.toggleConfig).toHaveBeenCalledWith('u55555_srv1', 'panel_1');
      });

      it('explicitly enables config when status is active', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/toggle-status',
          cookies: { session: token },
          payload: { status: 'active' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, status: 'active' });
        expect(mockConfigService.enableConfig).toHaveBeenCalledWith('u55555_srv1', 'panel_1');
      });

      it('explicitly disables config when status is disabled', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/toggle-status',
          cookies: { session: token },
          payload: { status: 'disabled' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, status: 'disabled' });
        expect(mockConfigService.disableConfig).toHaveBeenCalledWith('u55555_srv1', 'panel_1');
      });

      it('returns 404 CONFIG_NOT_FOUND when config does not exist', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_nonexistent/toggle-status',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('CONFIG_NOT_FOUND');
      });

      it('returns 403 OWNER_MISMATCH when config belongs to another user', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_other_user/toggle-status',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('OWNER_MISMATCH');
      });

      it('returns 503 PANEL_DOWN when Rebecca panel origin is down', async () => {
        mockConfigService.toggleConfig.mockRejectedValueOnce(
          new RebeccaOriginDownError('/api/user', 503, 1)
        );

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/toggle-status',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe('PANEL_DOWN');
      });
    });

    describe('POST /api/user/configs/:id/revoke', () => {
      it('successfully revokes subscription link', async () => {
        mockConfigService.revokeSubscription.mockResolvedValueOnce(
          'https://sub.example.com/token_rotated'
        );

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/revoke',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          success: true,
          subUrl: 'https://sub.example.com/token_rotated',
        });
        expect(mockConfigService.revokeSubscription).toHaveBeenCalledWith('u55555_srv1', 'panel_1');
      });

      it('returns 404 CONFIG_NOT_FOUND when config does not exist', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_nonexistent/revoke',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('CONFIG_NOT_FOUND');
      });

      it('returns 403 OWNER_MISMATCH when config belongs to another user', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_other_user/revoke',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('OWNER_MISMATCH');
      });

      it('returns 503 PANEL_DOWN when Rebecca panel origin is down', async () => {
        mockConfigService.revokeSubscription.mockRejectedValueOnce(
          new RebeccaOriginDownError('/api/user', 503, 1)
        );

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/revoke',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe('PANEL_DOWN');
      });
    });

    describe('POST /api/user/configs/:id/refresh', () => {
      it('successfully refreshes live config detail', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/refresh',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.config.panelStatus).toBe('active');
        expect(body.config.panelDataLimit).toBe(50 * 1024 * 1024 * 1024);
        expect(mockConfigService.refreshConfig).toHaveBeenCalledWith(55555, 'cfg_1');
      });

      it('returns 404 CONFIG_NOT_FOUND when config does not exist', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_nonexistent/refresh',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('CONFIG_NOT_FOUND');
      });

      it('returns 403 OWNER_MISMATCH when config belongs to another user', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_other_user/refresh',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('OWNER_MISMATCH');
      });

      it('returns 503 PANEL_DOWN when Rebecca panel origin is down', async () => {
        mockConfigService.refreshConfig.mockRejectedValueOnce(
          new RebeccaOriginDownError('/api/user', 503, 1)
        );

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/refresh',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe('PANEL_DOWN');
      });
    });

    describe('Regression Tests — Bounds, Status, Auto-Renew & Checkout Validation', () => {
      it('GET /api/user/quote propagates pricingService bounds errors as 400 INVALID_CUSTOM_BOUNDS', async () => {
        mockPricingService.getCustomPriceQuote.mockImplementationOnce(() => {
          throw new Error('Volume exceeds configured bounds');
        });

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'GET',
          url: '/api/user/quote?gb=25&days=30',
          cookies: { session: token },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_CUSTOM_BOUNDS');
        expect(res.json().error).toBe('Volume exceeds configured bounds');
      });

      it('POST /api/user/configs/:id/toggle-status rejects invalid status values with 400 INVALID_STATUS', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/toggle-status',
          cookies: { session: token },
          payload: { status: 'bogus' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_STATUS');
      });

      it('POST /api/user/configs/:id/auto-renew returns 404 PACKAGE_NOT_FOUND when saved config autoRenewPackageId is unavailable', async () => {
        mockConfigService.getOwnedConfigById.mockResolvedValueOnce({
          id: 'cfg_1',
          telegramId: 55555,
          configUsername: 'u55555_srv1',
          panelId: 'panel_1',
          serviceId: 1,
          autoRenewEnabled: false,
          autoRenewPackageId: 'pkg_retired_no_longer_sold',
          autoRenewPrice: 90_000,
        } as any);

        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/auto-renew',
          cookies: { session: token },
          payload: { enabled: true },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe('PACKAGE_NOT_FOUND');
        expect(res.json().error).toContain('no longer available');
        expect(mockConfigService.setAutoRenew).not.toHaveBeenCalled();
      });

      it('POST /api/user/checkout rejects top-level JSON array payloads with 400 INVALID_REQUEST', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'POST',
          url: '/api/user/checkout',
          cookies: { session: token },
          payload: ['pkg_30gb_30d'] as unknown as Record<string, unknown>,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_REQUEST');
      });
    });

    describe('Native Renewal, Promo Quote/Redeem & Categories Routes', () => {
      it('GET /api/user/configs/:id/renewal-options returns compatible packages and rollover metrics with ownership check', async () => {
        const token = getUserToken(55555);
        const res = await app.inject({
          method: 'GET',
          url: '/api/user/configs/cfg_1/renewal-options',
          cookies: { session: token },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.config.id).toBe('cfg_1');
        expect(body.config.configUsername).toBe('u55555_srv1');
        expect(typeof body.config.currentRemainingGb).toBe('number');
        expect(typeof body.config.currentRemainingDays).toBe('number');
        expect(body.packages.length).toBeGreaterThanOrEqual(1);
        expect(body.defaultRolloverEnabled).toBe(true);
        expect(body.customVolumeEnabled).toBe(true);

        const forbidden = await app.inject({
          method: 'GET',
          url: '/api/user/configs/cfg_other_user/renewal-options',
          cookies: { session: token },
        });
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.json().code).toBe('OWNER_MISMATCH');

        const missing = await app.inject({
          method: 'GET',
          url: '/api/user/configs/cfg_unknown/renewal-options',
          cookies: { session: token },
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.json().code).toBe('CONFIG_NOT_FOUND');
      });

      it('POST /api/user/promo/quote & /api/user/promo/redeem validate purchase promos and gift credit codes', async () => {
        const promoService = {
          quoteForPurchase: vi.fn(
            async (_tid: number, code: string, amount: number, gb: number) => {
              if (code === 'BONUS10') {
                return {
                  code: 'BONUS10',
                  type: 'gift_gb',
                  value: 10,
                  finalAmount: amount,
                  finalGbAmount: gb + 10,
                };
              }
              return {
                code: 'SAVE10',
                type: 'percent',
                value: 10,
                finalAmount: Math.round(amount * 0.9),
                finalGbAmount: gb,
              };
            }
          ),
          redeemCode: vi.fn(async (_tid: number, code: string) => {
            if (code === 'GIFT50K') {
              return {
                success: true,
                code: 'GIFT50K',
                codeType: 'gift_credit',
                value: 50_000,
                messageKey: 'promo_gift_redeemed',
              };
            }
            return {
              success: true,
              code: 'SAVE10',
              codeType: 'percent',
              value: 10,
              messageKey: 'promo_valid',
            };
          }),
        };
        const promoApp = await createWebAppServer(
          mockConfig,
          {
            ...mockServices,
            promoService: promoService as any,
          },
          { serveStatic: false }
        );
        try {
          const token = promoApp.jwt.sign({ telegramId: 55555, role: 'user' });
          const quoteRes = await promoApp.inject({
            method: 'POST',
            url: '/api/user/promo/quote',
            cookies: { session: token },
            payload: { code: 'BONUS10', packageId: 'pkg_10gb_10d' },
          });
          expect(quoteRes.statusCode).toBe(200);
          expect(quoteRes.json()).toMatchObject({
            valid: true,
            code: 'BONUS10',
            bonusGb: 10,
            finalGb: 20,
            finalAmount: 40_000,
          });

          const redeemGift = await promoApp.inject({
            method: 'POST',
            url: '/api/user/promo/redeem',
            cookies: { session: token },
            payload: { code: 'GIFT50K' },
          });
          expect(redeemGift.statusCode).toBe(200);
          expect(redeemGift.json()).toMatchObject({
            success: true,
            type: 'gift_credit',
            value: 50_000,
          });

          const redeemPurchaseCode = await promoApp.inject({
            method: 'POST',
            url: '/api/user/promo/redeem',
            cookies: { session: token },
            payload: { code: 'SAVE10' },
          });
          expect(redeemPurchaseCode.statusCode).toBe(400);
          expect(redeemPurchaseCode.json().code).toBe('PROMO_PURCHASE_ONLY');
        } finally {
          await promoApp.close();
        }
      });

      it('POST /api/user/checkout & confirm execute native renew_config with rollover preview', async () => {
        mockPurchaseCheckoutService.claim.mockResolvedValueOnce({
          id: 'co_renew_native_1',
          telegramId: 55555,
          kind: 'renew_config',
          configId: 'cfg_1',
          packageId: 'pkg_10gb_10d',
          packageName: '10 GB - 10 Days',
          panelId: 'panel_1',
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
        });

        const token = getUserToken(55555);
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/user/checkout',
          cookies: { session: token },
          payload: {
            kind: 'renew_config',
            configId: 'cfg_1',
            packageId: 'pkg_10gb_10d',
          },
        });
        expect(createRes.statusCode).toBe(201);
        const created = createRes.json();
        expect(created.kind).toBe('renew_config');
        expect(created.configId).toBe('cfg_1');
        expect(created.rolloverPreview?.enabled).toBe(true);
        expect(created.rolloverPreview?.projectedTotalGb).toBeGreaterThan(10);

        const confirmRes = await app.inject({
          method: 'POST',
          url: '/api/user/checkout/co_renew_native_1/confirm',
          cookies: { session: token },
        });
        expect(confirmRes.statusCode).toBe(200);
        const confirmed = confirmRes.json();
        expect(confirmed.success).toBe(true);
        expect(confirmed.kind).toBe('renew_config');
        expect(confirmed.configUsername).toBe('u55555_srv1');
        expect(mockWalletService.executePurchaseSaga).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'renew_config',
            configUsername: 'u55555_srv1',
          })
        );
      });
    });
  });
});
