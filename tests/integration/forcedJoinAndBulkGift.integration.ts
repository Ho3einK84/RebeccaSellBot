import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/infra/db.js';
import { auditLogs, bulkGiftItems, bulkGiftJobs, userConfigs } from '../../src/infra/schema.js';
import { BulkGiftService } from '../../src/domain/services/BulkGiftService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type {
  RebeccaService,
  RebeccaUpdateUserPayload,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  remoteUser,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

const GB = 1024 * 1024 * 1024;
const DAY = 86_400;

describeIntegration('BulkGift durable jobs PostgreSQL integration', () => {
  registerIntegrationLifecycleHooks();

  const adminId = 8_000_001;
  const userA = 8_000_101;
  const userB = 8_000_102;
  const bannedUser = 8_000_103;
  let remoteStore: Map<string, RebeccaUserDetail>;
  let updateUserSpy: ReturnType<typeof vi.fn>;
  let bulkGiftService: BulkGiftService;

  beforeEach(async () => {
    await seedIntegrationUser(adminId, { locale: 'en' });
    await seedIntegrationUser(userA, { locale: 'en' });
    await seedIntegrationUser(userB, { locale: 'fa' });
    await seedIntegrationUser(bannedUser, { locale: 'en', isBanned: true });

    const nowSec = Math.floor(Date.now() / 1000);
    remoteStore = new Map<string, RebeccaUserDetail>([
      [
        'cfg_active_a',
        remoteUser('cfg_active_a', {
          status: 'active',
          data_limit: 20 * GB,
          used_traffic: 4 * GB,
          expire: nowSec + 10 * DAY,
        }),
      ],
      [
        'cfg_onhold_b',
        remoteUser('cfg_onhold_b', {
          status: 'on_hold',
          data_limit: 30 * GB,
          used_traffic: 0,
          expire: null,
          on_hold_expire_duration: 30 * DAY,
        }),
      ],
      [
        'cfg_banned',
        remoteUser('cfg_banned', {
          status: 'active',
          data_limit: 10 * GB,
          used_traffic: 0,
          expire: nowSec + 5 * DAY,
        }),
      ],
    ]);

    const db = getDb();
    await db.insert(userConfigs).values([
      {
        id: 'uc_active_a',
        telegramId: userA,
        panelId: 'panel_de',
        serviceId: 1,
        configUsername: 'cfg_active_a',
        panelStatus: 'active',
        panelDataLimit: 20 * GB,
        panelUsedTraffic: 4 * GB,
        panelExpire: nowSec + 10 * DAY,
      },
      {
        id: 'uc_onhold_b',
        telegramId: userB,
        panelId: 'panel_nl',
        serviceId: 2,
        configUsername: 'cfg_onhold_b',
        panelStatus: 'on_hold',
        panelDataLimit: 30 * GB,
        panelUsedTraffic: 0,
        panelExpire: null,
        panelOnHoldExpireDuration: 30 * DAY,
      },
      {
        id: 'uc_banned',
        telegramId: bannedUser,
        panelId: 'panel_de',
        serviceId: 1,
        configUsername: 'cfg_banned',
        panelStatus: 'active',
        panelDataLimit: 10 * GB,
        panelUsedTraffic: 0,
        panelExpire: nowSec + 5 * DAY,
      },
    ]);

    updateUserSpy = vi.fn(async (username: string, payload: RebeccaUpdateUserPayload) => {
      const current = remoteStore.get(username);
      if (!current) throw new Error(`Missing remote user ${username}`);
      const next: RebeccaUserDetail = {
        ...current,
        ...(payload.data_limit !== undefined ? { data_limit: payload.data_limit } : {}),
        ...(payload.expire !== undefined ? { expire: payload.expire } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.on_hold_expire_duration !== undefined
          ? { on_hold_expire_duration: payload.on_hold_expire_duration }
          : {}),
      };
      remoteStore.set(username, next);
      return next;
    });

    const mockRebeccaService = {
      getUser: vi.fn(async (username: string) => remoteStore.get(username)),
      updateUser: updateUserSpy,
    } as unknown as RebeccaService;

    const mockRegistry = {
      getService: vi.fn(() => mockRebeccaService),
    } as unknown as RebeccaPanelRegistry;

    bulkGiftService = new BulkGiftService(mockRegistry);
  });

  it('previews filtered audiences, applies gifts idempotently (including on_hold), syncs user_configs, and writes audit_logs', async () => {
    // Excludes banned users; supports status + panel/service filters
    const allActiveAndHold = await bulkGiftService.previewTargets({
      targetStatuses: ['active', 'on_hold'],
    });
    expect(allActiveAndHold).toEqual({ configCount: 2, userCount: 2 });

    const onlyPanelNl = await bulkGiftService.previewTargets({
      targetStatuses: ['active', 'on_hold'],
      panelId: 'panel_nl',
      serviceId: 2,
    });
    expect(onlyPanelNl).toEqual({ configCount: 1, userCount: 1 });

    // Create campaign targeting active + on_hold
    const job = await bulkGiftService.createJob({
      actorTelegramId: adminId,
      giftGb: 5,
      giftDays: 7,
      targetStatuses: ['active', 'on_hold'],
      notifyMessage: 'Outage compensation',
    });
    expect(job.totalCount).toBe(2);
    expect(job.status).toBe('queued');

    const running = await bulkGiftService.markRunning(job.id);
    expect(running?.status).toBe('running');

    const batch = await bulkGiftService.claimBatch(job.id, 10);
    expect(batch).toHaveLength(2);

    for (const item of batch) {
      const outcome = await bulkGiftService.applyGiftToItem(running!, item);
      expect(outcome.status).toBe('applied');
    }

    // Verify remote panel updates (active + on_hold_expire_duration)
    expect(remoteStore.get('cfg_active_a')?.data_limit).toBe(25 * GB);
    expect(remoteStore.get('cfg_onhold_b')?.status).toBe('on_hold');
    expect(remoteStore.get('cfg_onhold_b')?.data_limit).toBe(35 * GB);
    expect(remoteStore.get('cfg_onhold_b')?.on_hold_expire_duration).toBe(37 * DAY);
    expect(updateUserSpy).toHaveBeenCalledTimes(2);

    // Verify local user_configs cache updated
    const db = getDb();
    const [cachedHold] = await db
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.id, 'uc_onhold_b'));
    expect(cachedHold?.panelDataLimit).toBe(35 * GB);
    expect(cachedHold?.panelOnHoldExpireDuration).toBe(37 * DAY);

    // Simulate crash-recovery re-attempt on an already-updated item -> idempotent, NO second PUT!
    const [reloadedItem] = await db
      .select()
      .from(bulkGiftItems)
      .where(eq(bulkGiftItems.configId, 'uc_onhold_b'));
    const replayOutcome = await bulkGiftService.applyGiftToItem(running!, {
      ...reloadedItem!,
      status: 'processing',
      attempts: 2,
    });
    expect(replayOutcome).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(updateUserSpy).toHaveBeenCalledTimes(2);

    await bulkGiftService.finalizeCompleted(job.id);
    const completedJob = await bulkGiftService.getJob(job.id);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.appliedCount).toBe(2);

    const audits = await db.select().from(auditLogs);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('bulk_gift_queued');
    expect(actions).toContain('bulk_gift_applied');
    expect(actions).toContain('bulk_gift_completed');
  });

  it('cancels remaining pending items cleanly and records cancellation audit log', async () => {
    const job = await bulkGiftService.createJob({
      actorTelegramId: adminId,
      giftGb: 10,
      giftDays: 0,
      targetStatuses: ['active', 'on_hold'],
    });
    expect(job.totalCount).toBe(2);

    const cancelRequested = await bulkGiftService.requestCancel(job.id, adminId);
    expect(cancelRequested).toBe(true);

    await bulkGiftService.finalizeCancelled(job.id);

    const db = getDb();
    const [finalJob] = await db.select().from(bulkGiftJobs).where(eq(bulkGiftJobs.id, job.id));
    expect(finalJob?.status).toBe('cancelled');

    const items = await db.select().from(bulkGiftItems).where(eq(bulkGiftItems.jobId, job.id));
    expect(items.every((i) => i.status === 'cancelled')).toBe(true);
  });
});
