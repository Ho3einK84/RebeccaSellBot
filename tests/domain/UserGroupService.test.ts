import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEUTRAL_USER_GROUP_POLICY,
  UserGroupService,
  formatUserGroupDisplayLabel,
  resolveEffectivePolicyFromRows,
  type EffectiveUserGroupPolicy,
  type UserGroupRow,
} from '../../src/domain/services/UserGroupService.js';
import { PricingService, type PackageOption } from '../../src/domain/services/PricingService.js';
import { resolvePurchasePackage } from '../../src/domain/services/PurchasePackageResolver.js';
import { isCustomServiceNameAllowed } from '../../src/domain/services/FeatureSettings.js';
import { PromoService, PromoValidationError } from '../../src/domain/services/PromoService.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import { LuckyWheelService } from '../../src/domain/services/LuckyWheelService.js';
import type { CatalogDiscountRule } from '../../src/domain/services/CatalogDiscountService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { runAutoRenewalSweep, type AutoRenewalCandidate } from '../../src/jobs/autoRenewal.js';
import type { Api } from 'grammy';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { WalletService } from '../../src/domain/services/WalletService.js';
import { getDb } from '../../src/infra/db.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function makeGroupRow(overrides: Partial<UserGroupRow> = {}): UserGroupRow {
  const now = new Date('2026-11-24T00:00:00Z');
  return {
    id: 'grp_vip',
    name: 'VIP Gold',
    badge: '👑 VIP',
    isDefault: false,
    discountPercent: 20,
    applyDiscountToCustomVolume: false,
    customPricePerGb: null,
    customPricePerDay: null,
    allowCatalogDiscounts: false,
    allowPromoCodes: false,
    allowCashback: false,
    allowLuckyWheel: false,
    allowCustomServiceName: true,
    creditLimit: 200_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTranslationService(settings: Record<string, string> = {}): TranslationService {
  const store: Record<string, string> = {
    price_per_gb: '5000',
    price_per_day: '0',
    custom_volume_enabled: 'true',
    custom_min_gb: '5',
    custom_max_gb: '500',
    custom_default_days: '30',
    custom_service_name_enabled: 'false',
    cashback_percent: '10',
    referral_bonus_toman: '15000',
    lucky_wheel_enabled: 'true',
    lucky_wheel_min_amount: '5000',
    lucky_wheel_max_amount: '25000',
    lucky_wheel_max_spins: '5',
    lucky_wheel_cooldown_hours: '24',
    ...settings,
  };

  return {
    getSetting: vi.fn((key: string, fallback = '') => store[key] ?? fallback),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const raw = store[key];
      if (raw === undefined) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    }),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const raw = store[key];
      if (raw === undefined) return fallback;
      return raw === 'true' || raw === '1';
    }),
    get: vi.fn((key: string) => key),
    getDefaultLocale: vi.fn(() => 'fa'),
  } as unknown as TranslationService;
}

