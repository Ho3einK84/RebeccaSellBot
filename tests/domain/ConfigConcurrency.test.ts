import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../src/domain/services/ConfigService.js';
import { ConfigTransferService } from '../../src/domain/services/ConfigTransferService.js';
import { RefundService } from '../../src/domain/services/RefundService.js';
import { WalletPurchaseSaga } from '../../src/domain/services/WalletPurchaseSaga.js';
import { getDb, getPool } from '../../src/infra/db.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('Config Mutation Concurrency & Advisory Locking — Goal 1', () => {
  const getPoolMock = vi.mocked(getPool);
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects concurrent Transfer while Config mutation lock is held by another operation', async () => {
    // Simulate advisory lock being held by another session
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    const mockRebecca = {
      getUser: vi.fn().mockResolvedValue({
        username: 'alice_conc',
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
      }),
    } as unknown as RebeccaService;

    const mockPanels = {
      resolveTarget: vi
        .fn()
        .mockResolvedValue({ panelId: 'legacy', serviceId: 1, service: mockRebecca }),
      getService: vi.fn().mockReturnValue(mockRebecca),
      listRegisteredPanels: vi.fn().mockReturnValue([{ id: 'legacy' }]),
      hasMultiplePanels: vi.fn().mockReturnValue(false),
    } as unknown as RebeccaPanelRegistry;

    const transferService = new ConfigTransferService(mockPanels);

    const targetUser = { telegramId: 2002, isBanned: false };
    const localConfig = {
      id: 'uc_alice',
      telegramId: 1001,
      panelId: 'legacy',
      configUsername: 'alice_conc',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };

    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn().mockResolvedValueOnce([targetUser]).mockResolvedValueOnce([localConfig]),
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => query),
    } as never);

    await expect(
      transferService.transfer({
        configId: 'uc_alice',
        fromTelegramId: 1001,
        toTelegramId: 2002,
        actorTelegramId: 1001,
      })
    ).rejects.toThrow('CONFIG_MUTATION_BUSY');

    expect(client.release).toHaveBeenCalled();
  });

  it('rejects concurrent Delete while Config mutation lock is held by another operation', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    const mockRebecca = {} as unknown as RebeccaService;
    const mockPanels = {
      resolveTarget: vi
        .fn()
        .mockResolvedValue({ panelId: 'legacy', serviceId: 1, service: mockRebecca }),
      getService: vi.fn().mockReturnValue(mockRebecca),
      listRegisteredPanels: vi.fn().mockReturnValue([{ id: 'legacy' }]),
      hasMultiplePanels: vi.fn().mockReturnValue(false),
    } as unknown as RebeccaPanelRegistry;

    const configService = new ConfigService(mockPanels, {} as TranslationService);

    const localConfig = {
      id: 'uc_alice',
      telegramId: 1001,
      panelId: 'legacy',
      configUsername: 'alice_conc',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };

    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn().mockResolvedValue([localConfig]),
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => query),
    } as never);

    await expect(configService.deleteConfigCompletely('alice_conc', 'legacy')).rejects.toThrow(
      'CONFIG_MUTATION_BUSY'
    );
  });

  it('rejects concurrent Renewal while Config mutation lock is held by another operation', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    const mockRebecca = {} as unknown as RebeccaService;
    const mockPanels = {
      resolveTarget: vi
        .fn()
        .mockResolvedValue({ panelId: 'legacy', serviceId: 1, service: mockRebecca }),
    } as unknown as RebeccaPanelRegistry;

    const mockReferralService = {
      calculateBonusSnapshot: vi.fn().mockResolvedValue({
        cashbackPercent: 0,
        cashbackAmount: 0,
        referrerTelegramId: null,
        referralBonusAmount: 0,
      }),
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReferralService;

    const mockPromo = {} as PromoService;

    const saga = new WalletPurchaseSaga(mockPanels, mockReferralService, mockPromo);

    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn().mockResolvedValue([]), // No pending intent
    };
    const updateQuery = {
      set: vi.fn(() => updateQuery),
      where: vi.fn(() => updateQuery),
      returning: vi.fn().mockResolvedValue([{ telegramId: 1001 }]),
    };
    const insertQuery = {
      values: vi.fn().mockResolvedValue([]),
    };
    const db = {
      select: vi.fn(() => query),
      insert: vi.fn(() => insertQuery),
      update: vi.fn(() => updateQuery),
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
    };
    getDbMock.mockReturnValue(db as never);

    await expect(
      saga.execute({
        telegramId: 1001,
        panelId: 'legacy',
        serviceId: 1,
        configUsername: 'alice_conc',
        type: 'renew_config',
        amount: 50_000,
        gbAmount: 10,
        durationDays: 30,
      })
    ).rejects.toThrow('CONFIG_MUTATION_BUSY');
  });

  it('fails renewal and rolls back commit if userConfigs update matches 0 rows (ownership lost)', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    getPoolMock.mockReturnValue({
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    const mockRebecca = {
      getUser: vi.fn().mockResolvedValue({
        username: 'alice_renew',
        status: 'active',
        data_limit: 10 * 1024 ** 3,
        expire: 1780000000,
        created_at: '2026-01-01T00:00:00Z',
      }),
      resetUserTraffic: vi.fn().mockResolvedValue(undefined),
      updateUser: vi.fn().mockResolvedValue({
        username: 'alice_renew',
        status: 'active',
        data_limit: 10 * 1024 ** 3,
        expire: 1780000000 + 30 * 86400,
        subscription_url: 'https://sub.example/alice_renew',
      }),
    } as unknown as RebeccaService;

    const mockPanels = {
      resolveTarget: vi
        .fn()
        .mockResolvedValue({ panelId: 'legacy', serviceId: 1, service: mockRebecca }),
    } as unknown as RebeccaPanelRegistry;

    const mockReferralService = {
      calculateBonusSnapshot: vi.fn().mockResolvedValue({
        cashbackPercent: 0,
        cashbackAmount: 0,
        referrerTelegramId: null,
        referralBonusAmount: 0,
      }),
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReferralService;

    const mockPromo = {
      finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(undefined),
    } as unknown as PromoService;

    const saga = new WalletPurchaseSaga(mockPanels, mockReferralService, mockPromo);

    const localConfig = {
      id: 'uc_alice',
      telegramId: 1001,
      panelId: 'legacy',
      configUsername: 'alice_renew',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };

    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi
        .fn()
        .mockResolvedValueOnce([]) // Step 1: existing pending check
        .mockResolvedValueOnce([localConfig]) // Step 2: pre-update local config verification
        .mockResolvedValueOnce([{ status: 'pending' }]), // getIntentStatus fallback
    };
    const updateQuery = {
      set: vi.fn(() => updateQuery),
      where: vi.fn(() => updateQuery),
      returning: vi
        .fn()
        .mockResolvedValueOnce([]) // purchaseIntents insert/update in step 1
        .mockResolvedValueOnce([{ telegramId: 1001 }]) // Step 1: users reservation
        .mockResolvedValueOnce([{ id: 'pi_1' }]) // Step 2: prepare renewal
        .mockResolvedValueOnce([{ id: 'pi_1' }]) // Step 3: transition purchaseIntents to completed
        .mockResolvedValueOnce([{ balance: 50_000 }]) // Step 3: users debit
        .mockResolvedValueOnce([]) // Step 3: trialClaims
        .mockResolvedValueOnce([]), // Step 3: userConfigs update returns 0 rows (ownership lost)!
    };
    const insertQuery = {
      values: vi.fn(() => insertQuery),
      returning: vi.fn().mockResolvedValue([{ id: 'pi_1' }]),
    };

    const db = {
      select: vi.fn(() => query),
      insert: vi.fn(() => insertQuery),
      update: vi.fn(() => updateQuery),
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
    };
    getDbMock.mockReturnValue(db as never);

    await expect(
      saga.execute({
        telegramId: 1001,
        panelId: 'legacy',
        serviceId: 1,
        configUsername: 'alice_renew',
        type: 'renew_config',
        amount: 50_000,
        gbAmount: 10,
        durationDays: 30,
      })
    ).rejects.toThrow();
  });
});
