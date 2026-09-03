import { describe, expect, it, vi } from 'vitest';
import { renewConfigConversation } from '../../src/telegram/conversations/userConversations.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';

describe('Admin renewal and wallet charging', () => {
  it('allows admin to renew a config owned by another user and charges the target user', async () => {
    const adminTelegramId = 999999;
    const userTelegramId = 123456;
    const configId = 'cfg_target_user';

    const config = {
      id: configId,
      telegramId: userTelegramId,
      configUsername: 'user_config_1',
      panelId: 'rp_1',
      serviceId: 1,
    };

    const getConfigById = vi.fn().mockResolvedValue(config);
    const getOwnedConfigById = vi.fn().mockResolvedValue(null);
    const getBalance = vi.fn().mockResolvedValue(100_000);
    const createCheckout = vi.fn().mockResolvedValue({
      id: 'co_test_1',
      telegramId: userTelegramId,
      amount: 25_000,
      quotedAmount: 25_000,
    });
    const claimCheckout = vi.fn().mockResolvedValue({
      id: 'co_test_1',
      telegramId: userTelegramId,
      amount: 25_000,
      quotedAmount: 25_000,
    });
    const executePurchaseSaga = vi.fn().mockResolvedValue({
      configUsername: 'user_config_1',
      subUrl: 'https://test/sub',
    });

    const services = {
      isAdmin: vi.fn((id: number) => id === adminTelegramId),
      configService: { getConfigById, getOwnedConfigById },
      pricingService: {
        getCustomPriceQuote: vi.fn(() => ({
          totalPrice: 25_000,
          pricePerGb: 5_000,
        })),
      },
      walletService: {
        getBalance,
        executePurchaseSaga,
      },
      purchaseCheckoutService: {
        create: createCheckout,
        claim: claimCheckout,
      },
      translationService: {
        get: vi.fn((k: string) => k),
        getSetting: vi.fn((_k: string, def: string) => def),
        getSettingNum: vi.fn((_k: string, def: number) => def),
        getSettingBool: vi.fn((_k: string, def: boolean) => def),
        getDefaultLocale: vi.fn(() => 'fa'),
        resolveLocale: vi.fn(() => 'fa'),
      },
    };

    const conversation = {
      external: vi.fn(async (fn: (ctx: unknown) => unknown) => {
        const outsideCtx = {
          from: { id: adminTelegramId },
          session: { renewConfigId: configId },
          services,
        };
        return fn(outsideCtx);
      }),
      wait: vi.fn(),
      waitFor: vi.fn(),
    } as unknown as MyConversation;

    let waitCalls = 0;
    vi.mocked(conversation.wait).mockImplementation(async () => {
      waitCalls += 1;
      if (waitCalls === 1) {
        return {
          from: { id: adminTelegramId },
          message: { text: '5' },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          reply: vi.fn().mockResolvedValue({ message_id: 200 }),
          deleteMessage: vi.fn().mockResolvedValue(true),
        } as never;
      }
      return {
        from: { id: adminTelegramId },
        callbackQuery: { data: 'renew_confirm' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        reply: vi.fn().mockResolvedValue({ message_id: 201 }),
        deleteMessage: vi.fn().mockResolvedValue(true),
      } as never;
    });

    const ctx = {
      from: { id: adminTelegramId },
      chat: { id: 1111 },
      services,
      userLocale: 'fa',
      api: {
        editMessageText: vi.fn().mockResolvedValue({}),
      },
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
    } as unknown as ConversationContext;

    await renewConfigConversation(conversation, ctx);

    // Verified: Admin used getConfigById instead of getOwnedConfigById
    expect(getConfigById).toHaveBeenCalledWith(configId);
    expect(getOwnedConfigById).not.toHaveBeenCalled();

    // Verified: Balance was checked for target user, not admin
    expect(getBalance).toHaveBeenCalledWith(userTelegramId);

    // Verified: Checkout was created for target user, not admin
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: userTelegramId,
        configId,
      })
    );

    // Verified: Saga executed and charged target user's wallet
    expect(executePurchaseSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: userTelegramId,
        allowAdminOverride: true,
      })
    );
  });
});

import { autoRenewCustomConversation } from '../../src/telegram/conversations/userConversations.js';

