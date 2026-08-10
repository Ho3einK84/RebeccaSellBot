import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

type ReferralInternals = {
  creditWallet: (...args: unknown[]) => Promise<boolean>;
};

function databaseWithSelectResults(selectResults: unknown[][]) {
  const queued = [...selectResults];
  return {
    select: vi.fn(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn().mockResolvedValue(queued.shift() ?? []),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      query.orderBy.mockReturnValue(query);
      return query;
    }),
  };
}

function createService(): ReferralService {
  return new ReferralService({
    getSettingNum: vi.fn((key: string, fallback: number) => {
      if (key === 'referral_bonus_toman') return 10_000;
      if (key === 'cashback_percent') return 10;
      return fallback;
    }),
  } as unknown as TranslationService);
}

describe('ReferralService idempotency and first-purchase behavior', () => {
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

  it('settles the referral bonus against the first committed intent even when invoked later', async () => {
    const service = createService();
    const internals = service as unknown as ReferralInternals;
    const credit = vi.spyOn(internals, 'creditWallet').mockResolvedValue(true);
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
        [{ telegramId: 10, referrerId: 99 }],
        [{ intentId: 'pi_first_purchase' }],
      ]) as never
    );

    await service.processCompletedPurchase(10, 80_000, 'pi_later_purchase');

    expect(credit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        telegramId: 99,
        amount: 10_000,
        referenceId: 'ref_bonus_pi_first_purchase',
        type: 'referral_bonus',
      })
    );
    expect(credit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        telegramId: 10,
        amount: 8_000,
        referenceId: 'cashback_pi_later_purchase',
        type: 'cashback',
      })
    );
  });

  it('does not update a balance when the deterministic credit reference already exists', async () => {
    const service = createService();
    const internals = service as unknown as ReferralInternals;
    const select = vi.fn(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue([{ id: 'already-recorded' }]),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      return query;
    });
    const update = vi.fn();
    const tx = { select, update };
    getDbMock.mockReturnValue({
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      internals.creditWallet({
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
