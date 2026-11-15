import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { buildAdminPanelOutageScreen } from '../../src/telegram/botRuntime.js';
import { renderAdminRegistry } from '../../src/telegram/features/admin/maintenanceRoutes.js';
import {
  buildPanelDetailKeyboard,
  buildPanelServicesKeyboard,
  buildServiceDetailKeyboard,
  registerAdminPanelRoutes,
} from '../../src/telegram/features/admin/panelRoutes.js';
import {
  adminDailyMenu,
  adminMenu,
  adminPanelsMenu,
  adminSalesMenu,
  adminSystemMenu,
} from '../../src/telegram/keyboards/adminMenu.js';
import { tForLocale } from '../../src/telegram/locale.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import type { BotServices, MenuContext } from '../../src/telegram/types.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';

describe('Admin panel routes, secret expiry, and outage notifications', () => {
  it.each([
    'a:p:ss:x:panel_123:1',
    'a:p:s:x:panel_123:1',
    'admin:panel:service:delete:panel_123:1',
  ])(
    'requires authorization and confirmation before deleting panel service (%s)',
    async (cbData) => {
      const deleteService = vi.fn();
      const services = createMockServices({
        adminIds: [1],
        isAdmin: vi.fn((id) => id === 1),
        panelRegistry: {
          getPanel: vi.fn(() => ({
            id: 'panel_123',
            services: [{ serviceId: 1, name: 'Primary service', isDefault: false }],
          })),
          deleteService,
        },
      });
      const harness = createBotHarness({ services });
      registerAdminPanelRoutes(harness.bot);

      await harness.sendCallback(cbData, { userId: 999 });
      expect(deleteService).not.toHaveBeenCalled();
      expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('access_denied');

      harness.clearCalls();
      await harness.sendCallback(cbData, { userId: 1 });
      expect(deleteService).not.toHaveBeenCalled();
      const edit = harness.callsFor('editMessageText').at(-1)?.payload;
      expect(String(edit?.text)).toContain('admin_panel_service_delete_title');
      expect(String(edit?.text)).toContain('admin_panel_service_delete_consequence');
    }
  );

  it('builds panel detail, paginated service catalog, and service detail keyboards', () => {
    const ctx = {
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        pricingService: {
          getCustomVolumeTarget: vi.fn(() => ({ panelId: 'panel_123', serviceId: 2 })),
        },
      },
    } as unknown as MenuContext;

    const services = Array.from({ length: 9 }, (_, index) => ({
      serviceId: index + 1,
      name: `Service ${index + 1}`,
      isDefault: index === 0,
    }));
    const panel = {
      id: 'panel_123',
      name: 'Panel',
      enabled: true,
      isDefault: false,
      credentialMode: 'api_key',
      services,
    } as never;

    expect(extractCallbackDataList(buildPanelDetailKeyboard(ctx, panel))).toEqual(
      expect.arrayContaining([
        'a:p:t:panel_123',
        'a:p:g:panel_123:0',
        'a:p:d:panel_123',
        'a:p:e:panel_123:n',
        'a:p:e:panel_123:u',
        'a:p:e:panel_123:k',
        'a:p:sm:panel_123',
        'a:p:x:panel_123',
      ])
    );
    expect(
      extractCallbackDataList(
        buildPanelDetailKeyboard(ctx, { ...(panel as object), isDefault: true } as never)
      )
    ).not.toContain('a:p:d:panel_123');

    const servicesKb = buildPanelServicesKeyboard(ctx, panel, 2);
    const svcLabels = servicesKb.inline_keyboard.flat().map((b) => b.text);
    const svcCbs = extractCallbackDataList(servicesKb);
    expect(svcLabels).toContain('🔹 [7] Service 7');
    expect(svcLabels).toContain('🔹 [9] Service 9');
    expect(svcLabels).not.toContain('⭐ [1] Service 1');
    expect(svcCbs).toContain('a:p:sm:panel_123:1');
    expect(svcCbs).toContain('ui:noop');

    expect(extractCallbackDataList(buildServiceDetailKeyboard(ctx, panel, services[1]!))).toEqual(
      expect.arrayContaining([
        'a:p:ss:d:panel_123:2',
        'a:p:ss:c:panel_123:2',
        'a:p:ss:x:panel_123:2',
        'a:p:sm:panel_123',
      ])
    );
  });

  it('bypasses secret input when stale (>5m) or when admin issues a slash command', async () => {
    let messageHandler:
      ((ctx: MenuContext, next: () => Promise<void>) => Promise<void>) | undefined;
    const bot = {
      callbackQuery: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, handler: typeof messageHandler) => {
        if (event === 'message:text') messageHandler = handler;
        return bot;
      }),
    };
    registerAdminPanelRoutes(bot as unknown as Bot<MenuContext>);

    const nextExpired = vi.fn().mockResolvedValue(undefined);
    const expiredCtx = {
      session: {
        adminPanelAction: 'await_api_key',
        adminPanelActionAt: Date.now() - 6 * 60 * 1000,
        adminPanelId: 'panel_123',
      },
      from: { id: 1 },
      services: { isAdmin: vi.fn(() => true) },
      message: { text: 'some-random-message' },
    } as unknown as MenuContext;

    await messageHandler!(expiredCtx, nextExpired);
    expect(nextExpired).toHaveBeenCalledTimes(1);
    expect(expiredCtx.session.adminPanelAction).toBeUndefined();

    const nextCmd = vi.fn().mockResolvedValue(undefined);
    const cmdCtx = {
      session: {
        adminPanelAction: 'await_api_key',
        adminPanelActionAt: Date.now(),
        adminPanelId: 'panel_123',
      },
      from: { id: 1 },
      services: { isAdmin: vi.fn(() => true) },
      message: { text: '/start' },
    } as unknown as MenuContext;
    await messageHandler!(cmdCtx, nextCmd);
    expect(nextCmd).toHaveBeenCalledTimes(1);
    expect(cmdCtx.session.adminPanelAction).toBeUndefined();

    const nextCancel = vi.fn().mockResolvedValue(undefined);
    const cancelReply = vi.fn().mockResolvedValue({ message_id: 2 });
    const cancelCtx = {
      session: {
        adminPanelAction: 'await_api_key',
        adminPanelActionAt: Date.now(),
        adminPanelId: 'panel_123',
      },
      from: { id: 1 },
      services: createMockServices({ adminIds: [1] }),
      message: { text: '/cancel', message_id: 10 },
      deleteMessage: vi.fn().mockResolvedValue(true),
      reply: cancelReply,
    } as unknown as MenuContext;
    await messageHandler!(cancelCtx, nextCancel);
    expect(nextCancel).not.toHaveBeenCalled();
    expect(cancelCtx.session.adminPanelAction).toBeUndefined();
    expect(String(cancelReply.mock.calls[0]?.[0])).toContain('operation_cancelled');
  });

  it('renders localized admin panel outage alerts with sanitized inline endpoints', () => {
    const translationService = new TranslationService();
    const mockServices = { translationService } as unknown as BotServices;

    const faScreen = buildAdminPanelOutageScreen(
      mockServices,
      'fa',
      'پنل اصلی',
      'GET /api/user/h_1504644064_37',
      3
    );
    expect(faScreen).toContain('🚨 *اختلال در اتصال پنل*');
    expect(faScreen).toContain('🌐 *آدرس پنل:* `GET /api/user/h_1504644064_37`');
    expect(faScreen).toContain('🔁 *تلاش‌های ناموفق:* ۳ مرتبه');

    const enScreen = buildAdminPanelOutageScreen(
      mockServices,
      'en',
      'Main Panel',
      'GET /api/user/h_1504644064_37',
      3
    );
    expect(enScreen).toContain('🚨 *Panel Connection Outage*');
    expect(enScreen).toContain('🔁 *Failed connection attempts:* 3 attempts');

    const backtickScreen = buildAdminPanelOutageScreen(
      mockServices,
      'fa',
      'Panel `test`',
      'POST /api/user/`malicious`?foo=1',
      5
    );
    expect(backtickScreen).toContain('`POST /api/user/malicious?foo=1`');

    const keyboard = new InlineKeyboard()
      .text(tForLocale(translationService, 'fa', 'admin_panel_manage_button'), 'admin:panels:open')
      .text(tForLocale(translationService, 'fa', 'menu_close'), 'ui:dismiss');
    expect(extractCallbackDataList(keyboard)).toEqual(['admin:panels:open', 'ui:dismiss']);
  });
});

