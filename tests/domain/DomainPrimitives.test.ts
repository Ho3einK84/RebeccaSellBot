import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialCipher } from '../../src/infra/CredentialCipher.js';
import { rebeccaUserDetailSchema } from '../../src/infra/RebeccaApiSchemas.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
  type RebeccaApiClient,
} from '../../src/infra/RebeccaApiClient.js';
import {
  calculateTraffic,
  deletedConfigLifecycle,
  isConfigActive,
  observedConfigLifecycle,
} from '../../src/domain/services/ConfigLifecycle.js';
import { dbIntegerToSafeNumber } from '../../src/domain/services/DbNumber.js';
import {
  backupEnabled,
  backupIncludeEnv,
  backupIntervalHours,
  backupTargetChatId,
  customVolumeEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../src/domain/services/FeatureSettings.js';
import { trackFunnelEvent } from '../../src/domain/services/FunnelTelemetry.js';
import {
  purchaseOwnershipMarker,
  remoteFingerprint,
  remoteMatchesOwnershipMarker,
  trialOwnershipMarker,
} from '../../src/domain/services/RebeccaOwnership.js';
import {
  getRebeccaService,
  isRebeccaPanelRegistryAccess,
  normalizeRebeccaPanelAccess,
} from '../../src/domain/services/RebeccaPanelAccess.js';
import {
  LEGACY_PANEL_ID,
  RebeccaPanelNotConfiguredError,
  RebeccaPanelRegistry,
} from '../../src/domain/services/RebeccaPanelRegistry.js';
import {
  RebeccaService,
  registerAdminAlertHook,
} from '../../src/domain/services/RebeccaService.js';
import { normalizeDataLimit } from '../../src/domain/services/TrafficLimit.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

const { getDbMock, loggerInfoMock, loggerErrorMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../../src/infra/db.js', () => ({ getDb: getDbMock }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: loggerErrorMock,
    debug: vi.fn(),
  },
}));

