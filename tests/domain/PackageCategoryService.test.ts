import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageCategoryService } from '../../src/domain/services/PackageCategoryService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { getDb } from '../../src/infra/db.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  icon: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

describe('PackageCategoryService', () => {
  let categories: CategoryRow[];
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let service: PackageCategoryService;

  beforeEach(() => {
    categories = [];
    settings = {
      packages_json: JSON.stringify([
        {
          id: 'pkg1',
          name: 'Pack 1',
          gbAmount: 10,
          durationDays: 30,
          price: 50000,
          categoryId: 'cat1',
        },
        {
          id: 'pkg2',
          name: 'Pack 2',
          gbAmount: 20,
          durationDays: 30,
          price: 90000,
          categoryId: 'cat2',
        },
      ]),
    };

    translationService = {
      getSetting: vi.fn((key: string, def?: string) => settings[key] ?? def ?? ''),
      updateSetting: vi.fn(async (key: string, val: string) => {
        settings[key] = val;
      }),
    } as unknown as TranslationService;

    const mockDb = {
      select: vi.fn((fields?: any) => {
        if (fields && typeof fields === 'object' && 'maxOrder' in fields) {
          const maxOrder =
            categories.length > 0 ? Math.max(...categories.map((c) => c.displayOrder)) : null;
          return {
            from: vi.fn(() => Promise.resolve([{ maxOrder }])),
          };
        }
        return {
          from: vi.fn(() => ({
            orderBy: vi.fn(() => {
              const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
              return Promise.resolve(sorted);
            }),
            where: vi.fn(() => ({
              limit: vi.fn((_limit: number) => {
                return Promise.resolve(categories.slice(0, 1));
              }),
            })),
          })),
        };
      }),
      insert: vi.fn(() => ({
        values: vi.fn((val: any) => {
          const row: CategoryRow = {
            id: val.id,
            name: val.name,
            description: val.description ?? null,
            displayOrder: val.displayOrder ?? 0,
            icon: val.icon ?? null,
            enabled: val.enabled ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          categories.push(row);
          return {
            returning: vi.fn(() => Promise.resolve([row])),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((updates: any) => ({
          where: vi.fn(() => {
            return Promise.resolve();
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn((_condition: any) => ({
          returning: vi.fn(() => Promise.resolve([{ id: 'cat1' }])),
        })),
      })),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);
    service = new PackageCategoryService(translationService);
  });

  it('creates a category with auto-generated ID and display order', async () => {
    const created = await service.createCategory({
      name: 'Vip Plans',
      icon: '⭐',
    });

    expect(created.name).toBe('Vip Plans');
    expect(created.icon).toBe('⭐');
    expect(created.id).toBeDefined();
    expect(created.displayOrder).toBe(0);
  });

  it('lists categories with enable filtering', async () => {
    categories.push(
      {
        id: 'cat1',
        name: 'Cat 1',
        description: null,
        displayOrder: 0,
        icon: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cat2',
        name: 'Cat 2',
        description: null,
        displayOrder: 1,
        icon: null,
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );

    const all = await service.listCategories(true);
    expect(all).toHaveLength(2);

    const activeOnly = await service.listCategories(false);
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0]?.id).toBe('cat1');
  });

  it('unlinks packages from packages_json upon deleting category', async () => {
    await service.deleteCategory('cat1');

    const updatedPackages = JSON.parse(settings.packages_json);
    expect(updatedPackages[0].categoryId).toBeUndefined();
    expect(updatedPackages[1].categoryId).toBe('cat2');
    expect(updatedPackages).toHaveLength(2);
  });
});
