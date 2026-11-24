import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/infra/db.js';
import { PostgresSessionAdapter } from '../../src/infra/sessionAdapter.js';
import {
  notificationDeliveries,
  purchaseIntents,
  topupReceipts,
  userConfigs,
  users,
  walletTransactions,
} from '../../src/infra/schema.js';
import { PurchaseInProgressError, WalletService } from '../../src/domain/services/WalletService.js';
import {
  PaymentService,
  serializeBankCardsJson,
} from '../../src/domain/services/PaymentService.js';
import { UserService } from '../../src/domain/services/UserService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import { JobRunner, PostgresAdvisoryJobLockProvider } from '../../src/jobs/workerRuntime.js';
import { PostgresNotificationDeliveryStore } from '../../src/jobs/notifier.js';
import { PostgresAutoRenewalCandidateStore } from '../../src/jobs/autoRenewal.js';
import { PENDING_INTENT_MIN_AGE_MS, reconcilePendingIntents } from '../../src/jobs/reconciler.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  remoteUser,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

describeIntegration('Wallet, sessions, and background job PostgreSQL integration', () => {
  registerIntegrationLifecycleHooks();

  const telegramId = 9_001_001;
  const amount = 800;
  let releaseRemote: () => void;
  let remoteStarted: Promise<void>;
  let walletService: WalletService;
  let createUser: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await seedIntegrationUser(telegramId, {
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
      return remoteUser(payload.username, {
        data_limit: 10 * 1024 ** 3,
        expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
        subscription_url: 'https://rebecca.example/sub/integration',
        subscription_urls: { primary: 'https://rebecca.example/sub/integration' },
        note: payload.note ?? null,
      });
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

  it('persists, updates across cold readers, and deletes grammY sessions in PostgreSQL', async () => {
    const writer = new PostgresSessionAdapter<{ step: string; count: number }>();
    const coldReader = new PostgresSessionAdapter<{ step: string; count: number }>();

    expect(await coldReader.read('chat:100')).toBeUndefined();

    await writer.write('chat:100', { step: 'awaiting_amount', count: 1 });
    expect(await coldReader.read('chat:100')).toEqual({ step: 'awaiting_amount', count: 1 });

    await writer.write('chat:100', { step: 'confirmed', count: 2 });
    const freshReader = new PostgresSessionAdapter<{ step: string; count: number }>();
    expect(await freshReader.read('chat:100')).toEqual({ step: 'confirmed', count: 2 });

    await writer.delete('chat:100');
    const finalReader = new PostgresSessionAdapter<{ step: string; count: number }>();
    expect(await finalReader.read('chat:100')).toBeUndefined();
  });

  it('filters manual vs auto-renew configs and enforces atomic notification cooldowns in PostgreSQL', async () => {
    await seedIntegrationUser(9_001_002, { locale: 'fa' });
    const db = getDb();

    await db.insert(userConfigs).values([
      {
        id: 'uc_manual',
        telegramId,
        panelId: 'legacy',
        serviceId: 1,
        configUsername: 'cfg_manual',
        autoRenewEnabled: false,
      },
      {
        id: 'uc_auto',
        telegramId: 9_001_002,
        panelId: 'legacy',
        serviceId: 1,
        configUsername: 'cfg_auto',
        autoRenewEnabled: true,
        autoRenewPackageId: 'pkg_10gb_30d',
        autoRenewPrice: 50_000,
      },
    ]);

    const deliveryStore = new PostgresNotificationDeliveryStore();
    const candidateStore = new PostgresAutoRenewalCandidateStore();

    const notifierRecipients = await deliveryStore.listConfigs();
    expect(notifierRecipients).toHaveLength(1);
    expect(notifierRecipients[0]).toMatchObject({
      configId: 'uc_manual',
      configUsername: 'cfg_manual',
      locale: 'en',
      autoRenewEnabled: false,
    });

    const autoCandidates = await candidateStore.listEnabledConfigs();
    expect(autoCandidates).toHaveLength(1);
    expect(autoCandidates[0]).toMatchObject({
      configId: 'uc_auto',
      configUsername: 'cfg_auto',
      locale: 'fa',
      autoRenewPackageId: 'pkg_10gb_30d',
      autoRenewPrice: 50_000,
    });

    const t0 = new Date('2026-08-15T12:00:00Z');
    const recipient = notifierRecipients[0]!;
    await expect(deliveryStore.reserve(recipient, 'low_traffic', t0)).resolves.toBe(true);
    await expect(deliveryStore.reserve(recipient, 'low_traffic', t0)).resolves.toBe(false);

    // Independent reason reserves freely without being blocked by low_traffic
    await expect(deliveryStore.reserve(recipient, 'near_expiry', t0)).resolves.toBe(true);

    // Recovery/release resets conditionActive so the next alert reserves immediately
    await deliveryStore.release(recipient, ['low_traffic'], t0);
    await expect(
      deliveryStore.reserve(recipient, 'low_traffic', new Date(t0.getTime() + 60_000))
    ).resolves.toBe(true);

    // Within 24h cooldown continuous alert stays blocked; after 24h cooldown it re-fires
    await expect(
      deliveryStore.reserve(recipient, 'low_traffic', new Date(t0.getTime() + 2 * 60_000))
    ).resolves.toBe(false);
    await expect(
      deliveryStore.reserve(
        recipient,
        'low_traffic',
        new Date(t0.getTime() + 24 * 60 * 60 * 1000 + 60_000)
      )
    ).resolves.toBe(true);

    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.telegramId, telegramId));
    expect(rows).toHaveLength(2);

    await candidateStore.disableAutoRenew(autoCandidates[0]!);
    await expect(candidateStore.listEnabledConfigs()).resolves.toEqual([]);
  });

  it('reconciles aged pending renewals against PostgreSQL while sparing recent intents', async () => {
    const db = getDb();
    const releaseUserId = 9_001_002;
    const freshUserId = 9_001_003;
    await seedIntegrationUser(releaseUserId, { balance: 1_000, reservedBalance: 400 });
    await seedIntegrationUser(freshUserId, { balance: 1_000, reservedBalance: 300 });
    await db
      .update(users)
      .set({ balance: 1_500, reservedBalance: 500, totalSpend: 0 })
      .where(eq(users.telegramId, telegramId));

    const previousExpire = 1_750_000_000;
    const expectedExpire = previousExpire + 30 * 86_400;
    const staleAt = new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS - 60_000);
    const freshAt = new Date(Date.now() - 30_000);

    await db.insert(userConfigs).values({
      id: 'uc_reconcile_apply',
      telegramId,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'cfg_apply',
      isClaimed: true,
      panelStatus: 'expired',
      panelDataLimit: 10 * 1024 ** 3,
      panelUsedTraffic: 10 * 1024 ** 3,
      panelExpire: previousExpire,
    });

    await db.insert(purchaseIntents).values([
      {
        id: 'pi_apply',
        telegramId,
        panelId: 'legacy',
        serviceId: 1,
        amount: 500,
        type: 'renew_config',
        status: 'pending',
        configUsername: 'cfg_apply',
        gbAmount: 20,
        durationDays: 30,
        previousDataLimit: 10 * 1024 ** 3,
        previousExpire,
        previousStatus: 'expired',
        expectedDataLimit: 20 * 1024 ** 3,
        expectedExpire,
        expectedStatus: 'active',
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        id: 'pi_release',
        telegramId: releaseUserId,
        panelId: 'legacy',
        serviceId: 1,
        amount: 400,
        type: 'renew_config',
        status: 'pending',
        configUsername: 'cfg_release',
        gbAmount: 10,
        durationDays: 30,
        previousDataLimit: 10 * 1024 ** 3,
        previousExpire,
        previousStatus: 'active',
        expectedDataLimit: 20 * 1024 ** 3,
        expectedExpire,
        expectedStatus: 'active',
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        id: 'pi_fresh',
        telegramId: freshUserId,
        panelId: 'legacy',
        serviceId: 1,
        amount: 300,
        type: 'renew_config',
        status: 'pending',
        configUsername: 'cfg_fresh',
        gbAmount: 10,
        durationDays: 30,
        previousDataLimit: 10 * 1024 ** 3,
        previousExpire,
        previousStatus: 'active',
        expectedDataLimit: 20 * 1024 ** 3,
        expectedExpire,
        expectedStatus: 'active',
        createdAt: freshAt,
        updatedAt: freshAt,
      },
    ]);

    const rebecca = {
      getUser: vi.fn(async (username: string) => {
        if (username === 'cfg_apply') {
          return remoteUser('cfg_apply', {
            status: 'active',
            data_limit: 20 * 1024 ** 3,
            expire: expectedExpire,
          });
        }
        return remoteUser('cfg_release', {
          status: 'active',
          data_limit: 10 * 1024 ** 3,
          expire: previousExpire,
        });
      }),
    } as unknown as RebeccaService;

    await expect(reconcilePendingIntents(rebecca)).resolves.toBe(2);
    expect(rebecca.getUser).not.toHaveBeenCalledWith('cfg_fresh');

    const [appliedWallet] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    const [releasedWallet] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, releaseUserId));
    const [freshWallet] = await db.select().from(users).where(eq(users.telegramId, freshUserId));
    expect(appliedWallet).toMatchObject({
      balance: 1_000,
      reservedBalance: 0,
      totalSpend: 500,
      activeSubscriptionCount: 1,
    });
    expect(releasedWallet).toMatchObject({ balance: 1_000, reservedBalance: 0, totalSpend: 0 });
    expect(freshWallet).toMatchObject({ balance: 1_000, reservedBalance: 300, totalSpend: 0 });

    const [applied] = await db
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.id, 'pi_apply'));
    const [released] = await db
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.id, 'pi_release'));
    const [fresh] = await db
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.id, 'pi_fresh'));
    expect(applied?.status).toBe('completed');
    expect(released?.status).toBe('failed');
    expect(fresh?.status).toBe('pending');
  });

  it('excludes voided top-up receipts and refunded purchases from dashboard revenue, sales, user deposits, and card usage in PostgreSQL', async () => {
    const db = getDb();
    const userA = 9_002_001;
    const userB = 9_002_002;
    const adminId = 999_001;
    await seedIntegrationUser(userA, { balance: 0, locale: 'fa' });
    await seedIntegrationUser(userB, { balance: 0, locale: 'fa' });

    const ts = new TranslationService();
    await ts.ensureDefaultSettings();
    await ts.updateSettings({
      bank_cards_json: serializeBankCardsJson([
        {
          id: 'card_a',
          cardNumber: '6037698111306846',
          cardHolder: 'Integration Card',
          enabled: true,
          dailyCapToman: 300_000,
        },
      ]),
    });

    const paymentService = new PaymentService(ts);
    const userService = new UserService();
    const immediateRebecca = {
      createUser: vi.fn(async (payload: { username: string }) =>
        remoteUser(payload.username, { data_limit: 10 * 1024 ** 3 })
      ),
      deleteUser: vi.fn().mockResolvedValue({ username: 'deleted', status: 'deleted' }),
    } as unknown as RebeccaService;
    const referralService = {
      processCompletedPurchase: vi.fn().mockResolvedValue(undefined),
      resolveReferrerId: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReferralService;
    const promoService = {
      reserveForPurchase: vi.fn(),
      finalizeReservedPurchasePromo: vi.fn().mockResolvedValue(false),
      releaseReservedPurchasePromoInTransaction: vi.fn().mockResolvedValue(false),
    } as unknown as PromoService;

    const liveWallet = new WalletService(immediateRebecca, ts, referralService, promoService);

    // 1. User A submits receipt r1 (120,000) & approves -> increments revenue, deposit, and card usage
    const { receiptId: r1 } = await liveWallet.submitTopupReceiptDetailed({
      telegramId: userA,
      amount: 120_000,
      photoFileId: 'photo_r1',
      cardId: 'card_a',
      cardNumber: '6037698111306846',
    });
    paymentService.recordCardDailyUsage('card_a', 120_000);
    await liveWallet.approveTopup(r1, adminId);

    const statsBeforeVoid = await liveWallet.getDashboardStats();
    expect(statsBeforeVoid.dailyRevenue).toBe(120_000);
    expect(statsBeforeVoid.weeklyRevenue).toBe(120_000);
    expect(statsBeforeVoid.monthlyRevenue).toBe(120_000);
    expect((await userService.getUserReportSummary(userA))?.totalDeposit).toBe(120_000);
    expect((await paymentService.getTodayCardUsageMap()).get('card_a')).toBe(120_000);

    // 2. User B submits receipt r2 (80,000), spends everything (50k kept + 30k refunded), then r2 is voided with zero deduct
    const { receiptId: r2 } = await liveWallet.submitTopupReceiptDetailed({
      telegramId: userB,
      amount: 80_000,
      photoFileId: 'photo_r2',
      cardId: 'card_a',
      cardNumber: '6037698111306846',
    });
    paymentService.recordCardDailyUsage('card_a', 80_000);
    await liveWallet.approveTopup(r2, adminId);

    await liveWallet.executePurchaseSaga({
      telegramId: userB,
      amount: 50_000,
      type: 'new_config',
      configUsername: 'rev_kept_cfg',
      gbAmount: 10,
      durationDays: 30,
    });
    const refundedPurchase = await liveWallet.executePurchaseSaga({
      telegramId: userB,
      amount: 30_000,
      type: 'new_config',
      configUsername: 'rev_refund_cfg',
      gbAmount: 5,
      durationDays: 30,
    });
    expect(refundedPurchase.intentId).toBeTruthy();

    // Mark second purchase refunded with deterministic refund tx
    await db
      .update(purchaseIntents)
      .set({ status: 'refunded', refundedAt: new Date() })
      .where(eq(purchaseIntents.id, refundedPurchase.intentId!));
    await db.insert(walletTransactions).values({
      id: 'tx_refund_test_1',
      telegramId: userB,
      amount: 30_000,
      balanceAfter: 30_000,
      type: 'refund',
      referenceId: `refund_${refundedPurchase.intentId!}`,
      description: 'Refunded test purchase',
    });

    // User A gets another approved receipt r3 (45,000) + an automated ForApp topup (55,000)
    const { receiptId: r3 } = await liveWallet.submitTopupReceiptDetailed({
      telegramId: userA,
      amount: 45_000,
      photoFileId: 'photo_r3',
      cardId: 'card_a',
      cardNumber: '6037698111306846',
    });
    paymentService.recordCardDailyUsage('card_a', 45_000);
    await liveWallet.approveTopup(r3, adminId);

    await db.insert(walletTransactions).values({
      id: 'tx_forapp_test_1',
      telegramId: userA,
      amount: 55_000,
      balanceAfter: 220_000,
      type: 'topup',
      referenceId: 'forapp_order_po_int_1',
      description: 'Automated ForApp card-to-card top-up',
    });

    // Now void r1 (full deduct) and void r2 (zero deduct due to shortfall; test with zeroed balance first)
    await db.update(users).set({ balance: 0 }).where(eq(users.telegramId, userB));
    const voidR1 = await liveWallet.voidApprovedTopup({
      receiptId: r1,
      adminId,
      reason: 'Fake r1',
    });
    const voidR2 = await liveWallet.voidApprovedTopup({
      receiptId: r2,
      adminId,
      reason: 'Fake r2',
    });
    expect(voidR1.deductedAmount).toBe(120_000);
    expect(voidR2.deductedAmount).toBe(0);
    expect(voidR2.shortfallAmount).toBe(80_000);

    const [voidedRow] = await db.select().from(topupReceipts).where(eq(topupReceipts.id, r1));
    expect(voidedRow?.status).toBe('voided');

    const statsAfterVoid = await liveWallet.getDashboardStats();
    // Net revenue = r3 (45,000) + automated ForApp (55,000) = 100,000
    expect(statsAfterVoid.dailyRevenue).toBe(100_000);
    expect(statsAfterVoid.weeklyRevenue).toBe(100_000);
    expect(statsAfterVoid.monthlyRevenue).toBe(100_000);
    // Net sales = kept purchase (50,000); refunded 30,000 excluded
    expect(statsAfterVoid.totalSales).toBe(50_000);

    expect((await userService.getUserReportSummary(userA))?.totalDeposit).toBe(100_000);
    expect((await userService.getUserReportSummary(userB))?.totalDeposit).toBe(0);

    // Card usage reflects only non-voided receipt r3 (45,000), ignoring stale in-memory sums
    const cardUsageAfterVoid = await paymentService.getTodayCardUsageMap();
    expect(cardUsageAfterVoid.get('card_a')).toBe(45_000);
    expect(paymentService.getCardDailyUsage('card_a')).toBe(45_000);
  });
});
