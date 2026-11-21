import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, getPool } from '../../src/infra/db.js';
import {
  customServiceNameEnabled,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
} from '../../src/domain/services/FeatureSettings.js';
import { parsePackageOptionsJson } from '../../src/domain/services/PricingService.js';
import { observedConfigLifecycle } from '../../src/domain/services/ConfigLifecycle.js';
import {
  assertPanelPurchaseApplied,
  PanelPurchaseVerificationError,
} from '../../src/domain/services/WalletSupport.js';
import { WalletService } from '../../src/domain/services/WalletService.js';
import {
  ConfigService,
  normalizeCustomServiceName,
} from '../../src/domain/services/ConfigService.js';
import { PurchaseCheckoutService } from '../../src/domain/services/PurchaseCheckoutService.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
  RebeccaService,
  registerAdminAlertHook,
  type RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaApiClient } from '../../src/infra/RebeccaApiClient.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
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

const GB = 1024 ** 3;
const CREATED_AT = '2026-01-01T00:00:00Z';

function makeSettingReader(values: Record<string, string>) {
  return {
    getSetting: vi.fn((key: string, fallback = '') => values[key] ?? fallback),
    getSettingNum: vi.fn((_key: string, fallback = 1) => fallback),
  };
}

function makeRemoteUser(overrides: Partial<RebeccaUserDetail> = {}): RebeccaUserDetail {
  return {
    username: 'test_user',
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * GB,
    expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
    on_hold_expire_duration: null,
    created_at: CREATED_AT,
    subscription_url: 'https://sub.example.test/primary',
    subscription_urls: { primary: 'https://sub.example.test/primary' },
    links: [],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: 'Default',
    admin_username: 'admin',
    ...overrides,
  };
}

