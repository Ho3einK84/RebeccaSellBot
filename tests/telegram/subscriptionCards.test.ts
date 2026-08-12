import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/keyboards/mainMenu.js';
import {
  buildRenewalSelectionKeyboard,
  registerSubscriptionRoutes,
  showUserSubscriptions,
} from '../../src/telegram/features/subscriptions/routes.js';
import type { MenuContext } from '../../src/telegram/types.js';

function context(): MenuContext {
  return {
    userLocale: 'en',
    services: {
      translationService: {
        get: vi.fn((key: string) => key),
      },
    },
  } as unknown as MenuContext;
}

describe('subscription card actions', () => {
  it('hides custom renewal while keeping packages and detail navigation when disabled', () => {
    const ctx = {
      ...context(),
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((key: string, fallback = '') =>
            key === 'custom_volume_enabled' ? 'false' : fallback
          ),
          getSettingNum: vi.fn(() => 5_000),
        },
        pricingService: {
          getPackages: vi.fn(() => [
            { id: 'basic', name: 'Basic', price: 100_000, gbAmount: 20, durationDays: 30 },
          ]),
        },
      },
    } as unknown as MenuContext;

    const callbacks = buildRenewalSelectionKeyboard(ctx, 'uc_alice_123')
      .inline_keyboard.flat()
      .map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('renew:package:uc_alice_123:0');
    expect(callbacks).toContain('config:view:uc_alice_123');
    expect(callbacks).not.toContain('renew:custom:uc_alice_123');
  });

  it('shows custom renewal by default for backwards compatibility', () => {
    const ctx = {
      ...context(),
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((_key: string, fallback = '') => fallback),
          getSettingNum: vi.fn(() => 5_000),
        },
        pricingService: { getPackages: vi.fn(() => []) },
      },
    } as unknown as MenuContext;

    const callbacks = buildRenewalSelectionKeyboard(ctx, 'uc_alice_123')
      .inline_keyboard.flat()
      .map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('renew:custom:uc_alice_123');
  });

  it('keeps navigation out of every subscription card', () => {
    const keyboard = buildSubscriptionActionKeyboard(
      context(),
      'uc_alice_123',
      'active',
      false,
      true
    );
    const callbacks = keyboard.inline_keyboard
      .flat()
      .map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('renew:open:uc_alice_123');
    expect(callbacks).toContain('config:toggle:uc_alice_123');
    expect(callbacks).toContain('config:revoke_prompt:uc_alice_123');
    expect(callbacks).toContain('config:delete_prompt:uc_alice_123');
    expect(callbacks).toContain('autorenew:on:uc_alice_123');
    expect(callbacks.every((data) => data === undefined || Buffer.byteLength(data) <= 64)).toBe(
      true
    );
  });

  it('renders a compact disable callback when auto-renew is enabled', () => {
    const keyboard = buildSubscriptionActionKeyboard(
      context(),
      'uc_alice_123',
      'active',
      true,
      true
    );
    const callbacks = keyboard.inline_keyboard
      .flat()
      .map((button) => (button as { callback_data?: string }).callback_data);

    expect(callbacks).toContain('autorenew:off:uc_alice_123');
    expect(callbacks.every((data) => data === undefined || Buffer.byteLength(data) <= 64)).toBe(
      true
    );
  });

  it('renders one paginated service screen with selector and back navigation', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const configs = ['one', 'two'].map((suffix) => ({
      id: `uc_${suffix}_123`,
      telegramId: 42,
      configUsername: `config_${suffix}`,
      subUrl: `https://example.test/${suffix}`,
      panelStatus: 'active',
      panelDataLimit: 10 * 1024 ** 3,
      panelExpire: Math.floor(Date.now() / 1000) + 86_400,
      autoRenewEnabled: true,
      autoRenewPackageId: 'pkg_30gb_30d',
      lastSyncedAt: new Date(),
      createdAt: new Date(),
    }));
    const ctx = {
      ...context(),
      from: { id: 42, is_bot: false, first_name: 'Test' },
      reply,
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        configService: { listConfigsForOwner: vi.fn().mockResolvedValue(configs) },
        pricingService: {
          getPackages: vi
            .fn()
            .mockReturnValue([
              { id: 'pkg_30gb_30d', name: '30 GB', price: 120_000, gbAmount: 30, durationDays: 30 },
            ]),
          getPackageById: vi.fn().mockReturnValue({
            id: 'pkg_30gb_30d',
            name: '30 GB',
            price: 120_000,
            gbAmount: 30,
            durationDays: 30,
          }),
        },
        rebeccaService: {
          getUser: vi.fn(async (username: string) => ({
            username,
            status: 'active',
            data_limit: 10 * 1024 ** 3,
            used_traffic: 0,
            expire: Math.floor(Date.now() / 1000) + 86_400,
            subscription_url: `https://example.test/${username}`,
            created_at: new Date().toISOString(),
            online_at: null,
          })),
        },
      },
    } as unknown as MenuContext;

    await showUserSubscriptions(ctx);

    expect(reply).toHaveBeenCalledTimes(1);
    const text = reply.mock.calls[0]?.[0] as string;
    const keyboard = (
      reply.mock.calls[0]?.[1] as { reply_markup: { inline_keyboard: unknown[][] } }
    ).reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (button) => button.callback_data
    );
    expect(text.replace(/\\_/g, '_')).toContain('config_one');
    expect(text.replace(/\\_/g, '_')).toContain('config_two');
    expect(callbacks).toContain('config:view:uc_one_123');
    expect(callbacks).toContain('config:view:uc_two_123');
    expect(callbacks).toContain('nav:main');
  });

  it('re-renders user subscriptions when config:refresh is triggered', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const configs = [
      {
        id: 'uc_refresh_123',
        telegramId: 42,
        configUsername: 'config_refresh',
        subUrl: 'https://example.test/refresh',
        panelStatus: 'active',
        panelDataLimit: 10 * 1024 ** 3,
        panelExpire: Math.floor(Date.now() / 1000) + 86_400,
        lastSyncedAt: new Date(),
        createdAt: new Date(),
      },
    ];
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const ctx = {
      ...context(),
      from: { id: 42, is_bot: false, first_name: 'Test' },
      match: ['', 'uc_refresh_123'],
      answerCallbackQuery,
      reply,
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue(configs[0]),
          listConfigsForOwner: vi.fn().mockResolvedValue(configs),
        },
        rebeccaService: {
          getUser: vi.fn(async (username: string) => ({
            username,
            status: 'active',
            data_limit: 10 * 1024 ** 3,
            used_traffic: 0,
            expire: Math.floor(Date.now() / 1000) + 86_400,
            subscription_url: `https://example.test/${username}`,
            created_at: new Date().toISOString(),
            online_at: null,
          })),
        },
      },
    } as unknown as MenuContext;

    await showUserSubscriptions(ctx);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(answerCallbackQuery).not.toHaveBeenCalled();
  });

  it('edits the existing service screen when pagination is invoked from a callback', async () => {
    const editMessageText = vi.fn().mockResolvedValue(true);
    const ctx = {
      ...context(),
      from: { id: 42, is_bot: false, first_name: 'Test' },
      callbackQuery: { message: { message_id: 1 } },
      editMessageText,
      reply: vi.fn(),
      services: {
        translationService: { get: vi.fn((key: string) => key) },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([
            {
              id: 'uc_edit_123',
              telegramId: 42,
              configUsername: 'config_edit',
              panelStatus: 'active',
              panelDataLimit: 10 * 1024 ** 3,
              panelExpire: Math.floor(Date.now() / 1000) + 86_400,
              createdAt: new Date(),
            },
          ]),
        },
        pricingService: { getPackageById: vi.fn() },
      },
    } as unknown as MenuContext;

    await showUserSubscriptions(ctx);

    expect(editMessageText).toHaveBeenCalledWith(
      expect.stringMatching(/config[\\_]+edit/),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('shows package selection keyboard when enabling auto-renew regardless of existing package ID', async () => {
    const listeners: Record<string, (ctx: unknown) => Promise<void>> = {};
    const fakeBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: (ctx: unknown) => Promise<void>) => {
        const key = pattern instanceof RegExp ? pattern.source : String(pattern);
        listeners[key] = handler;
      }),
    };
    registerSubscriptionRoutes(fakeBot as unknown as Bot<MenuContext>);

    const autoRenewHandler = Object.entries(listeners).find(([key]) =>
      key.includes('autorenew:(on|off)')
    )?.[1];
    expect(autoRenewHandler).toBeDefined();

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const config = {
      id: 'uc_alice_123',
      telegramId: 42,
      configUsername: 'alice',
      autoRenewEnabled: false,
      autoRenewPackageId: 'existing_pkg_id',
    };
    const ctx = {
      ...context(),
      match: ['autorenew:on:uc_alice_123', 'on', 'uc_alice_123'],
      from: { id: 42 },
      reply,
      answerCallbackQuery,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((_key: string, fallback = '') => fallback),
          getSettingNum: vi.fn((_key: string, fallback = 0) => fallback),
          resolveLocale: vi.fn(() => 'fa'),
        },
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue(config),
          setAutoRenew: vi.fn().mockResolvedValue(true),
        },
        pricingService: {
          getPackages: vi.fn(() => [
            { id: 'pkg_30gb', name: '30 GB', price: 100_000, gbAmount: 30, durationDays: 30 },
          ]),
        },
      },
    };

    await autoRenewHandler!(ctx);

    expect(ctx.services.configService.setAutoRenew).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('auto_renew_selection_title'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
    const callbacks = (
      (
        reply.mock.calls[0]?.[1] as { reply_markup: { inline_keyboard: unknown[][] } }
      ).reply_markup.inline_keyboard.flat() as Array<{ callback_data?: string }>
    ).map((button) => button.callback_data);
    expect(callbacks).toContain('autorenew:pkg:uc_alice_123:0');
    expect(callbacks).toContain('config:view:uc_alice_123');
  });

  it('does not save auto-renew until the selected package is explicitly confirmed', async () => {
    const listeners: Record<string, (ctx: unknown) => Promise<void>> = {};
    const fakeBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: (ctx: unknown) => Promise<void>) => {
        const key = pattern instanceof RegExp ? pattern.source : String(pattern);
        listeners[key] = handler;
      }),
    };
    registerSubscriptionRoutes(fakeBot as unknown as Bot<MenuContext>);

    const packageHandler = Object.entries(listeners).find(([key]) =>
      key.includes('autorenew:pkg:')
    )?.[1];
    const confirmHandler = Object.entries(listeners).find(([key]) =>
      key.includes('autorenew:confirm:')
    )?.[1];
    expect(packageHandler).toBeDefined();
    expect(confirmHandler).toBeDefined();

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const setAutoRenew = vi.fn().mockResolvedValue(true);
    const config = {
      id: 'uc_confirm_456',
      telegramId: 42,
      configUsername: 'alice',
      panelId: 'main',
      serviceId: 1,
    };
    const ctx = {
      ...context(),
      match: ['autorenew:pkg:uc_confirm_456:0', 'uc_confirm_456', '0'],
      from: { id: 42 },
      session: {},
      reply,
      answerCallbackQuery,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
        },
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue(config),
          setAutoRenew,
        },
        pricingService: {
          getPackages: vi.fn(() => [
            { id: 'pkg_30gb', name: '30 GB', price: 100_000, gbAmount: 30, durationDays: 30 },
          ]),
        },
      },
    };

    await packageHandler!(ctx);

    expect(setAutoRenew).not.toHaveBeenCalled();
    expect(ctx.session).toMatchObject({
      pendingAutoRenew: { configId: config.id, packageId: 'pkg_30gb', price: 100_000 },
    });
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('auto_renew_review_title'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );

    ctx.match = ['autorenew:confirm:uc_confirm_456', 'uc_confirm_456'];
    await confirmHandler!(ctx);

    expect(setAutoRenew).toHaveBeenCalledWith(42, config.id, true, 'pkg_30gb', 100_000);
  });

  it('handles config:view by rendering the subscription card', async () => {
    const listeners: Record<string, (ctx: unknown) => Promise<void>> = {};
    const fakeBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: (ctx: unknown) => Promise<void>) => {
        const key = pattern instanceof RegExp ? pattern.source : String(pattern);
        listeners[key] = handler;
      }),
    };
    registerSubscriptionRoutes(fakeBot as unknown as Bot<MenuContext>);

    const viewHandler = Object.entries(listeners).find(([key]) =>
      key.includes('config:view:')
    )?.[1];
    expect(viewHandler).toBeDefined();

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const config = {
      id: 'uc_alice_123',
      telegramId: 42,
      configUsername: 'alice',
      subUrl: 'https://example.test/alice',
      panelStatus: 'active',
      panelDataLimit: 10 * 1024 ** 3,
      panelExpire: Math.floor(Date.now() / 1000) + 86_400,
      autoRenewEnabled: true,
      autoRenewPackageId: 'pkg_30gb',
      createdAt: new Date(),
    };
    const ctx = {
      ...context(),
      match: ['config:view:uc_alice_123', 'uc_alice_123'],
      from: { id: 42 },
      reply,
      answerCallbackQuery,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSettingNum: vi.fn(() => 5000),
          resolveLocale: vi.fn(() => 'fa'),
        },
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue(config),
          listConfigsForOwner: vi.fn().mockResolvedValue([config]),
        },
        pricingService: {
          getPackages: vi.fn(() => [
            { id: 'pkg_30gb', name: '30 GB', price: 100_000, gbAmount: 30, durationDays: 30 },
          ]),
          getPackageById: vi.fn(() => ({
            id: 'pkg_30gb',
            name: '30 GB',
            price: 100_000,
            gbAmount: 30,
            durationDays: 30,
          })),
        },
        rebeccaService: {
          getUser: vi.fn().mockResolvedValue({
            username: 'alice',
            status: 'active',
            data_limit: 10 * 1024 ** 3,
            used_traffic: 0,
            expire: Math.floor(Date.now() / 1000) + 86_400,
          }),
        },
      },
    };

    await viewHandler!(ctx);

    expect(answerCallbackQuery).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  it('handles config:qr by replying with a single photo popover and dismiss keyboard', async () => {
    const listeners: Record<string, (ctx: unknown) => Promise<void>> = {};
    const fakeBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: (ctx: unknown) => Promise<void>) => {
        const key = pattern instanceof RegExp ? pattern.source : String(pattern);
        listeners[key] = handler;
      }),
    };

    registerSubscriptionRoutes(fakeBot as never);
    const qrHandlerKey = Object.keys(listeners).find((key) => key.includes('config:qr:'));
    expect(qrHandlerKey).toBeDefined();

    const qrHandler = listeners[qrHandlerKey!];
    const replyWithPhoto = vi.fn().mockResolvedValue({ message_id: 100 });
    const reply = vi.fn();
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const config = {
      id: 'cfg_qr_1',
      telegramId: 42,
      configUsername: 'qr_user',
      subUrl: 'https://example.com/sub/qr_user',
    };
    const session: Record<string, unknown> = {};

    const ctx = {
      match: ['config:qr:cfg_qr_1', 'cfg_qr_1'],
      session,
      callbackQuery: { message: { message_id: 50 } },
      from: { id: 42 },
      replyWithPhoto,
      reply,
      answerCallbackQuery,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue(config),
          getRemoteConfigDetail: vi
            .fn()
            .mockResolvedValue({ subscription_url: 'https://example.com/sub/qr_user' }),
        },
      },
    };

    await qrHandler!(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: 'subscription_qr_generating' });
    expect(replyWithPhoto).toHaveBeenCalledTimes(1);
    expect(replyWithPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: expect.objectContaining({
          inline_keyboard: [[expect.objectContaining({ callback_data: 'ui:dismiss' })]],
        }),
      })
    );
    expect(reply).not.toHaveBeenCalled();
    expect(session.artifactMessageIds as number[]).not.toContain(50);
    expect(session.artifactMessageIds as number[]).toContain(100);
  });
});
