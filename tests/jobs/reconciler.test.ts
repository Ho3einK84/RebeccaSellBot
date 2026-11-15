import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
  type RebeccaService,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import { PARTIAL_RENEWAL_REVIEW_MESSAGE } from '../../src/domain/services/WalletContracts.js';

const mockGetDb = vi.fn();
vi.mock('../../src/infra/db.js', () => ({
  getDb: () => mockGetDb(),
}));

import {
  PENDING_INTENT_MIN_AGE_MS,
  reconcilePendingIntents,
  runReconciliationCycle,
  startReconciliationCron,
  stopReconciliationCron,
  syncSubscriptionStatuses,
} from '../../src/jobs/reconciler.js';

const OLD = new Date('2025-01-01T00:00:00Z');

function makeUserDetail(username: string, overrides: Record<string, unknown> = {}) {
  return {
    username,
    proxies: {},
    expire: 1_800_000_000,
    data_limit: 50 * 1024 ** 3,
    data_limit_reset_strategy: 'no_reset',
    inbounds: {},
    status: 'active' as const,
    used_traffic: 0,
    lifetime_used_traffic: 0,
    created_at: '2026-01-01T00:00:00Z',
    links: [],
    subscription_url: 'https://panel.example.com/sub/default',
    subscription_urls: {},
    ...overrides,
  };
}

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent_1',
    telegramId: 100,
    panelId: 'legacy',
    serviceId: 1,
    checkoutId: null,
    amount: 50_000,
    type: 'renew_config',
    status: 'pending',
    configUsername: 'user_cfg',
    gbAmount: 50,
    durationDays: 30,
    previousDataLimit: 30 * 1024 ** 3,
    previousExpire: 1_750_000_000,
    previousStatus: 'active',
    expectedDataLimit: 50 * 1024 ** 3,
    expectedExpire: 1_750_000_000 + 30 * 86_400,
    expectedStatus: 'active',
    errorMessage: null,
    bonusesProcessedAt: null,
    cashbackPercent: null,
    cashbackAmount: 0,
    referrerTelegramId: null,
    referralBonusAmount: 0,
    refundedAt: null,
    operationStartedAt: OLD,
    leaseExpiresAt: null,
    completedAt: null,
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  };
}

interface ReconcileDbHarness {
  intentUpdates: Record<string, unknown>[];
  refundExecuted: boolean;
  configInserts: Record<string, unknown>[];
  configUpdates: Record<string, unknown>[];
}

function makeReconcileDb(
  intents: ReturnType<typeof makeIntent>[],
  options: { withDeferredBonusQuery?: boolean } = {}
): ReconcileDbHarness {
  const state: ReconcileDbHarness = {
    intentUpdates: [],
    refundExecuted: false,
    configInserts: [],
    configUpdates: [],
  };

  let selectCall = 0;
  const stuckCallIndex = options.withDeferredBonusQuery ? 1 : 0;

  const makeSelectChain = () => {
    const idx = selectCall++;
    const chain = {
      from: () => chain,
      where: () => {
        if (options.withDeferredBonusQuery && idx === 0) {
          return {
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          };
        }
        if (idx === stuckCallIndex) {
          return Promise.resolve(intents); // stuckIntents
        }
        return chain;
      },
      limit: () => Promise.resolve([{ telegramId: intents[0]?.telegramId ?? 100 }]),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const isLeaseClaim =
            'leaseExpiresAt' in values &&
            values.leaseExpiresAt !== null &&
            !('status' in values) &&
            !('errorMessage' in values);
          const isLeaseRelease =
            'leaseExpiresAt' in values &&
            !('status' in values) &&
            !('errorMessage' in values) &&
            !isLeaseClaim;
          if ('bonusesProcessedAt' in values || (!isLeaseClaim && !isLeaseRelease)) {
            state.intentUpdates.push(values);
          }
          const result = isLeaseClaim ? [{ id: intents[0]?.id ?? 'intent_1' }] : [];
          return Object.assign(Promise.resolve(result), {
            returning: () => Promise.resolve(result),
          });
        },
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ telegramId: intents[0]?.telegramId ?? 100 }]),
            }),
          }),
        }),
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            if ('configUsername' in values || 'subUrl' in values) {
              state.configInserts.push(values);
            }
            return { onConflictDoNothing: () => Promise.resolve() };
          },
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            if ('status' in values) {
              state.intentUpdates.push(values);
            } else if ('reservedBalance' in values && !('balance' in values)) {
              state.refundExecuted = true;
            } else if ('subUrl' in values || 'serviceId' in values || 'panelStatus' in values) {
              state.configUpdates.push(values);
            }
            return {
              where: () => ({
                returning: () =>
                  Promise.resolve([
                    { id: intents[0]?.id ?? 'intent_1', balance: 50_000, telegramId: 100 },
                  ]),
              }),
            };
          },
        }),
      };
      return fn(tx);
    },
  };

  mockGetDb.mockReturnValue(db);
  return state;
}

