import { describe, expect, it, vi } from 'vitest';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import type { LocalUserProfile } from '../../src/domain/services/UserService.js';
import { promptAndResolveAdminTargetUser } from '../../src/telegram/conversations/adminConversations/shared.js';
import {
  registerReceiptAdminRoutes,
  type ReceiptRejectReason,
} from '../../src/telegram/features/admin/receiptRoutes.js';
import { registerAdminUserRoutes } from '../../src/telegram/features/admin/userRoutes.js';
import { registerSubscriptionRoutes } from '../../src/telegram/features/subscriptions/routes.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';

function createDummyProfile(id: number, username = `user_${id}`): LocalUserProfile {
  return {
    id: `00000000-0000-0000-0000-00000000000${id}`,
    telegramId: id,
    username,
    firstName: `First${id}`,
    lastName: `Last${id}`,
    balance: 100_000,
    reservedBalance: 0,
    isBanned: false,
    hasUsedTrial: false,
    locale: 'fa',
    localeManual: false,
    referrerId: null,
    referralCode: `ref_${id}`,
    registrationSource: 'telegram',
    lastSeenAt: new Date(),
    totalSpend: 50_000,
    activeSubscriptionCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    transactionCount: 2,
    referredUserCount: 0,
    referralBonusEarned: 0,
    cashbackEarned: 0,
  };
}

describe('Admin authorization, legacy callbacks, quick top-up & ban protection', () => {
  it('refreshes legacy receipt approvals into confirmation without crediting wallets', async () => {
    const approveTopup = vi.fn();
    const rejectTopup = vi.fn();
    const getPendingTopup = vi.fn().mockResolvedValue({
      id: 'receipt_1',
      telegramId: 6_698_253_699,
      amount: 125_000,
    });
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      walletService: { getPendingTopup, approveTopup, rejectTopup },
    });
    const harness = createBotHarness({ services });
    registerReceiptAdminRoutes(harness.bot);

    // Non-admin caller blocked cleanly
    await harness.sendCallback('receipt-approve:receipt_1', { userId: 999 });
    expect(getPendingTopup).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('access_denied');

    // Authorized admin sees confirmation without mutating
    harness.clearCalls();
    await harness.sendCallback('receipt-approve:receipt_1', { userId: 1 });
    expect(getPendingTopup).toHaveBeenCalledWith('receipt_1');
    expect(approveTopup).not.toHaveBeenCalled();
    expect(rejectTopup).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('button_refreshed');
    const confirmText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(confirmText).toContain('admin_receipt_approve_title');
    expect(confirmText).toContain('6698253699');
    expect(confirmText).not.toContain('۶٬۶۹۸٬۲۵۳٬۶۹۹');

    // Current prompt path also pauses for confirmation
    harness.clearCalls();
    await harness.sendCallback('receipt:approve_prompt:receipt_1', { userId: 1 });
    expect(approveTopup).not.toHaveBeenCalled();
    expect(String(harness.callsFor('editMessageText').at(-1)?.payload.text)).toContain(
      'admin_receipt_approve_consequence'
    );
  });

  it('requires confirmation and one durable referenceId for quick top-up clicks', async () => {
    const adjustBalanceAdmin = vi.fn().mockResolvedValue(50_000);
    const findProfile = vi.fn().mockResolvedValue(createDummyProfile(42, 'customer'));
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      walletService: { adjustBalanceAdmin },
      userService: { findProfile },
    });
    const harness = createBotHarness({ services });
    registerAdminUserRoutes(harness.bot);

    await harness.sendCallback('admin:user:quick_topup:42:50000', { userId: 1 });
    expect(adjustBalanceAdmin).not.toHaveBeenCalled();
    const pendingToken = harness.getSession(1)?.adminQuickTopup?.token;
    expect(pendingToken).toBeDefined();
    expect(
      extractCallbackDataList(harness.callsFor('editMessageText').at(-1)?.payload.reply_markup)
    ).toContain(`admin:q:${pendingToken}`);

    harness.clearCalls();
    await harness.sendCallback(`admin:q:${pendingToken}`, { userId: 1 });
    await harness.sendCallback(`admin:q:${pendingToken}`, { userId: 1 });

    expect(adjustBalanceAdmin).toHaveBeenCalledOnce();
    expect(adjustBalanceAdmin).toHaveBeenCalledWith({
      telegramId: 42,
      operation: 'add',
      amount: 50_000,
      adminId: 1,
      description: 'Admin quick top-up',
      referenceId: `admin_quick_topup_${pendingToken}`,
    });
    expect(harness.getSession(1)?.adminQuickTopup).toBeUndefined();
    expect(harness.callsFor('answerCallbackQuery').at(-1)?.payload).toMatchObject({
      text: 'button_action_failed',
      show_alert: true,
    });
  });

  it('refreshes legacy ban toggle and blocks banning other administrators', async () => {
    const setBanned = vi.fn();
    const findProfile = vi.fn().mockResolvedValue({ telegramId: 6_698_253_699, isBanned: false });
    const services = createMockServices({
      adminIds: [1, 6_698_253_699],
      isAdmin: vi.fn((id) => id === 1 || id === 6_698_253_699),
      userService: { findProfile, setBanned },
    });
    const harness = createBotHarness({ services });
    registerAdminUserRoutes(harness.bot);

    findProfile.mockResolvedValueOnce({ telegramId: 42, isBanned: false });
    await harness.sendCallback('admin_user_toggle_ban:42', { userId: 1 });
    expect(setBanned).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('button_refreshed');

    harness.clearCalls();
    await harness.sendCallback('admin:user:ban_prompt:6698253699', { userId: 1 });
    expect(setBanned).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload).toMatchObject({
      text: 'admin_user_cannot_ban_admin',
      show_alert: true,
    });

    harness.clearCalls();
    await harness.sendCallback('admin:user:ban:6698253699:1', { userId: 1 });
    expect(setBanned).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload).toMatchObject({
      text: 'admin_user_cannot_ban_admin',
      show_alert: true,
    });
  });
});