describe('DomainPrimitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TrafficLimit & ConfigLifecycle', () => {
    it('normalizes absent, null, zero, negative, positive, and invalid data limits', () => {
      expect(normalizeDataLimit(undefined)).toBeNull();
      expect(normalizeDataLimit(null)).toBeNull();
      expect(normalizeDataLimit(0)).toBeNull();
      expect(normalizeDataLimit(0n)).toBeNull();
      expect(normalizeDataLimit(-1)).toBeNull();
      expect(normalizeDataLimit(-100n)).toBeNull();
      expect(normalizeDataLimit('0')).toBeNull();
      expect(normalizeDataLimit('')).toBeNull();

      expect(normalizeDataLimit(1024)).toBe(1024);
      expect(normalizeDataLimit(5368709120)).toBe(5368709120);
      expect(normalizeDataLimit(5368709120n)).toBe(5368709120);
      expect(normalizeDataLimit('5368709120')).toBe(5368709120);

      expect(normalizeDataLimit(Number.NaN)).toBeUndefined();
      expect(normalizeDataLimit('abc')).toBeUndefined();
      expect(normalizeDataLimit({})).toBeUndefined();
    });

    it('handles unlimited limits consistently across calculateTraffic and isConfigActive', () => {
      const ONE_GB = 1024 * 1024 * 1024;
      const futureExpire = Math.floor(Date.now() / 1000) + 86400;

      for (const limit of [undefined, null, 0]) {
        const traffic = calculateTraffic({
          status: 'active',
          data_limit: limit,
          used_traffic: 5 * ONE_GB,
          expire: futureExpire,
        });
        expect(traffic.isUnlimited).toBe(true);
        expect(traffic.dataLimit).toBeNull();
        expect(traffic.remainingBytes).toBeNull();

        expect(
          isConfigActive({
            status: 'active',
            data_limit: limit,
            used_traffic: 0,
            expire: futureExpire,
          })
        ).toBe(true);
        expect(
          isConfigActive({
            status: 'active',
            data_limit: limit,
            used_traffic: 12 * ONE_GB,
            expire: futureExpire,
          })
        ).toBe(true);
      }
    });

    it('evaluates limited quotas, expiration boundaries, and RebeccaApiSchemas parsing', () => {
      const ONE_GB = 1024 * 1024 * 1024;
      const TEN_GB = 10 * ONE_GB;
      const futureExpire = Math.floor(Date.now() / 1000) + 86400;

      const traffic = calculateTraffic({
        status: 'active',
        data_limit: TEN_GB,
        used_traffic: 5 * ONE_GB,
        expire: futureExpire,
      });
      expect(traffic).toMatchObject({
        isUnlimited: false,
        dataLimit: TEN_GB,
        remainingBytes: 5 * ONE_GB,
      });

      expect(
        isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: 5 * ONE_GB,
          expire: futureExpire,
        })
      ).toBe(true);
      expect(
        isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: TEN_GB,
          expire: futureExpire,
        })
      ).toBe(false);
      expect(
        isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: 12 * ONE_GB,
          expire: futureExpire,
        })
      ).toBe(false);
      expect(
        isConfigActive(
          { status: 'active', data_limit: null, used_traffic: 0, expire: 1000 },
          null,
          1000
        )
      ).toBe(false);

      const basePayload = {
        username: 'alice',
        status: 'active',
        used_traffic: 1024,
        subscription_url: 'https://vpn.example.com/sub/alice',
        links: ['vless://alice@example.com:443'],
        expire: null,
      };
      expect(rebeccaUserDetailSchema.parse({ ...basePayload }).data_limit).toBeNull();
      expect(
        rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: null }).data_limit
      ).toBeNull();
      expect(
        rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: 0 }).data_limit
      ).toBeNull();
      expect(
        rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: 5368709120 }).data_limit
      ).toBe(5368709120);

      expect(
        observedConfigLifecycle({ status: 'active', data_limit: 0, used_traffic: 0, expire: null })
          .panelDataLimit
      ).toBeNull();
      expect(
        observedConfigLifecycle({
          status: 'active',
          data_limit: 10737418240,
          used_traffic: 0,
          expire: null,
        }).panelDataLimit
      ).toBe(10737418240);
      expect(deletedConfigLifecycle().panelStatus).toBe('deleted');
    });
  });

  describe('DbNumber', () => {
    it('accepts safe integers/bigint strings and fails closed on unsafe integers', () => {
      expect(dbIntegerToSafeNumber('9007199254740991', 'amount')).toBe(Number.MAX_SAFE_INTEGER);
      expect(dbIntegerToSafeNumber('-42', 'amount')).toBe(-42);
      expect(() => dbIntegerToSafeNumber('9007199254740992', 'amount')).toThrow(
        'UNSAFE_DB_INTEGER:amount'
      );
    });
  });

  describe('FeatureSettings', () => {
    const reader = (values: Record<string, string>) => ({
      getSetting: vi.fn((key: string, fallback = '') => values[key] ?? fallback),
    });

    it('parses custom volume, wallet transfer, and backup settings with safe defaults', () => {
      expect(customVolumeEnabled(reader({}))).toBe(true);
      expect(customVolumeEnabled(reader({ custom_volume_enabled: 'false' }))).toBe(false);
      expect(customVolumeEnabled(reader({ custom_volume_enabled: ' FALSE ' }))).toBe(false);
      expect(customVolumeEnabled(reader({ custom_volume_enabled: '0' }))).toBe(false);

      expect(walletTransferEnabled(reader({}))).toBe(true);
      expect(walletTransferEnabled(reader({ wallet_transfer_enabled: '0' }))).toBe(false);
      expect(walletTransferEnabled(reader({ wallet_transfer_enabled: 'true' }))).toBe(true);

      expect(walletTransferMinAmount(reader({}))).toBe(5_000);
      expect(walletTransferMinAmount(reader({ wallet_transfer_min_amount: '10000' }))).toBe(10_000);
      expect(walletTransferMinAmount(reader({ wallet_transfer_min_amount: 'invalid' }))).toBe(
        5_000
      );

      expect(backupEnabled(reader({}))).toBe(false);
      expect(backupEnabled(reader({ backup_enabled: '1' }))).toBe(true);
      expect(backupIntervalHours(reader({}))).toBe(24);
      expect(backupIntervalHours(reader({ backup_interval_hours: '720' }))).toBe(720);
      expect(backupIntervalHours(reader({ backup_interval_hours: '9999' }))).toBe(24);
      expect(backupTargetChatId(reader({ backup_target_chat_id: ' -100123 ' }))).toBe('-100123');
      expect(backupIncludeEnv(reader({}))).toBe(true);
      expect(backupIncludeEnv(reader({ backup_include_env: '0' }))).toBe(false);
    });
  });

  describe('RebeccaOwnership, RebeccaPanelAccess & FunnelTelemetry', () => {
    it('constructs ownership markers and fails closed when created_at is absent', () => {
      expect(purchaseOwnershipMarker('pi_123')).toBe('rsbot:pi_123');
      expect(trialOwnershipMarker(42, 'trial_u')).toBe('rsbot:trial:42:trial_u');
      expect(remoteMatchesOwnershipMarker({ note: 'rsbot:pi_123' }, 'rsbot:pi_123')).toBe(true);
      expect(remoteMatchesOwnershipMarker({ note: 'other' }, 'rsbot:pi_123')).toBe(false);
      expect(remoteFingerprint({ created_at: ' 2026-01-01T00:00:00Z ' })).toBe(
        'created:2026-01-01T00:00:00Z'
      );
      expect(() => remoteFingerprint({ created_at: '' })).toThrow('REMOTE_INCARNATION_UNAVAILABLE');
    });

    it('adapts single RebeccaService vs RebeccaPanelRegistry uniformly', async () => {
      const legacyService = { kind: 'svc' } as unknown as RebeccaService;
      expect(isRebeccaPanelRegistryAccess(legacyService)).toBe(false);
      expect(getRebeccaService(legacyService, 'panel_b')).toBe(legacyService);

      const normalized = normalizeRebeccaPanelAccess(legacyService);
      expect(normalized.getEnabledPanelIds()).toEqual(['legacy']);
      await expect(normalized.resolveTarget()).resolves.toMatchObject({
        panelId: 'legacy',
        serviceId: 1,
        service: legacyService,
      });

      const registryService = { kind: 'panel_b_svc' } as unknown as RebeccaService;
      const registry = {
        getService: vi.fn(() => registryService),
        getEnabledPanelIds: vi.fn(() => ['panel_b']),
        resolveTarget: vi.fn(),
      };
      expect(isRebeccaPanelRegistryAccess(registry)).toBe(true);
      expect(getRebeccaService(registry, 'panel_b')).toBe(registryService);
    });

    it('logs privacy-safe funnel telemetry events', () => {
      trackFunnelEvent('checkout_start');
      expect(loggerInfoMock).toHaveBeenCalledWith(
        { funnelEvent: 'checkout_start' },
        'Funnel Event: checkout_start'
      );
    });
  });

  describe('RebeccaPanelRegistry', () => {
    const secret = '0123456789abcdef0123456789abcdef';

    it('preserves admin-disabled status and service selection on restart once legacy panel exists', async () => {
      const mock = createMockDb({
        selectResults: [
          [{ id: LEGACY_PANEL_ID }], // existingLegacy check -> already exists!
          [
            {
              id: LEGACY_PANEL_ID,
              name: 'پنل اصلی',
              baseUrl: 'https://panel.example.com',
              apiKeyEncrypted: null,
              adminUsername: 'admin',
              adminPasswordEncrypted: 'enc-pass',
              enabled: false,
              isDefault: false,
            },
          ],
          // reload() queries
          [
            {
              id: LEGACY_PANEL_ID,
              name: 'پنل اصلی',
              baseUrl: 'https://panel.example.com',
              apiKeyEncrypted: null,
              adminUsername: 'admin',
              adminPasswordEncrypted: 'enc-pass',
              enabled: false,
              isDefault: false,
            },
          ],
          [{ panelId: LEGACY_PANEL_ID, serviceId: 9, name: 'VIP', isDefault: true }],
        ],
      });
      getDbMock.mockReturnValue(mock.db);

      const translationService = {
        getStoredSetting: vi.fn(() => undefined),
        deleteSetting: vi.fn(),
      } as unknown as TranslationService;

      const registry = new RebeccaPanelRegistry(
        {
          baseUrl: 'https://panel.example.com',
          adminPassword: 'secret',
          serviceId: 1,
          serviceName: 'Default',
        },
        secret
      );
      await registry.initialize(translationService);

      // Should not overwrite disabled flag or clobber admin's serviceId=9 when legacy row already existed
      expect(mock.state.updateCalls).toHaveLength(0);
      expect(registry.listPanels()[0]).toMatchObject({
        id: LEGACY_PANEL_ID,
        enabled: false,
      });
    });

    it('evaluates default panel exclusivity and configuration guards transactionally in createPanel and setPanelEnabled', async () => {
      const cipher = new CredentialCipher(secret);
      const encryptedKeyB = cipher.encrypt('key-backup');

      // 1. setPanelEnabled rejects with real RebeccaPanelNotConfiguredError when panel lacks URL/credentials
      const brokenMock = createMockDb({
        selectResults: [
          [
            {
              id: 'rp_broken',
              enabled: false,
              isDefault: false,
              baseUrl: null,
              apiKeyEncrypted: null,
              adminPasswordEncrypted: null,
            },
          ],
        ],
      });
      getDbMock.mockReturnValue(brokenMock.db);
      const registry = new RebeccaPanelRegistry({ serviceId: 1, serviceName: 'Default' }, secret);
      await expect(registry.setPanelEnabled('rp_broken', true)).rejects.toThrow(
        RebeccaPanelNotConfiguredError
      );
      expect(brokenMock.state.transactionCount).toBe(1);
      expect(brokenMock.state.rolledBackTransactions).toBe(1);
      expect(brokenMock.state.updateCalls).toHaveLength(0);

      // 2. setPanelEnabled(LEGACY_PANEL_ID, false) transfers default atomically to another usable panel
      const disableMock = createMockDb({
        selectResults: [
          [
            {
              id: LEGACY_PANEL_ID,
              enabled: true,
              isDefault: true,
              baseUrl: 'https://a.example.com',
              apiKeyEncrypted: cipher.encrypt('key-a'),
              adminPasswordEncrypted: null,
            },
            {
              id: 'rp_backup',
              enabled: true,
              isDefault: false,
              baseUrl: 'https://b.example.com',
              apiKeyEncrypted: encryptedKeyB,
              adminPasswordEncrypted: null,
            },
          ],
          // reload() queries after tx commits
          [
            {
              id: LEGACY_PANEL_ID,
              name: 'Primary',
              baseUrl: 'https://a.example.com',
              apiKeyEncrypted: cipher.encrypt('key-a'),
              adminUsername: 'admin',
              adminPasswordEncrypted: null,
              enabled: false,
              isDefault: false,
            },
            {
              id: 'rp_backup',
              name: 'Backup',
              baseUrl: 'https://b.example.com',
              apiKeyEncrypted: encryptedKeyB,
              adminUsername: 'admin',
              adminPasswordEncrypted: null,
              enabled: true,
              isDefault: true,
            },
          ],
          [{ panelId: 'rp_backup', serviceId: 2, name: 'VIP', isDefault: true }],
        ],
      });
      getDbMock.mockReturnValue(disableMock.db);
      await registry.setPanelEnabled(LEGACY_PANEL_ID, false);
      expect(disableMock.state.transactionCount).toBe(1);
      expect(disableMock.state.updateCalls).toHaveLength(2);
      expect(disableMock.state.updateCalls[0]?.set).toMatchObject({
        enabled: false,
        isDefault: false,
      });
      expect(disableMock.state.updateCalls[1]?.set).toMatchObject({ isDefault: true });
      expect(registry.getEnabledPanelIds()).toEqual(['rp_backup']);
      expect(registry.getPanel('rp_backup')).toMatchObject({ enabled: true, isDefault: true });

      // 3. createPanel clears unusable old default in the same transaction
      const createMock = createMockDb({
        selectResults: [
          [
            {
              id: LEGACY_PANEL_ID,
              enabled: false,
              isDefault: true,
              baseUrl: null,
              apiKeyEncrypted: null,
              adminPasswordEncrypted: null,
            },
          ],
          [],
          [],
        ],
      });
      getDbMock.mockReturnValue(createMock.db);
      await registry.createPanel({
        name: 'EU Node',
        baseUrl: 'https://eu.example.com',
        apiKey: 'secret-key',
        serviceId: 2,
        serviceName: 'VIP',
      });
      expect(createMock.state.transactionCount).toBe(1);
      expect(createMock.state.updateCalls).toHaveLength(1);
      expect(createMock.state.updateCalls[0]?.set).toMatchObject({ isDefault: false });
      expect(createMock.state.insertCalls).toHaveLength(2);
    });
  });

  describe('RebeccaService', () => {
    function makeApiClient(overrides: Partial<Record<keyof RebeccaApiClient, unknown>> = {}) {
      return {
        isCircuitOpen: vi.fn(() => false),
        resetCircuitBreaker: vi.fn(),
        configure: vi.fn(),
        checkHealth: vi.fn(async () => true),
        getUser: vi.fn(async (username: string) => ({ username, status: 'active' })),
        getUsers: vi.fn(async () => ({ users: [], total: 0 })),
        createUser: vi.fn(async (payload: { username: string }) => ({
          username: payload.username,
          status: 'active',
        })),
        updateUser: vi.fn(async (username: string) => ({ username, status: 'active' })),
        deleteUser: vi.fn(async (username: string) => ({ username, status: 'deleted' })),
        resetUserTraffic: vi.fn(async (username: string) => ({ username, status: 'active' })),
        revokeSubscription: vi.fn(async (username: string) => ({ username, status: 'active' })),
        ...overrides,
      } as unknown as RebeccaApiClient & {
        isCircuitOpen: ReturnType<typeof vi.fn>;
        resetCircuitBreaker: ReturnType<typeof vi.fn>;
        configure: ReturnType<typeof vi.fn>;
        checkHealth: ReturnType<typeof vi.fn>;
        getUser: ReturnType<typeof vi.fn>;
        getUsers: ReturnType<typeof vi.fn>;
        createUser: ReturnType<typeof vi.fn>;
        updateUser: ReturnType<typeof vi.fn>;
        deleteUser: ReturnType<typeof vi.fn>;
        resetUserTraffic: ReturnType<typeof vi.fn>;
        revokeSubscription: ReturnType<typeof vi.fn>;
      };
    }

    it('manages outage alert cooldown per panel, resets on recovery, and survives alert hook failure', async () => {
      const alertHook = vi.fn().mockResolvedValue(undefined);
      registerAdminAlertHook(alertHook);

      const panelAId = `rp_a_${Date.now()}`;
      const panelBId = `rp_b_${Date.now()}`;
      const originDown = new RebeccaOriginDownError('/api/user/alice?token=secret', 503, 3, true);

      const clientA = makeApiClient({
        getUser: vi.fn().mockRejectedValueOnce(originDown).mockRejectedValueOnce(originDown),
      });
      const clientB = makeApiClient({
        getUser: vi.fn().mockRejectedValueOnce(originDown),
      });

      const svcA = new RebeccaService(clientA, { panelId: panelAId, panelName: 'Panel A' });
      const svcB = new RebeccaService(clientB, { panelId: panelBId, panelName: 'Panel B' });

      // First outage on panelA triggers alert hook
      await expect(svcA.getUser('alice')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledTimes(1);
      expect(alertHook).toHaveBeenLastCalledWith({
        kind: 'rebecca_origin_down',
        panelId: panelAId,
        panelName: 'Panel A',
        endpoint: 'GET /api/user/alice',
        attempts: 3,
      });

      // Second immediate outage on same panelA is deduplicated by cooldown
      await expect(svcA.getUser('alice')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledTimes(1);

      // Independent panelB still fires its own outage alert
      await expect(svcB.getUser('bob')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledTimes(2);

      // Confirmed success clears panelA cooldown -> next outage alerts immediately even if hook throws
      clientA.getUser
        .mockResolvedValueOnce({ username: 'alice', status: 'active' })
        .mockRejectedValueOnce(originDown);
      await expect(svcA.getUser('alice')).resolves.toMatchObject({ username: 'alice' });
      expect(clientA.resetCircuitBreaker).toHaveBeenCalledTimes(1);

      alertHook.mockRejectedValueOnce(new Error('telegram unavailable'));
      await expect(svcA.getUser('alice')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledTimes(3);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to fire admin alert'
      );

      // Manual resetCircuitBreaker also clears cooldown
      svcA.resetCircuitBreaker();
      clientA.getUser.mockRejectedValueOnce(originDown);
      await expect(svcA.getUser('alice')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledTimes(4);
    });

    it('delegates circuit breaker/connection health checks and redacts contract/API errors without alerting outage', async () => {
      const alertHook = vi.fn().mockResolvedValue(undefined);
      registerAdminAlertHook(alertHook);

      const contractErr = new RebeccaContractError('/api/user?secret=123', 2);
      const apiErr = new RebeccaApiError(422, '/api/user/u1?token=abc', 'invalid payload');

      const client = makeApiClient({
        isCircuitOpen: vi.fn(() => true),
        checkHealth: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
        createUser: vi.fn().mockRejectedValueOnce(contractErr),
        updateUser: vi.fn().mockRejectedValueOnce(apiErr),
      });
      const svc = new RebeccaService(client, {
        panelId: `rp_health_${Date.now()}`,
        panelName: 'Edge',
      });

      expect(svc.isCircuitOpen()).toBe(true);
      await expect(svc.checkHealth()).resolves.toBe(false);
      expect(client.resetCircuitBreaker).not.toHaveBeenCalled();

      await expect(svc.checkHealth()).resolves.toBe(true);
      expect(client.resetCircuitBreaker).toHaveBeenCalledTimes(1);

      svc.configureConnection({ baseUrl: 'https://new.example.com', apiKey: 'raw-key-hidden' });
      expect(client.configure).toHaveBeenCalledWith({
        baseUrl: 'https://new.example.com',
        apiKey: 'raw-key-hidden',
      });
      expect(loggerInfoMock).toHaveBeenCalledWith(
        { baseUrlChanged: true, apiKeyChanged: true },
        'Rebecca API connection settings updated'
      );

      // Contract mismatch & 4xx API errors pass through with redacted endpoints and never trigger outage alerts
      await expect(svc.createUser({ username: 'u1' } as never)).rejects.toBe(contractErr);
      await expect(svc.updateUser('u1', { status: 'disabled' })).rejects.toBe(apiErr);
      await Promise.resolve();
      expect(alertHook).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalledWith(
        {
          error: { name: 'RebeccaContractError', endpoint: '/api/user?…', issueCount: 2 },
          username: 'u1',
        },
        'RebeccaService: createUser failed'
      );
      expect(loggerErrorMock).toHaveBeenCalledWith(
        {
          error: { name: 'RebeccaApiError', endpoint: '/api/user/u1?…', status: 422 },
          username: 'u1',
        },
        'RebeccaService: updateUser failed'
      );

      // enableUser / disableUser delegate via updateUser with status active/disabled
      client.updateUser.mockResolvedValue({ username: 'u2', status: 'active' });
      await svc.enableUser('u2');
      await svc.disableUser('u2');
      expect(client.updateUser).toHaveBeenCalledWith('u2', { status: 'active' });
      expect(client.updateUser).toHaveBeenCalledWith('u2', { status: 'disabled' });
    });

    it('scans paginated user lists with escaped prefix matching and named pattern extraction', async () => {
      const page1 = [
        { username: 'myXshop+1_999' }, // must NOT match regex metachar '.' in prefix
        { username: 'my.shop+1_12' },
        { username: 'MY.SHOP+1_45' },
        { username: 'sub_42_3' },
      ];
      const page2 = [
        { username: 'my.shop+1_108' },
        { username: 'sub_99_77' },
        { username: 'sub_99_notanumber' },
      ];
      const client = makeApiClient({
        getUsers: vi.fn(async (offset = 0) =>
          offset === 0 ? { users: page1, total: 250 } : { users: page2, total: 250 }
        ),
      });
      const svc = new RebeccaService(client);

      await expect(svc.getHighestCounterForPrefix('my.shop+1')).resolves.toBe(108);
      expect(client.getUsers).toHaveBeenNthCalledWith(1, 0, 200, 'my.shop+1', undefined, false);
      expect(client.getUsers).toHaveBeenNthCalledWith(2, 200, 200, 'my.shop+1', undefined, false);

      await expect(
        svc.getHighestCounters({
          prefixed: /^my\.shop\+1_(?<counter>\d+)$/i,
          scoped: /^sub_\d+_(?<counter>\d+)$/i,
          absent: /^none_(?<counter>\d+)$/,
        })
      ).resolves.toEqual({
        prefixed: 108,
        scoped: 77,
        absent: 0,
      });

      await expect(svc.getHighestCounter(/^sub_\d+_(?<counter>\d+)$/)).resolves.toBe(77);
    });
  });
});
