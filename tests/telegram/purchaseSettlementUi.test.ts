import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerPurchaseRoutes } from '../../src/telegram/features/purchaseRoutes.js';
import type { BotServices, MenuContext } from '../../src/telegram/types.js';

vi.mock('../../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

type Handler = (ctx: MenuContext & { match: RegExpMatchArray }) => Promise<void>;

function confirmationHandler(services: BotServices): Handler {
  let handler: Handler | undefined;
  const bot = {
    callbackQuery(trigger: string | RegExp, candidate: Handler) {
      if (trigger instanceof RegExp && 'buy:confirm:co_abcdefgh'.match(trigger)) {
        handler = candidate;
      }
      return this;
    },
  };
  registerPurchaseRoutes(bot as unknown as Bot<MenuContext>, services);
  if (!handler) throw new Error('Purchase confirmation route was not registered');
  return handler;
}

function services(overrides: {
  executePurchaseSaga: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
}): BotServices {
  return {
    translationService: {
      get: vi.fn((key: string) => key),
      resolveLocale: vi.fn(() => 'en'),
    },
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
      executePurchaseSaga: overrides.executePurchaseSaga,
    },
    configService: { generateConfigName: vi.fn().mockResolvedValue('customer_42') },
  } as unknown as BotServices;
}

describe('purchase settlement UI boundary', () => {
  it('never reports financial failure after the wallet saga has committed', async () => {
    const executePurchaseSaga = vi.fn().mockResolvedValue({
      success: true,
      configUsername: 'customer_42',
      subUrl: 'https://sub.example.test/customer_42',
    });
    const complete = vi.fn().mockRejectedValue(new Error('transient checkout status error'));
    const fail = vi.fn();
    const botServices = services({ executePurchaseSaga, complete, fail });
    const handler = confirmationHandler(botServices);
    const editMessageText = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Telegram edit unavailable'));
    const reply = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 88 })
      .mockResolvedValueOnce({ message_id: 89 });
    const match = 'buy:confirm:co_abcdefgh'.match(/^buy:confirm:(co_[A-Za-z0-9_-]{8,32})$/u)!;
    const ctx = {
      match,
      from: { id: 42, is_bot: false, first_name: 'Test' },
      callbackQuery: { message: { message_id: 77 } },
      session: {},
      services: botServices,
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText,
      reply,
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await handler(ctx);

    expect(executePurchaseSaga).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith('co_abcdefgh');
    expect(fail).not.toHaveBeenCalled();
    expect(String(reply.mock.calls[0]?.[0])).toContain('purchase_success_title');
    expect(String(reply.mock.calls[0]?.[0])).not.toContain('purchase_failed_title');
    expect(ctx.session.artifactMessageIds).toContain(88);
  });

  it('records and renders failure only when the wallet saga itself fails', async () => {
    const executePurchaseSaga = vi.fn().mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
    const complete = vi.fn();
    const fail = vi.fn().mockResolvedValue(undefined);
    const botServices = services({ executePurchaseSaga, complete, fail });
    const handler = confirmationHandler(botServices);
    const editMessageText = vi.fn().mockResolvedValue(true);
    const match = 'buy:confirm:co_abcdefgh'.match(/^buy:confirm:(co_[A-Za-z0-9_-]{8,32})$/u)!;
    const ctx = {
      match,
      from: { id: 42, is_bot: false, first_name: 'Test' },
      callbackQuery: { message: { message_id: 77 } },
      session: {},
      services: botServices,
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText,
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await handler(ctx);

    expect(fail).toHaveBeenCalledWith('co_abcdefgh');
    expect(complete).not.toHaveBeenCalled();
    expect(String(editMessageText.mock.calls.at(-1)?.[0])).toContain('purchase_failed_title');
  });
});
