/**
 * BulkGiftService — durable, restart-safe, cancellable, and idempotent campaign
 * engine for gifting traffic (GB) and/or validity days across Rebecca services.
 *
 * Layering: interacts with panels exclusively via RebeccaPanelRegistry / RebeccaService
 * under per-config PostgreSQL advisory locks (`withConfigLock`). Never imports grammY.
 */
import crypto from 'node:crypto';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  BULK_GIFT_TARGET_STATUSES,
  bulkGiftItems,
  bulkGiftJobs,
  userConfigs,
  users,
  type BulkGiftItemRow,
  type BulkGiftJobRow,
  type BulkGiftTargetStatus,
} from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import { ConfigMutationBusyError, withConfigLock } from './ConfigLock.js';
import {
  activeConfigCountSql,
  normalizeDataLimit,
  observedConfigLifecycle,
} from './ConfigLifecycle.js';
import {
  RebeccaApiError,
  type RebeccaService,
  type RebeccaUpdateUserPayload,
  type RebeccaUserDetail,
} from './RebeccaService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import {
  normalizeRebeccaPanelAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';

export { BULK_GIFT_TARGET_STATUSES, type BulkGiftTargetStatus };
export type BulkGiftJob = BulkGiftJobRow;
export type BulkGiftItem = BulkGiftItemRow;

export interface BulkGiftFilter {
  targetStatuses: readonly BulkGiftTargetStatus[];
  panelId?: string | null;
  serviceId?: number | null;
}

export interface CreateBulkGiftJobParams extends BulkGiftFilter {
  actorTelegramId: number;
  giftGb: number;
  giftDays: number;
  notifyMessage?: string | null;
}

export interface BulkGiftPreviewResult {
  configCount: number;
  userCount: number;
}

export type BulkGiftMutationPlan =
  | { action: 'already_applied'; reason: string }
  | { action: 'skip'; reason: string }
  | {
      action: 'update';
      payload: RebeccaUpdateUserPayload;
      previousDataLimit: number | null;
      newDataLimit: number | null;
      previousExpire: number | null;
      newExpire: number | null;
      previousOnHoldDuration: number | null;
      newOnHoldDuration: number | null;
    };

export interface ApplyBulkGiftItemOutcome {
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
  alreadyApplied?: boolean;
  newDataLimit?: number | null;
  newExpire?: number | null;
  newOnHoldDuration?: number | null;
}

export class BulkGiftError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_GIFT_AMOUNT'
      | 'INVALID_TARGET_STATUSES'
      | 'INVALID_PANEL_FILTER'
      | 'INVALID_SERVICE_FILTER'
      | 'INVALID_NOTIFY_MESSAGE'
      | 'BULK_GIFT_JOB_CREATE_FAILED',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'BulkGiftError';
  }
}

export const MAX_BULK_GIFT_GB = 10_000;
export const MAX_BULK_GIFT_DAYS = 3_650;
export const MAX_BULK_GIFT_MESSAGE_LENGTH = 3_800;

const BYTES_PER_GB = 1024 * 1024 * 1024;
const SECONDS_PER_DAY = 86_400;
const RUNNABLE_STATUSES = ['queued', 'running', 'cancel_requested'] as const;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const VALID_TARGET_STATUS_SET = new Set<string>(BULK_GIFT_TARGET_STATUSES);

export function normalizeBulkGiftStatuses(
  raw: readonly string[] | undefined | null
): BulkGiftTargetStatus[] {
  if (!Array.isArray(raw)) return [];
  const unique: BulkGiftTargetStatus[] = [];
  for (const item of raw) {
    const trimmed = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (VALID_TARGET_STATUS_SET.has(trimmed) && !unique.includes(trimmed as BulkGiftTargetStatus)) {
      unique.push(trimmed as BulkGiftTargetStatus);
    }
  }
  return unique;
}

