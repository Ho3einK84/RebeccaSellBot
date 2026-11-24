import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  NEUTRAL_USER_GROUP_POLICY,
  type EffectiveUserGroupPolicy,
  type UserGroupService,
} from '../../src/domain/services/UserGroupService.js';
import type { CatalogDiscountService } from '../../src/domain/services/CatalogDiscountService.js';
import { PricingService } from '../../src/domain/services/PricingService.js';
import {
  createMockUserServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';

describe('WebApp User Groups & VIP Credit Limit Routes', () => {
  let app: FastifyInstance;
  const rateLimits = createResettableRateLimitStore();
  const mockConfig = createTestConfig();
  const harness = createMockUserServices();

  let activePolicy: EffectiveUserGroupPolicy;

  const mockUserGroupService = {
    getEffectiveUserPolicy: vi.fn(async () => activePolicy),
    listGroupsWithMemberCounts: vi.fn(async () => [
      {
        id: 'grp_vip',
        name: 'VIP Gold',
        badge: '👑 VIP',
        isDefault: false,
        discountPercent: 20,
        applyDiscountToCustomVolume: false,
        customPricePerGb: 3000,
        customPricePerDay: 0,
        allowCatalogDiscounts: false,
        allowPromoCodes: false,
        allowCashback: false,
        allowLuckyWheel: false,
        allowCustomServiceName: true,
        creditLimit: 100_000,
        memberCount: 2,
      },
    ]),
    createGroup: vi.fn(async (input: { name: string }) => ({
      id: 'grp_new',
      name: input.name,
      badge: null,
      isDefault: false,
      discountPercent: 0,
      applyDiscountToCustomVolume: false,
      customPricePerGb: null,
      customPricePerDay: null,
      allowCatalogDiscounts: true,
      allowPromoCodes: true,
      allowCashback: true,
      allowLuckyWheel: true,
      allowCustomServiceName: false,
      creditLimit: 0,
    })),
    updateGroup: vi.fn(async (id: string, input: Record<string, unknown>) => ({
      id,
      name: String(input.name ?? 'VIP Gold'),
      ...input,
    })),
    deleteGroup: vi.fn(async () => ({
      deleted: true,
      transferredCount: 2,
      targetGroupId: 'grp_default',
    })),
    assignUserGroup: vi.fn(async () => activePolicy),
  } as unknown as UserGroupService;

  const mockCatalogDiscountService = {
    listActiveDiscounts: vi.fn(async () => [
      {
        id: 'disc_1',
        title: 'Spring 10%',
        scope: 'all' as const,
        targetId: null,
        discountType: 'percent' as const,
        value: 10,
        maxDiscountAmount: null,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: null,
        active: true,
      },
    ]),
  } as unknown as CatalogDiscountService;

  const realPricingService = new PricingService(harness.mockTranslationService as never);

  beforeAll(async () => {
    harness.mockServices.userGroupService = mockUserGroupService;
    harness.mockServices.catalogDiscountService = mockCatalogDiscountService;
    harness.mockServices.pricingService = realPricingService;
    harness.mockServices.promoService = {
      quoteForPurchase: vi.fn(),
      redeemCode: vi.fn(),
    } as never;
    harness.mockServices.walletService.transferBalance = vi
      .fn()
      .mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));

    app = await createWebAppServer(mockConfig, harness.mockServices, {
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
    activePolicy = {
      ...NEUTRAL_USER_GROUP_POLICY,
      groupId: 'grp_vip',
      groupName: 'VIP Gold',
      badge: '👑 VIP',
      isAssigned: true,
      discountPercent: 20,
      applyDiscountToCustomVolume: false,
      customPricePerGb: 3_000,
      customPricePerDay: 0,
      allowCatalogDiscounts: false,
      allowPromoCodes: false,
      allowCashback: false,
      allowLuckyWheel: false,
      allowCustomServiceName: true,
      creditLimit: 100_000,
    };

    harness.mockTranslationService.getSetting.mockImplementation(
      (key: string, defaultValue = '') => {
        if (key === 'packages_json') {
          return JSON.stringify([
            {
              id: 'pkg_50gb',
              name: '50 GB - 30 Days',
              gbAmount: 50,
              durationDays: 30,
              price: 100_000,
            },
          ]);
        }
        if (key === 'custom_service_name_enabled') return 'false';
        if (key === 'cashback_percent') return '10';
        if (key === 'currency') return 'تومان';
        return defaultValue;
      }
    );
    harness.mockTranslationService.getSettingNum.mockImplementation((key: string, fallback = 0) => {
      const nums: Record<string, number> = {
        price_per_gb: 5_000,
        price_per_day: 0,
        custom_min_gb: 5,
        custom_max_gb: 500,
        custom_default_days: 30,
        cashback_percent: 10,
        referral_bonus_toman: 10_000,
        wallet_transfer_min_amount: 5_000,
      };
      return nums[key] ?? fallback;
    });
    harness.mockTranslationService.getSettingBool.mockImplementation(
      (key: string, fallback = false) => {
        if (key === 'custom_service_name_enabled') return false;
        if (key === 'custom_volume_enabled') return true;
        if (key === 'bot_enabled') return true;
        if (key === 'wallet_transfer_enabled') return true;
        return fallback;
      }
    );
  });

  const userToken = (telegramId = 55555) => app.jwt.sign({ telegramId, role: 'user' });
  const adminToken = (telegramId = 999) => app.jwt.sign({ telegramId, role: 'admin' });

  it('exposes group badge, negative debt, credit limit, purchasing power and gated flags on /api/user/profile', async () => {
    harness.mockUserService.findProfile.mockResolvedValueOnce({
      id: 'u_55555',
      telegramId: 55555,
      username: 'vip_user',
      firstName: 'VIP',
      lastName: null,
      balance: -30_000,
      reservedBalance: 0,
      referralCode: 'ref_55555',
      totalSpend: 300_000,
      activeSubscriptionCount: 1,
      transactionCount: 4,
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 0,
      hasUsedTrial: true,
      isBanned: false,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      cookies: { session: userToken(55555) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.balance).toBe(-30_000);
    expect(body.user.availableBalance).toBe(-30_000);
    expect(body.user.transferableBalance).toBe(0);
    expect(body.user.debtAmount).toBe(30_000);
    expect(body.user.creditLimit).toBe(100_000);
    expect(body.user.purchasingPower).toBe(70_000);
    expect(body.user.group).toMatchObject({
      id: 'grp_vip',
      name: 'VIP Gold',
      badge: '👑 VIP',
      discountPercent: 20,
      creditLimit: 100_000,
    });
    expect(body.settings.customServiceNameEnabled).toBe(true);
    expect(body.settings.cashbackPercent).toBe(0);
    expect(body.settings.allowPromoCodes).toBe(false);
    expect(body.settings.customVolume.pricePerGb).toBe(3_000);
    expect(body.settings.customVolume.groupDiscountPercent).toBe(0);
    expect(body.user.group.applyDiscountToCustomVolume).toBe(false);
  });

  it('applies group pricing to packages only by default and to custom volume when applyDiscountToCustomVolume is enabled', async () => {
    const pkgRes = await app.inject({
      method: 'GET',
      url: '/api/user/packages',
      cookies: { session: userToken(55555) },
    });
    expect(pkgRes.statusCode).toBe(200);
    const pkg = pkgRes.json().packages[0];
    expect(pkg.originalPrice).toBe(100_000);
    expect(pkg.price).toBe(80_000); // 20% group discount only; 10% catalog sale blocked
    expect(pkg.groupDiscountPercent).toBe(20);
    expect(pkg.groupDiscountAmount).toBe(20_000);
    expect(pkg.catalogDiscountAmount).toBe(0);

    // Default (applyDiscountToCustomVolume: false): custom volume uses customPricePerGb=3000 WITHOUT 20% discount
    const quoteRes = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=10&days=30',
      cookies: { session: userToken(55555) },
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = quoteRes.json();
    expect(quote.pricePerGb).toBe(3_000);
    expect(quote.originalPrice).toBe(30_000);
    expect(quote.totalPrice).toBe(30_000);
    expect(quote.groupDiscountPercent).toBe(0);
    expect(quote.groupDiscountAmount).toBe(0);
    expect(quote.catalogDiscountAmount).toBe(0);

    // When applyDiscountToCustomVolume: true, 20% group discount ALSO applies to custom volume
    activePolicy = { ...activePolicy, applyDiscountToCustomVolume: true };
    const quoteWithDiscRes = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=10&days=30',
      cookies: { session: userToken(55555) },
    });
    expect(quoteWithDiscRes.statusCode).toBe(200);
    const quoteWithDisc = quoteWithDiscRes.json();
    // 10 GB * 3000 = 30_000; -20% group discount = 24_000; no catalog double discount
    expect(quoteWithDisc.pricePerGb).toBe(3_000);
    expect(quoteWithDisc.originalPrice).toBe(30_000);
    expect(quoteWithDisc.totalPrice).toBe(24_000);
    expect(quoteWithDisc.groupDiscountPercent).toBe(20);
    expect(quoteWithDisc.groupDiscountAmount).toBe(6_000);
    expect(quoteWithDisc.catalogDiscountAmount).toBe(0);
  });

  it('rejects promo quote and redeem when group disallows promo codes', async () => {
    const quoteRes = await app.inject({
      method: 'POST',
      url: '/api/user/promo/quote',
      cookies: { session: userToken(55555) },
      payload: { code: 'OFF10', packageId: 'pkg_50gb' },
    });
    expect(quoteRes.statusCode).toBe(400);
    expect(quoteRes.json().code).toBe('PROMO_NOT_ALLOWED');

    const redeemRes = await app.inject({
      method: 'POST',
      url: '/api/user/promo/redeem',
      cookies: { session: userToken(55555) },
      payload: { code: 'GIFT100' },
    });
    expect(redeemRes.statusCode).toBe(400);
    expect(redeemRes.json().code).toBe('PROMO_NOT_ALLOWED');
  });

  it('allows VIP checkout and confirmation into negative balance up to creditLimit and rejects beyond it', async () => {
    // Balance is 10_000, creditLimit is 100_000 -> purchasingPower is 110_000; VIP price is 80_000
    harness.mockUserService.findProfile.mockResolvedValue({
      id: 'u_55555',
      telegramId: 55555,
      username: 'vip_user',
      firstName: 'VIP',
      lastName: null,
      balance: 10_000,
      reservedBalance: 0,
      referralCode: 'ref_55555',
      totalSpend: 0,
      activeSubscriptionCount: 0,
      transactionCount: 0,
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 0,
      hasUsedTrial: false,
      isBanned: false,
      createdAt: new Date(),
    });
    harness.mockPurchaseCheckoutService.create.mockResolvedValueOnce({
      id: 'chk_vip_1',
      telegramId: 55555,
      kind: 'new_config',
      packageId: 'pkg_50gb',
      packageName: '50 GB - 30 Days',
      gbAmount: 50,
      durationDays: 30,
      amount: 80_000,
      quotedAmount: 80_000,
      requestedUsername: 'my_vip_vpn',
      expiresAt: new Date(Date.now() + 300_000),
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      cookies: { session: userToken(55555) },
      payload: { packageId: 'pkg_50gb', requestedUsername: 'my_vip_vpn' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.price).toBe(80_000);
    expect(created.creditLimit).toBe(100_000);
    expect(created.purchasingPower).toBe(110_000);
    expect(created.requestedUsername).toBe('my_vip_vpn');

    harness.mockPurchaseCheckoutService.claim.mockResolvedValueOnce({
      id: 'chk_vip_1',
      telegramId: 55555,
      kind: 'new_config',
      packageId: 'pkg_50gb',
      packageName: '50 GB - 30 Days',
      gbAmount: 50,
      durationDays: 30,
      amount: 80_000,
      quotedAmount: 80_000,
      requestedUsername: 'my_vip_vpn',
    });
    harness.mockWalletService.executePurchaseSaga.mockResolvedValueOnce({
      success: true,
      configUsername: 'my_vip_vpn',
      subUrl: 'https://sub.example.test/my_vip_vpn',
    });

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout/chk_vip_1/confirm',
      cookies: { session: userToken(55555) },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = confirmRes.json();
    expect(confirmed.availableBalanceAfter).toBe(-70_000);
    expect(confirmed.purchasingPowerAfter).toBe(30_000);

    // When creditLimit is too small (e.g. balance -50_000, creditLimit 100_000 -> purchasingPower 50_000 < 80_000)
    harness.mockUserService.findProfile.mockResolvedValueOnce({
      id: 'u_55555',
      telegramId: 55555,
      username: 'vip_user',
      firstName: 'VIP',
      lastName: null,
      balance: -50_000,
      reservedBalance: 0,
      referralCode: 'ref_55555',
      totalSpend: 0,
      activeSubscriptionCount: 0,
      transactionCount: 0,
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 0,
      hasUsedTrial: false,
      isBanned: false,
      createdAt: new Date(),
    });
    const overLimitRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      cookies: { session: userToken(55555) },
      payload: { packageId: 'pkg_50gb' },
    });
    expect(overLimitRes.statusCode).toBe(409);
    const overBody = overLimitRes.json();
    expect(overBody.code).toBe('INSUFFICIENT_BALANCE');
    expect(overBody.purchasingPower).toBe(50_000);
    expect(overBody.deficit).toBe(30_000);
  });

  it('serves admin group CRUD (including applyDiscountToCustomVolume) and user group assignment routes', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/groups',
      cookies: { session: adminToken(12345) },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().groups).toHaveLength(1);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/groups',
      cookies: { session: adminToken(12345) },
      payload: {
        name: 'Reseller',
        discountPercent: 15,
        applyDiscountToCustomVolume: false,
        customPricePerGb: 2500,
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(mockUserGroupService.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Reseller',
        discountPercent: 15,
        applyDiscountToCustomVolume: false,
        customPricePerGb: 2500,
      }),
      12345
    );

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/admin/groups/grp_vip',
      cookies: { session: adminToken(12345) },
      payload: { applyDiscountToCustomVolume: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(mockUserGroupService.updateGroup).toHaveBeenCalledWith(
      'grp_vip',
      expect.objectContaining({ applyDiscountToCustomVolume: true }),
      12345
    );

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/admin/groups/grp_vip',
      cookies: { session: adminToken(12345) },
      payload: { transferToGroupId: 'grp_default' },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(mockUserGroupService.deleteGroup).toHaveBeenCalledWith(
      'grp_vip',
      expect.objectContaining({ transferToGroupId: 'grp_default', actorAdminId: 12345 })
    );

    const assignRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users/55555/group',
      cookies: { session: adminToken(12345) },
      payload: { groupId: 'grp_vip', durationDays: 30 },
    });
    expect(assignRes.statusCode).toBe(200);
    expect(assignRes.json().success).toBe(true);
    expect(mockUserGroupService.assignUserGroup).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: 55555, groupId: 'grp_vip', actorAdminId: 12345 })
    );
  });
});
