import { describe, expect, it, vi } from 'vitest';
import { formatPackageButtonLabel } from '../../src/telegram/locale.js';
import type { LocaleAwareContext } from '../../src/telegram/locale.js';

describe('packageDisplayMode', () => {
  const pkg = {
    id: 'pkg_vip_100gb',
    name: '100 GB - 60 Days',
    price: 150_000,
    gbAmount: 100,
  };

  it('renders volume + days + price when display mode is specs (default)', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => 'specs'),
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string, _loc?: string, params?: Record<string, string | number>) => {
            if (key === 'package_button') return `📦 ${params?.name} · ${params?.price} تومان`;
            return key;
          }),
        },
      },
    } as unknown as LocaleAwareContext;

    const label = formatPackageButtonLabel(ctx as any, pkg);
    expect(label).toContain('100 گیگ');
    expect(label).toContain('۱۵۰٬۰۰۰ تومان');
  });

  it('renders package name only when display mode is name', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => 'name'),
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as LocaleAwareContext;

    const label = formatPackageButtonLabel(ctx as any, pkg);
    expect(label).toBe('100 گیگ - 60 Days');
  });

  it('renders custom package name when package uses a stock ID but custom name in name mode', () => {
    const customNamedPkg = {
      id: 'pkg_50gb_30d',
      name: 'سرویس پیش فرض',
      price: 150_000,
      gbAmount: 50,
    };
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => 'name'),
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => {
            if (key === 'package_pkg_50gb_30d_name') return '۵۰ گیگ · ۳۰ روز';
            return key;
          }),
        },
      },
    } as unknown as LocaleAwareContext;

    const label = formatPackageButtonLabel(ctx as any, customNamedPkg);
    expect(label).toBe('سرویس پیش فرض');
  });
});
