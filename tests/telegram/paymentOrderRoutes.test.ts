import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { registerPaymentOrderRoutes } from '../../src/telegram/features/paymentOrderRoutes.js';
import {
  renderForAppGuideScreen,
  renderForAppSettingsScreen,
} from '../../src/telegram/admin/adminPaymentGatewayRoutes.js';
import type { BotServices, MenuContext, SessionData } from '../../src/telegram/types.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';

function createFakeBotHarness() {
  const handlers: Array<{ pattern: RegExp; fn: (ctx: MenuContext) => Promise<void> }> = [];
  const bot = {
    callbackQuery: vi.fn((pattern: RegExp, fn: (ctx: MenuContext) => Promise<void>) => {
      handlers.push({ pattern, fn });
    }),
  } as unknown as Bot<MenuContext>;

  const dispatch = async (data: string, ctx: MenuContext) => {
    for (const h of handlers) {
      const match = h.pattern.exec(data);
      if (match) {
        (ctx as unknown as { match: RegExpExecArray }).match = match;
        await h.fn(ctx);
        return true;
      }
    }
    return false;
  };

  return { bot, dispatch };
}

function createCallbackContext(
  services: BotServices,
  overrides: { messageId?: number; session?: SessionData } = {}
) {
  const messageId = overrides.messageId ?? 701;
  const session: SessionData = overrides.session ?? { artifactMessageIds: [messageId] };
  const api = {
    deleteMessage: vi.fn(async () => true),
  };
  const ctx = {
    from: { id: 55555, language_code: 'fa' },
    chat: { id: 55555, type: 'private' },
    callbackQuery: {
      id: 'cb_1',
      message: { message_id: messageId },
    },
    api,
    session,
    services,
    userLocale: 'fa' as const,
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    editMessageText: vi.fn(async () => ({ message_id: messageId })),
    reply: vi.fn(async () => ({ message_id: messageId + 1 })),
    conversation: {
      enter: vi.fn(async () => {}),
    },
  } as unknown as MenuContext;

  return { ctx, api, session };
}

