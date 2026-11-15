import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  customAmountConversation,
  buyConfigConversation,
} from '../../src/telegram/conversations/userConversations.js';
import { registerCoreRoutes } from '../../src/telegram/features/coreRoutes.js';
import {
  formatRemainingTime,
  registerLuckyWheelRoutes,
  renderLuckyWheelScreen,
} from '../../src/telegram/features/luckyWheelRoutes.js';
import { registerPurchaseRoutes } from '../../src/telegram/features/purchaseRoutes.js';
import { resetActionCooldowns } from '../../src/telegram/middleware/actionCooldown.js';
import type { MenuContext, MyConversation } from '../../src/telegram/types.js';
import { createBotHarness, createMockServices } from './helpers/botHarness.js';
import { createConversationHarness } from './helpers/conversationHarness.js';

vi.mock('../../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

afterEach(() => {
  resetActionCooldowns();
  vi.useRealTimers();
});

describe('Purchase settlement UI boundary', () => {
  function setupPurchaseHarness(overrides: {
    executePurchaseSaga: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
  }) {
    const services = createMockServices({
      purchaseCheckoutService: {
        claim: vi.fn().mockResolvedValue({
          id: 'co_abcdefgh',
          telegramId: 42,
          kind: 'new_config',
          packageId: 'pkg_basic',
          packageName: 'Basic',
          panelId: 'main',
          serviceId: 1,
          amount: 100_000,
          quotedAmount: 100_000,
          gbAmount: 20,
          durationDays: 30,
          promoCode: null,
        }),
        complete: overrides.complete,
        fail: overrides.fail,
      },
      walletService: {
        getBalance: vi.fn().mockResolvedValue(100_000),
        getAvailableBalance: vi.fn().mockResolvedValue(100_000),
        executePurchaseSaga: overrides.executePurchaseSaga,
      },
      configService: { generateConfigName: vi.fn().mockResolvedValue('customer_42') },
    });

    const harness = createBotHarness({ services, defaultLocale: 'en' });
    registerPurchaseRoutes(harness.bot, harness.services);
    return { harness, services };
  }

  it('never reports financial failure after wallet saga commits and recovers when Telegram edit is unavailable', async () => {
    const executePurchaseSaga = vi.fn().mockResolvedValue({
      success: true,
      configUsername: 'customer_42',
      subUrl: 'https://sub.example.test/customer_42',
    });
    const complete = vi.fn().mockRejectedValue(new Error('transient checkout status error'));
    const fail = vi.fn();

    const { harness } = setupPurchaseHarness({ executePurchaseSaga, complete, fail });

    // First edit ("operation_in_progress") succeeds; final artifact edit hits real Telegram "message to edit not found"
    harness.pushApiError({
      method: 'editMessageText',
      description: 'Bad Request: message to edit not found',
      match: (payload) => String(payload.text).includes('purchase_success_title'),
    });

    await harness.sendCallback('buy:confirm:co_abcdefgh', { userId: 42, messageId: 77 });

    expect(executePurchaseSaga).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith('co_abcdefgh');
    expect(fail).not.toHaveBeenCalled();

    const sent = harness.callsFor('sendMessage');
    expect(String(sent[0]?.payload.text)).toContain('purchase_success_title');
    expect(String(sent[0]?.payload.text)).not.toContain('purchase_failed_title');
    expect(harness.getSession(42)?.artifactMessageIds).toContain(101);
  });

  it('records and renders failure only when wallet saga itself rejects', async () => {
    const executePurchaseSaga = vi.fn().mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
    const complete = vi.fn();
    const fail = vi.fn().mockResolvedValue(undefined);

    const { harness } = setupPurchaseHarness({ executePurchaseSaga, complete, fail });
    await harness.sendCallback('buy:confirm:co_abcdefgh', { userId: 42, messageId: 77 });

    expect(fail).toHaveBeenCalledWith('co_abcdefgh');
    expect(complete).not.toHaveBeenCalled();
    const edits = harness.callsFor('editMessageText');
    expect(String(edits.at(-1)?.payload.text)).toContain('purchase_failed_title');
  });

  it('keeps buyConfigConversation outside-ctx balance lookup safely inside conversation.external', async () => {
    const getAvailableBalance = vi.fn().mockResolvedValue(150_000);
    const services = createMockServices({
      walletService: { getBalance: vi.fn().mockResolvedValue(150_000), getAvailableBalance },
      pricingService: {
        getPackages: vi.fn(() => [
          { id: 'pkg_1', name: 'Plan 1', price: 100_000, gbAmount: 20, durationDays: 30 },
        ]),
      },
      purchaseCheckoutService: {
        create: vi.fn().mockResolvedValue({
          id: 'co_buyconv1',
          amount: 100_000,
          quotedAmount: 100_000,
          discountAmount: 0,
        }),
      },
      packageCategoryService: { listCategories: vi.fn().mockResolvedValue([]) },
    });

    const outsideCtx = { session: {}, services, from: { id: 55 } };
    const conversation = {
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
      wait: vi
        .fn()
        .mockResolvedValueOnce({
          from: { id: 55 },
          callbackQuery: { data: 'buy:pkg:0:badtoken' },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          services,
        })
        .mockResolvedValueOnce({
          from: { id: 55 },
          callbackQuery: { data: 'conversation:cancel' },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          reply: vi.fn().mockResolvedValue({ message_id: 11 }),
          services,
        }),
    } as unknown as MyConversation;
    const ctx = {
      from: { id: 55 },
      userLocale: 'en',
      reply: vi.fn().mockResolvedValue({ message_id: 10 }),
      services,
    } as unknown as MenuContext;

    await buyConfigConversation(conversation, ctx);
    expect(conversation.external).toHaveBeenCalled();
  });
});

describe('Edit In Place Conversation Navigation', () => {
  it('edits shop menu into custom-volume prompt, cancels, and returns home without creating new messages', async () => {
    const harness = createConversationHarness({
      defaultLocale: 'fa',
      conversations: [['customAmountConversation', customAmountConversation]],
      services: createMockServices({
        pricingService: {
          getPackages: vi.fn(() => []),
          getCustomPriceQuote: vi.fn(() => ({ pricePerGb: 5000, totalPrice: 50000 })),
          getCustomVolumeTarget: vi.fn(() => ({ panelId: 'p1', serviceId: 1 })),
        },
        walletService: {
          getOrCreateUser: vi.fn().mockResolvedValue({ locale: 'fa', isBanned: false }),
          getAvailableBalance: vi.fn().mockResolvedValue(100_000),
          getBalance: vi.fn().mockResolvedValue(100_000),
        },
      }),
    });
    registerCoreRoutes(harness.bot, harness.services);

    await harness.sendText('/start', { userId: 123 });
    const startSend = harness.callsFor('sendMessage')[0]?.payload;
    const startMsgId = 101;
    const startButtons = (
      startSend?.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      }
    ).inline_keyboard.flat();
    const shopBtn = startButtons.find((b) => b.text === 'menu_buy_subscription');
    expect(shopBtn).toBeDefined();

    harness.clearCalls();
    await harness.sendCallback(shopBtn!.callback_data, { userId: 123, messageId: startMsgId });
    const shopEdit = harness.apiCalls.find(
      (c) => c.method === 'editMessageReplyMarkup' || c.method === 'editMessageText'
    );
    const shopButtons = (
      shopEdit?.payload.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      }
    ).inline_keyboard.flat();
    const customVolBtn = shopButtons.find((b) => b.text.includes('menu_custom_amount'));
    expect(customVolBtn).toBeDefined();

    harness.clearCalls();
    await harness.sendCallback(customVolBtn!.callback_data, { userId: 123, messageId: startMsgId });
    expect(harness.callsFor('editMessageText')[0]?.payload.message_id).toBe(startMsgId);
    expect(harness.callsFor('sendMessage')).toHaveLength(0);

    harness.clearCalls();
    await harness.sendCallback('conversation:cancel', { userId: 123, messageId: startMsgId });
    expect(harness.callsFor('editMessageText')[0]?.payload.message_id).toBe(startMsgId);
    expect(harness.callsFor('sendMessage')).toHaveLength(0);

    harness.clearCalls();
    await harness.sendCallback('nav:main', { userId: 123, messageId: startMsgId });
    expect(harness.callsFor('editMessageText')[0]?.payload.message_id).toBe(startMsgId);
    expect(harness.callsFor('sendMessage')).toHaveLength(0);
  });
});

