import { describe, expect, it, vi } from 'vitest';
import { renderAdminRegistry } from '../../src/telegram/features/admin/maintenanceRoutes.js';
import type { MenuContext } from '../../src/telegram/types.js';

describe('Admin Registry & Management View', () => {
  it('renders admin list with enriched profile information and you-badge', async () => {
    let capturedText = '';
    let capturedKeyboard: any = null;

    const ctx = {
      from: { id: 6698253699 },
      session: {},
      editMessageText: vi.fn(async (text, options) => {
        capturedText = text;
        capturedKeyboard = options?.reply_markup;
        return { message_id: 101 };
      }),
      callbackQuery: { message: { message_id: 101 } },
      services: {
        adminService: {
          listAdmins: vi.fn(async () => [
            {
              telegramId: 6698253699,
              addedBy: null,
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
            {
              telegramId: 123456789,
              addedBy: 6698253699,
              createdAt: new Date('2026-02-01T00:00:00Z'),
            },
          ]),
        },
        userService: {
          findProfile: vi.fn(async (id: string) => {
            if (id === '6698253699') {
              return { telegramId: 6698253699, username: 'Ho3einK84', firstName: 'Hossein' } as any;
            }
            if (id === '123456789') {
              return {
                telegramId: 123456789,
                username: 'assistant_admin',
                firstName: 'Ali',
              } as any;
            }
            return null;
          }),
        },
        translationService: {
          get: vi.fn((key: string, _loc?: string, params?: Record<string, string | number>) => {
            const map: Record<string, string> = {
              admin_registry_title: 'مدیران',
              admin_registry_subtitle: 'دسترسی مدیران ربات را مدیریت کنید.',
              admin_registry_count_label: 'مدیران فعال',
              admin_registry_section: 'فهرست مدیران',
              admin_admin_you: 'شما',
              admin_add_admin_button: '➕ افزودن مدیر',
              admin_remove_admin_button: '➖ حذف',
              admin_menu_back_to_admin: '‹ پنل مدیریت',
            };
            if (map[key]) return map[key];
            if (params?.count) return String(params.count);
            return key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    await renderAdminRegistry(ctx);

    expect(capturedText).toContain('مدیران');
    expect(capturedText).toContain('مدیران فعال');
    expect(capturedText).toContain('@Ho3einK84 (6698253699)');
    expect(capturedText).toContain('@assistant_admin (123456789)');
    expect(capturedText).toContain('شما');

    expect(capturedKeyboard).toBeDefined();
    const flatButtons = capturedKeyboard.inline_keyboard.flat();
    const callbacks = flatButtons.map((b: any) => b.callback_data);

    expect(callbacks).toContain('admin:admins:view:6698253699');
    expect(callbacks).toContain('admin:admins:view:123456789');
    expect(callbacks).toContain('admin:admins:remove:123456789');
    expect(callbacks).not.toContain('admin:admins:remove:6698253699');
    expect(callbacks).toContain('admin:admins:add');
    expect(callbacks).toContain('nav:admin');
  });
});
