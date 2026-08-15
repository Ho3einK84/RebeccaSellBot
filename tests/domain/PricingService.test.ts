import { describe, expect, it, vi } from 'vitest';
import {
  parsePackageOptionsJson,
  PricingService,
} from '../../src/domain/services/PricingService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

function serviceWithPackages(rawPackages: string): PricingService {
  return new PricingService({
    getSetting: vi.fn((key: string) => (key === 'packages_json' ? rawPackages : '')),
    getSettingNum: vi.fn(() => 5_000),
  } as unknown as TranslationService);
}

describe('PricingService package settings', () => {
  it('accepts a well-formed DB-backed package list', () => {
    const service = serviceWithPackages(
      JSON.stringify([
        {
          id: 'summer_20',
          name: 'Summer 20 GB',
          gbAmount: 20,
          durationDays: 30,
          price: 95_000,
        },
      ])
    );

    expect(service.getPackages()).toEqual([
      {
        id: 'summer_20',
        name: 'Summer 20 GB',
        gbAmount: 20,
        durationDays: 30,
        price: 95_000,
      },
    ]);
  });

  it.each([
    '{}',
    '[]',
    '[{}]',
    '[{"id":"bad id","name":"Bad","gbAmount":1,"durationDays":1,"price":1}]',
    '[{"id":"bad","name":"Bad","gbAmount":0,"durationDays":1,"price":1}]',
    '[{"id":"bad","name":"Bad","gbAmount":1,"durationDays":0,"price":1}]',
    '[{"id":"bad","name":"Bad","gbAmount":1,"durationDays":1,"price":0}]',
    '[{"id":"same","name":"One","gbAmount":1,"durationDays":1,"price":1},{"id":"same","name":"Two","gbAmount":2,"durationDays":2,"price":2}]',
    '{not-json}',
  ])('falls back safely for malformed package setting %s', (rawPackages) => {
    const packages = serviceWithPackages(rawPackages).getPackages();

    expect(packages).toHaveLength(4);
    expect(packages[0]).toMatchObject({ id: 'pkg_10gb_30d', gbAmount: 10, durationDays: 30 });
  });

  it('exposes package validation to the admin editor before persistence', () => {
    expect(
      parsePackageOptionsJson(
        '[{"id":"admin_5","name":"Admin package","gbAmount":5,"durationDays":7,"price":25000}]'
      )
    ).toEqual([
      { id: 'admin_5', name: 'Admin package', gbAmount: 5, durationDays: 7, price: 25_000 },
    ]);
    expect(parsePackageOptionsJson('[{"id":"bad id"}]')).toBeUndefined();
  });

  it('validates and filters explicit package panel/service targets', () => {
    const raw = JSON.stringify([
      {
        id: 'global',
        name: 'Default target',
        gbAmount: 5,
        durationDays: 30,
        price: 25_000,
      },
      {
        id: 'panel_a',
        name: 'Panel A',
        gbAmount: 10,
        durationDays: 30,
        price: 40_000,
        panelId: 'rp_alpha',
        serviceId: 7,
      },
      {
        id: 'panel_b',
        name: 'Panel B',
        gbAmount: 20,
        durationDays: 30,
        price: 70_000,
        panelId: 'rp_beta',
        serviceId: 9,
      },
    ]);
    const service = serviceWithPackages(raw);

    expect(service.getPackages('rp_alpha', 7).map((pkg) => pkg.id)).toEqual(['global', 'panel_a']);
    expect(service.getPackages('rp_alpha', 8).map((pkg) => pkg.id)).toEqual(['global']);
    expect(
      parsePackageOptionsJson(
        '[{"id":"partial","name":"Partial","gbAmount":1,"durationDays":1,"price":1,"panelId":"rp_alpha"}]'
      )
    ).toBeUndefined();
  });

  it('reads the custom-volume panel and service as one atomic target', () => {
    const settings = {
      custom_volume_target_json: JSON.stringify({ panelId: 'rp_custom', serviceId: 42 }),
      custom_volume_panel_id: 'rp_stale',
      custom_volume_service_id: '99',
    };
    const service = new PricingService({
      getSetting: vi.fn((key: string) => settings[key as keyof typeof settings] ?? ''),
      getSettingNum: vi.fn(() => 5_000),
    } as unknown as TranslationService);

    expect(service.getCustomVolumeTarget()).toEqual({ panelId: 'rp_custom', serviceId: 42 });

    const partial = new PricingService({
      getSetting: vi.fn((key: string) => (key === 'custom_volume_panel_id' ? 'rp_only' : '')),
      getSettingNum: vi.fn(() => 5_000),
    } as unknown as TranslationService);
    expect(partial.getCustomVolumeTarget()).toEqual({});
  });

  it('applies configured volume tiers, duration pricing, and explicit overrides safely', () => {
    const settings = {
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
      getSetting: vi.fn((key: string) => settings[key as keyof typeof settings] ?? ''),
      getSettingNum: vi.fn((key: string, fallback: number) =>
        Number(settings[key as keyof typeof settings] ?? fallback)
      ),
    } as unknown as TranslationService);

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
  });

  it('looks up static and dynamic custom packages via getPackageById', () => {
    const service = serviceWithPackages('');
    expect(service.getPackageById('pkg_10gb_30d')).toMatchObject({
      id: 'pkg_10gb_30d',
      gbAmount: 10,
      durationDays: 30,
    });
    expect(service.getPackageById('custom_40gb_30d')).toMatchObject({
      id: 'custom_40gb_30d',
      gbAmount: 40,
      durationDays: 30,
    });
    expect(service.getPackageById('invalid_id')).toBeUndefined();
  });

  it('filters disabled packages from getPackages by default and includes them when requested', () => {
    const raw = JSON.stringify([
      {
        id: 'pkg_active',
        name: 'Active',
        gbAmount: 10,
        durationDays: 30,
        price: 50_000,
        enabled: true,
      },
      {
        id: 'pkg_inactive',
        name: 'Inactive',
        gbAmount: 20,
        durationDays: 30,
        price: 90_000,
        enabled: false,
      },
    ]);
    const service = serviceWithPackages(raw);

    expect(service.getPackages().map((p) => p.id)).toEqual(['pkg_active']);
    expect(service.getPackages(undefined, undefined, true).map((p) => p.id)).toEqual([
      'pkg_active',
      'pkg_inactive',
    ]);
    expect(service.getPackageById('pkg_inactive')).toMatchObject({
      id: 'pkg_inactive',
      enabled: false,
    });
  });
});
