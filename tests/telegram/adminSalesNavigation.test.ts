import {
  renderAdminSalesMenuScreen,
  salesMenuKeyboard,
} from '../../src/telegram/keyboards/adminMenu.js';
import { buildPackageManagerScreen } from '../../src/telegram/conversations/adminConversations/settings/presentation.js';
import type { ConversationContext, MenuContext } from '../../src/telegram/types.js';

describe('adminSalesNavigation', () => {
  it('renders sales menu screen with sales title and subtitle', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const screen = renderAdminSalesMenuScreen(ctx);
    expect(screen).toContain('admin_sales_title');
    expect(screen).toContain('admin_sales_subtitle');
  });

  it('builds salesMenuKeyboard with correct callback data and back to admin', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const keyboard = salesMenuKeyboard(ctx);
    const buttons = keyboard.inline_keyboard.flat();
    const callbacks = buttons.map((b) => b.callback_data);

    expect(callbacks).toContain('admin:sales:packages');
    expect(callbacks).toContain('admin:sales:custom_volume');
    expect(callbacks).toContain('admin:sales:promo');
    expect(callbacks).toContain('admin:sales:referral');
    expect(callbacks).toContain('admin:sales:payment');
    expect(callbacks).toContain('nav:admin');
  });

  it('buildPackageManagerScreen does not duplicate package count in section title', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => {
            if (key === 'admin_package_manager_title') return 'بسته‌ها';
            if (key === 'admin_package_manager_subtitle') return 'بسته‌های قابل فروش';
            if (key === 'admin_pkg_total_label') return 'تعداد کل بسته‌ها';
            if (key === 'admin_pkg_manager_prompt') return 'فهرست بسته‌های فعال و غیرفعال';
            return key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    const packages = [
      {
        id: 'pkg_starter',
        name: 'Starter',
        gbAmount: 10,
        durationDays: 30,
        price: 50_000,
      },
    ];

    const screen = buildPackageManagerScreen(ctx, packages, { totalCount: 1 });
    expect(screen).toContain('بسته‌ها');
    expect(screen).toContain('تعداد کل بسته‌ها');
    expect(screen).toContain('فهرست بسته‌های فعال و غیرفعال');
    // Ensure the section prompt does not have duplicated ({count} packages)
    expect(screen).not.toContain('(۱ بسته)');
  });
});
