import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  FALLBACK_PACKAGES,
  MAX_PACKAGE_COUNT,
  MAX_PRICE_RULES,
  PricingService,
  parseCustomPriceOverridesJson,
  parsePackageOptionsJson,
  parseVolumePricingTiersJson,
} from '../../src/domain/services/PricingService.js';
import type {
  CreateCategoryInput,
  PackageCategory,
  UpdateCategoryInput,
} from '../../src/domain/services/PackageCategoryService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { BotServices } from '../../src/telegram/types.js';
import {
  createMockAdminServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';

function createPackageTestServerHarness() {
  const base = createMockAdminServices();
  const store = base.mockConfigStore;
  const adminIds = new Set<number>([12345]);

  const translationService = {
    getDefaultLocale: vi.fn(() => 'en' as const),
    getSetting: vi.fn((key: string, defaultValue = '') =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : defaultValue
    ),
    getSettingNum: vi.fn((key: string, defaultValue = 0) => {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return defaultValue;
      const raw = store[key]!.trim();
      if (raw === '') return defaultValue;
      const num = Number(raw);
      return Number.isFinite(num) ? num : defaultValue;
    }),
    getSettingBool: vi.fn((key: string, defaultValue = false) => {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return defaultValue;
      const normalized = store[key]!.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      return defaultValue;
    }),
    updateSetting: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    updateSettings: vi.fn(async (pairs: Record<string, string>) => {
      for (const [k, v] of Object.entries(pairs)) {
        store[k] = v;
      }
    }),
  };

  const pricingService = new PricingService(translationService as unknown as TranslationService);

  const categories = new Map<string, PackageCategory>();
  const categoryService = {
    listCategories: vi.fn(async (includeDisabled = false) => {
      const sorted = [...categories.values()].sort((a, b) => a.displayOrder - b.displayOrder);
      return includeDisabled ? sorted : sorted.filter((c) => c.enabled);
    }),
    getCategoryById: vi.fn(async (id: string) => categories.get(id.trim()) ?? null),
    createCategory: vi.fn(async (input: CreateCategoryInput) => {
      const trimmedName = input.name.trim();
      if (!trimmedName || trimmedName.length > 100) {
        throw new Error('INVALID_CATEGORY_NAME');
      }
      const nextOrder =
        input.displayOrder ??
        [...categories.values()].reduce((max, c) => Math.max(max, c.displayOrder), -1) + 1;
      const id = (input.id?.trim() || `cat_${crypto.randomBytes(4).toString('hex')}`).slice(0, 64);
      const now = new Date('2026-04-01T10:00:00Z');
      const created: PackageCategory = {
        id,
        name: trimmedName,
        description: input.description?.trim() || null,
        icon: input.icon?.trim() || null,
        displayOrder: Math.max(0, nextOrder),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      categories.set(id, created);
      return created;
    }),
    updateCategory: vi.fn(async (id: string, input: UpdateCategoryInput) => {
      const existing = categories.get(id.trim());
      if (!existing) return null;
      const updated: PackageCategory = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
        ...(input.icon !== undefined ? { icon: input.icon.trim() || null } : {}),
        ...(input.displayOrder !== undefined
          ? { displayOrder: Math.max(0, input.displayOrder) }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date('2026-04-01T11:00:00Z'),
      };
      categories.set(existing.id, updated);
      return updated;
    }),
    deleteCategory: vi.fn(async (id: string) => {
      const trimmedId = id.trim();
      if (!categories.delete(trimmedId)) return false;
      const packages = parsePackageOptionsJson(translationService.getSetting('packages_json'));
      if (packages && packages.some((pkg) => pkg.categoryId === trimmedId)) {
        const unlinked = packages.map((pkg) =>
          pkg.categoryId === trimmedId ? { ...pkg, categoryId: undefined } : pkg
        );
        await translationService.updateSetting('packages_json', JSON.stringify(unlinked));
      }
      return true;
    }),
    reorderCategories: vi.fn(async (orderedIds: string[]) => {
      orderedIds.forEach((id, index) => {
        const existing = categories.get(id.trim());
        if (existing) {
          categories.set(existing.id, { ...existing, displayOrder: index });
        }
      });
    }),
  };

  const panels = [
    {
      id: 'panel_1',
      name: 'Primary Germany',
      baseUrl: 'https://panel1.example.com',
      enabled: true,
      isDefault: true,
      credentialConfigured: true,
      credentialMode: 'api_key' as const,
      services: [
        { serviceId: 1, name: 'V2Ray Standard', isDefault: true },
        { serviceId: 2, name: 'VIP Low-Ping', isDefault: false },
      ],
    },
    {
      id: 'panel_disabled',
      name: 'Maintenance Panel',
      baseUrl: 'https://panel2.example.com',
      enabled: false,
      isDefault: false,
      credentialConfigured: true,
      credentialMode: 'api_key' as const,
      services: [{ serviceId: 5, name: 'Reserve Service', isDefault: true }],
    },
  ];

  const panelRegistry = {
    ...base.mockPanelRegistry,
    listPanels: vi.fn(() => panels),
    getPanel: vi.fn((panelId: string) => panels.find((p) => p.id === panelId)),
  };

  const adminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => adminIds.has(id)),
  };

  const services = {
    ...base.mockServices,
    adminService,
    pricingService,
    packageCategoryService: categoryService,
    translationService,
    panelRegistry,
  } as unknown as BotServices;

  const initialStoreEntries = Object.entries(store);
  const reset = () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    for (const [key, value] of initialStoreEntries) {
      store[key] = value;
    }
    categories.clear();
    adminIds.clear();
    adminIds.add(12345);
    vi.clearAllMocks();
  };

  return {
    services,
    store,
    categories,
    panels,
    adminIds,
    mockUserService: base.mockUserService,
    translationService,
    reset,
  };
}