export function parseBulkGiftStatusesJson(raw: string): BulkGiftTargetStatus[] {
  try {
    const parsed = JSON.parse(raw);
    return normalizeBulkGiftStatuses(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

/**
 * Pure deterministic calculation of the panel update needed to apply a bulk gift
 * to a single live Rebecca user.
 *
 * Guarantees:
 * - Crash-recovery idempotency: if a prior attempt already wrote planned target
 *   values and the live panel already meets/exceeds them, never double-gifts.
 * - `on_hold` services add days to `on_hold_expire_duration` while preserving `on_hold` status.
 * - Unlimited traffic (`data_limit == null`) and never-expiring (`expire == null`) plans
 *   are never accidentally downgraded to finite limits.
 * - `limited` services reactivate to `active` when gifted traffic lifts `data_limit > used_traffic`.
 * - `disabled` and `deleted` services are skipped safely.
 */
export function computeBulkGiftMutation(
  remote: Pick<
    RebeccaUserDetail,
    'status' | 'data_limit' | 'used_traffic' | 'expire' | 'on_hold_expire_duration'
  >,
  gift: { giftGb: number; giftDays: number },
  item: Pick<
    BulkGiftItem,
    'attempts' | 'newDataLimit' | 'newExpire' | 'newOnHoldDuration' | 'previousOnHoldDuration'
  >,
  nowSec = Math.floor(Date.now() / 1000)
): BulkGiftMutationPlan {
  const existingLimit = normalizeDataLimit(remote.data_limit) ?? null;
  const existingExpire =
    typeof remote.expire === 'number' && Number.isSafeInteger(remote.expire) && remote.expire > 0
      ? remote.expire
      : null;
  const existingOnHold =
    remote.status === 'on_hold' &&
    typeof remote.on_hold_expire_duration === 'number' &&
    Number.isSafeInteger(remote.on_hold_expire_duration) &&
    remote.on_hold_expire_duration > 0
      ? remote.on_hold_expire_duration
      : null;

  // Crash-recovery idempotency check: if a previous attempt recorded planned
  // mutations before crashing after PUT, verify whether the panel already has them.
  const hasRecordedPlan =
    item.attempts > 1 &&
    (item.newDataLimit != null || item.newExpire != null || item.newOnHoldDuration != null);
  if (hasRecordedPlan) {
    const limitDone =
      item.newDataLimit == null || (existingLimit !== null && existingLimit >= item.newDataLimit);
    const expireDone =
      item.newExpire == null || (existingExpire !== null && existingExpire >= item.newExpire);
    const onHoldDone =
      item.newOnHoldDuration == null ||
      (existingOnHold !== null && existingOnHold >= item.newOnHoldDuration) ||
      // If an on_hold config activated between attempts, do not add days a second time.
      (remote.status === 'active' && existingExpire !== null);

    if (limitDone && expireDone && onHoldDone) {
      return { action: 'already_applied', reason: 'ALREADY_APPLIED_ON_PANEL' };
    }
  }

  if (remote.status === 'deleted' || remote.status === 'disabled' || remote.status === 'expired') {
    return { action: 'skip', reason: `REMOTE_STATUS_${remote.status.toUpperCase()}` };
  }

  const payload: RebeccaUpdateUserPayload = {};
  let newDataLimit: number | null = null;
  let newExpire: number | null = null;
  let newOnHoldDuration: number | null = null;

  if (gift.giftGb > 0 && existingLimit !== null && existingLimit > 0) {
    const rawLimit = existingLimit + gift.giftGb * BYTES_PER_GB;
    newDataLimit = Number.isSafeInteger(rawLimit) ? rawLimit : Number.MAX_SAFE_INTEGER;
    payload.data_limit = newDataLimit;
  }

  if (gift.giftDays > 0) {
    const addSeconds = gift.giftDays * SECONDS_PER_DAY;
    if (remote.status === 'on_hold') {
      const baseOnHold = existingOnHold ?? 0;
      const rawOnHold = baseOnHold + addSeconds;
      newOnHoldDuration = Number.isSafeInteger(rawOnHold) ? rawOnHold : Number.MAX_SAFE_INTEGER;
      payload.on_hold_expire_duration = newOnHoldDuration;
      payload.status = 'on_hold';
    } else if (existingExpire !== null) {
      const baseExpire = Math.max(existingExpire, nowSec);
      const rawExpire = baseExpire + addSeconds;
      newExpire = Number.isSafeInteger(rawExpire) ? rawExpire : Number.MAX_SAFE_INTEGER;
      payload.expire = newExpire;
    }
  }

  if (
    payload.data_limit === undefined &&
    payload.expire === undefined &&
    payload.on_hold_expire_duration === undefined
  ) {
    return { action: 'skip', reason: 'NO_APPLICABLE_LIMIT_OR_EXPIRY' };
  }

  // Reactivate limited services when the gifted volume lifts quota above used traffic.
  if (remote.status === 'limited' && newDataLimit !== null && newDataLimit > remote.used_traffic) {
    const effectiveExpire = newExpire ?? existingExpire;
    if (effectiveExpire === null || effectiveExpire > nowSec) {
      payload.status = 'active';
    }
  }

  return {
    action: 'update',
    payload,
    previousDataLimit: existingLimit,
    newDataLimit,
    previousExpire: existingExpire,
    newExpire,
    previousOnHoldDuration: existingOnHold,
    newOnHoldDuration,
  };
}

export class BulkGiftService {
  private readonly panels: NormalizedRebeccaPanelAccess;

  constructor(panels: RebeccaPanelRegistry | RebeccaService) {
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  async previewTargets(filter: BulkGiftFilter): Promise<BulkGiftPreviewResult> {
    const normalized = validateFilter(filter);
    const whereClause = buildTargetWhereSql(normalized);
    const db = getDb();
    const [row] = await db
      .select({
        configCount: count(userConfigs.id),
        userCount: sql<number>`COUNT(DISTINCT ${userConfigs.telegramId})::integer`,
      })
      .from(userConfigs)
      .innerJoin(users, eq(users.telegramId, userConfigs.telegramId))
      .where(whereClause);

    return {
      configCount: Number(row?.configCount ?? 0),
      userCount: Number(row?.userCount ?? 0),
    };
  }

  async createJob(params: CreateBulkGiftJobParams): Promise<BulkGiftJob> {
    const giftGb = Math.trunc(params.giftGb);
    const giftDays = Math.trunc(params.giftDays);
    if (
      !Number.isSafeInteger(giftGb) ||
      !Number.isSafeInteger(giftDays) ||
      giftGb < 0 ||
      giftDays < 0 ||
      giftGb > MAX_BULK_GIFT_GB ||
      giftDays > MAX_BULK_GIFT_DAYS ||
      (giftGb === 0 && giftDays === 0)
    ) {
      throw new BulkGiftError(
        'INVALID_GIFT_AMOUNT',
        'Provide a valid positive GB amount (0..10000) and/or days (0..3650)'
      );
    }

    const filter = validateFilter({
      targetStatuses: params.targetStatuses,
      panelId: params.panelId,
      serviceId: params.serviceId,
    });

    const trimmedMsg =
      typeof params.notifyMessage === 'string' && params.notifyMessage.trim().length > 0
        ? params.notifyMessage.trim()
        : null;
    if (trimmedMsg && [...trimmedMsg].length > MAX_BULK_GIFT_MESSAGE_LENGTH) {
      throw new BulkGiftError(
        'INVALID_NOTIFY_MESSAGE',
        `Notification message cannot exceed ${MAX_BULK_GIFT_MESSAGE_LENGTH} characters`
      );
    }

    const db = getDb();
    const jobId = crypto.randomUUID();
    const statusesJson = JSON.stringify(filter.targetStatuses);

    return db.transaction(async (tx) => {
      await tx.insert(bulkGiftJobs).values({
        id: jobId,
        actorTelegramId: params.actorTelegramId,
        giftGb,
        giftDays,
        targetStatuses: statusesJson,
        panelId: filter.panelId,
        serviceId: filter.serviceId,
        notifyMessage: trimmedMsg,
        status: 'queued',
      });

      const statusList = sql.join(
        filter.targetStatuses.map((s) => sql`${s}`),
        sql`, `
      );
      const panelCondition = filter.panelId
        ? sql`AND ${userConfigs.panelId} = ${filter.panelId}`
        : sql``;
      const serviceCondition =
        filter.serviceId !== null ? sql`AND ${userConfigs.serviceId} = ${filter.serviceId}` : sql``;

      await tx.execute(sql`
        INSERT INTO ${bulkGiftItems} (
          "job_id",
          "config_id",
          "telegram_id",
          "panel_id",
          "service_id",
          "config_username",
          "status",
          "attempts",
          "updated_at"
        )
        SELECT
          ${jobId}::uuid,
          ${userConfigs.id},
          ${userConfigs.telegramId},
          ${userConfigs.panelId},
          ${userConfigs.serviceId},
          ${userConfigs.configUsername},
          'pending',
          0,
          NOW()
        FROM ${userConfigs}
        INNER JOIN ${users} ON ${users.telegramId} = ${userConfigs.telegramId}
        WHERE ${users.isBanned} = false
          AND ${userConfigs.panelStatus} IN (${statusList})
          ${panelCondition}
          ${serviceCondition}
        ON CONFLICT DO NOTHING
      `);

      const [itemRow] = await tx
        .select({ value: count() })
        .from(bulkGiftItems)
        .where(eq(bulkGiftItems.jobId, jobId));
      const totalCount = Number(itemRow?.value ?? 0);
      const terminal = totalCount === 0;
      const now = new Date();

      const [job] = await tx
        .update(bulkGiftJobs)
        .set({
          totalCount,
          status: terminal ? 'completed' : 'queued',
          completedAt: terminal ? now : null,
          updatedAt: now,
        })
        .where(eq(bulkGiftJobs.id, jobId))
        .returning();
      if (!job) throw new BulkGiftError('BULK_GIFT_JOB_CREATE_FAILED');

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.actorTelegramId,
        action: 'bulk_gift_queued',
        entityType: 'bulk_gift',
        entityId: jobId,
        metadata: JSON.stringify({
          giftGb,
          giftDays,
          targetStatuses: filter.targetStatuses,
          panelId: filter.panelId,
          serviceId: filter.serviceId,
          totalCount,
          hasNotifyMessage: Boolean(trimmedMsg),
        }),
      });

      return job;
    });
  }

  async getJob(jobId: string): Promise<BulkGiftJob | undefined> {
    const [job] = await getDb()
      .select()
      .from(bulkGiftJobs)
      .where(eq(bulkGiftJobs.id, jobId))
      .limit(1);
    return job;
  }

  async listRecentJobs(
    page = 1,
    pageSize = 5
  ): Promise<{
    items: BulkGiftJob[];
    total: number;
    page: number;
    totalPages: number;
    activeCount: number;
  }> {
    const db = getDb();
    const safeLimit = Math.max(1, Math.min(Math.trunc(pageSize) || 5, 20));
    const requestedPage = Math.max(1, Math.trunc(page) || 1);

    const [[totalRow], [activeRow]] = await Promise.all([
      db.select({ value: count() }).from(bulkGiftJobs),
      db
        .select({ value: count() })
        .from(bulkGiftJobs)
        .where(inArray(bulkGiftJobs.status, RUNNABLE_STATUSES)),
    ]);

    const total = Number(totalRow?.value ?? 0);
    const activeCount = Number(activeRow?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.min(requestedPage, totalPages);

    const items = await db
      .select()
      .from(bulkGiftJobs)
      .orderBy(desc(bulkGiftJobs.createdAt))
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit);

    return { items, total, page: safePage, totalPages, activeCount };
  }

  async nextRunnableJob(): Promise<BulkGiftJob | undefined> {
    const [job] = await getDb()
      .select()
      .from(bulkGiftJobs)
      .where(inArray(bulkGiftJobs.status, RUNNABLE_STATUSES))
      .orderBy(asc(bulkGiftJobs.createdAt))
      .limit(1);
    return job;
  }

  async markRunning(jobId: string): Promise<BulkGiftJob | undefined> {
    const now = new Date();
    const [updated] = await getDb()
      .update(bulkGiftJobs)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(bulkGiftJobs.id, jobId), eq(bulkGiftJobs.status, 'queued')))
      .returning();
    if (updated) return updated;
    return this.getJob(jobId);
  }

  async requestCancel(jobId: string, actorTelegramId: number): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [job] = await tx
        .update(bulkGiftJobs)
        .set({ status: 'cancel_requested', updatedAt: new Date() })
        .where(and(eq(bulkGiftJobs.id, jobId), inArray(bulkGiftJobs.status, ['queued', 'running'])))
        .returning({ id: bulkGiftJobs.id });
      if (!job) return false;
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'bulk_gift_cancel_requested',
        entityType: 'bulk_gift',
        entityId: jobId,
      });
      return true;
    });
  }

  async requeueStaleClaims(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
    const rows = await getDb()
      .update(bulkGiftItems)
      .set({ status: 'pending', claimedAt: null, updatedAt: now })
      .where(and(eq(bulkGiftItems.status, 'processing'), lt(bulkGiftItems.claimedAt, cutoff)))
      .returning({ configId: bulkGiftItems.configId });
    return rows.length;
  }

  async claimBatch(jobId: string, requestedLimit = 10): Promise<BulkGiftItem[]> {
    const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 50));
    const db = getDb();
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ configId: bulkGiftItems.configId })
        .from(bulkGiftItems)
        .where(and(eq(bulkGiftItems.jobId, jobId), eq(bulkGiftItems.status, 'pending')))
        .orderBy(asc(bulkGiftItems.configId))
        .limit(limit);
      if (candidates.length === 0) return [];
      const ids = candidates.map((row) => row.configId);
      const now = new Date();
      return tx
        .update(bulkGiftItems)
        .set({
          status: 'processing',
          attempts: sql`${bulkGiftItems.attempts} + 1`,
          claimedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(bulkGiftItems.jobId, jobId),
            eq(bulkGiftItems.status, 'pending'),
            inArray(bulkGiftItems.configId, ids)
          )
        )
        .returning();
    });
  }

  /**
   * Apply a bulk gift to a single claimed item under `withConfigLock`:
   * 1. Reads live state from `RebeccaService.getUser`.
   * 2. Computes idempotent mutation (including `on_hold_expire_duration` for `on_hold`).
   * 3. Persists planned mutation before calling `updateUser` for crash-safe idempotency.
   * 4. Updates local `user_configs` cache and `users.activeSubscriptionCount`.
   * 5. Records an `audit_logs` entry and updates campaign counters.
   */
  async applyGiftToItem(job: BulkGiftJob, item: BulkGiftItem): Promise<ApplyBulkGiftItemOutcome> {
    try {
      return await withConfigLock(item.panelId, item.configUsername, async () => {
        const rebeccaService = this.panels.getService(item.panelId);
        let remote: RebeccaUserDetail;
        try {
          remote = await rebeccaService.getUser(item.configUsername);
        } catch (err) {
          if (err instanceof RebeccaApiError && err.status === 404) {
            await this.finishItem(job, item, 'skipped', { lastError: 'REMOTE_CONFIG_NOT_FOUND' });
            return { status: 'skipped', reason: 'REMOTE_CONFIG_NOT_FOUND' };
          }
          throw err;
        }

        const plan = computeBulkGiftMutation(
          remote,
          { giftGb: job.giftGb, giftDays: job.giftDays },
          item
        );

        if (plan.action === 'already_applied') {
          await this.syncLocalConfigAndCompleteItem(job, item, remote, {
            alreadyApplied: true,
            newDataLimit: item.newDataLimit,
            newExpire: item.newExpire,
            newOnHoldDuration: item.newOnHoldDuration,
          });
          return {
            status: 'applied',
            alreadyApplied: true,
            newDataLimit: item.newDataLimit,
            newExpire: item.newExpire,
            newOnHoldDuration: item.newOnHoldDuration,
          };
        }

        if (plan.action === 'skip') {
          await this.finishItem(job, item, 'skipped', { lastError: plan.reason });
          return { status: 'skipped', reason: plan.reason };
        }

        // Persist planned target values BEFORE calling PUT so a crash after remote
        // mutation never causes a double gift on retry.
        await getDb()
          .update(bulkGiftItems)
          .set({
            previousDataLimit: plan.previousDataLimit,
            newDataLimit: plan.newDataLimit,
            previousExpire: plan.previousExpire,
            newExpire: plan.newExpire,
            previousOnHoldDuration: plan.previousOnHoldDuration,
            newOnHoldDuration: plan.newOnHoldDuration,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bulkGiftItems.jobId, job.id),
              eq(bulkGiftItems.configId, item.configId),
              eq(bulkGiftItems.status, 'processing')
            )
          );

        const updatedRemote = await rebeccaService.updateUser(item.configUsername, plan.payload);

        await this.syncLocalConfigAndCompleteItem(job, item, updatedRemote, {
          alreadyApplied: false,
          newDataLimit: plan.newDataLimit,
          newExpire: plan.newExpire,
          newOnHoldDuration: plan.newOnHoldDuration,
        });

        return {
          status: 'applied',
          alreadyApplied: false,
          newDataLimit: plan.newDataLimit,
          newExpire: plan.newExpire,
          newOnHoldDuration: plan.newOnHoldDuration,
        };
      });
    } catch (err) {
      const reason =
        err instanceof ConfigMutationBusyError ? 'CONFIG_MUTATION_BUSY' : errorMessage(err);
      await this.finishItem(job, item, 'failed', { lastError: reason });
      logger.warn(
        { err, jobId: job.id, configId: item.configId, configUsername: item.configUsername },
        'Bulk gift item failed'
      );
      return { status: 'failed', reason };
    }
  }

  async markItemNotified(jobId: string, configId: string): Promise<void> {
    await getDb()
      .update(bulkGiftItems)
      .set({ notifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(bulkGiftItems.jobId, jobId), eq(bulkGiftItems.configId, configId)));
  }

  async finalizeCompleted(jobId: string): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [remaining] = await tx
        .select({ value: count() })
        .from(bulkGiftItems)
        .where(
          and(
            eq(bulkGiftItems.jobId, jobId),
            inArray(bulkGiftItems.status, ['pending', 'processing'])
          )
        );
      if (Number(remaining?.value ?? 0) > 0) return false;

      const now = new Date();
      const [job] = await tx
        .update(bulkGiftJobs)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(and(eq(bulkGiftJobs.id, jobId), eq(bulkGiftJobs.status, 'running')))
        .returning();
      if (!job) return false;

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: job.actorTelegramId,
        action: 'bulk_gift_completed',
        entityType: 'bulk_gift',
        entityId: jobId,
        metadata: JSON.stringify({
          totalCount: job.totalCount,
          appliedCount: job.appliedCount,
          failedCount: job.failedCount,
          skippedCount: job.skippedCount,
        }),
      });
      return true;
    });
  }

  async finalizeCancelled(jobId: string): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(bulkGiftJobs)
        .where(and(eq(bulkGiftJobs.id, jobId), eq(bulkGiftJobs.status, 'cancel_requested')))
        .limit(1);
      if (!job) return false;

      const [remaining] = await tx
        .select({ value: count() })
        .from(bulkGiftItems)
        .where(
          and(
            eq(bulkGiftItems.jobId, jobId),
            inArray(bulkGiftItems.status, ['pending', 'processing'])
          )
        );

      const now = new Date();
      if (Number(remaining?.value ?? 0) === 0) {
        const [completed] = await tx
          .update(bulkGiftJobs)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(and(eq(bulkGiftJobs.id, jobId), eq(bulkGiftJobs.status, 'cancel_requested')))
          .returning({ id: bulkGiftJobs.id });
        if (!completed) return false;
        await tx.insert(auditLogs).values({
          id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          actorTelegramId: job.actorTelegramId,
          action: 'bulk_gift_completed',
          entityType: 'bulk_gift',
          entityId: jobId,
          metadata: JSON.stringify({ cancellationArrivedAfterCompletion: true }),
        });
        return true;
      }

      await tx
        .update(bulkGiftItems)
        .set({ status: 'cancelled', claimedAt: null, updatedAt: now })
        .where(
          and(
            eq(bulkGiftItems.jobId, jobId),
            inArray(bulkGiftItems.status, ['pending', 'processing'])
          )
        );

      const [updated] = await tx
        .update(bulkGiftJobs)
        .set({ status: 'cancelled', completedAt: now, updatedAt: now })
        .where(and(eq(bulkGiftJobs.id, jobId), eq(bulkGiftJobs.status, 'cancel_requested')))
        .returning({ id: bulkGiftJobs.id });
      if (!updated) return false;

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: job.actorTelegramId,
        action: 'bulk_gift_cancelled',
        entityType: 'bulk_gift',
        entityId: jobId,
        metadata: JSON.stringify({
          appliedCount: job.appliedCount,
          failedCount: job.failedCount,
          skippedCount: job.skippedCount,
        }),
      });
      return true;
    });
  }

  private async syncLocalConfigAndCompleteItem(
    job: BulkGiftJob,
    item: BulkGiftItem,
    updatedRemote: RebeccaUserDetail,
    meta: {
      alreadyApplied: boolean;
      newDataLimit: number | null;
      newExpire: number | null;
      newOnHoldDuration: number | null;
    }
  ): Promise<boolean> {
    const db = getDb();
    const observedAt = new Date();

    return db.transaction(async (tx) => {
      const [finished] = await tx
        .update(bulkGiftItems)
        .set({
          status: 'applied',
          appliedAt: observedAt,
          claimedAt: null,
          lastError: null,
          updatedAt: observedAt,
        })
        .where(
          and(
            eq(bulkGiftItems.jobId, job.id),
            eq(bulkGiftItems.configId, item.configId),
            eq(bulkGiftItems.status, 'processing')
          )
        )
        .returning({ configId: bulkGiftItems.configId });
      if (!finished) return false;

      await tx
        .update(userConfigs)
        .set(observedConfigLifecycle(updatedRemote, observedAt))
        .where(eq(userConfigs.id, item.configId));

      await tx
        .update(users)
        .set({
          activeSubscriptionCount: activeConfigCountSql(item.telegramId),
          updatedAt: observedAt,
        })
        .where(eq(users.telegramId, item.telegramId));

      await tx
        .update(bulkGiftJobs)
        .set({
          appliedCount: sql`${bulkGiftJobs.appliedCount} + 1`,
          updatedAt: observedAt,
        })
        .where(eq(bulkGiftJobs.id, job.id));

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: job.actorTelegramId,
        action: 'bulk_gift_applied',
        entityType: 'bulk_gift_item',
        entityId: `${job.id}:${item.configId}`,
        targetTelegramId: item.telegramId,
        metadata: JSON.stringify({
          jobId: job.id,
          configId: item.configId,
          configUsername: item.configUsername,
          panelId: item.panelId,
          serviceId: item.serviceId,
          giftGb: job.giftGb,
          giftDays: job.giftDays,
          newDataLimit: meta.newDataLimit,
          newExpire: meta.newExpire,
          newOnHoldDuration: meta.newOnHoldDuration,
          alreadyApplied: meta.alreadyApplied,
        }),
      });

      return true;
    });
  }

  private async finishItem(
    job: BulkGiftJob,
    item: BulkGiftItem,
    status: 'failed' | 'skipped',
    opts: { lastError?: string } = {}
  ): Promise<boolean> {
    const db = getDb();
    const now = new Date();
    return db.transaction(async (tx) => {
      const [finished] = await tx
        .update(bulkGiftItems)
        .set({
          status,
          claimedAt: null,
          lastError: opts.lastError?.slice(0, 1_000) ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(bulkGiftItems.jobId, job.id),
            eq(bulkGiftItems.configId, item.configId),
            eq(bulkGiftItems.status, 'processing')
          )
        )
        .returning({ configId: bulkGiftItems.configId });
      if (!finished) return false;

      await tx
        .update(bulkGiftJobs)
        .set({
          ...(status === 'failed'
            ? { failedCount: sql`${bulkGiftJobs.failedCount} + 1` }
            : { skippedCount: sql`${bulkGiftJobs.skippedCount} + 1` }),
          updatedAt: now,
        })
        .where(eq(bulkGiftJobs.id, job.id));
      return true;
    });
  }
}

