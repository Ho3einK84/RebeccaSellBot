import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError, setAuthToken } from '../../webapp/src/shared/lib/api.js';
import { queryKeys } from '../../webapp/src/shared/lib/queryKeys.js';
import { fa } from '../../webapp/src/shared/i18n/locales/fa.js';
import { en } from '../../webapp/src/shared/i18n/locales/en.js';
import {
  computePackageUnitPrice,
  computePackagesKpiSummary,
  computeTierEffectivePricePerGb,
  filterAdminPackages,
  formatBilingualPackageName,
  MAX_PACKAGE_COUNT,
  MAX_PRICE_RULES,
  parseNonNegativeDecimalInput,
  parseNonNegativeIntInput,
  parsePositiveIntInput,
  reorderItemsByDelta,
  suggestPackageId,
  validateCategoryForm,
  validateCustomSettingsForm,
  validatePackageForm,
  validatePoliciesForm,
  validatePriceOverrideForm,
  validateQuoteSimulatorForm,
  validateVolumeTierForm,
} from '../../webapp/src/features/admin/packages/packageValidation.js';

function collectLeafEntries(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.push([path, value]);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...collectLeafEntries(value as Record<string, unknown>, path));
    }
  }
  return entries;
}

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!).sort();
}

describe('Admin Packages Frontend API Client & Query Keys', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setAuthToken('test-admin-jwt');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setAuthToken(null);
  });

  function mockJsonResponse(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  it('builds stable query keys for packages, categories, and custom pricing', () => {
    expect(queryKeys.packages()).toEqual(['admin', 'packages']);
    expect(queryKeys.packages({ categoryId: 'vip', includeDisabled: false })).toEqual([
      'admin',
      'packages',
      { categoryId: 'vip', includeDisabled: false },
    ]);
    expect(queryKeys.categories(true)).toEqual(['admin', 'categories', { includeDisabled: true }]);
    expect(queryKeys.customPricing).toEqual(['admin', 'pricing', 'custom']);
  });

  it('fetches packages with optional query filters', async () => {
    mockJsonResponse({ packages: [], totalPackages: 0, isFallbackActive: false });
    await api.getAdminPackages();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(firstHeaders.get('Authorization')).toBe('Bearer test-admin-jwt');

    mockJsonResponse({ packages: [], totalPackages: 0, isFallbackActive: false });
    await api.getAdminPackages({
      includeDisabled: false,
      categoryId: 'uncategorized',
      panelId: 'nl-1',
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages?includeDisabled=false&categoryId=uncategorized&panelId=nl-1',
      expect.any(Object)
    );
  });

  it('calls package create, patch, toggle, clone, reorder, delete, and policies endpoints', async () => {
    mockJsonResponse({ package: { id: 'p1' }, packages: [{ id: 'p1' }] }, 201);
    await api.createAdminPackage({
      id: 'p1',
      name: 'Gold',
      gbAmount: 100,
      durationDays: 30,
      price: 250000,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ package: { id: 'p/special' }, packages: [] });
    await api.updateAdminPackage('p/special', { price: 300000, panelId: null, serviceId: null });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/p%2Fspecial',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ price: 300000, panelId: null, serviceId: null }),
      })
    );

    mockJsonResponse({ package: { id: 'p1', enabled: false }, packages: [] });
    await api.toggleAdminPackage('p1', false);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/p1/toggle',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: false }) })
    );

    mockJsonResponse({ package: { id: 'p1-copy' }, packages: [] }, 201);
    await api.cloneAdminPackage('p1', 'Gold Copy');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/p1/clone',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Gold Copy' }) })
    );

    mockJsonResponse({ packages: [] });
    await api.reorderAdminPackages(['p2', 'p1']);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/reorder',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderedIds: ['p2', 'p1'] }),
      })
    );

    mockJsonResponse({ deletedId: 'p1', packages: [] });
    await api.deleteAdminPackage('p1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/p1',
      expect.objectContaining({ method: 'DELETE' })
    );

    mockJsonResponse({ policies: { packageDisplayMode: 'name' } });
    await api.updateAdminPackagePolicies({
      packageDisplayMode: 'name',
      lowTrafficThresholdGb: 2.5,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/packages/policies',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ packageDisplayMode: 'name', lowTrafficThresholdGb: 2.5 }),
      })
    );
  });

  it('encodes Persian category IDs safely across category endpoints', async () => {
    const persianId = 'بسته‌های ویژه';
    const encoded = encodeURIComponent(persianId);

    mockJsonResponse({ categories: [], uncategorizedPackagesCount: 0 });
    await api.getAdminCategories(false);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/categories?includeDisabled=false',
      expect.any(Object)
    );

    mockJsonResponse({ category: { id: persianId }, categories: [] }, 201);
    await api.createAdminCategory({ name: 'اقتصادی', displayOrder: 1 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/categories',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ category: { id: persianId }, categories: [] });
    await api.updateAdminCategory(persianId, { description: null });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/categories/${encoded}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ description: null }) })
    );

    mockJsonResponse({ category: { id: persianId }, categories: [] });
    await api.toggleAdminCategory(persianId);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/categories/${encoded}/toggle`,
      expect.objectContaining({ method: 'POST', body: '{}' })
    );

    mockJsonResponse({ categories: [] });
    await api.reorderAdminCategories([persianId]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/categories/reorder',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ deletedId: persianId, unlinkedPackagesCount: 2, categories: [] });
    await api.deleteAdminCategory(persianId);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/categories/${encoded}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('handles custom pricing, tiers, overrides, and quote simulator endpoints', async () => {
    mockJsonResponse({ settings: { enabled: true }, tiers: [], overrides: [], targets: [] });
    await api.getAdminCustomPricing();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/pricing/custom', expect.any(Object));

    mockJsonResponse({ settings: { enabled: false } });
    await api.updateAdminCustomPricingSettings({ enabled: false, target: null });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ enabled: false, target: null }),
      })
    );

    mockJsonResponse({ tier: { id: 't1' }, tiers: [] }, 201);
    await api.createAdminVolumeTier({ id: 't1', minGb: 100, discountPercent: 15 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/tiers',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ tier: { id: 't1' }, tiers: [] });
    await api.updateAdminVolumeTier('t1', {
      minGb: 100,
      maxGb: null,
      pricePerGb: 4000,
      discountPercent: null,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/tiers/t1',
      expect.objectContaining({ method: 'PATCH' })
    );

    mockJsonResponse({ deletedId: 't1', tiers: [] });
    await api.deleteAdminVolumeTier('t1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/tiers/t1',
      expect.objectContaining({ method: 'DELETE' })
    );

    mockJsonResponse({ override: { id: 'ov1' }, overrides: [] }, 201);
    await api.createAdminPriceOverride({ id: 'ov1', minGb: 200, price: 399000 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/overrides',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ overrides: [] });
    await api.reorderAdminPriceOverrides(['ov2', 'ov1']);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/overrides/reorder',
      expect.objectContaining({ method: 'POST' })
    );

    mockJsonResponse({ override: { id: 'ov1' }, overrides: [] });
    await api.updateAdminPriceOverride('ov1', { price: null, pricePerGb: 3500 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/overrides/ov1',
      expect.objectContaining({ method: 'PATCH' })
    );

    mockJsonResponse({ deletedId: 'ov1', overrides: [] });
    await api.deleteAdminPriceOverride('ov1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/overrides/ov1',
      expect.objectContaining({ method: 'DELETE' })
    );

    mockJsonResponse({
      quote: { totalPrice: 250000 },
      gbAmount: 50,
      durationDays: 30,
      warnings: [],
    });
    await api.simulateAdminCustomQuote(50, 30);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/pricing/custom/quote',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ gbAmount: 50, durationDays: 30 }),
      })
    );
  });

  it('surfaces backend error code inside ApiClientError', async () => {
    mockJsonResponse(
      { error: 'Cannot delete final package', code: 'LAST_PACKAGE_CANNOT_BE_DELETED' },
      400
    );

    try {
      await api.deleteAdminPackage('only-pkg');
      expect.unreachable('Expected ApiClientError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe('LAST_PACKAGE_CANNOT_BE_DELETED');
      expect(apiErr.message).toBe('Cannot delete final package');
    }
  });
});

describe('Admin Packages i18n Parity & Bilingual Helpers', () => {
  it('maintains 100% key and placeholder parity between fa and en for admin tabs, modules, and packages', () => {
    const sections = ['tabs', 'modules', 'packages'] as const;
    for (const section of sections) {
      const faEntries = collectLeafEntries(fa.admin[section] as Record<string, unknown>);
      const enEntries = collectLeafEntries(en.admin[section] as Record<string, unknown>);

      const faMap = new Map(faEntries);
      const enMap = new Map(enEntries);

      expect([...faMap.keys()].sort()).toEqual([...enMap.keys()].sort());

      for (const [key, faVal] of faMap.entries()) {
        const enVal = enMap.get(key) ?? '';
        expect(faVal.trim().length, `empty fa value at admin.${section}.${key}`).toBeGreaterThan(0);
        expect(enVal.trim().length, `empty en value at admin.${section}.${key}`).toBeGreaterThan(0);
        expect(
          extractPlaceholders(faVal),
          `placeholder mismatch at admin.${section}.${key}`
        ).toEqual(extractPlaceholders(enVal));
      }
    }
  });

  it('formats bilingual pipe-separated and single-language package names', () => {
    expect(formatBilingualPackageName('بسته نقره‌ای | Silver Plan', 'fa')).toEqual({
      primary: 'بسته نقره‌ای',
      secondary: 'Silver Plan',
    });
    expect(formatBilingualPackageName('بسته نقره‌ای | Silver Plan', 'en')).toEqual({
      primary: 'Silver Plan',
      secondary: 'بسته نقره‌ای',
    });
    expect(formatBilingualPackageName('VIP 100GB', 'fa')).toEqual({
      primary: 'VIP 100GB',
      secondary: null,
    });
  });
});

describe('Admin Packages Digit Normalization, Validation & State Helpers', () => {
  it('parses Persian and Arabic-Indic numerals cleanly while rejecting invalid strings', () => {
    expect(parsePositiveIntInput('۱۲۳٬۴۵۶')).toBe(123456);
    expect(parsePositiveIntInput('٥٠')).toBe(50);
    expect(parsePositiveIntInput('۰')).toBeNull();
    expect(parseNonNegativeIntInput('۰')).toBe(0);
    expect(parseNonNegativeIntInput('-1')).toBeNull();
    expect(parseNonNegativeDecimalInput('۲٫۵')).toBe(2.5);
    expect(parseNonNegativeDecimalInput('12abc')).toBeNull();
  });

  it('generates collision-free package IDs', () => {
    const existing = new Set(['plan-50gb-30d', 'plan-50gb-30d-2']);
    expect(suggestPackageId('۵۰', '۳۰', existing)).toBe('plan-50gb-30d-3');
    expect(suggestPackageId('100', '30', existing)).toBe('plan-100gb-30d');
  });

  it('validates package form inputs, duplicates, target pairing, and limit', () => {
    const existing = [
      { id: 'pkg-a', name: 'Silver Plan' },
      { id: 'pkg-b', name: 'Gold Plan' },
    ];

    const validResult = validatePackageForm(
      {
        id: 'pkg-c',
        name: 'Bronze | برنزی',
        gbAmount: '۵۰',
        durationDays: '۳۰',
        price: '۱۲۰٬۰۰۰',
        categoryId: 'cat-1',
        panelId: 'nl-1',
        serviceId: '۲',
        enabled: true,
      },
      { mode: 'create', existingPackages: existing }
    );
    expect(validResult.valid).toBe(true);
    expect(validResult.parsed).toEqual({
      id: 'pkg-c',
      name: 'Bronze | برنزی',
      gbAmount: 50,
      durationDays: 30,
      price: 120000,
      categoryId: 'cat-1',
      panelId: 'nl-1',
      serviceId: 2,
      enabled: true,
    });

    const dupName = validatePackageForm(
      {
        id: 'pkg-new',
        name: '  silver plan ',
        gbAmount: '10',
        durationDays: '30',
        price: '1000',
        categoryId: '',
        panelId: '',
        serviceId: '',
        enabled: true,
      },
      { mode: 'create', existingPackages: existing }
    );
    expect(dupName.valid).toBe(false);
    expect(dupName.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.nameDuplicate'
    );

    const incompleteTarget = validatePackageForm(
      {
        id: 'pkg-a',
        name: 'Silver Plan',
        gbAmount: '10',
        durationDays: '30',
        price: '1000',
        categoryId: '',
        panelId: 'de-1',
        serviceId: '',
        enabled: true,
      },
      { mode: 'edit', currentPackageId: 'pkg-a', existingPackages: existing }
    );
    expect(incompleteTarget.valid).toBe(false);
    expect(incompleteTarget.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.targetIncomplete'
    );

    const fullCatalog = Array.from({ length: MAX_PACKAGE_COUNT }, (_, i) => ({
      id: `pkg-${i}`,
      name: `Plan ${i}`,
    }));
    const atLimit = validatePackageForm(
      {
        id: 'extra-pkg',
        name: 'Extra',
        gbAmount: '10',
        durationDays: '30',
        price: '1000',
        categoryId: '',
        panelId: '',
        serviceId: '',
        enabled: true,
      },
      { mode: 'create', existingPackages: fullCatalog }
    );
    expect(atLimit.valid).toBe(false);
    expect(atLimit.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.maxPackagesReached'
    );
  });

  it('validates category, custom settings (including warnings), tiers XOR, overrides, policies, and simulator', () => {
    expect(
      validateCategoryForm({
        name: 'اقتصادی',
        icon: '⚡',
        description: '',
        displayOrder: '۲',
        enabled: true,
      }).parsed
    ).toEqual({
      name: 'اقتصادی',
      icon: '⚡',
      description: undefined,
      displayOrder: 2,
      enabled: true,
    });

    const customWarn = validateCustomSettingsForm({
      enabled: true,
      pricePerGb: '۰',
      pricePerDay: '۵۰۰',
      minGb: '۱۰',
      maxGb: '۵۰۰',
      defaultDays: '730',
      panelId: '',
      serviceId: '',
    });
    expect(customWarn.valid).toBe(true);
    expect(customWarn.warnings).toContain('admin.packages.custom.zeroPriceWarning');
    expect(customWarn.warnings).toContain('admin.packages.custom.webDaysWarning');

    const badTier = validateVolumeTierForm(
      {
        id: 'tier-bad',
        minGb: '100',
        maxGb: '50',
        mode: 'discountPercent',
        pricePerGb: '',
        discountPercent: '120',
      },
      { mode: 'create', existingTiers: [] }
    );
    expect(badTier.valid).toBe(false);
    expect(badTier.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.tierMaxGbInvalid'
    );
    expect(badTier.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.tierDiscountInvalid'
    );

    const maxTiers = Array.from({ length: MAX_PRICE_RULES }, (_, i) => ({ id: `t-${i}` }));
    const overLimitTier = validateVolumeTierForm(
      {
        id: 't-extra',
        minGb: '10',
        maxGb: '',
        mode: 'pricePerGb',
        pricePerGb: '4000',
        discountPercent: '',
      },
      { mode: 'create', existingTiers: maxTiers }
    );
    expect(overLimitTier.valid).toBe(false);
    expect(overLimitTier.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.maxRulesReached'
    );

    const noPriceOverride = validatePriceOverrideForm(
      {
        id: 'rule-1',
        minGb: '100',
        maxGb: '200',
        minDays: '',
        maxDays: '',
        price: '',
        pricePerGb: '',
        pricePerDay: '',
      },
      { mode: 'create', existingOverrides: [] }
    );
    expect(noPriceOverride.valid).toBe(false);
    expect(noPriceOverride.errors.map((e) => e.messageKey)).toContain(
      'admin.packages.validation.overridePricingRequired'
    );

    const validPolicies = validatePoliciesForm({
      packageDisplayMode: 'name',
      lowTrafficThresholdGb: '۲٫۵',
      expiryWarningDays: '۳',
      refundWindowHours: '۲۴',
    });
    expect(validPolicies.valid).toBe(true);
    expect(validPolicies.parsed).toEqual({
      packageDisplayMode: 'name',
      lowTrafficThresholdGb: 2.5,
      expiryWarningDays: 3,
      refundWindowHours: 24,
    });

    const simWarn = validateQuoteSimulatorForm('100', '400');
    expect(simWarn.valid).toBe(true);
    expect(simWarn.warnings).toContain('admin.packages.simulator.warningExceedsWebLimit');
  });

  it('computes unit prices, reorders arrays, filters packages, and summarizes KPIs accurately', () => {
    expect(computePackageUnitPrice(250000, 50)).toBe(5000);
    expect(computeTierEffectivePricePerGb({ discountPercent: 20 }, 5000)).toBe(4000);
    expect(computeTierEffectivePricePerGb({ discountPercent: 10 }, 5005)).toBe(4504);
    expect(computeTierEffectivePricePerGb({ pricePerGb: 3200 }, 5000)).toBe(3200);

    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(reorderItemsByDelta(items, 'a', 'up')).toBeNull();
    expect(reorderItemsByDelta(items, 'c', 'down')).toBeNull();
    expect(reorderItemsByDelta(items, 'b', 'up')?.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(reorderItemsByDelta(items, 'b', 'down')?.map((x) => x.id)).toEqual(['a', 'c', 'b']);

    const packages = [
      { id: 'p1', name: 'VIP | ویژه', enabled: true, categoryId: 'c1', panelId: 'nl-1' },
      { id: 'p2', name: 'Eco | اقتصادی', enabled: false },
      { id: 'p3', name: 'Pro', enabled: true, categoryId: 'c2' },
    ];
    expect(
      filterAdminPackages(packages, {
        search: 'ویژه',
        status: 'active',
        categoryId: 'c1',
        panelId: 'nl-1',
      }).map((p) => p.id)
    ).toEqual(['p1']);
    expect(
      filterAdminPackages(packages, {
        search: '',
        status: 'all',
        categoryId: 'uncategorized',
        panelId: 'default',
      }).map((p) => p.id)
    ).toEqual(['p2']);

    expect(
      computePackagesKpiSummary({
        packages,
        categories: [{ enabled: true }, { enabled: false }],
        customVolume: { enabled: true, pricePerGb: 4500, pricePerDay: 300 },
        tiersCount: 3,
        overridesCount: 2,
      })
    ).toEqual({
      totalPackages: 3,
      activePackages: 2,
      inactivePackages: 1,
      totalCategories: 2,
      activeCategories: 1,
      customEnabled: true,
      pricePerGb: 4500,
      pricePerDay: 300,
      tiersCount: 3,
      overridesCount: 2,
    });
  });
});
