import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import {
  RebeccaOriginDownError,
  type RebeccaService,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { PricingService } from '../../src/domain/services/PricingService.js';
import type { WalletService } from '../../src/domain/services/WalletService.js';

const hoistedMocks = vi.hoisted(() => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('node-cron', () => ({
  default: { schedule: hoistedMocks.schedule },
}));

import {
  assessNotificationConditions,
  positiveFinite,
  runNotifierSweep,
  startNotifierCron,
  stopNotifierCron,
  type ConfigNotificationRecipient,
  type NotificationDeliveryStore,
  type NotificationType,
} from '../../src/jobs/notifier.js';
import {
  runAutoRenewalSweep,
  startAutoRenewalCron,
  stopAutoRenewalCron,
  type AutoRenewalCandidate,
  type AutoRenewalCandidateStore,
} from '../../src/jobs/autoRenewal.js';

const NOW = new Date('2026-08-15T12:00:00Z');
const DAY = 86_400;
const GB = 1024 ** 3;

function makeRemoteUser(username: string, overrides: Record<string, unknown> = {}) {
  return {
    username,
    proxies: {},
    expire: Math.floor(NOW.getTime() / 1000) + 10 * DAY,
    data_limit: 20 * GB,
    data_limit_reset_strategy: 'no_reset',
    inbounds: {},
    status: 'active' as const,
    used_traffic: 0,
    lifetime_used_traffic: 0,
    created_at: '2026-01-01T00:00:00Z',
    links: [],
    subscription_url: `https://panel.example.com/sub/${username}`,
    subscription_urls: {},
    ...overrides,
  };
}

function makeRecipient(
  overrides: Partial<ConfigNotificationRecipient> = {}
): ConfigNotificationRecipient {
  return {
    configId: 'cfg_1',
    panelId: 'legacy',
    serviceId: 1,
    configUsername: 'cfg_user_1',
    telegramId: 1001,
    locale: 'en',
    autoRenewEnabled: false,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<AutoRenewalCandidate> = {}): AutoRenewalCandidate {
  return {
    ...makeRecipient({ autoRenewEnabled: true }),
    autoRenewPackageId: 'pkg_1',
    autoRenewPrice: 50_000,
    ...overrides,
  };
}

function makeMemoryDeliveryStore(initialConfigs: ConfigNotificationRecipient[] = []) {
  const active = new Set<string>();
  const releasedNows: Date[] = [];

  const store: NotificationDeliveryStore = {
    listConfigs: vi.fn(async () => initialConfigs),
    reserve: vi.fn(async (recipient, type) => {
      const key = `${recipient.configId}:${type}`;
      if (active.has(key)) return false;
      active.add(key);
      return true;
    }),
    deactivate: vi.fn(async (recipient, type) => {
      active.delete(`${recipient.configId}:${type}`);
    }),
    release: vi.fn(async (recipient, types, releaseNow) => {
      for (const type of types) {
        active.delete(`${recipient.configId}:${type}`);
      }
      releasedNows.push(releaseNow);
    }),
  };

  return { store, active, releasedNows };
}

function makeTranslationService(settings: Record<string, number> = {}) {
  return {
    getSettingNum: vi.fn((key: string, fallback: number) => settings[key] ?? fallback),
    get: vi.fn((key: string, locale: string) => `${locale}:${key}`),
    resolveLocale: vi.fn((raw?: string) => (raw === 'en' ? 'en' : 'fa')),
  } as unknown as TranslationService;
}

describe('notifier — thresholds, dedupe, deterministic release time, and locale handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopNotifierCron();
  });

  it('validates positiveFinite helper and strict notification threshold boundaries', () => {
    expect(positiveFinite(5)).toBe(5);
    expect(positiveFinite(0)).toBe(0);
    expect(positiveFinite(-2)).toBe(0);
    expect(positiveFinite(Number.NaN)).toBe(0);
    expect(positiveFinite(Number.POSITIVE_INFINITY)).toBe(0);

    const exactTrafficThreshold = makeRemoteUser('u1', {
      data_limit: 10 * GB,
      used_traffic: 8 * GB,
    });
    expect(
      assessNotificationConditions(exactTrafficThreshold, {
        thresholdGb: 2,
        expiryWarningDays: 3,
        now: NOW,
      }).lowTraffic
    ).toBe(false);

    const belowTrafficThreshold = makeRemoteUser('u2', {
      data_limit: 10 * GB,
      used_traffic: 8 * GB + 1024,
    });
    expect(
      assessNotificationConditions(belowTrafficThreshold, {
        thresholdGb: 2,
        expiryWarningDays: 3,
        now: NOW,
      }).lowTraffic
    ).toBe(true);

    const expiredUser = makeRemoteUser('u3', {
      expire: Math.floor(NOW.getTime() / 1000) - 60,
    });
    expect(
      assessNotificationConditions(expiredUser, {
        thresholdGb: 2,
        expiryWarningDays: 3,
        now: NOW,
      }).nearExpiry
    ).toBe(false);
  });

  it('sends fresh near-expiry notice when low-traffic is already deduped and blocks hourly repeats when all deduped', async () => {
    const recipient = makeRecipient({ locale: 'fa' });
    const { store, active } = makeMemoryDeliveryStore([recipient]);
    active.add(`${recipient.configId}:low_traffic`);

    const rebecca = {
      getUser: vi.fn(async () =>
        makeRemoteUser(recipient.configUsername, {
          used_traffic: 19 * GB,
          expire: Math.floor(NOW.getTime() / 1000) + 2 * DAY,
        })
      ),
    } as unknown as RebeccaService;
    const telegramApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;
    const ts = makeTranslationService({ low_traffic_threshold_gb: 2, expiry_warning_days: 3 });

    await runNotifierSweep(rebecca, ts, telegramApi, store, NOW);
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramApi.sendMessage).toHaveBeenCalledWith(
      recipient.telegramId,
      expect.stringContaining('fa:renewal\\_reason\\_near\\_expiry'),
      expect.any(Object)
    );

    // 2nd sweep: both reasons deduped -> zero messages sent
    await runNotifierSweep(rebecca, ts, telegramApi, store, NOW);
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('releases ONLY newly reserved failed notification reason using sweep timestamp `now`', async () => {
    const recipient = makeRecipient();
    const { store, active, releasedNows } = makeMemoryDeliveryStore([recipient]);
    active.add(`${recipient.configId}:low_traffic`);
    const rebecca = {
      getUser: vi.fn(async () =>
        makeRemoteUser(recipient.configUsername, {
          used_traffic: 19 * GB,
          expire: Math.floor(NOW.getTime() / 1000) + DAY,
        })
      ),
    } as unknown as RebeccaService;
    const telegramApi = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('Telegram network timeout'))
        .mockResolvedValueOnce({ message_id: 2 }),
    } as unknown as Api;

    await runNotifierSweep(rebecca, makeTranslationService(), telegramApi, store, NOW);
    expect(active.has(`${recipient.configId}:low_traffic`)).toBe(true);
    expect(active.has(`${recipient.configId}:near_expiry`)).toBe(false);
    expect(releasedNows).toEqual([NOW]);

    // Retry succeeds on subsequent sweep because near_expiry lock was released
    await runNotifierSweep(rebecca, makeTranslationService(), telegramApi, store, NOW);
    expect(active.has(`${recipient.configId}:near_expiry`)).toBe(true);
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('handles deliveryStore.listConfigs failure gracefully, isolates per-panel outages, and schedules hourly cron', async () => {
    const failingStore: NotificationDeliveryStore = {
      listConfigs: vi.fn(async () => {
        throw new Error('pg timeout');
      }),
      reserve: vi.fn(async () => true),
      deactivate: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const rebecca = { getUser: vi.fn() } as unknown as RebeccaService;
    const telegramApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;

    await expect(
      runNotifierSweep(rebecca, makeTranslationService(), telegramApi, failingStore, NOW)
    ).resolves.toBeUndefined();
    expect(rebecca.getUser).not.toHaveBeenCalled();

    const r1 = makeRecipient({ configId: 'c_down_1', configUsername: 'down_1', panelId: 'p_down' });
    const r2 = makeRecipient({ configId: 'c_down_2', configUsername: 'down_2', panelId: 'p_down' });
    const rOk = makeRecipient({ configId: 'c_ok', configUsername: 'ok_u', panelId: 'p_ok' });
    const { store } = makeMemoryDeliveryStore([r1, r2, rOk]);
    const downService = {
      getUser: vi.fn(async () => {
        throw new RebeccaOriginDownError('/api/user/down', 521, 3, true);
      }),
    } as unknown as RebeccaService;
    const okService = {
      getUser: vi.fn(async (name: string) => makeRemoteUser(name, { used_traffic: 19 * GB })),
    } as unknown as RebeccaService;
    const registry = {
      getService: vi.fn((panelId?: string) => (panelId === 'p_down' ? downService : okService)),
    } as unknown as RebeccaPanelRegistry;

    await runNotifierSweep(registry, makeTranslationService(), telegramApi, store, NOW);
    expect(downService.getUser).toHaveBeenCalledTimes(1);
    expect(okService.getUser).toHaveBeenCalledWith('ok_u');
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);

    startNotifierCron(registry, makeTranslationService(), telegramApi);
    expect(hoistedMocks.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });
});

describe('autoRenewal — eligible statuses, price ceiling fail-closed, unconditional disable, and panel isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopAutoRenewalCron();
  });

  it('renews both active near-threshold and already expired/limited configs when price is at or below ceiling', async () => {
    const candidates = [
      makeCandidate({
        configId: 'cfg_due',
        configUsername: 'due_u',
        autoRenewPrice: 60_000,
      }),
      makeCandidate({
        configId: 'cfg_exp',
        configUsername: 'exp_u',
        autoRenewPrice: 60_000,
      }),
    ];
    const candidateStore: AutoRenewalCandidateStore = {
      listEnabledConfigs: vi.fn(async () => candidates),
      disableAutoRenew: vi.fn(async () => undefined),
    };
    const { store } = makeMemoryDeliveryStore();
    const rebecca = {
      getUser: vi.fn(async (name: string) =>
        name === 'due_u'
          ? makeRemoteUser(name, { used_traffic: 19 * GB })
          : makeRemoteUser(name, {
              status: 'expired',
              expire: Math.floor(NOW.getTime() / 1000) - 3600,
            })
      ),
    } as unknown as RebeccaService;
    const pricingService = {
      getPackageById: vi.fn(() => ({
        id: 'pkg_1',
        name: '40 GB - 30d',
        panelId: 'legacy',
        serviceId: 1,
        enabled: true,
        price: 50_000, // Decreased below ceiling 60_000 -> charge lower price
        gbAmount: 40,
        durationDays: 30,
      })),
    } as unknown as PricingService;
    const walletService = {
      getBalance: vi.fn(async () => 200_000),
      executePurchaseSaga: vi.fn(async () => ({ intentId: 'pi_1' })),
    } as unknown as WalletService;
    const telegramApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;

    const summary = await runAutoRenewalSweep(
      rebecca,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi,
      candidateStore,
      store,
      NOW
    );

    expect(summary).toEqual({ checked: 2, renewed: 2, skipped: 0 });
    expect(walletService.executePurchaseSaga).toHaveBeenCalledWith({
      telegramId: 1001,
      amount: 50_000,
      type: 'renew_config',
      configUsername: 'due_u',
      gbAmount: 40,
      durationDays: 30,
      panelId: 'legacy',
      serviceId: 1,
      packageId: 'pkg_1',
    });
  });

  it('deduplicates low_balance notices across sweeps and releases on send failure with deterministic `now`', async () => {
    const candidate = makeCandidate();
    const candidateStore: AutoRenewalCandidateStore = {
      listEnabledConfigs: vi.fn(async () => [candidate]),
    };
    const { store, releasedNows } = makeMemoryDeliveryStore();
    const rebecca = {
      getUser: vi.fn(async () =>
        makeRemoteUser(candidate.configUsername, { used_traffic: 19 * GB })
      ),
    } as unknown as RebeccaService;
    const pricingService = {
      getPackages: vi.fn(() => [
        {
          id: 'pkg_1',
          name: '20 GB',
          panelId: 'legacy',
          serviceId: 1,
          enabled: true,
          price: 50_000,
          gbAmount: 20,
          durationDays: 30,
        },
      ]),
    } as unknown as PricingService;
    const walletService = {
      getBalance: vi.fn(async () => 10_000),
      executePurchaseSaga: vi.fn(),
    } as unknown as WalletService;
    const telegramApi = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('send failed'))
        .mockResolvedValue({ message_id: 2 }),
    } as unknown as Api;

    // 1st sweep send fails -> releases lock with NOW so 2nd sweep retries and dedupes on 3rd
    await runAutoRenewalSweep(
      rebecca,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi,
      candidateStore,
      store,
      NOW
    );
    expect(releasedNows).toEqual([NOW]);
    expect(walletService.executePurchaseSaga).not.toHaveBeenCalled();

    await runAutoRenewalSweep(
      rebecca,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi,
      candidateStore,
      store,
      NOW
    );
    await runAutoRenewalSweep(
      rebecca,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi,
      candidateStore,
      store,
      NOW
    );
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('unconditionally calls disableAutoRenew when package is missing/disabled/wrong-panel/null-ceiling/price-increased even if notice already reserved', async () => {
    const scenarios: Array<{
      name: string;
      candidate: AutoRenewalCandidate;
      pkg: unknown;
      expectedNotice: NotificationType;
    }> = [
      {
        name: 'missing',
        candidate: makeCandidate({ configId: 'c1' }),
        pkg: undefined,
        expectedNotice: 'auto_renew_package_missing',
      },
      {
        name: 'disabled',
        candidate: makeCandidate({ configId: 'c2' }),
        pkg: {
          id: 'pkg_1',
          name: 'P',
          panelId: 'legacy',
          serviceId: 1,
          enabled: false,
          price: 50_000,
          gbAmount: 10,
          durationDays: 30,
        },
        expectedNotice: 'auto_renew_package_missing',
      },
      {
        name: 'wrong panel',
        candidate: makeCandidate({ configId: 'c3', panelId: 'panel_a' }),
        pkg: {
          id: 'pkg_1',
          name: 'P',
          panelId: 'panel_b',
          serviceId: 1,
          enabled: true,
          price: 50_000,
          gbAmount: 10,
          durationDays: 30,
        },
        expectedNotice: 'auto_renew_package_missing',
      },
      {
        name: 'price increased',
        candidate: makeCandidate({ configId: 'c4', autoRenewPrice: 50_000 }),
        pkg: {
          id: 'pkg_1',
          name: 'P',
          panelId: 'legacy',
          serviceId: 1,
          enabled: true,
          price: 75_000,
          gbAmount: 10,
          durationDays: 30,
        },
        expectedNotice: 'auto_renew_package_missing',
      },
      {
        name: 'null ceiling fail-closed',
        candidate: makeCandidate({ configId: 'c5', autoRenewPrice: null }),
        pkg: {
          id: 'pkg_1',
          name: 'P',
          panelId: 'legacy',
          serviceId: 1,
          enabled: true,
          price: 50_000,
          gbAmount: 10,
          durationDays: 30,
        },
        expectedNotice: 'auto_renew_package_missing',
      },
    ];

    for (const s of scenarios) {
      const { store, active } = makeMemoryDeliveryStore();
      // Pre-mark dedupe reservation to verify disableAutoRenew STILL runs!
      active.add(`${s.candidate.configId}:${s.expectedNotice}`);

      const candidateStore: AutoRenewalCandidateStore = {
        listEnabledConfigs: vi.fn(async () => [s.candidate]),
        disableAutoRenew: vi.fn(async () => undefined),
      };
      const rebecca = {
        getUser: vi.fn(async () =>
          makeRemoteUser(s.candidate.configUsername, { used_traffic: 19 * GB })
        ),
      } as unknown as RebeccaService;
      const pricingService = { getPackageById: vi.fn(() => s.pkg) } as unknown as PricingService;
      const walletService = {
        getBalance: vi.fn(),
        executePurchaseSaga: vi.fn(),
      } as unknown as WalletService;
      const telegramApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;

      const summary = await runAutoRenewalSweep(
        rebecca,
        walletService,
        pricingService,
        makeTranslationService(),
        telegramApi,
        candidateStore,
        store,
        NOW
      );

      expect(summary.skipped, s.name).toBe(1);
      expect(walletService.executePurchaseSaga, s.name).not.toHaveBeenCalled();
      expect(candidateStore.disableAutoRenew, s.name).toHaveBeenCalledTimes(1);
      expect(telegramApi.sendMessage, s.name).not.toHaveBeenCalled();
    }
  });

  it('skips non-due/deleted configs and isolates per-config and per-panel errors across healthy panels', async () => {
    const candidates = [
      makeCandidate({ configId: 'c_not_due', configUsername: 'not_due', panelId: 'p_ok' }),
      makeCandidate({ configId: 'c_deleted', configUsername: 'deleted_u', panelId: 'p_ok' }),
      makeCandidate({ configId: 'c_down_1', configUsername: 'down_1', panelId: 'p_down' }),
      makeCandidate({ configId: 'c_down_2', configUsername: 'down_2', panelId: 'p_down' }),
      makeCandidate({ configId: 'c_throw', configUsername: 'throw_u', panelId: 'p_ok' }),
      makeCandidate({ configId: 'c_heal', configUsername: 'heal_u', panelId: 'p_ok' }),
    ];
    const okService = {
      getUser: vi.fn(async (name: string) => {
        if (name === 'throw_u') throw new Error('unexpected parse boom');
        if (name === 'deleted_u')
          return makeRemoteUser(name, { status: 'deleted', used_traffic: 19 * GB });
        if (name === 'not_due') return makeRemoteUser(name, { used_traffic: 1 * GB });
        return makeRemoteUser(name, { used_traffic: 19 * GB });
      }),
    } as unknown as RebeccaService;
    const downService = {
      getUser: vi.fn(async () => {
        throw new RebeccaOriginDownError('/api/user/down', 521, 3, true);
      }),
    } as unknown as RebeccaService;

    const registry = {
      getService: vi.fn((panelId?: string) => (panelId === 'p_down' ? downService : okService)),
    } as unknown as RebeccaPanelRegistry;
    const pricingService = {
      getPackageById: vi.fn(() => ({
        id: 'pkg_1',
        name: '20 GB',
        panelId: 'p_ok',
        serviceId: 1,
        enabled: true,
        price: 50_000,
        gbAmount: 20,
        durationDays: 30,
      })),
    } as unknown as PricingService;
    const walletService = {
      getBalance: vi.fn(async () => 200_000),
      executePurchaseSaga: vi.fn(async () => ({ intentId: 'pi_heal' })),
    } as unknown as WalletService;
    const telegramApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;

    const summary = await runAutoRenewalSweep(
      registry,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi,
      { listEnabledConfigs: vi.fn(async () => candidates) },
      makeMemoryDeliveryStore().store,
      NOW
    );

    expect(summary).toEqual({ checked: 6, renewed: 1, skipped: 5 });
    // Second config on down panel skipped without redundant network call
    expect(downService.getUser).toHaveBeenCalledTimes(1);

    startAutoRenewalCron(
      registry,
      walletService,
      pricingService,
      makeTranslationService(),
      telegramApi
    );
    expect(hoistedMocks.schedule).toHaveBeenCalledTimes(1);
    expect(hoistedMocks.schedule).toHaveBeenCalledWith('20 * * * *', expect.any(Function));
  });
});