describe('Receipt rejection reasons: routes, i18n keys & 64-byte callbacks', () => {
  const reasons: ReceiptRejectReason[] = [
    'unclear',
    'not_received',
    'duplicate',
    'amount_mismatch',
    'other',
  ];

  it('has complete FA/EN rejection keys and compact callbacks within 64 bytes', () => {
    for (const r of reasons) {
      expect(FA_TEXTS[`admin_receipt_reject_reason_${r}`]).toBeDefined();
      expect(EN_TEXTS[`admin_receipt_reject_reason_${r}`]).toBeDefined();
      expect(FA_TEXTS[`receipt_result_rejected_reason_${r}`]).toBeDefined();
      expect(EN_TEXTS[`receipt_result_rejected_reason_${r}`]).toBeDefined();
      expect(
        Buffer.byteLength(`rcpt:rej:rcpt_1788024579794_abcdef:1:${r[0]}`, 'utf8')
      ).toBeLessThanOrEqual(64);
    }
    expect(FA_TEXTS['admin_receipt_reject_select_reason']).toBeDefined();
    expect(EN_TEXTS['admin_receipt_reject_select_reason']).toBeDefined();
    expect(FA_TEXTS['receipt_result_rejected_reason_label']).toBeDefined();
    expect(EN_TEXTS['receipt_result_rejected_reason_label']).toBeDefined();
  });

  it('rejects receipt through live registerReceiptAdminRoutes compact 1-char code & notifies user', async () => {
    const rejectTopup = vi.fn().mockResolvedValue({
      id: 'rcpt_live_1',
      telegramId: 555,
      amount: 100_000,
    });
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      walletService: {
        rejectTopup,
        listPendingTopups: vi
          .fn()
          .mockResolvedValue({ items: [], total: 0, totalPages: 1, page: 1 }),
      },
    });
    const harness = createBotHarness({ services });
    registerReceiptAdminRoutes(harness.bot);

    await harness.sendCallback('rcpt:rej:rcpt_live_1:1:a', { userId: 1 });

    expect(rejectTopup).toHaveBeenCalledWith(
      'rcpt_live_1',
      1,
      'admin_receipt_reject_reason_amount_mismatch'
    );
    const userNotice = harness.callsFor('sendMessage').find((c) => c.payload.chat_id === 555);
    expect(String(userNotice?.payload.text)).toContain(
      'receipt_result_rejected_reason_amount_mismatch'
    );
  });
});