describe('reconcilePendingIntents — renewal settlement, binding, and manual review preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enforces five-minute minimum pending age', () => {
    expect(PENDING_INTENT_MIN_AGE_MS).toBe(5 * 60 * 1000);
  });

  it('commits a renewal when Rebecca matches target (or unlimited data_limit: null) and updates config', async () => {
    for (const [expectedDataLimit, remoteDataLimit] of [
      [50 * 1024 ** 3, 50 * 1024 ** 3],
      [null, 0],
    ] as const) {
      const intent = makeIntent({
        expectedDataLimit,
        expectedExpire: 1_800_000_000,
      });
      const db = makeReconcileDb([intent]);
      const rebecca = {
        getUser: vi.fn(async () =>
          makeUserDetail('user_cfg', {
            expire: 1_800_000_000,
            data_limit: remoteDataLimit,
          })
        ),
        getUsers: vi.fn(),
      } as unknown as RebeccaService;

      expect(await reconcilePendingIntents(rebecca)).toBe(1);
      expect(db.intentUpdates).toContainEqual(expect.objectContaining({ status: 'completed' }));
      expect(db.refundExecuted).toBe(false);
    }
  });

  it('finalizes promo and idempotent referral/cashback rewards when recovering an intent', async () => {
    const intent = makeIntent({
      cashbackAmount: 5_000,
      referrerTelegramId: 999,
      referralBonusAmount: 2_500,
    });
    const db = makeReconcileDb([intent], { withDeferredBonusQuery: true });
    const promoService = {
      finalizeReservedPurchasePromo: vi.fn(async () => undefined),
      releaseReservedPurchasePromoInTransaction: vi.fn(async () => undefined),
    };
    const referralService = {
      processCompletedPurchase: vi.fn(async () => undefined),
    };
    const rebecca = {
      getUser: vi.fn(async () =>
        makeUserDetail('user_cfg', {
          expire: intent.expectedExpire,
          data_limit: intent.expectedDataLimit,
        })
      ),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;

    await reconcilePendingIntents(rebecca, {
      promoService: promoService as never,
      referralService: referralService as never,
    });

    expect(promoService.finalizeReservedPurchasePromo).toHaveBeenCalledWith(
      expect.anything(),
      intent.id
    );
    expect(referralService.processCompletedPurchase).toHaveBeenCalledWith(
      intent.telegramId,
      intent.amount,
      intent.id
    );
    expect(db.intentUpdates).toContainEqual(
      expect.objectContaining({ bonusesProcessedAt: expect.any(Date) })
    );
  });

  it('preserves PARTIAL_RENEWAL_REVIEW_MESSAGE across multiple reconciliation sweeps instead of overwriting errorMessage', async () => {
    const intent = makeIntent({
      status: 'pending',
      errorMessage: PARTIAL_RENEWAL_REVIEW_MESSAGE,
      expectedExpire: 1_900_000_000,
    });
    const rebecca = {
      getUser: vi.fn(async () =>
        makeUserDetail('user_cfg', {
          expire: intent.previousExpire,
          data_limit: intent.previousDataLimit,
          used_traffic: 100,
        })
      ),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;

    const db1 = makeReconcileDb([intent]);
    expect(await reconcilePendingIntents(rebecca)).toBe(0);
    expect(db1.refundExecuted).toBe(false);
    expect(db1.intentUpdates).toContainEqual(
      expect.objectContaining({
        errorMessage: PARTIAL_RENEWAL_REVIEW_MESSAGE,
      })
    );

    const db2 = makeReconcileDb([
      makeIntent({
        ...intent,
        status: 'reconciliation_required',
        errorMessage: PARTIAL_RENEWAL_REVIEW_MESSAGE,
      }),
    ]);
    expect(await reconcilePendingIntents(rebecca)).toBe(0);
    expect(db2.refundExecuted).toBe(false);
    expect(db2.intentUpdates).toContainEqual(
      expect.objectContaining({
        errorMessage: PARTIAL_RENEWAL_REVIEW_MESSAGE,
      })
    );
  });

  it('keeps manual review for ambiguous renewals or unknown errors, releases unchanged/404 renewals once, and holds when panel down', async () => {
    const unchanged = makeIntent();
    const dbUnchanged = makeReconcileDb([unchanged]);
    const promoService = {
      finalizeReservedPurchasePromo: vi.fn(async () => undefined),
      releaseReservedPurchasePromoInTransaction: vi.fn(async () => undefined),
    };
    const rebeccaUnchanged = {
      getUser: vi.fn(async () =>
        makeUserDetail('user_cfg', {
          status: unchanged.previousStatus,
          expire: unchanged.previousExpire,
          data_limit: unchanged.previousDataLimit,
        })
      ),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;
    expect(
      await reconcilePendingIntents(rebeccaUnchanged, { promoService: promoService as never })
    ).toBe(1);
    expect(dbUnchanged.refundExecuted).toBe(true);
    expect(promoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      unchanged.id
    );

    const ambiguous = makeIntent({ previousStatus: null });
    const dbAmbiguous = makeReconcileDb([ambiguous]);
    expect(await reconcilePendingIntents(rebeccaUnchanged)).toBe(0);
    expect(dbAmbiguous.refundExecuted).toBe(false);
    expect(dbAmbiguous.intentUpdates).toContainEqual(
      expect.objectContaining({
        errorMessage: expect.stringContaining('ambiguous'),
      })
    );

    const db404 = makeReconcileDb([makeIntent({ status: 'reconciliation_required' })]);
    const rebecca404 = {
      getUser: vi.fn(async () => {
        throw new RebeccaApiError(404, '/api/user/user_cfg', 'Not Found');
      }),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;
    expect(await reconcilePendingIntents(rebecca404)).toBe(1);
    expect(db404.refundExecuted).toBe(true);

    const dbDown = makeReconcileDb([makeIntent()]);
    const rebeccaDown = {
      getUser: vi.fn(async () => {
        throw new RebeccaOriginDownError('/api/user/user_cfg', 521, 3, true);
      }),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;
    expect(await reconcilePendingIntents(rebeccaDown)).toBe(0);
    expect(dbDown.refundExecuted).toBe(false);
    expect(dbDown.intentUpdates).toHaveLength(0);
  });

  it('binds new_config intents from subscription_urls and holds on ownership marker mismatch', async () => {
    const newIntent = makeIntent({
      id: 'intent_new',
      type: 'new_config',
      configUsername: 'new_cfg',
    });
    const dbOk = makeReconcileDb([newIntent]);
    const rebeccaOk = {
      getUser: vi.fn(async () =>
        makeUserDetail('new_cfg', {
          note: `rsbot:${newIntent.id}`,
          links: ['vless://raw-link'],
          subscription_url: '',
          subscription_urls: { v2ray: 'https://panel.example.com/sub/real-url' },
        })
      ),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;

    expect(await reconcilePendingIntents(rebeccaOk)).toBe(1);
    expect(dbOk.configInserts[0]?.subUrl).toBe('https://panel.example.com/sub/real-url');

    const dbMismatch = makeReconcileDb([newIntent]);
    const rebeccaMismatch = {
      getUser: vi.fn(async () =>
        makeUserDetail('new_cfg', {
          note: 'rsbot:other_intent',
        })
      ),
      getUsers: vi.fn(),
    } as unknown as RebeccaService;
    expect(await reconcilePendingIntents(rebeccaMismatch)).toBe(0);
    expect(dbMismatch.configInserts).toHaveLength(0);
    expect(dbMismatch.intentUpdates).toContainEqual(
      expect.objectContaining({
        errorMessage: expect.stringContaining('ownership marker does not match'),
      })
    );
  });
});

describe('syncSubscriptionStatuses, runReconciliationCycle, and interval scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopReconciliationCron();
    vi.useRealTimers();
  });

  it('paginates with cursor, short-circuits queued items on down panels, and marks remote 404s deleted', async () => {
    const updatedRows: Record<string, unknown>[] = [];
    const page1 = [
      ...Array.from({ length: 12 }, (_, idx) => ({
        id: `cfg_d_${idx}`,
        panelId: 'p_down',
        configUsername: `u_down_${idx}`,
        telegramId: 10,
      })),
    ];
    const page2 = [{ id: 'cfg_ok', panelId: 'p_ok', configUsername: 'u_ok', telegramId: 10 }];

    let pageCalls = 0;
    mockGetDb.mockReturnValue({
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () =>
            Promise.resolve(
              pageCalls === 0 ? (pageCalls++, page1) : pageCalls++ === 1 ? page2 : []
            ),
        };
        return chain;
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updatedRows.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    });

    const downService = {
      getUser: vi.fn(async () => {
        throw new RebeccaOriginDownError('/api/user/u_down', 521, 3, true);
      }),
    } as unknown as RebeccaService;
    const okService = {
      getUser: vi.fn(async () => {
        throw new RebeccaApiError(404, '/api/user/u_ok', 'Not Found');
      }),
    } as unknown as RebeccaService;

    const registry = {
      getService: vi.fn((panelId?: string) => (panelId === 'p_down' ? downService : okService)),
    } as unknown as RebeccaPanelRegistry;

    const synced = await syncSubscriptionStatuses(registry, 12);
    expect(synced).toBe(1);
    expect(downService.getUser.mock.calls.length).toBeLessThan(12);
    expect(okService.getUser).toHaveBeenCalledTimes(1);
    expect(updatedRows).toContainEqual(expect.objectContaining({ panelStatus: 'deleted' }));
  });

  it('isolates step failures in runReconciliationCycle and manages interval lifecycle', async () => {
    vi.useFakeTimers();
    mockGetDb.mockImplementation(() => {
      throw new Error('transient DB outage');
    });

    const services = {
      purchaseCheckoutService: {
        reconcileStaleProcessing: vi.fn(async () => {
          throw new Error('checkout err');
        }),
      },
      refundService: { reconcilePendingRefunds: vi.fn(async () => undefined) },
      configReconciliationService: { scan: vi.fn(async () => undefined) },
      trialService: { reconcilePendingClaims: vi.fn(async () => undefined) },
    };

    const registry = { getService: vi.fn() } as unknown as RebeccaPanelRegistry;
    await expect(runReconciliationCycle(registry, services as never)).resolves.toBeUndefined();
    expect(services.purchaseCheckoutService.reconcileStaleProcessing).toHaveBeenCalledTimes(1);
    expect(services.refundService.reconcilePendingRefunds).toHaveBeenCalledTimes(1);
    expect(services.configReconciliationService.scan).toHaveBeenCalledTimes(1);
    expect(services.trialService.reconcilePendingClaims).toHaveBeenCalledTimes(1);

    startReconciliationCron(registry, {}, 60_000);
    await vi.advanceTimersByTimeAsync(1);
    stopReconciliationCron();
  });
});
