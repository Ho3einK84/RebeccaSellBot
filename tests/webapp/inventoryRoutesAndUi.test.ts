import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { PricingService } from '../../src/domain/services/PricingService.js';
import {
  CUSTOM_VOLUME_INVENTORY_ID,
  InventoryUnavailableError,
  type InventoryService,
} from '../../src/domain/services/InventoryService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { BotServices } from '../../src/telegram/types.js';
import {
  createMockAdminServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';
import { api, setAuthToken } from '../../webapp/src/shared/lib/api.js';
import {
  validateCustomSettingsForm,
  validatePackageForm,
  validatePoliciesForm,
} from '../../webapp/src/features/admin/packages/packageValidation.js';

describe('Inventory WebApp API routes & frontend client/validation', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let rateLimitStore: ReturnType<typeof createResettableRateLimitStore>;
  let store: Record<string, string>;
  let inventoryMock: {
    getFleetCapacitySnapshot: ReturnType<typeof vi.fn>;
    getPackagesAvailabilityMap: ReturnType<typeof vi.fn>;
    getPackageInventoryRecord: ReturnType<typeof vi.fn>;
    getCustomVolumeAvailability: ReturnType<typeof vi.fn>;
    getTrialAvailability: ReturnType<typeof vi.fn>;
    setPackageInventory: ReturnType<typeof vi.fn>;
    deletePackageInventory: ReturnType<typeof vi.fn>;
  };
  let updatePanelMock: ReturnType<typeof vi.fn>;
  let updateServiceMock: ReturnType<typeof vi.fn>;
  let addServiceMock: ReturnType<typeof vi.fn>;
  let checkoutCreateMock: ReturnType<typeof vi.fn>;
  let checkoutClaimMock: ReturnType<typeof vi.fn>;
  let executePurchaseSagaMock: ReturnType<typeof vi.fn>;
  let claimTrialMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const base = createMockAdminServices();
    store = base.mockConfigStore;
    store.packages_json = JSON.stringify([
      {
        id: 'plan_avail',
        name: 'Available Plan',
        gbAmount: 30,
        durationDays: 30,
        price: 100_000,
        enabled: true,
        panelId: 'p1',
        serviceId: 1,
      },
      {
        id: 'plan_soldout',
        name: 'Sold Out Plan',
        gbAmount: 50,
        durationDays: 30,
        price: 150_000,
        enabled: true,
        panelId: 'p1',
        serviceId: 1,
      },
    ]);
    store.shop_show_out_of_stock = 'true';
    store.shop_low_stock_threshold = '5';
    store.custom_volume_enabled = 'true';

    const translationService = {
      getDefaultLocale: vi.fn(() => 'en' as const),
      getSetting: vi.fn((key: string, defaultValue = '') =>
        Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : defaultValue
      ),
      getSettingNum: vi.fn((key: string, defaultValue = 0) => {
        if (!Object.prototype.hasOwnProperty.call(store, key)) return defaultValue;
        const n = Number(store[key]);
        return Number.isFinite(n) ? n : defaultValue;
      }),
      getSettingBool: vi.fn((key: string, defaultValue = false) => {
        if (!Object.prototype.hasOwnProperty.call(store, key)) return defaultValue;
        return store[key] === 'true';
      }),
      updateSetting: vi.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      updateSettings: vi.fn(async (pairs: Record<string, string>) => {
        Object.assign(store, pairs);
      }),
    };

    const pricingService = new PricingService(translationService as unknown as TranslationService);
    const categoryService = {
      listCategories: vi.fn(async () => []),
      getCategoryById: vi.fn(async () => null),
    };

    inventoryMock = {
      getFleetCapacitySnapshot: vi.fn(async () => ({
        panels: [
          {
            panelId: 'p1',
            name: 'Panel DE',
            enabled: true,
            isDefault: true,
            activeConfigsCount: 48,
            reservedCount: 2,
            todayCreatedCount: 10,
            maxConfigs: 50,
            stockRemaining: 0,
            dailyCreateLimit: 20,
            remainingCapacity: 0,
            utilizationPercent: 100,
            isAvailableForCreate: false,
            unavailableReason: 'panel_capacity_full',
            services: [
              {
                panelId: 'p1',
                serviceId: 1,
                name: 'Main',
                enabled: false,
                isDefault: true,
                activeConfigsCount: 48,
                reservedCount: 2,
                todayCreatedCount: 10,
                maxConfigs: 50,
                stockRemaining: 5,
                dailyCreateLimit: 20,
                remainingCapacity: 0,
                utilizationPercent: 100,
                isAvailableForCreate: false,
                unavailableReason: 'service_disabled',
              },
            ],
          },
        ],
        summary: {
          totalPanels: 1,
          fullPanelsCount: 1,
          lowCapacityPanelsCount: 0,
          pausedServicesCount: 1,
          fullServicesCount: 0,
        },
      })),
      getPackagesAvailabilityMap: vi.fn(async () => {
        return new Map([
          [
            'plan_avail',
            {
              packageId: 'plan_avail',
              stockRemaining: 3,
              reservedCount: 0,
              soldCount: 12,
              maxPurchasesPerUser: 2,
              userPurchasedCount: 0,
              userLimitReached: false,
              effectiveRemaining: 3,
              renewalRemaining: 2,
              available: true,
              renewalAvailable: true,
              lowStock: true,
              unavailableReason: null,
              renewalUnavailableReason: null,
            },
          ],
          [
            'plan_soldout',
            {
              packageId: 'plan_soldout',
              stockRemaining: 0,
              reservedCount: 0,
              soldCount: 20,
              maxPurchasesPerUser: null,
              userPurchasedCount: 0,
              userLimitReached: false,
              effectiveRemaining: 0,
              renewalRemaining: 0,
              available: false,
              renewalAvailable: false,
              lowStock: false,
              unavailableReason: 'package_out_of_stock',
              renewalUnavailableReason: 'package_out_of_stock',
            },
          ],
        ]);
      }),
      getPackageInventoryRecord: vi.fn(async (pkgId: string) => ({
        packageId: pkgId,
        stockRemaining: 10,
        reservedCount: 0,
        soldCount: 0,
        maxPurchasesPerUser: 1,
        updatedAt: new Date(),
      })),
      getCustomVolumeAvailability: vi.fn(async () => ({
        skuId: CUSTOM_VOLUME_INVENTORY_ID,
        panelId: 'p1',
        serviceId: 1,
        stockRemaining: 0,
        reservedCount: 0,
        soldCount: 4,
        dailyLimit: 10,
        todayCreatedCount: 3,
        effectiveRemaining: 0,
        available: false,
        lowStock: false,
        unavailableReason: 'custom_volume_out_of_stock',
      })),
      getTrialAvailability: vi.fn(async () => ({
        skuId: '__trial__',
        panelId: 'p1',
        serviceId: 1,
        stockRemaining: 0,
        reservedCount: 0,
        soldCount: 5,
        dailyLimit: 5,
        todayCreatedCount: 5,
        effectiveRemaining: 0,
        available: false,
        lowStock: false,
        unavailableReason: 'trial_daily_limit_reached',
      })),
      setPackageInventory: vi.fn(async (packageId: string, changes: Record<string, unknown>) => ({
        packageId,
        stockRemaining: (changes.stockRemaining as number | null) ?? null,
        reservedCount: 0,
        soldCount: 0,
        maxPurchasesPerUser: (changes.maxPurchasesPerUser as number | null) ?? null,
        updatedAt: new Date(),
      })),
      deletePackageInventory: vi.fn(async () => undefined),
    };

    updatePanelMock = vi.fn(async () => undefined);
    updateServiceMock = vi.fn(async () => undefined);
    addServiceMock = vi.fn(async () => undefined);

    const panels = [
      {
        id: 'p1',
        name: 'Panel DE',
        baseUrl: 'https://panel.example.com',
        enabled: true,
        isDefault: true,
        credentialConfigured: true,
        credentialMode: 'api_key' as const,
        maxConfigs: 50,
        stockRemaining: 0,
        dailyCreateLimit: 20,
        services: [{ serviceId: 1, name: 'Main', enabled: false, isDefault: true }],
      },
    ];

    const panelRegistry = {
      ...base.mockPanelRegistry,
      listPanels: vi.fn(() => panels),
      getPanel: vi.fn((id: string) => panels.find((p) => p.id === id)),
      updatePanel: updatePanelMock,
      addService: addServiceMock,
      updateService: updateServiceMock,
      resolveTarget: vi.fn(async () => ({ panelId: 'p1', serviceId: 1 })),
    };

    checkoutCreateMock = vi.fn();
    checkoutClaimMock = vi.fn();
    executePurchaseSagaMock = vi.fn();
    claimTrialMock = vi.fn();

    const userService = {
      ...base.mockUserService,
      findProfile: vi.fn(async (id: string) => ({
        id: `u_${id}`,
        telegramId: Number(id),
        username: 'buyer',
        firstName: 'Test',
        lastName: 'User',
        balance: 500_000,
        reservedBalance: 0,
        referralCode: 'ref_buyer',
        totalSpend: 0,
        activeSubscriptionCount: 1,
        transactionCount: 1,
        referredUserCount: 0,
        referralBonusEarned: 0,
        cashbackEarned: 0,
        hasUsedTrial: false,
        createdAt: new Date().toISOString(),
        locale: 'en',
        isBanned: false,
      })),
    };

    const configService = {
      getOwnedConfigById: vi.fn(async () => ({
        id: 'cfg_1',
        telegramId: 55555,
        panelId: 'p1',
        serviceId: 1,
        configUsername: 'u55555_1',
        userLabel: null,
        panelStatus: 'active',
        panelDataLimit: 10 * 1024 ** 3,
        panelUsedTraffic: 0,
        panelExpire: Math.floor(Date.now() / 1000) + 86400 * 5,
        autoRenewEnabled: false,
        autoRenewPackageId: null,
        autoRenewPrice: null,
      })),
    };

    const services = {
      ...base.mockServices,
      userService,
      walletService: {
        ...base.mockWalletService,
        executePurchaseSaga: executePurchaseSagaMock,
      },
      configService,
      pricingService,
      packageCategoryService: categoryService,
      translationService,
      panelRegistry,
      inventoryService: inventoryMock as unknown as InventoryService,
      purchaseCheckoutService: {
        create: checkoutCreateMock,
        claim: checkoutClaimMock,
        markCompleted: vi.fn(async () => undefined),
        markFailed: vi.fn(async () => undefined),
      },
      trialService: {
        claimTrial: claimTrialMock,
      },
      adminService: {
        adminIds: [12345],
        isAdmin: vi.fn((id: number) => id === 12345),
      },
      adminIds: [12345],
    } as unknown as BotServices;

    rateLimitStore = createResettableRateLimitStore();
    app = await createWebAppServer(createTestConfig(), services, {
      serveStatic: false,
      rateLimitStore: rateLimitStore.Store,
    });
    await app.ready();
    adminToken = app.jwt.sign({ telegramId: 12345, role: 'admin' });
    userToken = app.jwt.sign({ telegramId: 55555, role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    rateLimitStore.reset();
    vi.clearAllMocks();
    store.shop_show_out_of_stock = 'true';
  });

  it('enriches admin stats and panels with live capacity metrics and validates panel/service limit PATCHes', async () => {
    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json().fleetCapacity).toEqual({
      totalPanels: 1,
      fullPanelsCount: 1,
      lowCapacityPanelsCount: 0,
      pausedServicesCount: 1,
      fullServicesCount: 0,
    });

    const panelsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/panels',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(panelsRes.statusCode).toBe(200);
    const body = panelsRes.json();
    expect(body.fleetSummary.fullPanelsCount).toBe(1);
    expect(body.fleetSummary.pausedServicesCount).toBe(1);
    expect(body.panels[0].utilizationPercent).toBe(100);
    expect(body.panels[0].services[0].enabled).toBe(false);
    expect(body.panels[0].services[0].unavailableReason).toBe('service_disabled');

    // Invalid negative limit rejected
    const badPanelPatch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/panels/p1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { maxConfigs: -5 },
    });
    expect(badPanelPatch.statusCode).toBe(400);

    // Valid panel capacity PATCH
    const okPanelPatch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/panels/p1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { maxConfigs: 100, stockRemaining: null, dailyCreateLimit: 25 },
    });
    expect(okPanelPatch.statusCode).toBe(200);
    expect(updatePanelMock).toHaveBeenCalledWith('p1', {
      maxConfigs: 100,
      stockRemaining: null,
      dailyCreateLimit: 25,
    });

    // Valid service PATCH (enable + limits)
    const okSvcPatch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/panels/p1/services/1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true, maxConfigs: 40, stockRemaining: 10, dailyCreateLimit: null },
    });
    expect(okSvcPatch.statusCode).toBe(200);
    expect(updateServiceMock).toHaveBeenCalledWith('p1', 1, {
      enabled: true,
      maxConfigs: 40,
      stockRemaining: 10,
      dailyCreateLimit: null,
    });
  });

  it('persists package inventory, policies, and custom volume limits via admin package routes', async () => {
    const patchPkg = await app.inject({
      method: 'PATCH',
      url: '/api/admin/packages/plan_avail',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { stockRemaining: 15, maxPurchasesPerUser: 2 },
    });
    expect(patchPkg.statusCode).toBe(200);
    expect(inventoryMock.setPackageInventory).toHaveBeenCalledWith('plan_avail', {
      stockRemaining: 15,
      maxPurchasesPerUser: 2,
    });

    const policiesRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/packages/policies',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { showOutOfStockPackages: false, lowStockThreshold: 7 },
    });
    expect(policiesRes.statusCode).toBe(200);
    expect(policiesRes.json().policies).toMatchObject({
      showOutOfStockPackages: false,
      lowStockThreshold: 7,
    });

    const customPut = await app.inject({
      method: 'PUT',
      url: '/api/admin/pricing/custom/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { stockRemaining: 25, dailyCreateLimit: 8 },
    });
    expect(customPut.statusCode).toBe(200);
    expect(inventoryMock.setPackageInventory).toHaveBeenCalledWith(CUSTOM_VOLUME_INVENTORY_ID, {
      stockRemaining: 25,
    });
    expect(store.custom_volume_daily_limit).toBe('8');
  });

  it('enforces shop out-of-stock visibility toggle, 409 checkout/confirm/trial errors, and packageId forwarding', async () => {
    // 1. Default showOutOfStock=true returns both packages with availability badges
    const shopAll = await app.inject({
      method: 'GET',
      url: '/api/user/packages',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(shopAll.statusCode).toBe(200);
    expect(shopAll.json().packages).toHaveLength(2);
    expect(shopAll.json().packages[0]).toMatchObject({
      id: 'plan_avail',
      available: true,
      lowStock: true,
      remainingStock: 3,
    });
    expect(shopAll.json().packages[1]).toMatchObject({
      id: 'plan_soldout',
      available: false,
      unavailableReason: 'package_out_of_stock',
    });

    // 2. When shop_show_out_of_stock='false', sold-out plan is hidden
    store.shop_show_out_of_stock = 'false';
    const shopFiltered = await app.inject({
      method: 'GET',
      url: '/api/user/packages',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(shopFiltered.statusCode).toBe(200);
    expect(shopFiltered.json().packages.map((p: { id: string }) => p.id)).toEqual(['plan_avail']);

    // 3. Checkout create returns 409 OUT_OF_STOCK on InventoryUnavailableError
    checkoutCreateMock.mockRejectedValueOnce(new InventoryUnavailableError('package_out_of_stock'));
    const checkoutFail = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { packageId: 'plan_soldout' },
    });
    expect(checkoutFail.statusCode).toBe(409);
    expect(checkoutFail.json()).toMatchObject({
      code: 'OUT_OF_STOCK',
      reason: 'package_out_of_stock',
    });

    // 4. Checkout confirm passes packageId to walletService.executePurchaseSaga and maps 409 CAPACITY_FULL
    checkoutClaimMock.mockResolvedValueOnce({
      id: 'chk_1',
      telegramId: 55555,
      kind: 'new_config',
      packageId: 'plan_avail',
      packageName: 'Available Plan',
      gbAmount: 30,
      durationDays: 30,
      amount: 100_000,
      quotedAmount: 100_000,
      panelId: 'p1',
      serviceId: 1,
    });
    executePurchaseSagaMock.mockRejectedValueOnce(
      new InventoryUnavailableError('panel_capacity_full')
    );
    const confirmFail = await app.inject({
      method: 'POST',
      url: '/api/user/checkout/chk_1/confirm',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(confirmFail.statusCode).toBe(409);
    expect(confirmFail.json()).toMatchObject({
      code: 'CAPACITY_FULL',
      reason: 'panel_capacity_full',
    });
    expect(executePurchaseSagaMock).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'plan_avail' })
    );

    // 5. Renewal options return renewal-specific availability (ignoring full panel)
    const renewOpts = await app.inject({
      method: 'GET',
      url: '/api/user/configs/cfg_1/renewal-options',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(renewOpts.statusCode).toBe(200);
    expect(renewOpts.json().packages[0]).toMatchObject({
      id: 'plan_avail',
      available: true,
      remainingStock: 2,
    });

    // 6. Trial claim returns 409 DAILY_LIMIT_REACHED when TrialService returns unavailableReason
    claimTrialMock.mockResolvedValueOnce({
      success: false,
      messageKey: 'trial_daily_limit_reached',
      unavailableReason: 'trial_daily_limit_reached',
    });
    const trialRes = await app.inject({
      method: 'POST',
      url: '/api/user/trial/claim',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(trialRes.statusCode).toBe(409);
    expect(trialRes.json()).toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
      reason: 'trial_daily_limit_reached',
    });
  });

  it('validates frontend inventory fields (including Persian digits) and calls updateAdminPanelService', async () => {
    const pkgValid = validatePackageForm(
      {
        id: 'plan_test',
        name: 'Test Plan',
        gbAmount: '30',
        durationDays: '30',
        price: '100000',
        categoryId: '',
        panelId: '',
        serviceId: '',
        enabled: true,
        stockRemaining: '۲۵',
        maxPurchasesPerUser: '۲',
      },
      { mode: 'create', existingPackages: [] }
    );
    expect(pkgValid.valid).toBe(true);
    expect(pkgValid.parsed?.stockRemaining).toBe(25);
    expect(pkgValid.parsed?.maxPurchasesPerUser).toBe(2);

    const pkgInvalid = validatePackageForm(
      {
        id: 'plan_test',
        name: 'Test Plan',
        gbAmount: '30',
        durationDays: '30',
        price: '100000',
        categoryId: '',
        panelId: '',
        serviceId: '',
        enabled: true,
        stockRemaining: '-1',
        maxPurchasesPerUser: '0',
      },
      { mode: 'create', existingPackages: [] }
    );
    expect(pkgInvalid.valid).toBe(false);
    expect(pkgInvalid.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['stockRemaining', 'maxPurchasesPerUser'])
    );

    const customValid = validateCustomSettingsForm({
      enabled: true,
      pricePerGb: '5000',
      pricePerDay: '0',
      minGb: '5',
      maxGb: '500',
      defaultDays: '30',
      panelId: '',
      serviceId: '',
      stockRemaining: '۱۰',
      dailyCreateLimit: '۵',
    });
    expect(customValid.valid).toBe(true);
    expect(customValid.parsed?.stockRemaining).toBe(10);
    expect(customValid.parsed?.dailyCreateLimit).toBe(5);

    const policiesValid = validatePoliciesForm({
      packageDisplayMode: 'specs',
      lowTrafficThresholdGb: '2',
      expiryWarningDays: '3',
      refundWindowHours: '24',
      showOutOfStockPackages: false,
      lowStockThreshold: '۸',
    });
    expect(policiesValid.valid).toBe(true);
    expect(policiesValid.parsed?.showOutOfStockPackages).toBe(false);
    expect(policiesValid.parsed?.lowStockThreshold).toBe(8);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('jwt-test');
    await api.updateAdminPanelService('panel-1', 2, {
      enabled: false,
      maxConfigs: 50,
      stockRemaining: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/panels/panel-1/services/2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false, maxConfigs: 50, stockRemaining: null }),
      })
    );
    setAuthToken(null);
  });
});
