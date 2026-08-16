import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import { getDb } from '../../src/infra/db.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

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

function createDbMock(queuedSelects: unknown[][]) {
  const queued = [...queuedSelects];
  const queryFn = () => {
    const query: any = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      for: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
        return Promise.resolve(queued.shift() ?? []).then(resolve, reject);
      },
    };
    return query;
  };
  const updateFn = () => {
    const query: any = {
      set: vi.fn(() => query),
      where: vi.fn(() => query),
      returning: vi.fn(() => query),
      then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
        return Promise.resolve([{ id: 'mock_up', balance: 50_000 }]).then(resolve, reject);
      },
    };
    return query;
  };
  const insertFn = () => {
    const query: any = {
      values: vi.fn(() => query),
      returning: vi.fn(() => query),
      then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
        return Promise.resolve([{ id: 'mock_in' }]).then(resolve, reject);
      },
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

describe('Snapshot Cashback / Referral Financial Terms — Goal 3', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calculates and returns integer financial snapshot terms at reservation time', async () => {
    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => {
        if (key === 'cashback_percent') return 7;
        if (key === 'referral_bonus_toman') return 12_500;
        return fb;
      }),
    } as unknown as TranslationService;
    const referralService = new ReferralService(translationService);

    const mockTx = createDbMock([
      [{ referrerId: 500 }], // User has referrer 500
      [], // No prior paid purchases
    ]);

    const snapshot = await referralService.calculateBonusSnapshot(mockTx as never, 1001, 75_000);
    expect(snapshot.cashbackPercent).toBe(7);
    // 7% of 75,000 = 5,250 integer Toman
    expect(snapshot.cashbackAmount).toBe(5_250);
    expect(snapshot.referrerTelegramId).toBe(500);
    expect(snapshot.referralBonusAmount).toBe(12_500);
  });

  it('settles bonus based on immutable snapshot even after global settings change drastically', async () => {
    // Current translation settings changed to 50% cashback and 100,000 Toman referral bonus
    const changedTranslationService = {
      getSettingNum: vi.fn((key: string, fb: number) => {
        if (key === 'cashback_percent') return 50;
        if (key === 'referral_bonus_toman') return 100_000;
        return fb;
      }),
    } as unknown as TranslationService;
    const referralService = new ReferralService(changedTranslationService);

    const internals = referralService as unknown as {
      creditWalletInTransaction: ReturnType<typeof vi.fn>;
    };
    const creditSpy = vi.fn().mockResolvedValue(true);
    internals.creditWalletInTransaction = creditSpy;

    // Intent was snapshotted with 5% cashback (2,500 Toman) and 10,000 referral bonus
    const db = createDbMock([
      [
        {
          id: 'pi_snap_immutable',
          status: 'completed',
          refundedAt: null,
          cashbackPercent: 5,
          cashbackAmount: 2_500,
          referrerTelegramId: 500,
          referralBonusAmount: 10_000,
        },
      ],
      [], // active refund check
    ]);
    getDbMock.mockReturnValue(db as never);

    await referralService.processCompletedPurchase(1001, 50_000, 'pi_snap_immutable');

    expect(creditSpy).toHaveBeenCalledTimes(2);
    // Referral bonus must be 10,000 (NOT the new 100,000)
    expect(creditSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        telegramId: 500,
        amount: 10_000,
        type: 'referral_bonus',
      })
    );
    // Cashback must be 2,500 (NOT the new 25,000 / 50%)
    expect(creditSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        telegramId: 1001,
        amount: 2_500,
        type: 'cashback',
      })
    );
  });

  it('safely handles legacy purchase intent rows with NULL snapshot columns', async () => {
    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => {
        if (key === 'cashback_percent') return 10;
        if (key === 'referral_bonus_toman') return 10_000;
        return fb;
      }),
    } as unknown as TranslationService;
    const referralService = new ReferralService(translationService);

    const internals = referralService as unknown as {
      creditWalletInTransaction: ReturnType<typeof vi.fn>;
    };
    const creditSpy = vi.fn().mockResolvedValue(true);
    internals.creditWalletInTransaction = creditSpy;

    // Legacy row where snapshot columns are NULL
    const db = createDbMock([
      [
        {
          id: 'pi_legacy_row',
          status: 'completed',
          refundedAt: null,
          cashbackPercent: null,
          cashbackAmount: null,
          referrerTelegramId: null,
          referralBonusAmount: null,
        },
      ],
      [], // active refund check
      [{ referrerId: 500 }], // User referrer lookup
      [{ intentId: 'pi_legacy_row' }], // First purchase match
    ]);
    getDbMock.mockReturnValue(db as never);

    await referralService.processCompletedPurchase(1001, 50_000, 'pi_legacy_row');

    expect(creditSpy).toHaveBeenCalledTimes(2);
    expect(creditSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        telegramId: 500,
        amount: 10_000,
        type: 'referral_bonus',
      })
    );
    expect(creditSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        telegramId: 1001,
        amount: 5_000,
        type: 'cashback',
      })
    );
  });
});
