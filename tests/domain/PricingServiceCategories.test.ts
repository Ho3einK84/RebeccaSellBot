import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PricingService,
  parsePackageOptionsJson,
} from '../../src/domain/services/PricingService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

describe('PricingServiceCategories', () => {
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let pricingService: PricingService;

  beforeEach(() => {
    settings = {
      packages_json: JSON.stringify([
        {
          id: 'pkg1',
          name: 'Pack 1',
          gbAmount: 10,
          durationDays: 30,
          price: 50000,
          categoryId: 'cat_vip',
        },
        {
          id: 'pkg2',
          name: 'Pack 2',
          gbAmount: 20,
          durationDays: 30,
          price: 90000,
          categoryId: 'cat_vip',
        },
        { id: 'pkg3', name: 'Pack 3', gbAmount: 30, durationDays: 30, price: 120000 },
      ]),
    };

    translationService = {
      getSetting: vi.fn((key: string, def?: string) => settings[key] ?? def ?? ''),
    } as unknown as TranslationService;

    pricingService = new PricingService(translationService);
  });

  it('parses packages with categoryId', () => {
    const packages = parsePackageOptionsJson(settings.packages_json);
    expect(packages).toHaveLength(3);
    expect(packages?.[0]?.categoryId).toBe('cat_vip');
    expect(packages?.[2]?.categoryId).toBeUndefined();
  });

  it('filters packages by categoryId', () => {
    const vipPackages = pricingService.getPackages(undefined, undefined, false, 'cat_vip');
    expect(vipPackages).toHaveLength(2);
    expect(vipPackages.every((p) => p.categoryId === 'cat_vip')).toBe(true);

    const uncategorizedPackages = pricingService.getPackages(undefined, undefined, false, null);
    expect(uncategorizedPackages).toHaveLength(1);
    expect(uncategorizedPackages[0]?.id).toBe('pkg3');

    const allPackages = pricingService.getPackages();
    expect(allPackages).toHaveLength(3);
  });
});
