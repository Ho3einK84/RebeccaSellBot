import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { RebeccaApiError, type RebeccaService } from '../../src/domain/services/RebeccaService.js';
import { TrialService } from '../../src/domain/services/TrialService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('TrialService', () => {
  const getDbMock = vi.mocked(getDb);
  let panelService: {
    createUser: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };

  function createService(enabled = true, gb = 1, days = 3) {
    panelService = {
      createUser: vi.fn(),
      getUser: vi.fn(),
      deleteUser: vi.fn(),
    };
    const ts = {
      getSettingBool: vi.fn().mockReturnValue(enabled),
      getSettingNum: vi.fn((key: string, fallback: number) => {
        if (key === 'trial_gb') return gb;
        if (key === 'trial_days') return days;
        return fallback;
      }),
    } as unknown as TranslationService;
    return {
      service: new TrialService(panelService as unknown as RebeccaService, ts),
      panel: panelService,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects disabled trials, invalid config names, missing users, and repeat claimants without remote calls', async () => {
    const { service: disabledSvc, panel: p0 } = createService(false);
    await expect(disabledSvc.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'trial_disabled',
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(p0.createUser).not.toHaveBeenCalled();

    const { service } = createService();
    await expect(service.claimTrial(10, 'a')).resolves.toEqual({
      success: false,
      messageKey: 'trial_creation_failed',
    });

    getDbMock.mockReturnValue(createMockDb({ selectResults: [[]] }).db as never);
    await expect(service.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'user_not_found',
    });

    getDbMock.mockReturnValue(
      createMockDb({ selectResults: [[{ balance: 0, hasUsedTrial: true }]] }).db as never
    );
    await expect(service.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'trial_already_used',
    });
  });

  it('reserves DB claim before calling Rebecca, tags ownership marker, and binds config atomically', async () => {
    const { service, panel } = createService(true, 2, 5);
    const callOrder: string[] = [];

    const mock = createMockDb({
      selectResults: [
        [{ balance: 0, hasUsedTrial: false }], // reserveClaim -> users lookup
        [{ configUsername: 'trial_10', status: 'pending', subUrl: null }], // finalize -> currentClaim
      ],
      returningResults: [
        [
          {
            telegramId: 10,
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'trial_10',
            gbAmount: 2,
            durationDays: 5,
            status: 'pending',
            subUrl: null,
          },
        ], // reserveClaim insert returning
        [{ balance: 0 }], // finalize -> update(users) hasUsedTrial returning
        [{ telegramId: 10 }], // finalize -> insert(userConfigs) returning
        [{ id: 'tx_1' }], // finalize -> insert(walletTransactions) returning
        [{ telegramId: 10 }], // finalize -> update(trialClaims) completed returning
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    panel.createUser.mockImplementation(async (payload: { note?: string }) => {
      callOrder.push(`createUser:${mock.state.insertCalls.length}`);
      expect(payload.note).toBe('rsbot:trial:10:trial_10');
      return {
        username: 'trial_10',
        status: 'active',
        data_limit: 2 * 1024 ** 3,
        used_traffic: 0,
        expire: Math.floor(Date.now() / 1000) + 5 * 86_400,
        created_at: '2026-01-01T00:00:00Z',
        note: payload.note,
        subscription_url: 'https://sub.example.com/trial/10',
      };
    });

    const result = await service.claimTrial(10, 'trial_10');
    expect(result).toEqual({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub.example.com/trial/10',
    });
    expect(callOrder).toEqual(['createUser:1']);
    expect(mock.state.insertCalls[1]?.values).toMatchObject({
      telegramId: 10,
      configUsername: 'trial_10',
      isClaimed: true,
    });
    expect(mock.state.insertCalls[2]?.values).toMatchObject({
      telegramId: 10,
      amount: 0,
      type: 'trial',
      referenceId: 'trial_10',
    });
    expect(mock.state.updateCalls.some((c) => c.set.status === 'completed')).toBe(true);
  });

  it('flags mismatched remote ownership markers for manual review without binding', async () => {
    const { service, panel } = createService();
    const pendingClaim = {
      telegramId: 10,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'trial_10',
      gbAmount: 1,
      durationDays: 3,
      status: 'pending',
      subUrl: null,
    };

    const mock = createMockDb({
      selectResults: [[{ balance: 0, hasUsedTrial: false }], [pendingClaim]],
      returningResults: [[], []], // insert onConflictDoNothing -> [], reopen failed -> []
    });
    getDbMock.mockReturnValue(mock.db as never);
    panel.getUser.mockResolvedValueOnce({
      username: 'trial_10',
      status: 'active',
      note: 'rsbot:trial:999:stranger',
      subscription_url: 'https://sub/stranger',
    });

    await expect(service.claimTrial(10, 'fresh_trial')).resolves.toEqual({
      success: false,
      messageKey: 'trial_creation_failed',
    });
    expect(panel.createUser).not.toHaveBeenCalled();
    expect(mock.state.updateCalls.some((c) => c.set.status === 'review_required')).toBe(true);
  });

  it('keeps pending claim closed on unknown remote state and never compensates concurrent completed finalizations', async () => {
    const { service, panel } = createService();
    const pendingClaim = {
      telegramId: 10,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'trial_10',
      gbAmount: 1,
      durationDays: 3,
      status: 'pending',
      subUrl: null,
    };

    const unknownMock = createMockDb({
      selectResults: [[{ balance: 0, hasUsedTrial: false }], [pendingClaim]],
      returningResults: [[], []],
    });
    getDbMock.mockReturnValue(unknownMock.db as never);
    panel.getUser.mockRejectedValueOnce(
      new RebeccaApiError(504, '/api/user/fresh_trial', 'gateway timeout')
    );

    await expect(service.claimTrial(10, 'fresh_trial')).resolves.toEqual({
      success: false,
      messageKey: 'trial_creation_failed',
    });
    expect(panel.createUser).not.toHaveBeenCalled();
    expect(unknownMock.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(false);

    // Concurrent completed finalization on finalize step -> returns success, never deletes remote user
    const raceMock = createMockDb({
      selectResults: [
        [{ balance: 0, hasUsedTrial: false }],
        [{ configUsername: 'trial_10', status: 'completed', subUrl: 'https://sub/already-bound' }],
      ],
      returningResults: [[pendingClaim]],
    });
    getDbMock.mockReturnValue(raceMock.db as never);
    panel.createUser.mockResolvedValueOnce({
      username: 'trial_10',
      status: 'active',
      note: 'rsbot:trial:10:trial_10',
      subscription_url: 'https://sub/new',
    });

    await expect(service.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub/already-bound',
    });
    expect(panel.deleteUser).not.toHaveBeenCalled();
  });

  it('marks confirmed 4xx + 404 create failures failed and reconciles stale pending/compensating claims', async () => {
    const { service, panel } = createService();

    // Confirmed 400 createUser + 404 getUser -> marks claim failed so user can retry later
    const confirmedFailMock = createMockDb({
      selectResults: [[{ balance: 0, hasUsedTrial: false }]],
      returningResults: [
        [
          {
            telegramId: 10,
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'trial_10',
            gbAmount: 1,
            durationDays: 3,
            status: 'pending',
            subUrl: null,
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(confirmedFailMock.db as never);
    panel.createUser.mockRejectedValueOnce(new RebeccaApiError(400, '/api/user', 'bad'));
    panel.getUser.mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/trial_10', 'missing'));

    await expect(service.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'trial_creation_failed',
    });
    expect(confirmedFailMock.state.updateCalls.some((c) => c.set.status === 'failed')).toBe(true);

    // reconcilePendingClaims: 1 stale absent pending -> failed, 1 stale compensating -> deleteUser + failed, 1 fresh pending -> skipped
    const staleDate = new Date(Date.now() - 10 * 60_000);
    const freshDate = new Date();
    const reconMock = createMockDb({
      selectResults: [
        [
          {
            telegramId: 101,
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'stale_pending',
            gbAmount: 1,
            durationDays: 3,
            status: 'pending',
            subUrl: null,
            createdAt: staleDate,
            updatedAt: staleDate,
          },
          {
            telegramId: 102,
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'stale_comp',
            gbAmount: 1,
            durationDays: 3,
            status: 'compensating',
            subUrl: null,
            createdAt: staleDate,
            updatedAt: staleDate,
          },
          {
            telegramId: 103,
            panelId: 'legacy',
            serviceId: 1,
            configUsername: 'fresh_pending',
            gbAmount: 1,
            durationDays: 3,
            status: 'pending',
            subUrl: null,
            createdAt: freshDate,
            updatedAt: freshDate,
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(reconMock.db as never);
    panel.getUser
      .mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/stale_pending', 'not found'))
      .mockResolvedValueOnce({
        username: 'stale_comp',
        status: 'active',
        note: 'rsbot:trial:102:stale_comp',
      })
      .mockRejectedValueOnce(new RebeccaApiError(504, '/api/user/fresh_pending', 'transient'));
    panel.deleteUser.mockResolvedValueOnce(undefined);

    await service.reconcilePendingClaims();
    expect(panel.deleteUser).toHaveBeenCalledWith('stale_comp');
    expect(reconMock.state.updateCalls.filter((c) => c.set.status === 'failed')).toHaveLength(2);
  });
});