describe('Lucky Wheel UI, Localization & Spin Route', () => {
  function createWheelCtx(locale: 'fa' | 'en', statusOverrides: Record<string, unknown> = {}) {
    let renderedText = '';
    let renderedOptions: {
      reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> };
    } = {};
    const ctx = {
      from: { id: 123456, language_code: locale },
      userLocale: locale,
      services: {
        luckyWheelService: {
          getStatus: vi.fn().mockResolvedValue({
            enabled: true,
            canSpin: true,
            totalSpins: 1,
            maxSpins: 3,
            minPrize: 10_000,
            maxPrize: 100_000,
            currentEffectiveLuck: 50,
            ...statusOverrides,
          }),
        },
        translationService: new TranslationService(),
      },
      editMessageText: vi.fn(async (text: string, opts: typeof renderedOptions) => {
        renderedText = text;
        renderedOptions = opts;
      }),
      reply: vi.fn(async (text: string, opts: typeof renderedOptions) => {
        renderedText = text;
        renderedOptions = opts;
        return { message_id: 100 };
      }),
      callbackQuery: { message: { message_id: 999 } },
      chat: { id: 123456 },
      answerCallbackQuery: vi.fn(),
    } as unknown as MenuContext;

    return {
      ctx,
      getRenderedText: () => renderedText,
      getRenderedOptions: () => renderedOptions,
    };
  }

  it('renders lucky wheel screen purely in English and Persian with countdowns and spin gating', async () => {
    const en = createWheelCtx('en', {
      canSpin: false,
      reason: 'cooldown_active',
      secondsRemaining: 23 * 3600 + 27 * 60,
    });
    await renderLuckyWheelScreen(en.ctx);
    expect(en.getRenderedText()).toContain('🎡 *Lucky Wheel*');
    expect(en.getRenderedText()).toContain('⏳ *Next Spin:* 23 hour(s) and 27 minute(s)');
    expect(/[\u0600-\u06ff]/u.test(en.getRenderedText())).toBe(false);

    const fa = createWheelCtx('fa', {
      canSpin: false,
      reason: 'cooldown_active',
      secondsRemaining: 23 * 3600 + 27 * 60,
    });
    await renderLuckyWheelScreen(fa.ctx);
    expect(fa.getRenderedText()).toContain('🎡 *گردونه شانس*');
    expect(fa.getRenderedText()).toContain('⏳ *چرخش بعدی:* ۲۳ ساعت و ۲۷ دقیقه');

    const single = createWheelCtx('en', { minPrize: 50_000, maxPrize: 50_000 });
    await renderLuckyWheelScreen(single.ctx);
    expect(single.getRenderedText()).toContain('🎁 *Gift Amount:* 50,000 Toman');

    const active = createWheelCtx('fa', { canSpin: true });
    await renderLuckyWheelScreen(active.ctx);
    expect(
      active
        .getRenderedOptions()
        .reply_markup?.inline_keyboard?.some((r) => r.some((b) => b.callback_data === 'wheel:spin'))
    ).toBe(true);

    const banned = createWheelCtx('fa', { canSpin: false, reason: 'user_banned' });
    await renderLuckyWheelScreen(banned.ctx);
    expect(banned.getRenderedText()).toContain('اجازهٔ انجام این کار را ندارید');
  });

  it('formats remaining time accurately across hours, minutes, rounding, and zero/negative values', () => {
    const en = createWheelCtx('en').ctx;
    const fa = createWheelCtx('fa').ctx;

    expect(formatRemainingTime(23 * 3600 + 27 * 60, en)).toBe('23 hour(s) and 27 minute(s)');
    expect(formatRemainingTime(23 * 3600 + 27 * 60, fa)).toBe('۲۳ ساعت و ۲۷ دقیقه');
    expect(formatRemainingTime(2 * 3600, en)).toBe('2 hour(s)');
    expect(formatRemainingTime(2 * 3600, fa)).toBe('۲ ساعت');
    expect(formatRemainingTime(45 * 60, en)).toBe('45 minute(s)');
    expect(formatRemainingTime(45 * 60, fa)).toBe('۴۵ دقیقه');
    expect(formatRemainingTime(40, en)).toBe('1 minute(s)');
    expect(formatRemainingTime(40, fa)).toBe('۱ دقیقه');
    expect(formatRemainingTime(0, en)).toBe('0 minute(s)');
    expect(formatRemainingTime(-10, fa)).toBe('۰ دقیقه');
  });

  it('executes wheel:spin route with slot animation and cooldown error recovery', async () => {
    vi.useFakeTimers();
    const spin = vi
      .fn()
      .mockResolvedValue({ amount: 25_000, balanceAfter: 75_000, spinsRemaining: 1 });
    const services = createMockServices({
      luckyWheelService: {
        spin,
        getStatus: vi.fn().mockResolvedValue({
          enabled: true,
          canSpin: false,
          totalSpins: 2,
          maxSpins: 3,
          minPrize: 10_000,
          maxPrize: 50_000,
          reason: 'cooldown_active',
          secondsRemaining: 600,
        }),
      },
    });
    const harness = createBotHarness({ services });
    registerLuckyWheelRoutes(harness.bot, harness.services);

    const spinPromise = harness.sendCallback('wheel:spin', { userId: 77, messageId: 120 });
    await vi.advanceTimersByTimeAsync(4_000);
    await spinPromise;

    expect(spin).toHaveBeenCalledWith(77);
    const edits = harness.callsFor('editMessageText');
    expect(String(edits.at(-1)?.payload.text)).toContain('wheel_win_title');
  });
});
