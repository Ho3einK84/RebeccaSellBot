import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PendingTopupReceiptError,
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
  WalletService,
} from '../../src/domain/services/WalletService.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
} from '../../src/domain/services/RebeccaService.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';

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

type FakeDbState = {
  readonly insertValues: Array<Record<string, unknown>>;
  readonly setCalls: Array<Record<string, unknown>>;
  readonly updateCalls: Array<unknown>;
  readonly returningResults: unknown[][];
  readonly selectResults: unknown[][];
  readonly transaction: ReturnType<typeof vi.fn>;
};

const RENEWAL_CREATED_AT = '2026-01-01T00:00:00Z';

function verifiedRenewalBinding(telegramId: number, configUsername: string) {
  return {
    id: `uc_${configUsername}`,
    telegramId,
    panelId: 'legacy',
    configUsername,
    subUrl: `https://sub.example.test/${configUsername}`,
    remoteCreatedAt: `created:${RENEWAL_CREATED_AT}`,
  };
}

function createDbMock(
  options: {
    returningResults?: unknown[][];
    selectResults?: unknown[][];
  } = {}
): { db: unknown; state: FakeDbState } {
  const state: FakeDbState = {
    insertValues: [],
    setCalls: [],
    updateCalls: [],
    returningResults: [...(options.returningResults ?? [])],
    selectResults: [...(options.selectResults ?? [])],
    transaction: vi.fn(),
  };

  const db = {
    select: vi.fn(() => {
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        for: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve(state.selectResults.shift() ?? [])),
      };
      return query;
    }),
    insert: vi.fn(() => {
      const query = {
        values: vi.fn((values: Record<string, unknown>) => {
          state.insertValues.push(values);
          return query;
        }),
        onConflictDoNothing: vi.fn(() => query),
        returning: vi.fn(() => Promise.resolve(state.returningResults.shift() ?? [])),
      };
      return query;
    }),
    update: vi.fn((table: unknown) => {
      state.updateCalls.push(table);
      const query = {
        set: vi.fn((values: Record<string, unknown>) => {
          state.setCalls.push(values);
          return query;
        }),
        where: vi.fn(() => query),
        returning: vi.fn(() =>
          Promise.resolve(
            state.returningResults.shift() ?? [
              { id: 'mock_row', telegramId: 1001, balance: 50_000 },
            ]
          )
        ),
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

describe('WalletService reserve → remote → commit saga', () => {
  let walletService: WalletService;
  let mockRebeccaService: {
    createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    resetUserTraffic: ReturnType<typeof vi.fn>;
  };
  let mockReferralService: {
    processCompletedPurchase: ReturnType<typeof vi.fn>;
    resolveReferrerId: ReturnType<typeof vi.fn>;
  };
  let mockPromoService: {
    reserveForPurchase: ReturnType<typeof vi.fn>;
    finalizeReservedPurchasePromo: ReturnType<typeof vi.fn>;
    releaseReservedPurchasePromoInTransaction: ReturnType<typeof vi.fn>;
  };

  const purchase = {
    telegramId: 1001,
    amount: 50_000,
    type: 'new_config' as const,
    configUsername: 'wallet_saga_test',
    gbAmount: 10,
    durationDays: 30,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRebeccaService = {
      createUser: vi.fn().mockImplementation(async (payload: { note?: string }) => ({
        username: purchase.configUsername,
        status: 'active',
        data_limit: purchase.gbAmount * 1024 * 1024 * 1024,
        expire: Math.floor(Date.now() / 1000) + purchase.durationDays * 86400,
        created_at: RENEWAL_CREATED_AT,
        subscription_url: 'https://sub.example.test/primary',
        subscription_urls: { primary: 'https://sub.example.test/primary' },
        note: payload.note ?? null,
      })),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      deleteUser: vi
        .fn()
        .mockResolvedValue({ username: purchase.configUsername, status: 'deleted' }),
      resetUserTraffic: vi.fn().mockResolvedValue({ username: purchase.configUsername }),
    };
    mockReferralService = {
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
      resolveReferrerId: vi.fn().mockResolvedValue(undefined),
    };
    mockPromoService = {
      reserveForPurchase: vi
        .fn()
        .mockImplementation(
          async (
            _tx: unknown,
            params: { intentId: string; baseAmount: number; baseGbAmount: number }
          ) => ({
            intentId: params.intentId,
            code: 'WELCOME',
            type: 'discount_fixed',
            value: 0,
            finalAmount: params.baseAmount,
            finalGbAmount: params.baseGbAmount,
          })
        ),
      finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
      releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
    };

    walletService = new WalletService(
      mockRebeccaService as unknown as RebeccaService,
      { getSettingNum: vi.fn(() => 1) } as unknown as TranslationService,
      mockReferralService as unknown as ReferralService,
      mockPromoService as unknown as PromoService
    );
  });

  it('uses the guarded reservation as the authoritative insufficient-funds check', async () => {
    const { db } = createDbMock({ returningResults: [[]] });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toThrow(
      'INSUFFICIENT_BALANCE'
    );

    expect(mockRebeccaService.createUser).not.toHaveBeenCalled();
  });

  it('releases the reservation when createUser fails before reaching the origin', async () => {
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: purchase.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // fail intent transition
        [{ telegramId: purchase.telegramId }], // reservation release
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    const originDown = new RebeccaOriginDownError('/api/user', null, 4);
    mockRebeccaService.createUser.mockRejectedValue(originDown);

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBe(originDown);

    expect(mockRebeccaService.deleteUser).not.toHaveBeenCalled();
    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(true);
    expect(state.setCalls.filter((values) => 'reservedBalance' in values)).toHaveLength(2);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledOnce();
  });

  it('keeps the reservation pending when a dispatched create loses its response', async () => {
    const { db, state } = createDbMock({
      returningResults: [[{ telegramId: purchase.telegramId }]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.createUser.mockRejectedValue(
      new RebeccaOriginDownError('/api/user', null, 5, true)
    );

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.status === 'pending' &&
          values.errorMessage === 'Remote outcome unknown; awaiting reconciliation'
      )
    ).toBe(true);
    expect(state.setCalls.filter((values) => 'reservedBalance' in values)).toHaveLength(1);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).not.toHaveBeenCalled();
  });

  it('keeps the reservation pending when a 2xx mutation violates the Rebecca contract', async () => {
    const { db, state } = createDbMock({
      returningResults: [[{ telegramId: purchase.telegramId }]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.createUser.mockRejectedValue(new RebeccaContractError('/api/user', 2));

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.status === 'pending' &&
          values.errorMessage === 'Remote outcome unknown; awaiting reconciliation'
      )
    ).toBe(true);
  });

  it.each([409, 503])(
    'keeps the reservation pending after an indeterminate HTTP %i mutation response',
    async (status) => {
      const { db, state } = createDbMock({
        returningResults: [[{ telegramId: purchase.telegramId }]],
      });
      vi.mocked(getDb).mockReturnValue(db as never);
      mockRebeccaService.createUser.mockRejectedValue(
        new RebeccaApiError(status, '/api/user', 'indeterminate response')
      );

      await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
        PurchaseOutcomePendingError
      );

      expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
      expect(
        state.setCalls.some(
          (values) =>
            values.status === 'pending' &&
            values.errorMessage === 'Remote outcome unknown; awaiting reconciliation'
        )
      ).toBe(true);
    }
  );

  it('keeps renewal pending when traffic reset succeeds but update fails before dispatch', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'origin_down_renewal',
    };
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: renewal.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // persisted renewal target
      ],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: renewal.gbAmount * 1024 * 1024 * 1024,
      expire: 1_700_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    const originDown = new RebeccaOriginDownError(
      `/api/user/${renewal.configUsername}`,
      null,
      4,
      false
    );
    mockRebeccaService.updateUser.mockRejectedValue(originDown);

    await expect(walletService.executePurchaseSaga(renewal)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith(renewal.configUsername);
    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.errorMessage ===
          'Traffic reset applied but renewal update outcome is unresolved; manual review required'
      )
    ).toBe(true);
    expect(state.setCalls.filter((values) => 'reservedBalance' in values)).toHaveLength(1);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).not.toHaveBeenCalled();
  });

  it('fails renewal closed when the Rebecca username was recreated for another incarnation', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'recreated_renewal',
    };
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: renewal.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // fail pending purchase intent
        [{ telegramId: renewal.telegramId }], // release reservation
      ],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: renewal.gbAmount * 1024 * 1024 * 1024,
      expire: 1_700_000_000,
      created_at: '2026-06-01T00:00:00Z',
    });

    await expect(walletService.executePurchaseSaga(renewal)).rejects.toThrow(
      'CONFIG_INCARNATION_MISMATCH'
    );

    expect(mockRebeccaService.resetUserTraffic).not.toHaveBeenCalled();
    expect(mockRebeccaService.updateUser).not.toHaveBeenCalled();
    expect(state.setCalls.filter((values) => 'reservedBalance' in values)).toHaveLength(2);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledOnce();
  });

  it('releases the reservation after a definite 4xx business failure', async () => {
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: purchase.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // fail intent transition
        [{ telegramId: purchase.telegramId }], // reservation release
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.createUser.mockRejectedValue(
      new RebeccaApiError(422, '/api/user', 'invalid user')
    );

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toThrow(
      'VPN Panel operation failed'
    );

    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(true);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledOnce();
    expect(mockRebeccaService.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the reservation pending when a successful mutation response does not prove the requested state', async () => {
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ telegramId: purchase.telegramId }],
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.createUser.mockImplementation(async (payload: { note?: string }) => ({
      username: purchase.configUsername,
      status: 'active',
      data_limit: purchase.gbAmount * 1024 * 1024 * 1024,
      expire: null,
      created_at: RENEWAL_CREATED_AT,
      subscription_url: 'https://sub.example.test/primary',
      note: payload.note ?? null,
    }));

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );
    expect(state.setCalls.some((values) => values.status === 'completed')).toBe(false);
    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(state.setCalls.some((values) => values.status === 'pending')).toBe(true);
  });

  it('commits exactly one debit/audit path after a successful remote create', async () => {
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: purchase.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // conditional completed transition
        [{ balance: 50_000 }], // final debit
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockPromoService.reserveForPurchase.mockResolvedValueOnce({
      intentId: 'pi_test',
      code: 'WELCOME',
      type: 'discount_fixed',
      value: 10_000,
      finalAmount: 40_000,
      finalGbAmount: 15,
    });
    mockRebeccaService.createUser.mockImplementationOnce(async (payload: { note?: string }) => ({
      username: purchase.configUsername,
      status: 'active',
      data_limit: 15 * 1024 * 1024 * 1024,
      expire: Math.floor(Date.now() / 1000) + purchase.durationDays * 86400,
      created_at: RENEWAL_CREATED_AT,
      subscription_url: 'https://sub.example.test/primary',
      subscription_urls: { primary: 'https://sub.example.test/primary' },
      note: payload.note ?? null,
    }));

    const result = await walletService.executePurchaseSaga({ ...purchase, promoCode: 'WELCOME' });

    expect(result).toEqual({
      success: true,
      configUsername: purchase.configUsername,
      subUrl: 'https://sub.example.test/primary',
    });
    expect(mockRebeccaService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ note: expect.stringMatching(/^rsbot:pi_/u) })
    );
    expect(state.setCalls.filter((values) => values.status === 'completed')).toHaveLength(1);
    expect(mockReferralService.processCompletedPurchase).toHaveBeenCalledOnce();
    expect(mockReferralService.processCompletedPurchase).toHaveBeenCalledWith(
      purchase.telegramId,
      40_000,
      expect.stringMatching(/^pi_/)
    );
    expect(mockPromoService.reserveForPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rawCode: 'WELCOME', baseAmount: purchase.amount })
    );
    expect(mockPromoService.finalizeReservedPurchasePromo).toHaveBeenCalledOnce();
    expect(
      state.setCalls.some((values) => values.amount === 40_000 && values.gbAmount === 15)
    ).toBe(true);
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        configUsername: purchase.configUsername,
        panelStatus: 'active',
        panelDataLimit: 15 * 1024 * 1024 * 1024,
        panelExpire: expect.any(Number),
        lastSyncedAt: expect.any(Date),
      })
    );
    expect(state.setCalls.some((values) => 'activeSubscriptionCount' in values)).toBe(true);
  });

  it('resets Rebecca data limit and duration explicitly during renewal', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'unlimited_renewal',
      gbAmount: 50,
      durationDays: 30,
    };
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: renewal.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // persisted renewal target
        [{ id: 'pi_test' }], // conditional completed transition
        [{ balance: 50_000 }], // final debit
      ],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: null,
      expire: 1_700_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.resetUserTraffic.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      used_traffic: 0,
    } as never);
    mockRebeccaService.updateUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: 50 * 1024 * 1024 * 1024,
      expire: Math.floor(Date.now() / 1000) + renewal.durationDays * 86400,
      subscription_url: 'https://sub.example.test/unlimited',
      subscription_urls: { primary: 'https://sub.example.test/unlimited' },
    });

    await expect(walletService.executePurchaseSaga(renewal)).resolves.toMatchObject({
      success: true,
    });

    const expectedBytes = 50 * 1024 * 1024 * 1024;
    const [, payload] = mockRebeccaService.updateUser.mock.calls[0]!;
    expect(payload).toHaveProperty('data_limit', expectedBytes);
    expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith(renewal.configUsername);
    expect(state.setCalls.some((values) => values.expectedDataLimit === expectedBytes)).toBe(true);
    expect(
      state.setCalls.some(
        (values) => values.panelStatus === 'active' && values.panelDataLimit === expectedBytes
      )
    ).toBe(true);
  });

  it('handles limited-to-limited and expired renewal correctly', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'disabled_limited_user',
      gbAmount: 30,
      durationDays: 15,
    };
    const { db } = createDbMock({
      returningResults: [
        [{ telegramId: renewal.telegramId }],
        [{ id: 'pi_test' }],
        [{ id: 'pi_test' }],
        [{ balance: 50_000 }],
      ],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'disabled',
      data_limit: 10 * 1024 * 1024 * 1024,
      expire: 1_600_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.resetUserTraffic.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      used_traffic: 0,
    } as never);
    mockRebeccaService.updateUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: 30 * 1024 * 1024 * 1024,
      expire: Math.floor(Date.now() / 1000) + renewal.durationDays * 86400,
      subscription_url: 'https://sub.example.test/disabled',
    });

    await expect(walletService.executePurchaseSaga(renewal)).resolves.toMatchObject({
      success: true,
    });

    expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith('disabled_limited_user');
  });

  it.each(['limited', 'expired'] as const)(
    'allows renewal when remote configuration is in %s state',
    async (remoteStatus) => {
      const renewal = {
        ...purchase,
        type: 'renew_config' as const,
        configUsername: `${remoteStatus}_user`,
        gbAmount: 50,
        durationDays: 30,
      };
      const { db } = createDbMock({
        returningResults: [
          [{ telegramId: renewal.telegramId }],
          [{ id: 'pi_test' }],
          [{ id: 'pi_test' }],
          [{ balance: 50_000 }],
        ],
        selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
      });
      vi.mocked(getDb).mockReturnValue(db as never);
      mockRebeccaService.getUser.mockResolvedValue({
        username: renewal.configUsername,
        status: remoteStatus,
        data_limit: 10 * 1024 * 1024 * 1024,
        expire: 1_600_000_000,
        created_at: RENEWAL_CREATED_AT,
      });
      mockRebeccaService.resetUserTraffic.mockResolvedValue({
        username: renewal.configUsername,
        status: 'active',
        used_traffic: 0,
      } as never);
      mockRebeccaService.updateUser.mockResolvedValue({
        username: renewal.configUsername,
        status: 'active',
        data_limit: 50 * 1024 * 1024 * 1024,
        expire: Math.floor(Date.now() / 1000) + renewal.durationDays * 86400,
        subscription_url: `https://sub.example.test/${remoteStatus}`,
      });

      await expect(walletService.executePurchaseSaga(renewal)).resolves.toMatchObject({
        success: true,
      });

      expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith(`${remoteStatus}_user`);
      expect(mockRebeccaService.updateUser).toHaveBeenCalledWith(
        `${remoteStatus}_user`,
        expect.objectContaining({ status: 'active', data_limit: 50 * 1024 * 1024 * 1024 })
      );
    }
  );

  it('fails renewal and releases balance reservation if traffic reset fails', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'reset_fail_user',
      gbAmount: 20,
      durationDays: 30,
    };
    const { db } = createDbMock({
      returningResults: [[{ telegramId: renewal.telegramId }], [{ id: 'pi_test' }]],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: 10 * 1024 * 1024 * 1024,
      expire: 1_700_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.resetUserTraffic.mockRejectedValue(new Error('Reset API error'));
    mockRebeccaService.updateUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
    });

    await expect(walletService.executePurchaseSaga(renewal)).rejects.toThrow();
  });

  it('restores an unlimited renewal with an explicit data_limit null during compensation', async () => {
    const renewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'unlimited_compensation',
      gbAmount: 25,
      durationDays: 30,
    };
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: renewal.telegramId }],
        [{ id: 'pi_test' }],
        [{ id: 'pi_test' }],
        [], // debit invariant failure forces reconciliation deferral
      ],
      selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: renewal.configUsername,
      status: 'active',
      data_limit: null,
      expire: 1_700_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.updateUser.mockResolvedValueOnce({
      username: renewal.configUsername,
      status: 'active',
      data_limit: 25 * 1024 * 1024 * 1024,
      expire: Math.floor(Date.now() / 1000) + renewal.durationDays * 86400,
      subscription_url: 'https://sub.example.test/renewed',
    });

    await expect(walletService.executePurchaseSaga(renewal)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    expect(mockRebeccaService.updateUser).toHaveBeenCalledTimes(1);
    expect(
      state.setCalls.some(
        (call) =>
          call.status === 'reconciliation_required' ||
          call.errorMessage ===
            'Remote renewal applied (traffic reset) but local commit failed; reconciliation required'
      )
    ).toBe(true);
  });

  it('does not release funds when local commit and compensation outcomes are both unknown', async () => {
    const { db, state } = createDbMock({
      returningResults: [
        [{ telegramId: purchase.telegramId }], // initial guarded reserve
        [{ id: 'pi_test' }], // completed transition; DB then fails on debit
        [], // debit invariant failure rolls the real transaction back
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    mockRebeccaService.deleteUser.mockRejectedValue(
      new RebeccaOriginDownError('/api/user', 521, 4)
    );

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    expect(mockRebeccaService.deleteUser).toHaveBeenCalledWith(purchase.configUsername);
    expect(state.setCalls.some((values) => values.status === 'failed')).toBe(false);
    expect(
      state.setCalls.some(
        (values) =>
          values.status === 'pending' &&
          values.errorMessage ===
            'Local commit failed after remote success; awaiting reconciliation'
      )
    ).toBe(true);
  });

  it('rejects a second action before starting another reservation', async () => {
    const { db, state } = createDbMock({ selectResults: [[{ id: 'pi_pending' }]] });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseInProgressError
    );

    expect(state.transaction).not.toHaveBeenCalled();
    expect(mockRebeccaService.createUser).not.toHaveBeenCalled();
  });

  it('rejects unsafe saga and top-up amounts at the service boundary', async () => {
    const { db } = createDbMock();
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(walletService.executePurchaseSaga({ ...purchase, amount: 1.5 })).rejects.toThrow(
      'INVALID_PURCHASE_AMOUNT'
    );
    await expect(walletService.executePurchaseSaga({ ...purchase, gbAmount: 0 })).rejects.toThrow(
      'INVALID_GB_AMOUNT'
    );
    await expect(
      walletService.executePurchaseSaga({ ...purchase, durationDays: 3_651 })
    ).rejects.toThrow('INVALID_DURATION_DAYS');
    await expect(
      walletService.submitTopupReceipt(purchase.telegramId, -1, 'photo')
    ).rejects.toThrow('INVALID_TOPUP_AMOUNT');
  });

  it('serializes receipt submission and rejects a second pending receipt', async () => {
    const { db, state } = createDbMock({
      selectResults: [[{ telegramId: purchase.telegramId }], []],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.submitTopupReceipt(purchase.telegramId, 100_000, 'photo-file')
    ).resolves.toMatch(/^rec_/u);
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        telegramId: purchase.telegramId,
        amount: 100_000,
        photoFileId: 'photo-file',
        status: 'pending',
      })
    );

    const { db: duplicateDb } = createDbMock({
      selectResults: [[{ telegramId: purchase.telegramId }], [{ id: 'rec_pending' }]],
    });
    vi.mocked(getDb).mockReturnValue(duplicateDb as never);
    await expect(
      walletService.submitTopupReceipt(purchase.telegramId, 200_000, 'other-photo')
    ).rejects.toBeInstanceOf(PendingTopupReceiptError);
  });

  it('approves and rejects topup receipts returning target telegramId and amount', async () => {
    const { db } = createDbMock({
      returningResults: [
        [{ id: 'rec_1', telegramId: 999, amount: 50_000 }], // update topupReceipts
        [{ balance: 50_000 }], // update users balance
      ],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const approveRes = await walletService.approveTopup('rec_1', 1);
    expect(approveRes).toEqual({ telegramId: 999, amount: 50_000 });

    const { db: rejectDb } = createDbMock({
      returningResults: [[{ id: 'rec_2', telegramId: 888 }]],
    });
    vi.mocked(getDb).mockReturnValue(rejectDb as never);

    const rejectRes = await walletService.rejectTopup('rec_2', 1);
    expect(rejectRes).toEqual({ telegramId: 888 });
  });

  it('persists the configured default locale for a new user without a Telegram locale', async () => {
    const { db, state } = createDbMock({
      selectResults: [[]],
      returningResults: [[{ telegramId: 4321, locale: 'en' }]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const translationService = {
      getSettingNum: vi.fn(() => 1),
      resolveLocale: vi.fn(() => 'en'),
    };
    walletService = new WalletService(
      mockRebeccaService as unknown as RebeccaService,
      translationService as unknown as TranslationService,
      mockReferralService as unknown as ReferralService,
      mockPromoService as unknown as PromoService
    );

    await expect(walletService.getOrCreateUser(4321)).resolves.toMatchObject({ locale: 'en' });

    expect(translationService.resolveLocale).toHaveBeenCalledWith();
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({ telegramId: 4321, locale: 'en' })
    );
  });

  it('atomically audits add, deduct, and set admin wallet operations', async () => {
    const { db: addDb, state: addState } = createDbMock({
      selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
      returningResults: [[{ balance: 125 }]],
    });
    vi.mocked(getDb).mockReturnValue(addDb as never);

    await expect(
      walletService.adjustBalanceAdmin({
        telegramId: 4321,
        operation: 'add',
        amount: 25,
        adminId: 99,
        description: 'Admin dashboard adjustment',
      })
    ).resolves.toBe(125);
    expect(addState.insertValues).toContainEqual(
      expect.objectContaining({ amount: 25, balanceAfter: 125, type: 'admin_adjustment' })
    );

    const { db: deductDb, state: deductState } = createDbMock({
      selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
      returningResults: [[{ balance: 40 }]],
    });
    vi.mocked(getDb).mockReturnValue(deductDb as never);
    await expect(
      walletService.adjustBalanceAdmin({
        telegramId: 4321,
        operation: 'deduct',
        amount: 60,
        adminId: 99,
        description: 'Admin dashboard adjustment',
      })
    ).resolves.toBe(40);
    expect(deductState.insertValues).toContainEqual(
      expect.objectContaining({ amount: -60, balanceAfter: 40, type: 'admin_adjustment' })
    );

    const { db: setDb, state: setState } = createDbMock({
      selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 20 }]],
      returningResults: [[{ balance: 50 }]],
    });
    vi.mocked(getDb).mockReturnValue(setDb as never);
    await expect(
      walletService.adjustBalanceAdmin({
        telegramId: 4321,
        operation: 'set',
        amount: 50,
        adminId: 99,
        description: 'Admin dashboard adjustment',
      })
    ).resolves.toBe(50);
    expect(setState.insertValues).toContainEqual(
      expect.objectContaining({ amount: -50, balanceAfter: 50, type: 'admin_adjustment' })
    );
  });

  it('replays a referenced admin adjustment without applying it twice', async () => {
    const description = 'Quick top-up from admin profile';
    const auditDescription = `Admin 99: add; ${description}`;
    const { db, state } = createDbMock({
      selectResults: [
        [{ telegramId: 4321, balance: 100, reservedBalance: 20 }],
        [],
        [{ telegramId: 4321, balance: 125, reservedBalance: 20 }],
        [
          {
            telegramId: 4321,
            amount: 25,
            balanceAfter: 125,
            type: 'admin_adjustment',
            description: auditDescription,
          },
        ],
      ],
      returningResults: [[{ balance: 125 }]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const adjustment = {
      telegramId: 4321,
      operation: 'add' as const,
      amount: 25,
      adminId: 99,
      description,
      referenceId: 'admin_quick_topup_deadbeef',
    };

    await expect(walletService.adjustBalanceAdmin(adjustment)).resolves.toBe(125);
    await expect(walletService.adjustBalanceAdmin(adjustment)).resolves.toBe(125);

    expect(state.updateCalls).toHaveLength(1);
    expect(state.insertValues).toHaveLength(2);
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        referenceId: adjustment.referenceId,
        amount: 25,
        balanceAfter: 125,
        type: 'admin_adjustment',
      })
    );
  });

  it('never lets an admin operation reduce the balance below reserved funds', async () => {
    const { db, state } = createDbMock({
      selectResults: [[{ telegramId: 4321, balance: 100, reservedBalance: 80 }]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.adjustBalanceAdmin({
        telegramId: 4321,
        operation: 'deduct',
        amount: 30,
        adminId: 99,
        description: 'Admin dashboard adjustment',
      })
    ).rejects.toThrow('ADMIN_BALANCE_BELOW_RESERVED');
    expect(state.updateCalls).toHaveLength(0);
    expect(state.insertValues).toHaveLength(0);
  });
});
