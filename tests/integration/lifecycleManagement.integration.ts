import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDb, getPool, initDatabase } from '../../src/infra/db.js';
import { autoMigrate } from '../../src/infra/migrate.js';
import {
  botAdmins,
  broadcastJobs,
  broadcastRecipients,
  configReconciliationIssues,
  purchaseIntents,
  refundIntents,
  userConfigs,
  users,
  walletTransactions,
} from '../../src/infra/schema.js';
import { AdminService, LastAdminRemovalError } from '../../src/domain/services/AdminService.js';
import { ConfigTransferService } from '../../src/domain/services/ConfigTransferService.js';
import { RefundService } from '../../src/domain/services/RefundService.js';
import { ConfigReconciliationService } from '../../src/domain/services/ConfigReconciliationService.js';
import { BroadcastService } from '../../src/domain/services/BroadcastService.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import { RebeccaApiError } from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

function remoteUser(username: string): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * 1024 ** 3,
    expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
    created_at: new Date().toISOString(),
    subscription_url: `https://rebecca.example/sub/${username}`,
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
    service_name: null,
    admin_username: null,
  };
}

integration('subscription lifecycle management', () => {
  beforeAll(async () => {
    initDatabase(databaseUrl!);
    await autoMigrate(getDb());
  });

  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE TABLE bot_admins, broadcast_jobs, config_reconciliation_issues, refund_intents, users CASCADE'
    );
  });

  afterAll(async () => {
    if (databaseUrl) await closeDatabase();
  });

  it('keeps the database admin registry authoritative after bootstrap', async () => {
    const admins = new AdminService();
    await admins.initialize([100]);
    expect(admins.adminIds).toEqual([100]);

    await expect(admins.addAdmin(200, 100)).resolves.toBe(true);
    await expect(admins.removeAdmin(100, 200)).resolves.toBe(true);
    expect(admins.adminIds).toEqual([200]);

    const afterRestart = new AdminService();
    await afterRestart.initialize([999]);
    expect(afterRestart.adminIds).toEqual([200]);
    await expect(afterRestart.removeAdmin(200, 200)).rejects.toBeInstanceOf(LastAdminRemovalError);

    const rows = await getDb().select().from(botAdmins);
    expect(rows.map((row) => row.telegramId)).toEqual([200]);
  });

  it('serializes concurrent admin removals so the registry can never become empty', async () => {
    const admins = new AdminService();
    await admins.initialize([110, 120]);

    const results = await Promise.allSettled([
      admins.removeAdmin(110, 120),
      admins.removeAdmin(120, 110),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows = await getDb().select().from(botAdmins);
    expect(rows).toHaveLength(1);
  });

  it('transfers ownership atomically without touching the Rebecca identity', async () => {
    await getDb()
      .insert(users)
      .values([
        { telegramId: 301, referralCode: 'ref_301', balance: 0 },
        { telegramId: 302, referralCode: 'ref_302', balance: 0 },
      ]);
    await getDb().insert(userConfigs).values({
      id: 'uc_transfer_test',
      telegramId: 301,
      configUsername: 'transfer_test',
      panelStatus: 'active',
      autoRenewEnabled: true,
      autoRenewPackageId: 'pkg_1',
    });

    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser('transfer_test')),
    } as unknown as RebeccaService;
    const service = new ConfigTransferService(rebeccaService);
    await service.transfer({
      configId: 'uc_transfer_test',
      fromTelegramId: 301,
      toTelegramId: 302,
      actorTelegramId: 301,
    });

    const [config] = await getDb()
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.id, 'uc_transfer_test'));
    expect(config).toMatchObject({
      telegramId: 302,
      autoRenewEnabled: false,
      autoRenewPackageId: null,
    });
    expect(rebeccaService.getUser).toHaveBeenCalledWith('transfer_test');
  });

  it('deletes a never-used paid service and refunds its charged amount exactly once', async () => {
    const telegramId = 401;
    await getDb().insert(users).values({
      telegramId,
      referralCode: 'ref_401',
      balance: 200,
      totalSpend: 800,
    });
    await getDb().insert(purchaseIntents).values({
      id: 'pi_refund_source',
      telegramId,
      amount: 800,
      type: 'new_config',
      status: 'completed',
      configUsername: 'refund_test',
      gbAmount: 10,
      durationDays: 30,
      bonusesProcessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await getDb().insert(walletTransactions).values({
      id: 'tx_refund_purchase',
      telegramId,
      amount: -800,
      balanceAfter: 200,
      type: 'purchase',
      referenceId: 'pi_refund_source',
      description: 'integration purchase',
    });
    await getDb().insert(userConfigs).values({
      id: 'uc_refund_test',
      telegramId,
      configUsername: 'refund_test',
      panelStatus: 'active',
    });

    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser('refund_test')),
      deleteUser: vi.fn().mockResolvedValue({ username: 'refund_test', status: 'deleted' }),
    } as unknown as RebeccaService;
    const translationService = {
      getSettingNum: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as TranslationService;
    const service = new RefundService(rebeccaService, translationService);

    const result = await service.executeDeleteWithRefund(telegramId, 'uc_refund_test');
    expect(result).toMatchObject({ eligible: true, grossAmount: 800, refundAmount: 800 });

    const [wallet] = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    const configs = await getDb().select().from(userConfigs);
    const refunds = await getDb().select().from(refundIntents);
    const ledger = await getDb()
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.type, 'refund'));
    expect(wallet).toMatchObject({ balance: 1_000, totalSpend: 0 });
    expect(configs).toHaveLength(0);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.status).toBe('completed');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amount).toBe(800);

    await expect(service.executeDeleteWithRefund(telegramId, 'uc_refund_test')).resolves.toEqual({
      eligible: false,
      reason: 'config_not_found',
    });
    expect(rebeccaService.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('re-checks usage at confirmation time and refuses a stale unused quote', async () => {
    const telegramId = 425;
    await getDb().insert(users).values({
      telegramId,
      referralCode: 'ref_425',
      balance: 100,
      totalSpend: 900,
    });
    await getDb().insert(purchaseIntents).values({
      id: 'pi_refund_usage_race',
      telegramId,
      amount: 900,
      type: 'new_config',
      status: 'completed',
      configUsername: 'refund_usage_race',
      gbAmount: 10,
      durationDays: 30,
      bonusesProcessedAt: new Date(),
    });
    await getDb().insert(userConfigs).values({
      id: 'uc_refund_usage_race',
      telegramId,
      configUsername: 'refund_usage_race',
      panelStatus: 'active',
    });

    const rebeccaService = {
      getUser: vi
        .fn()
        .mockResolvedValueOnce(remoteUser('refund_usage_race'))
        .mockResolvedValueOnce({
          ...remoteUser('refund_usage_race'),
          used_traffic: 1024,
          lifetime_used_traffic: 1024,
        }),
      deleteUser: vi.fn(),
    } as unknown as RebeccaService;
    const translationService = {
      getSettingNum: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as TranslationService;
    const service = new RefundService(rebeccaService, translationService);

    await expect(
      service.executeDeleteWithRefund(telegramId, 'uc_refund_usage_race')
    ).resolves.toEqual({ eligible: false, reason: 'already_used' });
    expect(rebeccaService.deleteUser).not.toHaveBeenCalled();

    const [wallet] = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    const [intent] = await getDb().select().from(refundIntents);
    expect(wallet).toMatchObject({ balance: 100, totalSpend: 900 });
    expect(intent?.status).toBe('failed');
  });

  it('reuses a failed refund intent safely on retry instead of double-crediting', async () => {
    const telegramId = 451;
    await getDb().insert(users).values({
      telegramId,
      referralCode: 'ref_451',
      balance: 100,
      totalSpend: 900,
    });
    await getDb().insert(purchaseIntents).values({
      id: 'pi_refund_retry',
      telegramId,
      amount: 900,
      type: 'new_config',
      status: 'completed',
      configUsername: 'refund_retry',
      gbAmount: 10,
      durationDays: 30,
      bonusesProcessedAt: new Date(),
    });
    await getDb().insert(userConfigs).values({
      id: 'uc_refund_retry',
      telegramId,
      configUsername: 'refund_retry',
      panelStatus: 'active',
    });

    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser('refund_retry')),
      deleteUser: vi
        .fn()
        .mockRejectedValueOnce(new RebeccaApiError(400, '/api/user/refund_retry', 'failed'))
        .mockResolvedValueOnce({ username: 'refund_retry', status: 'deleted' }),
    } as unknown as RebeccaService;
    const translationService = {
      getSettingNum: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as TranslationService;
    const service = new RefundService(rebeccaService, translationService);

    await expect(
      service.executeDeleteWithRefund(telegramId, 'uc_refund_retry')
    ).rejects.toBeInstanceOf(RebeccaApiError);
    await expect(
      service.executeDeleteWithRefund(telegramId, 'uc_refund_retry')
    ).resolves.toMatchObject({
      eligible: true,
      refundAmount: 900,
    });

    const refunds = await getDb().select().from(refundIntents);
    const ledger = await getDb()
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.type, 'refund'));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.status).toBe('completed');
    expect(ledger).toHaveLength(1);
  });

  it('snapshots segmented broadcast audiences and persists progress/cancellation', async () => {
    await getDb()
      .insert(users)
      .values([
        { telegramId: 601, referralCode: 'ref_601', balance: 0 },
        { telegramId: 602, referralCode: 'ref_602', balance: 0 },
        { telegramId: 603, referralCode: 'ref_603', balance: 0 },
        { telegramId: 604, referralCode: 'ref_604', balance: 0, isBanned: true },
      ]);
    await getDb()
      .insert(userConfigs)
      .values([
        {
          id: 'uc_broadcast_active',
          telegramId: 601,
          configUsername: 'broadcast_active',
          panelStatus: 'active',
        },
        {
          id: 'uc_broadcast_inactive',
          telegramId: 603,
          configUsername: 'broadcast_inactive',
          panelStatus: 'expired',
        },
      ]);
    const broadcasts = new BroadcastService();
    await expect(broadcasts.countAudience('all')).resolves.toBe(3);
    await expect(broadcasts.countAudience('active_subscription')).resolves.toBe(1);
    await expect(broadcasts.countAudience('no_subscription')).resolves.toBe(1);
    await expect(broadcasts.countAudience('no_active_subscription')).resolves.toBe(1);

    const job = await broadcasts.createJob({
      actorTelegramId: 601,
      audience: 'all',
      message: 'integration broadcast',
    });
    expect(job.recipientCount).toBe(3);
    await broadcasts.markRunning(job.id);
    const firstBatch = await broadcasts.claimBatch(job.id, 2);
    expect(firstBatch).toHaveLength(2);
    await broadcasts.markRecipientSent(job.id, firstBatch[0]!);
    await broadcasts.markRecipientFailed(job.id, firstBatch[1]!, new Error('blocked'));
    const secondBatch = await broadcasts.claimBatch(job.id, 2);
    expect(secondBatch).toHaveLength(1);
    await broadcasts.markRecipientSent(job.id, secondBatch[0]!);
    await expect(broadcasts.finalizeCompleted(job.id)).resolves.toBe(true);

    const [completed] = await getDb()
      .select()
      .from(broadcastJobs)
      .where(eq(broadcastJobs.id, job.id));
    expect(completed).toMatchObject({
      status: 'completed',
      recipientCount: 3,
      sentCount: 2,
      failedCount: 1,
    });

    const cancellable = await broadcasts.createJob({
      actorTelegramId: 601,
      audience: 'no_active_subscription',
      message: 'cancel me',
    });
    await expect(broadcasts.requestCancel(cancellable.id, 601)).resolves.toBe(true);
    await expect(broadcasts.finalizeCancelled(cancellable.id)).resolves.toBe(true);
    const recipients = await getDb()
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.jobId, cancellable.id));
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.status).toBe('cancelled');
  });

  it('records both local-missing and remote-unbound orphan classes', async () => {
    await getDb().insert(users).values({ telegramId: 501, referralCode: 'ref_501', balance: 0 });
    await getDb().insert(userConfigs).values({
      id: 'uc_local_missing',
      telegramId: 501,
      configUsername: 'local_missing',
      panelStatus: 'active',
    });

    const remoteOnly = remoteUser('remote_only');
    const rebeccaService = {
      getUser: vi.fn(async (username: string) => {
        if (username === 'local_missing') {
          throw new RebeccaApiError(404, `/api/user/${username}`, 'missing');
        }
        return remoteOnly;
      }),
      getUsers: vi.fn().mockResolvedValue({
        users: [remoteOnly],
        total: 1,
        status_breakdown: { active: 1 },
      }),
    } as unknown as RebeccaService;
    const service = new ConfigReconciliationService(rebeccaService);
    await expect(service.scan()).resolves.toEqual({
      localMissingRemote: 1,
      remoteUnbound: 1,
      remoteIgnored: 0,
      failedPanels: [],
    });

    const issues = await getDb().select().from(configReconciliationIssues);
    expect(issues.map((issue) => issue.kind).sort()).toEqual([
      'local_missing_remote',
      'remote_unbound',
    ]);
  });

  it('baselines existing manual Rebecca services without hiding later service incarnations', async () => {
    await getDb().insert(users).values({ telegramId: 701, referralCode: 'ref_701', balance: 0 });
    await getDb().insert(userConfigs).values({
      id: 'uc_baseline_bound',
      telegramId: 701,
      configUsername: 'bot_managed',
      panelStatus: 'active',
    });

    const botManaged = remoteUser('bot_managed');
    botManaged.created_at = '2026-01-01T00:00:00Z';
    const manualExisting = remoteUser('manual_existing');
    manualExisting.created_at = '2026-02-01T00:00:00Z';
    let snapshot = [botManaged, manualExisting];
    const rebeccaService = {
      getUsers: vi.fn(async () => ({
        users: snapshot,
        total: snapshot.length,
        status_breakdown: { active: snapshot.length },
      })),
    } as unknown as RebeccaService;
    const service = new ConfigReconciliationService(rebeccaService);

    await expect(service.establishRemoteBaseline(999)).resolves.toEqual({
      remoteTotal: 2,
      alreadyBound: 1,
      ignoredUnbound: 1,
    });
    const [baselineIssue] = await getDb()
      .select()
      .from(configReconciliationIssues)
      .where(eq(configReconciliationIssues.configUsername, 'manual_existing'));
    expect(baselineIssue).toMatchObject({
      kind: 'remote_unbound',
      status: 'ignored',
      remoteCreatedAt: 'created:2026-02-01T00:00:00Z',
    });

    await expect(service.scan()).resolves.toEqual({
      localMissingRemote: 0,
      remoteUnbound: 0,
      remoteIgnored: 1,
      failedPanels: [],
    });

    // Reusing the same username for a different Rebecca service must not inherit
    // the old baseline ignore. A genuinely new unbound service is also open.
    const recreated = remoteUser('manual_existing');
    recreated.created_at = '2026-06-01T00:00:00Z';
    const newManual = remoteUser('manual_new');
    newManual.created_at = '2026-06-02T00:00:00Z';
    snapshot = [botManaged, recreated, newManual];

    await expect(service.scan()).resolves.toEqual({
      localMissingRemote: 0,
      remoteUnbound: 2,
      remoteIgnored: 0,
      failedPanels: [],
    });
    const actionable = await service.listIssues(1, 10);
    expect(actionable.issues.map((issue) => issue.configUsername).sort()).toEqual([
      'manual_existing',
      'manual_new',
    ]);
  });
});
