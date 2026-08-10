import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerReceiptAdminRoutes } from '../../src/telegram/features/admin/receiptRoutes.js';
import { registerAdminUserRoutes } from '../../src/telegram/features/admin/userRoutes.js';
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
    get: vi.fn((key: string) => key),
  };
}

describe('legacy admin callback compatibility', () => {
  it('refreshes a legacy receipt approval into confirmation without approving it', async () => {
    const approveTopup = vi.fn();
    const rejectTopup = vi.fn();
    const getPendingTopup = vi.fn().mockResolvedValue({
      id: 'receipt_1',
      telegramId: 42,
      amount: 125_000,
    });
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const route = matchRoute(
      collectRoutes(registerReceiptAdminRoutes),
      'receipt-approve:receipt_1'
    );
    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        walletService: { getPendingTopup, approveTopup, rejectTopup },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(getPendingTopup).toHaveBeenCalledWith('receipt_1');
    expect(approveTopup).not.toHaveBeenCalled();
    expect(rejectTopup).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: 'button_refreshed' });
    expect(reply).toHaveBeenCalledWith(
      'admin_receipt_approve_confirm',
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('refreshes a legacy ban toggle into confirmation without changing ban state', async () => {
    const setBanned = vi.fn();
    const findProfile = vi.fn().mockResolvedValue({ telegramId: 42, isBanned: false });
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const route = matchRoute(collectRoutes(registerAdminUserRoutes), 'admin_user_toggle_ban:42');
    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        userService: { findProfile, setBanned },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(findProfile).toHaveBeenCalledWith('42');
    expect(setBanned).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: 'button_refreshed' });
    expect(reply).toHaveBeenCalledWith(
      'admin_user_ban_confirm',
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
