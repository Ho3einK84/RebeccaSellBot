import crypto from 'node:crypto';
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { vi } from 'vitest';
import type { Config } from '../../../src/infra/config.js';
import type { BotServices } from '../../../src/telegram/types.js';
import { PurchaseCheckoutUnavailableError } from '../../../src/domain/services/PurchaseCheckoutService.js';

export const TEST_BOT_TOKEN = '123456:test_token';
export const TEST_ADMIN_SESSION_SECRET = 'test_session_secret_at_least_32_characters_long!!';

export interface SignedInitDataOptions {
  userId?: number;
  fields?: Record<string, string>;
  botToken?: string;
  tamperHash?: boolean;
  authDate?: number;
}

/**
 * Generates Telegram WebApp initData query strings signed with HMAC-SHA256.
 */
export function createSignedInitData(options: SignedInitDataOptions = {}): string {
  const {
    userId = 55555,
    botToken = TEST_BOT_TOKEN,
    tamperHash = false,
    authDate = Math.floor(Date.now() / 1000),
  } = options;

  const fields: Record<string, string> = options.fields ?? {
    auth_date: String(authDate),
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const sortedKeys = Object.keys(fields).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${fields[k]}`).join('\n');

  let hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (tamperHash) {
    hash = hash.slice(0, -2) + (hash.endsWith('a') ? 'b' : 'a');
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, value);
  }
  params.set('hash', hash);
  return params.toString();
}

export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    BOT_TOKEN: TEST_BOT_TOKEN,
    ADMIN_IDS: [12345],
    DATABASE_URL: 'postgres://localhost/test',
    DATABASE_POOL_SIZE: 10,
    HEALTH_CHECK_PORT: 3001,
    DEFAULT_LOCALE: 'fa',
    INSTANCE_NAME: 'test',
    BOT_DELIVERY_MODE: 'polling',
    WEBHOOK_PORT: 3000,
    WEBHOOK_HOST: '0.0.0.0',
    WEBHOOK_PATH: '/webhook',
    REBECCA_SERVICE_ID: 1,
    REBECCA_ADMIN_USERNAME: 'admin',
    WEBAPP_URL: 'https://app.example.com',
    WEBAPP_PORT: 3002,
    WEBAPP_HOST: '0.0.0.0',
    ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
    ...overrides,
  } as unknown as Config;
}

/**
 * Creates an in-memory @fastify/rate-limit store whose route buckets can all be
 * cleared in O(1) between tests, allowing test suites to reuse one Fastify
 * instance per describe block without rate-limit leakage.
 */
export function createResettableRateLimitStore(): {
  Store: FastifyRateLimitStoreCtor;
  reset: () => void;
} {
  const buckets = new Set<Map<string, { current: number; iterationStartMs: number }>>();

  class ResettableRateLimitStore implements FastifyRateLimitStore {
    private readonly entries = new Map<string, { current: number; iterationStartMs: number }>();

    constructor() {
      buckets.add(this.entries);
    }

    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number
    ): void {
      const now = Date.now();
      let entry = this.entries.get(key);
      if (!entry || entry.iterationStartMs + timeWindow <= now) {
        entry = { current: 1, iterationStartMs: now };
      } else {
        entry.current += 1;
      }
      this.entries.set(key, entry);
      callback(null, {
        current: entry.current,
        ttl: timeWindow - (now - entry.iterationStartMs),
      });
    }

    read(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number
    ): void {
      const now = Date.now();
      const entry = this.entries.get(key);
      if (!entry || entry.iterationStartMs + timeWindow <= now) {
        callback(null, { current: 0, ttl: 0 });
        return;
      }
      callback(null, {
        current: entry.current,
        ttl: timeWindow - (now - entry.iterationStartMs),
      });
    }

    child(): FastifyRateLimitStore {
      return new ResettableRateLimitStore();
    }
  }

  return {
    Store: ResettableRateLimitStore,
    reset: () => {
      for (const bucket of buckets) {
        bucket.clear();
      }
    },
  };
}

export function createMockBaseServices(overrides: Partial<BotServices> = {}) {
  const mockAdminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => id === 12345),
  };

  const mockUserService = {
    findProfile: vi.fn(async (query: string) => {
      const telegramId = Number(query);
      if (telegramId === 55555 || telegramId === 1001 || telegramId === 1002) {
        return {
          id: `u-${telegramId}-uuid`,
          telegramId,
          username: `user_${telegramId}`,
          firstName: 'Test',
          lastName: null,
          balance: 75_000,
          reservedBalance: 0,
          referralCode: `ref_${telegramId}`,
          totalSpend: 0,
          activeSubscriptionCount: 0,
          transactionCount: 0,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      return null;
    }),
    exists: vi.fn(
      async (telegramId: number) =>
        telegramId === 55555 || telegramId === 1001 || telegramId === 1002
    ),
    isBanned: vi.fn(async () => false),
    getLocale: vi.fn(async (telegramId: number) => (telegramId === 55555 ? 'en' : undefined)),
    updateLocale: vi.fn(async () => {}),
  };

  const mockTranslationService = {
    get: vi.fn((key: string) => key),
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((_key: string, defaultValue?: string) => defaultValue),
    getSettingBool: vi.fn((key: string, defaultValue = false) => {
      if (key === 'language_selection_enabled') return true;
      if (key === 'webapp_enabled') return true;
      return defaultValue;
    }),
    getSettingNum: vi.fn((_key: string, defaultValue?: number) => defaultValue),
  };

  const mockServices = {
    adminService: mockAdminService,
    walletService: {},
    userService: mockUserService,
    configService: {},
    pricingService: {},
    packageCategoryService: {},
    paymentService: {},
    purchaseCheckoutService: {},
    promoService: {},
    referralService: {},
    trialService: {},
    translationService: mockTranslationService,
    panelRegistry: {},
    refundService: {},
    configTransferService: {},
    configReconciliationService: {},
    broadcastService: {},
    backupService: {},
    luckyWheelService: {},
    botUsername: 'RebeccaSellBot',
    ...overrides,
  } as unknown as BotServices;

  return {
    mockServices,
    mockAdminService,
    mockUserService,
    mockTranslationService,
  };
}

export function createMockAdminServices() {
  const mockAdminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => id === 12345),
  };

  const mockWalletService = {
    getDashboardStats: vi.fn(async () => ({
      totalUsers: 100,
      totalSales: 500_000,
      dailyRevenue: 50_000,
      weeklyRevenue: 200_000,
      monthlyRevenue: 400_000,
      totalReferralBonus: 10_000,
      totalCashback: 5_000,
      activeSubscriptions: 80,
      inactiveSubscriptions: 20,
      pendingReceipts: 2,
    })),
    listPendingTopupsPage: vi.fn(async (page = 1, _limit = 10) => ({
      items: [
        {
          id: 'rec_1001',
          telegramId: 55555,
          amount: 100_000,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page,
      totalPages: 1,
    })),
    approveTopup: vi.fn(async (id: string, _adminId: number) => {
      if (id === 'rec_1001') return { telegramId: 55555, amount: 100_000 };
      return null;
    }),
    rejectTopup: vi.fn(async (id: string, _adminId: number) => {
      if (id === 'rec_1001') return { telegramId: 55555 };
      return null;
    }),
    getPendingTopup: vi.fn(async (id: string) => {
      if (id === 'rec_1001')
        return { id: 'rec_1001', telegramId: 55555, photoFileId: 'file_abc', status: 'pending' };
      return undefined;
    }),
    getTopupById: vi.fn(async (id: string) => {
      if (id === 'rec_1001')
        return { id: 'rec_1001', telegramId: 55555, photoFileId: 'file_abc', status: 'pending' };
      if (id === 'rec_approved')
        return {
          id: 'rec_approved',
          telegramId: 55555,
          photoFileId: 'file_approved',
          status: 'approved',
        };
      return undefined;
    }),
    listTopupsPage: vi.fn(async (options?: any) => ({
      items: [
        {
          id: 'rec_1001',
          telegramId: 55555,
          amount: 100_000,
          status: options?.status === 'all' ? 'pending' : (options?.status ?? 'pending'),
          createdAt: new Date().toISOString(),
          user: {
            telegramId: 55555,
            username: 'testuser',
            firstName: 'User',
            lastName: null,
            balance: 50_000,
          },
        },
      ],
      total: 1,
      page: options?.page ?? 1,
      totalPages: 1,
      pendingCount: 1,
    })),
    batchApproveTopups: vi.fn(async (ids: string[], _adminId: number) => ({
      succeeded: ids,
      failed: [],
    })),
    adjustBalanceAdmin: vi.fn(async () => 150_000),
    getBalance: vi.fn(async () => 50_000),
  };

  const mockUserService = {
    listUsers: vi.fn(async (page = 1) => ({
      users: [
        {
          telegramId: 55555,
          username: 'testuser',
          firstName: 'User',
          lastName: null,
          balance: 50_000,
          totalSpend: 100_000,
          activeSubscriptionCount: 1,
          createdAt: new Date(),
        },
      ],
      total: 1,
      page,
      totalPages: 1,
    })),
    searchProfiles: vi.fn(async () => [
      {
        telegramId: 55555,
        username: 'testuser',
        firstName: 'User',
        lastName: null,
        balance: 50_000,
        totalSpend: 100_000,
        activeSubscriptionCount: 1,
        createdAt: new Date(),
      },
    ]),
    getUserReportSummary: vi.fn(async (telegramId: number) => {
      if (telegramId !== 55555) return null;
      return {
        user: {
          telegramId: 55555,
          username: 'testuser',
          firstName: 'User',
          lastName: null,
          balance: 50_000,
          totalSpend: 100_000,
          activeSubscriptionCount: 1,
          createdAt: new Date(),
        },
        totalDeposit: 150_000,
        totalSpend: 100_000,
        totalRefund: 0,
        totalCashback: 5_000,
        totalReferralBonus: 0,
        totalLuckyWheel: 0,
        totalTransactions: 3,
        activeConfigsCount: 1,
        totalConfigsCount: 1,
        totalOrdersCount: 1,
        receiptsApprovedCount: 1,
        receiptsRejectedCount: 0,
        receiptsPendingCount: 0,
        totalReceiptsCount: 1,
        auditEventsCount: 2,
      };
    }),
    listOrdersForUser: vi.fn(async () => ({ orders: [], total: 0, totalPages: 1, page: 1 })),
    listReceiptsForUser: vi.fn(async () => ({ receipts: [], total: 0, totalPages: 1, page: 1 })),
    listTransactionsForUser: vi.fn(async () => ({
      transactions: [],
      total: 0,
      totalPages: 1,
      page: 1,
    })),
    setBanned: vi.fn(async () => true),
    recordAdminAction: vi.fn(async () => {}),
    getLocale: vi.fn(async (telegramId: number) => (telegramId === 55555 ? 'en' : undefined)),
    updateLocale: vi.fn(async () => {}),
  };

  const mockConfigStore: Record<string, string> = {
    receipt_notify_enabled: 'true',
    receipt_notify_mode: 'full',
    receipt_notify_admins: '',
  };

  const mockTranslationService = {
    get: vi.fn((key: string) => key),
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((key: string, defaultValue?: string) => mockConfigStore[key] ?? defaultValue),
    getSettingBool: vi.fn((key: string, defaultValue = false) => {
      if (key in mockConfigStore) return mockConfigStore[key] === 'true';
      if (key === 'language_selection_enabled') return true;
      return defaultValue;
    }),
    updateSetting: vi.fn(async (key: string, value: string) => {
      mockConfigStore[key] = value;
    }),
    updateSettings: vi.fn(async () => {}),
  };

  const mockPricingService = {
    getPackages: vi.fn(() => [{ id: 'pkg_1' }]),
    getCustomVolumeTarget: vi.fn(() => ({ panelId: 'panel_1', serviceId: 1 })),
  };

  const mockPanelRegistry = {
    healthSummary: vi.fn(async () => ({ configured: 2, healthy: 2 })),
    getPanel: vi.fn((id: string) => ({
      id,
      name: id === 'panel_1' ? 'Main Germany Panel' : 'Secondary Panel',
      baseUrl: 'https://panel.example.com',
      enabled: true,
      isDefault: id === 'panel_1',
      credentialConfigured: true,
      credentialMode: 'api_key' as const,
      services: [{ serviceId: 1, name: 'V2Ray Service', isDefault: true }],
    })),
    listPanels: vi.fn(() => [
      {
        id: 'panel_1',
        name: 'Main Germany Panel',
        baseUrl: 'https://panel.example.com',
        enabled: true,
        isDefault: true,
        credentialConfigured: true,
        credentialMode: 'api_key' as const,
        services: [{ serviceId: 1, name: 'V2Ray Service', isDefault: true }],
      },
      {
        id: 'panel_2',
        name: 'Secondary Panel',
        baseUrl: 'https://panel2.example.com',
        enabled: true,
        isDefault: false,
        credentialConfigured: true,
        credentialMode: 'api_key' as const,
        services: [{ serviceId: 1, name: 'Primary Service', isDefault: true }],
      },
    ]),
    getPanelUsage: vi.fn(async () => ({ activeConfigsCount: 5 })),
    getService: vi.fn(() => ({ checkHealth: vi.fn(async () => true) })),
    testConnection: vi.fn(async () => ({ ok: true, latencyMs: 25 })),
    createPanel: vi.fn(
      async (input: {
        name: string;
        baseUrl: string;
        apiKey?: string;
        serviceId?: number;
        serviceName?: string;
      }) => ({
        id: 'panel_new',
        name: input.name,
        baseUrl: input.baseUrl,
        enabled: true,
        isDefault: false,
        credentialConfigured: Boolean(input.apiKey),
        credentialMode: input.apiKey ? ('api_key' as const) : ('none' as const),
        services: [
          {
            serviceId: input.serviceId || 1,
            name: input.serviceName || 'Default',
            isDefault: true,
          },
        ],
      })
    ),
    updatePanel: vi.fn(async () => {}),
    setPanelEnabled: vi.fn(async () => {}),
    setDefaultPanel: vi.fn(async () => {}),
    deletePanel: vi.fn(async () => {}),
    addService: vi.fn(async () => {}),
    setDefaultService: vi.fn(async () => {}),
    deleteService: vi.fn(async () => {}),
    resolveTarget: vi.fn(async () => ({ panelId: 'panel_1', serviceId: 1 })),
  };

  const mockConfigService = {
    listConfigsForOwner: vi.fn(async () => [
      {
        id: 'uc_101',
        panelId: 'panel_1',
        serviceId: 1,
        configUsername: 'cfg_test',
        subUrl: 'https://sub.example.com/token',
        panelStatus: 'active',
        panelDataLimit: 50 * 1024 * 1024 * 1024,
        panelUsedTraffic: 10 * 1024 * 1024 * 1024,
        panelExpire: Math.floor(Date.now() / 1000) + 86400 * 30,
        autoRenewEnabled: false,
        isClaimed: true,
        createdAt: new Date(),
      },
    ]),
    isOwnedBy: vi.fn(async () => true),
    toggleConfig: vi.fn(async () => 'disabled'),
    resetUsage: vi.fn(async () => {}),
    revokeSubscription: vi.fn(async () => 'https://sub.example.com/new-token'),
    getOwnedConfigByUsername: vi.fn(async () => ({
      id: 'uc_101',
      panelId: 'panel_1',
      configUsername: 'cfg_test',
    })),
    getRemoteConfigDetail: vi.fn(async () => ({
      username: 'cfg_test',
      status: 'active',
      data_limit: 50 * 1024 * 1024 * 1024,
      used_traffic: 10 * 1024 * 1024 * 1024,
      expire: Math.floor(Date.now() / 1000) + 86400 * 30,
    })),
  };

  const mockConfigurationService = {
    get: vi.fn(async (key: string) => mockConfigStore[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      mockConfigStore[key] = value;
    }),
  };

  const mockServices = {
    botToken: TEST_BOT_TOKEN,
    adminService: mockAdminService,
    walletService: mockWalletService,
    userService: mockUserService,
    configService: mockConfigService,
    configurationService: mockConfigurationService,
    pricingService: mockPricingService,
    translationService: mockTranslationService,
    panelRegistry: mockPanelRegistry,
  } as unknown as BotServices;

  return {
    mockServices,
    mockAdminService,
    mockWalletService,
    mockUserService,
    mockConfigService,
    mockConfigurationService,
    mockPricingService,
    mockTranslationService,
    mockPanelRegistry,
    mockConfigStore,
  };
}

export function createMockUserServices() {
  const mockAdminService = {
    adminIds: [12345],
    isAdmin: vi.fn((id: number) => id === 12345),
  };

  const mockWalletService = {
    getOrCreateUser: vi.fn(async (telegramId: number) => ({
      telegramId,
      username: 'sample_user',
      balance: 100_000,
      reservedBalance: 0,
      referralCode: 'ref_123',
    })),
    listTransactionsForUser: vi.fn(async (telegramId: number, page = 1, _pageSize = 10) => ({
      transactions: [
        {
          id: 'tx_101',
          telegramId,
          amount: 50_000,
          balanceAfter: 150_000,
          type: 'topup',
          description: 'شارژ کیف پول',
          createdAt: new Date('2026-03-01T12:00:00Z'),
        },
      ],
      total: 1,
      totalPages: 1,
      page,
    })),
    executePurchaseSaga: vi.fn(
      async (params: { telegramId: number; amount: number; configUsername: string }) => ({
        success: true,
        configUsername: params.configUsername,
        subUrl: 'https://sub.example.com/token123',
      })
    ),
    getPendingReceiptForUser: vi.fn(async (_telegramId: number) => null as any),
  };

  const mockUserService = {
    findProfile: vi.fn(async (query: string) => {
      const parsedId = Number(query);
      if (parsedId === 55555) {
        return {
          id: 'u-55555-uuid',
          telegramId: 55555,
          username: 'test_user',
          firstName: 'Ali',
          lastName: 'Reza',
          balance: 75_000,
          reservedBalance: 10_000,
          referralCode: 'ref_55555',
          totalSpend: 250_000,
          activeSubscriptionCount: 2,
          transactionCount: 5,
          referredUserCount: 3,
          referralBonusEarned: 15_000,
          cashbackEarned: 5_000,
          hasUsedTrial: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      if (parsedId === 66666) {
        return {
          id: 'u-66666-uuid',
          telegramId: 66666,
          username: 'rich_user',
          firstName: 'Rich',
          lastName: 'User',
          balance: 500_000,
          reservedBalance: 0,
          referralCode: 'ref_66666',
          totalSpend: 1_000_000,
          activeSubscriptionCount: 5,
          transactionCount: 10,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      if (parsedId === 99999) {
        return {
          id: 'u-99999-uuid',
          telegramId: 99999,
          username: 'banned_user',
          firstName: 'Banned',
          lastName: 'User',
          balance: 100_000,
          reservedBalance: 0,
          referralCode: 'ref_99999',
          totalSpend: 0,
          activeSubscriptionCount: 0,
          transactionCount: 0,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }
      return null;
    }),
    exists: vi.fn(
      async (telegramId: number) =>
        telegramId === 55555 || telegramId === 66666 || telegramId === 99999
    ),
    isBanned: vi.fn(async (telegramId: number) => telegramId === 99999),
    getLocale: vi.fn(async () => 'fa' as const),
    updateLocale: vi.fn(async () => {}),
  };

  const mockConfigService = {
    listConfigsForOwner: vi.fn(async (telegramId: number) => {
      if (telegramId === 55555) {
        return [
          {
            id: 'cfg_1',
            telegramId: 55555,
            configUsername: 'u55555_srv1',
            userLabel: null as string | null,
            subUrl: 'https://sub.example.com/token123',
            panelStatus: 'active',
            panelDataLimit: 50 * 1024 * 1024 * 1024,
            panelUsedTraffic: 12 * 1024 * 1024 * 1024,
            panelExpire: Math.floor(Date.now() / 1000) + 86400 * 20,
            autoRenewEnabled: true,
            createdAt: new Date('2026-02-01T10:00:00Z'),
            updatedAt: new Date('2026-02-01T10:00:00Z'),
          },
        ];
      }
      return [];
    }),
    generateConfigName: vi.fn(async (telegramId: number) => `u${telegramId}_auto1`),
    getOwnedConfigById: vi.fn(async (telegramId: number, configId: string) => {
      if (telegramId === 55555 && configId === 'cfg_1') {
        return {
          id: 'cfg_1',
          telegramId: 55555,
          configUsername: 'u55555_srv1',
          userLabel: null as string | null,
          panelId: 'panel_1',
          serviceId: 1,
          subUrl: 'https://sub.example.com/token123',
          panelStatus: 'active',
          panelDataLimit: 50 * 1024 * 1024 * 1024,
          panelUsedTraffic: 12 * 1024 * 1024 * 1024,
          panelExpire: Math.floor(Date.now() / 1000) + 86400 * 20,
          autoRenewEnabled: true,
          autoRenewPackageId: 'pkg_30gb_30d',
          autoRenewPrice: 120_000,
          createdAt: new Date('2026-02-01T10:00:00Z'),
          updatedAt: new Date('2026-02-01T10:00:00Z'),
        };
      }
      return undefined;
    }),
    getConfigById: vi.fn(async (configId: string) => {
      if (configId === 'cfg_1') {
        return {
          id: 'cfg_1',
          telegramId: 55555,
          configUsername: 'u55555_srv1',
          userLabel: null as string | null,
          panelId: 'panel_1',
          serviceId: 1,
          subUrl: 'https://sub.example.com/token123',
          panelStatus: 'active',
          panelDataLimit: 50 * 1024 * 1024 * 1024,
          panelUsedTraffic: 12 * 1024 * 1024 * 1024,
          panelExpire: Math.floor(Date.now() / 1000) + 86400 * 20,
          autoRenewEnabled: true,
          autoRenewPackageId: 'pkg_30gb_30d',
          autoRenewPrice: 120_000,
          createdAt: new Date('2026-02-01T10:00:00Z'),
          updatedAt: new Date('2026-02-01T10:00:00Z'),
        };
      }
      if (configId === 'cfg_other_user') {
        return {
          id: 'cfg_other_user',
          telegramId: 77777,
          configUsername: 'u77777_srv1',
          panelId: 'panel_1',
          serviceId: 1,
          subUrl: 'https://sub.example.com/token777',
          panelStatus: 'active',
        };
      }
      return undefined;
    }),
    setAutoRenew: vi.fn(async () => ({})),
    setUserLabel: vi.fn(async (_telegramId: number, configId: string, label: string | null) =>
      configId === 'cfg_1' ? { id: 'cfg_1', configUsername: 'u55555_srv1', userLabel: label } : null
    ),
    toggleConfig: vi.fn(async () => 'disabled'),
    enableConfig: vi.fn(async () => {}),
    disableConfig: vi.fn(async () => {}),
    revokeSubscription: vi.fn(async () => 'https://sub.example.com/token_new'),
    refreshConfig: vi.fn(async () => ({
      panelStatus: 'active',
      panelDataLimit: 50 * 1024 * 1024 * 1024,
      panelUsedTraffic: 15 * 1024 * 1024 * 1024,
      panelExpire: 1800000000,
      lastSyncedAt: new Date('2026-03-01T12:00:00Z'),
    })),
  };

  const mockPricingService = {
    getPackages: vi.fn((_panelId, _serviceId, includeDisabled = false) => {
      const pkgs = [
        {
          id: 'pkg_30gb_30d',
          name: '30 GB - 30 Days',
          gbAmount: 30,
          durationDays: 30,
          price: 120_000,
          enabled: true,
        },
        {
          id: 'pkg_10gb_10d',
          name: '10 GB - 10 Days',
          gbAmount: 10,
          durationDays: 10,
          price: 40_000,
          enabled: true,
        },
        {
          id: 'pkg_disabled',
          name: 'Disabled Pkg',
          gbAmount: 10,
          durationDays: 10,
          price: 50_000,
          enabled: false,
        },
      ];
      return includeDisabled ? pkgs : pkgs.filter((p) => p.enabled !== false);
    }),
    getPackageById: vi.fn((id: string | null | undefined) => {
      if (id === 'pkg_30gb_30d') {
        return {
          id: 'pkg_30gb_30d',
          name: '30 GB - 30 Days',
          gbAmount: 30,
          durationDays: 30,
          price: 120_000,
          enabled: true,
        };
      }
      if (id === 'pkg_10gb_10d') {
        return {
          id: 'pkg_10gb_10d',
          name: '10 GB - 10 Days',
          gbAmount: 10,
          durationDays: 10,
          price: 40_000,
          enabled: true,
        };
      }
      if (id === 'pkg_disabled') {
        return {
          id: 'pkg_disabled',
          name: 'Disabled Pkg',
          gbAmount: 10,
          durationDays: 10,
          price: 50_000,
          enabled: false,
        };
      }
      return undefined;
    }),
    getCustomPriceQuote: vi.fn((gb: number, _days: number) => ({
      totalPrice: gb * 5000,
      volumePrice: gb * 5000,
      durationPrice: 0,
      pricePerGb: 5000,
      pricePerDay: 0,
    })),
    getCustomVolumeTarget: vi.fn(() => ({ panelId: 'panel_test', serviceId: 1 })),
  };

  const mockPurchaseCheckoutService = {
    create: vi.fn(
      async (input: {
        telegramId: number;
        kind: string;
        pkg: {
          id: string;
          name: string;
          gbAmount: number;
          durationDays: number;
          price: number;
        };
        panelId?: string;
        serviceId?: number;
        quotedAmount?: number;
      }) => ({
        id: 'co_test_123',
        telegramId: input.telegramId,
        kind: input.kind,
        configId: null,
        packageId: input.pkg.id,
        packageName: input.pkg.name,
        panelId: input.panelId ?? 'panel_test',
        serviceId: input.serviceId ?? 1,
        amount: input.pkg.price,
        quotedAmount: input.quotedAmount ?? input.pkg.price,
        gbAmount: input.pkg.gbAmount,
        durationDays: input.pkg.durationDays,
        promoCode: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        claimedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ),
    claim: vi.fn(async (checkoutId: string, telegramId: number) => {
      if (checkoutId === 'co_missing') {
        throw new PurchaseCheckoutUnavailableError('missing');
      }
      if (checkoutId === 'co_expired') {
        throw new PurchaseCheckoutUnavailableError('expired');
      }
      if (checkoutId === 'co_consumed') {
        throw new PurchaseCheckoutUnavailableError('consumed');
      }
      if (checkoutId === 'co_other_user') {
        throw new PurchaseCheckoutUnavailableError('owner_mismatch');
      }
      return {
        id: checkoutId,
        telegramId,
        kind: 'new_config',
        configId: null,
        packageId: 'pkg_10gb_10d',
        packageName: '10 GB - 10 Days',
        panelId: 'panel_test',
        serviceId: 1,
        amount: 40_000,
        quotedAmount: 40_000,
        gbAmount: 10,
        durationDays: 10,
        promoCode: null,
        status: 'processing',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        claimedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };

  const mockTranslationService = {
    get: vi.fn((key: string) => key),
    getDefaultLocale: vi.fn(() => 'fa' as const),
    getSetting: vi.fn((key: string, defaultValue?: string) => {
      if (key === 'currency') return 'تومان';
      if (key === 'card_number') return '6037997911112222';
      if (key === 'card_holder') return 'حسین کمالی';
      if (key === 'support_destination') return '@RebeccaSupport';
      if (key === 'custom_volume_enabled') return 'true';
      return defaultValue;
    }),
    getSettingBool: vi.fn((key: string, defaultValue = true) => {
      if (key === 'support_enabled') return true;
      return defaultValue;
    }),
    getSettingNum: vi.fn((key: string, defaultValue?: number) => {
      if (key === 'custom_min_gb') return 5;
      if (key === 'custom_max_gb') return 500;
      if (key === 'custom_default_days') return 30;
      if (key === 'price_per_gb') return 5000;
      if (key === 'price_per_day') return 0;
      if (key === 'topup_min_amount') return 10_000;
      if (key === 'topup_max_amount') return 10_000_000;
      return defaultValue;
    }),
  };

  const mockPanelRegistry = {
    healthSummary: vi.fn(async () => ({ configured: 1, healthy: 1 })),
  };

  const mockServices = {
    botToken: TEST_BOT_TOKEN,
    adminService: mockAdminService,
    walletService: mockWalletService,
    userService: mockUserService,
    configService: mockConfigService,
    pricingService: mockPricingService,
    translationService: mockTranslationService,
    purchaseCheckoutService: mockPurchaseCheckoutService,
    panelRegistry: mockPanelRegistry,
    botUsername: 'RebeccaSellBot',
  } as unknown as BotServices;

  return {
    mockServices,
    mockAdminService,
    mockWalletService,
    mockUserService,
    mockConfigService,
    mockPricingService,
    mockPurchaseCheckoutService,
    mockTranslationService,
    mockPanelRegistry,
  };
}
