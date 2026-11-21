import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../src/infra/db.js';
import {
  DuplicateReceiptError,
  TopupVoidError,
  WalletService,
} from '../../src/domain/services/WalletService.js';
import {
  PaymentService,
  computeUniquePayableAmount,
  parseBankCardsJson,
  serializeBankCardsJson,
  type BankCardConfig,
} from '../../src/domain/services/PaymentService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import {
  formatDuplicateReceiptBanner,
  sendAdminNewReceiptNotification,
  sendReceiptVoidedNotification,
} from '../../src/telegram/features/admin/adminNotifications.js';
import {
  formatReceiptShortId,
  registerReceiptAdminRoutes,
  showReceiptQueue,
} from '../../src/telegram/features/admin/receiptRoutes.js';
import { registerAdminUserRoutes } from '../../src/telegram/features/admin/userRoutes.js';
import {
  computeReceiptFileSha256,
  topupConversation,
} from '../../src/telegram/conversations/adminConversations/wallet.js';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { createMockDb } from './_helpers/mockDb.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from '../telegram/helpers/botHarness.js';
import { createConversationHarness } from '../telegram/helpers/conversationHarness.js';
import { createMockAdminServices, createTestConfig } from '../webapp/helpers/webappTestHarness.js';
import type { Api } from 'grammy';
import type { MenuContext } from '../../src/telegram/types.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ locked: true, unlocked: true }] }),
      release: vi.fn(),
    }),
  })),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('Duplicate Receipt Detection & Payment Void (WalletService)', () => {
  const getDbMock = vi.mocked(getDb);
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let walletService: WalletService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      receipt_duplicate_policy: 'warn',
    };
    translationService = {
      getSetting: vi.fn((key: string, fallback = '') => settings[key] ?? fallback),
      getSettingNum: vi.fn(() => 1),
      resolveLocale: vi.fn(() => 'fa'),
    } as unknown as TranslationService;

    const mockRebecca = {} as unknown as RebeccaService;
    const mockReferral = {
      resolveReferrerId: vi.fn().mockResolvedValue(undefined),
      calculateBonusSnapshot: vi.fn(),
      processCompletedPurchase: vi.fn(),
    } as unknown as ReferralService;
    const mockPromo = {
      reserveForPurchase: vi.fn(),
      finalizeReservedPurchasePromo: vi.fn(),
      releaseReservedPurchasePromoInTransaction: vi.fn(),
    } as unknown as PromoService;

    walletService = new WalletService(mockRebecca, translationService, mockReferral, mockPromo);
  });

  describe('Duplicate receipt detection (fileUniqueId + fileSha256)', () => {
    it('flags duplicate by fileUniqueId in warn policy and persists fingerprint columns', async () => {
      const db = createMockDb({
        selectResults: [
          [{ telegramId: 1001 }],
          [],
          [{ id: 'rec_1700000000_orig1', status: 'approved', createdAt: new Date() }],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);

      const res = await walletService.submitTopupReceiptDetailed({
        telegramId: 1001,
        amount: 150_000,
        photoFileId: 'file_new',
        mediaType: 'photo',
        fileUniqueId: 'AQAD_unique_1',
        fileSha256: 'ABCDEF0123456789',
      });

      expect(res.receiptId).toMatch(/^rec_/u);
      expect(res.duplicateOfReceiptId).toBe('rec_1700000000_orig1');
      expect(db.state.insertCalls).toHaveLength(1);
      expect(db.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 1001,
        amount: 150_000,
        photoFileId: 'file_new',
        fileUniqueId: 'AQAD_unique_1',
        fileSha256: 'abcdef0123456789',
        duplicateOfReceiptId: 'rec_1700000000_orig1',
        status: 'pending',
      });
    });

    it('prefers non-rejected duplicate match when matching by fileSha256 in warn mode', async () => {
      const db = createMockDb({
        selectResults: [
          [{ telegramId: 1002 }],
          [],
          [
            { id: 'rec_rejected_newer', status: 'rejected', createdAt: new Date() },
            { id: 'rec_approved_older', status: 'approved', createdAt: new Date() },
          ],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);

      const res = await walletService.submitTopupReceiptDetailed({
        telegramId: 1002,
        amount: 50_000,
        photoFileId: 'file_2',
        fileSha256: 'deadbeef1234',
      });

      expect(res.duplicateOfReceiptId).toBe('rec_approved_older');
      expect(db.state.insertCalls[0]?.values).toMatchObject({
        fileSha256: 'deadbeef1234',
        duplicateOfReceiptId: 'rec_approved_older',
      });
    });

    it('blocks duplicate submission in block policy without inserting a receipt row', async () => {
      settings.receipt_duplicate_policy = 'block';
      const db = createMockDb({
        selectResults: [
          [{ telegramId: 1003 }],
          [],
          [{ id: 'rec_prior_999', status: 'approved', createdAt: new Date() }],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);

      await expect(
        walletService.submitTopupReceipt(1003, 100_000, 'file_dup', 'photo', {
          fileUniqueId: 'AQAD_dup',
          fileSha256: 'hash_dup',
        })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof DuplicateReceiptError &&
          err.code === 'DUPLICATE_RECEIPT' &&
          err.originalReceiptId === 'rec_prior_999'
      );

      expect(db.state.insertCalls).toHaveLength(0);
      expect(db.state.rolledBackTransactions).toBe(1);
    });

    it('inserts clean receipt with null duplicateOfReceiptId when no prior fingerprint matches', async () => {
      settings.receipt_duplicate_policy = 'block';
      const db = createMockDb({
        selectResults: [[{ telegramId: 1004 }], [], []],
      });
      getDbMock.mockReturnValue(db.db as never);

      const res = await walletService.submitTopupReceiptDetailed({
        telegramId: 1004,
        amount: 200_000,
        photoFileId: 'file_unique',
        fileUniqueId: 'AQAD_fresh',
        fileSha256: 'fresh_hash',
      });

      expect(res.duplicateOfReceiptId).toBeNull();
      expect(db.state.insertCalls).toHaveLength(1);
      expect(db.state.insertCalls[0]?.values).not.toHaveProperty('duplicateOfReceiptId');
    });
  });

  describe('voidApprovedTopup (atomic + idempotent)', () => {
    it('deducts full receipt amount, updates receipt status, writes topup_void tx and audit_logs', async () => {
      const approvedAt = new Date('2026-10-01T10:00:00Z');
      const db = createMockDb({
        selectResults: [
          [
            {
              id: 'rec_void_1',
              telegramId: 5001,
              amount: 100_000,
              status: 'approved',
              createdAt: approvedAt,
              updatedAt: approvedAt,
            },
          ],
          [{ telegramId: 5001, balance: 250_000, reservedBalance: 0 }],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);

      const result = await walletService.voidApprovedTopup({
        receiptId: 'rec_void_1',
        adminId: 9001,
        reason: 'Bank transfer reversed',
      });

      expect(result).toEqual({
        receiptId: 'rec_void_1',
        telegramId: 5001,
        originalAmount: 100_000,
        deductedAmount: 100_000,
        shortfallAmount: 0,
        balanceAfter: 150_000,
        disabledConfigs: [],
        alreadyVoided: false,
      });

      // Locks both receipt and user rows FOR UPDATE
      expect(db.state.selectCalls[0]?.lock).toBe('update');
      expect(db.state.selectCalls[1]?.lock).toBe('update');

      // Updates user balance to 150,000 and marks receipt voided with audit metadata
      expect(db.state.updateCalls[0]?.set).toMatchObject({ balance: 150_000 });
      expect(db.state.updateCalls[1]?.set).toMatchObject({
        status: 'voided',
        voidedBy: 9001,
        voidReason: 'Bank transfer reversed',
      });
      expect(db.state.updateCalls[1]?.set.voidedAt).toBeInstanceOf(Date);

      // Inserts wallet_transactions with type 'topup_void' and deterministic referenceId 'void_<id>'
      expect(db.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 5001,
        amount: -100_000,
        balanceAfter: 150_000,
        type: 'topup_void',
        referenceId: 'void_rec_void_1',
      });

      // Inserts immutable audit_logs entry
      expect(db.state.insertCalls[1]?.values).toMatchObject({
        actorTelegramId: 9001,
        action: 'topup_receipt_voided',
        entityType: 'topup_receipt',
        entityId: 'rec_void_1',
        targetTelegramId: 5001,
      });
      expect(db.state.committedTransactions).toBe(1);
    });

    it('handles shortfall without driving balance negative or below reserved funds and disables post-topup configs', async () => {
      const approvalTime = new Date('2026-10-01T12:00:00Z');
      const db = createMockDb({
        selectResults: [
          [
            {
              id: 'rec_shortfall_1',
              telegramId: 5002,
              amount: 100_000,
              status: 'approved',
              createdAt: new Date('2026-10-01T11:55:00Z'),
              updatedAt: approvalTime,
            },
          ],
          // User has 30,000 total balance with 10,000 reserved -> only 20,000 free
          [{ telegramId: 5002, balance: 30_000, reservedBalance: 10_000 }],
          // Candidate configs queried post-tx
          [
            {
              id: 'cfg_old',
              telegramId: 5002,
              panelId: 'panel_de',
              configUsername: 'old_before_topup',
              panelStatus: 'active',
              createdAt: new Date('2026-09-20T10:00:00Z'),
            },
            {
              id: 'cfg_new_active',
              telegramId: 5002,
              panelId: 'panel_de',
              configUsername: 'new_after_topup',
              panelStatus: 'active',
              createdAt: new Date('2026-10-01T12:05:00Z'),
            },
            {
              id: 'cfg_new_disabled',
              telegramId: 5002,
              panelId: 'panel_nl',
              configUsername: 'already_disabled',
              panelStatus: 'disabled',
              createdAt: new Date('2026-10-01T12:10:00Z'),
            },
          ],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);
      const disableConfig = vi.fn().mockResolvedValue(undefined);

      const result = await walletService.voidApprovedTopup({
        receiptId: 'rec_shortfall_1',
        adminId: 9001,
        disablePurchasedConfigs: true,
        disableConfig,
      });

      expect(result).toEqual({
        receiptId: 'rec_shortfall_1',
        telegramId: 5002,
        originalAmount: 100_000,
        deductedAmount: 20_000,
        shortfallAmount: 80_000,
        balanceAfter: 10_000,
        disabledConfigs: ['new_after_topup'],
        alreadyVoided: false,
      });

      expect(disableConfig).toHaveBeenCalledTimes(1);
      expect(disableConfig).toHaveBeenCalledWith('new_after_topup', 'panel_de');

      // Audit log records disabled configs
      const disabledAudit = db.state.insertCalls.find(
        (c) => (c.values as { action?: string })?.action === 'topup_receipt_void_configs_disabled'
      );
      expect(disabledAudit).toBeDefined();
      expect(JSON.parse(String((disabledAudit?.values as { metadata?: string }).metadata))).toEqual(
        expect.objectContaining({
          receiptId: 'rec_shortfall_1',
          shortfallAmount: 80_000,
          disabledConfigs: ['new_after_topup'],
        })
      );
    });

    it('is idempotent when called on an already voided receipt (no double deduction)', async () => {
      const db = createMockDb({
        selectResults: [
          [
            {
              id: 'rec_already_void',
              telegramId: 5003,
              amount: 100_000,
              status: 'voided',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ],
      });
      getDbMock.mockReturnValue(db.db as never);
      const disableConfig = vi.fn();

      const result = await walletService.voidApprovedTopup({
        receiptId: 'rec_already_void',
        adminId: 9001,
        disablePurchasedConfigs: true,
        disableConfig,
      });

      expect(result).toMatchObject({
        receiptId: 'rec_already_void',
        telegramId: 5003,
        originalAmount: 100_000,
        deductedAmount: 0,
        shortfallAmount: 0,
        disabledConfigs: [],
        alreadyVoided: true,
      });
      expect(db.state.updateCalls).toHaveLength(0);
      expect(db.state.insertCalls).toHaveLength(0);
      expect(disableConfig).not.toHaveBeenCalled();
    });

    it('rejects missing, pending, and rejected receipts with TopupVoidError', async () => {
      getDbMock.mockReturnValue(createMockDb({ selectResults: [[]] }).db as never);
      await expect(
        walletService.voidApprovedTopup({ receiptId: 'rec_missing', adminId: 1 })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof TopupVoidError && err.reason === 'not_found'
      );

      for (const badStatus of ['pending', 'rejected'] as const) {
        const db = createMockDb({
          selectResults: [
            [{ id: `rec_${badStatus}`, telegramId: 5004, amount: 50_000, status: badStatus }],
          ],
        });
        getDbMock.mockReturnValue(db.db as never);
        await expect(
          walletService.voidApprovedTopup({ receiptId: `rec_${badStatus}`, adminId: 1 })
        ).rejects.toSatisfy(
          (err: unknown) =>
            err instanceof TopupVoidError &&
            err.reason === 'not_approved' &&
            err.currentStatus === badStatus
        );
        expect(db.state.updateCalls).toHaveLength(0);
        expect(db.state.insertCalls).toHaveLength(0);
      }
    });
  });
});

describe('Multi-Card Rotation & Unique Payable Amount (PaymentService)', () => {
  const getDbMock = vi.mocked(getDb);
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let paymentService: PaymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      card_number: '6037997900000001',
      card_holder: 'Legacy Holder',
      bank_cards_json: '[]',
    };
    translationService = {
      getSetting: vi.fn((key: string, def = '') => settings[key] ?? def),
      getSettingNum: vi.fn((key: string, def = 0) => Number(settings[key] ?? def)),
      updateSettings: vi.fn(async (pairs: Record<string, string>) => {
        Object.assign(settings, pairs);
      }),
    } as unknown as TranslationService;
    paymentService = new PaymentService(translationService);
  });

  it('parses bank_cards_json safely with Persian digits and falls back to legacy card_number when empty or all disabled', () => {
    expect(parseBankCardsJson('not-json')).toEqual([]);
    expect(parseBankCardsJson('{}')).toEqual([]);

    const parsed = parseBankCardsJson(
      JSON.stringify([
        {
          id: 'c1',
          cardNumber: '۶۰۳۷۹۹۷۹۱۱۱۱۱۱۱۱',
          cardHolder: 'Ali',
          enabled: true,
          dailyCapToman: '5000000',
          bankName: 'Melli',
        },
        { id: 'c1', cardNumber: '6037997922222222', cardHolder: 'Dup', enabled: true },
        { id: '', cardNumber: '6037997933333333', cardHolder: 'Bad', enabled: true },
        { id: 'c2', cardNumber: '5022291000000002', cardHolder: 'Reza', enabled: false },
      ])
    );
    expect(parsed).toEqual([
      {
        id: 'c1',
        cardNumber: '6037997911111111',
        cardHolder: 'Ali',
        enabled: true,
        dailyCapToman: 5_000_000,
        bankName: 'Melli',
      },
      {
        id: 'c2',
        cardNumber: '5022291000000002',
        cardHolder: 'Reza',
        enabled: false,
        dailyCapToman: null,
      },
    ]);

    // Empty bank_cards_json -> legacy fallback
    expect(paymentService.selectCardForTopup()).toMatchObject({
      id: 'legacy_default',
      cardNumber: '6037997900000001',
      cardHolder: 'Legacy Holder',
      enabled: true,
    });

    // All configured cards disabled -> legacy fallback
    settings.bank_cards_json = serializeBankCardsJson([
      { id: 'disabled1', cardNumber: '5022291000000009', cardHolder: 'Off', enabled: false },
    ]);
    expect(paymentService.selectCardForTopup()?.cardNumber).toBe('6037997900000001');

    // No legacy card either -> null
    settings.card_number = '   ';
    expect(paymentService.selectCardForTopup()).toBeNull();
  });

  it('rotates enabled cards round-robin and enforces dailyCapToman via passed map and internal tracker', async () => {
    const cards: BankCardConfig[] = [
      {
        id: 'card_a',
        cardNumber: '6037997900001111',
        cardHolder: 'Holder A',
        enabled: true,
        dailyCapToman: 500_000,
        bankName: 'Melli',
      },
      {
        id: 'card_b',
        cardNumber: '5022291000002222',
        cardHolder: 'Holder B',
        enabled: true,
        dailyCapToman: 300_000,
        bankName: 'Pasargad',
      },
      {
        id: 'card_disabled',
        cardNumber: '6219861000003333',
        cardHolder: 'Holder C',
        enabled: false,
        dailyCapToman: null,
      },
    ];
    await paymentService.updateBankCards(cards);

    // Round-robin rotation skips disabled card
    expect(paymentService.selectCardForTopup()?.id).toBe('card_a');
    expect(paymentService.selectCardForTopup()?.id).toBe('card_b');
    expect(paymentService.selectCardForTopup()?.id).toBe('card_a');

    // Explicit usage map caps card_a -> only card_b eligible
    const pickedUnderCap = paymentService.selectCardForTopup({
      amountToman: 100_000,
      dailyUsageByCardId: { card_a: 450_000, card_b: 100_000 },
    });
    expect(pickedUnderCap?.id).toBe('card_b');

    // All enabled cards over cap -> null
    const allCapped = paymentService.selectCardForTopup({
      amountToman: 100_000,
      dailyUsageByCardId: new Map([
        ['card_a', 450_000],
        ['card_b', 250_000],
      ]),
    });
    expect(allCapped).toBeNull();

    // Internal tracker tracks daily usage
    const fixedNow = new Date('2026-10-15T10:00:00Z');
    paymentService.recordCardDailyUsage('card_a', 480_000, fixedNow);
    expect(paymentService.getCardDailyUsage('card_a', fixedNow)).toBe(480_000);
    expect(paymentService.selectCardForTopup({ amountToman: 50_000, now: fixedNow })?.id).toBe(
      'card_b'
    );

    // CardToCardPaymentProvider surfaces selected multi-card details
    const instructions = await paymentService
      .getProvider('card_to_card')!
      .getInstructions({ amount: 10_000, telegramId: 42 });
    expect(instructions.cardId).toBeDefined();
    expect(['card_a', 'card_b']).toContain(instructions.cardId);
  });

  it('allocates unique payable amounts avoiding pending collisions and always stays positive', async () => {
    const blocked = [99_999, 99_998, 99_997];
    const alloc = computeUniquePayableAmount(100_000, blocked, {
      minOffset: 1,
      maxOffset: 5,
      step: 1,
      mode: 'deduct',
      random: () => 0,
    });
    // Remaining available offsets in 1..5 are 4 (99,996) and 5 (99,995); random=0 selects first (99,996)
    expect(alloc).toEqual({
      requestedAmount: 100_000,
      payableAmount: 99_996,
      offset: -4,
      isUnique: true,
    });

    // Primary band fully saturated -> expands cleanly without colliding
    const fullBand = [99_999, 99_998, 99_997];
    const expanded = computeUniquePayableAmount(100_000, fullBand, {
      minOffset: 1,
      maxOffset: 3,
      step: 1,
      mode: 'deduct',
    });
    expect(expanded.payableAmount).toBeGreaterThan(0);
    expect(fullBand).not.toContain(expanded.payableAmount);
    expect(expanded.isUnique).toBe(true);

    // Tiny amount stays strictly > 0 by switching to add mode
    const tiny = computeUniquePayableAmount(1, [], { minOffset: 1, maxOffset: 5, mode: 'deduct' });
    expect(tiny.payableAmount).toBeGreaterThan(1);

    // DB lookup path avoids pending receipt amounts loaded from DB
    const db = createMockDb({
      selectResults: [[{ amount: 49_990 }, { amount: 49_980 }]],
    });
    getDbMock.mockReturnValue(db.db as never);
    const fromDb = await paymentService.allocateUniquePayableAmount(50_000, {
      minOffset: 10,
      maxOffset: 30,
      step: 10,
      mode: 'deduct',
      random: () => 0,
    });
    expect(fromDb.payableAmount).toBe(49_970);
    expect(fromDb.offset).toBe(-30);

    expect(() => computeUniquePayableAmount(0, [])).toThrow('INVALID_TOPUP_AMOUNT');
    expect(() => computeUniquePayableAmount(-5000, [])).toThrow('INVALID_TOPUP_AMOUNT');
  });
});

describe('Telegram Admin Notifications, Receipt Routes, Conversation & WebApp API', () => {
  it('computes receipt SHA-256 from downloaded bytes and handles download failures gracefully', async () => {
    const sampleBytes = Buffer.from('fake-jpeg-receipt-content');
    const expectedSha = crypto.createHash('sha256').update(sampleBytes).digest('hex');

    const okHash = await computeReceiptFileSha256('123:token', 'file_1', async () => ({
      ok: true,
      buffer: sampleBytes,
      contentType: 'image/jpeg',
    }));
    expect(okHash).toBe(expectedSha);

    const failHash = await computeReceiptFileSha256('123:token', 'file_1', async () => ({
      ok: false,
      error: 'network down',
    }));
    expect(failHash).toBeNull();

    const throwHash = await computeReceiptFileSha256('123:token', 'file_1', async () => {
      throw new Error('boom');
    });
    expect(throwHash).toBeNull();
  });

  it('shows duplicate warning banner in admin notifications and delivers void notification to user', async () => {
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 1 });
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 2 });
    const api = { sendPhoto, sendMessage } as unknown as Api;

    const services = createMockServices({
      adminIds: [777],
      userService: { getLocale: vi.fn().mockResolvedValue('fa') },
    });

    await sendAdminNewReceiptNotification(api, services, {
      receiptId: 'rec_1700000000_new1',
      telegramId: 4242,
      amount: 100_000,
      photoFileId: 'photo_1',
      duplicateOfReceiptId: 'rec_1699999999_old9',
      shortIdFormatter: formatReceiptShortId,
    });

    expect(sendPhoto).toHaveBeenCalledTimes(1);
    const caption = String(sendPhoto.mock.calls[0]?.[2]?.caption);
    expect(caption).toContain('admin_receipt_duplicate_warning[short_id=old9]');

    const banner = formatDuplicateReceiptBanner(
      services.translationService,
      'fa',
      'rec_1699999999_old9',
      formatReceiptShortId
    );
    expect(banner).toContain('old9');

    await sendReceiptVoidedNotification(api, services, {
      telegramId: 4242,
      receiptId: 'rec_1700000000_new1',
      amount: 100_000,
      deductedAmount: 60_000,
      disabledConfigsCount: 2,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const userMsg = String(sendMessage.mock.calls[0]?.[1]);
    expect(userMsg).toContain('receipt_result_voided_title');
    expect(userMsg).toContain('receipt_result_voided_subtitle');
    expect(userMsg).toContain('receipt_result_voided_disabled_configs');
  });

  it('blocks duplicate receipt in topupConversation when DuplicateReceiptError is thrown and forwards duplicateOfReceiptId in warn mode', async () => {
    const sampleBytes = Buffer.from('receipt-bytes-for-sha256');
    const expectedSha = crypto.createHash('sha256').update(sampleBytes).digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/getFile')) {
          return {
            ok: true,
            json: async () => ({ ok: true, result: { file_path: 'photos/receipt.jpg' } }),
          } as Response;
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          arrayBuffer: async () =>
            sampleBytes.buffer.slice(
              sampleBytes.byteOffset,
              sampleBytes.byteOffset + sampleBytes.byteLength
            ),
        } as unknown as Response;
      })
    );

    const submitTopupReceiptDetailed = vi
      .fn()
      .mockRejectedValueOnce(new DuplicateReceiptError('rec_prior_abcd'));
    const services = createMockServices({
      adminIds: [999],
      walletService: { submitTopupReceiptDetailed },
    });
    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['topupConversation', topupConversation]],
    });
    harness.bot.command('topup', async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    });

    await harness.sendText('/topup', { userId: 7001 });
    await harness.sendText('100000', { userId: 7001 });
    await harness.sendPhoto('dup_photo_1', { userId: 7001 });
    await harness.sendCallback('topup:confirm', { userId: 7001, isCaptionMessage: true });

    expect(submitTopupReceiptDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 7001,
        amount: 100_000,
        photoFileId: 'dup_photo_1',
        fileUniqueId: 'dup_photo_1',
        fileSha256: expectedSha,
      })
    );
    const blockedReply = harness
      .callsFor('sendMessage')
      .map((c) => String(c.payload.text))
      .find((txt) => txt.includes('topup_duplicate_blocked'));
    expect(blockedReply).toBeDefined();
    expect(harness.callsFor('sendPhoto').filter((c) => c.payload.chat_id === 999)).toHaveLength(0);

    // Second run in warn mode returns duplicateOfReceiptId -> admin receives duplicate banner
    submitTopupReceiptDetailed.mockResolvedValueOnce({
      receiptId: 'rec_1700000001_warn',
      duplicateOfReceiptId: 'rec_1700000000_orig',
    });
    harness.clearCalls();
    await harness.sendText('/topup', { userId: 7002 });
    await harness.sendText('100000', { userId: 7002 });
    await harness.sendPhoto('dup_photo_2', { userId: 7002 });
    await harness.sendCallback('topup:confirm', { userId: 7002, isCaptionMessage: true });

    const adminPhoto = harness.callsFor('sendPhoto').find((c) => c.payload.chat_id === 999);
    expect(String(adminPhoto?.payload.caption)).toContain(
      'admin_receipt_duplicate_warning[short_id=orig]'
    );
  });

  it('shows duplicate banner in bot receipt queue/review and executes void flow via receiptRoutes with disableConfig', async () => {
    const voidApprovedTopup = vi.fn().mockImplementation(async (params) => {
      if (params.disablePurchasedConfigs && params.disableConfig) {
        await params.disableConfig('cfg_purchased_1', 'panel_1');
      }
      return {
        receiptId: params.receiptId,
        telegramId: 5555,
        originalAmount: 100_000,
        deductedAmount: 40_000,
        shortfallAmount: 60_000,
        disabledConfigs: params.disablePurchasedConfigs ? ['cfg_purchased_1'] : [],
        alreadyVoided: false,
      };
    });
    const disableConfig = vi.fn().mockResolvedValue(undefined);
    const listPendingTopupsPage = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'rec_1700000002_pend',
          telegramId: 5555,
          amount: 100_000,
          status: 'pending',
          duplicateOfReceiptId: 'rec_1700000000_prev',
          createdAt: new Date(),
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });
    const getTopupById = vi.fn().mockResolvedValue({
      id: 'rec_1700000003_appr',
      telegramId: 5555,
      amount: 100_000,
      status: 'approved',
      duplicateOfReceiptId: 'rec_1700000000_prev',
      createdAt: new Date(),
    });

    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      walletService: {
        listPendingTopupsPage,
        getPendingTopup: vi.fn().mockResolvedValue({
          id: 'rec_1700000002_pend',
          telegramId: 5555,
          amount: 100_000,
          duplicateOfReceiptId: 'rec_1700000000_prev',
          createdAt: new Date(),
        }),
        getTopupById,
        voidApprovedTopup,
      },
      configService: { disableConfig },
    });

    const harness = createBotHarness({ services });
    registerReceiptAdminRoutes(harness.bot);
    harness.bot.command('queue', async (ctx) => {
      await showReceiptQueue(ctx as MenuContext, 1);
    });

    // Queue shows duplicate warning banner
    await harness.sendText('/queue', { userId: 1 });
    const queueText = String(harness.callsFor('sendMessage').at(-1)?.payload.text);
    expect(queueText).toContain('admin_receipt_duplicate_warning[short_id=prev]');

    // Approved receipt detail shows void button
    harness.clearCalls();
    await harness.sendCallback('rcpt:va:rec_1700000003_appr:1', { userId: 1 });
    const detailCall = harness.callsFor('editMessageText').at(-1);
    expect(String(detailCall?.payload.text)).toContain(
      'admin_receipt_duplicate_warning[short_id=prev]'
    );
    expect(extractCallbackDataList(detailCall?.payload.reply_markup)).toContain(
      'rcpt:vp:rec_1700000003_appr:1'
    );

    // Void prompt offers both void-only and void+disable buttons (all <= 64 bytes)
    harness.clearCalls();
    await harness.sendCallback('rcpt:vp:rec_1700000003_appr:1', { userId: 1 });
    const promptCall = harness.callsFor('editMessageText').at(-1);
    const promptCallbacks = extractCallbackDataList(promptCall?.payload.reply_markup);
    expect(promptCallbacks).toContain('rcpt:vc:rec_1700000003_appr:1:0');
    expect(promptCallbacks).toContain('rcpt:vc:rec_1700000003_appr:1:1');
    for (const cb of promptCallbacks) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }

    // Confirm void + disable purchased configs
    harness.clearCalls();
    await harness.sendCallback('rcpt:vc:rec_1700000003_appr:1:1', { userId: 1 });
    expect(voidApprovedTopup).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptId: 'rec_1700000003_appr',
        adminId: 1,
        disablePurchasedConfigs: true,
      })
    );
    expect(disableConfig).toHaveBeenCalledWith('cfg_purchased_1', 'panel_1');
    const resultText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(resultText).toContain('admin_receipt_void_success_with_disabled');
    const userNotice = harness.callsFor('sendMessage').find((c) => c.payload.chat_id === 5555);
    expect(String(userNotice?.payload.text)).toContain('receipt_result_voided_title');
  });

  it('renders voided receipt status, topup_void ledger entry, and topup_receipt_voided audit action in admin user dossier', async () => {
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      userService: {
        listReceiptsForUser: vi.fn().mockResolvedValue({
          receipts: [
            {
              id: 'rec_voided_77',
              telegramId: 5555,
              amount: 100_000,
              photoFileId: 'p_1',
              mediaType: 'photo',
              status: 'voided',
              reviewedBy: 1,
              createdAt: new Date('2026-10-01T10:00:00Z'),
            },
          ],
          total: 1,
          totalPages: 1,
          page: 1,
        }),
        listAuditLogsForUser: vi.fn().mockResolvedValue({
          logs: [
            {
              id: 'audit_void_1',
              actorTelegramId: 1,
              action: 'topup_receipt_voided',
              entityType: 'topup_receipt',
              entityId: 'rec_voided_77',
              targetTelegramId: 5555,
              metadata: JSON.stringify({ deductedAmount: 100_000 }),
              createdAt: new Date('2026-10-01T12:00:00Z'),
            },
          ],
          total: 1,
          totalPages: 1,
          page: 1,
        }),
      },
      walletService: {
        listTransactionsForUser: vi.fn().mockResolvedValue({
          transactions: [
            {
              id: 'tx_void_1',
              telegramId: 5555,
              amount: -100_000,
              balanceAfter: 0,
              type: 'topup_void',
              referenceId: 'void_rec_voided_77',
              description: 'Voided receipt',
              createdAt: new Date('2026-10-01T12:00:00Z'),
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

    await harness.sendCallback('admin:user:reports:receipts:5555:1', { userId: 1 });
    const receiptsText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(receiptsText).toContain('🚫');
    expect(receiptsText).toContain('admin_user_receipt_status_voided');
    expect(receiptsText).not.toContain('admin_user_receipt_status_approved');

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:ledger:5555:1', { userId: 1 });
    const ledgerText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(ledgerText).toContain('🚫');
    expect(ledgerText).toContain('tx_type_topup_void');

    harness.clearCalls();
    await harness.sendCallback('admin:user:reports:audit:5555:1', { userId: 1 });
    const auditText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(auditText).toContain('🚫');
    expect(auditText).toContain('admin_user_audit_action_receipt_voided');
  });

  describe('WebApp Admin API (/api/admin/receipts & void action)', () => {
    let app: FastifyInstance;
    const mockConfig = createTestConfig();
    let mocks: ReturnType<typeof createMockAdminServices>;

    beforeEach(async () => {
      mocks = createMockAdminServices();
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 99 });
      (mocks.mockServices as { botApi?: Api }).botApi = { sendMessage } as unknown as Api;
      (mocks.mockWalletService as Record<string, unknown>).listTopupsPage = vi.fn(async () => ({
        items: [
          {
            id: 'rec_web_dup',
            telegramId: 55555,
            amount: 100_000,
            status: 'pending',
            fileUniqueId: 'AQAD_web_1',
            fileSha256: 'sha256_web_1',
            duplicateOfReceiptId: 'rec_1700000000_prev',
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            createdAt: new Date().toISOString(),
            user: { username: 'testuser', firstName: 'User', lastName: null, balance: 50_000 },
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
        pendingCount: 1,
      }));
      (mocks.mockWalletService as Record<string, unknown>).voidApprovedTopup = vi.fn(
        async (params: {
          receiptId: string;
          adminId: number;
          reason?: string;
          disablePurchasedConfigs?: boolean;
          disableConfig?: (u: string, p?: string) => Promise<void>;
        }) => {
          if (params.receiptId === 'rec_pending_err') {
            throw new TopupVoidError('not_approved', params.receiptId, 'pending');
          }
          if (params.disablePurchasedConfigs && params.disableConfig) {
            await params.disableConfig('cfg_test', 'panel_1');
          }
          return {
            receiptId: params.receiptId,
            telegramId: 55555,
            originalAmount: 100_000,
            deductedAmount: 50_000,
            shortfallAmount: 50_000,
            disabledConfigs: params.disablePurchasedConfigs ? ['cfg_test'] : [],
            alreadyVoided: false,
          };
        }
      );
      (mocks.mockConfigService as Record<string, unknown>).disableConfig = vi.fn(async () => {});
      app = await createWebAppServer(mockConfig, mocks.mockServices);
    });

    afterEach(async () => {
      if (app) await app.close();
    });

    it('exposes duplicate & void fields in GET /api/admin/receipts and executes action=void via POST', async () => {
      const token = app.jwt.sign({ telegramId: 12345, role: 'admin' });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts?status=pending',
        cookies: { session: token },
      });
      expect(listRes.statusCode).toBe(200);
      const item = listRes.json().items[0];
      expect(item).toMatchObject({
        id: 'rec_web_dup',
        fileUniqueId: 'AQAD_web_1',
        fileSha256: 'sha256_web_1',
        duplicateOfReceiptId: 'rec_1700000000_prev',
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      });
      expect(String(item.duplicateWarning)).toContain('prev');

      // Void approved receipt with disablePurchasedConfigs
      const voidRes = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_approved/action',
        cookies: { session: token },
        payload: {
          action: 'void',
          reason: 'Chargeback',
          disablePurchasedConfigs: true,
        },
      });
      expect(voidRes.statusCode).toBe(200);
      expect(voidRes.json()).toMatchObject({
        success: true,
        result: {
          receiptId: 'rec_approved',
          deductedAmount: 50_000,
          shortfallAmount: 50_000,
          disabledConfigs: ['cfg_test'],
          alreadyVoided: false,
        },
      });
      expect(
        (mocks.mockConfigService as unknown as { disableConfig: ReturnType<typeof vi.fn> })
          .disableConfig
      ).toHaveBeenCalledWith('cfg_test', 'panel_1');

      // Non-approved receipt returns 400 with not_approved code
      const errRes = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_pending_err/action',
        cookies: { session: token },
        payload: { action: 'void' },
      });
      expect(errRes.statusCode).toBe(400);
      expect(errRes.json().code).toBe('not_approved');
    });
  });
});