describe('Admin menu hierarchy & Markdown-safe admin registry', () => {
  it('registers all grouped admin submenus with expected IDs', () => {
    expect((adminMenu as unknown as { id: string }).id).toBe('admin-menu');
    expect((adminDailyMenu as unknown as { id: string }).id).toBe('admin-daily-menu');
    expect((adminSalesMenu as unknown as { id: string }).id).toBe('admin-sales-menu');
    expect((adminPanelsMenu as unknown as { id: string }).id).toBe('admin-panels-menu');
    expect((adminSystemMenu as unknown as { id: string }).id).toBe('admin-system-menu');
  });

  it('renders admin registry with escaped usernames and strictly valid Telegram Markdown', async () => {
    let capturedText = '';
    let capturedKeyboard: unknown = null;
    const services = createMockServices({
      adminService: {
        listAdmins: vi.fn(async () => [
          { telegramId: 6698253699, addedBy: null, createdAt: new Date('2026-01-01T00:00:00Z') },
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
            return { telegramId: 6698253699, username: 'Ho3einK84', firstName: 'Hossein' };
          }
          if (id === '123456789') {
            return { telegramId: 123456789, username: 'assistant_admin', firstName: 'Ali' };
          }
          return null;
        }),
      },
      translationService: new TranslationService(),
    });

    const ctx = {
      from: { id: 6698253699 },
      session: {},
      editMessageText: vi.fn(async (text: string, options?: { reply_markup?: unknown }) => {
        capturedText = text;
        capturedKeyboard = options?.reply_markup;
        return { message_id: 101 };
      }),
      callbackQuery: { message: { message_id: 101 } },
      services,
    } as unknown as MenuContext;

    await renderAdminRegistry(ctx);

    expect(capturedText).toContain('@Ho3einK84 (6698253699)');
    expect(capturedText).toContain('@assistant\\_admin (123456789)');
    expect(validateTelegramMarkdown(capturedText).valid).toBe(true);

    const callbacks = extractCallbackDataList(capturedKeyboard);
    expect(callbacks).toContain('admin:admins:view:6698253699');
    expect(callbacks).toContain('admin:admins:view:123456789');
    expect(callbacks).toContain('admin:admins:remove:123456789');
    expect(callbacks).not.toContain('admin:admins:remove:6698253699');
    expect(callbacks).toContain('admin:admins:add');
    expect(callbacks).toContain('nav:admin');
  });
});
