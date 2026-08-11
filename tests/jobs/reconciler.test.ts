import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_INTENT_MIN_AGE_MS,
  reconcilePendingIntents,
  syncSubscriptionStatuses,
} from '../../src/jobs/reconciler.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
} from '../../src/domain/services/RebeccaService.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function pendingRenewal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_renewal',
    telegramId: 1001,
    amount: 50_000,
    type: 'renew_config',
    status: 'pending',
    configUsername: 'renewal_user',
    gbAmount: 10,
    durationDays: 30,
    previousDataLimit: 1_000,
    previousExpire: 1_700_000_000,
    previousStatus: 'active',
    expectedDataLimit: 10_737_419_240,
    expectedExpire: 1_700_002_592,
    expectedStatus: 'active',
    errorMessage: null,
    createdAt: new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS - 1),
    updatedAt: new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS - 1),
    ...overrides,
  };
}

function remoteUser(overrides: Record<string, unknown> = {}) {
  return {
    username: 'renewal_user',
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10_737_419_240,
    expire: 1_700_002_592,
    created_at: '2026-01-01T00:00:00Z',
    subscription_url: 'https://sub.example.test/primary',
    subscription_urls: { primary: 'https://sub.example.test/primary' },
    links: ['vless://not-a-subscription-link'],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: 'default',
    admin_username: 'admin',
    ...overrides,
  };
}

function createDbMock(
  stuckIntents: unknown[],
  returningResults: unknown[][] = [],
  deferredBonusIntents?: unknown[]
) {
  const state = {
    setCalls: [] as Array<Record<string, unknown>>,
    insertValues: [] as Array<Record<string, unknown>>,
    returningResults: [...returningResults],
    transaction: vi.fn(),
  };

  let selectCall = 0;
  const db = {
    select: vi.fn(() => {
      const isDeferredBonusQuery = deferredBonusIntents !== undefined && selectCall++ === 0;
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => (isDeferredBonusQuery ? query : Promise.resolve(stuckIntents))),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve(deferredBonusIntents ?? [])),
      };
      return query;
    }),
    update: vi.fn(() => {
      const query = {
        set: vi.fn((values: Record<string, unknown>) => {
          state.setCalls.push(values);
          return query;
        }),
        where: vi.fn(() => query),
        returning: vi.fn(() => Promise.resolve(state.returningResults.shift() ?? [])),
      };
      return query;
    }),
    insert: vi.fn(() => {
      const query = {
        values: vi.fn((values: Record<string, unknown>) => {
          state.insertValues.push(values);
          return query;
        }),
        onConflictDoNothing: vi.fn(() => Promise.resolve([])),
      };
      return query;
    }),
    transaction: state.transaction,
  };
  state.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) =>
    callback(db)
  );
  return { db, state };
}

