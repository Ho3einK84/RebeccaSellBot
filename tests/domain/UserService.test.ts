import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { UserService } from '../../src/domain/services/UserService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

function databaseWithSelectResults(selectResults: unknown[][]) {
  const queued = [...selectResults];
  return {
    select: vi.fn(() => {
      const resolve = () => Promise.resolve(queued.shift() ?? []);
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        limit: vi.fn(resolve),
        then: <TResult1 = unknown[], TResult2 = never>(
          onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) => resolve().then(onfulfilled, onrejected),
      };
      return query;
    }),
  };
}

describe('UserService administrative profile lookup', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns an enriched profile for a UUID lookup', async () => {
    const user = {
      id: '4e602ae8-4398-4ce0-a084-10a5860ce1a5',
      telegramId: 44,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      balance: 25_000,
      reservedBalance: 5_000,
      isBanned: false,
      hasUsedTrial: true,
      locale: 'en',
      referrerId: null,
      referralCode: 'ref_44_abc',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    vi.mocked(getDb).mockReturnValue(
      databaseWithSelectResults([
        [user],
        [{ value: 8 }],
        [{ value: 3 }],
        [{ value: 12_000 }],
        [{ value: 750 }],
      ]) as never
    );

    await expect(new UserService().findProfile(user.id.toUpperCase())).resolves.toMatchObject({
      id: user.id,
      telegramId: 44,
      transactionCount: 8,
      referredUserCount: 3,
      referralBonusEarned: 12_000,
      cashbackEarned: 750,
    });
  });

  it('returns profile when searched by receipt ID', async () => {
    const user = {
      id: '4e602ae8-4398-4ce0-a084-10a5860ce1a5',
      telegramId: 44,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      balance: 25_000,
      reservedBalance: 0,
      isBanned: false,
      hasUsedTrial: false,
      locale: 'fa',
      referrerId: null,
      referralCode: 'ref_44_abc',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    vi.mocked(getDb).mockReturnValue(
      databaseWithSelectResults([
        [], // user lookup
        [], // userConfigs lookup
        [{ telegramId: 44 }], // topupReceipts lookup
        [user], // user by telegramId
        [{ value: 2 }],
        [{ value: 0 }],
        [{ value: 0 }],
        [{ value: 0 }],
      ]) as never
    );

    const profile = await new UserService().findProfile('rec_123456');
    expect(profile).not.toBeNull();
    expect(profile?.telegramId).toBe(44);
  });

  it('returns aggregated summary for user report', async () => {
    const user = {
      id: '4e602ae8-4398-4ce0-a084-10a5860ce1a5',
      telegramId: 44,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      balance: 25_000,
      reservedBalance: 0,
      totalSpend: 150_000,
      isBanned: false,
      hasUsedTrial: true,
      locale: 'fa',
      referrerId: null,
      referralCode: 'ref_44_abc',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    vi.mocked(getDb).mockReturnValue(
      databaseWithSelectResults([
        [user], // findProfile -> users table
        [{ value: 5 }], // transactionCount
        [{ value: 2 }], // referredUserCount
        [{ value: 10_000 }], // referralBonus
        [{ value: 5_000 }], // cashback
        [{ value: 200_000 }], // depositRow
        [{ value: 0 }], // refundRow
        [{ value: 15_000 }], // luckyWheelRow
        [{ count: 4 }], // configsCountRow
        [{ count: 2 }], // activeConfigsCountRow
        [{ count: 3 }], // ordersCountRow
        [{ count: 5 }], // approvedReceiptsRow
        [{ count: 1 }], // rejectedReceiptsRow
        [{ count: 0 }], // pendingReceiptsRow
        [{ count: 7 }], // auditCountRow
      ]) as never
    );

    const summary = await new UserService().getUserReportSummary(44);
    expect(summary).not.toBeNull();
    expect(summary?.totalDeposit).toBe(200_000);
    expect(summary?.totalSpend).toBe(150_000);
    expect(summary?.totalLuckyWheel).toBe(15_000);
    expect(summary?.activeConfigsCount).toBe(2);
    expect(summary?.totalConfigsCount).toBe(4);
    expect(summary?.totalOrdersCount).toBe(3);
    expect(summary?.receiptsApprovedCount).toBe(5);
    expect(summary?.receiptsRejectedCount).toBe(1);
    expect(summary?.totalReceiptsCount).toBe(6);
    expect(summary?.auditEventsCount).toBe(7);
  });

  it('cleanUserSearchQuery normalizes Persian/Arabic digits, URLs, and @ prefix', async () => {
    const { cleanUserSearchQuery } = await import('../../src/domain/services/UserService.js');

    expect(cleanUserSearchQuery('  @john_doe  ')).toBe('john_doe');
    expect(cleanUserSearchQuery('https://t.me/super_user')).toBe('super_user');
    expect(cleanUserSearchQuery('http://t.me/testuser')).toBe('testuser');
    expect(cleanUserSearchQuery('tg://resolve?domain=botfather')).toBe('botfather');
    expect(cleanUserSearchQuery('۱۲۳۴۵۶۷۸۹')).toBe('123456789');
    expect(cleanUserSearchQuery('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(cleanUserSearchQuery('')).toBe('');
  });
});
