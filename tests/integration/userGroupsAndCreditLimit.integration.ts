import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/infra/db.js';
import {
  broadcastJobs,
  broadcastRecipients,
  purchaseIntents,
  userGroups,
  users,
  walletTransactions,
} from '../../src/infra/schema.js';
import { UserGroupService } from '../../src/domain/services/UserGroupService.js';
import { WalletService } from '../../src/domain/services/WalletService.js';
import { ReferralService } from '../../src/domain/services/ReferralService.js';
import { PromoService, PromoValidationError } from '../../src/domain/services/PromoService.js';
import { BroadcastService } from '../../src/domain/services/BroadcastService.js';
import { purchaseOwnershipMarker } from '../../src/domain/services/RebeccaOwnership.js';
import { PENDING_INTENT_MIN_AGE_MS, reconcilePendingIntents } from '../../src/jobs/reconciler.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  remoteUser,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

describeIntegration(
  'User groups & VIP negative-balance credit limit PostgreSQL integration',
  () => {
    registerIntegrationLifecycleHooks();

    const vipUserId = 9_700_001;
    const recipientUserId = 9_700_002;
    const regularUserId = 9_700_003;
    const expiredVipUserId = 9_700_004;
    const bannedVipUserId = 9_700_005;

    let userGroupService: UserGroupService;
    let referralService: ReferralService;
    let promoService: PromoService;
    let walletService: WalletService;
    let broadcastService: BroadcastService;
    let createUser: ReturnType<typeof vi.fn>;
    let getUser: ReturnType<typeof vi.fn>;
    let translationService: TranslationService;

    beforeEach(async () => {
      translationService = {
        getSetting: vi.fn((_k: string, fallback = '') => fallback),
        getSettingNum: vi.fn((key: string, fallback = 0) => {
          if (key === 'cashback_percent') return 10;
          if (key === 'referral_bonus_toman') return 10_000;
          if (key === 'wallet_transfer_min_amount') return 5_000;
          return fallback;
        }),
        getSettingBool: vi.fn((_k: string, fallback = true) => fallback),
        get: vi.fn((k: string) => k),
        getDefaultLocale: vi.fn(() => 'en'),
      } as unknown as TranslationService;

      userGroupService = new UserGroupService();
      referralService = new ReferralService(translationService, userGroupService);
      promoService = new PromoService(userGroupService);
      broadcastService = new BroadcastService();

      createUser = vi.fn(async (payload: { username: string; note?: string }) =>
        remoteUser(payload.username, {
          data_limit: 50 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
          subscription_url: `https://rebecca.example/sub/${payload.username}`,
          subscription_urls: { primary: `https://rebecca.example/sub/${payload.username}` },
          note: payload.note ?? null,
        })
      );
      getUser = vi.fn(async (username: string) =>
        remoteUser(username, {
          data_limit: 50 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
          subscription_url: `https://rebecca.example/sub/${username}`,
          subscription_urls: { primary: `https://rebecca.example/sub/${username}` },
        })
      );

      const rebeccaService = {
        createUser,
        getUser,
        deleteUser: vi.fn().mockResolvedValue({ status: 'deleted' }),
      } as unknown as RebeccaService;

      walletService = new WalletService(
        rebeccaService,
        translationService,
        referralService,
        promoService,
        userGroupService
      );
    });

    it('supports VIP purchasing into negative balance up to credit_limit, suppresses cashback/promo, and auto-settles debt on top-up', async () => {
      await seedIntegrationUser(vipUserId, { balance: 20_000, reservedBalance: 0 });
      const vip = await userGroupService.createGroup({
        name: 'VIP Platinum',
        badge: '💎 VIP',
        discountPercent: 20,
        allowCatalogDiscounts: false,
        allowPromoCodes: false,
        allowCashback: false,
        allowLuckyWheel: false,
        allowCustomServiceName: true,
        creditLimit: 100_000,
      });
      await userGroupService.assignUserGroup({ telegramId: vipUserId, groupId: vip.id });

      // Promo is blocked by group policy during saga
      await expect(
        walletService.executePurchaseSaga({
          telegramId: vipUserId,
          amount: 80_000,
          type: 'new_config',
          configUsername: 'vip_promo_blocked',
          gbAmount: 50,
          durationDays: 30,
          promoCode: 'ANYCODE',
        })
      ).rejects.toThrow(PromoValidationError);
      expect(createUser).not.toHaveBeenCalled();

      // Purchase 80_000 with balance=20_000 and creditLimit=100_000 -> balance=-60_000
      const res1 = await walletService.executePurchaseSaga({
        telegramId: vipUserId,
        amount: 80_000,
        type: 'new_config',
        configUsername: 'vip_credit_1',
        gbAmount: 50,
        durationDays: 30,
      });
      expect(res1.success).toBe(true);

      const [after1] = await getDb().select().from(users).where(eq(users.telegramId, vipUserId));
      expect(after1?.balance).toBe(-60_000);
      expect(after1?.reservedBalance).toBe(0);

      const intents1 = await getDb()
        .select()
        .from(purchaseIntents)
        .where(eq(purchaseIntents.telegramId, vipUserId));
      expect(intents1[0]?.creditLimit).toBe(100_000);
      expect(intents1[0]?.status).toBe('completed');

      // No cashback transaction created because allowCashback=false
      const txsAfter1 = await getDb()
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.telegramId, vipUserId));
      expect(txsAfter1.filter((t) => t.type === 'cashback')).toHaveLength(0);
      expect(txsAfter1.find((t) => t.type === 'purchase')?.balanceAfter).toBe(-60_000);

      // Remaining purchasing power is -60_000 + 100_000 = 40_000; 50_000 purchase must fail
      await expect(
        walletService.executePurchaseSaga({
          telegramId: vipUserId,
          amount: 50_000,
          type: 'new_config',
          configUsername: 'vip_over_limit',
          gbAmount: 30,
          durationDays: 30,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      // Top-up naturally settles negative balance: +40_000 -> -20_000, then +50_000 -> +30_000
      const receipt1 = await walletService.submitTopupReceipt(vipUserId, 40_000, 'photo_settle_1');
      await walletService.approveTopup(receipt1, 999);
      const [afterPartial] = await getDb()
        .select()
        .from(users)
        .where(eq(users.telegramId, vipUserId));
      expect(afterPartial?.balance).toBe(-20_000);

      const receipt2 = await walletService.submitTopupReceipt(vipUserId, 50_000, 'photo_settle_2');
      await walletService.approveTopup(receipt2, 999);
      const [afterFull] = await getDb().select().from(users).where(eq(users.telegramId, vipUserId));
      expect(afterFull?.balance).toBe(30_000);
    });

    it('commits cleanly when VIP is removed mid-purchase and reconciles aged intents using snapshotted credit_limit', async () => {
      await seedIntegrationUser(vipUserId, { balance: 0, reservedBalance: 0 });
      const vip = await userGroupService.createGroup({
        name: 'VIP Credit',
        creditLimit: 100_000,
        allowCashback: false,
      });
      await userGroupService.assignUserGroup({ telegramId: vipUserId, groupId: vip.id });

      let signalRemoteStarted!: () => void;
      const remoteStarted = new Promise<void>((resolve) => {
        signalRemoteStarted = resolve;
      });
      let releaseRemote!: () => void;
      const remoteGate = new Promise<void>((resolve) => {
        releaseRemote = resolve;
      });

      createUser.mockImplementationOnce(async (payload: { username: string; note?: string }) => {
        signalRemoteStarted();
        await remoteGate;
        return remoteUser(payload.username, {
          data_limit: 50 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
          subscription_url: `https://rebecca.example/sub/${payload.username}`,
          subscription_urls: { primary: `https://rebecca.example/sub/${payload.username}` },
          note: payload.note ?? null,
        });
      });

      const inFlight = walletService.executePurchaseSaga({
        telegramId: vipUserId,
        amount: 80_000,
        type: 'new_config',
        configUsername: 'vip_mid_removal',
        gbAmount: 50,
        durationDays: 30,
      });

      await remoteStarted;

      // Remove VIP group while remote panel call is still in-flight!
      await userGroupService.assignUserGroup({ telegramId: vipUserId, groupId: null });
      releaseRemote();

      // Commit MUST still succeed using the snapshotted credit limit
      await expect(inFlight).resolves.toMatchObject({ success: true });
      const [afterCommit] = await getDb()
        .select()
        .from(users)
        .where(eq(users.telegramId, vipUserId));
      expect(afterCommit?.balance).toBe(-80_000);
      expect(afterCommit?.reservedBalance).toBe(0);

      // Also test reconciler with an aged pending intent whose user already lost VIP
      await seedIntegrationUser(regularUserId, { balance: 0, reservedBalance: 60_000 });
      const oldTime = new Date(Date.now() - PENDING_INTENT_MIN_AGE_MS - 30_000);
      await getDb().insert(purchaseIntents).values({
        id: 'pi_reconcile_credit',
        telegramId: regularUserId,
        type: 'new_config',
        configUsername: 'vip_reconciled_cfg',
        panelId: 'legacy',
        serviceId: 1,
        gbAmount: 30,
        durationDays: 30,
        amount: 60_000,
        creditLimit: 100_000,
        status: 'pending',
        createdAt: oldTime,
        updatedAt: oldTime,
      });

      const mockRebeccaForReconcile = {
        getUser: vi.fn().mockResolvedValue(
          remoteUser('vip_reconciled_cfg', {
            note: purchaseOwnershipMarker('pi_reconcile_credit'),
            subscription_url: 'https://rebecca.example/sub/vip_reconciled_cfg',
            subscription_urls: { primary: 'https://rebecca.example/sub/vip_reconciled_cfg' },
          })
        ),
      } as unknown as RebeccaService;

      await reconcilePendingIntents(mockRebeccaForReconcile);
      const [reconciledUser] = await getDb()
        .select()
        .from(users)
        .where(eq(users.telegramId, regularUserId));
      const [reconciledIntent] = await getDb()
        .select()
        .from(purchaseIntents)
        .where(eq(purchaseIntents.id, 'pi_reconcile_credit'));
      expect(reconciledIntent?.status).toBe('completed');
      expect(reconciledUser?.balance).toBe(-60_000);
      expect(reconciledUser?.reservedBalance).toBe(0);
    });

    it('safely handles VIP expiration/deletion while user is indebted and blocks P2P transfers from negative credit', async () => {
      await seedIntegrationUser(vipUserId, { balance: -45_000, reservedBalance: 0 });
      await seedIntegrationUser(recipientUserId, { balance: 10_000, reservedBalance: 0 });

      const defaultGrp = await userGroupService.createGroup({
        name: 'Standard',
        isDefault: true,
        creditLimit: 0,
      });
      // Partial unique index `user_groups_one_default` rejects direct second default insert
      await expect(
        getDb().insert(userGroups).values({
          id: 'grp_dup_default',
          name: 'Duplicate Default',
          isDefault: true,
        })
      ).rejects.toThrow();
      const vip = await userGroupService.createGroup({
        name: 'VIP Temp',
        creditLimit: 500_000,
      });

      // Assign expired VIP to indebted user -> no DB constraint error, transparent fallback to default
      await userGroupService.assignUserGroup({
        telegramId: vipUserId,
        groupId: vip.id,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const policyAfterExpiry = await userGroupService.getEffectiveUserPolicy(vipUserId);
      expect(policyAfterExpiry.groupId).toBe(defaultGrp.id);
      expect(policyAfterExpiry.isExpired).toBe(true);
      expect(policyAfterExpiry.creditLimit).toBe(0);

      // Indebted user with expired VIP cannot purchase
      await expect(
        walletService.executePurchaseSaga({
          telegramId: vipUserId,
          amount: 10_000,
          type: 'new_config',
          configUsername: 'expired_vip_blocked',
          gbAmount: 10,
          durationDays: 30,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      // Deleting VIP group migrates indebted user safely to default group without DB error
      const deleted = await userGroupService.deleteGroup(vip.id);
      expect(deleted.deleted).toBe(true);
      expect(deleted.transferredCount).toBe(1);
      expect(deleted.targetGroupId).toBe(defaultGrp.id);
      const [migratedUser] = await getDb()
        .select()
        .from(users)
        .where(eq(users.telegramId, vipUserId));
      expect(migratedUser?.groupId).toBe(defaultGrp.id);
      expect(migratedUser?.balance).toBe(-45_000);

      // P2P transfer strictly requires positive real balance (never allows negative credit!)
      const activeVip = await userGroupService.createGroup({
        name: 'VIP Active',
        creditLimit: 500_000,
      });
      await userGroupService.assignUserGroup({ telegramId: vipUserId, groupId: activeVip.id });

      // Case 1: indebted VIP (-45_000) cannot transfer
      await expect(
        walletService.transferBalance({
          fromTelegramId: vipUserId,
          toTelegramId: recipientUserId,
          amount: 5_000,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      // Case 2: zero-balance VIP with 500_000 credit limit cannot transfer
      await getDb().update(users).set({ balance: 0 }).where(eq(users.telegramId, vipUserId));
      await expect(
        walletService.transferBalance({
          fromTelegramId: vipUserId,
          toTelegramId: recipientUserId,
          amount: 10_000,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      // Case 3: VIP with +15_000 real balance cannot transfer 20_000, CAN transfer 15_000
      await getDb().update(users).set({ balance: 15_000 }).where(eq(users.telegramId, vipUserId));
      await expect(
        walletService.transferBalance({
          fromTelegramId: vipUserId,
          toTelegramId: recipientUserId,
          amount: 20_000,
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      const transferRes = await walletService.transferBalance({
        fromTelegramId: vipUserId,
        toTelegramId: recipientUserId,
        amount: 15_000,
      });
      expect(transferRes.fromBalanceAfter).toBe(0);
      expect(transferRes.toBalanceAfter).toBe(25_000);
    });

    it('filters BroadcastService audiences accurately by group_id (handling default and expired memberships)', async () => {
      const defaultGrp = await userGroupService.createGroup({
        name: 'Default',
        isDefault: true,
      });
      const vipGrp = await userGroupService.createGroup({
        name: 'VIP',
        discountPercent: 15,
      });

      await seedIntegrationUser(vipUserId, { balance: 0 });
      await seedIntegrationUser(regularUserId, { balance: 0 });
      await seedIntegrationUser(recipientUserId, { balance: 0 });
      await seedIntegrationUser(expiredVipUserId, { balance: 0 });
      await seedIntegrationUser(bannedVipUserId, { balance: 0, isBanned: true });

      // vipUserId -> active VIP
      await userGroupService.assignUserGroup({
        telegramId: vipUserId,
        groupId: vipGrp.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      // recipientUserId -> explicitly in default group
      await userGroupService.assignUserGroup({
        telegramId: recipientUserId,
        groupId: defaultGrp.id,
      });
      // regularUserId -> ungrouped (transparently default)
      // expiredVipUserId -> expired VIP (transparently default)
      await userGroupService.assignUserGroup({
        telegramId: expiredVipUserId,
        groupId: vipGrp.id,
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      // bannedVipUserId -> banned active VIP (must be excluded from broadcasts)
      await userGroupService.assignUserGroup({
        telegramId: bannedVipUserId,
        groupId: vipGrp.id,
      });

      const vipCount = await broadcastService.countAudience('all', vipGrp.id);
      expect(vipCount).toBe(1);

      const defaultCount = await broadcastService.countAudience('all', defaultGrp.id);
      expect(defaultCount).toBe(3); // regularUserId + recipientUserId + expiredVipUserId

      const job = await broadcastService.createJob({
        actorTelegramId: 999,
        audience: 'all',
        groupId: vipGrp.id,
        message: 'VIP exclusive announcement',
      });
      expect(job.recipientCount).toBe(1);

      const [persistedJob] = await getDb()
        .select()
        .from(broadcastJobs)
        .where(eq(broadcastJobs.id, job.id));
      expect(persistedJob?.groupId).toBe(vipGrp.id);

      const recipients = await getDb()
        .select()
        .from(broadcastRecipients)
        .where(eq(broadcastRecipients.jobId, job.id));
      expect(recipients.map((r) => r.telegramId)).toEqual([vipUserId]);
    });
  }
);
