import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import { renderWalletStatementScreen } from '../../src/telegram/keyboards/mainMenu.js';

describe('renderWalletStatementScreen', () => {
  it('renders empty state when user has no transactions', async () => {
    const editMessageText = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 100 });
    const ctx = {
      from: { id: 12345 },
      editMessageText,
      reply,
      services: {
        walletService: {
          listTransactionsForUser: vi.fn().mockResolvedValue({
            transactions: [],
            total: 0,
            totalPages: 1,
            page: 1,
          }),
        },
        translationService: {
          get: vi.fn((key: string) => {
            const map: Record<string, string> = {
              wallet_history_title: 'سوابق تراکنش‌ها',
              wallet_history_empty: 'هیچ تراکنشی ثبت نشده است.',
              menu_back_wallet: '‹ کیف پول',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    await renderWalletStatementScreen(ctx, 1);
    expect(reply).toHaveBeenCalled();
    const calledText = reply.mock.calls[0][0];
    expect(calledText).toContain('سوابق تراکنش‌ها');
    expect(calledText).toContain('هیچ تراکنشی ثبت نشده است.');
  });

  it('renders transactions list when user has transactions', async () => {
    const editMessageText = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 101 });
    const ctx = {
      from: { id: 12345 },
      editMessageText,
      reply,
      services: {
        walletService: {
          listTransactionsForUser: vi.fn().mockResolvedValue({
            transactions: [
              {
                id: 'tx_1',
                telegramId: 12345,
                amount: 50000,
                balanceAfter: 50000,
                type: 'topup',
                description: 'Topup receipt',
                createdAt: new Date('2026-08-28T12:00:00Z'),
              },
            ],
            total: 1,
            totalPages: 1,
            page: 1,
          }),
        },
        translationService: {
          get: vi.fn((key: string) => {
            const map: Record<string, string> = {
              wallet_history_title: 'سوابق تراکنش‌ها',
              wallet_dashboard_subtitle: 'ریز تراکنش‌ها',
              tx_type_topup: 'افزایش موجودی',
              wallet_pending_amount: 'مبلغ',
              wallet_available_balance: 'موجودی پس از تراکنش',
              currency_toman: 'تومان',
              subscription_list_page: 'صفحه {page} از {total_pages}',
              menu_back_wallet: '‹ کیف پول',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    await renderWalletStatementScreen(ctx, 1);
    expect(reply).toHaveBeenCalled();
    const calledText = reply.mock.calls[0][0];
    expect(calledText).toContain('سوابق تراکنش‌ها');
    expect(calledText).toContain('افزایش موجودی');
    expect(calledText).toContain('۵۰٬۰۰۰ تومان');
  });
});