describe('Admin Customer 360 reports & user subscription management', () => {
  it('renders Customer 360 hub and paginated ledger, orders, receipts & audit reports', async () => {
    const summary = {
      user: createDummyProfile(455713813, 'alice'),
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
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      translationService: {
        get: vi.fn((key: string, _locale?: string, vars?: Record<string, unknown>) =>
          key === 'admin_user_reports_subtitle' && vars?.telegram_id
            ? `گزارش کاربر · \`${vars.telegram_id}\``
            : key
        ),
      },
      userService: {
        getUserReportSummary: vi.fn().mockResolvedValue(summary),
        listOrdersForUser: vi.fn().mockResolvedValue({
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
        }),
        listReceiptsForUser: vi.fn().mockResolvedValue({
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
        }),
        listAuditLogsForUser: vi.fn().mockResolvedValue({
          logs: [
            {
              id: 'audit_1',
              actorTelegramId: 1,
              action: 'topup_receipt_approved',
              entityType: 'topup_receipt',
              entityId: 'rec_1001',
              targetTelegramId: 455713813,
              metadata: JSON.stringify({ amount: 200_000 }),
              createdAt: new Date('2026-08-28T15:00:00Z'),
            },
            {
              id: 'audit_2',
              actorTelegramId: 1,
              action: 'manual_topup',
              entityType: 'telegram_user',
              entityId: '455713813',
              targetTelegramId: 455713813,
              metadata: JSON.stringify({ amount: 50_000, description: 'Gift topup' }),
              createdAt: new Date('2026-08-28T15:00:00Z'),
            },
          ],
          total: 2,
          totalPages: 1,
          page: 1,
        }),
      },
      walletService: {
        listTransactionsForUser: vi.fn().mockResolvedValue({
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
          ],
          total: 1,
          totalPages: 1,
          page: 1,
        }),
      },
    });
    const harness = createBotHarness({ services });
    registerAdminUserRoutes(harness.bot);

    await harness.sendCallback('admin:user:reports:455713813', { userId: 1 });
    const hubCallbacks = extractCallbackDataList(
      harness.callsFor('editMessageText').at(-1)?.payload.reply_markup
    );
    expect(hubCallbacks).toEqual(
      expect.arrayContaining([
        'admin:user:reports:ledger:455713813:1',
        'admin:user:reports:orders:455713813:1',
        'admin:user:reports:receipts:455713813:1',
        'admin:user:reports:audit:455713813:1',
        'admin:user:view:455713813',
      ])
    );

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:ledger:455713813:1', { userId: 1 });
    expect(String(harness.callsFor('editMessageText').at(-1)?.payload.text)).toContain('💳');

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:orders:455713813:1', { userId: 1 });
    expect(String(harness.callsFor('editMessageText').at(-1)?.payload.text)).toContain(
      '`h_455713813_01`'
    );

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:receipts:455713813:1', { userId: 1 });
    expect(String(harness.callsFor('editMessageText').at(-1)?.payload.text)).toContain(
      '`rec_1001`'
    );

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:audit:455713813:1', { userId: 1 });
    const auditText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(auditText).toContain('admin_user_audit_action_receipt_approved');
    expect(auditText).toContain('admin_user_audit_action_manual_topup');
    expect(auditText).not.toContain('topup\\_receipt\\_approved');
  });

  it('renders user subscriptions without escaped underscores and lets admin manage all actions', async () => {
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
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      translationService: {
        get: vi.fn((key: string, _locale?: string, vars?: Record<string, unknown>) =>
          key === 'subscription_detail_heading' && vars?.username
            ? `سرویس · \`${vars.username}\``
            : key
        ),
      },
      configService: {
        listConfigsForOwner: vi.fn().mockResolvedValue([config]),
        getConfigById: vi.fn().mockResolvedValue(config),
        getRemoteConfigDetail: vi.fn().mockResolvedValue({
          status: 'active',
          data_limit: 30 * 1024 ** 3,
          used_traffic: 5 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 86400 * 30,
          subscription_url: 'https://example.com/sub/h_455713813_29',
        }),
      },
    });
    const harness = createBotHarness({ services });
    registerAdminUserRoutes(harness.bot);
    registerSubscriptionRoutes(harness.bot);

    await harness.sendCallback('admin:user:subscriptions:455713813:1', { userId: 1 });
    const listText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(listText).toContain('`h_455713813_29`');
    expect(listText).not.toContain('h\\_455713813\\_29');

    harness.clearCalls();
    await harness.sendCallback('config:view:uc_sub_1', { userId: 1 });
    const detailPayload = harness.callsFor('editMessageText').at(-1)?.payload;
    expect(String(detailPayload?.text)).toContain('📱 *سرویس · `h_455713813_29`*');
    expect(extractCallbackDataList(detailPayload?.reply_markup)).toEqual(
      expect.arrayContaining([
        'renew:open:uc_sub_1',
        'config:qr:uc_sub_1',
        'config:refresh:uc_sub_1',
        'autorenew:on:uc_sub_1',
        'config:set:off:uc_sub_1',
        'admin:user:subscriptions:455713813:1',
      ])
    );
  });

  it('resolves admin target users immediately, on single search match, and via candidate picker', async () => {
    const p1 = createDummyProfile(101, 'user1');
    const p2 = createDummyProfile(102, 'user2');
    const findProfile = vi.fn().mockResolvedValue(p1);
    const searchProfiles = vi.fn();

    const baseCtx = {
      from: { id: 100 },
      reply: vi.fn().mockResolvedValue({ message_id: 201 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      session: {},
      services: {
        userService: { findProfile, searchProfiles },
        translationService: { get: vi.fn((k: string) => k) },
      },
    } as unknown as ConversationContext;

    await expect(
      promptAndResolveAdminTargetUser(
        { external: vi.fn((cb) => cb(baseCtx)) } as unknown as MyConversation,
        baseCtx,
        {
          titleKey: 'admin_menu_manual_topup',
          subtitleKey: 'admin_target_telegram_id_prompt',
          initialTelegramId: 101,
        }
      )
    ).resolves.toEqual(p1);

    searchProfiles.mockResolvedValueOnce([p2]);
    await expect(
      promptAndResolveAdminTargetUser(
        {
          external: vi.fn((cb) => cb(baseCtx)),
          wait: vi.fn().mockResolvedValue({
            message: { text: '@user2' },
            from: { id: 100 },
            reply: vi.fn().mockResolvedValue({ message_id: 202 }),
            deleteMessage: vi.fn().mockResolvedValue(true),
            session: {},
          }),
        } as unknown as MyConversation,
        baseCtx,
        { titleKey: 'admin_user_search_button', subtitleKey: 'admin_search_subtitle' }
      )
    ).resolves.toEqual(p2);

    searchProfiles.mockResolvedValueOnce([p1, p2]);
    await expect(
      promptAndResolveAdminTargetUser(
        {
          external: vi.fn((cb) => cb(baseCtx)),
          wait: vi
            .fn()
            .mockResolvedValueOnce({
              message: { text: 'user' },
              from: { id: 100 },
              reply: vi.fn().mockResolvedValue({ message_id: 202 }),
              deleteMessage: vi.fn().mockResolvedValue(true),
              session: {},
            })
            .mockResolvedValueOnce({
              callbackQuery: { data: 'target:select:102' },
              from: { id: 100 },
              answerCallbackQuery: vi.fn().mockResolvedValue(true),
              deleteMessage: vi.fn().mockResolvedValue(true),
              session: {},
            }),
        } as unknown as MyConversation,
        baseCtx,
        { titleKey: 'admin_user_search_button', subtitleKey: 'admin_search_subtitle' }
      )
    ).resolves.toEqual(p2);
  });
});
