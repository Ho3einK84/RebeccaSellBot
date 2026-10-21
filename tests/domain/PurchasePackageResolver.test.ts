import { describe, expect, it, vi } from 'vitest';
import { resolvePurchasePackage } from '../../src/domain/services/PurchasePackageResolver.js';
import type { PricingService, PackageOption } from '../../src/domain/services/PricingService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

describe('T2: PurchasePackageResolver & Guards', () => {
  const mockPackages: PackageOption[] = [
    {
      id: 'pkg_active_10gb',
      name: '10 GB',
      gbAmount: 10,
      durationDays: 30,
      price: 50_000,
      enabled: true,
      panelId: 'panel-1',
      serviceId: 1,
    },
    {
      id: 'pkg_disabled_10gb',
      name: '10 GB Disabled',
      gbAmount: 10,
      durationDays: 30,
      price: 50_000,
      enabled: false,
      panelId: 'panel-1',
      serviceId: 1,
    },
  ];

  const mockPricingService = {
    getPackages: vi.fn(() => mockPackages),
    getPackageById: vi.fn((id: string) => mockPackages.find((p) => p.id === id)),
    getCustomPriceQuote: vi.fn((gb: number, days: number) => ({
      totalPrice: gb * 5_000 + days * 500,
      basePrice: gb * 5_000,
      durationMultiplier: 1,
      breakdown: [],
    })),
    getCustomVolumeTarget: vi.fn(() => ({ panelId: 'custom-panel', serviceId: 99 })),
  } as unknown as PricingService;

  const createMockTranslationService = (customEnabled = true, minGb = 5, maxGb = 500) =>
    ({
      getSetting: vi.fn((key: string, fallback?: string) => {
        if (key === 'custom_volume_enabled') return customEnabled ? 'true' : 'false';
        return fallback;
      }),
      getSettingNum: vi.fn((key: string, fallback: number) => {
        if (key === 'custom_min_gb') return minGb;
        if (key === 'custom_max_gb') return maxGb;
        if (key === 'custom_default_days') return 30;
        return fallback;
      }),
    }) as unknown as TranslationService;

  describe('Static packages', () => {
    it('resolves active static package', () => {
      const result = resolvePurchasePackage({
        packageId: 'pkg_active_10gb',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pkg.id).toBe('pkg_active_10gb');
        expect(result.quotedAmount).toBe(50_000);
        expect(result.target).toEqual({ panelId: 'panel-1', serviceId: 1 });
      }
    });

    it('rejects disabled static package (404 PACKAGE_NOT_FOUND)', () => {
      const result = resolvePurchasePackage({
        packageId: 'pkg_disabled_10gb',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('PACKAGE_NOT_FOUND');
      }
    });

    it('rejects nonexistent package (404 PACKAGE_NOT_FOUND)', () => {
      const result = resolvePurchasePackage({
        packageId: 'nonexistent',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('PACKAGE_NOT_FOUND');
      }
    });
  });

  describe('Custom packages via custom object', () => {
    it('resolves valid custom package', () => {
      const result = resolvePurchasePackage({
        custom: { gb: 20, days: 30 },
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pkg.id).toBe('custom_20gb_30d');
        expect(result.quotedAmount).toBe(20 * 5_000 + 30 * 500);
        expect(result.target).toEqual({ panelId: 'custom-panel', serviceId: 99 });
      }
    });

    it('rejects custom package when custom volume is disabled', () => {
      const result = resolvePurchasePackage({
        custom: { gb: 20, days: 30 },
        pricingService: mockPricingService,
        translationService: createMockTranslationService(false),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('CUSTOM_VOLUME_DISABLED');
      }
    });

    it('rejects custom package when GB is below minimum (1 < 5)', () => {
      const result = resolvePurchasePackage({
        custom: { gb: 1, days: 30 },
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true, 5, 500),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CUSTOM_BOUNDS');
      }
    });

    it('rejects custom package when GB is above maximum (600 > 500)', () => {
      const result = resolvePurchasePackage({
        custom: { gb: 600, days: 30 },
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true, 5, 500),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CUSTOM_BOUNDS');
      }
    });

    it('rejects custom package when duration > 365 days', () => {
      const result = resolvePurchasePackage({
        custom: { gb: 20, days: 366 },
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CUSTOM_BOUNDS');
      }
    });
  });

  describe('Custom packages via packageId pattern (preventing bypass)', () => {
    it('resolves valid custom package via packageId pattern', () => {
      const result = resolvePurchasePackage({
        packageId: 'custom_20gb_30d',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pkg.id).toBe('custom_20gb_30d');
        expect(result.target).toEqual({ panelId: 'custom-panel', serviceId: 99 });
      }
    });

    it('blocks bypass when custom volume feature is disabled', () => {
      const result = resolvePurchasePackage({
        packageId: 'custom_20gb_30d',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(false),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('CUSTOM_VOLUME_DISABLED');
      }
    });

    it('blocks bypass when GB exceeds maximum (custom_10000gb_30d)', () => {
      const result = resolvePurchasePackage({
        packageId: 'custom_10000gb_30d',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true, 5, 500),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CUSTOM_BOUNDS');
      }
    });

    it('blocks bypass when duration exceeds 365 days (custom_20gb_3650d)', () => {
      const result = resolvePurchasePackage({
        packageId: 'custom_20gb_3650d',
        pricingService: mockPricingService,
        translationService: createMockTranslationService(true),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_CUSTOM_BOUNDS');
      }
    });
  });
});
