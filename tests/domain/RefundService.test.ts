import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RefundOutcomePendingError,
  RefundService,
} from '../../src/domain/services/RefundService.js';
import { RebeccaApiError } from '../../src/domain/services/RebeccaService.js';
import { getDb, getPool } from '../../src/infra/db.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createRemoteUser(
  username: string,
  createdAt: string,
  overrides: Partial<RebeccaUserDetail> = {}
): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * 1024 ** 3,
    expire: null,
    created_at: createdAt,
    subscription_url: `https://sub.example/sub/${username}`,
    links: [],
    proxies: {},
    inbounds: {},
    ...overrides,
  };
}

describe('RefundService', () => {
  const getDbMock = vi.mocked(getDb);
  const getPoolMock = vi.mocked(getPool);

  let mockRebecca: {
    getUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let mockPanels: RebeccaPanelRegistry;
  let mockTs: TranslationService;

  beforeEach(() => {
    vi.clearAllMocks();
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn(async (sqlText: string) => {
          if (sqlText.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sqlText.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
          return { rows: [] };
        }),
        release: vi.fn(),
      }),
    } as never);

    mockRebecca = {
      getUser: vi.fn(),
      deleteUser: vi.fn().mockResolvedValue({ status: 'deleted' }),
    };
    mockPanels = {
      getService: vi.fn(() => mockRebecca as unknown as RebeccaService),
      resolveTarget: vi.fn().mockResolvedValue({ panelId: 'legacy', serviceId: 1 }),
      getEnabledPanelIds: vi.fn(() => ['legacy']),
      getDefaultPanelId: vi.fn(() => 'legacy'),
    } as unknown as RebeccaPanelRegistry;
    mockTs = {
      getSettingNum: vi.fn((_k: string, fb: number) => fb),
    } as unknown as TranslationService;
  });

  const localConfig = {
    id: 'uc_alice',
    telegramId: 1001,
    panelId: 'legacy',
    configUsername: 'alice_refund',
    remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
  };

  it('withholds credited cashback, rejects attached referral rewards, enforces completedAt refund window, and validates remote incarnation', async () => {
    const refundService = new RefundService(mockPanels, mockTs);
    const recentIntent = {
      id: 'pi_init_1',
      telegramId: 1001,
      panelId: 'legacy',
      amount: 100_000,
      configUsername: 'alice_refund',
      type: 'new_config',
      status: 'completed',
      createdAt: new Date(Date.now() - 3 * 3600_000),
      completedAt: new Date(Date.now() - 30 * 60_000),
      refundedAt: null,
    };

    // Quote withholds 10,000 cashback -> 90,000 net refund using 2h window against completedAt (not 3h createdAt)
    vi.mocked(mockTs.getSettingNum).mockReturnValue(2);
    mockRebecca.getUser.mockResolvedValue(createRemoteUser('alice_refund', '2026-01-01T00:00:00Z'));
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [
          [localConfig],
          [recentIntent],
          [], // refundIntents
          [], // referralReward
          [{ id: 'tx_cb_1', amount: 10_000 }], // cashback
        ],
      }).db as never
    );
    await expect(refundService.quote(1001, 'uc_alice')).resolves.toEqual({
      eligible: true,
      configId: 'uc_alice',
      configUsername: 'alice_refund',
      panelId: 'legacy',
      grossAmount: 100_000,
      cashbackWithheld: 10_000,
      refundAmount: 90_000,
      purchaseIntentId: 'pi_init_1',
      purchasedAt: recentIntent.completedAt,
    });

    // Rejects when referral reward is attached
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [[localConfig], [recentIntent], [], [{ id: 'tx_ref_reward_1' }]],
      }).db as never
    );
    await expect(refundService.quote(1001, 'uc_alice')).resolves.toEqual({
      eligible: false,
      reason: 'referral_reward_attached',
    });

    // Rejects when remote user incarnation differs
    mockRebecca.getUser.mockResolvedValue(createRemoteUser('alice_refund', '2026-06-01T00:00:00Z'));
    getDbMock.mockReturnValue(
      createMockDb({
        selectResults: [[localConfig], [recentIntent], [], [], []],
      }).db as never
    );
    await expect(refundService.quote(1001, 'uc_alice')).resolves.toEqual({
      eligible: false,
      reason: 'ownership_mismatch',
    });
  });

  it('locks purchase intent inside acquireRefundIntent, verifies ownership marker pre-delete, executes refund, and invalidates cache post-commit', async () => {
    const refundService = new RefundService(mockPanels, mockTs);
    const invalidated: number[] = [];
    refundService.registerInvalidationHook((id) => invalidated.push(id));

    const recentIntent = {
      id: 'pi_refund_exec',
      telegramId: 1001,
      panelId: 'legacy',
      amount: 100_000,
      configUsername: 'alice_refund',
      type: 'new_config',
      status: 'completed',
      createdAt: new Date(Date.now() - 30 * 60_000),
      completedAt: new Date(Date.now() - 30 * 60_000),
      refundedAt: null,
    };

    // Case 1: remote ownership marker mismatch before delete -> fails intent, keeps remote user, never triggers hook
    mockRebecca.getUser
      .mockResolvedValueOnce(
        createRemoteUser('alice_refund', '2026-01-01T00:00:00Z', {
          note: 'rsbot:pi_refund_exec',
        })
      )
      .mockResolvedValueOnce(
        createRemoteUser('alice_refund', '2026-01-01T00:00:00Z', {
          note: 'rsbot:pi_someone_else',
        })
      );

    const markerMismatchDb = createMockDb({
      selectResults: [
        // quote()
        [localConfig],
        [recentIntent],
        [],
        [],
        [],
        // acquireRefundIntent() inside transaction
        [recentIntent], // FOR UPDATE
        [], // referralReward
        [], // cashback
        // executeDeleteWithRefund pre-delete localConfig lookup
        [localConfig],
      ],
      returningResults: [[{ id: 'ri_created' }], [{ id: 'ri_created' }]],
    });
    getDbMock.mockReturnValue(markerMismatchDb.db as never);

    await expect(refundService.executeDeleteWithRefund(1001, 'uc_alice')).resolves.toEqual({
      eligible: false,
      reason: 'ownership_mismatch',
    });
    // acquireRefundIntent locked purchaseIntents row with FOR UPDATE
    expect(markerMismatchDb.state.selectCalls.some((c) => c.lock === 'update')).toBe(true);
    expect(mockRebecca.deleteUser).not.toHaveBeenCalled();
    expect(invalidated).toEqual([]);

    // Case 2: full refund deletes remote user, inserts refund wallet tx + audit log, updates userConfigs & purchaseIntents, and invokes post-commit hook
    mockRebecca.getUser.mockResolvedValue(
      createRemoteUser('alice_refund', '2026-01-01T00:00:00Z', {
        note: 'rsbot:pi_refund_exec',
      })
    );
    const successDb = createMockDb({
      selectResults: [
        // quote()
        [localConfig],
        [recentIntent],
        [],
        [],
        [{ amount: 10_000 }],
        // acquireRefundIntent()
        [recentIntent],
        [],
        [{ amount: 10_000 }],
        // pre-delete localConfig lookup
        [localConfig],
        // completeRefundIntent()
        [
          {
            id: 'ri_ok',
            purchaseIntentId: 'pi_refund_exec',
            telegramId: 1001,
            panelId: 'legacy',
            configUsername: 'alice_refund',
            grossAmount: 100_000,
            cashbackWithheld: 10_000,
            refundAmount: 90_000,
            status: 'pending',
          },
        ],
        [recentIntent], // lockedPurchaseIntent inside completeRefundIntent
      ],
      returningResults: [
        [{ id: 'ri_ok' }], // acquire insert
        [{ id: 'ri_ok' }], // refreshLease before getUser
        [{ id: 'ri_ok' }], // refreshLease before deleteUser
        [{ id: 'ri_ok' }], // completeRefundIntent status transition
        [{ balance: 190_000 }], // users credit
      ],
    });
    getDbMock.mockReturnValue(successDb.db as never);

    const outcome = await refundService.executeDeleteWithRefund(1001, 'uc_alice');
    expect(outcome).toMatchObject({
      eligible: true,
      grossAmount: 100_000,
      cashbackWithheld: 10_000,
      refundAmount: 90_000,
    });
    expect(mockRebecca.deleteUser).toHaveBeenCalledWith('alice_refund');
    expect(successDb.state.insertCalls.map((c) => c.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          telegramId: 1001,
          amount: 90_000,
          balanceAfter: 190_000,
          type: 'refund',
          referenceId: 'refund_pi_refund_exec',
        }),
        expect.objectContaining({
          action: 'subscription_refunded_deleted',
          entityId: 'alice_refund',
        }),
      ])
    );
    expect(invalidated).toEqual([1001]);
  });

  it('defers unknown remote delete errors to reconciliation_required and reconciles stale refund intents', async () => {
    const refundService = new RefundService(mockPanels, mockTs);
    const invalidated: number[] = [];
    refundService.registerInvalidationHook((id) => invalidated.push(id));

    const recentIntent = {
      id: 'pi_unknown_del',
      telegramId: 1001,
      panelId: 'legacy',
      amount: 50_000,
      configUsername: 'alice_refund',
      type: 'new_config',
      status: 'completed',
      createdAt: new Date(Date.now() - 30 * 60_000),
      completedAt: new Date(Date.now() - 30 * 60_000),
      refundedAt: null,
    };

    mockRebecca.getUser.mockResolvedValue(createRemoteUser('alice_refund', '2026-01-01T00:00:00Z'));
    mockRebecca.deleteUser.mockRejectedValueOnce(
      new RebeccaApiError(502, '/api/user/alice_refund', 'bad gateway')
    );

    const deferDb = createMockDb({
      selectResults: [
        [localConfig],
        [recentIntent],
        [],
        [],
        [],
        [recentIntent],
        [],
        [],
        [localConfig],
      ],
      returningResults: [[{ id: 'ri_defer' }], [{ id: 'ri_defer' }], [{ id: 'ri_defer' }]],
    });
    getDbMock.mockReturnValue(deferDb.db as never);
    await expect(refundService.executeDeleteWithRefund(1001, 'uc_alice')).rejects.toBeInstanceOf(
      RefundOutcomePendingError
    );
    expect(deferDb.state.updateCalls.some((c) => c.set.status === 'reconciliation_required')).toBe(
      true
    );
    expect(invalidated).toEqual([]);

    // reconcilePendingRefunds completes 404-absent delete & triggers invalidation hook, and fails active remote user
    const reconDb = createMockDb({
      selectResults: [
        [
          {
            id: 'ri_abs',
            purchaseIntentId: 'pi_abs',
            telegramId: 2001,
            panelId: 'legacy',
            configUsername: 'deleted_cfg',
            grossAmount: 50_000,
            cashbackWithheld: 0,
            refundAmount: 50_000,
            status: 'reconciliation_required',
          },
          {
            id: 'ri_still_there',
            purchaseIntentId: 'pi_still',
            telegramId: 2002,
            panelId: 'legacy',
            configUsername: 'still_active',
            grossAmount: 50_000,
            cashbackWithheld: 0,
            refundAmount: 50_000,
            status: 'reconciliation_required',
          },
        ],
        // completeRefundIntent for ri_abs
        [
          {
            id: 'ri_abs',
            purchaseIntentId: 'pi_abs',
            telegramId: 2001,
            panelId: 'legacy',
            configUsername: 'deleted_cfg',
            grossAmount: 50_000,
            cashbackWithheld: 0,
            refundAmount: 50_000,
            status: 'reconciliation_required',
          },
        ],
        [{ id: 'pi_abs' }],
      ],
      returningResults: [
        [{ id: 'ri_abs' }],
        [{ id: 'ri_abs' }],
        [{ balance: 50_000 }],
        [{ id: 'ri_still_there' }],
      ],
    });
    getDbMock.mockReturnValue(reconDb.db as never);
    mockRebecca.getUser
      .mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/deleted_cfg', 'not found'))
      .mockResolvedValueOnce(createRemoteUser('still_active', '2026-01-01T00:00:00Z'));

    await expect(refundService.reconcilePendingRefunds()).resolves.toBe(2);
    expect(invalidated).toEqual([2001]);
    expect(reconDb.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(true);
  });
});
