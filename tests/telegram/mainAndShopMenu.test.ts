import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import { renderHomeDashboard } from '../../src/telegram/keyboards/mainMenu.js';
import { localizedNumber } from '../../src/telegram/locale.js';

describe('Home Dashboard & Main Menu (Phase 2)', () => {
  it('renders state-aware home dashboard with wallet balance and service summary', async () => {
    const getBalance = vi.fn().mockResolvedValue(50000);
    const listConfigsForOwner = vi.fn().mockResolvedValue([
      { id: 'cfg1', configUsername: 'alice', panelStatus: 'active', panelExpire: null },
      { id: 'cfg2', configUsername: 'bob', panelStatus: 'active', panelExpire: null },
    ]);

    const ctx = {
      from: { id: 123, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: { getBalance },
        configService: { listConfigsForOwner },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const dashboardText = await renderHomeDashboard(ctx);

    expect(getBalance).toHaveBeenCalledWith(123);
    expect(listConfigsForOwner).toHaveBeenCalledWith(123);
    expect(dashboardText).toContain(localizedNumber(50000, ctx));
    expect(dashboardText).toContain(localizedNumber(2, ctx));
  });

  it('highlights near-expiry subscription on home dashboard when expiring within 3 days', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const getBalance = vi.fn().mockResolvedValue(20000);
    const listConfigsForOwner = vi.fn().mockResolvedValue([
      {
        id: 'cfg1',
        configUsername: 'expiring_user',
        panelStatus: 'active',
        panelExpire: nowSec + 86400 * 2, // 2 days left
      },
    ]);

    const ctx = {
      from: { id: 456, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: { getBalance },
        configService: { listConfigsForOwner },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const dashboardText = await renderHomeDashboard(ctx);

    expect(dashboardText).toContain('expiring_user');
    expect(dashboardText).toContain(localizedNumber(2, ctx));
  });
});
