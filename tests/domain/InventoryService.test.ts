import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  CUSTOM_VOLUME_INVENTORY_ID,
  InventoryService,
  InventoryUnavailableError,
  MAX_INVENTORY_VALUE,
  TRIAL_INVENTORY_ID,
  mapInventoryReasonToCode,
  normalizeInventoryPackageId,
  trialInventoryReferenceId,
  validateOptionalInventoryInt,
} from '../../src/domain/services/InventoryService.js';
import type { SettingReader } from '../../src/domain/services/FeatureSettings.js';
import {
  inventoryUnavailableMessageKey,
  purchaseFailureMessage,
} from '../../src/telegram/purchaseFeedback.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

function makeSettings(overrides: Record<string, string> = {}): SettingReader {
  return {
    getSetting: vi.fn((key: string, fallback = '') =>
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key]! : fallback
    ),
  };
}

describe('InventoryService primitives & unit logic', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes package IDs, special SKUs, error codes, and optional integer bounds', () => {
    expect(normalizeInventoryPackageId(undefined)).toBeNull();
    expect(normalizeInventoryPackageId('   ')).toBeNull();
    expect(normalizeInventoryPackageId('custom_50gb_30d')).toBe(CUSTOM_VOLUME_INVENTORY_ID);
    expect(normalizeInventoryPackageId('CUSTOM_100GB_60D')).toBe(CUSTOM_VOLUME_INVENTORY_ID);
    expect(normalizeInventoryPackageId(TRIAL_INVENTORY_ID)).toBe(TRIAL_INVENTORY_ID);
    expect(normalizeInventoryPackageId('  vip_50  ')).toBe('vip_50');

    expect(trialInventoryReferenceId(42, 'trial_42')).toBe('trial:42:trial_42');

    expect(mapInventoryReasonToCode('package_out_of_stock')).toBe('OUT_OF_STOCK');
    expect(mapInventoryReasonToCode('panel_capacity_full')).toBe('CAPACITY_FULL');
    expect(mapInventoryReasonToCode('service_daily_limit_reached')).toBe('DAILY_LIMIT_REACHED');
    expect(mapInventoryReasonToCode('package_user_limit_reached')).toBe(
      'PACKAGE_USER_LIMIT_REACHED'
    );
    expect(mapInventoryReasonToCode('service_disabled')).toBe('SERVICE_UNAVAILABLE');

    expect(validateOptionalInventoryInt(undefined, { min: 0, errorCode: 'BAD' })).toBeUndefined();
    expect(validateOptionalInventoryInt(null, { min: 0, errorCode: 'BAD' })).toBeNull();
    expect(validateOptionalInventoryInt(0, { min: 0, errorCode: 'BAD' })).toBe(0);
    expect(() => validateOptionalInventoryInt(-1, { min: 0, errorCode: 'BAD' })).toThrow('BAD');
    expect(() => validateOptionalInventoryInt(0, { min: 1, errorCode: 'BAD_MIN1' })).toThrow(
      'BAD_MIN1'
    );
    expect(() =>
      validateOptionalInventoryInt(MAX_INVENTORY_VALUE + 1, { min: 0, errorCode: 'OVERFLOW' })
    ).toThrow('OVERFLOW');
  });

  it('maps InventoryUnavailableError reasons to bilingual Telegram feedback keys', () => {
    expect(inventoryUnavailableMessageKey('package_out_of_stock')).toBe(
      'purchase_inventory_out_of_stock'
    );
    expect(inventoryUnavailableMessageKey('panel_capacity_full')).toBe(
      'purchase_inventory_capacity_full'
    );
    expect(inventoryUnavailableMessageKey('service_daily_limit_reached')).toBe(
      'purchase_inventory_daily_limit'
    );
    expect(inventoryUnavailableMessageKey('package_user_limit_reached')).toBe(
      'purchase_inventory_user_limit'
    );
    expect(inventoryUnavailableMessageKey('service_disabled')).toBe(
      'purchase_inventory_service_paused'
    );

    const ts = {
      get: vi.fn((key: string, locale: string) => `${locale}:${key}`),
    } as never;
    expect(
      purchaseFailureMessage(ts, new InventoryUnavailableError('package_out_of_stock'), 'en')
    ).toBe('en:purchase_inventory_out_of_stock');
    expect(
      purchaseFailureMessage(ts, new InventoryUnavailableError('panel_capacity_full'), 'fa')
    ).toBe('fa:purchase_inventory_capacity_full');
  });

  it('computes package availability separating new-creation capacity from renewal availability', async () => {
    // Panel p1 is full (maxConfigs=5, active=5); pkg_limited has stock=3 & maxPurchasesPerUser=1
    const mock = createMockDb({
      selectResults: [
        // getFleetCapacitySnapshot: 4 queries (panels, services, activeConfigs, todayCreated)
        [
          {
            id: 'p1',
            name: 'Panel 1',
            enabled: true,
            isDefault: true,
            maxConfigs: 5,
            stockRemaining: null,
            dailyCreateLimit: null,
            reservedCreations: 0,
          },
          {
            id: 'p2',
            name: 'Panel 2',
            enabled: true,
            isDefault: false,
            maxConfigs: 100,
            stockRemaining: 10,
            dailyCreateLimit: 50,
            reservedCreations: 0,
          },
        ],
        [
          {
            panelId: 'p1',
            serviceId: 1,
            name: 'S1',
            enabled: true,
            isDefault: true,
            maxConfigs: null,
            stockRemaining: null,
            dailyCreateLimit: null,
            reservedCreations: 0,
          },
          {
            panelId: 'p2',
            serviceId: 1,
            name: 'S2',
            enabled: true,
            isDefault: true,
            maxConfigs: null,
            stockRemaining: 4,
            dailyCreateLimit: null,
            reservedCreations: 0,
          },
        ],
        [{ panelId: 'p1', serviceId: 1, count: 5 }],
        [],
        // getPackageInventoryRecords
        [
          {
            packageId: 'pkg_full_panel',
            stockRemaining: 10,
            reservedCount: 0,
            soldCount: 2,
            maxPurchasesPerUser: null,
            updatedAt: new Date(),
          },
          {
            packageId: 'pkg_low_stock',
            stockRemaining: 3,
            reservedCount: 1,
            soldCount: 7,
            maxPurchasesPerUser: 2,
            updatedAt: new Date(),
          },
          {
            packageId: 'pkg_user_capped',
            stockRemaining: 20,
            reservedCount: 0,
            soldCount: 1,
            maxPurchasesPerUser: 1,
            updatedAt: new Date(),
          },
        ],
        // getUserPackagePurchaseCounts
        [{ packageId: 'pkg_user_capped', count: 1 }],
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    const svc = new InventoryService(makeSettings({ shop_low_stock_threshold: '5' }));
    const map = await svc.getPackagesAvailabilityMap(
      [
        { id: 'pkg_full_panel', panelId: 'p1', serviceId: 1 },
        { id: 'pkg_low_stock', panelId: 'p2', serviceId: 1 },
        { id: 'pkg_user_capped', panelId: 'p2', serviceId: 1 },
      ],
      { telegramId: 777 }
    );

    // Panel p1 is full: new creation blocked, BUT renewal on existing config still allowed!
    const fullPanelPkg = map.get('pkg_full_panel')!;
    expect(fullPanelPkg.available).toBe(false);
    expect(fullPanelPkg.unavailableReason).toBe('panel_capacity_full');
    expect(fullPanelPkg.effectiveRemaining).toBe(0);
    expect(fullPanelPkg.renewalAvailable).toBe(true);
    expect(fullPanelPkg.renewalRemaining).toBe(10);

    // Panel p2 has service stock=4, package stock=3, user limit=2 -> effectiveRemaining = min(3,2,10,4)=2, lowStock=true
    const lowStockPkg = map.get('pkg_low_stock')!;
    expect(lowStockPkg.available).toBe(true);
    expect(lowStockPkg.effectiveRemaining).toBe(2);
    expect(lowStockPkg.lowStock).toBe(true);
    expect(lowStockPkg.soldCount).toBe(7);

    // User already bought pkg_user_capped once (maxPurchasesPerUser=1) -> blocked for both new and renewal
    const userCappedPkg = map.get('pkg_user_capped')!;
    expect(userCappedPkg.available).toBe(false);
    expect(userCappedPkg.renewalAvailable).toBe(false);
    expect(userCappedPkg.userLimitReached).toBe(true);
    expect(userCappedPkg.unavailableReason).toBe('package_user_limit_reached');
  });

  it('assertCheckoutAvailability skips panel/service limits on renew_config but still enforces named package stock', async () => {
    const svc = new InventoryService(makeSettings());

    // Renewal with custom volume skips both fleet capacity AND special SKU checks completely
    await expect(
      svc.assertCheckoutAvailability({
        telegramId: 100,
        operationType: 'renew_config',
        panelId: 'p1',
        serviceId: 1,
        packageId: 'custom_50gb_30d',
      })
    ).resolves.toBeUndefined();
    expect(getDbMock).not.toHaveBeenCalled();

    // Renewal with named package that has 0 stock throws OUT_OF_STOCK
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [
          [
            {
              packageId: 'promo_plan',
              stockRemaining: 0,
              reservedCount: 0,
              soldCount: 10,
              maxPurchasesPerUser: null,
              updatedAt: new Date(),
            },
          ],
        ],
      }).db as never
    );

    await expect(
      svc.assertCheckoutAvailability({
        telegramId: 100,
        operationType: 'renew_config',
        panelId: 'p1',
        serviceId: 1,
        packageId: 'promo_plan',
      })
    ).rejects.toMatchObject({
      name: 'InventoryUnavailableError',
      reason: 'package_out_of_stock',
      code: 'OUT_OF_STOCK',
    });
  });

  it('validates setPackageInventory inputs before touching DB', async () => {
    const svc = new InventoryService(makeSettings());
    await expect(svc.setPackageInventory('', { stockRemaining: 5 })).rejects.toThrow(
      'PACKAGE_INVENTORY_ID_INVALID'
    );
    await expect(svc.setPackageInventory('pkg1', { stockRemaining: -2 })).rejects.toThrow(
      'PACKAGE_STOCK_INVALID'
    );
    await expect(svc.setPackageInventory('pkg1', { maxPurchasesPerUser: 0 })).rejects.toThrow(
      'PACKAGE_USER_LIMIT_INVALID'
    );
    expect(getDbMock).not.toHaveBeenCalled();
  });
});
