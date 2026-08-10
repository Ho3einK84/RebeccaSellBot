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
});