function validateFilter(filter: BulkGiftFilter): {
  targetStatuses: BulkGiftTargetStatus[];
  panelId: string | null;
  serviceId: number | null;
} {
  const targetStatuses = normalizeBulkGiftStatuses(filter.targetStatuses);
  if (targetStatuses.length === 0) {
    throw new BulkGiftError(
      'INVALID_TARGET_STATUSES',
      'Select at least one target service status (active, on_hold, limited)'
    );
  }

  const panelId =
    typeof filter.panelId === 'string' && filter.panelId.trim().length > 0
      ? filter.panelId.trim()
      : null;

  let serviceId: number | null = null;
  if (filter.serviceId !== undefined && filter.serviceId !== null) {
    const parsed = Math.trunc(Number(filter.serviceId));
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
      throw new BulkGiftError('INVALID_SERVICE_FILTER', 'Invalid serviceId filter');
    }
    serviceId = parsed;
  }

  return { targetStatuses, panelId, serviceId };
}

function buildTargetWhereSql(filter: {
  targetStatuses: BulkGiftTargetStatus[];
  panelId: string | null;
  serviceId: number | null;
}) {
  return and(
    eq(users.isBanned, false),
    inArray(userConfigs.panelStatus, filter.targetStatuses),
    ...(filter.panelId ? [eq(userConfigs.panelId, filter.panelId)] : []),
    ...(filter.serviceId !== null ? [eq(userConfigs.serviceId, filter.serviceId)] : [])
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
