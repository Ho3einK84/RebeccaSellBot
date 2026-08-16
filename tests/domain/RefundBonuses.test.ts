import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import { RefundService } from '../../src/domain/services/RefundService.js';
import { getDb } from '../../src/infra/db.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';

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
  const deleteFn = () => {
    const query: any = {
      where: vi.fn(() => query),
      returning: vi.fn(() => query),
      then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
        return Promise.resolve([{ id: 'mock_del' }]).then(resolve, reject);
      },
    };
    return query;
  };
  const db = {
    select: vi.fn(queryFn),
    update: vi.fn(updateFn),
    insert: vi.fn(insertFn),
    delete: vi.fn(deleteFn),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return db;
}

describe('Refund & Bonus Invariants — Goal 2', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('never processes cashback or referral bonus if purchase intent has refunded_at set', async () => {
    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => fb),
    } as unknown as TranslationService;
    const referralService = new ReferralService(translationService);

    const internals = referralService as unknown as {
      creditWalletInTransaction: ReturnType<typeof vi.fn>;
    };
    const creditSpy = vi.fn().mockResolvedValue(true);
    internals.creditWalletInTransaction = creditSpy;

    // DB select for purchase intent with status='completed' AND refundedAt IS NULL returns empty
    const db = createDbMock([
      [], // intent lookup is empty because refundedAt IS NOT NULL
    ]);
    getDbMock.mockReturnValue(db as never);

    await referralService.processCompletedPurchase(1001, 50_000, 'pi_refunded_1');
    expect(creditSpy).not.toHaveBeenCalled();
  });

  it('cancels pending bonuses if active refund intent is found during bonus settlement', async () => {
    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => fb),
    } as unknown as TranslationService;
    const referralService = new ReferralService(translationService);

    const internals = referralService as unknown as {
      creditWalletInTransaction: ReturnType<typeof vi.fn>;
    };
    const creditSpy = vi.fn().mockResolvedValue(true);
    internals.creditWalletInTransaction = creditSpy;

    const db = createDbMock([
      // 1. Purchase intent found
      [
        {
          id: 'pi_in_refund_1',
          status: 'completed',
          refundedAt: null,
          referrerTelegramId: 99,
          referralBonusAmount: 10_000,
          cashbackAmount: 5_000,
          cashbackPercent: 10,
        },
      ],
      // 2. Active refund intent found!
      [{ id: 'ri_active_1', status: 'pending' }],
    ]);
    getDbMock.mockReturnValue(db as never);

    await referralService.processCompletedPurchase(1001, 50_000, 'pi_in_refund_1');
    expect(creditSpy).not.toHaveBeenCalled();
    // Verify purchase intent bonusesProcessedAt is marked to prevent future retries
    expect(db.update).toHaveBeenCalled();
  });

  it('withholds already-credited cashback during refund quote and execution', async () => {
    const mockRebecca = {
      getUser: vi.fn().mockResolvedValue({
        username: 'alice_refund',
        used_traffic: 0,
        lifetime_used_traffic: 0,
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
      }),
      deleteUser: vi.fn().mockResolvedValue({ status: 'deleted' }),
    } as unknown as RebeccaService;

    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => fb),
    } as unknown as TranslationService;
    const refundService = new RefundService(mockRebecca, translationService);

    const localConfig = {
      id: 'uc_alice',
      telegramId: 1001,
      panelId: 'legacy',
      configUsername: 'alice_refund',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };
    const initialPurchase = {
      id: 'pi_init_1',
      telegramId: 1001,
      panelId: 'legacy',
      amount: 100_000,
      configUsername: 'alice_refund',
      type: 'new_config',
      status: 'completed',
      completedAt: new Date(Date.now() - 3600_000), // 1 hour ago (within 24h window)
      refundedAt: null,
    };

    // Quote query mock:
    // 1. userConfigs
    // 2. initial purchase intent
    // 3. renewal intents check (empty)
    // 4. refund intents check (empty)
    // 5. referral reward check (empty)
    // 6. cashback transaction check (found 10,000 cashback)
    const db = createDbMock([
      [localConfig],
      [initialPurchase],
      [], // existingRefund
      [], // referralReward
      [{ id: 'tx_cb_1', amount: 10_000 }], // cashback
    ]);
    getDbMock.mockReturnValue(db as never);

    const quote = await refundService.quote(1001, 'uc_alice');
    expect(quote.eligible).toBe(true);
    if (quote.eligible) {
      expect(quote.grossAmount).toBe(100_000);
      expect(quote.cashbackWithheld).toBe(10_000);
      expect(quote.refundAmount).toBe(90_000);
    }
  });

  it('rejects refund quote if a referral reward was attached to the initial purchase', async () => {
    const mockRebecca = {
      getUser: vi.fn().mockResolvedValue({
        username: 'alice_refund',
        used_traffic: 0,
        lifetime_used_traffic: 0,
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
      }),
    } as unknown as RebeccaService;

    const translationService = {
      getSettingNum: vi.fn((key: string, fb: number) => fb),
    } as unknown as TranslationService;
    const refundService = new RefundService(mockRebecca, translationService);

    const localConfig = {
      id: 'uc_alice',
      telegramId: 1001,
      panelId: 'legacy',
      configUsername: 'alice_refund',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };
    const initialPurchase = {
      id: 'pi_init_2',
      telegramId: 1001,
      panelId: 'legacy',
      amount: 100_000,
      configUsername: 'alice_refund',
      type: 'new_config',
      status: 'completed',
      completedAt: new Date(Date.now() - 3600_000),
      refundedAt: null,
    };

    const db = createDbMock([
      [localConfig],
      [initialPurchase],
      [], // existingRefund
      [{ id: 'tx_ref_reward_1' }], // referralReward attached!
    ]);
    getDbMock.mockReturnValue(db as never);

    const quote = await refundService.quote(1001, 'uc_alice');
    expect(quote.eligible).toBe(false);
    if (!quote.eligible) {
      expect(quote.reason).toBe('referral_reward_attached');
    }
  });
});
