import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseCheckoutService } from '../../src/domain/services/PurchaseCheckoutService.js';
import { resolvePurchasePackage } from '../../src/domain/services/PurchasePackageResolver.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { PackageOption, PricingService } from '../../src/domain/services/PricingService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PACKAGE = {
  id: 'pkg_safe',
  name: 'Safe package',
  gbAmount: 10,
  durationDays: 30,
  price: 50_000,
  panelId: 'rp_primary',
  serviceId: 10,
};

function checkoutService() {
  const resolveTarget = vi.fn();
  return {
    service: new PurchaseCheckoutService({ resolveTarget } as unknown as RebeccaPanelRegistry),
    resolveTarget,
  };
}

describe('PurchaseCheckoutService & PurchasePackageResolver', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PurchaseCheckoutService boundaries, expiry & recovery', () => {
    it('validates quote amount, target coherence, and configId before DB/panel access', async () => {
      const { service, resolveTarget } = checkoutService();

      await expect(
        service.create({
          telegramId: 1,
          kind: 'new_config',
          pkg: PACKAGE,
          quotedAmount: PACKAGE.price + 1,
        })
      ).rejects.toThrow('PURCHASE_CHECKOUT_INPUT_INVALID');

      await expect(
        service.create({
          telegramId: 1,
          kind: 'new_config',
          pkg: { ...PACKAGE, panelId: undefined, serviceId: undefined },
          panelId: 'rp_primary',
        })
      ).rejects.toThrow('PURCHASE_CHECKOUT_TARGET_INCOMPLETE');

      await expect(
        service.create({
          telegramId: 1,
          kind: 'new_config',
          pkg: PACKAGE,
          panelId: 'rp_other',
          serviceId: 10,
        })
      ).rejects.toThrow('PURCHASE_CHECKOUT_TARGET_MISMATCH');

      await expect(
        service.create({ telegramId: 1, kind: 'renew_config', pkg: PACKAGE })
      ).rejects.toThrow('PURCHASE_CHECKOUT_CONFIG_REQUIRED');

      expect(resolveTarget).not.toHaveBeenCalled();
    });

    it('enforces owner check, admin override, and exact expiresAt <= now boundary in claim()', async () => {
      vi.useFakeTimers();
      const fixedNow = new Date('2026-10-01T12:00:00.000Z');
      vi.setSystemTime(fixedNow);

      const { service } = checkoutService();

      // Non-owner claim rejected
      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [
            [
              {
                id: 'co_user_1',
                telegramId: 100,
                status: 'pending',
                expiresAt: new Date(fixedNow.getTime() + 60_000),
              },
            ],
          ],
          returningResults: [[]],
        }).db as never
      );
      await expect(service.claim('co_user_1', 999, false)).rejects.toThrow(
        'PURCHASE_CHECKOUT_OWNER_MISMATCH'
      );

      // Exact boundary: expiresAt === now -> cannot claim; marks expired and rejects
      const boundaryDb = createMockDb({
        selectResults: [
          [{ id: 'co_boundary', telegramId: 100, status: 'pending', expiresAt: fixedNow }],
        ],
        returningResults: [[]], // claimPending WHERE gt(expiresAt, now) misses exact expiresAt === now!
      });
      getDbMock.mockReturnValue(boundaryDb.db as never);
      await expect(service.claim('co_boundary', 100, false)).rejects.toThrow(
        'PURCHASE_CHECKOUT_EXPIRED'
      );
      expect(boundaryDb.state.updateCalls.some((c) => c.set.status === 'expired')).toBe(true);

      // Admin override succeeds
      const adminCheckout = {
        id: 'co_user_1',
        telegramId: 100,
        status: 'processing',
        expiresAt: new Date(fixedNow.getTime() + 60_000),
      };
      getDbMock.mockReturnValue(createMockDb({ returningResults: [[adminCheckout]] }).db as never);
      await expect(service.claim('co_user_1', 999, true)).resolves.toEqual(adminCheckout);
    });

    it('recovers stale processing checkouts only when no purchase intent exists', async () => {
      const now = Date.now();
      const staleCheckout = {
        id: 'co_stale',
        telegramId: 1,
        kind: 'new_config',
        configId: null,
        packageId: 'pkg_safe',
        packageName: 'Safe package',
        panelId: 'rp_primary',
        serviceId: 10,
        amount: 50_000,
        quotedAmount: 50_000,
        gbAmount: 10,
        durationDays: 30,
        promoCode: null,
        status: 'processing',
        expiresAt: new Date(now + 5 * 60 * 1000),
        claimedAt: new Date(now - 10 * 60 * 1000),
        createdAt: new Date(now - 11 * 60 * 1000),
        updatedAt: new Date(now - 10 * 60 * 1000),
      };

      const { service } = checkoutService();

      const reopenDb = createMockDb({
        selectResults: [[{ id: 'co_stale' }], [staleCheckout], []],
        returningResults: [[{ id: 'co_stale' }]],
      });
      getDbMock.mockReturnValue(reopenDb.db as never);
      await expect(service.reconcileStaleProcessing()).resolves.toBe(1);
      expect(reopenDb.state.updateCalls.map((c) => c.set)).toContainEqual(
        expect.objectContaining({ status: 'pending', claimedAt: null })
      );

      const keptDb = createMockDb({
        selectResults: [
          [{ id: 'co_pending_intent' }],
          [{ ...staleCheckout, id: 'co_pending_intent', expiresAt: new Date(now - 60_000) }],
          [{ status: 'reconciliation_required' }],
        ],
      });
      getDbMock.mockReturnValue(keptDb.db as never);
      await expect(service.reconcileStaleProcessing()).resolves.toBe(0);
      expect(keptDb.state.updateCalls).toHaveLength(0);
    });

    it('marks expired pending checkouts as expired during maintenance sweep', async () => {
      const { service } = checkoutService();
      const expireDb = createMockDb({
        returningResults: [[{ id: 'co_old_1' }, { id: 'co_old_2' }]],
      });
      getDbMock.mockReturnValue(expireDb.db as never);
      await expect(service.expireStalePending()).resolves.toBe(2);
      expect(expireDb.state.updateCalls[0]?.set).toMatchObject({ status: 'expired' });
    });
  });

  describe('resolvePurchasePackage', () => {
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

    const createTs = (customEnabled = true, minGb = 5, maxGb = 500) =>
      ({
        getSetting: vi.fn((key: string, fb?: string) =>
          key === 'custom_volume_enabled' ? (customEnabled ? 'true' : 'false') : fb
        ),
        getSettingNum: vi.fn((key: string, fb: number) => {
          if (key === 'custom_min_gb') return minGb;
          if (key === 'custom_max_gb') return maxGb;
          if (key === 'custom_default_days') return 30;
          return fb;
        }),
      }) as unknown as TranslationService;

    it('resolves active static packages and rejects disabled or missing packages', () => {
      expect(
        resolvePurchasePackage({
          packageId: 'pkg_active_10gb',
          pricingService: mockPricingService,
          translationService: createTs(),
        })
      ).toMatchObject({
        success: true,
        quotedAmount: 50_000,
        target: { panelId: 'panel-1', serviceId: 1 },
      });

      expect(
        resolvePurchasePackage({
          packageId: 'pkg_disabled_10gb',
          pricingService: mockPricingService,
          translationService: createTs(),
        })
      ).toMatchObject({ success: false, status: 404, code: 'PACKAGE_NOT_FOUND' });

      expect(
        resolvePurchasePackage({
          packageId: 'nonexistent',
          pricingService: mockPricingService,
          translationService: createTs(),
        })
      ).toMatchObject({ success: false, status: 404, code: 'PACKAGE_NOT_FOUND' });
    });

    it('resolves custom volume via object or custom_* packageId and blocks disabled/out-of-bounds bypasses', () => {
      expect(
        resolvePurchasePackage({
          custom: { gb: 20, days: 30 },
          pricingService: mockPricingService,
          translationService: createTs(true),
        })
      ).toMatchObject({
        success: true,
        quotedAmount: 20 * 5_000 + 30 * 500,
        pkg: { id: 'custom_20gb_30d' },
        target: { panelId: 'custom-panel', serviceId: 99 },
      });

      expect(
        resolvePurchasePackage({
          packageId: 'custom_20gb_30d',
          pricingService: mockPricingService,
          translationService: createTs(true),
        })
      ).toMatchObject({ success: true, pkg: { id: 'custom_20gb_30d' } });

      for (const bad of [
        { custom: { gb: 20, days: 30 }, ts: createTs(false), code: 'CUSTOM_VOLUME_DISABLED' },
        { packageId: 'custom_20gb_30d', ts: createTs(false), code: 'CUSTOM_VOLUME_DISABLED' },
        { custom: { gb: 1, days: 30 }, ts: createTs(true, 5, 500), code: 'INVALID_CUSTOM_BOUNDS' },
        {
          custom: { gb: 600, days: 30 },
          ts: createTs(true, 5, 500),
          code: 'INVALID_CUSTOM_BOUNDS',
        },
        { custom: { gb: 20, days: 366 }, ts: createTs(true), code: 'INVALID_CUSTOM_BOUNDS' },
        {
          packageId: 'custom_10000gb_30d',
          ts: createTs(true, 5, 500),
          code: 'INVALID_CUSTOM_BOUNDS',
        },
        { packageId: 'custom_20gb_3650d', ts: createTs(true), code: 'INVALID_CUSTOM_BOUNDS' },
      ]) {
        expect(
          resolvePurchasePackage({
            packageId: bad.packageId,
            custom: bad.custom,
            pricingService: mockPricingService,
            translationService: bad.ts,
          })
        ).toMatchObject({ success: false, status: 400, code: bad.code });
      }
    });
  });
});
