import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import { renderHomeDashboard } from '../../src/telegram/keyboards/homeDashboard.js';

describe('renderHomeDashboard', () => {
  it('renders home dashboard with active services and balance', async () => {
    const ctx = {
      from: { id: 123456 },
      services: {
        walletService: {
          getBalance: vi.fn().mockResolvedValue(50000),
        },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([
            {
              id: 'cfg1',
              configUsername: 'u_123',
              panelStatus: 'active',
              panelExpire: Math.floor(Date.now() / 1000) + 86400 * 10,
            },
          ]),
        },
        translationService: {
          get: vi.fn((key: string) => {
            const map: Record<string, string> = {
              home_title: 'خانه',
              home_subtitle: 'کیف پول و سرویس‌ها',
              home_balance: 'موجودی کیف پول',
              currency_toman: 'تومان',
              home_service_overview: 'سرویس‌ها',
              home_active_services: 'سرویس فعال',
              service_unit: 'سرویس',
              ui_status_active: 'فعال',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const screen = await renderHomeDashboard(ctx);
    expect(screen).toContain('خانه');
    expect(screen).toContain('موجودی کیف پول');
    expect(screen).toContain('۵۰٬۰۰۰ تومان');
  });

  it('warns about expired services when user has configs but 0 active', async () => {
    const ctx = {
      from: { id: 123456 },
      services: {
        walletService: {
          getBalance: vi.fn().mockResolvedValue(0),
        },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([
            {
              id: 'cfg1',
              configUsername: 'u_123',
              panelStatus: 'expired',
              panelExpire: Math.floor(Date.now() / 1000) - 86400,
            },
          ]),
        },
        translationService: {
          get: vi.fn((key: string) => {
            const map: Record<string, string> = {
              home_has_expired_services_hint: 'سرویس‌های شما منقضی شده‌اند.',
              home_title: 'خانه',
              home_subtitle: 'کیف پول و سرویس‌ها',
              home_balance: 'موجودی کیف پول',
              currency_toman: 'تومان',
              home_service_overview: 'سرویس‌ها',
              home_active_services: 'سرویس فعال',
              service_unit: 'سرویس',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const screen = await renderHomeDashboard(ctx);
    expect(screen).toContain('سرویس‌های شما منقضی شده‌اند.');
  });
});
