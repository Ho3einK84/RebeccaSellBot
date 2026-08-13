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
      session: {},
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
    const [confirmationText, confirmationOptions] = reply.mock.calls[0] ?? [];
    expect(confirmationText).toContain('admin_receipt_approve_title');
    expect(confirmationText).toContain('admin_receipt_approve_consequence');
    expect(confirmationOptions).toEqual(
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: expect.anything(),
      })
    );
  });

  it('turns the current receipt approval button into confirmation before crediting a wallet', async () => {
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
      'receipt:approve_prompt:receipt_1'
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
    const [confirmationText, confirmationOptions] = reply.mock.calls[0] ?? [];
    expect(confirmationText).toContain('admin_receipt_approve_title');
    expect(confirmationText).toContain('admin_receipt_approve_consequence');
    expect(confirmationOptions).toEqual(
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: expect.anything(),
      })
    );
  });

  it('shows a confirmation before a quick top-up changes a user wallet', async () => {
    const adjustBalanceAdmin = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const session: MenuContext['session'] = {};
    const route = matchRoute(
      collectRoutes(registerAdminUserRoutes),
      'admin:user:quick_topup:42:50000'
    );
    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      session,
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        walletService: { adjustBalanceAdmin },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(adjustBalanceAdmin).not.toHaveBeenCalled();
    const [confirmationText, confirmationOptions] = reply.mock.calls[0] ?? [];
    expect(String(confirmationText)).toContain('admin_user_quick_topup_confirm');
    expect(confirmationOptions).toEqual(
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: expect.anything() })
    );
    expect(session.adminQuickTopup).toEqual(
      expect.objectContaining({ targetTelegramId: 42, amount: 50_000, status: 'pending' })
    );
    const callbacks = (
      confirmationOptions as { reply_markup: { inline_keyboard: unknown[][] } }
    ).reply_markup.inline_keyboard.flat() as Array<{ callback_data?: string }>;
    expect(callbacks).toContainEqual({
      text: 'admin_confirm_button',
      callback_data: `admin:q:${session.adminQuickTopup!.token}`,
    });
  });

  it('uses one durable operation reference for repeated quick top-up confirmation clicks', async () => {
    const token = '0123456789abcdef';
    const adjustBalanceAdmin = vi.fn().mockResolvedValue(50_000);
    const findProfile = vi.fn().mockResolvedValue({
      telegramId: 42,
      username: 'customer',
      firstName: 'Test',
      lastName: 'User',
      isBanned: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      balance: 50_000,
      reservedBalance: 0,
      totalSpend: 0,
      activeSubscriptionCount: 0,
      hasUsedTrial: false,
      referralCode: 'REF42',
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 0,
      transactionCount: 1,
    });
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const route = matchRoute(collectRoutes(registerAdminUserRoutes), `admin:q:${token}`);
    const session: MenuContext['session'] = {
      adminQuickTopup: {
        token,
        targetTelegramId: 42,
        amount: 50_000,
        status: 'pending',
      },
    };
    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      session,
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        walletService: { adjustBalanceAdmin },
        userService: { findProfile },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);
    await route.handler(ctx);

    expect(adjustBalanceAdmin).toHaveBeenCalledOnce();
    expect(adjustBalanceAdmin).toHaveBeenCalledWith({
      telegramId: 42,
      operation: 'add',
      amount: 50_000,
      adminId: 1,
      description: 'Admin quick top-up',
      referenceId: `admin_quick_topup_${token}`,
    });
    expect(session.adminQuickTopup).toBeUndefined();
    expect(answerCallbackQuery).toHaveBeenLastCalledWith({
      text: 'button_action_failed',
      show_alert: true,
    });
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
    const [confirmationText, confirmationOptions] = reply.mock.calls[0] ?? [];
    expect(String(confirmationText)).toContain('admin_user_ban_confirm');
    expect(confirmationOptions).toEqual(
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
