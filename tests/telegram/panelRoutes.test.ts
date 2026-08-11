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
  it.each(['a:p:s:x:panel_123:1', 'admin:panel:service:delete:panel_123:1'])(
    'requires confirmation before deleting a panel service (%s)',
    async (callbackData) => {
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
    }
  );
});
