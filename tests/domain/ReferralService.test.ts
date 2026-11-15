import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb, extractSqlText, pgUniqueViolationError } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createService(settings?: Record<string, number>): ReferralService {
  return new ReferralService({
    getSettingNum: vi.fn((key: string, fallback: number) => {
      if (settings && key in settings) return settings[key]!;
      if (key === 'referral_bonus_toman') return 10_000;
      if (key === 'cashback_percent') return 10;
      return fallback;
    }),
  } as unknown as TranslationService);
}

describe('ReferralService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves only exact stored referral codes and blocks self-referral', async () => {
    const service = createService();
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [[{ telegramId: 77 }], [{ telegramId: 77 }]],
      }).db as never
    );

    await expect(service.resolveReferrerId('ref_77_realcode', 10)).resolves.toBe(77);
    await expect(service.resolveReferrerId('ref_77_realcode', 77)).resolves.toBeUndefined();
    await expect(service.resolveReferrerId('   ', 10)).resolves.toBeUndefined();
  });

  it('calculates integer bonus snapshots accurately for first and repeat purchases', async () => {
    const service = createService({ referral_bonus_toman: 15_000, cashback_percent: 7 });

    const firstTx = createMockDb({
      selectResults: [[{ referrerId: 888 }], []],
    }).db;
    await expect(service.calculateBonusSnapshot(firstTx as never, 100, 75_000)).resolves.toEqual({
      cashbackPercent: 7,
      cashbackAmount: 5_250,
      referrerTelegramId: 888,
      referralBonusAmount: 15_000,
    });

    const repeatTx = createMockDb({
      selectResults: [[{ referrerId: 888 }], [{ id: 'tx_old' }]],
    }).db;
    await expect(service.calculateBonusSnapshot(repeatTx as never, 100, 200_000)).resolves.toEqual({
      cashbackPercent: 7,
      cashbackAmount: 14_000,
      referrerTelegramId: null,
      referralBonusAmount: 0,
    });
  });

  it('settles immutable snapshot bonuses atomically through real DB inserts & savepoints, then triggers post-commit hooks', async () => {
    const service = createService({ referral_bonus_toman: 50_000, cashback_percent: 20 });
    const invalidated: number[] = [];
    service.registerInvalidationHook((telegramId) => invalidated.push(telegramId));

    const { db, state } = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_snap_1',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: 99,
            referralBonusAmount: 10_000,
            cashbackAmount: 8_000,
            cashbackPercent: 10,
          },
        ],
        [], // no active refund
        [], // dedup lookup for ref_bonus_pi_snap_1
        [], // dedup lookup for cashback_pi_snap_1
      ],
      returningResults: [[{ balance: 110_000 }], [{ balance: 18_000 }]],
    });
    getDbMock.mockReturnValue(db as never);

    await service.processCompletedPurchase(10, 80_000, 'pi_snap_1');

    // Uses SQL savepoints around wallet transaction inserts to survive 23505 safely
    expect(state.executeCalls).toContain('SAVEPOINT sp_referral_wallet_credit');
    expect(state.executeCalls).toContain('RELEASE SAVEPOINT sp_referral_wallet_credit');

    // Credits immutable snapshot values (10,000 + 8,000), not updated global config (50,000 + 20%)
    expect(state.insertCalls.map((c) => c.values)).toEqual([
      expect.objectContaining({
        telegramId: 99,
        amount: 10_000,
        balanceAfter: 110_000,
        referenceId: 'ref_bonus_pi_snap_1',
        type: 'referral_bonus',
      }),
      expect.objectContaining({
        telegramId: 10,
        amount: 8_000,
        balanceAfter: 18_000,
        referenceId: 'cashback_pi_snap_1',
        type: 'cashback',
      }),
    ]);

    // Invalidation hook fired post-commit for both credited recipients
    expect(invalidated).toEqual([99, 10]);
  });

  it('handles legacy NULL snapshots vs partial-zero snapshots and blocks legacy bonus on repeat purchases', async () => {
    const service = createService({ referral_bonus_toman: 12_000, cashback_percent: 10 });

    // Partial snapshot where referralBonusAmount=0 & cashbackAmount=0 are explicit numbers must NOT fall back to legacy path
    const partialZeroDb = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_partial_zero',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: null,
            referralBonusAmount: 0,
            cashbackAmount: 0,
            cashbackPercent: 0,
          },
        ],
        [], // no active refund
      ],
    });
    getDbMock.mockReturnValue(partialZeroDb.db as never);
    await service.processCompletedPurchase(10, 50_000, 'pi_partial_zero');
    expect(partialZeroDb.state.insertCalls).toHaveLength(0);

    // True legacy NULL snapshot awards first purchase bonus + cashback
    const legacyFirstDb = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_legacy_first',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: null,
            referralBonusAmount: null,
            cashbackAmount: null,
            cashbackPercent: null,
          },
        ],
        [], // no active refund
        [{ referrerId: 500 }],
        [{ intentId: 'pi_legacy_first' }],
        [],
        [],
      ],
      returningResults: [[{ balance: 12_000 }], [{ balance: 5_000 }]],
    });
    getDbMock.mockReturnValue(legacyFirstDb.db as never);
    await service.processCompletedPurchase(10, 50_000, 'pi_legacy_first');
    expect(legacyFirstDb.state.insertCalls.map((c) => c.values)).toEqual([
      expect.objectContaining({ telegramId: 500, amount: 12_000, type: 'referral_bonus' }),
      expect.objectContaining({ telegramId: 10, amount: 5_000, type: 'cashback' }),
    ]);

    // Legacy NULL snapshot on later purchase skips referral bonus
    const legacyLaterDb = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_legacy_later',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: null,
            referralBonusAmount: null,
            cashbackAmount: null,
            cashbackPercent: null,
          },
        ],
        [], // no active refund
        [{ referrerId: 500 }],
        [{ intentId: 'pi_first_purchase' }],
        [],
      ],
      returningResults: [[{ balance: 8_000 }]],
    });
    getDbMock.mockReturnValue(legacyLaterDb.db as never);
    await service.processCompletedPurchase(10, 80_000, 'pi_legacy_later');
    expect(legacyLaterDb.state.insertCalls).toHaveLength(1);
    expect(legacyLaterDb.state.insertCalls[0]?.values).toMatchObject({
      telegramId: 10,
      amount: 8_000,
      type: 'cashback',
    });
  });

  it('skips bonus credit when refunded, active refund exists, or referenceId races on unique 23505 (rolling back savepoint without invalidation)', async () => {
    const service = createService();
    const invalidated: number[] = [];
    service.registerInvalidationHook((id) => invalidated.push(id));

    // Already refunded purchase -> intent select returns []
    const refundedDb = createMockDb({ selectResults: [[]] });
    getDbMock.mockReturnValue(refundedDb.db as never);
    await service.processCompletedPurchase(10, 80_000, 'pi_refunded');
    expect(refundedDb.state.insertCalls).toHaveLength(0);

    // Active refund intent -> skips inserts and stamps bonusesProcessedAt
    const activeRefundDb = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_active_refund',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: 99,
            referralBonusAmount: 10_000,
            cashbackAmount: 8_000,
            cashbackPercent: 10,
          },
        ],
        [{ id: 'ri_active_1', status: 'pending' }],
      ],
    });
    getDbMock.mockReturnValue(activeRefundDb.db as never);
    await service.processCompletedPurchase(10, 80_000, 'pi_active_refund');
    expect(activeRefundDb.state.insertCalls).toHaveLength(0);
    expect(activeRefundDb.state.updateCalls.some((c) => 'bonusesProcessedAt' in c.set)).toBe(true);

    // Duplicate referenceId discovered on pre-check OR 23505 savepoint rollback -> does NOT skip transaction or fire hook
    const race23505Db = createMockDb({
      selectResults: [
        [
          {
            id: 'pi_race',
            status: 'completed',
            refundedAt: null,
            referrerTelegramId: 99,
            referralBonusAmount: 10_000,
            cashbackAmount: 0,
            cashbackPercent: 0,
          },
        ],
        [], // no active refund
        [], // pre-check misses concurrent writer
      ],
      returningResults: [[{ balance: 20_000 }]],
      insertError: () => pgUniqueViolationError('duplicate key wallet_transactions_ref_unique'),
    });
    getDbMock.mockReturnValue(race23505Db.db as never);

    await expect(service.processCompletedPurchase(10, 80_000, 'pi_race')).resolves.toBeUndefined();
    expect(race23505Db.state.executeCalls).toEqual([
      'SAVEPOINT sp_referral_wallet_credit',
      'ROLLBACK TO SAVEPOINT sp_referral_wallet_credit',
    ]);
    // Hook does not fire when 23505 prevents transaction credit!
    expect(invalidated).toEqual([]);
  });

  it('aggregates referral stats excluding refunded/zero-amount buyers in activeBuyers SQL', async () => {
    const service = createService();
    const { db, state } = createMockDb({
      selectResults: [[{ count: 5 }], [{ count: 3 }], [{ sum: 30_000 }], [{ sum: 15_000 }]],
    });
    getDbMock.mockReturnValue(db as never);

    await expect(service.getReferralStats(12345)).resolves.toEqual({
      totalInvited: 5,
      activeBuyers: 3,
      totalReferralBonus: 30_000,
      totalCashback: 15_000,
    });

    const activeBuyersWhereSql = extractSqlText(state.selectCalls[1]?.where);
    expect(activeBuyersWhereSql).toContain('refunded_at is null');
    expect(activeBuyersWhereSql).toContain('amount >');
  });
});