describe('Phase 1: Native Rebecca Panel Features & Purchase/Renewal Lifecycle', () => {
  const getDbMock = vi.mocked(getDb);
  const getPoolMock = vi.mocked(getPool);

  beforeEach(() => {
    vi.clearAllMocks();
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ locked: true, unlocked: true }] }),
        release: vi.fn(),
      }),
    } as never);
  });

  describe('1. on_hold (Start on First Use)', () => {
    it('evaluates FeatureSettings defaults and PackageOption startOnFirstUse parsing', () => {
      expect(onHoldDefaultEnabled(makeSettingReader({}))).toBe(false);
      expect(onHoldDefaultEnabled(makeSettingReader({ on_hold_default_enabled: 'true' }))).toBe(
        true
      );
      expect(onHoldDefaultEnabled(makeSettingReader({ on_hold_default_enabled: '1' }))).toBe(true);
      expect(onHoldDefaultEnabled(makeSettingReader({ on_hold_default_enabled: 'false' }))).toBe(
        false
      );

      const parsed = parsePackageOptionsJson(
        JSON.stringify([
          {
            id: 'hold_pkg',
            name: 'Hold Plan',
            gbAmount: 20,
            durationDays: 30,
            price: 100_000,
            startOnFirstUse: true,
            rolloverQuota: false,
          },
        ])
      );
      expect(parsed).toEqual([
        {
          id: 'hold_pkg',
          name: 'Hold Plan',
          gbAmount: 20,
          durationDays: 30,
          price: 100_000,
          startOnFirstUse: true,
          rolloverQuota: false,
        },
      ]);

      expect(
        parsePackageOptionsJson(
          JSON.stringify([
            {
              id: 'bad_pkg',
              name: 'Bad',
              gbAmount: 10,
              durationDays: 30,
              price: 50_000,
              startOnFirstUse: 'yes',
            },
          ])
        )
      ).toBeUndefined();
    });

    it('validates on_hold in assertPanelPurchaseApplied and persists duration in observedConfigLifecycle', () => {
      const validOnHold = makeRemoteUser({
        status: 'on_hold',
        expire: null,
        data_limit: 20 * GB,
        on_hold_expire_duration: 30 * 86_400,
      });

      expect(() =>
        assertPanelPurchaseApplied(validOnHold, 20 * GB, null, {
          expectedStatus: 'on_hold',
          expectedOnHoldDuration: 30 * 86_400,
        })
      ).not.toThrow();

      expect(() =>
        assertPanelPurchaseApplied(
          makeRemoteUser({ status: 'active', expire: null, data_limit: 20 * GB }),
          20 * GB,
          null,
          { expectedStatus: 'on_hold', expectedOnHoldDuration: 30 * 86_400 }
        )
      ).toThrow(PanelPurchaseVerificationError);

      expect(() =>
        assertPanelPurchaseApplied(
          makeRemoteUser({
            status: 'on_hold',
            expire: 1_900_000_000,
            data_limit: 20 * GB,
            on_hold_expire_duration: 30 * 86_400,
          }),
          20 * GB,
          null,
          { expectedStatus: 'on_hold', expectedOnHoldDuration: 30 * 86_400 }
        )
      ).toThrow(PanelPurchaseVerificationError);

      expect(() =>
        assertPanelPurchaseApplied(
          makeRemoteUser({
            status: 'on_hold',
            expire: null,
            data_limit: 20 * GB,
            on_hold_expire_duration: 15 * 86_400,
          }),
          20 * GB,
          null,
          { expectedStatus: 'on_hold', expectedOnHoldDuration: 30 * 86_400 }
        )
      ).toThrow(PanelPurchaseVerificationError);

      expect(observedConfigLifecycle(validOnHold)).toMatchObject({
        panelStatus: 'on_hold',
        panelExpire: null,
        panelDataLimit: 20 * GB,
        panelOnHoldExpireDuration: 30 * 86_400,
      });

      expect(
        observedConfigLifecycle(
          makeRemoteUser({ status: 'active', on_hold_expire_duration: 30 * 86_400 })
        ).panelOnHoldExpireDuration
      ).toBeNull();
    });

    it('creates on_hold user in WalletPurchaseSaga when enabled globally or overridden per package', async () => {
      const createUser = vi.fn().mockImplementation(async (payload: Record<string, unknown>) =>
        makeRemoteUser({
          username: String(payload.username),
          status: payload.status as 'active' | 'on_hold',
          data_limit: payload.data_limit as number,
          expire: (payload.expire as number | null) ?? null,
          on_hold_expire_duration: (payload.on_hold_expire_duration as number | null) ?? null,
          note: String(payload.note ?? ''),
        })
      );
      const mockRebecca = { createUser } as unknown as RebeccaService;
      const mockReferral = {
        calculateBonusSnapshot: vi.fn().mockResolvedValue({
          cashbackPercent: 0,
          cashbackAmount: 0,
          referrerTelegramId: null,
          referralBonusAmount: 0,
        }),
        processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReferralService;
      const mockPromo = {
        finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
        releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
      } as unknown as PromoService;

      // Global on_hold_default_enabled = true
      const globalOnHoldWallet = new WalletService(
        mockRebecca,
        makeSettingReader({ on_hold_default_enabled: 'true' }) as unknown as TranslationService,
        mockReferral,
        mockPromo
      );

      const db1 = createMockDb({
        returningResults: [[{ telegramId: 1001 }], [{ id: 'pi_1' }], [{ balance: 50_000 }]],
      });
      getDbMock.mockReturnValue(db1.db as never);

      await expect(
        globalOnHoldWallet.executePurchaseSaga({
          telegramId: 1001,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'hold_global',
          gbAmount: 15,
          durationDays: 30,
        })
      ).resolves.toMatchObject({ success: true, configUsername: 'hold_global' });

      expect(createUser).toHaveBeenLastCalledWith(
        expect.objectContaining({
          username: 'hold_global',
          status: 'on_hold',
          expire: null,
          on_hold_expire_duration: 30 * 86_400,
          data_limit: 15 * GB,
        })
      );
      expect(
        db1.state.insertCalls.some(
          (call) =>
            call.values.configUsername === 'hold_global' &&
            call.values.panelStatus === 'on_hold' &&
            call.values.panelOnHoldExpireDuration === 30 * 86_400
        )
      ).toBe(true);

      // Per-package startOnFirstUse: false overrides global true -> creates active user
      const db2 = createMockDb({
        returningResults: [[{ telegramId: 1001 }], [{ id: 'pi_2' }], [{ balance: 50_000 }]],
      });
      getDbMock.mockReturnValue(db2.db as never);

      await expect(
        globalOnHoldWallet.executePurchaseSaga({
          telegramId: 1001,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'active_override',
          gbAmount: 15,
          durationDays: 30,
          startOnFirstUse: false,
        })
      ).resolves.toMatchObject({ success: true });

      expect(createUser).toHaveBeenLastCalledWith(
        expect.objectContaining({
          username: 'active_override',
          status: 'active',
          expire: expect.any(Number),
        })
      );
    });
  });

  describe('2. Renewal Quota & Time Rollover', () => {
    function setupRenewalWallet(settings: Record<string, string>) {
      const getUser = vi.fn();
      const resetUserTraffic = vi.fn().mockResolvedValue({ username: 'cfg_1', used_traffic: 0 });
      const updateUser = vi
        .fn()
        .mockImplementation(async (username: string, payload: Record<string, unknown>) =>
          makeRemoteUser({
            username,
            status: 'active',
            data_limit: payload.data_limit as number,
            expire: payload.expire as number,
            used_traffic: 0,
          })
        );
      const wallet = new WalletService(
        { getUser, resetUserTraffic, updateUser } as unknown as RebeccaService,
        makeSettingReader(settings) as unknown as TranslationService,
        {
          calculateBonusSnapshot: vi.fn().mockResolvedValue({
            cashbackPercent: 0,
            cashbackAmount: 0,
            referrerTelegramId: null,
            referralBonusAmount: 0,
          }),
          processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
        } as unknown as ReferralService,
        {
          finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
          releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
        } as unknown as PromoService
      );
      return { wallet, getUser, resetUserTraffic, updateUser };
    }

    function seedRenewalDb(username: string) {
      const mock = createMockDb({
        returningResults: [
          [{ telegramId: 1001 }],
          [{ id: 'pi_r' }],
          [{ id: 'pi_r' }],
          [{ balance: 100_000 }],
          [{ id: `uc_${username}` }],
        ],
        selectResults: [
          [],
          [
            {
              id: `uc_${username}`,
              telegramId: 1001,
              panelId: 'legacy',
              configUsername: username,
              subUrl: `https://sub.example.test/${username}`,
              remoteCreatedAt: `created:${CREATED_AT}`,
            },
          ],
        ],
      });
      getDbMock.mockReturnValue(mock.db as never);
      return mock;
    }

    it('rolls over remaining traffic and remaining time on active renewal when enabled (default)', async () => {
      expect(renewalRolloverEnabled(makeSettingReader({}))).toBe(true);
      expect(renewalRolloverEnabled(makeSettingReader({ renewal_rollover_enabled: 'false' }))).toBe(
        false
      );

      const { wallet, getUser, resetUserTraffic, updateUser } = setupRenewalWallet({
        renewal_rollover_enabled: 'true',
      });
      seedRenewalDb('rollover_active');

      const nowSec = Math.floor(Date.now() / 1000);
      const remainingDaysSec = 10 * 86_400;
      getUser.mockResolvedValueOnce(
        makeRemoteUser({
          username: 'rollover_active',
          status: 'active',
          data_limit: 10 * GB,
          used_traffic: 4 * GB, // 6 GB remaining
          expire: nowSec + remainingDaysSec,
        })
      );

      await wallet.executePurchaseSaga({
        telegramId: 1001,
        amount: 50_000,
        type: 'renew_config',
        configUsername: 'rollover_active',
        gbAmount: 20,
        durationDays: 30,
      });

      expect(resetUserTraffic).toHaveBeenCalledWith('rollover_active');
      const updatePayload = updateUser.mock.calls[0]?.[1] as {
        data_limit: number;
        expire: number;
        status: string;
      };
      expect(updatePayload.status).toBe('active');
      expect(updatePayload.data_limit).toBe(26 * GB); // 20 GB + 6 GB remaining
      expect(Math.abs(updatePayload.expire - (nowSec + 40 * 86_400))).toBeLessThanOrEqual(5);
    });

    it('uses previous on_hold_expire_duration when renewing an on_hold config with rollover enabled', async () => {
      const { wallet, getUser, updateUser } = setupRenewalWallet({
        renewal_rollover_enabled: 'true',
      });
      seedRenewalDb('rollover_hold');

      const nowSec = Math.floor(Date.now() / 1000);
      getUser.mockResolvedValueOnce(
        makeRemoteUser({
          username: 'rollover_hold',
          status: 'on_hold',
          data_limit: 10 * GB,
          used_traffic: 0,
          expire: null,
          on_hold_expire_duration: 15 * 86_400,
        })
      );

      await wallet.executePurchaseSaga({
        telegramId: 1001,
        amount: 50_000,
        type: 'renew_config',
        configUsername: 'rollover_hold',
        gbAmount: 20,
        durationDays: 30,
      });

      const updatePayload = updateUser.mock.calls[0]?.[1] as {
        data_limit: number;
        expire: number;
      };
      expect(updatePayload.data_limit).toBe(30 * GB);
      expect(Math.abs(updatePayload.expire - (nowSec + 45 * 86_400))).toBeLessThanOrEqual(5);
    });

    it('resets quota and expiry cleanly without rollover when disabled globally or per package', async () => {
      const { wallet, getUser, updateUser } = setupRenewalWallet({
        renewal_rollover_enabled: 'false',
      });
      seedRenewalDb('no_rollover');

      const nowSec = Math.floor(Date.now() / 1000);
      getUser.mockResolvedValueOnce(
        makeRemoteUser({
          username: 'no_rollover',
          status: 'active',
          data_limit: 10 * GB,
          used_traffic: 2 * GB,
          expire: nowSec + 12 * 86_400,
        })
      );

      await wallet.executePurchaseSaga({
        telegramId: 1001,
        amount: 50_000,
        type: 'renew_config',
        configUsername: 'no_rollover',
        gbAmount: 20,
        durationDays: 30,
      });

      const updatePayload = updateUser.mock.calls[0]?.[1] as {
        data_limit: number;
        expire: number;
      };
      expect(updatePayload.data_limit).toBe(20 * GB);
      expect(Math.abs(updatePayload.expire - (nowSec + 30 * 86_400))).toBeLessThanOrEqual(5);

      // Per-package rolloverQuota: true overrides global false
      seedRenewalDb('pkg_override_rollover');
      getUser.mockResolvedValueOnce(
        makeRemoteUser({
          username: 'pkg_override_rollover',
          status: 'active',
          data_limit: 10 * GB,
          used_traffic: 5 * GB,
          expire: nowSec + 5 * 86_400,
        })
      );

      await wallet.executePurchaseSaga({
        telegramId: 1001,
        amount: 50_000,
        type: 'renew_config',
        configUsername: 'pkg_override_rollover',
        gbAmount: 20,
        durationDays: 30,
        rolloverQuota: true,
      });

      const overridePayload = updateUser.mock.calls[1]?.[1] as {
        data_limit: number;
        expire: number;
      };
      expect(overridePayload.data_limit).toBe(25 * GB);
      expect(Math.abs(overridePayload.expire - (nowSec + 35 * 86_400))).toBeLessThanOrEqual(5);
    });
  });

  describe('3. Custom Service Name', () => {
    it('validates custom names and persists requestedUsername on purchase checkouts', async () => {
      expect(customServiceNameEnabled(makeSettingReader({}))).toBe(false);
      expect(
        customServiceNameEnabled(makeSettingReader({ custom_service_name_enabled: 'true' }))
      ).toBe(true);

      expect(normalizeCustomServiceName('  My_VPN_01  ')).toBe('my_vpn_01');
      expect(normalizeCustomServiceName('  Ali_۰۱  ')).toBe('ali_01');
      expect(normalizeCustomServiceName('abc')).toBe('abc');
      expect(normalizeCustomServiceName('ab')).toBeNull();
      expect(normalizeCustomServiceName('1invalid')).toBeNull();
      expect(normalizeCustomServiceName('has-dash')).toBeNull();
      expect(normalizeCustomServiceName('a'.repeat(22))).toBeNull();
      expect(normalizeCustomServiceName('سرویس')).toBeNull();

      const resolveTarget = vi.fn().mockResolvedValue({ panelId: 'rp_1', serviceId: 1 });
      const checkoutService = new PurchaseCheckoutService({
        resolveTarget,
      } as unknown as RebeccaPanelRegistry);
      const mockDb = createMockDb({
        returningResults: [[{ id: 'co_custom1', requestedUsername: 'my_vpn' }]],
      });
      getDbMock.mockReturnValue(mockDb.db as never);

      const created = await checkoutService.create({
        telegramId: 1001,
        kind: 'new_config',
        pkg: { id: 'p1', name: 'P1', gbAmount: 10, durationDays: 30, price: 50_000 },
        requestedUsername: '  MY_VPN  ',
      });
      expect(created.requestedUsername).toBe('my_vpn');
      expect(mockDb.state.insertCalls[0]?.values).toMatchObject({
        requestedUsername: 'my_vpn',
      });

      await expect(
        checkoutService.create({
          telegramId: 1001,
          kind: 'new_config',
          pkg: { id: 'p1', name: 'P1', gbAmount: 10, durationDays: 30, price: 50_000 },
          requestedUsername: '1bad-name',
        })
      ).rejects.toThrow('PURCHASE_CHECKOUT_INVALID_USERNAME');
    });

    it('combines prefix + custom name and auto-suffixes on local DB or Rebecca panel collision', async () => {
      const getUser = vi.fn();
      const cfgService = new ConfigService(
        { getUser } as unknown as RebeccaService,
        makeSettingReader({ naming_prefix: 'shop' }) as unknown as TranslationService
      );

      // 1. Available in both local DB and panel (panel returns 404)
      getDbMock.mockReturnValue(createMockDb({ selectResults: [[]] }).db as never);
      getUser.mockRejectedValueOnce(
        new RebeccaApiError(404, '/api/user/shop_ali_home', 'Not Found')
      );
      await expect(cfgService.resolveCustomConfigName('Ali_Home')).resolves.toBe('shop_ali_home');

      // 2. Collision in local DB -> skips getUser for base, appends 3-char suffix and verifies availability
      getDbMock.mockReturnValue(
        createMockDb({ selectResults: [[{ id: 'uc_taken' }], []] }).db as never
      );
      getUser.mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/candidate', 'Not Found'));
      const localCollisionName = await cfgService.resolveCustomConfigName('ali_home');
      expect(localCollisionName).toMatch(/^shop_ali_home_[a-z0-9]{3}$/u);

      // 3. Free in local DB, taken on Rebecca panel -> appends 3-char suffix
      getDbMock.mockReturnValue(createMockDb({ selectResults: [[], []] }).db as never);
      getUser
        .mockResolvedValueOnce(makeRemoteUser({ username: 'shop_my_vpn' }))
        .mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/candidate', 'Not Found'));
      const panelCollisionName = await cfgService.resolveCustomConfigName('my_vpn');
      expect(panelCollisionName).toMatch(/^shop_my_vpn_[a-z0-9]{3}$/u);

      // 4. Long prefix + 21-char name + collision stays within Rebecca 32-char limit
      const longPrefixService = new ConfigService(
        { getUser } as unknown as RebeccaService,
        makeSettingReader({ naming_prefix: 'verylongprefixname' }) as unknown as TranslationService
      );
      getDbMock.mockReturnValue(
        createMockDb({ selectResults: [[{ id: 'uc_long' }], []] }).db as never
      );
      getUser.mockRejectedValueOnce(new RebeccaApiError(404, '/api/user/long', 'Not Found'));
      const longName = await longPrefixService.resolveCustomConfigName('a'.repeat(21));
      expect(longName.length).toBeLessThanOrEqual(32);
      expect(longName).toMatch(/_[a-z0-9]{3}$/u);

      // 5. Rejects invalid requested name before hitting DB/panel
      await expect(cfgService.resolveCustomConfigName('bad-name!')).rejects.toThrow(
        'INVALID_CUSTOM_SERVICE_NAME'
      );
    });
  });

  describe('4. User Usage Breakdown Infrastructure', () => {
    it('exposes getUserUsage on RebeccaService and getRemoteConfigUsage on ConfigService', async () => {
      const alertHook = vi.fn().mockResolvedValue(undefined);
      registerAdminAlertHook(alertHook);

      const expectedUsage = {
        username: 'alice',
        usages: [
          { node_id: 1, node_name: 'DE', used_traffic: 2 * GB },
          { node_id: 2, node_name: 'NL', used_traffic: 1 * GB },
        ],
      };
      const apiClient = {
        getUserUsage: vi.fn().mockResolvedValueOnce(expectedUsage),
        resetCircuitBreaker: vi.fn(),
        isCircuitOpen: vi.fn(() => false),
      } as unknown as RebeccaApiClient;

      const rebeccaService = new RebeccaService(apiClient, {
        panelId: `rp_usage_${Date.now()}`,
        panelName: 'Main',
      });
      const opts = { start: '2026-11-01T00:00:00Z', end: '2026-11-21T00:00:00Z' };
      await expect(rebeccaService.getUserUsage('alice', opts)).resolves.toEqual(expectedUsage);
      expect(apiClient.getUserUsage).toHaveBeenCalledWith('alice', opts);
      expect(apiClient.resetCircuitBreaker).toHaveBeenCalledTimes(1);

      // Outage alerts trigger on RebeccaOriginDownError
      const originDown = new RebeccaOriginDownError('/api/user/alice/usage', 521, 3, true);
      (apiClient.getUserUsage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originDown);
      await expect(rebeccaService.getUserUsage('alice')).rejects.toBe(originDown);
      await Promise.resolve();
      expect(alertHook).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'rebecca_origin_down',
          endpoint: 'GET /api/user/alice/usage',
        })
      );

      // ConfigService delegates cleanly by panelId + configUsername
      const panelService = {
        getUserUsage: vi.fn().mockResolvedValue(expectedUsage),
      };
      const panelRegistry = {
        getService: vi.fn(() => panelService),
        getEnabledPanelIds: vi.fn(() => ['rp_eu']),
        resolveTarget: vi.fn(),
      } as unknown as RebeccaPanelRegistry;
      const cfgService = new ConfigService(
        panelRegistry,
        makeSettingReader({}) as unknown as TranslationService
      );

      await expect(
        cfgService.getRemoteConfigUsage({ panelId: 'rp_eu', configUsername: 'alice' }, opts)
      ).resolves.toEqual(expectedUsage);
      expect(panelRegistry.getService).toHaveBeenCalledWith('rp_eu');
      expect(panelService.getUserUsage).toHaveBeenCalledWith('alice', opts);
    });
  });
});
