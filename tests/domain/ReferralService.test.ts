import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

function databaseWithSelectResults(selectResults: unknown[][]) {
  const queued = [...selectResults];
  const queryFn = () => {
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      for: vi.fn(() => query),
      limit: vi.fn().mockImplementation(() => Promise.resolve(queued.shift() ?? [])),
    };
    return query;
  };
  const updateFn = () => {
    const query = {
      set: vi.fn(() => query),
      where: vi.fn(() => query),
      returning: vi.fn().mockImplementation(() => Promise.resolve([{ balance: 1000 }])),
    };
    return query;
  };
  const insertFn = () => {
    const query = {
      values: vi.fn().mockResolvedValue([]),
    };
    return query;
  };
  const db = {
    select: vi.fn(queryFn),
    update: vi.fn(updateFn),
    insert: vi.fn(insertFn),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return db;
}

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

describe('ReferralService idempotency, snapshots and refund protection', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves only an exact stored referral code and never self-refers', async () => {
    const service = createService();
    getDbMock.mockReturnValue(
      databaseWithSelectResults([[{ telegramId: 77 }], [{ telegramId: 77 }]]) as never
    );

    await expect(service.resolveReferrerId('ref_77_realcode', 10)).resolves.toBe(77);
    await expect(service.resolveReferrerId('ref_77_realcode', 77)).resolves.toBeUndefined();
  });

  it('calculates bonus snapshot accurately for first purchase with referrer and cashback', async () => {
    const service = createService({ referral_bonus_toman: 15_000, cashback_percent: 5 });
    const mockTx = databaseWithSelectResults([
      // user lookup
      [{ referrerId: 888 }],
      // previous paid purchase lookup: none
      [],
    ]);

    const snapshot = await service.calculateBonusSnapshot(mockTx as never, 100, 200_000);
    expect(snapshot).toEqual({
      cashbackPercent: 5,
      cashbackAmount: 10_000,
      referrerTelegramId: 888,
      referralBonusAmount: 15_000,
    });
  });

  it('calculates bonus snapshot with zero referral bonus if user had previous paid purchase', async () => {
    const service = createService({ referral_bonus_toman: 15_000, cashback_percent: 5 });
    const mockTx = databaseWithSelectResults([
      // user lookup
      [{ referrerId: 888 }],
      // previous paid purchase lookup: found previous
      [{ id: 'tx_old' }],
    ]);

    const snapshot = await service.calculateBonusSnapshot(mockTx as never, 100, 200_000);
    expect(snapshot).toEqual({
      cashbackPercent: 5,
      cashbackAmount: 10_000,
      referrerTelegramId: null,
      referralBonusAmount: 0,
    });
  });

  it('settles bonus using immutable snapshot stored in intent rather than current settings', async () => {
    // Current setting has 20% cashback and 50,000 bonus, but intent snapshot has 10% and 10,000
    const service = createService({ referral_bonus_toman: 50_000, cashback_percent: 20 });
    const internals = service as unknown as {
      creditWalletInTransaction: (...args: unknown[]) => Promise<boolean>;
    };
    const credit = vi.spyOn(internals, 'creditWalletInTransaction').mockResolvedValue(true);
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
        // intent with snapshot
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
        // active refund check
        [],
      ]) as never
    );

    await service.processCompletedPurchase(10, 80_000, 'pi_snap_1');

    expect(credit).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        telegramId: 99,
        amount: 10_000,
        referenceId: 'ref_bonus_pi_snap_1',
        type: 'referral_bonus',
      })
    );
    expect(credit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        telegramId: 10,
        amount: 8_000,
        referenceId: 'cashback_pi_snap_1',
        type: 'cashback',
      })
    );
  });

  it('never credits bonus if purchase intent is marked refunded', async () => {
    const service = createService();
    const internals = service as unknown as {
      creditWalletInTransaction: (...args: unknown[]) => Promise<boolean>;
    };
    const credit = vi.spyOn(internals, 'creditWalletInTransaction').mockResolvedValue(true);
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
        // intent lookup returns empty because query filters isNull(refundedAt) AND status = 'completed'
        [],
      ]) as never
    );

    await service.processCompletedPurchase(10, 80_000, 'pi_refunded');
    expect(credit).not.toHaveBeenCalled();
  });

  it('never credits bonus if active refund intent exists for purchase', async () => {
    const service = createService();
    const internals = service as unknown as {
      creditWalletInTransaction: (...args: unknown[]) => Promise<boolean>;
    };
    const credit = vi.spyOn(internals, 'creditWalletInTransaction').mockResolvedValue(true);
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
        // intent lookup returns row
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
        // active refund check returns row
        [{ id: 'ri_1' }],
      ]) as never
    );

    await service.processCompletedPurchase(10, 80_000, 'pi_active_refund');
    expect(credit).not.toHaveBeenCalled();
  });

  it('does not update a balance when the deterministic credit reference already exists', async () => {
    const service = createService();
    const internals = service as unknown as {
      creditWalletInTransaction: (...args: unknown[]) => Promise<boolean>;
    };
    const select = vi.fn(() => {
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        limit: vi.fn().mockResolvedValue([{ id: 'already-recorded' }]),
      };
      return query;
    });
    const update = vi.fn();
    const tx = { select, update, insert: vi.fn() };

    await expect(
      internals.creditWalletInTransaction(tx, {
        telegramId: 10,
        amount: 8_000,
        type: 'cashback',
        referenceId: 'cashback_pi_1',
        description: 'retry',
      })
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