describe('purchase intent reconciliation', () => {
  let rebeccaService: { getUser: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    rebeccaService = { getUser: vi.fn() };
  });

  it('uses a five-minute minimum age before a pending intent is eligible', () => {
    expect(PENDING_INTENT_MIN_AGE_MS).toBe(5 * 60 * 1000);
  });

  it('commits a renewal only when Rebecca matches its persisted target', async () => {
    const intent = pendingRenewal();
    const { db, state } = createDbMock(
      [intent],
      [
        [{ id: intent.id }], // conditional completed transition
        [{ balance: 50_000 }], // debit reservation
      ]
    );
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(remoteUser());

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(true);
    expect(state.insertValues.some((values) => values.referenceId === intent.id)).toBe(true);
  });

  it('treats an unlimited data limit as a valid persisted renewal target', async () => {
    const intent = pendingRenewal({ previousDataLimit: null, expectedDataLimit: null });
    const { db, state } = createDbMock([intent], [[{ id: intent.id }], [{ balance: 50_000 }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(remoteUser({ data_limit: null }));

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(true);
  });

  it('finalizes a recovered promo and invokes idempotent purchase rewards', async () => {
    const intent = pendingRenewal();
    const { db } = createDbMock([intent], [[{ id: intent.id }], [{ balance: 50_000 }]], []);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(remoteUser());
    const promoService = { finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(true) };
    const referralService = { processCompletedPurchase: vi.fn().mockResolvedValue(undefined) };

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService, {
        promoService: promoService as never,
        referralService: referralService as never,
      })
    ).resolves.toBe(1);

    expect(promoService.finalizeReservedPurchasePromo).toHaveBeenCalledWith(
      expect.anything(),
      intent.id
    );
    expect(referralService.processCompletedPurchase).toHaveBeenCalledWith(
      intent.telegramId,
      intent.amount,
      intent.id
    );
  });

  it('does not release a renewal whose traffic reset is known to have already applied', async () => {
    const intent = pendingRenewal({
      errorMessage:
        'Traffic reset applied but renewal update outcome is unresolved; manual review required',
    });
    const { db, state } = createDbMock([intent]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(
      remoteUser({ data_limit: intent.previousDataLimit, expire: intent.previousExpire })
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(0);

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.errorMessage === 'Reconciliation deferred: renewal state is ambiguous on Rebecca'
      )
    ).toBe(true);
  });

  it('releases an unchanged renewal only after Rebecca proves the prior state', async () => {
    const intent = pendingRenewal();
    const { db, state } = createDbMock(
      [intent],
      [
        [{ id: intent.id }], // conditional failed transition
        [{ telegramId: intent.telegramId }], // release reservation
      ]
    );
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(
      remoteUser({ data_limit: intent.previousDataLimit, expire: intent.previousExpire })
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(true);
  });

  it('never frees a renewal whose remote state is ambiguous', async () => {
    const intent = pendingRenewal();
    const { db, state } = createDbMock([intent]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(remoteUser({ data_limit: 9_999_999 }));

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(0);

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.errorMessage === 'Reconciliation deferred: renewal state is ambiguous on Rebecca'
      )
    ).toBe(true);
  });

  it('keeps reservations when Rebecca is unreachable', async () => {
    const { db, state } = createDbMock([pendingRenewal()]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockRejectedValue(
      new RebeccaOriginDownError('/api/user/renewal_user', 521, 4)
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(0);

    expect(state.setCalls).toHaveLength(0);
  });

  it('treats a confirmed 404 renewal as unapplied and releases exactly once', async () => {
    const intent = pendingRenewal();
    const { db, state } = createDbMock(
      [intent],
      [[{ id: intent.id }], [{ telegramId: intent.telegramId }]]
    );
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockRejectedValue(
      new RebeccaApiError(404, '/api/user/renewal_user', 'not found')
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(state.setCalls.filter((values) => values.status === 'failed')).toHaveLength(1);
  });

  it('also settles a legacy reconciliation_required intent without allowing re-entry', async () => {
    const intent = pendingRenewal({ status: 'reconciliation_required' });
    const { db, state } = createDbMock(
      [intent],
      [[{ id: intent.id }], [{ telegramId: intent.telegramId }]]
    );
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(
      remoteUser({ data_limit: intent.previousDataLimit, expire: intent.previousExpire })
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(true);
  });

  it('keeps a new-config intent reserved for manual review when the ownership marker mismatches', async () => {
    const intent = pendingRenewal({
      id: 'pi_marker_mismatch',
      type: 'new_config',
      configUsername: 'existing_stranger',
    });
    const { db, state } = createDbMock([intent]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(
      remoteUser({
        username: 'existing_stranger',
        note: 'rsbot:some_other_intent',
      })
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(0);

    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(false);
    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.errorMessage ===
          'Manual review required: Rebecca user ownership marker does not match this purchase'
      )
    ).toBe(true);
    expect(state.insertValues).toHaveLength(0);
  });

  it('binds a reconciled config using subscription_urls rather than proxy links', async () => {
    const intent = pendingRenewal({
      id: 'pi_new',
      type: 'new_config',
      configUsername: 'new_user',
    });
    const { db, state } = createDbMock([intent], [[{ id: intent.id }], [{ balance: 50_000 }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    rebeccaService.getUser.mockResolvedValue(
      remoteUser({
        username: 'new_user',
        subscription_url: '',
        subscription_urls: { fa: 'https://sub.example.test/fa' },
        note: 'rsbot:pi_new',
      })
    );

    await expect(
      reconcilePendingIntents(rebeccaService as unknown as RebeccaService)
    ).resolves.toBe(1);

    expect(
      state.insertValues.some((values) => values.subUrl === 'https://sub.example.test/fa')
    ).toBe(true);
    expect(
      state.insertValues.some((values) => values.subUrl === 'vless://not-a-subscription-link')
    ).toBe(false);
    expect(
      state.insertValues.some(
        (values) =>
          values.configUsername === 'new_user' &&
          values.panelStatus === 'active' &&
          values.panelDataLimit === 10_737_419_240 &&
          values.panelExpire === 1_700_002_592
      )
    ).toBe(true);
    expect(state.setCalls.some((values) => 'activeSubscriptionCount' in values)).toBe(true);
  });
});

describe('subscription lifecycle sync pagination', () => {
  it('walks every local config with a stable keyset cursor instead of stopping at one page', async () => {
    const pages = [
      [
        { id: 'uc_001', telegramId: 1001, configUsername: 'alice' },
        { id: 'uc_002', telegramId: 1002, configUsername: 'bob' },
      ],
      [{ id: 'uc_003', telegramId: 1001, configUsername: 'carol' }],
    ];
    let pageIndex = 0;
    const select = vi.fn(() => {
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve(pages[pageIndex++] ?? [])),
      };
      return query;
    });
    const update = vi.fn(() => {
      const query = {
        set: vi.fn(() => query),
        where: vi.fn(() => Promise.resolve()),
      };
      return query;
    });
    vi.mocked(getDb).mockReturnValue({ select, update } as never);

    const getUser = vi.fn(async (username: string) => remoteUser({ username }));
    await expect(
      syncSubscriptionStatuses({ getUser } as unknown as RebeccaService, 2)
    ).resolves.toBe(3);

    expect(select).toHaveBeenCalledTimes(2);
    expect(getUser).toHaveBeenCalledTimes(3);
    expect(getUser).toHaveBeenNthCalledWith(3, 'carol');
  });
});
