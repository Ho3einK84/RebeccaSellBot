import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerAdminPanelRoutes } from '../../src/telegram/features/admin/panelRoutes.js';
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
  it('requires confirmation before deleting a panel service', async () => {
    const deleteService = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const route = matchRoute(collectRoutes(), 'a:p:s:x:panel_123:1');
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
    expect(reply).toHaveBeenCalledWith(
      'admin_panel_service_delete_confirm',
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
