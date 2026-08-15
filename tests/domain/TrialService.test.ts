import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { TrialService } from '../../src/domain/services/TrialService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

type TrialInternals = {
  reserveClaim: (...args: unknown[]) => Promise<unknown>;
  recoverClaim: (...args: unknown[]) => Promise<unknown>;
  createAndFinalizeTrial: (...args: unknown[]) => Promise<unknown>;
  finalizeCreatedTrial: (...args: unknown[]) => Promise<unknown>;
};

function serviceWithSettings(enabled = true): TrialService {
  const translation = {
    getSettingBool: vi.fn().mockReturnValue(enabled),
    getSettingNum: vi.fn((key: string, fallback: number) => {
      if (key === 'trial_gb') return 1;
      if (key === 'trial_days') return 3;
      if (key === 'rebecca_service_id') return 1;
      return fallback;
    }),
  };
  return new TrialService(
    { createUser: vi.fn(), getUser: vi.fn(), deleteUser: vi.fn() } as unknown as RebeccaService,
    translation as unknown as TranslationService
  );
}

describe('TrialService recoverable claim saga', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not begin a claim when trials are disabled', async () => {
    const service = serviceWithSettings(false);
    const internals = service as unknown as TrialInternals;
    const reserve = vi.spyOn(internals, 'reserveClaim');

    await expect(service.claimTrial(10, 'trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'trial_disabled',
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('keeps a pending claim closed when its remote outcome remains unknown', async () => {
    const service = serviceWithSettings();
    const internals = service as unknown as TrialInternals;
    const pendingClaim = {
      telegramId: 10,
      configUsername: 'trial_10',
      gbAmount: 1,
      durationDays: 3,
      status: 'pending',
      subUrl: null,
    };
    vi.spyOn(internals, 'reserveClaim').mockResolvedValue({
      state: 'pending',
      claim: pendingClaim,
    });
    vi.spyOn(internals, 'recoverClaim').mockResolvedValue({
      result: { success: false, messageKey: 'trial_creation_failed' },
      confirmedAbsent: false,
    });
    const create = vi.spyOn(internals, 'createAndFinalizeTrial');

    await expect(service.claimTrial(10, 'fresh_trial_10')).resolves.toEqual({
      success: false,
      messageKey: 'trial_creation_failed',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('reopens a claim only after recovery confirms the old remote config is absent', async () => {
    const service = serviceWithSettings();
    const internals = service as unknown as TrialInternals;
    const pendingClaim = {
      telegramId: 10,
      configUsername: 'stale_trial_10',
      gbAmount: 1,
      durationDays: 3,
      status: 'pending',
      subUrl: null,
    };
    const reservedClaim = {
      telegramId: 10,
      configUsername: 'fresh_trial_10',
      gbAmount: 1,
      durationDays: 3,
      status: 'pending',
      subUrl: null,
    };
    const reserve = vi
      .spyOn(internals, 'reserveClaim')
      .mockResolvedValueOnce({ state: 'pending', claim: pendingClaim })
      .mockResolvedValueOnce({ state: 'reserved', balance: 0, claim: reservedClaim });
    vi.spyOn(internals, 'recoverClaim').mockResolvedValue({
      result: { success: false, messageKey: 'trial_creation_failed' },
      confirmedAbsent: true,
    });
    const create = vi.spyOn(internals, 'createAndFinalizeTrial').mockResolvedValue({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub/trial',
    });

    await expect(service.claimTrial(10, 'fresh_trial_10')).resolves.toMatchObject({
      success: true,
      subUrl: 'https://sub/trial',
    });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reserves the pending DB claim before any Rebecca call can run', async () => {
    const service = serviceWithSettings();
    const internals = service as unknown as TrialInternals;
    const select = vi.fn(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue([{ balance: 0, hasUsedTrial: false }]),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      return query;
    });
    const returning = vi.fn().mockResolvedValue([
      {
        telegramId: 10,
        configUsername: 'trial_10',
        gbAmount: 1,
        durationDays: 3,
        status: 'pending',
        subUrl: null,
      },
    ]);
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => ({ returning })) })),
    }));
    const tx = { select, insert };
    getDbMock.mockReturnValue({
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      internals.reserveClaim(10, 'trial_10', {
        enabled: true,
        gbAmount: 1,
        durationDays: 3,
        serviceId: 1,
      })
    ).resolves.toMatchObject({ state: 'reserved', claim: { configUsername: 'trial_10' } });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it('tags a created trial with a customer-specific ownership marker', async () => {
    const createUser = vi.fn().mockImplementation(async (payload: { note?: string }) => ({
      username: 'trial_10',
      status: 'active',
      note: payload.note ?? null,
      subscription_url: 'https://sub/trial',
    }));
    const service = new TrialService(
      { createUser } as unknown as RebeccaService,
      { getSettingBool: vi.fn(), getSettingNum: vi.fn() } as unknown as TranslationService
    );
    const internals = service as unknown as TrialInternals;
    vi.spyOn(internals, 'finalizeCreatedTrial').mockResolvedValue({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub/trial',
    });

    await internals.createAndFinalizeTrial(
      {
        state: 'reserved',
        balance: 0,
        claim: {
          telegramId: 10,
          configUsername: 'trial_10',
          gbAmount: 1,
          durationDays: 3,
          status: 'pending',
          subUrl: null,
        },
      },
      1
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'rsbot:trial:10:trial_10' })
    );
  });

  it('flags a mismatched remote trial marker for manual review instead of binding it', async () => {
    const getUser = vi.fn().mockResolvedValue({
      username: 'trial_10',
      status: 'active',
      note: 'rsbot:trial:999:stranger',
      subscription_url: 'https://sub/stranger',
    });
    const service = new TrialService(
      { getUser } as unknown as RebeccaService,
      { getSettingBool: vi.fn(), getSettingNum: vi.fn() } as unknown as TranslationService
    );
    const internals = service as unknown as TrialInternals;
    const finalize = vi.spyOn(internals, 'finalizeCreatedTrial');
    const setCalls: Array<Record<string, unknown>> = [];
    const update = vi.fn(() => {
      const query = {
        set: vi.fn((values: Record<string, unknown>) => {
          setCalls.push(values);
          return query;
        }),
        where: vi.fn().mockResolvedValue(undefined),
      };
      return query;
    });
    getDbMock.mockReturnValue({ update } as never);

    await expect(
      internals.recoverClaim(
        {
          telegramId: 10,
          configUsername: 'trial_10',
          gbAmount: 1,
          durationDays: 3,
          status: 'pending',
          subUrl: null,
        },
        true
      )
    ).resolves.toMatchObject({ result: { success: false }, confirmedAbsent: false });

    expect(finalize).not.toHaveBeenCalled();
    expect(setCalls.some((values) => values.status === 'review_required')).toBe(true);
  });

  it('still finalizes a pending trial when the ownership marker matches', async () => {
    const getUser = vi.fn().mockResolvedValue({
      username: 'trial_10',
      status: 'active',
      note: 'rsbot:trial:10:trial_10',
      subscription_url: 'https://sub/trial',
    });
    const service = new TrialService(
      { getUser } as unknown as RebeccaService,
      { getSettingBool: vi.fn(), getSettingNum: vi.fn() } as unknown as TranslationService
    );
    const internals = service as unknown as TrialInternals;
    const finalize = vi.spyOn(internals, 'finalizeCreatedTrial').mockResolvedValue({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub/trial',
    });

    await expect(
      internals.recoverClaim(
        {
          telegramId: 10,
          configUsername: 'trial_10',
          gbAmount: 1,
          durationDays: 3,
          status: 'pending',
          subUrl: null,
        },
        true
      )
    ).resolves.toMatchObject({ result: { success: true }, confirmedAbsent: false });

    expect(finalize).toHaveBeenCalledOnce();
  });

  it('treats a concurrent completed finalization as success and never compensates it', async () => {
    const deleteUser = vi.fn();
    const service = new TrialService(
      { deleteUser } as unknown as RebeccaService,
      {
        getSettingBool: vi.fn(),
        getSettingNum: vi.fn(),
      } as unknown as TranslationService
    );
    const internals = service as unknown as TrialInternals;
    const select = vi.fn(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue([
          {
            configUsername: 'trial_10',
            status: 'completed',
            subUrl: 'https://sub/already-bound',
          },
        ]),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      return query;
    });
    const tx = { select };
    getDbMock.mockReturnValue({
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      internals.finalizeCreatedTrial(
        {
          telegramId: 10,
          configUsername: 'trial_10',
          gbAmount: 1,
          durationDays: 3,
          status: 'pending',
          subUrl: null,
        },
        { subscription_url: 'https://sub/remote' }
      )
    ).resolves.toEqual({
      success: true,
      messageKey: 'trial_success',
      subUrl: 'https://sub/already-bound',
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
