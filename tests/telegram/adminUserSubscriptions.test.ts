import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerAdminUserRoutes } from '../../src/telegram/features/admin/userRoutes.js';
import { registerSubscriptionRoutes } from '../../src/telegram/features/subscriptions/routes.js';
import type { MenuContext } from '../../src/telegram/types.js';

type CallbackHandler = (ctx: MenuContext & { match: RegExpMatchArray }) => Promise<void>;
type RegisteredRoute = { trigger: string | RegExp; handler: CallbackHandler };

function collectRoutes(register: (bot: Bot<MenuContext>) => void): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const bot = {
    callbackQuery(trigger: string | RegExp, handler: CallbackHandler) {
      routes.push({ trigger, handler });
      return this;
    },
  };
  register(bot as unknown as Bot<MenuContext>);
  return routes;
}

function matchRoute(
  routes: RegisteredRoute[],
  callbackData: string
): {
  handler: CallbackHandler;
  match: RegExpMatchArray;
} {
  for (const route of routes) {
    if (!(route.trigger instanceof RegExp)) continue;
    const match = callbackData.match(route.trigger);
    if (match) return { handler: route.handler, match };
  }
  throw new Error(`No callback route matched ${callbackData}`);
}

function translationServiceStub() {
  return {
    resolveLocale: vi.fn(() => 'fa'),
    get: vi.fn((key: string, _locale?: string, vars?: Record<string, unknown>) => {
      if (key === 'subscription_detail_heading' && vars?.username) {
        return `سرویس · \`${vars.username}\``;
      }
      return key;
    }),
  };
}

describe('admin user subscriptions and full management', () => {
  it('renders user services without backslashes in titles and provides management action buttons', async () => {
    const listConfigsForOwner = vi.fn().mockResolvedValue([
      {
        id: 'uc_sub_1',
        telegramId: 455713813,
        configUsername: 'h_455713813_29',
        panelStatus: 'disabled',
        panelDataLimit: 30 * 1024 ** 3,
        panelExpire: Math.floor(Date.now() / 1000) + 86400 * 30,
        createdAt: new Date('2026-08-14T00:00:00Z'),
      },
      {
        id: 'uc_sub_2',
        telegramId: 455713813,
        configUsername: 'h_455713813_21',
        panelStatus: 'expired',
        panelDataLimit: 1 * 1024 ** 3,
        panelExpire: Math.floor(Date.now() / 1000) - 86400,
        createdAt: new Date('2026-08-11T00:00:00Z'),
      },
    ]);

    const getRemoteConfigDetail = vi.fn().mockResolvedValue({
      status: 'disabled',
      data_limit: 30 * 1024 ** 3,
      used_traffic: 0,
      expire: Math.floor(Date.now() / 1000) + 86400 * 30,
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:subscriptions:455713813:1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        configService: { listConfigsForOwner, getRemoteConfigDetail },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    // Verify clean inline code formatting without backslashes
    expect(renderedText).toContain('`h_455713813_29`');
    expect(renderedText).toContain('`h_455713813_21`');
    expect(renderedText).not.toContain('h\\_455713813\\_29');
    expect(renderedText).not.toContain('h\\_455713813\\_21');

    // Verify keyboard has management buttons for each service
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );

    expect(callbacks).toContain('config:view:uc_sub_1');
    expect(callbacks).toContain('config:view:uc_sub_2');
    expect(callbacks).toContain('admin:user:view:455713813');
  });

  it('allows admin to view and manage a user subscription with all action options', async () => {
    const config = {
      id: 'uc_sub_1',
      telegramId: 455713813,
      configUsername: 'h_455713813_29',
      subUrl: 'https://example.com/sub/h_455713813_29',
      panelStatus: 'active',
      panelDataLimit: 30 * 1024 ** 3,
      panelExpire: Math.floor(Date.now() / 1000) + 86400 * 30,
      autoRenewEnabled: false,
      createdAt: new Date('2026-08-14T00:00:00Z'),
    };

    const getConfigById = vi.fn().mockResolvedValue(config);
    const getRemoteConfigDetail = vi.fn().mockResolvedValue({
      status: 'active',
      data_limit: 30 * 1024 ** 3,
      used_traffic: 5 * 1024 ** 3,
      expire: Math.floor(Date.now() / 1000) + 86400 * 30,
      subscription_url: 'https://example.com/sub/h_455713813_29',
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerSubscriptionRoutes);
    const route = matchRoute(routes, 'config:view:uc_sub_1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      session: {},
      services: {
        isAdmin: vi.fn((id: number) => id === 1),
        translationService: translationServiceStub(),
        configService: { getConfigById, getRemoteConfigDetail },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(getConfigById).toHaveBeenCalledWith('uc_sub_1');
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    // Header has clean inline code formatting
    expect(renderedText).toContain('📱 *سرویس · `h_455713813_29`*');
    expect(renderedText).not.toContain('📱 *سرویس · `h\\_455713813\\_29`*');

    // All action options present
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );

    expect(callbacks).toContain('renew:open:uc_sub_1');
    expect(callbacks).toContain('config:qr:uc_sub_1');
    expect(callbacks).toContain('config:refresh:uc_sub_1');
    expect(callbacks).toContain('autorenew:on:uc_sub_1');
    expect(callbacks).toContain('config:set:off:uc_sub_1');
    expect(callbacks).toContain('config:revoke_prompt:uc_sub_1');
    expect(callbacks).toContain('config:transfer:uc_sub_1');
    expect(callbacks).toContain('config:delete_prompt:uc_sub_1');
    // Back returns to admin user subscriptions
    expect(callbacks).toContain('admin:user:subscriptions:455713813:1');
  });
});
