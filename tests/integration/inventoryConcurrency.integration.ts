import { beforeEach, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../src/infra/db.js';
import {
  inventoryReservations,
  packageInventory,
  purchaseIntents,
  rebeccaPanels,
  rebeccaPanelServices,
  userConfigs,
  users,
} from '../../src/infra/schema.js';
import {
  InventoryService,
  InventoryUnavailableError,
  TRIAL_INVENTORY_ID,
} from '../../src/domain/services/InventoryService.js';
import { WalletService } from '../../src/domain/services/WalletService.js';
import { TrialService } from '../../src/domain/services/TrialService.js';
import { RefundService } from '../../src/domain/services/RefundService.js';
import {
  RebeccaApiError,
  type RebeccaService,
  type RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import { PENDING_INTENT_MIN_AGE_MS, reconcilePendingIntents } from '../../src/jobs/reconciler.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  remoteUser,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

describeIntegration('Inventory & capacity PostgreSQL concurrency integration', () => {
  registerIntegrationLifecycleHooks();

  const panelId = 'inv_test_panel';
  const serviceId = 1;
  const userA = 9_100_001;
  const userB = 9_100_002;
  let inventoryService: InventoryService;
  let settingsMap: Record<string, string>;
  let translationService: TranslationService;
  let remoteUsers: Map<string, RebeccaUserDetail>;
  let createUserMock: ReturnType<typeof vi.fn>;
  let updateUserMock: ReturnType<typeof vi.fn>;
  let deleteUserMock: ReturnType<typeof vi.fn>;
  let rebeccaService: RebeccaService;
  let walletService: WalletService;
  let trialService: TrialService;
  let refundService: RefundService;

  beforeEach(async () => {
    settingsMap = {
      trial_enabled: 'true',
      trial_gb: '1',
      trial_days: '3',
      trial_daily_limit: '0',
      refund_window_hours: '24',
      shop_low_stock_threshold: '5',
    };
    translationService = {
      getSetting: vi.fn((key: string, fallback = '') =>
        Object.prototype.hasOwnProperty.call(settingsMap, key) ? settingsMap[key]! : fallback
      ),
      getSettingNum: vi.fn((key: string, fallback: number) => {
        if (!Object.prototype.hasOwnProperty.call(settingsMap, key)) return fallback;
        const n = Number(settingsMap[key]);
        return Number.isFinite(n) ? n : fallback;
      }),
      getSettingBool: vi.fn((key: string, fallback: boolean) => {
        if (!Object.prototype.hasOwnProperty.call(settingsMap, key)) return fallback;
        return settingsMap[key] === 'true';
      }),
    } as unknown as TranslationService;

    inventoryService = new InventoryService(translationService);
    remoteUsers = new Map();

    await seedIntegrationUser(userA, { balance: 100_000, reservedBalance: 0, locale: 'en' });
    await seedIntegrationUser(userB, { balance: 100_000, reservedBalance: 0, locale: 'en' });

    const db = getDb();
    await db
      .insert(rebeccaPanels)
      .values({
        id: panelId,
        name: 'Inventory Test Panel',
        enabled: true,
        isDefault: false,
        maxConfigs: null,
        stockRemaining: null,
        dailyCreateLimit: null,
        reservedCreations: 0,
      })
      .onConflictDoUpdate({
        target: rebeccaPanels.id,
        set: {
          enabled: true,
          maxConfigs: null,
          stockRemaining: null,
          dailyCreateLimit: null,
          reservedCreations: 0,
        },
      });

    await db
      .insert(rebeccaPanelServices)
      .values({
        panelId,
        serviceId,
        name: 'Primary Service',
        enabled: true,
        isDefault: true,
        maxConfigs: null,
        stockRemaining: null,
        dailyCreateLimit: null,
        reservedCreations: 0,
      })
      .onConflictDoUpdate({
        target: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
        set: {
          enabled: true,
          maxConfigs: null,
          stockRemaining: null,
          dailyCreateLimit: null,
          reservedCreations: 0,
        },
      });

    createUserMock = vi.fn(async (payload: { username: string; note?: string }) => {
      await new Promise((r) => setTimeout(r, 25));
      const created = remoteUser(payload.username, {
        note: payload.note ?? null,
        used_traffic: 0,
        lifetime_used_traffic: 0,
      });
      remoteUsers.set(payload.username, created);
      return created;
    });

    updateUserMock = vi.fn(
      async (
        username: string,
        payload?: { data_limit?: number | null; expire?: number | null; status?: string }
      ) => {
        const existing = remoteUsers.get(username) ?? remoteUser(username);
        const updated: RebeccaUserDetail = {
          ...existing,
          ...(payload?.data_limit !== undefined ? { data_limit: payload.data_limit } : {}),
          ...(payload?.expire !== undefined ? { expire: payload.expire } : {}),
          ...(payload?.status !== undefined
            ? { status: payload.status as RebeccaUserDetail['status'] }
            : {}),
        };
        remoteUsers.set(username, updated);
        return updated;
      }
    );

    deleteUserMock = vi.fn(async (username: string) => {
      remoteUsers.delete(username);
      return { username, status: 'deleted' };
    });

    rebeccaService = {
      createUser: createUserMock,
      updateUser: updateUserMock,
      resetUserTraffic: vi.fn(async () => undefined),
      deleteUser: deleteUserMock,
      getUser: vi.fn(async (username: string) => {
        const user = remoteUsers.get(username);
        if (!user) throw new RebeccaApiError(404, `/api/user/${username}`, 'User not found');
        return user;
      }),
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

    walletService = new WalletService(
      rebeccaService,
      translationService,
      referralService,
      promoService,
      undefined,
      inventoryService
    );

    trialService = new TrialService(rebeccaService, translationService, inventoryService);
    refundService = new RefundService(rebeccaService, translationService, inventoryService);
  });

  it('prevents overselling the last 1 package stock under parallel purchases (FOR NO KEY UPDATE)', async () => {
    await inventoryService.setPackageInventory('pkg_last_one', { stockRemaining: 1 });

    const [resA, resB] = await Promise.allSettled([
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'inv_race_a',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_last_one',
      }),
      walletService.executePurchaseSaga({
        telegramId: userB,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'inv_race_b',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_last_one',
      }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InventoryUnavailableError);
    expect((rejected[0] as PromiseRejectedResult).reason.reason).toBe('package_out_of_stock');

    const [invRow] = await getDb()
      .select()
      .from(packageInventory)
      .where(eq(packageInventory.packageId, 'pkg_last_one'));
    expect(invRow).toMatchObject({
      stockRemaining: 0,
      reservedCount: 0,
      soldCount: 1,
    });
  });

  it('enforces panel maxConfigs=1 strictly under parallel new_config purchases without oversell', async () => {
    await getDb().update(rebeccaPanels).set({ maxConfigs: 1 }).where(eq(rebeccaPanels.id, panelId));

    const [resA, resB] = await Promise.allSettled([
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'cap_race_a',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
      }),
      walletService.executePurchaseSaga({
        telegramId: userB,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'cap_race_b',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
      }),
    ]);

    expect([resA, resB].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: 'InventoryUnavailableError',
      reason: 'panel_capacity_full',
    });

    const [panelRow] = await getDb()
      .select()
      .from(rebeccaPanels)
      .where(eq(rebeccaPanels.id, panelId));
    expect(panelRow?.reservedCreations).toBe(0);

    const configs = await getDb()
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.panelId, panelId));
    expect(configs).toHaveLength(1);
  });

  it('releases stock on remote failure and preserves NULL stock if admin switches package to unlimited mid-flight', async () => {
    await inventoryService.setPackageInventory('pkg_rollback', { stockRemaining: 1 });
    createUserMock.mockRejectedValueOnce(new Error('REBECCA_CREATE_FAILED'));

    await expect(
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'fail_cfg_1',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_rollback',
      })
    ).rejects.toThrow();

    const [restored] = await getDb()
      .select()
      .from(packageInventory)
      .where(eq(packageInventory.packageId, 'pkg_rollback'));
    expect(restored).toMatchObject({ stockRemaining: 1, reservedCount: 0, soldCount: 0 });

    // Now test mid-flight admin switch to unlimited (NULL) before failure release
    createUserMock.mockImplementationOnce(async () => {
      await inventoryService.setPackageInventory('pkg_rollback', { stockRemaining: null });
      throw new Error('REBECCA_FAIL_AFTER_UNLIMITED');
    });

    await expect(
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'fail_cfg_2',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_rollback',
      })
    ).rejects.toThrow();

    const [afterUnlimited] = await getDb()
      .select()
      .from(packageInventory)
      .where(eq(packageInventory.packageId, 'pkg_rollback'));
    expect(afterUnlimited?.stockRemaining).toBeNull();
    expect(afterUnlimited?.reservedCount).toBe(0);
  });

  it('never blocks renewals on panel/service capacity while still enforcing per-user package limits', async () => {
    // Create 1 real config first, then cap panel maxConfigs=1 and pause the service
    await walletService.executePurchaseSaga({
      telegramId: userA,
      amount: 10_000,
      type: 'new_config',
      configUsername: 'existing_user_a',
      gbAmount: 10,
      durationDays: 30,
      panelId,
      serviceId,
    });
    await getDb().update(rebeccaPanels).set({ maxConfigs: 1 }).where(eq(rebeccaPanels.id, panelId));
    await getDb()
      .update(rebeccaPanelServices)
      .set({ enabled: false })
      .where(
        and(
          eq(rebeccaPanelServices.panelId, panelId),
          eq(rebeccaPanelServices.serviceId, serviceId)
        )
      );

    await inventoryService.setPackageInventory('pkg_once', {
      stockRemaining: 5,
      maxPurchasesPerUser: 1,
    });

    // New creation is blocked by panel capacity
    await expect(
      walletService.executePurchaseSaga({
        telegramId: userB,
        amount: 10_000,
        type: 'new_config',
        configUsername: 'blocked_new',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
      })
    ).rejects.toMatchObject({ reason: 'panel_capacity_full' });

    // Renewal on existing config succeeds even though panel is full & service is paused
    await expect(
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'renew_config',
        configUsername: 'existing_user_a',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_once',
      })
    ).resolves.toMatchObject({ success: true });

    // Second renewal with the same maxPurchasesPerUser=1 package is blocked
    await expect(
      walletService.executePurchaseSaga({
        telegramId: userA,
        amount: 10_000,
        type: 'renew_config',
        configUsername: 'existing_user_a',
        gbAmount: 10,
        durationDays: 30,
        panelId,
        serviceId,
        packageId: 'pkg_once',
      })
    ).rejects.toMatchObject({ reason: 'package_user_limit_reached' });
  });

  it('restores package stock & decrements soldCount on automatic refund, and enforces trial limits + reconciler release', async () => {
    await inventoryService.setPackageInventory('pkg_refundable', { stockRemaining: 2 });

    await walletService.executePurchaseSaga({
      telegramId: userA,
      amount: 15_000,
      type: 'new_config',
      configUsername: 'refund_cfg_a',
      gbAmount: 10,
      durationDays: 30,
      panelId,
      serviceId,
      packageId: 'pkg_refundable',
    });

    const [cfg] = await getDb()
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.configUsername, 'refund_cfg_a'));
    expect(cfg).toBeDefined();

    const refundRes = await refundService.executeDeleteWithRefund(userA, cfg!.id);
    expect(refundRes.eligible).toBe(true);

    const [invAfterRefund] = await getDb()
      .select()
      .from(packageInventory)
      .where(eq(packageInventory.packageId, 'pkg_refundable'));
    expect(invAfterRefund).toMatchObject({
      stockRemaining: 2,
      reservedCount: 0,
      soldCount: 0,
    });

    // Trial stock=1: userA succeeds, userB gets trial_out_of_stock
    await inventoryService.setPackageInventory(TRIAL_INVENTORY_ID, { stockRemaining: 1 });
    const trialA = await trialService.claimTrial(userA, 'trial_inv_a', panelId, serviceId);
    expect(trialA.success).toBe(true);
    const trialB = await trialService.claimTrial(userB, 'trial_inv_b', panelId, serviceId);
    expect(trialB.success).toBe(false);
    expect(trialB.unavailableReason).toBe('trial_out_of_stock');

    // Reconciler releases orphaned inventory reservation when stuck pending intent does not exist on panel
    await inventoryService.setPackageInventory('pkg_reconcile', { stockRemaining: 1 });
    const oldDate = new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS - 60_000);
    await getDb().transaction(async (tx) => {
      await tx
        .update(users)
        .set({ reservedBalance: sql`${users.reservedBalance} + 5000` })
        .where(eq(users.telegramId, userB));
      await tx.insert(purchaseIntents).values({
        id: 'intent_stuck_inv',
        telegramId: userB,
        type: 'new_config',
        panelId,
        serviceId,
        configUsername: 'never_created_cfg',
        gbAmount: 10,
        durationDays: 30,
        amount: 5_000,
        status: 'pending',
        createdAt: oldDate,
        updatedAt: oldDate,
      });
      await inventoryService.reserveInTransaction(tx, {
        kind: 'purchase',
        referenceId: 'intent_stuck_inv',
        telegramId: userB,
        operationType: 'new_config',
        panelId,
        serviceId,
        packageId: 'pkg_reconcile',
      });
    });

    const reconciled = await reconcilePendingIntents(rebeccaService, { inventoryService });
    expect(reconciled).toBe(1);

    const [recInv] = await getDb()
      .select()
      .from(packageInventory)
      .where(eq(packageInventory.packageId, 'pkg_reconcile'));
    expect(recInv).toMatchObject({ stockRemaining: 1, reservedCount: 0, soldCount: 0 });
    const [resRow] = await getDb()
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.referenceId, 'intent_stuck_inv'));
    expect(resRow?.status).toBe('released');
  });
});