describe('Admin auto-renew configuration', () => {
  it('allows admin to set auto renew on another user config and targets config owner', async () => {
    const adminTelegramId = 999999;
    const userTelegramId = 123456;
    const configId = 'cfg_target_user';

    const config = {
      id: configId,
      telegramId: userTelegramId,
      configUsername: 'user_config_1',
      panelId: 'rp_1',
      serviceId: 1,
    };

    const getConfigById = vi.fn().mockResolvedValue(config);
    const setAutoRenew = vi.fn().mockResolvedValue(undefined);

    const services = {
      isAdmin: vi.fn((id: number) => id === adminTelegramId),
      configService: { getConfigById, getOwnedConfigById: vi.fn(), setAutoRenew },
      pricingService: {
        getCustomPriceQuote: vi.fn(() => ({
          totalPrice: 25_000,
          pricePerGb: 5_000,
        })),
      },
      translationService: {
        get: vi.fn((k: string) => k),
        getSetting: vi.fn((_k: string, def: string) => def),
        getSettingNum: vi.fn((_k: string, def: number) => def),
        getSettingBool: vi.fn((_k: string, def: boolean) => def),
        getDefaultLocale: vi.fn(() => 'fa'),
        resolveLocale: vi.fn(() => 'fa'),
      },
    };

    const conversation = {
      external: vi.fn(async (fn: (ctx: unknown) => unknown) => {
        const outsideCtx = {
          from: { id: adminTelegramId },
          session: { pendingConfigId: configId },
          services,
        };
        return fn(outsideCtx);
      }),
      wait: vi.fn(),
      waitFor: vi.fn(),
    } as unknown as MyConversation;

    let waitCalls = 0;
    vi.mocked(conversation.wait).mockImplementation(async () => {
      waitCalls += 1;
      if (waitCalls === 1) {
        return {
          from: { id: adminTelegramId },
          message: { text: '10' },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          reply: vi.fn().mockResolvedValue({ message_id: 200 }),
          deleteMessage: vi.fn().mockResolvedValue(true),
        } as never;
      }
      return {
        from: { id: adminTelegramId },
        callbackQuery: { data: 'autorenew:custom_confirm' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        reply: vi.fn().mockResolvedValue({ message_id: 201 }),
        deleteMessage: vi.fn().mockResolvedValue(true),
      } as never;
    });

    const ctx = {
      from: { id: adminTelegramId },
      chat: { id: 1111 },
      services,
      userLocale: 'fa',
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
    } as unknown as ConversationContext;

    await autoRenewCustomConversation(conversation, ctx);

    expect(getConfigById).toHaveBeenCalledWith(configId);
    expect(setAutoRenew).toHaveBeenCalledWith(
      userTelegramId,
      configId,
      true,
      'custom_10gb_30d',
      25_000
    );
  });
});

import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import type { Bot } from 'grammy';
import type { MenuContext, BotServices } from '../../src/telegram/types.js';

describe('/start language on first visit', () => {
  it('uses admin default_locale (fa) and prompts for language selection on first visit', async () => {
    let startHandler: ((ctx: unknown) => Promise<void>) | undefined;
    const bot = {
      use: vi.fn(),
      command: vi.fn((cmd: string, handler: (ctx: unknown) => Promise<void>) => {
        if (cmd === 'start') startHandler = handler;
      }),
      callbackQuery: vi.fn(),
    } as unknown as Bot<MenuContext>;

    const exists = vi.fn().mockResolvedValue(false);
    const getOrCreateUser = vi.fn().mockResolvedValue({
      id: 1,
      telegramId: 12345,
      locale: 'fa',
      localeManual: false,
    });
    const getDefaultLocale = vi.fn(() => 'fa');
    const getSettingBool = vi.fn((key: string) => key === 'language_selection_enabled');
    const get = vi.fn((key: string) => `translated:${key}`);

    const services = {
      userService: { exists },
      walletService: { getOrCreateUser },
      translationService: {
        getDefaultLocale,
        getSettingBool,
        get,
        resolveLocale: vi.fn(() => 'fa'),
      },
      maintenanceService: { isMaintenanceMode: vi.fn(() => false) },
      authService: { isAdmin: vi.fn(() => false) },
      systemSettings: { getSetting: vi.fn() },
    } as unknown as BotServices;

    registerBaseRoutes(bot, services);

    expect(startHandler).toBeDefined();

    const reply = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      from: { id: 12345, first_name: 'NewUser', language_code: 'en' },
      chat: { id: 12345, type: 'private' },
      services,
      reply,
      userLocale: undefined,
    };

    await startHandler!(ctx);

    // Verified: User was created with defaultLocale 'fa' despite client language 'en'
    expect(getOrCreateUser).toHaveBeenCalledWith(
      12345,
      null,
      'NewUser',
      null,
      undefined,
      'fa',
      'telegram_start'
    );

    // Verified: ctx.userLocale was set to defaultLocale 'fa'
    expect(ctx.userLocale).toBe('fa');

    // Verified: Welcome screen with language keyboard was shown
    expect(reply).toHaveBeenCalledWith(
      'translated:onboarding_welcome',
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ callback_data: 'locale:fa' }),
              expect.objectContaining({ callback_data: 'locale:en' }),
            ]),
          ]),
        }),
      })
    );
  });
});
