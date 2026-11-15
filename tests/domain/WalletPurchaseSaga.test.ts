import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
  WalletService,
} from '../../src/domain/services/WalletService.js';
import { PARTIAL_RENEWAL_REVIEW_MESSAGE } from '../../src/domain/services/WalletContracts.js';
import { WalletPurchaseSaga } from '../../src/domain/services/WalletPurchaseSaga.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
} from '../../src/domain/services/RebeccaService.js';
import { getDb, getPool } from '../../src/infra/db.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

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

describe('WalletPurchaseSaga (reserve -> remote -> commit)', () => {
  const getDbMock = vi.mocked(getDb);
  const getPoolMock = vi.mocked(getPool);

  let walletService: WalletService;
  let mockRebeccaService: {
    createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    resetUserTraffic: ReturnType<typeof vi.fn>;
  };
  let mockReferralService: {
    calculateBonusSnapshot: ReturnType<typeof vi.fn>;
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
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ locked: true, unlocked: true }] }),
        release: vi.fn(),
      }),
    } as never);

    mockRebeccaService = {
      createUser: vi.fn().mockImplementation(async (payload: { note?: string }) => ({
        username: purchase.configUsername,
        status: 'active',
        data_limit: purchase.gbAmount * 1024 ** 3,
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
      calculateBonusSnapshot: vi.fn().mockResolvedValue({
        cashbackPercent: 0,
        cashbackAmount: 0,
        referrerTelegramId: null,
        referralBonusAmount: 0,
      }),
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

  it('rejects insufficient funds, invalid bounds, and concurrent pending intents before calling remote', async () => {
    const emptyDb = createMockDb();
    getDbMock.mockReturnValue(emptyDb.db as never);
    await expect(walletService.executePurchaseSaga({ ...purchase, amount: 1.5 })).rejects.toThrow(
      'INVALID_PURCHASE_AMOUNT'
    );
    await expect(walletService.executePurchaseSaga({ ...purchase, gbAmount: 0 })).rejects.toThrow(
      'INVALID_GB_AMOUNT'
    );
    await expect(
      walletService.executePurchaseSaga({ ...purchase, durationDays: 3_651 })
    ).rejects.toThrow('INVALID_DURATION_DAYS');

    getDbMock.mockReturnValue(createMockDb({ returningResults: [[]] }).db as never);
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toThrow(
      'INSUFFICIENT_BALANCE'
    );
    expect(mockRebeccaService.createUser).not.toHaveBeenCalled();

    const pendingDb = createMockDb({ selectResults: [[{ id: 'pi_pending' }]] });
    getDbMock.mockReturnValue(pendingDb.db as never);
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseInProgressError
    );
    expect(pendingDb.state.transactionCount).toBe(0);
    expect(mockRebeccaService.createUser).not.toHaveBeenCalled();
  });

  it('releases reservation on pre-origin failures and definite 4xx business errors', async () => {
    const preOriginDb = createMockDb({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ telegramId: purchase.telegramId }],
      ],
    });
    getDbMock.mockReturnValue(preOriginDb.db as never);
    const originDown = new RebeccaOriginDownError('/api/user', null, 4);
    mockRebeccaService.createUser.mockRejectedValue(originDown);

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBe(originDown);
    expect(mockRebeccaService.deleteUser).not.toHaveBeenCalled();
    expect(preOriginDb.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(true);
    expect(preOriginDb.state.updateCalls.filter((c) => 'reservedBalance' in c.set)).toHaveLength(2);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    const businessFailDb = createMockDb({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ telegramId: purchase.telegramId }],
      ],
    });
    getDbMock.mockReturnValue(businessFailDb.db as never);
    mockRebeccaService.createUser.mockRejectedValue(
      new RebeccaApiError(422, '/api/user', 'invalid user')
    );

    await expect(walletService.executePurchaseSaga(purchase)).rejects.toThrow(
      'VPN Panel operation failed'
    );
    expect(businessFailDb.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(true);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).toHaveBeenCalledOnce();
    expect(mockRebeccaService.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps reservation pending when create response is lost, violates contract, returns partial state, or returns 409/503', async () => {
    // Dispatched origin-down error
    const dispatchedDb = createMockDb({
      returningResults: [[{ telegramId: purchase.telegramId }]],
    });
    getDbMock.mockReturnValue(dispatchedDb.db as never);
    mockRebeccaService.createUser.mockRejectedValueOnce(
      new RebeccaOriginDownError('/api/user', null, 5, true)
    );
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );
    expect(dispatchedDb.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(false);
    expect(
      dispatchedDb.state.updateCalls.some(
        (c) =>
          c.set.status === 'pending' &&
          c.set.errorMessage === 'Remote outcome unknown; awaiting reconciliation'
      )
    ).toBe(true);
    expect(mockPromoService.releaseReservedPurchasePromoInTransaction).not.toHaveBeenCalled();

    // 2xx contract violation
    const contractDb = createMockDb({ returningResults: [[{ telegramId: purchase.telegramId }]] });
    getDbMock.mockReturnValue(contractDb.db as never);
    mockRebeccaService.createUser.mockRejectedValueOnce(new RebeccaContractError('/api/user', 2));
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );

    // Indeterminate 409 / 503
    for (const status of [409, 503]) {
      const httpDb = createMockDb({ returningResults: [[{ telegramId: purchase.telegramId }]] });
      getDbMock.mockReturnValue(httpDb.db as never);
      mockRebeccaService.createUser.mockRejectedValueOnce(
        new RebeccaApiError(status, '/api/user', 'indeterminate response')
      );
      await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
        PurchaseOutcomePendingError
      );
      expect(httpDb.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(false);
    }

    // Successful create missing expected expire proof -> keeps pending
    const incompleteDb = createMockDb({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ telegramId: purchase.telegramId }],
      ],
    });
    getDbMock.mockReturnValue(incompleteDb.db as never);
    mockRebeccaService.createUser.mockImplementationOnce(async (payload: { note?: string }) => ({
      username: purchase.configUsername,
      status: 'active',
      data_limit: purchase.gbAmount * 1024 ** 3,
      expire: null,
      created_at: RENEWAL_CREATED_AT,
      subscription_url: 'https://sub.example.test/primary',
      note: payload.note ?? null,
    }));
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );
    expect(incompleteDb.state.updateCalls.some((c) => c.set.status === 'completed')).toBe(false);
    expect(incompleteDb.state.updateCalls.some((c) => c.set.status === 'pending')).toBe(true);
  });

  it('commits new_config purchase with promo & referral hooks atomically', async () => {
    const { db, state } = createMockDb({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ balance: 50_000 }],
      ],
    });
    getDbMock.mockReturnValue(db as never);
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
      data_limit: 15 * 1024 ** 3,
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
    expect(state.updateCalls.filter((c) => c.set.status === 'completed')).toHaveLength(1);
    expect(mockReferralService.processCompletedPurchase).toHaveBeenCalledWith(
      purchase.telegramId,
      40_000,
      expect.stringMatching(/^pi_/)
    );
    expect(mockPromoService.finalizeReservedPurchasePromo).toHaveBeenCalledOnce();
    expect(state.insertCalls.map((c) => c.values)).toContainEqual(
      expect.objectContaining({
        configUsername: purchase.configUsername,
        panelStatus: 'active',
        panelDataLimit: 15 * 1024 ** 3,
      })
    );
    expect(state.updateCalls.some((c) => 'activeSubscriptionCount' in c.set)).toBe(true);
  });

  it('handles active, disabled, limited, expired, incarnation-mismatched, reset-failed, and lock-busy renewals', async () => {
    for (const remoteStatus of ['active', 'disabled', 'limited', 'expired'] as const) {
      const renewal = {
        ...purchase,
        type: 'renew_config' as const,
        configUsername: `${remoteStatus}_user`,
        gbAmount: 50,
        durationDays: 30,
      };
      const { db, state } = createMockDb({
        returningResults: [
          [{ telegramId: renewal.telegramId }],
          [{ id: 'pi_test' }],
          [{ id: 'pi_test' }],
          [{ balance: 50_000 }],
          [{ id: `uc_${renewal.configUsername}` }],
        ],
        selectResults: [[], [verifiedRenewalBinding(renewal.telegramId, renewal.configUsername)]],
      });
      getDbMock.mockReturnValue(db as never);
      mockRebeccaService.getUser.mockResolvedValue({
        username: renewal.configUsername,
        status: remoteStatus,
        data_limit: null,
        expire: 1_700_000_000,
        created_at: RENEWAL_CREATED_AT,
      });
      mockRebeccaService.resetUserTraffic.mockResolvedValue({
        username: renewal.configUsername,
        status: 'active',
        used_traffic: 0,
      });
      mockRebeccaService.updateUser.mockResolvedValue({
        username: renewal.configUsername,
        status: 'active',
        data_limit: 50 * 1024 ** 3,
        expire: Math.floor(Date.now() / 1000) + renewal.durationDays * 86400,
        subscription_url: `https://sub.example.test/${remoteStatus}`,
      });

      await expect(walletService.executePurchaseSaga(renewal)).resolves.toMatchObject({
        success: true,
      });
      expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith(renewal.configUsername);
      expect(mockRebeccaService.updateUser).toHaveBeenCalledWith(
        renewal.configUsername,
        expect.objectContaining({ status: 'active', data_limit: 50 * 1024 ** 3 })
      );
      expect(
        state.updateCalls.some(
          (c) => c.set.panelStatus === 'active' && c.set.panelDataLimit === 50 * 1024 ** 3
        )
      ).toBe(true);
    }

    // Incarnation mismatch fails closed before resetUserTraffic
    mockRebeccaService.resetUserTraffic.mockClear();
    const mismatchRenewal = {
      ...purchase,
      type: 'renew_config' as const,
      configUsername: 'recreated_renewal',
    };
    const mismatchDb = createMockDb({
      returningResults: [
        [{ telegramId: mismatchRenewal.telegramId }],
        [{ id: 'pi_test' }],
        [{ telegramId: mismatchRenewal.telegramId }],
      ],
      selectResults: [
        [],
        [verifiedRenewalBinding(mismatchRenewal.telegramId, 'recreated_renewal')],
      ],
    });
    getDbMock.mockReturnValue(mismatchDb.db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: 'recreated_renewal',
      status: 'active',
      data_limit: 10 * 1024 ** 3,
      expire: 1_700_000_000,
      created_at: '2026-06-01T00:00:00Z',
    });
    await expect(walletService.executePurchaseSaga(mismatchRenewal)).rejects.toThrow(
      'CONFIG_INCARNATION_MISMATCH'
    );
    expect(mockRebeccaService.resetUserTraffic).not.toHaveBeenCalled();

    // Traffic reset failure releases reservation
    const resetFailDb = createMockDb({
      returningResults: [
        [{ telegramId: purchase.telegramId }],
        [{ id: 'pi_test' }],
        [{ id: 'pi_test' }],
        [{ telegramId: purchase.telegramId }],
      ],
      selectResults: [[], [verifiedRenewalBinding(purchase.telegramId, 'reset_fail')]],
    });
    getDbMock.mockReturnValue(resetFailDb.db as never);
    mockRebeccaService.getUser.mockResolvedValue({
      username: 'reset_fail',
      status: 'active',
      data_limit: 10 * 1024 ** 3,
      expire: 1_700_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.resetUserTraffic.mockRejectedValueOnce(new Error('Reset API error'));
    await expect(
      walletService.executePurchaseSaga({
        ...purchase,
        type: 'renew_config',
        configUsername: 'reset_fail',
      })
    ).rejects.toThrow('Reset API error');

    // Traffic reset succeeds then updateUser loses origin -> manual review pending error
    const partialDb = createMockDb({
      returningResults: [[{ telegramId: purchase.telegramId }], [{ id: 'pi_test' }]],
      selectResults: [[], [verifiedRenewalBinding(purchase.telegramId, 'partial_renewal')]],
    });
    getDbMock.mockReturnValue(partialDb.db as never);
    mockRebeccaService.resetUserTraffic.mockResolvedValueOnce({ username: 'partial_renewal' });
    mockRebeccaService.updateUser.mockRejectedValueOnce(
      new RebeccaOriginDownError('/api/user/partial_renewal', null, 4, false)
    );
    await expect(
      walletService.executePurchaseSaga({
        ...purchase,
        type: 'renew_config',
        configUsername: 'partial_renewal',
      })
    ).rejects.toBeInstanceOf(PurchaseOutcomePendingError);
    expect(
      partialDb.state.updateCalls.some((c) => c.set.errorMessage === PARTIAL_RENEWAL_REVIEW_MESSAGE)
    ).toBe(true);

    // Concurrent advisory lock contention on WalletPurchaseSaga.execute -> CONFIG_MUTATION_BUSY
    const busyClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({ connect: vi.fn().mockResolvedValue(busyClient) } as never);
    const saga = new WalletPurchaseSaga(
      {
        resolveTarget: vi
          .fn()
          .mockResolvedValue({ panelId: 'legacy', serviceId: 1, service: mockRebeccaService }),
      } as unknown as RebeccaPanelRegistry,
      mockReferralService as unknown as ReferralService,
      mockPromoService as unknown as PromoService
    );
    const lockBusyDb = createMockDb({
      returningResults: [[{ telegramId: 1001 }], [{ id: 'pi_lock' }], [{ telegramId: 1001 }]],
      selectResults: [[]],
    });
    getDbMock.mockReturnValue(lockBusyDb.db as never);
    await expect(
      saga.execute({
        telegramId: 1001,
        panelId: 'legacy',
        serviceId: 1,
        configUsername: 'alice_conc',
        type: 'renew_config',
        amount: 50_000,
        gbAmount: 10,
        durationDays: 30,
      })
    ).rejects.toThrow('CONFIG_MUTATION_BUSY');
  });

  it('defers to reconciliation_required when renewal ownership is lost at commit or create compensation fails', async () => {
    // Lost userConfigs ownership at Step 3 commit forces reconciliation deferral
    const lostDb = createMockDb({
      returningResults: [
        [{ telegramId: 1001 }],
        [{ id: 'pi_1' }],
        [{ id: 'pi_1' }],
        [{ balance: 50_000 }],
        [], // userConfigs ownership lost!
      ],
      selectResults: [[], [verifiedRenewalBinding(1001, 'alice_renew')], [{ status: 'pending' }]],
    });
    getDbMock.mockReturnValue(lostDb.db as never);
    mockRebeccaService.getUser.mockResolvedValueOnce({
      username: 'alice_renew',
      status: 'active',
      data_limit: null,
      expire: 1_780_000_000,
      created_at: RENEWAL_CREATED_AT,
    });
    mockRebeccaService.resetUserTraffic.mockResolvedValueOnce({ username: 'alice_renew' });
    mockRebeccaService.updateUser.mockResolvedValueOnce({
      username: 'alice_renew',
      status: 'active',
      data_limit: 25 * 1024 ** 3,
      expire: Math.floor(Date.now() / 1000) + 30 * 86400,
      subscription_url: 'https://sub.example.test/renewed',
    });

    await expect(
      walletService.executePurchaseSaga({
        ...purchase,
        type: 'renew_config',
        configUsername: 'alice_renew',
        gbAmount: 25,
      })
    ).rejects.toBeInstanceOf(PurchaseOutcomePendingError);
    expect(
      lostDb.state.updateCalls.some(
        (c) =>
          c.set.status === 'reconciliation_required' ||
          c.set.errorMessage ===
            'Remote renewal applied (traffic reset) but local commit failed; reconciliation required'
      )
    ).toBe(true);

    // Failed local commit + failed deleteUser compensation leaves pending awaiting reconciliation
    const doubleFaultDb = createMockDb({
      returningResults: [[{ telegramId: purchase.telegramId }], [{ id: 'pi_test' }], []],
    });
    getDbMock.mockReturnValue(doubleFaultDb.db as never);
    mockRebeccaService.deleteUser.mockRejectedValueOnce(
      new RebeccaOriginDownError('/api/user', 521, 4)
    );
    await expect(walletService.executePurchaseSaga(purchase)).rejects.toBeInstanceOf(
      PurchaseOutcomePendingError
    );
    expect(mockRebeccaService.deleteUser).toHaveBeenCalledWith(purchase.configUsername);
    expect(
      doubleFaultDb.state.updateCalls.some(
        (c) =>
          c.set.status === 'pending' &&
          c.set.errorMessage === 'Local commit failed after remote success; awaiting reconciliation'
      )
    ).toBe(true);
  });
});