describe('Admin Package, Category & Custom Tariff Routes', () => {
  let app: FastifyInstance;
  let harness: ReturnType<typeof createPackageTestServerHarness>;
  const rateLimits = createResettableRateLimitStore();

  beforeAll(async () => {
    harness = createPackageTestServerHarness();
    app = await createWebAppServer(createTestConfig(), harness.services, {
      serveStatic: false,
      rateLimitStore: rateLimits.Store,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    harness.reset();
    rateLimits.reset();
  });

  const getAdminToken = (telegramId = 12345) => app.jwt.sign({ telegramId, role: 'admin' });

  const getUserToken = () => app.jwt.sign({ telegramId: 55555, role: 'user' });

  describe('Auth Guard (403 across all new routes)', () => {
    const endpoints: Array<{
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      url: string;
      payload?: unknown;
    }> = [
      { method: 'GET', url: '/api/admin/packages' },
      {
        method: 'POST',
        url: '/api/admin/packages',
        payload: { name: 'Starter', gbAmount: 10, durationDays: 30, price: 50_000 },
      },
      {
        method: 'PUT',
        url: '/api/admin/packages/policies',
        payload: { packageDisplayMode: 'name' },
      },
      { method: 'POST', url: '/api/admin/packages/reorder', payload: { orderedIds: [] } },
      { method: 'PATCH', url: '/api/admin/packages/pkg_1', payload: { name: 'Updated' } },
      { method: 'POST', url: '/api/admin/packages/pkg_1/toggle' },
      { method: 'POST', url: '/api/admin/packages/pkg_1/clone' },
      { method: 'DELETE', url: '/api/admin/packages/pkg_1' },
      { method: 'GET', url: '/api/admin/categories' },
      { method: 'POST', url: '/api/admin/categories', payload: { name: 'VIP' } },
      { method: 'POST', url: '/api/admin/categories/reorder', payload: { orderedIds: [] } },
      { method: 'PATCH', url: '/api/admin/categories/cat_1', payload: { name: 'VIP 2' } },
      { method: 'POST', url: '/api/admin/categories/cat_1/toggle' },
      { method: 'DELETE', url: '/api/admin/categories/cat_1' },
      { method: 'GET', url: '/api/admin/pricing/custom' },
      { method: 'PUT', url: '/api/admin/pricing/custom/settings', payload: { pricePerGb: 6000 } },
      {
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        payload: { minGb: 50, discountPercent: 10 },
      },
      {
        method: 'PATCH',
        url: '/api/admin/pricing/custom/tiers/tier_1',
        payload: { minGb: 60 },
      },
      { method: 'DELETE', url: '/api/admin/pricing/custom/tiers/tier_1' },
      {
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides',
        payload: { minGb: 100, price: 250_000 },
      },
      {
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides/reorder',
        payload: { orderedIds: [] },
      },
      {
        method: 'PATCH',
        url: '/api/admin/pricing/custom/overrides/ovr_1',
        payload: { price: 240_000 },
      },
      { method: 'DELETE', url: '/api/admin/pricing/custom/overrides/ovr_1' },
      {
        method: 'POST',
        url: '/api/admin/pricing/custom/quote',
        payload: { gbAmount: 20, durationDays: 30 },
      },
    ];

    for (const ep of endpoints) {
      it(`rejects unauthenticated & non-admin user on ${ep.method} ${ep.url}`, async () => {
        const unauth = await app.inject({ method: ep.method, url: ep.url, payload: ep.payload });
        expect(unauth.statusCode).toBe(403);
        expect(unauth.json()).toEqual({ error: 'Forbidden' });

        const nonAdmin = await app.inject({
          method: ep.method,
          url: ep.url,
          headers: { authorization: `Bearer ${getUserToken()}` },
          payload: ep.payload,
        });
        expect(nonAdmin.statusCode).toBe(403);
        expect(nonAdmin.json()).toEqual({ error: 'Forbidden' });
      });
    }

    it('rejects a previously signed admin JWT after admin revocation', async () => {
      const revokedToken = getAdminToken(12345);
      harness.adminIds.delete(12345);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/packages',
        cookies: { session: revokedToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    });
  });

  describe('Packages CRUD, Fallback Materialization, Targets & Policies', () => {
    it('returns materialized FALLBACK_PACKAGES with isFallbackActive=true when packages_json is unset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isFallbackActive).toBe(true);
      expect(body.totalPackages).toBe(FALLBACK_PACKAGES.length);
      expect(body.packages.map((p: { id: string }) => p.id)).toEqual(
        FALLBACK_PACKAGES.map((p) => p.id)
      );
      expect(body.targets).toHaveLength(2);
      expect(body.policies).toEqual({
        packageDisplayMode: 'specs',
        lowTrafficThresholdGb: 2,
        expiryWarningDays: 3,
        refundWindowHours: 0,
        showOutOfStockPackages: true,
        lowStockThreshold: 5,
      });
      expect(body.targets[0]).toMatchObject({
        panelId: 'panel_1',
        enabled: true,
        defaultServiceId: 1,
      });
      expect(harness.store.packages_json).toBeUndefined();
    });

    it('materializes FALLBACK_PACKAGES on first create and binds panel+service & category cleanly', async () => {
      await harness.services.packageCategoryService!.createCategory({
        id: 'cat_gaming',
        name: 'Gaming',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: 'Pro Gaming 80GB',
          gbAmount: 80,
          durationDays: 30,
          price: 290_000,
          panelId: 'panel_1',
          serviceId: 2,
          categoryId: 'cat_gaming',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const createdBody = createRes.json();
      expect(createdBody.package).toMatchObject({
        id: 'pkg_pro_gaming_80gb',
        name: 'Pro Gaming 80GB',
        gbAmount: 80,
        durationDays: 30,
        price: 290_000,
        enabled: true,
        panelId: 'panel_1',
        serviceId: 2,
        categoryId: 'cat_gaming',
      });
      expect(createdBody.packages).toHaveLength(FALLBACK_PACKAGES.length + 1);
      expect(harness.store.packages_json).toBeDefined();
      expect(harness.mockUserService.recordAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actorTelegramId: 12345,
          action: 'admin_create_package',
          entityId: 'pkg_pro_gaming_80gb',
        })
      );

      // Duplicate name rejected case-insensitively with whitespace trimming
      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: '  pro gaming 80gb ',
          gbAmount: 40,
          durationDays: 30,
          price: 150_000,
        },
      });
      expect(dupRes.statusCode).toBe(409);
      expect(dupRes.json().code).toBe('DUPLICATE_PACKAGE_NAME');
    });

    it('enforces strict all-or-nothing target validation, disabled panel guard, and category checks', async () => {
      const partialRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: 'Partial Target',
          gbAmount: 10,
          durationDays: 30,
          price: 50_000,
          panelId: 'panel_1',
        },
      });
      expect(partialRes.statusCode).toBe(400);
      expect(partialRes.json().code).toBe('INCOMPLETE_TARGET');

      const disabledPanelRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: 'Disabled Target',
          gbAmount: 10,
          durationDays: 30,
          price: 50_000,
          panelId: 'panel_disabled',
          serviceId: 5,
        },
      });
      expect(disabledPanelRes.statusCode).toBe(400);
      expect(disabledPanelRes.json().code).toBe('PANEL_DISABLED');

      const badServiceRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: 'Missing Service',
          gbAmount: 10,
          durationDays: 30,
          price: 50_000,
          panelId: 'panel_1',
          serviceId: 999,
        },
      });
      expect(badServiceRes.statusCode).toBe(400);
      expect(badServiceRes.json().code).toBe('SERVICE_NOT_FOUND');

      const missingCatRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: {
          name: 'Missing Category',
          gbAmount: 10,
          durationDays: 30,
          price: 50_000,
          categoryId: 'cat_nonexistent',
        },
      });
      expect(missingCatRes.statusCode).toBe(400);
      expect(missingCatRes.json().code).toBe('CATEGORY_NOT_FOUND');
    });

    it('edits packages, resets targets with null pair, toggles, clones consecutively, and filters', async () => {
      await harness.services.packageCategoryService!.createCategory({
        id: 'cat_vip',
        name: 'VIP',
      });

      // Seed a package already pointing to a now-disabled panel (legacy persisted data)
      harness.store.packages_json = JSON.stringify([
        {
          id: 'pkg_legacy_disabled',
          name: 'Legacy Target',
          gbAmount: 20,
          durationDays: 30,
          price: 90_000,
          enabled: true,
          panelId: 'panel_disabled',
          serviceId: 5,
          categoryId: 'cat_vip',
        },
        {
          id: 'pkg_second',
          name: 'Second Plan',
          gbAmount: 40,
          durationDays: 30,
          price: 160_000,
          enabled: true,
        },
      ]);

      // Updating price without changing target must still succeed even if panel is disabled
      const patchPriceRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/packages/pkg_legacy_disabled',
        cookies: { session: getAdminToken() },
        payload: { price: 95_000 },
      });
      expect(patchPriceRes.statusCode).toBe(200);
      expect(patchPriceRes.json().package).toMatchObject({
        price: 95_000,
        panelId: 'panel_disabled',
        serviceId: 5,
        categoryId: 'cat_vip',
      });

      // Clearing target & category via null
      const clearRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/packages/pkg_legacy_disabled',
        cookies: { session: getAdminToken() },
        payload: { panelId: null, serviceId: null, categoryId: null },
      });
      expect(clearRes.statusCode).toBe(200);
      expect(clearRes.json().package.panelId).toBeUndefined();
      expect(clearRes.json().package.serviceId).toBeUndefined();
      expect(clearRes.json().package.categoryId).toBeUndefined();

      // Re-assign to valid target + category
      const assignRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/packages/pkg_legacy_disabled',
        cookies: { session: getAdminToken() },
        payload: { panelId: 'panel_1', serviceId: 2, categoryId: 'cat_vip' },
      });
      expect(assignRes.statusCode).toBe(200);

      // Toggle off then explicitly on
      const toggleOff = await app.inject({
        method: 'POST',
        url: '/api/admin/packages/pkg_legacy_disabled/toggle',
        cookies: { session: getAdminToken() },
      });
      expect(toggleOff.statusCode).toBe(200);
      expect(toggleOff.json().package.enabled).toBe(false);

      // Clone twice in a row inserts immediately after source with unique IDs & names
      const clone1 = await app.inject({
        method: 'POST',
        url: '/api/admin/packages/pkg_legacy_disabled/clone',
        cookies: { session: getAdminToken() },
      });
      expect(clone1.statusCode).toBe(201);
      expect(clone1.json().packages[1].id).toBe(clone1.json().package.id);
      expect(clone1.json().package.panelId).toBe('panel_1');
      expect(clone1.json().package.enabled).toBe(false);

      const clone2 = await app.inject({
        method: 'POST',
        url: '/api/admin/packages/pkg_legacy_disabled/clone',
        cookies: { session: getAdminToken() },
      });
      expect(clone2.statusCode).toBe(201);
      expect(clone2.json().package.name).not.toBe(clone1.json().package.name);
      expect(clone2.json().package.id).not.toBe(clone1.json().package.id);

      // Filter disabled out & category=uncategorized
      const filteredRes = await app.inject({
        method: 'GET',
        url: '/api/admin/packages?includeDisabled=false&categoryId=uncategorized',
        cookies: { session: getAdminToken() },
      });
      expect(filteredRes.statusCode).toBe(200);
      expect(filteredRes.json().packages.map((p: { id: string }) => p.id)).toEqual(['pkg_second']);
      expect(filteredRes.json().totalPackages).toBe(4);
    });

    it('reorders packages, enforces MAX_PACKAGE_COUNT, and blocks deleting the last package', async () => {
      harness.store.packages_json = JSON.stringify([
        { id: 'pkg_a', name: 'A', gbAmount: 10, durationDays: 30, price: 50_000, enabled: true },
        { id: 'pkg_b', name: 'B', gbAmount: 20, durationDays: 30, price: 90_000, enabled: true },
      ]);

      const badReorder = await app.inject({
        method: 'POST',
        url: '/api/admin/packages/reorder',
        cookies: { session: getAdminToken() },
        payload: { orderedIds: ['pkg_a', 'pkg_unknown'] },
      });
      expect(badReorder.statusCode).toBe(400);
      expect(badReorder.json().code).toBe('INVALID_REORDER_IDS');

      const goodReorder = await app.inject({
        method: 'POST',
        url: '/api/admin/packages/reorder',
        cookies: { session: getAdminToken() },
        payload: { orderedIds: ['pkg_b', 'pkg_a'] },
      });
      expect(goodReorder.statusCode).toBe(200);
      expect(goodReorder.json().packages.map((p: { id: string }) => p.id)).toEqual([
        'pkg_b',
        'pkg_a',
      ]);

      // Delete pkg_b succeeds, leaving 1 package
      const delOne = await app.inject({
        method: 'DELETE',
        url: '/api/admin/packages/pkg_b',
        cookies: { session: getAdminToken() },
      });
      expect(delOne.statusCode).toBe(200);
      expect(delOne.json().packages).toHaveLength(1);

      // Deleting last package blocked
      const delLast = await app.inject({
        method: 'DELETE',
        url: '/api/admin/packages/pkg_a',
        cookies: { session: getAdminToken() },
      });
      expect(delLast.statusCode).toBe(400);
      expect(delLast.json().code).toBe('LAST_PACKAGE_CANNOT_BE_DELETED');

      // Enforces 50-package ceiling
      harness.store.packages_json = JSON.stringify(
        Array.from({ length: MAX_PACKAGE_COUNT }, (_, i) => ({
          id: `pkg_${i + 1}`,
          name: `Pkg ${i + 1}`,
          gbAmount: 10,
          durationDays: 30,
          price: 50_000,
          enabled: true,
        }))
      );
      const limitRes = await app.inject({
        method: 'POST',
        url: '/api/admin/packages',
        cookies: { session: getAdminToken() },
        payload: { name: 'Overflow', gbAmount: 10, durationDays: 30, price: 50_000 },
      });
      expect(limitRes.statusCode).toBe(400);
      expect(limitRes.json().code).toBe('PACKAGE_LIMIT_REACHED');
    });

    it('updates package display mode and notification/refund policies including decimals', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/packages/policies',
        cookies: { session: getAdminToken() },
        payload: {
          packageDisplayMode: 'name',
          lowTrafficThresholdGb: 1.5,
          expiryWarningDays: 5,
          refundWindowHours: 48,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().policies).toEqual({
        packageDisplayMode: 'name',
        lowTrafficThresholdGb: 1.5,
        expiryWarningDays: 5,
        refundWindowHours: 48,
        showOutOfStockPackages: true,
        lowStockThreshold: 5,
      });

      const invalidThreshold = await app.inject({
        method: 'PUT',
        url: '/api/admin/packages/policies',
        cookies: { session: getAdminToken() },
        payload: { lowTrafficThresholdGb: -0.5 },
      });
      expect(invalidThreshold.statusCode).toBe(400);
      expect(invalidThreshold.json().code).toBe('INVALID_LOW_TRAFFIC_THRESHOLD');
    });
  });

  describe('Categories CRUD, Ordering & Package Unlinking', () => {
    it('creates, updates, toggles, reorders categories and counts linked packages', async () => {
      const c1 = await app.inject({
        method: 'POST',
        url: '/api/admin/categories',
        cookies: { session: getAdminToken() },
        payload: { id: 'cat_stream', name: 'Streaming', description: '4K optimized', icon: '🎬' },
      });
      expect(c1.statusCode).toBe(201);
      expect(c1.json().category).toMatchObject({
        id: 'cat_stream',
        name: 'Streaming',
        description: '4K optimized',
        icon: '🎬',
        enabled: true,
        linkedPackagesCount: 0,
      });

      // Duplicate explicit ID rejected
      const dupId = await app.inject({
        method: 'POST',
        url: '/api/admin/categories',
        cookies: { session: getAdminToken() },
        payload: { id: 'cat_stream', name: 'Duplicate' },
      });
      expect(dupId.statusCode).toBe(409);
      expect(dupId.json().code).toBe('DUPLICATE_CATEGORY_ID');

      // Too long description rejected
      const longDesc = await app.inject({
        method: 'POST',
        url: '/api/admin/categories',
        cookies: { session: getAdminToken() },
        payload: { name: 'Bad', description: 'x'.repeat(241) },
      });
      expect(longDesc.statusCode).toBe(400);
      expect(longDesc.json().code).toBe('INVALID_CATEGORY_DESCRIPTION');

      const c2 = await app.inject({
        method: 'POST',
        url: '/api/admin/categories',
        cookies: { session: getAdminToken() },
        payload: { name: 'Economic' },
      });
      expect(c2.statusCode).toBe(201);
      const c2Id = c2.json().category.id;

      // Link package to c2Id and verify counts + clear description
      harness.store.packages_json = JSON.stringify([
        {
          id: 'pkg_eco',
          name: 'Eco',
          gbAmount: 10,
          durationDays: 30,
          price: 40_000,
          categoryId: c2Id,
        },
        {
          id: 'pkg_plain',
          name: 'Plain',
          gbAmount: 20,
          durationDays: 30,
          price: 80_000,
        },
      ]);

      const patchCat = await app.inject({
        method: 'PATCH',
        url: `/api/admin/categories/${encodeURIComponent('cat_stream')}`,
        cookies: { session: getAdminToken() },
        payload: { name: 'Streaming HD', description: null, icon: null },
      });
      expect(patchCat.statusCode).toBe(200);
      expect(patchCat.json().category).toMatchObject({
        name: 'Streaming HD',
        description: null,
        icon: null,
      });

      const toggleCat = await app.inject({
        method: 'POST',
        url: `/api/admin/categories/${encodeURIComponent(c2Id)}/toggle`,
        cookies: { session: getAdminToken() },
      });
      expect(toggleCat.statusCode).toBe(200);
      expect(toggleCat.json().category.enabled).toBe(false);

      const reorder = await app.inject({
        method: 'POST',
        url: '/api/admin/categories/reorder',
        cookies: { session: getAdminToken() },
        payload: { orderedIds: [c2Id, 'cat_stream'] },
      });
      expect(reorder.statusCode).toBe(200);
      expect(reorder.json().categories.map((c: { id: string }) => c.id)).toEqual([
        c2Id,
        'cat_stream',
      ]);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/admin/categories',
        cookies: { session: getAdminToken() },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().uncategorizedPackagesCount).toBe(1);
      expect(listRes.json().categories[0].linkedPackagesCount).toBe(1);

      // Delete category unlinks packages without deleting packages
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/admin/categories/${encodeURIComponent(c2Id)}`,
        cookies: { session: getAdminToken() },
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().unlinkedPackagesCount).toBe(1);

      const pkgsAfter = parsePackageOptionsJson(harness.store.packages_json);
      expect(pkgsAfter).toHaveLength(2);
      expect(pkgsAfter!.find((p) => p.id === 'pkg_eco')?.categoryId).toBeUndefined();
    });
  });

  describe('Custom Pricing Settings, Volume Tiers, Overrides & Quote Simulator', () => {
    it('gets and updates custom pricing settings including target normalization and web-limit warning', async () => {
      const initial = await app.inject({
        method: 'GET',
        url: '/api/admin/pricing/custom',
        cookies: { session: getAdminToken() },
      });
      expect(initial.statusCode).toBe(200);
      expect(initial.json().settings).toMatchObject({
        enabled: true,
        pricePerGb: 5000,
        pricePerDay: 0,
        minGb: 5,
        maxGb: 500,
        defaultDays: 30,
        target: null,
      });

      // Pre-seed legacy keys to verify clean replacement
      harness.store.custom_volume_panel_id = 'legacy_p';
      harness.store.custom_volume_service_id = '9';

      const badBounds = await app.inject({
        method: 'PUT',
        url: '/api/admin/pricing/custom/settings',
        cookies: { session: getAdminToken() },
        payload: { minGb: 200, maxGb: 100 },
      });
      expect(badBounds.statusCode).toBe(400);
      expect(badBounds.json().code).toBe('INVALID_CUSTOM_BOUNDS');

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/admin/pricing/custom/settings',
        cookies: { session: getAdminToken() },
        payload: {
          enabled: false,
          pricePerGb: 6000,
          pricePerDay: 1500,
          minGb: 10,
          maxGb: 1000,
          defaultDays: 400,
          target: { panelId: 'panel_1', serviceId: 2 },
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().settings).toMatchObject({
        enabled: false,
        pricePerGb: 6000,
        pricePerDay: 1500,
        minGb: 10,
        maxGb: 1000,
        defaultDays: 400,
        target: { panelId: 'panel_1', serviceId: 2 },
        warnings: ['DEFAULT_DAYS_EXCEEDS_WEB_LIMIT'],
      });
      expect(harness.store.custom_volume_panel_id).toBe('');
      expect(harness.store.custom_volume_service_id).toBe('');

      // Clear target back to null
      const clearTargetRes = await app.inject({
        method: 'PUT',
        url: '/api/admin/pricing/custom/settings',
        cookies: { session: getAdminToken() },
        payload: { target: null },
      });
      expect(clearTargetRes.statusCode).toBe(200);
      expect(clearTargetRes.json().settings.target).toBeNull();
    });

    it('manages volume pricing tiers with strict XOR, mode switching, sorting, duplicate ID & cap', async () => {
      const bothModes = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { minGb: 50, pricePerGb: 4000, discountPercent: 10 },
      });
      expect(bothModes.statusCode).toBe(400);
      expect(bothModes.json().code).toBe('TIER_RATE_DISCOUNT_XOR');

      const t1 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { id: 'tier_mid', minGb: 50, maxGb: 99, discountPercent: 10 },
      });
      expect(t1.statusCode).toBe(201);

      const t2 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { id: 'tier_whale', minGb: 100, pricePerGb: 3500 },
      });
      expect(t2.statusCode).toBe(201);
      // Sorted descending by minGb
      expect(t2.json().tiers.map((t: { id: string }) => t.id)).toEqual(['tier_whale', 'tier_mid']);

      // Duplicate ID rejected
      const dupTier = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { id: 'tier_mid', minGb: 20, discountPercent: 5 },
      });
      expect(dupTier.statusCode).toBe(409);
      expect(dupTier.json().code).toBe('DUPLICATE_TIER_ID');

      // Patching pricePerGb without clearing discountPercent fails XOR
      const badSwitch = await app.inject({
        method: 'PATCH',
        url: '/api/admin/pricing/custom/tiers/tier_mid',
        cookies: { session: getAdminToken() },
        payload: { pricePerGb: 4200 },
      });
      expect(badSwitch.statusCode).toBe(400);
      expect(badSwitch.json().code).toBe('TIER_RATE_DISCOUNT_XOR');

      // Passing null clears old mode cleanly
      const goodSwitch = await app.inject({
        method: 'PATCH',
        url: '/api/admin/pricing/custom/tiers/tier_mid',
        cookies: { session: getAdminToken() },
        payload: { pricePerGb: 4200, discountPercent: null },
      });
      expect(goodSwitch.statusCode).toBe(200);
      expect(goodSwitch.json().tier).toEqual({
        id: 'tier_mid',
        minGb: 50,
        maxGb: 99,
        pricePerGb: 4200,
      });

      const delTier = await app.inject({
        method: 'DELETE',
        url: '/api/admin/pricing/custom/tiers/tier_mid',
        cookies: { session: getAdminToken() },
      });
      expect(delTier.statusCode).toBe(200);
      expect(delTier.json().tiers.map((t: { id: string }) => t.id)).toEqual(['tier_whale']);

      // Max 100 rules enforcement
      harness.store.volume_pricing_tiers_json = JSON.stringify(
        Array.from({ length: MAX_PRICE_RULES }, (_, i) => ({
          id: `tier_${i + 1}`,
          minGb: i + 1,
          pricePerGb: 4000,
        }))
      );
      const capRes = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { minGb: 500, discountPercent: 15 },
      });
      expect(capRes.statusCode).toBe(400);
      expect(capRes.json().code).toBe('PRICE_RULE_LIMIT_REACHED');
    });

    it('manages custom price overrides, priority reorder, and simulates live quotes with warnings & overflow check', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/admin/pricing/custom/settings',
        cookies: { session: getAdminToken() },
        payload: { pricePerGb: 5000, pricePerDay: 1000, minGb: 10, maxGb: 200 },
      });

      await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/tiers',
        cookies: { session: getAdminToken() },
        payload: { id: 'tier_50', minGb: 50, discountPercent: 20 },
      });

      const badOverride = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides',
        cookies: { session: getAdminToken() },
        payload: { minGb: 50, maxGb: 100 },
      });
      expect(badOverride.statusCode).toBe(400);
      expect(badOverride.json().code).toBe('INVALID_PRICE_OVERRIDE');

      const o1 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides',
        cookies: { session: getAdminToken() },
        payload: { id: 'ovr_rate', minGb: 100, minDays: 30, pricePerGb: 3000, pricePerDay: 500 },
      });
      expect(o1.statusCode).toBe(201);

      const o2 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides',
        cookies: { session: getAdminToken() },
        payload: {
          id: 'ovr_fixed',
          minGb: 100,
          maxGb: 120,
          minDays: 30,
          maxDays: 30,
          price: 310_000,
        },
      });
      expect(o2.statusCode).toBe(201);

      // Quote for 100GB / 30d matches first override (ovr_rate) and tier_50
      const q1 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/quote',
        cookies: { session: getAdminToken() },
        payload: { gbAmount: 100, durationDays: 30 },
      });
      expect(q1.statusCode).toBe(200);
      expect(q1.json().quote).toEqual({
        totalPrice: 100 * 3000 + 30 * 500,
        volumePrice: 300_000,
        durationPrice: 15_000,
        pricePerGb: 3000,
        pricePerDay: 500,
        tierId: 'tier_50',
        overrideId: 'ovr_rate',
      });
      expect(q1.json().warnings).toEqual([]);

      // Reorder overrides so ovr_fixed takes priority
      const reorderOvr = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/overrides/reorder',
        cookies: { session: getAdminToken() },
        payload: { orderedIds: ['ovr_fixed', 'ovr_rate'] },
      });
      expect(reorderOvr.statusCode).toBe(200);

      const q2 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/quote',
        cookies: { session: getAdminToken() },
        payload: { gbAmount: 100, durationDays: 30 },
      });
      expect(q2.statusCode).toBe(200);
      expect(q2.json().quote).toEqual({
        totalPrice: 310_000,
        volumePrice: 0,
        durationPrice: 0,
        pricePerGb: 4000,
        pricePerDay: 1000,
        tierId: 'tier_50',
        overrideId: 'ovr_fixed',
      });

      // Patch override clearing maxGb & delete override
      const patchOvr = await app.inject({
        method: 'PATCH',
        url: '/api/admin/pricing/custom/overrides/ovr_fixed',
        cookies: { session: getAdminToken() },
        payload: { maxGb: null, price: 325_000 },
      });
      expect(patchOvr.statusCode).toBe(200);
      expect(patchOvr.json().override).toEqual({
        id: 'ovr_fixed',
        minGb: 100,
        minDays: 30,
        maxDays: 30,
        price: 325_000,
      });

      const delOvr = await app.inject({
        method: 'DELETE',
        url: '/api/admin/pricing/custom/overrides/ovr_fixed',
        cookies: { session: getAdminToken() },
      });
      expect(delOvr.statusCode).toBe(200);
      expect(delOvr.json().overrides.map((o: { id: string }) => o.id)).toEqual(['ovr_rate']);

      // Quote hitting tier_50 outside configured maxGb and > 365 days emits warnings
      const q3 = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/quote',
        cookies: { session: getAdminToken() },
        payload: { gbAmount: 300, durationDays: 400 },
      });
      expect(q3.statusCode).toBe(200);
      expect(q3.json().quote.tierId).toBe('tier_50');
      expect(q3.json().warnings).toEqual([
        'GB_OUTSIDE_CONFIGURED_BOUNDS',
        'DURATION_EXCEEDS_WEB_LIMIT',
      ]);

      // Overflow guard returns 400 CUSTOM_PRICE_OVERFLOW
      harness.store.price_per_gb = String(Number.MAX_SAFE_INTEGER);
      const overflowRes = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/custom/quote',
        cookies: { session: getAdminToken() },
        payload: { gbAmount: 2, durationDays: 1 },
      });
      expect(overflowRes.statusCode).toBe(400);
      expect(overflowRes.json().code).toBe('CUSTOM_PRICE_OVERFLOW');
    });

    it('rejects duplicate IDs in volume tier & price override parsers and supports legacy Persian category IDs', async () => {
      expect(
        parseVolumePricingTiersJson(
          JSON.stringify([
            { id: 'tier_dup', minGb: 50, discountPercent: 10 },
            { id: 'tier_dup', minGb: 100, discountPercent: 20 },
          ])
        )
      ).toBeUndefined();

      expect(
        parseCustomPriceOverridesJson(
          JSON.stringify([
            { id: 'ovr_dup', price: 100_000 },
            { id: 'ovr_dup', price: 200_000 },
          ])
        )
      ).toBeUndefined();

      // Legacy Telegram category generated with Persian slug
      await harness.services.packageCategoryService!.createCategory({
        id: 'cat_ویژه_a1b2c3',
        name: 'پکیج ویژه',
      });

      const patchPersian = await app.inject({
        method: 'PATCH',
        url: `/api/admin/categories/${encodeURIComponent('cat_ویژه_a1b2c3')}`,
        cookies: { session: getAdminToken() },
        payload: { name: 'پکیج فوق ویژه' },
      });
      expect(patchPersian.statusCode).toBe(200);
      expect(patchPersian.json().category.name).toBe('پکیج فوق ویژه');

      const delPersian = await app.inject({
        method: 'DELETE',
        url: `/api/admin/categories/${encodeURIComponent('cat_ویژه_a1b2c3')}`,
        cookies: { session: getAdminToken() },
      });
      expect(delPersian.statusCode).toBe(200);
      expect(delPersian.json().deletedId).toBe('cat_ویژه_a1b2c3');
    });
  });
});
