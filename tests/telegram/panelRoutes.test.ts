import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPanelDetailKeyboard,
  buildPanelServicesKeyboard,
  buildServiceDetailKeyboard,
  registerAdminPanelRoutes,
} from '../../src/telegram/features/admin/panelRoutes.js';
import type { MenuContext } from '../../src/telegram/types.js';

type CallbackHandler = (ctx: MenuContext & { match: RegExpMatchArray }) => Promise<void>;
type RegisteredRoute = { trigger: string | RegExp; handler: CallbackHandler };

function collectRoutes(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const bot = {
    callbackQuery(trigger: string | RegExp, handler: CallbackHandler) {
      routes.push({ trigger, handler });
      return this;
    },
    on() {
      return this;
    },
  };
  registerAdminPanelRoutes(bot as unknown as Bot<MenuContext>);
  return routes;
}

function matchRoute(
  routes: RegisteredRoute[],
  callbackData: string
): CallbackHandler & {
  match: RegExpMatchArray;
} {
  for (const route of routes) {
    if (!(route.trigger instanceof RegExp)) continue;
    const match = callbackData.match(route.trigger);
    if (match) return Object.assign(route.handler, { match });
  }
  throw new Error(`No callback route matched ${callbackData}`);
}

describe('admin panel routes', () => {
  it.each([
    'a:p:ss:x:panel_123:1',
    'a:p:s:x:panel_123:1',
    'admin:panel:service:delete:panel_123:1',
  ])('requires confirmation before deleting a panel service (%s)', async (callbackData) => {
    const deleteService = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const route = matchRoute(collectRoutes(), callbackData);
    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      session: {},
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        panelRegistry: {
          getPanel: vi.fn(() => ({
            id: 'panel_123',
            services: [{ serviceId: 1, name: 'Primary service', isDefault: false }],
          })),
          deleteService,
        },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route(ctx);

    expect(deleteService).not.toHaveBeenCalled();
    const [confirmationText, confirmationOptions] = reply.mock.calls[0] ?? [];
    expect(String(confirmationText)).toContain('admin_panel_service_delete_title');
    expect(String(confirmationText)).toContain('admin_panel_service_delete_consequence');
    expect(confirmationOptions).toEqual(
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: expect.anything() })
    );
  });

  it('builds clean main panel detail keyboard with services manage button', () => {
    const ctx = {
      services: {
        translationService: { get: vi.fn((key: string) => key) },
      },
    } as unknown as MenuContext;
    const panel = {
      id: 'panel_123',
      name: 'Panel',
      enabled: true,
      isDefault: false,
      credentialMode: 'api_key',
      services: [
        { serviceId: 1, name: 'Service 1', isDefault: true },
        { serviceId: 2, name: 'Service 2', isDefault: false },
      ],
    } as never;

    const keyboard = buildPanelDetailKeyboard(ctx, panel);
    const rows = keyboard.inline_keyboard.flat();
    const callbacks = rows.map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('a:p:t:panel_123'); // Test connection
    expect(callbacks).toContain('a:p:g:panel_123:0'); // Disable toggle
    expect(callbacks).toContain('a:p:d:panel_123'); // Make default
    expect(callbacks).toContain('a:p:sm:panel_123'); // Services menu
    expect(callbacks).toContain('a:p:x:panel_123'); // Delete panel
  });

  it('paginates services in the dedicated services menu keyboard', () => {
    const services = Array.from({ length: 9 }, (_, index) => ({
      serviceId: index + 1,
      name: `Service ${index + 1}`,
      isDefault: index === 0,
    }));
    const ctx = {
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        pricingService: {
          getCustomVolumeTarget: vi.fn(() => ({ panelId: 'other', serviceId: 99 })),
        },
      },
    } as unknown as MenuContext;
    const panel = {
      id: 'panel_123',
      name: 'Panel',
      enabled: true,
      isDefault: true,
      credentialMode: 'api_key',
      services,
    } as never;

    const keyboard = buildPanelServicesKeyboard(ctx, panel, 2);
    const rows = keyboard.inline_keyboard.flat();
    const labels = rows.map((button) => button.text);
    const callbacks = rows.map((button) => (button as { callback_data?: string }).callback_data);

    expect(labels).toContain('🔹 [7] Service 7');
    expect(labels).toContain('🔹 [9] Service 9');
    expect(labels).not.toContain('⭐ [1] Service 1');
    expect(callbacks).toContain('a:p:sm:panel_123:1');
    expect(callbacks).toContain('ui:noop');
  });

  it('builds service detail keyboard with custom volume target and default actions', () => {
    const ctx = {
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        pricingService: {
          getCustomVolumeTarget: vi.fn(() => ({ panelId: 'panel_123', serviceId: 2 })),
        },
      },
    } as unknown as MenuContext;
    const panel = {
      id: 'panel_123',
      name: 'Panel',
      services: [
        { serviceId: 1, name: 'Service 1', isDefault: true },
        { serviceId: 2, name: 'Service 2', isDefault: false },
      ],
    } as never;

    const keyboard = buildServiceDetailKeyboard(ctx, panel, panel.services[1]!);
    const rows = keyboard.inline_keyboard.flat();
    const callbacks = rows.map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('a:p:ss:d:panel_123:2'); // Make default service
    expect(callbacks).toContain('a:p:ss:c:panel_123:2'); // Custom volume target
    expect(callbacks).toContain('a:p:ss:x:panel_123:2'); // Delete service
    expect(callbacks).toContain('a:p:sm:panel_123'); // Back to services
  });

  it('bypasses secret input and clears action when session is older than 5 minutes', async () => {
    let messageHandler: ((ctx: any, next: () => Promise<void>) => Promise<void>) | undefined;
    const bot = {
      callbackQuery: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'message:text') messageHandler = handler;
        return bot;
      }),
    };
    registerAdminPanelRoutes(bot as unknown as Bot<MenuContext>);
    expect(messageHandler).toBeDefined();

    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      session: {
        adminPanelAction: 'await_api_key',
        adminPanelActionAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        adminPanelId: 'panel_123',
      },
      from: { id: 1 },
      services: {
        isAdmin: vi.fn(() => true),
      },
      message: { text: 'some-random-message' },
    };

    await messageHandler!(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.session.adminPanelAction).toBeUndefined();
    expect(ctx.session.adminPanelActionAt).toBeUndefined();
    expect(ctx.session.adminPanelId).toBeUndefined();
  });
});
