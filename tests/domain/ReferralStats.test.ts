import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

describe('ReferralService.getReferralStats', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('aggregates total invited, active buyers, referral bonus and cashback', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ count: 5 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockResolvedValueOnce([{ count: 3 }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ sum: 30000 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ sum: 15000 }]),
          }),
        }),
    };
    getDbMock.mockReturnValue(db as any);

    const service = new ReferralService({} as unknown as TranslationService);
    const stats = await service.getReferralStats(12345);

    expect(stats).toEqual({
      totalInvited: 5,
      activeBuyers: 3,
      totalReferralBonus: 30000,
      totalCashback: 15000,
    });
  });
});
