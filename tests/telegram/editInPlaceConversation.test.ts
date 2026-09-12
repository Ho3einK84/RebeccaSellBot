import { describe, expect, it, vi } from 'vitest';
import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { cleanChatUiMiddleware, uiMessageTrackingTransformer } from '../../src/telegram/ui.js';
import { customAmountConversation } from '../../src/telegram/conversations/userConversations.js';
import type { MenuContext, ConversationContext, BotServices } from '../../src/telegram/types.js';
import { registerCoreRoutes } from '../../src/telegram/features/coreRoutes.js';

describe('Edit In Place Conversation Navigation', () => {
  it('edits shop menu into conversation prompt without stacking or creating new messages', async () => {
    const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    let nextMsgId = 100;

    const customFetch = vi
      .fn()
      .mockImplementation(async (url: unknown, opts: { body?: string }) => {
        const urlStr = String(url);
        const body = opts?.body ? (JSON.parse(opts.body) as Record<string, unknown>) : {};
        const method = urlStr.split('/').pop()!;
        apiCalls.push({ method, payload: body });
        if (method === 'sendMessage') {
          const msg = { message_id: ++nextMsgId, text: body.text, chat: { id: body.chat_id } };
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: msg }),
          };
        }
        if (method === 'editMessageText') {
          const msg = { message_id: body.message_id, text: body.text, chat: { id: body.chat_id } };
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: msg }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: true }),
        };
      });

    const bot = new Bot<MenuContext>('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', {
      client: { fetch: customFetch },
    });
    bot.botInfo = {
      id: 123456,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    };

    bot.api.config.use(uiMessageTrackingTransformer());

    const sessionStore: Record<string, unknown> = {};
    bot.use(
      session({
        initial: () => sessionStore,
        getSessionKey: () => '123:123',
      })
    );

    bot.use(cleanChatUiMiddleware());

    const services = {
      adminIds: [999],
      isAdmin: vi.fn(() => false),
      translationService: {
        get: vi.fn((key: string, _params?: unknown) => key),
        resolveLocale: vi.fn(() => 'fa'),
        getSettingBool: vi.fn((_key: string, def: boolean) => def),
        getSettingNum: vi.fn((_key: string, def: number) => def),
        getSetting: vi.fn((_key: string) => '5000'),
      },
      pricingService: {
        getPackages: vi.fn(() => []),
        getCustomPriceQuote: vi.fn(() => ({ pricePerGb: 5000, totalPrice: 50000 })),
        getCustomVolumeTarget: vi.fn(() => ({ panelId: 'p1', serviceId: 's1' })),
      },
      packageCategoryService: {
        listCategories: vi.fn().mockResolvedValue([]),
      },
      userService: {
        exists: vi.fn().mockResolvedValue(true),
        getLocale: vi.fn().mockResolvedValue('fa'),
      },
      walletService: {
        getOrCreateUser: vi.fn().mockResolvedValue({ locale: 'fa', isBanned: false }),
        getAvailableBalance: vi.fn().mockResolvedValue(100000),
        getBalance: vi.fn().mockResolvedValue(100000),
      },
      configService: {
        extractSubUrl: vi.fn(() => null),
      },
      purchaseCheckoutService: {},
    } as unknown as BotServices;

    bot.use(async (ctx, next) => {
      ctx.services = services;
      ctx.userLocale = 'fa';
      return next();
    });

    bot.use(
      conversations<MenuContext, ConversationContext>({
        plugins: [
          async (ctx, next) => {
            ctx.services = services;
            ctx.userLocale = 'fa';
            await next();
          },
        ],
      })
    );

    bot.use(createConversation(customAmountConversation, 'customAmountConversation'));
    registerCoreRoutes(bot, services);

    // 1. User sends /start
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 50,
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat: { id: 123, type: 'private', first_name: 'Test' },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
      },
    });

    const startMsgCall = apiCalls.find((c) => c.method === 'sendMessage');
    const startMsgId = 101;
    const replyMarkup = startMsgCall?.payload?.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const shopBtn = replyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text === 'menu_buy_subscription');
    expect(shopBtn).toBeDefined();

    // 2. User clicks "menu_buy_subscription" (shop)
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'cb_shop',
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat_instance: 'ci1',
        message: {
          message_id: startMsgId,
          chat: { id: 123, type: 'private', first_name: 'Test' },
          date: Math.floor(Date.now() / 1000),
          text: 'Dashboard',
        },
        data: shopBtn!.callback_data,
      },
    });

    // 3. User clicks "menu_custom_amount"
    const editCall = apiCalls.find(
      (c) => c.method === 'editMessageReplyMarkup' || c.method === 'editMessageText'
    );
    const shopReplyMarkup = editCall?.payload?.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const customVolBtn = shopReplyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text.includes('menu_custom_amount'));
    expect(customVolBtn).toBeDefined();

    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'cb_custom',
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat_instance: 'ci1',
        message: {
          message_id: startMsgId,
          chat: { id: 123, type: 'private', first_name: 'Test' },
          date: Math.floor(Date.now() / 1000),
          text: 'Shop',
        },
        data: customVolBtn!.callback_data,
      },
    });

    // Verify in-place edit occurred on message 101, zero new messages created
    const customEditCall = apiCalls.find((c) => c.method === 'editMessageText');
    expect(customEditCall).toBeDefined();
    expect(customEditCall?.payload?.message_id).toBe(startMsgId);
    expect(apiCalls.filter((c) => c.method === 'sendMessage').length).toBe(0);

    // 4. User clicks "conversation:cancel" on message 101
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 4,
      callback_query: {
        id: 'cb_cancel',
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat_instance: 'ci1',
        message: {
          message_id: startMsgId,
          chat: { id: 123, type: 'private', first_name: 'Test' },
          date: Math.floor(Date.now() / 1000),
          text: 'Custom Volume Prompt',
        },
        data: 'conversation:cancel',
      },
    });

    // Verify cancellation also edits in place on message 101
    const cancelEditCall = apiCalls.find((c) => c.method === 'editMessageText');
    expect(cancelEditCall).toBeDefined();
    expect(cancelEditCall?.payload?.message_id).toBe(startMsgId);
    expect(apiCalls.filter((c) => c.method === 'sendMessage').length).toBe(0);

    // 5. User clicks "nav:main" (menu_back_main)
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 5,
      callback_query: {
        id: 'cb_back',
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat_instance: 'ci1',
        message: {
          message_id: startMsgId,
          chat: { id: 123, type: 'private', first_name: 'Test' },
          date: Math.floor(Date.now() / 1000),
          text: 'Operation Cancelled',
        },
        data: 'nav:main',
      },
    });

    // Verify returning to main menu also edits message 101 in place
    const backEditCall = apiCalls.find((c) => c.method === 'editMessageText');
    expect(backEditCall).toBeDefined();
    expect(backEditCall?.payload?.message_id).toBe(startMsgId);
    expect(apiCalls.filter((c) => c.method === 'sendMessage').length).toBe(0);
  });
});
