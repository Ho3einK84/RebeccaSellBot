import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../src/domain/services/ConfigService.js';
import { getDb } from '../../src/infra/db.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import { RebeccaApiError } from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

const selectQueryMock = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
const insertQueryMock = {
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const deleteQueryMock = {
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const updateQueryMock = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const dbMock = {
  select: vi.fn().mockReturnValue(selectQueryMock),
  insert: vi.fn().mockReturnValue(insertQueryMock),
  delete: vi.fn().mockReturnValue(deleteQueryMock),
  update: vi.fn().mockReturnValue(updateQueryMock),
  transaction: vi.fn(),
};
dbMock.transaction.mockImplementation(async (callback: (tx: typeof dbMock) => unknown) =>
  callback(dbMock)
);

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(() => dbMock),
}));

const OPAQUE_SUB_URL = 'https://sub.example/sub/aBcdEfGhIjKlMnOpQ';
const CREDENTIAL_SUB_URL = 'https://sub.example/sub/alice/0123456789abcdef0123456789abcdef';

function remoteUser(
  username: string,
  subscriptionUrl: string,
  subscriptionUrls: Record<string, string> = {}
): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 1024,
    expire: null,
    created_at: '2026-01-01T00:00:00Z',
    subscription_url: subscriptionUrl,
    subscription_urls: subscriptionUrls,
    links: [],
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
  };
}

