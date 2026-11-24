import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PendingTopupReceiptError,
  PurchaseInProgressError,
  WalletService,
} from '../../src/domain/services/WalletService.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import { createMockDb, extractSqlText } from './_helpers/mockDb.js';

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

describe('WalletService', () => {
  const getDbMock = vi.mocked(getDb);
  let walletService: WalletService;
  let mockRebeccaService: {
    createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    resetUserTraffic: ReturnType<typeof vi.fn>;
  };
  let mockTranslationService: TranslationService;
  let mockReferralService: ReferralService;
  let mockPromoService: PromoService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRebeccaService = {
      createUser: vi.fn().mockImplementation(async (payload: { note?: string }) => ({
        username: 'cfg_1',
        status: 'active',
        data_limit: 10 * 1024 ** 3,
        expire: Math.floor(Date.now() / 1000) + 30 * 86400,
        created_at: '2026-01-01T00:00:00Z',
        subscription_url: 'https://sub.example.test/cfg_1',
        note: payload.note ?? null,
      })),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      deleteUser: vi.fn(),
      resetUserTraffic: vi.fn(),
    };
    mockTranslationService = {
      getSettingNum: vi.fn(() => 1),
      resolveLocale: vi.fn(() => 'en'),
    } as unknown as TranslationService;
    mockReferralService = {
      resolveReferrerId: vi.fn().mockResolvedValue(undefined),
      calculateBonusSnapshot: vi.fn().mockResolvedValue({
        cashbackPercent: 0,
        cashbackAmount: 0,
        referrerTelegramId: null,
        referralBonusAmount: 0,
      }),
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReferralService;
    mockPromoService = {
      reserveForPurchase: vi.fn(),
      finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
      releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
    } as unknown as PromoService;

    walletService = new WalletService(
      mockRebeccaService as unknown as RebeccaService,
      mockTranslationService,
      mockReferralService,
      mockPromoService
    );
  });

  describe('getOrCreateUser & write throttling', () => {
    it('skips DB writes when unchanged within 10 minutes, preserves omitted fields, and clears explicit null fields', async () => {
      const recentLastSeen = new Date(Date.now() - 2 * 60 * 1000);
      const existingUser = {
        telegramId: 12345,
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Example',
        locale: 'fa',
        localeManual: false,
        lastSeenAt: recentLastSeen,
        balance: 10_000,
      };

      const unchangedDb = createMockDb({ selectResults: [[existingUser]] });
      getDbMock.mockReturnValue(unchangedDb.db as never);
      await expect(
        walletService.getOrCreateUser(12345, 'alice', 'Alice', 'Example', undefined, 'fa')
      ).resolves.toEqual(existingUser);
      expect(unchangedDb.state.updateCalls).toHaveLength(0);

      // Omitted fields keep stored values and hit cached user without extra DB read
      await expect(walletService.getOrCreateUser(12345)).resolves.toEqual(existingUser);
      expect(unchangedDb.state.selectCalls).toHaveLength(1);
      expect(unchangedDb.state.updateCalls).toHaveLength(0);

      // Explicit null clears optional field and forces DB update
      const clearDb = createMockDb({
        selectResults: [[existingUser]],
        returningResults: [[{ ...existingUser, username: null }]],
      });
      getDbMock.mockReturnValue(clearDb.db as never);
      await walletService.getOrCreateUser(12345, null, 'Alice', null, undefined, 'fa');
      expect(clearDb.state.updateCalls[0]?.set).toMatchObject({ username: null, lastName: null });
    });

    it('updates on profile change within 10m, updates lastSeenAt after 10m, and persists configured default locale for new users', async () => {
      const recentLastSeen = new Date(Date.now() - 2 * 60 * 1000);
      const existingUser = {
        telegramId: 12345,
        username: 'alice',
        firstName: 'Alice',
        lastName: null,
        locale: 'fa',
        localeManual: false,
        lastSeenAt: recentLastSeen,
        balance: 10_000,
      };
      const changedDb = createMockDb({
        selectResults: [[existingUser]],
        returningResults: [[{ ...existingUser, firstName: 'AliceUpdated' }]],
      });
      getDbMock.mockReturnValue(changedDb.db as never);
      const updated = await walletService.getOrCreateUser(
        12345,
        'alice',
        'AliceUpdated',
        undefined,
        undefined,
        'fa'
      );
      expect(changedDb.state.updateCalls).toHaveLength(1);
      expect(updated.firstName).toBe('AliceUpdated');

      // Stale lastSeenAt triggers timestamp refresh
      const oldUser = { ...existingUser, lastSeenAt: new Date(Date.now() - 15 * 60 * 1000) };
      const staleDb = createMockDb({
        selectResults: [[oldUser]],
        returningResults: [[{ ...oldUser, lastSeenAt: new Date() }]],
      });
      getDbMock.mockReturnValue(staleDb.db as never);
      await walletService.getOrCreateUser(12345, 'alice', 'Alice', null, undefined, 'fa');
      expect(staleDb.state.updateCalls[0]?.set).toHaveProperty('lastSeenAt');

      // Brand-new user without Telegram locale persists translationService.resolveLocale()
      const createDb = createMockDb({
        selectResults: [[]],
        returningResults: [[{ telegramId: 4321, locale: 'en' }]],
      });
      getDbMock.mockReturnValue(createDb.db as never);
      await expect(walletService.getOrCreateUser(4321)).resolves.toMatchObject({ locale: 'en' });
      expect(mockTranslationService.resolveLocale).toHaveBeenCalledWith();
      expect(createDb.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 4321,
        locale: 'en',
      });
    });
  });

  describe('Topup receipts & admin listing', () => {
    it('validates topup amounts, serializes duplicate pending receipts, and approves/rejects atomically', async () => {
      const panelRegistry = {
        resolveTarget: vi.fn(),
        getEnabledPanelIds: vi.fn(() => []),
      } as unknown as RebeccaPanelRegistry;
      const service = new WalletService(
        panelRegistry,
        mockTranslationService,
        mockReferralService,
        mockPromoService
      );

      getDbMock.mockReturnValue(createMockDb().db as never);
      await expect(service.submitTopupReceipt(1001, -1, 'photo')).rejects.toThrow(
        'INVALID_TOPUP_AMOUNT'
      );

      const submitDb = createMockDb({
        selectResults: [[{ telegramId: 1001 }], []],
      });
      getDbMock.mockReturnValue(submitDb.db as never);
      await expect(service.submitTopupReceipt(1001, 100_000, 'photo-file')).resolves.toMatch(
        /^rec_/u
      );
      expect(submitDb.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 1001,
        amount: 100_000,
        photoFileId: 'photo-file',
        status: 'pending',
      });

      const dupDb = createMockDb({
        selectResults: [[{ telegramId: 1001 }], [{ id: 'rec_pending' }]],
      });
      getDbMock.mockReturnValue(dupDb.db as never);
      await expect(service.submitTopupReceipt(1001, 200_000, 'other')).rejects.toBeInstanceOf(
        PendingTopupReceiptError
      );

      const approveDb = createMockDb({
        returningResults: [
          [{ id: 'rec_1', telegramId: 999, amount: 50_000 }],
          [{ balance: 50_000 }],
        ],
      });
      getDbMock.mockReturnValue(approveDb.db as never);
      await expect(service.approveTopup('rec_1', 1)).resolves.toEqual({
        telegramId: 999,
        amount: 50_000,
      });

      const rejectDb = createMockDb({
        returningResults: [[{ id: 'rec_2', telegramId: 888 }]],
      });
      getDbMock.mockReturnValue(rejectDb.db as never);
      await expect(service.rejectTopup('rec_2', 1)).resolves.toEqual({ telegramId: 888 });
    });

    it('escapes LIKE wildcards, filters numeric vs text search safely, and clamps page bounds in listTopupsPage', async () => {
      const now = new Date();
      const topupRow = {
        id: 'rec_escaped',
        telegramId: 55,
        amount: 10_000,
        photoFileId: 'p1',
        mediaType: 'photo',
        status: 'pending',
        reviewedBy: null,
        createdAt: now,
        updatedAt: now,
        username: 'a_b%c',
        firstName: 'Ali',
        lastName: null,
        userBalance: 0,
      };
      // page: 5 > totalPages: 1 triggers clamp recursion to page: 1 (3 selects per call)
      const textSearchDb = createMockDb({
        selectResults: [
          [{ value: 1 }],
          [{ value: 1 }],
          [topupRow],
          [{ value: 1 }],
          [{ value: 1 }],
          [topupRow],
        ],
      });
      getDbMock.mockReturnValue(textSearchDb.db as never);

      const res = await walletService.listTopupsPage({
        page: 5,
        pageSize: 200,
        status: 'all',
        search: '50%_\\test',
      });
      // page=5 > totalPages=1 -> clamps & returns page 1 cleanly when totalRow matches fallback
      expect(res.page).toBe(1);
      expect(res.pendingCount).toBe(1);

      const whereSql = extractSqlText(textSearchDb.state.selectCalls[0]?.where);
      expect(whereSql).toContain('ESCAPE');
      // Search term is non-numeric -> no exact telegram_id equality term added
      expect(whereSql).not.toContain('telegram_id = ');

      // Positive safe-integer search matches exact telegramId as well
      const numericSearchDb = createMockDb({
        selectResults: [[{ value: 0 }], [{ value: 0 }], []],
      });
      getDbMock.mockReturnValue(numericSearchDb.db as never);
      await walletService.listTopupsPage({ search: '123456', status: 'pending' });
      const numericSql = extractSqlText(numericSearchDb.state.selectCalls[0]?.where);
      expect(numericSql).toContain('telegram_id');
    });
  });

  describe('adjustBalanceAdmin & listTransactionsForUser', () => {
    it('audits add, deduct, set, replays idempotent referenceId, and guards against reserved balance', async () => {
      const addDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
        returningResults: [[{ balance: 125 }]],
      });
      getDbMock.mockReturnValue(addDb.db as never);
      await expect(
        walletService.adjustBalanceAdmin({
          telegramId: 4321,
          operation: 'add',
          amount: 25,
          adminId: 99,
          description: 'Admin deposit',
        })
      ).resolves.toBe(125);
      expect(addDb.state.insertCalls[0]?.values).toMatchObject({
        amount: 25,
        balanceAfter: 125,
        type: 'admin_adjustment',
      });

      const deductDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
        returningResults: [[{ balance: 40 }]],
      });
      getDbMock.mockReturnValue(deductDb.db as never);
      await expect(
        walletService.adjustBalanceAdmin({
          telegramId: 4321,
          operation: 'deduct',
          amount: 60,
          adminId: 99,
          description: 'Admin deduct',
        })
      ).resolves.toBe(40);
      expect(deductDb.state.insertCalls[0]?.values).toMatchObject({
        amount: -60,
        balanceAfter: 40,
        type: 'admin_adjustment',
      });

      const setDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
        returningResults: [[{ balance: 50 }]],
      });
      getDbMock.mockReturnValue(setDb.db as never);
      await expect(
        walletService.adjustBalanceAdmin({
          telegramId: 4321,
          operation: 'set',
          amount: 50,
          adminId: 99,
          description: 'Admin set',
        })
      ).resolves.toBe(50);
      expect(setDb.state.insertCalls[0]?.values).toMatchObject({
        amount: -50,
        balanceAfter: 50,
        type: 'admin_adjustment',
      });

      // Idempotent replay with referenceId applies balance mutation only once
      const replayDb = createMockDb({
        selectResults: [
          [{ telegramId: 4321, balance: 100, reservedBalance: 20 }],
          [],
          [{ telegramId: 4321, balance: 125, reservedBalance: 20 }],
          [
            {
              telegramId: 4321,
              amount: 25,
              balanceAfter: 125,
              type: 'admin_adjustment',
              description: 'Admin 99: add; Quick topup',
            },
          ],
        ],
        returningResults: [[{ balance: 125 }]],
      });
      getDbMock.mockReturnValue(replayDb.db as never);
      const adjustment = {
        telegramId: 4321,
        operation: 'add' as const,
        amount: 25,
        adminId: 99,
        description: 'Quick topup',
        referenceId: 'admin_quick_topup_deadbeef',
      };
      await expect(walletService.adjustBalanceAdmin(adjustment)).resolves.toBe(125);
      await expect(walletService.adjustBalanceAdmin(adjustment)).resolves.toBe(125);
      expect(replayDb.state.updateCalls).toHaveLength(1);
      expect(replayDb.state.insertCalls).toHaveLength(2);

      // Guard below reserved funds
      const guardDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 80 }]],
      });
      getDbMock.mockReturnValue(guardDb.db as never);
      await expect(
        walletService.adjustBalanceAdmin({
          telegramId: 4321,
          operation: 'deduct',
          amount: 30,
          adminId: 99,
          description: 'Over-deduct',
        })
      ).rejects.toThrow('ADMIN_BALANCE_BELOW_RESERVED');
      expect(guardDb.state.updateCalls).toHaveLength(0);
    });

    it('invalidates userCache strictly post-commit across admin adjustments, topup approval, transfers, and saga execution', async () => {
      const cachedUser = {
        telegramId: 4321,
        username: 'cached',
        firstName: 'Cached',
        lastName: null,
        locale: 'en',
        localeManual: false,
        lastSeenAt: new Date(),
        balance: 100,
        reservedBalance: 0,
      };
      // Warm cache via public getOrCreateUser
      const warmDb = createMockDb({ selectResults: [[cachedUser]] });
      getDbMock.mockReturnValue(warmDb.db as never);
      await walletService.getOrCreateUser(4321);
      // 2nd call hits cache (selectCalls remains 1)
      await walletService.getOrCreateUser(4321);
      expect(warmDb.state.selectCalls).toHaveLength(1);

      // Failed transaction must NOT invalidate cached entry
      const rollbackDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 0 }]],
        returningResults: [[{ balance: 150 }]],
        insertError: new Error('DB_WRITE_FAILED'),
      });
      getDbMock.mockReturnValue(rollbackDb.db as never);
      await expect(
        walletService.adjustBalanceAdmin({
          telegramId: 4321,
          operation: 'add',
          amount: 50,
          adminId: 99,
          description: 'Fails on insert',
        })
      ).rejects.toThrow('DB_WRITE_FAILED');
      expect(rollbackDb.state.rolledBackTransactions).toBe(1);

      // Cache still warm -> does not hit DB
      const checkStillWarmDb = createMockDb({ selectResults: [[cachedUser]] });
      getDbMock.mockReturnValue(checkStillWarmDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(checkStillWarmDb.state.selectCalls).toHaveLength(0);

      // Successful adjustBalanceAdmin invalidates post-commit
      const successAdjustDb = createMockDb({
        selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 0 }]],
        returningResults: [[{ balance: 150 }]],
      });
      getDbMock.mockReturnValue(successAdjustDb.db as never);
      await walletService.adjustBalanceAdmin({
        telegramId: 4321,
        operation: 'add',
        amount: 50,
        adminId: 99,
        description: 'Commits',
      });
      const afterAdjustDb = createMockDb({ selectResults: [[{ ...cachedUser, balance: 150 }]] });
      getDbMock.mockReturnValue(afterAdjustDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(afterAdjustDb.state.selectCalls).toHaveLength(1);

      // Successful approveTopup invalidates post-commit
      const approveDb = createMockDb({
        returningResults: [[{ id: 'rec_ok', telegramId: 4321, amount: 50 }], [{ balance: 200 }]],
      });
      getDbMock.mockReturnValue(approveDb.db as never);
      await walletService.approveTopup('rec_ok', 1);
      const afterApproveDb = createMockDb({ selectResults: [[{ ...cachedUser, balance: 200 }]] });
      getDbMock.mockReturnValue(afterApproveDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(afterApproveDb.state.selectCalls).toHaveLength(1);

      // PurchaseInProgressError during executePurchaseSaga skips invalidation; settled saga invalidates
      const pendingDb = createMockDb({ selectResults: [[{ id: 'pi_pending' }]] });
      getDbMock.mockReturnValue(pendingDb.db as never);
      await expect(
        walletService.executePurchaseSaga({
          telegramId: 4321,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'cfg_1',
          gbAmount: 10,
          durationDays: 30,
        })
      ).rejects.toBeInstanceOf(PurchaseInProgressError);
      const stillCachedDb = createMockDb({ selectResults: [[cachedUser]] });
      getDbMock.mockReturnValue(stillCachedDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(stillCachedDb.state.selectCalls).toHaveLength(0);

      // Non-PurchaseInProgressError failure during executePurchaseSaga DOES invalidate cache
      const failedSagaDb = createMockDb({
        selectResults: [[]],
        returningResults: [[]],
      });
      getDbMock.mockReturnValue(failedSagaDb.db as never);
      await expect(
        walletService.executePurchaseSaga({
          telegramId: 4321,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'cfg_1',
          gbAmount: 10,
          durationDays: 30,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');
      const rewarmAfterFailureDb = createMockDb({ selectResults: [[cachedUser]] });
      getDbMock.mockReturnValue(rewarmAfterFailureDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(rewarmAfterFailureDb.state.selectCalls).toHaveLength(1);

      // Settled successful executePurchaseSaga ALSO invalidates cache
      const committedSagaDb = createMockDb({
        selectResults: [[]],
        returningResults: [[{ telegramId: 4321 }], [{ id: 'pi_ok' }], [{ balance: 50_000 }]],
      });
      getDbMock.mockReturnValue(committedSagaDb.db as never);
      await expect(
        walletService.executePurchaseSaga({
          telegramId: 4321,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'cfg_1',
          gbAmount: 10,
          durationDays: 30,
        })
      ).resolves.toMatchObject({ success: true, configUsername: 'cfg_1' });
      const rewarmAfterCommitDb = createMockDb({
        selectResults: [[{ ...cachedUser, balance: 50_000 }]],
      });
      getDbMock.mockReturnValue(rewarmAfterCommitDb.db as never);
      await walletService.getOrCreateUser(4321);
      expect(rewarmAfterCommitDb.state.selectCalls).toHaveLength(1);
    });

    it('paginates wallet transactions and clamps invalid page and pageSize bounds', async () => {
      const mockRows = [
        {
          id: 'tx_1',
          telegramId: 100,
          amount: 50_000,
          balanceAfter: 50_000,
          type: 'topup',
          description: 'Topup receipt approved',
          createdAt: new Date('2026-08-28T12:00:00Z'),
        },
      ];
      const db = createMockDb({
        selectResults: [[{ count: 1 }], mockRows],
      });
      getDbMock.mockReturnValue(db.db as never);

      const res = await walletService.listTransactionsForUser(100, Number.NaN, 500);
      expect(res).toEqual({
        transactions: mockRows,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      // pageSize=500 clamped down to 50; NaN page sanitized to 1 (offset 0)
      expect(db.state.selectCalls[1]?.limit).toBe(50);
      expect(db.state.selectCalls[1]?.offset).toBe(0);
    });
  });

  describe('transferBalance', () => {
    it('transfers balance atomically, writes debit/credit/audit rows, and invalidates both user caches post-commit', async () => {
      const sender = {
        telegramId: 100,
        username: 'sender',
        firstName: 'Sender',
        lastName: null,
        locale: 'en',
        localeManual: false,
        lastSeenAt: new Date(),
        balance: 50_000,
        reservedBalance: 0,
        isBanned: false,
      };
      const recipient = {
        telegramId: 200,
        username: 'recv',
        firstName: 'Recv',
        lastName: null,
        locale: 'en',
        localeManual: false,
        lastSeenAt: new Date(),
        balance: 10_000,
        reservedBalance: 0,
        isBanned: false,
      };

      // Warm caches for both sender & recipient
      const warmDb = createMockDb({ selectResults: [[sender], [recipient]] });
      getDbMock.mockReturnValue(warmDb.db as never);
      await walletService.getOrCreateUser(100);
      await walletService.getOrCreateUser(200);

      // Failed transaction must NOT invalidate either cache
      const failTransferDb = createMockDb({
        selectResults: [[sender], [recipient]],
        returningResults: [[{ balance: 30_000 }], [{ balance: 30_000 }]],
        insertError: new Error('AUDIT_INSERT_FAIL'),
      });
      getDbMock.mockReturnValue(failTransferDb.db as never);
      await expect(
        walletService.transferBalance({
          fromTelegramId: 100,
          toTelegramId: 200,
          amount: 20_000,
          description: 'Gift',
        })
      ).rejects.toThrow('AUDIT_INSERT_FAIL');

      const stillWarmDb = createMockDb({ selectResults: [[sender], [recipient]] });
      getDbMock.mockReturnValue(stillWarmDb.db as never);
      await walletService.getOrCreateUser(100);
      await walletService.getOrCreateUser(200);
      expect(stillWarmDb.state.selectCalls).toHaveLength(0);

      // Committed transfer invalidates both caches and records debit/credit/audit
      const okTransferDb = createMockDb({
        selectResults: [[sender], [recipient]],
        returningResults: [[{ balance: 30_000 }], [{ balance: 30_000 }]],
      });
      getDbMock.mockReturnValue(okTransferDb.db as never);
      const result = await walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 20_000,
        description: 'Gift',
      });
      expect(result).toMatchObject({
        success: true,
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 20_000,
        fromBalanceAfter: 30_000,
        toBalanceAfter: 30_000,
      });
      expect(okTransferDb.state.insertCalls.map((c) => c.values)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            telegramId: 100,
            amount: -20_000,
            balanceAfter: 30_000,
            type: 'transfer_sent',
            description: 'Transfer to 200: Gift',
          }),
          expect.objectContaining({
            telegramId: 200,
            amount: 20_000,
            balanceAfter: 30_000,
            type: 'transfer_received',
            description: 'Transfer from 100: Gift',
          }),
          expect.objectContaining({
            actorTelegramId: 100,
            action: 'wallet_transfer',
            targetTelegramId: 200,
          }),
        ])
      );

      // Caches are now invalidated -> re-queries DB for both
      const reloadDb = createMockDb({ selectResults: [[sender], [recipient]] });
      getDbMock.mockReturnValue(reloadDb.db as never);
      await walletService.getOrCreateUser(100);
      await walletService.getOrCreateUser(200);
      expect(reloadDb.state.selectCalls).toHaveLength(2);
    });

    it('rejects self-transfers, invalid amounts, insufficient funds, banned users, missing targets, and duplicate referenceIds', async () => {
      await expect(
        walletService.transferBalance({ fromTelegramId: 100, toTelegramId: 100, amount: 5_000 })
      ).rejects.toThrow('TRANSFER_TO_SELF');
      for (const badAmount of [0, -1000, 1.5]) {
        await expect(
          walletService.transferBalance({
            fromTelegramId: 100,
            toTelegramId: 200,
            amount: badAmount,
          })
        ).rejects.toThrow('INVALID_TRANSFER_AMOUNT');
      }

      const valid = (overrides: Record<string, unknown> = {}) => ({
        telegramId: 100,
        balance: 50_000,
        reservedBalance: 0,
        isBanned: false,
        ...overrides,
      });

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [
            [valid({ balance: 15_000, reservedBalance: 10_000 })],
            [valid({ telegramId: 200, balance: 0 })],
          ],
        }).db as never
      );
      await expect(
        walletService.transferBalance({ fromTelegramId: 100, toTelegramId: 200, amount: 10_000 })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[valid({ isBanned: true })], [valid({ telegramId: 200, balance: 0 })]],
        }).db as never
      );
      await expect(
        walletService.transferBalance({ fromTelegramId: 100, toTelegramId: 200, amount: 5_000 })
      ).rejects.toThrow('SENDER_BANNED');

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[valid()], [valid({ telegramId: 200, isBanned: true, balance: 0 })]],
        }).db as never
      );
      await expect(
        walletService.transferBalance({ fromTelegramId: 100, toTelegramId: 200, amount: 5_000 })
      ).rejects.toThrow('TRANSFER_TARGET_BANNED');

      getDbMock.mockReturnValue(createMockDb({ selectResults: [[valid()], []] }).db as never);
      await expect(
        walletService.transferBalance({ fromTelegramId: 100, toTelegramId: 200, amount: 5_000 })
      ).rejects.toThrow('TRANSFER_TARGET_NOT_FOUND');

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[valid()], [valid({ telegramId: 200 })], [{ id: 'tx_existing' }]],
        }).db as never
      );
      await expect(
        walletService.transferBalance({
          fromTelegramId: 100,
          toTelegramId: 200,
          amount: 5_000,
          referenceId: 'ref_123',
        })
      ).rejects.toThrow('TRANSFER_ALREADY_PROCESSED');
    });
  });

  describe('getDashboardStats', () => {
    it('computes net topup revenue (excluding voided receipts) and net sales (excluding refunds)', async () => {
      const statsDb = createMockDb({
        selectResults: [
          [{ value: 42 }],
          [{ value: 250_000 }],
          [{ value: 80_000 }],
          [{ value: 190_000 }],
          [{ value: 420_000 }],
          [{ value: 15_000 }],
          [{ value: 5_000 }],
          [{ value: 18 }],
          [{ value: 4 }],
          [{ value: 3 }],
        ],
      });
      getDbMock.mockReturnValue(statsDb.db as never);

      const stats = await walletService.getDashboardStats();

      expect(stats).toEqual({
        totalUsers: 42,
        totalSales: 250_000,
        dailyRevenue: 80_000,
        weeklyRevenue: 190_000,
        monthlyRevenue: 420_000,
        totalReferralBonus: 15_000,
        totalCashback: 5_000,
        activeSubscriptions: 18,
        inactiveSubscriptions: 4,
        pendingReceipts: 3,
      });

      const salesWhere = extractSqlText(statsDb.state.selectCalls[1]?.where);
      expect(salesWhere).toContain('purchase');
      expect(salesWhere).toContain('refunded');
      expect(salesWhere).toContain('refund_');

      for (const idx of [2, 3, 4]) {
        const revWhere = extractSqlText(statsDb.state.selectCalls[idx]?.where);
        expect(revWhere).toContain('topup');
        expect(revWhere).toContain('voided');
        expect(revWhere).toContain('topup_void');
        expect(revWhere).toContain('void_');
      }

      // Clamps anomalous negative sums to zero instead of flipping sign with Math.abs
      const negativeDb = createMockDb({
        selectResults: [
          [{ value: 1 }],
          [{ value: -10 }],
          [{ value: -50 }],
          [{ value: -20 }],
          [{ value: -5 }],
          [{ value: 0 }],
          [{ value: 0 }],
          [{ value: 0 }],
          [{ value: 0 }],
          [{ value: 0 }],
        ],
      });
      getDbMock.mockReturnValue(negativeDb.db as never);
      const clamped = await walletService.getDashboardStats();
      expect(clamped).toMatchObject({
        totalSales: 0,
        dailyRevenue: 0,
        weeklyRevenue: 0,
        monthlyRevenue: 0,
      });
    });
  });
});
