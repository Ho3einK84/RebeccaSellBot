import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
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
    get: vi.fn((key: string, _locale?: string, vars?: Record<string, unknown>) => {
      if (key === 'admin_user_reports_subtitle' && vars?.telegram_id) {
        return `گزارش کاربر · \`${vars.telegram_id}\``;
      }
      return key;
    }),
  };
}

describe('admin user reports hub and sub-reports', () => {
  it('renders customer 360 reports hub with overview metrics and sub-report buttons', async () => {
    const summary = {
      user: {
        id: '4e602ae8-4398-4ce0-a084-10a5860ce1a5',
        telegramId: 455713813,
        username: 'alice',
        firstName: 'Alice',
        lastName: null,
        balance: 50_000,
        reservedBalance: 0,
        totalSpend: 180_000,
        activeSubscriptionCount: 2,
        hasUsedTrial: true,
        locale: 'fa',
        localeManual: false,
        referrerId: null,
        referralCode: 'ref_455713813_abc',
        registrationSource: 'telegram',
        lastSeenAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        transactionCount: 14,
        referredUserCount: 3,
        referralBonusEarned: 25_000,
        cashbackEarned: 9_000,
      },
      totalDeposit: 230_000,
      totalSpend: 180_000,
      totalRefund: 0,
      totalCashback: 9_000,
      totalReferralBonus: 25_000,
      totalLuckyWheel: 5_000,
      totalTransactions: 14,
      activeConfigsCount: 2,
      totalConfigsCount: 5,
      totalOrdersCount: 8,
      receiptsApprovedCount: 6,
      receiptsRejectedCount: 1,
      receiptsPendingCount: 0,
      totalReceiptsCount: 7,
      auditEventsCount: 4,
    };

    const getUserReportSummary = vi.fn().mockResolvedValue(summary);
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:reports:455713813');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        userService: { getUserReportSummary },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(getUserReportSummary).toHaveBeenCalledWith(455713813);
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    expect(renderedText).toContain('📜');
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );

    expect(callbacks).toContain('admin:user:reports:ledger:455713813:1');
    expect(callbacks).toContain('admin:user:reports:orders:455713813:1');
    expect(callbacks).toContain('admin:user:reports:receipts:455713813:1');
    expect(callbacks).toContain('admin:user:reports:audit:455713813:1');
    expect(callbacks).toContain('admin:user:view:455713813');
  });

  it('renders paginated financial ledger report', async () => {
    const listTransactionsForUser = vi.fn().mockResolvedValue({
      transactions: [
        {
          id: 'tx_1',
          telegramId: 455713813,
          amount: -85_000,
          balanceAfter: 50_000,
          type: 'purchase',
          referenceId: 'pi_test_1',
          description: 'Purchase config',
          createdAt: new Date('2026-08-30T10:00:00Z'),
        },
        {
          id: 'tx_2',
          telegramId: 455713813,
          amount: 100_000,
          balanceAfter: 135_000,
          type: 'topup',
          referenceId: 'rec_test_1',
          description: 'Topup receipt',
          createdAt: new Date('2026-08-30T09:00:00Z'),
        },
      ],
      total: 2,
      totalPages: 1,
      page: 1,
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:reports:ledger:455713813:1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        walletService: { listTransactionsForUser },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(listTransactionsForUser).toHaveBeenCalledWith(455713813, 1, 5);
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    expect(renderedText).toContain('💳');
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );
    expect(callbacks).toContain('admin:user:reports:455713813');
  });

  it('renders paginated orders and purchase report', async () => {
    const listOrdersForUser = vi.fn().mockResolvedValue({
      orders: [
        {
          id: 'pi_1',
          telegramId: 455713813,
          panelId: 'legacy',
          serviceId: 1,
          checkoutId: 'chk_1',
          amount: 85_000,
          type: 'new_config',
          status: 'completed',
          configUsername: 'h_455713813_01',
          gbAmount: 30,
          durationDays: 30,
          createdAt: new Date('2026-08-30T10:00:00Z'),
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:reports:orders:455713813:1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        userService: { listOrdersForUser },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(listOrdersForUser).toHaveBeenCalledWith(455713813, 1, 5);
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    expect(renderedText).toContain('🛍️');
    expect(renderedText).toContain('`h_455713813_01`');
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );
    expect(callbacks).toContain('admin:user:reports:455713813');
  });

  it('renders paginated topup receipts report', async () => {
    const listReceiptsForUser = vi.fn().mockResolvedValue({
      receipts: [
        {
          id: 'rec_1001',
          telegramId: 455713813,
          amount: 100_000,
          photoFileId: 'file_123',
          mediaType: 'photo',
          status: 'approved',
          reviewedBy: 1,
          createdAt: new Date('2026-08-29T12:00:00Z'),
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:reports:receipts:455713813:1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        userService: { listReceiptsForUser },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(listReceiptsForUser).toHaveBeenCalledWith(455713813, 1, 5);
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    expect(renderedText).toContain('🧾');
    expect(renderedText).toContain('`rec_1001`');
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );
    expect(callbacks).toContain('admin:user:reports:455713813');
  });

  it('renders paginated admin audit logs report with formatted action and actor', async () => {
    const listAuditLogsForUser = vi.fn().mockResolvedValue({
      logs: [
        {
          id: 'audit_1',
          actorTelegramId: 1,
          action: 'manual_topup',
          entityType: 'telegram_user',
          entityId: '455713813',
          targetTelegramId: 455713813,
          metadata: JSON.stringify({ amount: 50_000, description: 'Gift topup' }),
          createdAt: new Date('2026-08-28T15:00:00Z'),
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
    });

    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const routes = collectRoutes(registerAdminUserRoutes);
    const route = matchRoute(routes, 'admin:user:reports:audit:455713813:1');

    const ctx = {
      match: route.match,
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      reply,
      answerCallbackQuery,
      services: {
        translationService: translationServiceStub(),
        userService: { listAuditLogsForUser },
      },
    } as unknown as MenuContext & { match: RegExpMatchArray };

    await route.handler(ctx);

    expect(listAuditLogsForUser).toHaveBeenCalledWith(455713813, 1, 5);
    expect(reply).toHaveBeenCalledOnce();
    const [renderedText, renderedOptions] = reply.mock.calls[0] ?? [];

    expect(renderedText).toContain('🛡️');
    const keyboard = renderedOptions.reply_markup;
    const callbacks = (keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>).map(
      (btn) => btn.callback_data
    );
    expect(callbacks).toContain('admin:user:reports:455713813');
  });
});