describe('ConfigService subscription claims', () => {
  let rebeccaService: {
    getUsers: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    enableUser: ReturnType<typeof vi.fn>;
    disableUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let service: ConfigService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    selectQueryMock.from.mockReturnThis();
    selectQueryMock.where.mockReturnThis();
    selectQueryMock.limit.mockReset();
    selectQueryMock.limit.mockReset();
    insertQueryMock.values.mockReturnThis();
    insertQueryMock.onConflictDoNothing.mockReturnThis();
    insertQueryMock.returning.mockReset();
    deleteQueryMock.where.mockReturnThis();
    deleteQueryMock.returning.mockReset();
    updateQueryMock.set.mockReturnThis();
    updateQueryMock.where.mockReturnThis();
    updateQueryMock.returning.mockReset();
    dbMock.select.mockReturnValue(selectQueryMock);
    dbMock.insert.mockReturnValue(insertQueryMock);
    dbMock.delete.mockReturnValue(deleteQueryMock);
    dbMock.update.mockReturnValue(updateQueryMock);

    rebeccaService = {
      getUsers: vi.fn(),
      getUser: vi.fn(),
      enableUser: vi.fn(),
      disableUser: vi.fn(),
      deleteUser: vi.fn(),
    };
    service = new ConfigService(
      rebeccaService as unknown as RebeccaService,
      {} as TranslationService
    );
  });

  it('extracts a wrapped Rebecca-shaped link but ignores ordinary URLs', () => {
    expect(service.extractSubUrl(`لینک من (${CREDENTIAL_SUB_URL}).`)).toBe(CREDENTIAL_SUB_URL);
    expect(
      service.extractSubUrl('Read https://example.com/this-is-a-very-long-article')
    ).toBeNull();
    expect(service.extractSubUrl('https://example.com/sub/too-short')).toBeNull();
    expect(service.extractSubUrl('http://sub.example/sub/aBcdEfGhIjKlMnOpQ')).toBeNull();
  });

  it('reads remote config details through the ConfigService boundary', async () => {
    const remote = remoteUser('alice', OPAQUE_SUB_URL);
    rebeccaService.getUser.mockResolvedValue(remote);

    await expect(
      service.getRemoteConfigDetail({ panelId: 'legacy', configUsername: 'alice' })
    ).resolves.toBe(remote);
    expect(rebeccaService.getUser).toHaveBeenCalledWith('alice');
  });

  it('toggles a bound config inside the domain service using its remote state', async () => {
    selectQueryMock.limit.mockResolvedValue([
      {
        id: 'uc_alice_123',
        panelId: 'legacy',
        configUsername: 'alice',
        telegramId: 41,
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      },
    ]);
    rebeccaService.getUser.mockResolvedValue({
      ...remoteUser('alice', OPAQUE_SUB_URL),
      status: 'disabled',
    });
    rebeccaService.enableUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));

    await expect(service.toggleConfig('alice')).resolves.toBe('enabled');

    expect(rebeccaService.enableUser).toHaveBeenCalledWith('alice');
    expect(rebeccaService.disableUser).not.toHaveBeenCalled();
    expect(rebeccaService.getUser).toHaveBeenCalledTimes(1);
    expect(updateQueryMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ panelStatus: 'active' })
    );
  });

  it('claims an opaque link through targeted Rebecca search and exact canonical verification', async () => {
    // local mapping miss, then owner check miss
    selectQueryMock.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    insertQueryMock.returning.mockResolvedValue([{ telegramId: 41 }]);
    rebeccaService.getUsers.mockResolvedValue({
      users: [{ username: 'alice' }],
      total: 1,
      status_breakdown: {},
    });
    rebeccaService.getUser.mockResolvedValue(
      remoteUser('alice', 'https://sub.example/sub/primaryCredential0123456789', {
        key: OPAQUE_SUB_URL,
      })
    );

    await expect(service.claimSubLink(41, OPAQUE_SUB_URL)).resolves.toEqual({
      success: true,
      messageKey: 'claimed_success',
      username: 'alice',
      panelId: 'legacy',
    });
    expect(rebeccaService.getUsers).toHaveBeenCalledWith(0, 10, OPAQUE_SUB_URL, undefined, true);
    expect(rebeccaService.getUser).toHaveBeenCalledWith('alice');
    expect(insertQueryMock.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(insertQueryMock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 41,
        configUsername: 'alice',
        panelStatus: 'active',
        panelDataLimit: 1024,
        panelExpire: null,
        lastSyncedAt: expect.any(Date),
      })
    );
    expect(updateQueryMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ activeSubscriptionCount: expect.anything() })
    );
  });

  it('uses direct GET verification for username/key links before the targeted search fallback', async () => {
    // local mapping miss, then owner check miss
    selectQueryMock.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    insertQueryMock.returning.mockResolvedValue([{ telegramId: 41 }]);
    rebeccaService.getUser.mockResolvedValue(remoteUser('alice', CREDENTIAL_SUB_URL));

    await expect(service.claimSubLink(41, CREDENTIAL_SUB_URL)).resolves.toMatchObject({
      success: true,
      username: 'alice',
    });
    expect(rebeccaService.getUser).toHaveBeenCalledWith('alice');
    expect(rebeccaService.getUsers).not.toHaveBeenCalled();
  });

  it('fails closed when a search candidate does not own the exact canonical link', async () => {
    selectQueryMock.limit.mockResolvedValueOnce([]);
    rebeccaService.getUsers.mockResolvedValue({
      users: [{ username: 'alice' }],
      total: 1,
      status_breakdown: {},
    });
    rebeccaService.getUser.mockResolvedValue(
      remoteUser('alice', 'https://sub.example/sub/differentCredential012345')
    );

    await expect(service.claimSubLink(41, OPAQUE_SUB_URL)).resolves.toEqual({
      success: false,
      messageKey: 'claim_failed',
    });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('rejects a conflicting permanent owner without trying to insert a replacement binding', async () => {
    // local mapping miss, then existing local owner
    selectQueryMock.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ telegramId: 99 }]);
    rebeccaService.getUsers.mockResolvedValue({
      users: [{ username: 'alice' }],
      total: 1,
      status_breakdown: {},
    });
    rebeccaService.getUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));

    await expect(service.claimSubLink(41, OPAQUE_SUB_URL)).resolves.toEqual({
      success: false,
      messageKey: 'claim_already_claimed',
    });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('rate-limits repeated link claims per Telegram user', async () => {
    selectQueryMock.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    insertQueryMock.returning.mockResolvedValue([{ telegramId: 41 }]);
    rebeccaService.getUsers.mockResolvedValue({
      users: [{ username: 'alice' }],
      total: 1,
      status_breakdown: {},
    });
    rebeccaService.getUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));

    await expect(service.claimSubLink(41, OPAQUE_SUB_URL)).resolves.toMatchObject({
      success: true,
    });
    await expect(service.claimSubLink(41, OPAQUE_SUB_URL)).resolves.toEqual({
      success: false,
      messageKey: 'claim_rate_limited',
    });
    expect(rebeccaService.getUsers).toHaveBeenCalledTimes(1);
  });

  it('enables auto-renew for an owned config with a package id', async () => {
    updateQueryMock.returning.mockResolvedValue([
      { autoRenewEnabled: true, autoRenewPackageId: 'pkg_30gb_30d' },
    ]);

    await expect(service.setAutoRenew(41, 'uc_alice_123', true, 'pkg_30gb_30d')).resolves.toEqual({
      autoRenewEnabled: true,
      autoRenewPackageId: 'pkg_30gb_30d',
    });
    expect(updateQueryMock.set).toHaveBeenCalledWith({
      autoRenewEnabled: true,
      autoRenewPackageId: 'pkg_30gb_30d',
    });
  });

  it('disables auto-renew without clearing the remembered package id', async () => {
    updateQueryMock.returning.mockResolvedValue([
      { autoRenewEnabled: false, autoRenewPackageId: 'pkg_30gb_30d' },
    ]);

    await expect(service.setAutoRenew(41, 'uc_alice_123', false)).resolves.toEqual({
      autoRenewEnabled: false,
      autoRenewPackageId: 'pkg_30gb_30d',
    });
    expect(updateQueryMock.set).toHaveBeenCalledWith({ autoRenewEnabled: false });
  });

  it('permanently deletes a config from the panel and the local table', async () => {
    const remote = remoteUser('alice', OPAQUE_SUB_URL);
    rebeccaService.getUser.mockResolvedValue(remote);
    selectQueryMock.limit.mockResolvedValue([
      {
        id: 'uc_alice_123',
        panelId: 'legacy',
        configUsername: 'alice',
        telegramId: 41,
        remoteCreatedAt: `created:${remote.created_at}`,
      },
    ]);
    rebeccaService.deleteUser.mockResolvedValue({ username: 'alice', status: 'deleted' });
    deleteQueryMock.returning.mockResolvedValue([{ configUsername: 'alice', telegramId: 41 }]);

    await expect(service.deleteConfigCompletely('alice')).resolves.toBe(true);
    expect(rebeccaService.deleteUser).toHaveBeenCalledWith('alice');
    expect(dbMock.delete).toHaveBeenCalled();
    expect(updateQueryMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ activeSubscriptionCount: expect.anything() })
    );
  });

  it('treats an already-deleted remote config (404) as a successful full removal', async () => {
    const remote = remoteUser('alice', OPAQUE_SUB_URL);
    rebeccaService.getUser.mockResolvedValue(remote);
    selectQueryMock.limit.mockResolvedValue([
      {
        id: 'uc_alice_123',
        panelId: 'legacy',
        configUsername: 'alice',
        telegramId: 41,
        remoteCreatedAt: `created:${remote.created_at}`,
      },
    ]);
    rebeccaService.deleteUser.mockRejectedValue(
      new RebeccaApiError(404, 'DELETE /api/user/alice', '{}')
    );
    deleteQueryMock.returning.mockResolvedValue([{ configUsername: 'alice', telegramId: 41 }]);

    await expect(service.deleteConfigCompletely('alice')).resolves.toBe(true);
    expect(rebeccaService.deleteUser).toHaveBeenCalledWith('alice');
  });

  it('fails closed before legacy deletion when remote identity verification is unavailable', async () => {
    rebeccaService.getUser.mockRejectedValue(new Error('temporary panel failure'));

    await expect(service.deleteConfigCompletely('alice')).rejects.toThrow(
      'temporary panel failure'
    );
    expect(rebeccaService.deleteUser).not.toHaveBeenCalled();
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it('forces a valid counter-bearing Rebecca username for unsafe custom templates', async () => {
    const returning = vi.fn().mockResolvedValue([{ currentCount: 9 }]);
    vi.mocked(getDb).mockReturnValue({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({ returning })),
        })),
      })),
    } as never);
    const namingService = new ConfigService(
      rebeccaService as unknown as RebeccaService,
      {
        getSetting: vi.fn((key: string, fallback?: string) => {
          if (key === 'naming_mode') return 'custom';
          if (key === 'naming_prefix') return 'ignored';
          if (key === 'custom_naming_template')
            return 'A template with spaces and a very long prefix '.repeat(3);
          return fallback ?? '';
        }),
      } as unknown as TranslationService
    );

    const generated = await namingService.generateConfigName(42);

    expect(generated).toMatch(/^[a-zA-Z0-9._@-]{3,32}$/);
    expect(generated).toMatch(/_9$/);
  });

  it('fails closed when the naming counter is exhausted', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({ returning })),
        })),
      })),
    } as never);
    const namingService = new ConfigService(
      rebeccaService as unknown as RebeccaService,
      {
        getSetting: vi.fn((key: string, fallback?: string) => {
          if (key === 'naming_mode') return 'prefix_number';
          if (key === 'naming_prefix') return 'rebecca';
          return fallback ?? '';
        }),
      } as unknown as TranslationService
    );

    await expect(namingService.generateConfigName(42)).rejects.toThrow('CONFIG_COUNTER_EXHAUSTED');
  });

  it('isolates counter sync failures and guards the recovered target before naming', async () => {
    const healthyCounters = vi.fn().mockResolvedValue({
      prefix_number: 9,
      telegramid_number: 4,
      custom: 7,
    });
    const unavailableCounters = vi.fn().mockRejectedValue(new Error('panel unavailable'));
    const panels = {
      getEnabledPanelIds: vi.fn(() => ['panel_a', 'panel_b']),
      getService: vi.fn((panelId: string) => ({
        getHighestCounters: panelId === 'panel_a' ? healthyCounters : unavailableCounters,
      })),
      resolveTarget: vi.fn(),
    } as unknown as RebeccaPanelRegistry;
    const returning = vi.fn().mockResolvedValue([{ currentCount: 10 }]);
    const persistCounter = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: persistCounter })),
    }));
    vi.mocked(getDb).mockReturnValue({ insert } as never);
    const namingService = new ConfigService(panels, {
      getSetting: vi.fn((key: string, fallback?: string) => {
        if (key === 'naming_mode') return 'prefix_number';
        if (key === 'naming_prefix') return 'rebecca';
        if (key === 'custom_naming_template') return '{prefix}_{counter}';
        return fallback ?? '';
      }),
    } as unknown as TranslationService);

    await expect(namingService.syncCounters()).resolves.toBe(9);
    expect(healthyCounters).toHaveBeenCalledOnce();
    expect(unavailableCounters).toHaveBeenCalledOnce();
    expect(persistCounter).toHaveBeenCalledTimes(3);

    // The healthy target reuses its successful runtime proof.
    await expect(namingService.generateConfigName(42, 'panel_a')).resolves.toBe('rebecca_10');
    expect(healthyCounters).toHaveBeenCalledOnce();

    // The failed target is scanned again and fails before a counter/name can
    // be consumed for a purchase on that panel.
    await expect(namingService.generateConfigName(42, 'panel_b')).rejects.toThrow(
      'CONFIG_COUNTER_SYNC_FAILED:panel_b'
    );
    expect(unavailableCounters).toHaveBeenCalledTimes(2);
  });
});