describe('UserGroupService policy resolution, pricing pipeline, anti-double-discount & feature gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves assigned group, transparent expiry fallback to default group, and neutral fallback', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const vip = makeGroupRow();
    const defaultGrp = makeGroupRow({
      id: 'grp_default',
      name: 'Standard',
      badge: null,
      isDefault: true,
      discountPercent: 5,
      allowCatalogDiscounts: true,
      allowPromoCodes: true,
      allowCashback: true,
      allowLuckyWheel: true,
      allowCustomServiceName: false,
      creditLimit: 0,
    });

    // Active VIP membership
    const activeVip = resolveEffectivePolicyFromRows(
      { groupId: vip.id, groupExpiresAt: new Date('2026-12-01T00:00:00Z') },
      vip,
      defaultGrp,
      now
    );
    expect(activeVip.groupId).toBe('grp_vip');
    expect(activeVip.isAssigned).toBe(true);
    expect(activeVip.isExpired).toBe(false);
    expect(activeVip.discountPercent).toBe(20);
    expect(activeVip.creditLimit).toBe(200_000);
    expect(activeVip.allowCatalogDiscounts).toBe(false);
    expect(formatUserGroupDisplayLabel(activeVip)).toBe('👑 VIP VIP Gold');

    // Expired VIP membership transparently falls back to default group
    const expiredVip = resolveEffectivePolicyFromRows(
      { groupId: vip.id, groupExpiresAt: new Date('2026-11-20T00:00:00Z') },
      vip,
      defaultGrp,
      now
    );
    expect(expiredVip.groupId).toBe('grp_default');
    expect(expiredVip.isDefaultGroup).toBe(true);
    expect(expiredVip.isAssigned).toBe(false);
    expect(expiredVip.isExpired).toBe(true);
    expect(expiredVip.discountPercent).toBe(5);
    expect(expiredVip.creditLimit).toBe(0);
    expect(expiredVip.allowCatalogDiscounts).toBe(true);

    // Expired VIP without default group falls back to neutral defaults
    const expiredNeutral = resolveEffectivePolicyFromRows(
      { groupId: vip.id, groupExpiresAt: new Date('2026-11-20T00:00:00Z') },
      vip,
      null,
      now
    );
    expect(expiredNeutral.groupId).toBeNull();
    expect(expiredNeutral.isExpired).toBe(true);
    expect(expiredNeutral.discountPercent).toBe(0);
    expect(expiredNeutral.creditLimit).toBe(0);
    expect(expiredNeutral.allowCatalogDiscounts).toBe(true);

    // Ungrouped user inherits default group
    const ungrouped = resolveEffectivePolicyFromRows(
      { groupId: null, groupExpiresAt: null },
      null,
      defaultGrp,
      now
    );
    expect(ungrouped.groupId).toBe('grp_default');
    expect(ungrouped.discountPercent).toBe(5);
    expect(ungrouped.isAssigned).toBe(false);
  });

  it('enforces group pricing pipeline and anti-double-discount on static and custom packages', () => {
    const pkg: PackageOption = {
      id: 'pkg_50gb',
      name: '50 GB - 30 Days',
      gbAmount: 50,
      durationDays: 30,
      price: 100_000,
      categoryId: 'cat_main',
    };
    const ts = makeTranslationService({
      packages_json: JSON.stringify([pkg]),
      price_per_gb: '5000',
      price_per_day: '100',
      volume_pricing_tiers_json: JSON.stringify([{ id: 'tier_bulk', minGb: 20, pricePerGb: 4000 }]),
    });
    const pricing = new PricingService(ts);
    const activeDiscounts: CatalogDiscountRule[] = [
      {
        id: 'disc_flash',
        title: 'Flash 10%',
        scope: 'all',
        targetId: null,
        discountType: 'percent',
        value: 10,
        maxDiscountAmount: null,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: null,
        active: true,
      },
    ];
    const now = new Date('2026-11-24T12:00:00Z');

    // Anti-double-discount ON (allowCatalogDiscounts: false) -> only 20% group discount applies
    const vipNoCatalog: EffectiveUserGroupPolicy = {
      ...NEUTRAL_USER_GROUP_POLICY,
      groupId: 'grp_vip',
      discountPercent: 20,
      allowCatalogDiscounts: false,
    };
    const pricedNoCatalog = pricing.resolvePackagePrice(pkg, activeDiscounts, now, vipNoCatalog);
    expect(pricedNoCatalog.originalPrice).toBe(100_000);
    expect(pricedNoCatalog.effectivePrice).toBe(80_000);
    expect(pricedNoCatalog.groupDiscountPercent).toBe(20);
    expect(pricedNoCatalog.groupDiscountAmount).toBe(20_000);
    expect(pricedNoCatalog.catalogDiscountAmount).toBeUndefined();
    expect(pricedNoCatalog.activeDiscountTitle).toBeNull();

    // When allowCatalogDiscounts: true -> group discount first (80_000), then catalog 10% (72_000)
    const vipWithCatalog: EffectiveUserGroupPolicy = {
      ...vipNoCatalog,
      allowCatalogDiscounts: true,
    };
    const pricedWithCatalog = pricing.resolvePackagePrice(
      pkg,
      activeDiscounts,
      now,
      vipWithCatalog
    );
    expect(pricedWithCatalog.originalPrice).toBe(100_000);
    expect(pricedWithCatalog.effectivePrice).toBe(72_000);
    expect(pricedWithCatalog.groupDiscountAmount).toBe(20_000);
    expect(pricedWithCatalog.catalogDiscountAmount).toBe(8_000);
    expect(pricedWithCatalog.activeDiscountTitle).toBe('Flash 10%');

    // Custom volume with group custom GB/day rates: by default (applyDiscountToCustomVolume: false),
    // group discountPercent applies ONLY to catalog packages and does NOT double-discount custom volume.
    const customRateGroup: EffectiveUserGroupPolicy = {
      ...NEUTRAL_USER_GROUP_POLICY,
      groupId: 'grp_reseller',
      customPricePerGb: 3_000,
      customPricePerDay: 500,
      discountPercent: 10,
      applyDiscountToCustomVolume: false,
      allowCatalogDiscounts: false,
    };
    const resolvedCustomNoGroupDisc = resolvePurchasePackage({
      custom: { gb: 20, days: 30 },
      pricingService: pricing,
      translationService: ts,
      userPolicy: customRateGroup,
      activeDiscounts,
      now,
    });
    expect(resolvedCustomNoGroupDisc.success).toBe(true);
    if (resolvedCustomNoGroupDisc.success) {
      // 20 * 3000 + 30 * 500 = 75_000; group discountPercent skipped on custom volume; catalog blocked
      expect(resolvedCustomNoGroupDisc.originalPrice).toBe(75_000);
      expect(resolvedCustomNoGroupDisc.quotedAmount).toBe(75_000);
      expect(resolvedCustomNoGroupDisc.groupDiscountPercent).toBe(0);
      expect(resolvedCustomNoGroupDisc.groupDiscountAmount).toBe(0);
      expect(resolvedCustomNoGroupDisc.catalogDiscountAmount).toBe(0);
    }

    // Same group still gets its 10% discount on standard catalog packages
    const resolvedStaticForReseller = resolvePurchasePackage({
      packageId: pkg.id,
      pricingService: pricing,
      translationService: ts,
      userPolicy: customRateGroup,
      activeDiscounts,
      now,
    });
    expect(resolvedStaticForReseller.success).toBe(true);
    if (resolvedStaticForReseller.success) {
      expect(resolvedStaticForReseller.originalPrice).toBe(100_000);
      expect(resolvedStaticForReseller.quotedAmount).toBe(90_000);
      expect(resolvedStaticForReseller.groupDiscountPercent).toBe(10);
      expect(resolvedStaticForReseller.groupDiscountAmount).toBe(10_000);
    }

    // When applyDiscountToCustomVolume: true is explicitly enabled, group discountPercent applies to custom volume too
    const resolvedCustomWithGroupDisc = resolvePurchasePackage({
      custom: { gb: 20, days: 30 },
      pricingService: pricing,
      translationService: ts,
      userPolicy: { ...customRateGroup, applyDiscountToCustomVolume: true },
      activeDiscounts,
      now,
    });
    expect(resolvedCustomWithGroupDisc.success).toBe(true);
    if (resolvedCustomWithGroupDisc.success) {
      // 20 * 3000 + 30 * 500 = 75_000; -10% = 67_500; catalog discount blocked
      expect(resolvedCustomWithGroupDisc.originalPrice).toBe(75_000);
      expect(resolvedCustomWithGroupDisc.quotedAmount).toBe(67_500);
      expect(resolvedCustomWithGroupDisc.groupDiscountPercent).toBe(10);
      expect(resolvedCustomWithGroupDisc.groupDiscountAmount).toBe(7_500);
      expect(resolvedCustomWithGroupDisc.catalogDiscountAmount).toBe(0);
    }

    // Custom service name flag: allowed via group OR global setting
    expect(isCustomServiceNameAllowed(ts, NEUTRAL_USER_GROUP_POLICY)).toBe(false);
    expect(
      isCustomServiceNameAllowed(ts, {
        ...NEUTRAL_USER_GROUP_POLICY,
        allowCustomServiceName: true,
      })
    ).toBe(true);
  });

  it('blocks promo codes, cashback, and lucky wheel when group flags disable them', async () => {
    const blockedPolicy: EffectiveUserGroupPolicy = {
      ...NEUTRAL_USER_GROUP_POLICY,
      groupId: 'grp_vip',
      allowPromoCodes: false,
      allowCashback: false,
      allowLuckyWheel: false,
    };
    const mockGroupService = {
      getEffectiveUserPolicy: vi.fn().mockResolvedValue(blockedPolicy),
      getEffectiveUserPolicyInTx: vi.fn().mockResolvedValue(blockedPolicy),
    } as unknown as UserGroupService;

    const ts = makeTranslationService({
      cashback_percent: '15',
      referral_bonus_toman: '12000',
      lucky_wheel_enabled: 'true',
    });

    // PromoService rejects selection & quote
    const promoService = new PromoService(mockGroupService);
    await expect(promoService.quoteForPurchase(1001, 'SAVE20', 80_000, 50)).rejects.toThrow(
      PromoValidationError
    );
    await expect(promoService.quoteForPurchase(1001, 'SAVE20', 80_000, 50)).rejects.toMatchObject({
      messageKey: 'promo_not_allowed_for_group',
    });
    const redeemRes = await promoService.redeemCode(1001, 'GIFT100');
    expect(redeemRes).toEqual({ success: false, messageKey: 'promo_not_allowed_for_group' });

    // ReferralService zeros cashback when allowCashback=false while keeping referrer bonus
    const referralDb = createMockDb({
      selectResults: [[{ referrerId: 2002, groupId: 'grp_vip', groupExpiresAt: null }], []],
    });
    const referralService = new ReferralService(ts, mockGroupService);
    const snapshot = await referralService.calculateBonusSnapshot(
      referralDb.db as never,
      1001,
      100_000
    );
    expect(snapshot.cashbackPercent).toBe(0);
    expect(snapshot.cashbackAmount).toBe(0);
    expect(snapshot.referrerTelegramId).toBe(2002);
    expect(snapshot.referralBonusAmount).toBe(12_000);

    // LuckyWheelService disables status and rejects spin
    const wheelDb = createMockDb({
      selectResults: [
        [{ telegramId: 1001, isBanned: false, groupId: 'grp_vip', groupExpiresAt: null }],
      ],
    });
    vi.mocked(getDb).mockReturnValue(wheelDb.db as never);
    const wheelService = new LuckyWheelService(ts, mockGroupService);
    const wheelStatus = await wheelService.getStatus(1001);
    expect(wheelStatus.enabled).toBe(false);
    expect(wheelStatus.canSpin).toBe(false);
    expect(wheelStatus.reason).toBe('disabled');
    await expect(wheelService.spin(1001)).rejects.toThrow('LUCKY_WHEEL_DISABLED');
  });

  it('prices auto-renewal with user group discount and respects VIP credit limit', async () => {
    const pkg: PackageOption = {
      id: 'pkg_30gb',
      name: '30 GB',
      gbAmount: 30,
      durationDays: 30,
      price: 100_000,
    };
    const ts = makeTranslationService({ packages_json: JSON.stringify([pkg]) });
    const pricing = new PricingService(ts);

    const vipPolicy: EffectiveUserGroupPolicy = {
      ...NEUTRAL_USER_GROUP_POLICY,
      groupId: 'grp_vip',
      discountPercent: 25, // 100_000 -> 75_000
      allowCatalogDiscounts: false,
      creditLimit: 100_000,
    };
    const mockGroupService = {
      getEffectiveUserPolicy: vi.fn().mockResolvedValue(vipPolicy),
    } as unknown as UserGroupService;

    const now = new Date('2026-11-24T12:00:00Z');
    const candidate: AutoRenewalCandidate = {
      configId: 'cfg_1',
      telegramId: 5001,
      locale: 'en',
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'vip_auto_user',
      userLabel: null,
      autoRenewPackageId: 'pkg_30gb',
      autoRenewPrice: 100_000,
    };

    const executePurchaseSaga = vi.fn().mockResolvedValue({ success: true });
    const walletService = {
      // Balance is 10_000, but with creditLimit 100_000 purchasing power is 110_000 >= 75_000
      getBalance: vi.fn().mockResolvedValue(10_000),
      executePurchaseSaga,
    } as unknown as WalletService;
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue({
        username: 'vip_auto_user',
        status: 'active',
        data_limit: 30 * 1024 ** 3,
        used_traffic: 29.5 * 1024 ** 3,
        expire: Math.floor(now.getTime() / 1000) + 3600,
      }),
    } as unknown as RebeccaService;
    const telegramApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    } as unknown as Api;
    const deliveryStore = {
      recordIfNotActive: vi.fn().mockResolvedValue(true),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };

    const summary = await runAutoRenewalSweep(
      rebeccaService,
      walletService,
      pricing,
      ts,
      telegramApi,
      { listEnabledConfigs: vi.fn().mockResolvedValue([candidate]) },
      deliveryStore,
      now,
      { userGroupService: mockGroupService }
    );

    expect(summary.renewed).toBe(1);
    expect(executePurchaseSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 5001,
        amount: 75_000,
        type: 'renew_config',
      })
    );
  });

  it('validates group input constraints before touching the database', async () => {
    const svc = new UserGroupService();
    await expect(svc.createGroup({ name: '   ' })).rejects.toThrow('INVALID_GROUP_NAME');
    await expect(svc.createGroup({ name: 'VIP', discountPercent: 91 })).rejects.toThrow(
      'INVALID_DISCOUNT_PERCENT'
    );
    await expect(svc.createGroup({ name: 'VIP', discountPercent: -1 })).rejects.toThrow(
      'INVALID_DISCOUNT_PERCENT'
    );
    await expect(svc.createGroup({ name: 'VIP', creditLimit: -500 })).rejects.toThrow(
      'INVALID_CREDIT_LIMIT'
    );
    await expect(svc.createGroup({ name: 'VIP', customPricePerGb: -10 })).rejects.toThrow(
      'INVALID_CUSTOM_PRICE'
    );
  });
});