describe('Telegram paymentOrderRoutes UX lifecycle', () => {
  it('deletes the unpaid invoice message on cancel and clears artifact tracking', async () => {
    const { bot, dispatch } = createFakeBotHarness();
    const automatedPaymentService = {
      cancelOrderForUser: vi.fn(async () => ({
        id: 'po_123_abcd',
        telegramId: 55555,
        status: 'cancelled',
      })),
      getOrderByIdForUser: vi.fn(),
      checkOrderStatusForUser: vi.fn(),
    };
    const services = {
      translationService: new TranslationService(),
      automatedPaymentService,
    } as unknown as BotServices;

    registerPaymentOrderRoutes(bot, services);
    const { ctx, api, session } = createCallbackContext(services, {
      messageId: 810,
      session: { artifactMessageIds: [810] },
    });

    await dispatch('porder:cancel:po_123_abcd', ctx);

    expect(api.deleteMessage).toHaveBeenCalledWith(55555, 810);
    expect(session.artifactMessageIds).toEqual([]);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(session.uiMessageIds).toContain(811);
  });

  it('preserves completed invoice artifact on cancel or check and strips stale buttons', async () => {
    const { bot, dispatch } = createFakeBotHarness();
    const automatedPaymentService = {
      cancelOrderForUser: vi.fn(async () => null),
      getOrderByIdForUser: vi.fn(async () => ({
        id: 'po_done_1',
        telegramId: 55555,
        status: 'completed',
      })),
      checkOrderStatusForUser: vi.fn(async () => ({
        order: {
          id: 'po_done_1',
          telegramId: 55555,
          provider: 'forapp_card',
          status: 'completed',
          payableAmount: 50_000,
          creditedAmount: 50_000,
          cashbackAmount: 0,
        },
        newlyCompleted: false,
        balanceAfter: 100_000,
      })),
    };
    const services = {
      translationService: new TranslationService(),
      automatedPaymentService,
    } as unknown as BotServices;

    registerPaymentOrderRoutes(bot, services);

    // Attempt to cancel a completed order must NEVER delete the message
    const cancelCase = createCallbackContext(services, {
      messageId: 901,
      session: { artifactMessageIds: [901] },
    });
    await dispatch('porder:cancel:po_done_1', cancelCase.ctx);
    expect(cancelCase.api.deleteMessage).not.toHaveBeenCalled();
    expect(cancelCase.ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
    expect(cancelCase.session.artifactMessageIds).toContain(901);

    // Check status on completed order keeps invoice message and remembers completion receipt artifact
    const checkCase = createCallbackContext(services, {
      messageId: 902,
      session: { artifactMessageIds: [902] },
    });
    await dispatch('porder:check:po_done_1', checkCase.ctx);
    expect(checkCase.api.deleteMessage).not.toHaveBeenCalled();
    expect(checkCase.ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
    expect(checkCase.session.artifactMessageIds).toContain(902);
    expect(checkCase.session.artifactMessageIds).toContain(903);
  });

  it('removes pending ForApp invoice when transitioning to manual receipt fallback', async () => {
    const { bot, dispatch } = createFakeBotHarness();
    const automatedPaymentService = {
      getOrderByIdForUser: vi.fn(async () => ({
        id: 'po_fa_5',
        telegramId: 55555,
        provider: 'forapp_card',
        status: 'pending',
        payableAmount: 49_178,
        cardId: 'card_1',
        cardNumber: '6037698111306846',
        cardHolder: 'Hossein Karimi',
        bankName: 'بانک صادرات',
      })),
    };
    const services = {
      translationService: new TranslationService(),
      automatedPaymentService,
    } as unknown as BotServices;

    registerPaymentOrderRoutes(bot, services);
    const { ctx, api, session } = createCallbackContext(services, {
      messageId: 950,
      session: { artifactMessageIds: [950] },
    });

    await dispatch('porder:manual:po_fa_5', ctx);

    expect(api.deleteMessage).toHaveBeenCalledWith(55555, 950);
    expect(session.artifactMessageIds).toEqual([]);
    expect(session.manualFallbackOrder).toMatchObject({
      orderId: 'po_fa_5',
      amount: 49_178,
    });
    expect(ctx.conversation.enter).toHaveBeenCalledWith('topupConversation');
  });

  it('renders ForApp admin settings and setup guide with explanation and official GitHub link', async () => {
    const automatedPaymentService = {
      getForAppAdminConfig: vi.fn(async () => ({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyMasked: 'abcd••••1234',
        orderExpiryMinutes: 20,
        webhookUrl: 'https://rs.netiva.ir/api/webhooks/forapp',
        unmatchedCount: 0,
      })),
    };
    const services = {
      translationService: new TranslationService(),
      automatedPaymentService,
    } as unknown as BotServices;

    const settingsCase = createCallbackContext(services, { messageId: 960, session: {} });
    await renderForAppSettingsScreen(settingsCase.ctx);
    const settingsCall = (settingsCase.ctx.editMessageText as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(settingsCall?.[0]).toContain('ForApp');
    expect(settingsCall?.[0]).toContain('Webhook');
    const settingsButtons = settingsCall?.[1]?.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(
      settingsButtons.some((b: { callback_data?: string }) => b.callback_data === 'adm:pg:fa:guide')
    ).toBe(true);
    expect(
      settingsButtons.some((b: { url?: string }) => b.url === 'https://github.com/erfjab/forapp')
    ).toBe(true);

    const guideCase = createCallbackContext(services, { messageId: 961, session: {} });
    await renderForAppGuideScreen(guideCase.ctx);
    const guideCall = (guideCase.ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(guideCall?.[0]).toContain('erfjab/forapp');
    expect(guideCall?.[0]).toContain('https://rs.netiva.ir/api/webhooks/forapp');
    const guideButtons = guideCall?.[1]?.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(
      guideButtons.some((b: { url?: string }) => b.url === 'https://github.com/erfjab/forapp')
    ).toBe(true);
  });

  it('shows delayed manual-receipt guidance on porder:check once 5 minutes have elapsed', async () => {
    const { bot, dispatch } = createFakeBotHarness();
    const checkOrderStatusForUser = vi
      .fn()
      .mockResolvedValueOnce({
        order: {
          id: 'po_fa_fresh',
          telegramId: 55555,
          provider: 'forapp_card',
          status: 'pending',
          payableAmount: 49_104,
          cashbackAmount: 0,
          createdAt: new Date(Date.now() - 60_000),
        },
        newlyCompleted: false,
      })
      .mockResolvedValueOnce({
        order: {
          id: 'po_fa_delayed',
          telegramId: 55555,
          provider: 'forapp_card',
          status: 'pending',
          payableAmount: 49_104,
          cashbackAmount: 0,
          createdAt: new Date(Date.now() - 6 * 60_000),
        },
        newlyCompleted: false,
      });
    const services = {
      translationService: new TranslationService(),
      automatedPaymentService: { checkOrderStatusForUser },
    } as unknown as BotServices;

    registerPaymentOrderRoutes(bot, services);

    const freshCase = createCallbackContext(services, { messageId: 970, session: {} });
    await dispatch('porder:check:po_fa_fresh', freshCase.ctx);
    expect(freshCase.ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('هنوز واریزی ثبت نشده است'),
        show_alert: true,
      })
    );

    const delayedCase = createCallbackContext(services, { messageId: 971, session: {} });
    await dispatch('porder:check:po_fa_delayed', delayedCase.ctx);
    expect(delayedCase.ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('ارسال دستی فیش'),
        show_alert: true,
      })
    );
  });
});
