import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PricingService,
  parsePackageOptionsJson,
} from '../../src/domain/services/PricingService.js';
import { PackageCategoryService } from '../../src/domain/services/PackageCategoryService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { getDb } from '../../src/infra/db.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function serviceWithPackages(rawPackages: string): PricingService {
  return new PricingService({
    getSetting: vi.fn((key: string) => (key === 'packages_json' ? rawPackages : '')),
    getSettingNum: vi.fn(() => 5_000),
  } as unknown as TranslationService);
}

describe('PricingService & PackageCategoryService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PricingService packages & filtering', () => {
    it('accepts valid DB-backed packages and rejects malformed definitions safely', () => {
      const valid = serviceWithPackages(
        JSON.stringify([
          { id: 'summer_20', name: 'Summer 20 GB', gbAmount: 20, durationDays: 30, price: 95_000 },
        ])
      );
      expect(valid.getPackages()).toEqual([
        { id: 'summer_20', name: 'Summer 20 GB', gbAmount: 20, durationDays: 30, price: 95_000 },
      ]);

      for (const bad of [
        '{}',
        '[]',
        '[{}]',
        '[{"id":"bad id","name":"Bad","gbAmount":1,"durationDays":1,"price":1}]',
        '[{"id":"bad","name":"Bad","gbAmount":0,"durationDays":1,"price":1}]',
        '[{"id":"bad","name":"Bad","gbAmount":1,"durationDays":0,"price":1}]',
        '[{"id":"bad","name":"Bad","gbAmount":1,"durationDays":1,"price":0}]',
        '[{"id":"same","name":"One","gbAmount":1,"durationDays":1,"price":1},{"id":"same","name":"Two","gbAmount":2,"durationDays":2,"price":2}]',
        '{not-json}',
      ]) {
        const packages = serviceWithPackages(bad).getPackages();
        expect(packages).toHaveLength(4);
        expect(packages[0]).toMatchObject({ id: 'pkg_10gb_30d', gbAmount: 10, durationDays: 30 });
      }

      expect(
        parsePackageOptionsJson(
          '[{"id":"admin_5","name":"Admin package","gbAmount":5,"durationDays":7,"price":25000}]'
        )
      ).toEqual([
        { id: 'admin_5', name: 'Admin package', gbAmount: 5, durationDays: 7, price: 25_000 },
      ]);
      expect(parsePackageOptionsJson('[{"id":"bad id"}]')).toBeUndefined();
    });

    it('filters by panel/service targets, enabled flags, and categoryId', () => {
      const raw = JSON.stringify([
        {
          id: 'global',
          name: 'Default target',
          gbAmount: 5,
          durationDays: 30,
          price: 25_000,
          categoryId: 'cat_vip',
        },
        {
          id: 'panel_a',
          name: 'Panel A',
          gbAmount: 10,
          durationDays: 30,
          price: 40_000,
          panelId: 'rp_alpha',
          serviceId: 7,
          categoryId: 'cat_vip',
          enabled: true,
        },
        {
          id: 'panel_inactive',
          name: 'Panel Inactive',
          gbAmount: 20,
          durationDays: 30,
          price: 70_000,
          enabled: false,
        },
      ]);
      const service = serviceWithPackages(raw);

      expect(service.getPackages('rp_alpha', 7).map((p) => p.id)).toEqual(['global', 'panel_a']);
      expect(service.getPackages('rp_alpha', 8).map((p) => p.id)).toEqual(['global']);
      expect(service.getPackages(undefined, undefined, true).map((p) => p.id)).toEqual([
        'global',
        'panel_a',
        'panel_inactive',
      ]);
      expect(service.getPackageById('panel_inactive')).toMatchObject({ enabled: false });
      expect(service.getPackages(undefined, undefined, false, 'cat_vip').map((p) => p.id)).toEqual([
        'global',
        'panel_a',
      ]);
      expect(
        parsePackageOptionsJson(
          '[{"id":"partial","name":"Partial","gbAmount":1,"durationDays":1,"price":1,"panelId":"rp_alpha"}]'
        )
      ).toBeUndefined();

      // Uncategorized filter (null)
      const catsSvc = serviceWithPackages(
        JSON.stringify([
          { id: 'p1', name: 'P1', gbAmount: 10, durationDays: 30, price: 50_000, categoryId: 'c1' },
          { id: 'p2', name: 'P2', gbAmount: 20, durationDays: 30, price: 90_000 },
        ])
      );
      expect(catsSvc.getPackages(undefined, undefined, false, null).map((p) => p.id)).toEqual([
        'p2',
      ]);
    });

    it('reads atomic custom-volume targets, computes tiers & overrides, and resolves getPackageById', () => {
      const settings: Record<string, string> = {
        custom_volume_target_json: JSON.stringify({ panelId: 'rp_custom', serviceId: 42 }),
        custom_volume_panel_id: 'rp_stale',
        custom_volume_service_id: '99',
        price_per_gb: '5000',
        price_per_day: '1000',
        volume_pricing_tiers_json: JSON.stringify([
          { id: 'bulk_50', minGb: 50, discountPercent: 20 },
        ]),
        custom_price_overrides_json: JSON.stringify([
          { id: 'special_90', minGb: 90, minDays: 30, price: 300_000 },
        ]),
      };
      const service = new PricingService({
        getSetting: vi.fn((key: string) => settings[key] ?? ''),
        getSettingNum: vi.fn((key: string, fallback: number) => Number(settings[key] ?? fallback)),
      } as unknown as TranslationService);

      expect(service.getCustomVolumeTarget()).toEqual({ panelId: 'rp_custom', serviceId: 42 });
      expect(serviceWithPackages('').getCustomVolumeTarget()).toEqual({});

      expect(service.getCustomPriceQuote(50, 30)).toMatchObject({
        totalPrice: 230_000,
        volumePrice: 200_000,
        durationPrice: 30_000,
        pricePerGb: 4_000,
        tierId: 'bulk_50',
      });
      expect(service.getCustomPriceQuote(100, 30)).toMatchObject({
        totalPrice: 300_000,
        overrideId: 'special_90',
      });

      const defaults = serviceWithPackages('');
      expect(defaults.getPackageById('pkg_10gb_30d')).toMatchObject({ gbAmount: 10 });
      expect(defaults.getPackageById('custom_40gb_30d')).toMatchObject({ gbAmount: 40 });
      expect(defaults.getPackageById('invalid_id')).toBeUndefined();
    });
  });

  describe('PackageCategoryService persistence & unlinking', () => {
    it('creates, updates, lists, reorders, and deletes categories while unlinking packages_json', async () => {
      const settings: Record<string, string> = {
        packages_json: JSON.stringify([
          {
            id: 'pkg1',
            name: 'Pack 1',
            gbAmount: 10,
            durationDays: 30,
            price: 50_000,
            categoryId: 'cat1',
          },
          {
            id: 'pkg2',
            name: 'Pack 2',
            gbAmount: 20,
            durationDays: 30,
            price: 90_000,
            categoryId: 'cat2',
          },
        ]),
      };
      const ts = {
        getSetting: vi.fn((k: string, fb?: string) => settings[k] ?? fb ?? ''),
        updateSetting: vi.fn(async (k: string, val: string) => {
          settings[k] = val;
        }),
      } as unknown as TranslationService;
      const catService = new PackageCategoryService(ts);

      // Invalid name rejected before DB call
      getDbMock.mockReturnValue(createMockDb().db as never);
      await expect(catService.createCategory({ name: '   ' })).rejects.toThrow(
        'INVALID_CATEGORY_NAME'
      );

      // Create derives next displayOrder from aggregate maxOrder
      const createdRow = {
        id: 'cat_vip_plans_abc',
        name: 'Vip Plans',
        description: null,
        icon: '⭐',
        displayOrder: 2,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createDb = createMockDb({
        selectResults: [[{ maxOrder: 1 }]],
        returningResults: [[createdRow]],
      });
      getDbMock.mockReturnValue(createDb.db as never);
      await expect(catService.createCategory({ name: 'Vip Plans', icon: '⭐' })).resolves.toEqual(
        createdRow
      );
      expect(createDb.state.insertCalls[0]?.values).toMatchObject({
        name: 'Vip Plans',
        icon: '⭐',
        displayOrder: 2,
        enabled: true,
      });

      // List enabled vs all categories
      const listDb = createMockDb({
        selectResults: [
          [
            { ...createdRow, id: 'cat1', enabled: true },
            { ...createdRow, id: 'cat2', enabled: false },
          ],
          [
            { ...createdRow, id: 'cat1', enabled: true },
            { ...createdRow, id: 'cat2', enabled: false },
          ],
        ],
      });
      getDbMock.mockReturnValue(listDb.db as never);
      await expect(catService.listCategories(true)).resolves.toHaveLength(2);
      await expect(catService.listCategories(false)).resolves.toHaveLength(1);

      // Update trims name/description & returns updated row
      const updateDb = createMockDb({
        returningResults: [[{ ...createdRow, name: 'Renamed' }]],
      });
      getDbMock.mockReturnValue(updateDb.db as never);
      await expect(
        catService.updateCategory('cat1', { name: '  Renamed  ', displayOrder: -5 })
      ).resolves.toMatchObject({ name: 'Renamed' });
      expect(updateDb.state.updateCalls[0]?.set).toMatchObject({
        name: 'Renamed',
        displayOrder: 0,
      });

      // Reorder runs transactional updates with ascending displayOrder
      const reorderDb = createMockDb();
      getDbMock.mockReturnValue(reorderDb.db as never);
      await catService.reorderCategories(['cat2', 'cat1']);
      expect(reorderDb.state.committedTransactions).toBe(1);
      expect(reorderDb.state.updateCalls.map((c) => c.set.displayOrder)).toEqual([0, 1]);

      // Delete category returns false if absent, and unlinks packages_json when deleted
      const missingDeleteDb = createMockDb({ returningResults: [[]] });
      getDbMock.mockReturnValue(missingDeleteDb.db as never);
      await expect(catService.deleteCategory('cat_missing')).resolves.toBe(false);

      const deleteDb = createMockDb({ returningResults: [[{ id: 'cat1' }]] });
      getDbMock.mockReturnValue(deleteDb.db as never);
      await expect(catService.deleteCategory('cat1')).resolves.toBe(true);
      const unlinked = JSON.parse(settings.packages_json!) as Array<{ categoryId?: string }>;
      expect(unlinked[0]?.categoryId).toBeUndefined();
      expect(unlinked[1]?.categoryId).toBe('cat2');
    });
  });
});
