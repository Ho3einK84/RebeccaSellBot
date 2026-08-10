import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import { renderWalletDashboard } from '../../src/telegram/keyboards/mainMenu.js';
import { localizedNumber } from '../../src/telegram/locale.js';

describe('Wallet Dashboard & Presets (Phase 3)', () => {
  it('renders wallet dashboard with balance and pending receipt status', async () => {
    const getBalance = vi.fn().mockResolvedValue(150000);
    const getPendingReceiptForUser = vi.fn().mockResolvedValue({
      id: 'rcp_101',
      amount: 100000,
      createdAt: new Date('2026-08-01T12:00:00Z'),
    });

    const ctx = {
      from: { id: 789, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: { getBalance, getPendingReceiptForUser },
        translationService: {
          get: vi.fn((key: string, _locale: string, params?: Record<string, string | number>) => {
            if (key === 'wallet_pending_receipt_detail' && params) {
              return `⏳ رسید در انتظار: ${params.amount} تومان`;
            }
            return key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const text = await renderWalletDashboard(ctx);

    expect(getBalance).toHaveBeenCalledWith(789);
    expect(getPendingReceiptForUser).toHaveBeenCalledWith(789);
    expect(text).toContain(localizedNumber(150000, ctx));
    expect(text).toContain(localizedNumber(100000, ctx));
  });

  it('renders clean wallet dashboard without pending receipt when none exists', async () => {
    const getBalance = vi.fn().mockResolvedValue(50000);
    const getPendingReceiptForUser = vi.fn().mockResolvedValue(null);

    const ctx = {
      from: { id: 789, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: { getBalance, getPendingReceiptForUser },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const text = await renderWalletDashboard(ctx);

    expect(text).toContain(localizedNumber(50000, ctx));
    expect(text).not.toContain('rcp_');
  });
});
