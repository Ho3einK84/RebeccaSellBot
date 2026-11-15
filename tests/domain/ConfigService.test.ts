import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigService,
  getDateTokens,
  previewConfigName,
} from '../../src/domain/services/ConfigService.js';
import { configLockKey, withConfigLock } from '../../src/domain/services/ConfigLock.js';
import { ConfigTransferService } from '../../src/domain/services/ConfigTransferService.js';
import { getDb, getPool } from '../../src/infra/db.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import { RebeccaApiError } from '../../src/domain/services/RebeccaService.js';
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

const OPAQUE_SUB_URL = 'https://sub.example/sub/aBcdEfGhIjKlMnOpQ';
const CREDENTIAL_SUB_URL = 'https://sub.example/sub/alice/0123456789abcdef0123456789abcdef';

function remoteUser(
  username: string,
  subscriptionUrl: string,
  overrides: Partial<RebeccaUserDetail> = {}
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
    subscription_urls: {},
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
    ...overrides,
  };
}

function mockUnlockedPool() {
  const client = {
    query: vi.fn(async (sqlText: string) => {
      if (sqlText.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sqlText.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue({
    connect: vi.fn().mockResolvedValue(client),
  } as never);
  return client;
}

describe('ConfigService, ConfigLock & ConfigTransferService', () => {
  const getDbMock = vi.mocked(getDb);
  const getPoolMock = vi.mocked(getPool);

  let rebeccaService: {
    getUsers: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    enableUser: ReturnType<typeof vi.fn>;
    disableUser: ReturnType<typeof vi.fn>;
    revokeSubscription: ReturnType<typeof vi.fn>;
    resetUserTraffic: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    getHighestCounters: ReturnType<typeof vi.fn>;
  };
  let service: ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlockedPool();
    rebeccaService = {
      getUsers: vi.fn(),
      getUser: vi.fn(),
      enableUser: vi.fn(),
      disableUser: vi.fn(),
      revokeSubscription: vi.fn(),
      resetUserTraffic: vi.fn(),
      deleteUser: vi.fn(),
      getHighestCounters: vi.fn(),
    };
    service = new ConfigService(
      rebeccaService as unknown as RebeccaService,
      {} as TranslationService
    );
  });

  describe('ConfigLock advisory locking', () => {
    it('computes case-insensitive BigInt keys differentiated by panel and username', () => {
      expect(typeof configLockKey('panel_1', 'user_alpha')).toBe('bigint');
      expect(configLockKey('panel_1', 'alice_vpn')).toBe(configLockKey('panel_1', 'ALICE_VPN'));
      expect(configLockKey('panel_a', 'user_1')).not.toBe(configLockKey('panel_b', 'user_1'));
      expect(configLockKey('panel_a', 'user_1')).not.toBe(configLockKey('panel_a', 'user_2'));
    });

    it('acquires/releases advisory locks, rejects contention with CONFIG_MUTATION_BUSY, and discards connection on unlock failure', async () => {
      const okClient = mockUnlockedPool();
      await expect(withConfigLock('panel_1', 'alice', async () => 42)).resolves.toBe(42);
      expect(okClient.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        expect.any(Array)
      );
      expect(okClient.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
        expect.any(Array)
      );
      expect(okClient.release).toHaveBeenCalledWith(undefined);

      await expect(
        withConfigLock('panel_1', 'alice', async () => {
          throw new Error('OPERATION_FAILED');
        })
      ).rejects.toThrow('OPERATION_FAILED');
      expect(okClient.query).toHaveBeenLastCalledWith(
        'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
        expect.any(Array)
      );

      const busyClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({ connect: vi.fn().mockResolvedValue(busyClient) } as never);
      await expect(withConfigLock('panel_1', 'alice', async () => 'nope')).rejects.toThrow(
        'CONFIG_MUTATION_BUSY'
      );
      expect(busyClient.release).toHaveBeenCalled();

      const brokenUnlockClient = {
        query: vi.fn(async (q: string) => {
          if (q.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          throw new Error('DB_DISCONNECTED');
        }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue(brokenUnlockClient),
      } as never);
      await expect(withConfigLock('panel_1', 'alice', async () => 'ok')).resolves.toBe('ok');
      expect(brokenUnlockClient.release).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Subscription claims & cooldown hygiene', () => {
    it('extracts Rebecca-shaped URLs and claims opaque/credential links without consuming cooldown on invalid links', async () => {
      expect(service.extractSubUrl(`لینک من (${CREDENTIAL_SUB_URL}).`)).toBe(CREDENTIAL_SUB_URL);
      expect(service.extractSubUrl('https://example.com/sub/too-short')).toBeNull();
      expect(service.extractSubUrl('http://sub.example/sub/aBcdEfGhIjKlMnOpQ')).toBeNull();

      // Regression: malformed/invalid URL must fail before consuming user cooldown!
      const cooldownFreeDb = createMockDb({
        selectResults: [[], [], []],
        returningResults: [[{ telegramId: 41 }]],
      });
      getDbMock.mockReturnValue(cooldownFreeDb.db as never);
      await expect(service.claimSubLink(41, 'not a subscription link')).resolves.toEqual({
        success: false,
        messageKey: 'claim_failed',
      });

      // Immediately submitting valid credential link succeeds without hitting claim_rate_limited
      rebeccaService.getUser.mockResolvedValue(remoteUser('alice', CREDENTIAL_SUB_URL));
      await expect(service.claimSubLink(41, CREDENTIAL_SUB_URL)).resolves.toMatchObject({
        success: true,
        username: 'alice',
      });
      expect(rebeccaService.getUsers).not.toHaveBeenCalled();

      // Different user claims opaque link via targeted search, then hits cooldown on repeat tap
      const opaqueDb = createMockDb({
        selectResults: [[], []],
        returningResults: [[{ telegramId: 42 }]],
      });
      getDbMock.mockReturnValue(opaqueDb.db as never);
      rebeccaService.getUsers.mockResolvedValue({
        users: [{ username: 'bob' }],
        total: 1,
        status_breakdown: {},
      });
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('bob', 'https://sub.example/sub/primaryCred0123456789', {
          subscription_urls: { key: OPAQUE_SUB_URL },
        })
      );
      await expect(service.claimSubLink(42, OPAQUE_SUB_URL)).resolves.toEqual({
        success: true,
        messageKey: 'claimed_success',
        username: 'bob',
        panelId: 'legacy',
      });
      expect(rebeccaService.getUsers).toHaveBeenCalledWith(0, 10, OPAQUE_SUB_URL, undefined, true);
      expect(opaqueDb.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 42,
        configUsername: 'bob',
        panelStatus: 'active',
        panelDataLimit: 1024,
      });
      expect(opaqueDb.state.updateCalls.some((c) => 'activeSubscriptionCount' in c.set)).toBe(true);

      await expect(service.claimSubLink(42, OPAQUE_SUB_URL)).resolves.toEqual({
        success: false,
        messageKey: 'claim_rate_limited',
      });
    });

    it('fails closed when candidate lacks canonical link or is already claimed', async () => {
      getDbMock.mockReturnValue(createMockDb({ selectResults: [[]] }).db as never);
      rebeccaService.getUsers.mockResolvedValue({
        users: [{ username: 'alice' }],
        total: 1,
        status_breakdown: {},
      });
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('alice', 'https://sub.example/sub/differentCredential012345')
      );
      const mismatchDb = createMockDb({ selectResults: [[]] });
      getDbMock.mockReturnValue(mismatchDb.db as never);
      await expect(service.claimSubLink(43, OPAQUE_SUB_URL)).resolves.toEqual({
        success: false,
        messageKey: 'claim_failed',
      });
      expect(mismatchDb.state.insertCalls).toHaveLength(0);

      const claimedDb = createMockDb({ selectResults: [[], [{ telegramId: 99 }]] });
      getDbMock.mockReturnValue(claimedDb.db as never);
      rebeccaService.getUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));
      await expect(service.claimSubLink(44, OPAQUE_SUB_URL)).resolves.toEqual({
        success: false,
        messageKey: 'claim_already_claimed',
      });
      expect(claimedDb.state.insertCalls).toHaveLength(0);
    });
  });

  describe('Lifecycle mutations, incarnation guards & concurrency', () => {
    const localConfig = {
      id: 'uc_1',
      telegramId: 1001,
      panelId: 'panel_a',
      configUsername: 'alice',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      subUrl: 'https://sub.example/sub/old',
      panelStatus: 'limited',
    };

    function createPanelService() {
      const panels = {
        getService: vi.fn(() => rebeccaService as unknown as RebeccaService),
        resolveTarget: vi.fn().mockResolvedValue({ panelId: 'panel_a', serviceId: 1 }),
        getEnabledPanelIds: vi.fn(() => ['panel_a']),
      } as unknown as RebeccaPanelRegistry;
      return new ConfigService(panels, {} as TranslationService);
    }

    it('reads remote details, toggles config, resets local traffic/limited status, and manages auto-renew', async () => {
      const remote = remoteUser('alice', OPAQUE_SUB_URL, { status: 'disabled' });
      rebeccaService.getUser.mockResolvedValue(remote);
      await expect(
        service.getRemoteConfigDetail({ panelId: 'legacy', configUsername: 'alice' })
      ).resolves.toBe(remote);

      const toggleDb = createMockDb({
        selectResults: [
          [{ ...localConfig, panelId: 'legacy' }],
          [{ ...localConfig, panelId: 'legacy' }],
        ],
        returningResults: [[{ id: 'uc_1' }]],
      });
      getDbMock.mockReturnValue(toggleDb.db as never);
      rebeccaService.enableUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));
      await expect(service.toggleConfig('alice')).resolves.toBe('enabled');
      expect(rebeccaService.enableUser).toHaveBeenCalledWith('alice');
      expect(toggleDb.state.updateCalls.some((c) => c.set.panelStatus === 'active')).toBe(true);

      // Regression: resetUsage updates local panelUsedTraffic to 0 and promotes 'limited' -> 'active'
      const resetDb = createMockDb({ selectResults: [[localConfig]] });
      getDbMock.mockReturnValue(resetDb.db as never);
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('alice', OPAQUE_SUB_URL, { status: 'limited', used_traffic: 9_999 })
      );
      rebeccaService.resetUserTraffic.mockResolvedValue(undefined);
      await createPanelService().resetUsage('alice', 'panel_a');
      expect(rebeccaService.resetUserTraffic).toHaveBeenCalledWith('alice');
      expect(
        resetDb.state.updateCalls.some(
          (c) => c.set.panelUsedTraffic === 0 && c.set.panelStatus === 'active'
        )
      ).toBe(true);
      expect(resetDb.state.updateCalls.some((c) => 'activeSubscriptionCount' in c.set)).toBe(true);

      // Auto-renew enable & disable (preserving packageId)
      const autoDb = createMockDb({
        selectResults: [[localConfig], [localConfig]],
        returningResults: [
          [{ autoRenewEnabled: true, autoRenewPackageId: 'pkg_30gb_30d' }],
          [{ autoRenewEnabled: false, autoRenewPackageId: 'pkg_30gb_30d' }],
        ],
      });
      getDbMock.mockReturnValue(autoDb.db as never);
      await expect(service.setAutoRenew(1001, 'uc_1', true, 'pkg_30gb_30d')).resolves.toEqual({
        autoRenewEnabled: true,
        autoRenewPackageId: 'pkg_30gb_30d',
      });
      await expect(service.setAutoRenew(1001, 'uc_1', false)).resolves.toEqual({
        autoRenewEnabled: false,
        autoRenewPackageId: 'pkg_30gb_30d',
      });
      expect(autoDb.state.updateCalls[1]?.set).toEqual({ autoRenewEnabled: false });
    });

    it('enforces incarnation verification, legacy backfill, stale mark, and concurrent lock contention', async () => {
      const panelSvc = createPanelService();

      // Revoke incarnation mismatch marks local row stale & avoids remote call
      const staleDb = createMockDb({ selectResults: [[localConfig], [localConfig]] });
      getDbMock.mockReturnValue(staleDb.db as never);
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('alice', OPAQUE_SUB_URL, { created_at: '2026-02-01T00:00:00Z' })
      );
      await expect(panelSvc.revokeSubscription('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_MISMATCH'
      );
      expect(rebeccaService.revokeSubscription).not.toHaveBeenCalled();
      expect(staleDb.state.updateCalls.some((c) => c.set.panelStatus === 'deleted')).toBe(true);

      // Legacy NULL fingerprint fails closed if unverified, or backfills when subUrl matches
      const legacyUnverifiedDb = createMockDb({
        selectResults: [[{ ...localConfig, remoteCreatedAt: null, subUrl: 'https://old/sub' }], []],
      });
      getDbMock.mockReturnValue(legacyUnverifiedDb.db as never);
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('alice', 'https://new/sub', { created_at: '2026-02-01T00:00:00Z' })
      );
      await expect(panelSvc.resetUsage('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_UNVERIFIED'
      );
      expect(rebeccaService.resetUserTraffic).not.toHaveBeenCalled();

      const legacyMatch = {
        ...localConfig,
        remoteCreatedAt: null,
        subUrl: 'https://sub.example/sub/same-secret',
      };
      const backfillDb = createMockDb({
        selectResults: [[legacyMatch]],
        returningResults: [[{ remoteCreatedAt: 'created:2026-01-01T00:00:00Z' }]],
      });
      getDbMock.mockReturnValue(backfillDb.db as never);
      rebeccaService.getUser.mockResolvedValue(remoteUser('alice', legacyMatch.subUrl));
      rebeccaService.resetUserTraffic.mockResolvedValue(undefined);
      await expect(panelSvc.resetUsage('alice', 'panel_a')).resolves.toBeUndefined();
      expect(legacyMatch.remoteCreatedAt).toBe('created:2026-01-01T00:00:00Z');

      // Concurrent advisory lock across two revokeSubscription calls
      let held = false;
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue({
          query: vi.fn(async (sqlText: string) => {
            if (sqlText.includes('pg_try_advisory_lock')) {
              if (held) return { rows: [{ locked: false }] };
              held = true;
              return { rows: [{ locked: true }] };
            }
            if (sqlText.includes('pg_advisory_unlock')) {
              held = false;
              return { rows: [{ unlocked: true }] };
            }
            return { rows: [] };
          }),
          release: vi.fn(),
        }),
      } as never);
      const concDb = createMockDb({
        selectResults: [[localConfig], [localConfig], [localConfig]],
        returningResults: [[{ id: 'uc_1' }]],
      });
      getDbMock.mockReturnValue(concDb.db as never);
      rebeccaService.getUser.mockResolvedValue(remoteUser('alice', OPAQUE_SUB_URL));
      let finishRevoke!: (v: RebeccaUserDetail) => void;
      rebeccaService.revokeSubscription.mockImplementationOnce(
        () =>
          new Promise<RebeccaUserDetail>((resolve) => {
            finishRevoke = resolve;
          })
      );
      const first = panelSvc.revokeSubscription('alice', 'panel_a');
      await vi.waitFor(() => expect(rebeccaService.revokeSubscription).toHaveBeenCalledTimes(1));
      await expect(panelSvc.revokeSubscription('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_MUTATION_BUSY'
      );
      finishRevoke(remoteUser('alice', 'https://sub.example/sub/rotated'));
      await expect(first).resolves.toBe('https://sub.example/sub/rotated');

      // Complete deletion, 404 convergence, recreated-user preservation, and lock busy rejection
      mockUnlockedPool();
      const delDb = createMockDb({
        selectResults: [[{ ...localConfig, panelId: 'legacy' }]],
        returningResults: [[{ configUsername: 'alice', telegramId: 1001 }]],
      });
      getDbMock.mockReturnValue(delDb.db as never);
      rebeccaService.deleteUser.mockResolvedValueOnce({ username: 'alice', status: 'deleted' });
      await expect(service.deleteConfigCompletely('alice')).resolves.toBe(true);
      expect(rebeccaService.deleteUser).toHaveBeenCalledWith('alice');

      const del404Db = createMockDb({
        selectResults: [[{ ...localConfig, panelId: 'legacy' }]],
        returningResults: [[{ configUsername: 'alice', telegramId: 1001 }]],
      });
      getDbMock.mockReturnValue(del404Db.db as never);
      rebeccaService.deleteUser.mockRejectedValueOnce(
        new RebeccaApiError(404, 'DELETE /api/user/alice', '{}')
      );
      await expect(service.deleteConfigCompletely('alice')).resolves.toBe(true);

      const delRecreateDb = createMockDb({
        selectResults: [[{ ...localConfig, panelId: 'legacy' }]],
        returningResults: [[{ configUsername: 'alice', telegramId: 1001 }]],
      });
      getDbMock.mockReturnValue(delRecreateDb.db as never);
      rebeccaService.deleteUser.mockClear();
      rebeccaService.getUser.mockResolvedValueOnce(
        remoteUser('alice', OPAQUE_SUB_URL, { created_at: '2026-02-01T00:00:00Z' })
      );
      await expect(service.deleteConfigCompletely('alice')).resolves.toBe(true);
      expect(rebeccaService.deleteUser).not.toHaveBeenCalled();
      expect(delRecreateDb.state.deleteCalls).toHaveLength(2);
    });
  });

  describe('Naming, counter sync & ConfigTransferService', () => {
    it('syncs highest counters including prefix_date_counter & prefix_telegramid_number patterns and guards failed panels', async () => {
      const dt = getDateTokens();
      expect(
        previewConfigName(
          {
            getSetting: vi.fn((k: string, fb?: string) => {
              if (k === 'naming_mode') return 'custom';
              if (k === 'naming_prefix') return 'reb';
              if (k === 'custom_naming_template') return '{prefix}_{year}_{month}_{counter}';
              return fb ?? '';
            }),
          },
          12345,
          5
        )
      ).toBe(`reb_${dt.year}_${dt.month}_5`);

      // Counter sync passes regex when mode is prefix_date_counter or prefix_telegramid_number
      const syncDateDb = createMockDb({
        returningResults: [[{ currentCount: 11 }], [{ currentCount: 1 }], [{ currentCount: 1 }]],
      });
      getDbMock.mockReturnValue(syncDateDb.db as never);
      rebeccaService.getHighestCounters.mockResolvedValue({
        prefix_number: 2,
        telegramid_number: 3,
        custom: 10,
      });
      const dateSvc = new ConfigService(
        rebeccaService as unknown as RebeccaService,
        {
          getSetting: vi.fn((k: string, fb?: string) => {
            if (k === 'naming_mode') return 'prefix_date_counter';
            if (k === 'naming_prefix') return 'reb';
            return fb ?? '';
          }),
        } as unknown as TranslationService
      );
      await expect(dateSvc.syncCounters()).resolves.toBe(10);
      const passedPatterns = rebeccaService.getHighestCounters.mock.calls[0]?.[0] as
        Record<string, RegExp> | undefined;
      expect(passedPatterns?.custom).toBeInstanceOf(RegExp);
      expect(passedPatterns?.custom.test(`reb_${dt.date}_10`)).toBe(true);

      // prefix_telegramid_number also passes dedicated pattern to getHighestCounters
      rebeccaService.getHighestCounters.mockClear();
      const tidDb = createMockDb({ returningResults: [[{ currentCount: 1 }]] });
      getDbMock.mockReturnValue(tidDb.db as never);
      const tidSvc = new ConfigService(
        rebeccaService as unknown as RebeccaService,
        {
          getSetting: vi.fn((k: string, fb?: string) => {
            if (k === 'naming_mode') return 'prefix_telegramid_number';
            if (k === 'naming_prefix') return 'reb';
            return fb ?? '';
          }),
        } as unknown as TranslationService
      );
      await tidSvc.syncCounters();
      const tidPatterns = rebeccaService.getHighestCounters.mock.calls[0]?.[0] as
        Record<string, RegExp> | undefined;
      expect(tidPatterns?.custom.test('reb_6698253699_10')).toBe(true);

      // Multi-panel isolation & exhaustion check
      const healthyCounters = vi.fn().mockResolvedValue({
        prefix_number: 9,
        telegramid_number: 4,
        custom: 7,
      });
      const unavailableCounters = vi.fn().mockRejectedValue(new Error('panel unavailable'));
      const multiPanels = {
        getEnabledPanelIds: vi.fn(() => ['panel_a', 'panel_b']),
        resolveTarget: vi.fn(),
        getService: vi.fn((id: string) => ({
          getHighestCounters: id === 'panel_a' ? healthyCounters : unavailableCounters,
        })),
      } as unknown as RebeccaPanelRegistry;
      const multiDb = createMockDb({
        returningResults: [[{ currentCount: 10 }]],
      });
      getDbMock.mockReturnValue(multiDb.db as never);
      const multiSvc = new ConfigService(multiPanels, {
        getSetting: vi.fn((k: string, fb?: string) => {
          if (k === 'naming_mode') return 'prefix_number';
          if (k === 'naming_prefix') return 'rebecca';
          return fb ?? '';
        }),
      } as unknown as TranslationService);
      await expect(multiSvc.syncCounters()).resolves.toBe(9);
      await expect(multiSvc.generateConfigName(42, 'panel_a')).resolves.toBe('rebecca_10');
      await expect(multiSvc.generateConfigName(42, 'panel_b')).rejects.toThrow(
        'CONFIG_COUNTER_SYNC_FAILED:panel_b'
      );

      // Exhausted counter fails closed
      getDbMock.mockReturnValue(createMockDb({ returningResults: [[]] }).db as never);
      await expect(multiSvc.generateConfigName(42, 'panel_a')).rejects.toThrow(
        'CONFIG_COUNTER_EXHAUSTED'
      );
    });

    it('enforces self-transfer rejection (even with allowAdminOverride), advisory lock, and incarnation verification', async () => {
      const mockPanels = {
        getService: vi.fn(() => rebeccaService as unknown as RebeccaService),
        getEnabledPanelIds: vi.fn(() => ['legacy']),
        resolveTarget: vi.fn().mockResolvedValue({ panelId: 'legacy', serviceId: 1 }),
      } as unknown as RebeccaPanelRegistry;
      const transferService = new ConfigTransferService(mockPanels);

      // Self-transfer when config belongs to destination user is rejected even when allowAdminOverride=true
      const selfCfg = {
        id: 'uc_self',
        telegramId: 2002,
        panelId: 'legacy',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[{ telegramId: 2002, isBanned: false }], [selfCfg]],
        }).db as never
      );
      await expect(
        transferService.transfer({
          configId: 'uc_self',
          fromTelegramId: 1001,
          toTelegramId: 2002,
          actorTelegramId: 9999,
          allowAdminOverride: true,
        })
      ).rejects.toThrow('TRANSFER_TO_SELF');

      // Advisory lock contention & incarnation mismatch reject cleanly
      const busyClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({ connect: vi.fn().mockResolvedValue(busyClient) } as never);
      const otherCfg = { ...selfCfg, telegramId: 1001 };
      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[{ telegramId: 2002, isBanned: false }], [otherCfg]],
        }).db as never
      );
      await expect(
        transferService.transfer({
          configId: 'uc_self',
          fromTelegramId: 1001,
          toTelegramId: 2002,
          actorTelegramId: 1001,
        })
      ).rejects.toThrow('CONFIG_MUTATION_BUSY');

      mockUnlockedPool();
      rebeccaService.getUser.mockResolvedValue(
        remoteUser('alice', OPAQUE_SUB_URL, { created_at: '2026-02-01T00:00:00Z' })
      );
      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[{ telegramId: 2002, isBanned: false }], [otherCfg]],
        }).db as never
      );
      await expect(
        transferService.transfer({
          configId: 'uc_self',
          fromTelegramId: 1001,
          toTelegramId: 2002,
          actorTelegramId: 1001,
        })
      ).rejects.toThrow('CONFIG_INCARNATION_MISMATCH');
    });
  });
});
