import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { cleanUserSearchQuery, UserService } from '../../src/domain/services/UserService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('UserService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const makeUser = (telegramId: number, overrides: Record<string, unknown> = {}) => ({
    id: '4e602ae8-4398-4ce0-a084-10a5860ce1a5',
    telegramId,
    username: `user_${telegramId}`,
    firstName: `User ${telegramId}`,
    lastName: null,
    balance: 25_000,
    reservedBalance: 0,
    totalSpend: 150_000,
    isBanned: false,
    hasUsedTrial: false,
    locale: 'fa',
    referrerId: null,
    referralCode: `ref_${telegramId}_abc`,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  it('finds enriched profiles by UUID, receipt ID, and rejects invalid non-positive telegramIds', async () => {
    const user = makeUser(44, { reservedBalance: 5_000, hasUsedTrial: true, locale: 'en' });

    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [
          [user],
          [{ value: 8 }],
          [{ value: 3 }],
          [{ value: 12_000 }],
          [{ value: 750 }],
        ],
      }).db as never
    );
    await expect(new UserService().findProfile(user.id.toUpperCase())).resolves.toMatchObject({
      id: user.id,
      telegramId: 44,
      transactionCount: 8,
      referredUserCount: 3,
      referralBonusEarned: 12_000,
      cashbackEarned: 750,
    });

    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [
          [],
          [],
          [{ telegramId: 44 }],
          [user],
          [{ value: 2 }],
          [{ value: 0 }],
          [{ value: 0 }],
          [{ value: 0 }],
        ],
      }).db as never
    );
    await expect(new UserService().findProfile('rec_123456')).resolves.toMatchObject({
      telegramId: 44,
    });

    // Rejects '0' and negative numeric queries on exact telegramId branch
    const invalidDb = createMockDb({ selectResults: [[], [], [], [], [], []] });
    getDbMock.mockReturnValue(invalidDb.db as never);
    await expect(new UserService().findProfile('0')).resolves.toBeNull();
    await expect(new UserService().findProfile('-99')).resolves.toBeNull();
  });

  it('batches searchProfiles profile enrichment in 5 parallel queries without N+1 loops', async () => {
    const alice = makeUser(101, { username: 'ali_one' });
    const bob = makeUser(102, { username: 'ali_two' });
    const { db, state } = createMockDb({
      selectResults: [
        // Exact username/referral match -> 0
        [],
        // Config owners -> 0
        [],
        // Fuzzy user match returns 2 candidate IDs
        [{ telegramId: 101 }, { telegramId: 102 }],
        // Partial config match skipped or empty if not needed
        [],
        // loadProfilesByIds(101, 102): 5 parallel batch queries!
        [alice, bob],
        [
          { telegramId: 101, value: 4 },
          { telegramId: 102, value: 1 },
        ],
        [{ referrerId: 101, value: 2 }],
        [{ telegramId: 101, value: 10_000 }],
        [{ telegramId: 102, value: 5_000 }],
      ],
    });
    getDbMock.mockReturnValue(db as never);

    const results = await new UserService().searchProfiles('ali', 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      telegramId: 101,
      transactionCount: 4,
      referredUserCount: 2,
      referralBonusEarned: 10_000,
      cashbackEarned: 0,
    });
    expect(results[1]).toMatchObject({
      telegramId: 102,
      transactionCount: 1,
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 5_000,
    });
    // 4 search candidate queries (length=3) + 5 batch enrichment queries = 9 total selects regardless of N!
    expect(state.selectCalls).toHaveLength(9);
  });

  it('builds user report summary and normalizes search queries including Persian/Arabic digits', async () => {
    const user = makeUser(44, { hasUsedTrial: true });
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [
          [user],
          [{ value: 5 }],
          [{ value: 2 }],
          [{ value: 10_000 }],
          [{ value: 5_000 }],
          [{ value: 200_000 }],
          [{ value: 0 }],
          [{ value: 15_000 }],
          [{ count: 4 }],
          [{ count: 2 }],
          [{ count: 3 }],
          [{ count: 5 }],
          [{ count: 1 }],
          [{ count: 0 }],
          [{ count: 7 }],
        ],
      }).db as never
    );

    const summary = await new UserService().getUserReportSummary(44);
    expect(summary).toMatchObject({
      totalDeposit: 200_000,
      totalSpend: 150_000,
      totalLuckyWheel: 15_000,
      activeConfigsCount: 2,
      totalConfigsCount: 4,
      totalOrdersCount: 3,
      receiptsApprovedCount: 5,
      receiptsRejectedCount: 1,
      totalReceiptsCount: 6,
      auditEventsCount: 7,
    });

    expect(cleanUserSearchQuery('  @john_doe  ')).toBe('john_doe');
    expect(cleanUserSearchQuery('https://t.me/super_user')).toBe('super_user');
    expect(cleanUserSearchQuery('http://t.me/testuser')).toBe('testuser');
    expect(cleanUserSearchQuery('tg://resolve?domain=botfather')).toBe('botfather');
    expect(cleanUserSearchQuery('۱۲۳۴۵۶۷۸۹')).toBe('123456789');
    expect(cleanUserSearchQuery('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(cleanUserSearchQuery('#123456789')).toBe('123456789');
    expect(cleanUserSearchQuery('＃۱۲۳۴۵۶۷۸۹')).toBe('123456789');
    expect(cleanUserSearchQuery('')).toBe('');
  });

  it('triggers invalidation hooks on ban and locale updates, redacts audit metadata secrets, and clamps pagination', async () => {
    const hook = vi.fn();
    const service = new UserService();
    service.registerInvalidationHook(hook);

    const banDb = createMockDb({ returningResults: [[{ telegramId: 123456789, isBanned: true }]] });
    getDbMock.mockReturnValue(banDb.db as never);
    await expect(service.setBanned(123456789, true, 999)).resolves.toBe(true);
    expect(hook).toHaveBeenCalledWith(123456789);
    expect(banDb.state.insertCalls[0]?.values).toMatchObject({ action: 'user_banned' });

    const localeDb = createMockDb({
      returningResults: [[{ telegramId: 123456789 }], [{ telegramId: 123456789 }]],
    });
    getDbMock.mockReturnValue(localeDb.db as never);
    await service.updateLocale(123456789, 'en');
    await service.updateObservedLocale(123456789, 'en');
    expect(hook).toHaveBeenCalledTimes(3);

    // recordAdminAction redacts sensitive keys recursively before JSON persistence
    const auditDb = createMockDb();
    getDbMock.mockReturnValue(auditDb.db as never);
    await service.recordAdminAction({
      actorTelegramId: 999,
      action: 'panel_config_update',
      entityType: 'panel',
      entityId: 'panel_1',
      metadata: {
        panelUrl: 'https://panel.example',
        apiKey: 'super-secret-key',
        nested: {
          password: 'db-password',
          bearerToken: 'tok_123',
          safeField: 'kept',
        },
        items: [{ credential: 'secret', id: 1 }],
      },
    });
    const persistedMeta = JSON.parse(auditDb.state.insertCalls[0]?.values.metadata as string);
    expect(persistedMeta).toEqual({
      panelUrl: 'https://panel.example',
      apiKey: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        bearerToken: '[REDACTED]',
        safeField: 'kept',
      },
      items: [{ credential: '[REDACTED]', id: 1 }],
    });

    // Pagination helpers clamp pageSize & NaN/out-of-range pages
    const pageDb = createMockDb({
      selectResults: [
        [{ count: 2 }],
        [{ id: 'a1' }],
        [{ count: 1 }],
        [{ id: 'r1' }],
        [{ count: 1 }],
        [{ id: 'o1' }],
      ],
    });
    getDbMock.mockReturnValue(pageDb.db as never);
    await expect(service.listAuditLogsForUser(44, Number.NaN, 500)).resolves.toMatchObject({
      page: 1,
      totalPages: 1,
    });
    expect(pageDb.state.selectCalls[1]?.limit).toBe(50);

    await expect(service.listReceiptsForUser(44, 10, -5)).resolves.toMatchObject({
      page: 1,
      totalPages: 1,
    });
    await expect(service.listOrdersForUser(44, 0, 200)).resolves.toMatchObject({
      page: 1,
      totalPages: 1,
    });
  });
});
