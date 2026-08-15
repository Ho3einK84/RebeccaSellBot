import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDb, getPool, initDatabase } from '../../src/infra/db.js';
import { autoMigrate } from '../../src/infra/migrate.js';
import { purchaseIntents, users, walletTransactions } from '../../src/infra/schema.js';
import { eq } from 'drizzle-orm';
import { PurchaseInProgressError, WalletService } from '../../src/domain/services/WalletService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import { JobRunner, PostgresAdvisoryJobLockProvider } from '../../src/jobs/workerRuntime.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('WalletService PostgreSQL concurrency', () => {
  const telegramId = 9_001_001;
  const amount = 800;
  let releaseRemote: () => void;
  let remoteStarted: Promise<void>;
  let walletService: WalletService;
  let createUser: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    initDatabase(databaseUrl!);
    await autoMigrate(getDb());
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE TABLE users CASCADE');
    await getDb()
      .insert(users)
      .values({
        telegramId,
        referralCode: `ref_${telegramId}_integration`,
        balance: 1_000,
        reservedBalance: 0,
        locale: 'en',
      });

    let signalRemoteStarted!: () => void;
    remoteStarted = new Promise<void>((resolve) => {
      signalRemoteStarted = resolve;
    });
    const remoteGate = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });

    createUser = vi.fn(async (payload: { username: string; note?: string }) => {
      signalRemoteStarted();
      await remoteGate;
      return {
        username: payload.username,
        status: 'active' as const,
        used_traffic: 0,
        lifetime_used_traffic: 0,
        data_limit: 10 * 1024 * 1024 * 1024,
        expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
        created_at: new Date().toISOString(),
        subscription_url: 'https://rebecca.example/sub/integration',
        subscription_urls: { primary: 'https://rebecca.example/sub/integration' },
        links: [],
        proxies: {},
        inbounds: {},
        note: payload.note ?? null,
        telegram_id: null,
        sub_updated_at: null,
        online_at: null,
        ip_limit: 0,
        service_id: 1,
        service_name: null,
        admin_username: null,
      };
    });

    const rebeccaService = {
      createUser,
      deleteUser: vi.fn().mockResolvedValue({ username: 'integration', status: 'deleted' }),
    } as unknown as RebeccaService;
    const translationService = {
      getSettingNum: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as TranslationService;
    const referralService = {
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
      resolveReferrerId: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReferralService;
    const promoService = {
      reserveForPurchase: vi.fn(),
      finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
      releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
    } as unknown as PromoService;

    walletService = new WalletService(
      rebeccaService,
      translationService,
      referralService,
      promoService
    );
  });

  afterAll(async () => {
    if (databaseUrl) await closeDatabase();
  });

  it('allows only one concurrent purchase intent and debits exactly once', async () => {
    const first = walletService.executePurchaseSaga({
      telegramId,
      amount,
      type: 'new_config',
      configUsername: 'integration_one',
      gbAmount: 10,
      durationDays: 30,
    });

    await remoteStarted;

    const second = walletService.executePurchaseSaga({
      telegramId,
      amount,
      type: 'new_config',
      configUsername: 'integration_two',
      gbAmount: 10,
      durationDays: 30,
    });

    await expect(second).rejects.toBeInstanceOf(PurchaseInProgressError);
    releaseRemote!();
    await expect(first).resolves.toMatchObject({ success: true });

    const [wallet] = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    const intents = await getDb()
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.telegramId, telegramId));
    const transactions = await getDb()
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.telegramId, telegramId));

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(wallet).toMatchObject({ balance: 200, reservedBalance: 0, totalSpend: 800 });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.status).toBe('completed');
    expect(transactions.filter((tx) => tx.type === 'purchase')).toHaveLength(1);
  });

  it('prevents an admin balance set from violating an in-flight reservation', async () => {
    const purchase = walletService.executePurchaseSaga({
      telegramId,
      amount,
      type: 'new_config',
      configUsername: 'integration_reserved',
      gbAmount: 10,
      durationDays: 30,
    });

    await remoteStarted;

    await expect(
      walletService.adjustBalanceAdmin({
        telegramId,
        operation: 'set',
        amount: 100,
        adminId: 42,
        description: 'integration concurrency check',
      })
    ).rejects.toThrow('ADMIN_BALANCE_BELOW_RESERVED');

    releaseRemote!();
    await purchase;

    const [wallet] = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    expect(wallet).toMatchObject({ balance: 200, reservedBalance: 0 });
  });

  it('allows only one replica to own a scheduled job advisory lock', async () => {
    const firstRunner = new JobRunner(new PostgresAdvisoryJobLockProvider());
    const secondRunner = new JobRunner(new PostgresAdvisoryJobLockProvider());
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = firstRunner.run('integration-distributed-lock', async () => {
      firstStarted();
      await gate;
    });
    await started;

    await expect(
      secondRunner.run('integration-distributed-lock', async () => undefined)
    ).resolves.toBe('skipped_distributed_lock');

    releaseFirst();
    await expect(first).resolves.toBe('completed');
  });
});
