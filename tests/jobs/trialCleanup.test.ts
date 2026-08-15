import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sweepExpiredTrialConfigs, TRIAL_EXPIRY_GRACE_DAYS } from '../../src/jobs/trialCleanup.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
} from '../../src/domain/services/RebeccaService.js';
import type { ConfigService } from '../../src/domain/services/ConfigService.js';

const selectQueryMock = {
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn(),
};
const dbMock = {
  select: vi.fn().mockReturnValue(selectQueryMock),
};
vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(() => dbMock),
}));

function remoteUser(expire: number | null, status = 'active') {
  return {
    username: 'trial_10',
    status,
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 1024,
    expire,
    created_at: '',
    subscription_url: '',
    links: [],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: '',
    admin_username: '',
  };
}

describe('sweepExpiredTrialConfigs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    selectQueryMock.from.mockReturnThis();
    selectQueryMock.innerJoin.mockReturnThis();
    selectQueryMock.where.mockReset();
    dbMock.select.mockReturnValue(selectQueryMock);
  });

  it('deletes a trial whose expiry is more than the grace period in the past', async () => {
    selectQueryMock.where.mockResolvedValue([{ configUsername: 'trial_10' }]);
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser(null, 'active')),
    } as unknown as RebeccaService;
    // Insert a real expire two grace periods in the past.
    rebeccaService.getUser = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          remoteUser(Math.floor(Date.now() / 1000) - (TRIAL_EXPIRY_GRACE_DAYS + 1) * 86_400)
        )
      );
    const configService = {
      deleteConfigCompletely: vi.fn().mockResolvedValue(true),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(rebeccaService, configService);

    expect(removed).toBe(1);
    expect(configService.deleteConfigCompletely).toHaveBeenCalledWith('trial_10');
  });

  it('keeps a trial that still has a future expiry (renewed)', async () => {
    selectQueryMock.where.mockResolvedValue([{ configUsername: 'trial_10' }]);
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser(Math.floor(Date.now() / 1000) + 86_400)),
    } as unknown as RebeccaService;
    const configService = {
      deleteConfigCompletely: vi.fn().mockResolvedValue(true),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(rebeccaService, configService);

    expect(removed).toBe(0);
    expect(configService.deleteConfigCompletely).not.toHaveBeenCalled();
  });

  it('does not delete when the panel is unreachable', async () => {
    selectQueryMock.where.mockResolvedValue([{ configUsername: 'trial_10' }]);
    const rebeccaService = {
      getUser: vi.fn().mockRejectedValue(new RebeccaOriginDownError('/api/user/trial_10', 521, 5)),
    } as unknown as RebeccaService;
    const configService = {
      deleteConfigCompletely: vi.fn().mockResolvedValue(true),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(rebeccaService, configService);

    expect(removed).toBe(0);
    expect(configService.deleteConfigCompletely).not.toHaveBeenCalled();
  });

  it('purges the local row when the remote trial is already a 404', async () => {
    selectQueryMock.where.mockResolvedValue([{ configUsername: 'trial_10' }]);
    const rebeccaService = {
      getUser: vi.fn().mockRejectedValue(new RebeccaApiError(404, 'GET /trial_10', '{}')),
    } as unknown as RebeccaService;
    const configService = {
      deleteConfigCompletely: vi.fn().mockResolvedValue(true),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(rebeccaService, configService);

    expect(removed).toBe(1);
    expect(configService.deleteConfigCompletely).toHaveBeenCalledWith('trial_10');
  });
});
