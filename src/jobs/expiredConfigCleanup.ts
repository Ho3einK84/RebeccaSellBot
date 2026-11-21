/**
 * Staged Automatic Expired-Config Cleanup worker.
 *
 * Safely cleans up long-expired services with a mandatory safety floor:
 *   effectiveAnchor = max(panelExpireMs, enabledAtMs, cleanupHoldUntilMs)
 *   deleteAt        = effectiveAnchor + graceDays * 86_400_000
 *
 * Guarantees:
 * - Turning the feature ON never abruptly deletes previously expired configs
 *   because `expired_cleanup_enabled_at` anchors their full grace period.
 * - Every warning and every deletion performs a live Rebecca API lookup first.
 *   If the service has been renewed (`remote.expire > nowSec` or active/on_hold
 *   without expiry), cleanup aborts immediately and refreshes local cache.
 * - First and final warnings are deduplicated in `notification_deliveries`.
 * - Final deletion delegates to `configService.deleteConfigCompletely(...)` and
 *   writes a system entry to `audit_logs`.
 */
import crypto from 'node:crypto';
import cron from 'node-cron';
import { InlineKeyboard, type Api } from 'grammy';
import { and, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { observedConfigLifecycle } from '../domain/services/ConfigLifecycle.js';
import type { ConfigService } from '../domain/services/ConfigService.js';
import {
  expiredCleanupEnabled,
  expiredCleanupEnabledAt,
  expiredCleanupGraceDays,
  expiredCleanupWarnDays,
  type SettingReader,
} from '../domain/services/FeatureSettings.js';
import { getRebeccaService } from '../domain/services/RebeccaPanelAccess.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
  type RebeccaService,
  type RebeccaUserDetail,
} from '../domain/services/RebeccaService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { getDb } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { auditLogs, notificationDeliveries, userConfigs, users } from '../infra/schema.js';
import { callbackData } from '../telegram/callbackData.js';
import { buildUserScreen } from '../telegram/designSystem.js';
import { localizedNumberForLocale, tForLocale, tmForLocale } from '../telegram/locale.js';
import { sanitizeTelegramInlineCode } from '../telegram/rendering.js';
import { jobRunner } from './workerRuntime.js';

const MS_PER_DAY = 86_400_000;

export const CLEANUP_WARNING_TYPES = [
  'expired_cleanup_warn_first',
  'expired_cleanup_warn_last',
] as const;
export type CleanupWarningType = (typeof CLEANUP_WARNING_TYPES)[number];

export interface ExpiredConfigCandidate {
  id: string;
  telegramId: number;
  panelId: string;
  configUsername: string;
  panelStatus: string | null;
  panelExpire: number | null;
  cleanupHoldUntil: Date | null;
  locale?: SupportedLocale;
}

export interface ExpiredCleanupPreview {
  totalCandidates: number;
  approachingDeletion: number;
  dueForDeletion: number;
}

export interface ExpiredCleanupAuditEntry {
  configId: string;
  telegramId: number;
  panelId: string;
  configUsername: string;
  panelExpire: number | null;
  graceDays: number;
  reason: 'expired_grace_elapsed' | 'remote_missing';
  now: Date;
}

export interface ExpiredConfigCleanupStore {
  listExpiredCandidates(now: Date): Promise<ExpiredConfigCandidate[]>;
  syncLocalConfigCache(
    configId: string,
    remote: RebeccaUserDetail,
    observedAt: Date
  ): Promise<void>;
  reserveWarning(
    candidate: ExpiredConfigCandidate,
    notificationType: CleanupWarningType,
    now: Date
  ): Promise<boolean>;
  releaseWarning(
    candidate: ExpiredConfigCandidate,
    notificationType: CleanupWarningType,
    now: Date
  ): Promise<void>;
  clearWarnings(candidate: ExpiredConfigCandidate, now: Date): Promise<void>;
  recordCleanupAudit(entry: ExpiredCleanupAuditEntry): Promise<void>;
}

export interface ExpiredConfigCleanupDeps {
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService;
  configService: Pick<ConfigService, 'deleteConfigCompletely'>;
  translationService: TranslationService;
  telegramApi: Pick<Api, 'sendMessage'>;
  store?: ExpiredConfigCleanupStore;
}

export interface ExpiredConfigCleanupSummary {
  enabled: boolean;
  checked: number;
  renewedResynced: number;
  firstWarningsSent: number;
  lastWarningsSent: number;
  deleted: number;
  skippedErrors: number;
}

/** Pure helper computing the safety-anchored deletion schedule for one expired config. */
export function computeCleanupSchedule(params: {
  panelExpireSec: number;
  enabledAt: Date | null;
  cleanupHoldUntil: Date | null;
  graceDays: number;
  nowMs: number;
}): { effectiveAnchorMs: number; deleteAtMs: number; daysRemaining: number } {
  const panelExpireMs = params.panelExpireSec * 1000;
  const enabledAtMs = params.enabledAt ? params.enabledAt.getTime() : 0;
  const holdUntilMs = params.cleanupHoldUntil ? params.cleanupHoldUntil.getTime() : 0;
  const effectiveAnchorMs = Math.max(panelExpireMs, enabledAtMs, holdUntilMs);
  const deleteAtMs = effectiveAnchorMs + params.graceDays * MS_PER_DAY;
  const daysRemaining =
    deleteAtMs <= params.nowMs ? 0 : Math.ceil((deleteAtMs - params.nowMs) / MS_PER_DAY);
  return { effectiveAnchorMs, deleteAtMs, daysRemaining };
}

/** PostgreSQL-backed store for expired config cleanup candidates, warnings, and audit logs. */
export class PostgresExpiredConfigCleanupStore implements ExpiredConfigCleanupStore {
  async listExpiredCandidates(now: Date): Promise<ExpiredConfigCandidate[]> {
    const nowSec = Math.floor(now.getTime() / 1000);
    const rows = await getDb()
      .select({
        id: userConfigs.id,
        telegramId: userConfigs.telegramId,
        panelId: userConfigs.panelId,
        configUsername: userConfigs.configUsername,
        panelStatus: userConfigs.panelStatus,
        panelExpire: userConfigs.panelExpire,
        cleanupHoldUntil: userConfigs.cleanupHoldUntil,
        locale: users.locale,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(
        or(
          eq(userConfigs.panelStatus, 'expired'),
          and(
            isNotNull(userConfigs.panelExpire),
            lte(userConfigs.panelExpire, nowSec),
            or(isNull(userConfigs.panelStatus), ne(userConfigs.panelStatus, 'deleted'))
          )
        )
      );

    return rows.map(({ locale, ...row }) => ({
      ...row,
      locale: locale === 'en' || locale === 'fa' ? locale : undefined,
    }));
  }

  async syncLocalConfigCache(
    configId: string,
    remote: RebeccaUserDetail,
    observedAt: Date
  ): Promise<void> {
    await getDb()
      .update(userConfigs)
      .set(observedConfigLifecycle(remote, observedAt))
      .where(eq(userConfigs.id, configId));
  }

  async reserveWarning(
    candidate: ExpiredConfigCandidate,
    notificationType: CleanupWarningType,
    now: Date
  ): Promise<boolean> {
    const [reserved] = await getDb()
      .insert(notificationDeliveries)
      .values({
        telegramId: candidate.telegramId,
        panelId: candidate.panelId,
        configUsername: candidate.configUsername,
        notificationType,
        conditionActive: true,
        lastSentAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          notificationDeliveries.telegramId,
          notificationDeliveries.panelId,
          notificationDeliveries.configUsername,
          notificationDeliveries.notificationType,
        ],
        set: {
          conditionActive: true,
          lastSentAt: now,
          updatedAt: now,
        },
        // Each warning stage fires at most once per expiry cycle until cleared on renewal.
        setWhere: sql`${notificationDeliveries.conditionActive} = false`,
      })
      .returning({ notificationType: notificationDeliveries.notificationType });
    return reserved !== undefined;
  }

  async releaseWarning(
    candidate: ExpiredConfigCandidate,
    notificationType: CleanupWarningType,
    now: Date
  ): Promise<void> {
    await getDb()
      .update(notificationDeliveries)
      .set({ conditionActive: false, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.telegramId, candidate.telegramId),
          eq(notificationDeliveries.panelId, candidate.panelId),
          eq(notificationDeliveries.configUsername, candidate.configUsername),
          eq(notificationDeliveries.notificationType, notificationType)
        )
      );
  }

  async clearWarnings(candidate: ExpiredConfigCandidate, now: Date): Promise<void> {
    await getDb()
      .update(notificationDeliveries)
      .set({ conditionActive: false, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.telegramId, candidate.telegramId),
          eq(notificationDeliveries.panelId, candidate.panelId),
          eq(notificationDeliveries.configUsername, candidate.configUsername),
          inArray(notificationDeliveries.notificationType, [...CLEANUP_WARNING_TYPES])
        )
      );
  }

  async recordCleanupAudit(entry: ExpiredCleanupAuditEntry): Promise<void> {
    await getDb()
      .insert(auditLogs)
      .values({
        id: `audit_${entry.now.getTime()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: 0,
        action: 'expired_config_cleanup',
        entityType: 'user_config',
        entityId: entry.configId,
        targetTelegramId: entry.telegramId,
        metadata: JSON.stringify({
          username: entry.configUsername,
          panelId: entry.panelId,
          telegramId: entry.telegramId,
          panelExpire: entry.panelExpire,
          graceDays: entry.graceDays,
          reason: entry.reason,
        }),
      });
  }
}

/**
 * Read-only preview helper for Admin Retention Settings.
 * Counts expired candidates that are already due or inside the warning window.
 */
export async function countConfigsApproachingCleanup(
  translationService: SettingReader,
  now = new Date(),
  store: Pick<
    ExpiredConfigCleanupStore,
    'listExpiredCandidates'
  > = new PostgresExpiredConfigCleanupStore()
): Promise<ExpiredCleanupPreview> {
  const graceDays = expiredCleanupGraceDays(translationService);
  const warnDays = expiredCleanupWarnDays(translationService);
  const enabledAt = expiredCleanupEnabledAt(translationService);
  const nowMs = now.getTime();

  const candidates = await store.listExpiredCandidates(now);
  let approachingDeletion = 0;
  let dueForDeletion = 0;

  for (const candidate of candidates) {
    if (candidate.panelExpire === null) continue;
    const { deleteAtMs, daysRemaining } = computeCleanupSchedule({
      panelExpireSec: candidate.panelExpire,
      enabledAt,
      cleanupHoldUntil: candidate.cleanupHoldUntil,
      graceDays,
      nowMs,
    });
    if (nowMs >= deleteAtMs) {
      dueForDeletion += 1;
      approachingDeletion += 1;
    } else if (daysRemaining <= warnDays.firstWarnDays) {
      approachingDeletion += 1;
    }
  }

  return {
    totalCandidates: candidates.length,
    approachingDeletion,
    dueForDeletion,
  };
}

export async function runExpiredConfigCleanupCycle(
  deps: ExpiredConfigCleanupDeps,
  now = new Date()
): Promise<ExpiredConfigCleanupSummary> {
  const summary: ExpiredConfigCleanupSummary = {
    enabled: expiredCleanupEnabled(deps.translationService),
    checked: 0,
    renewedResynced: 0,
    firstWarningsSent: 0,
    lastWarningsSent: 0,
    deleted: 0,
    skippedErrors: 0,
  };

  if (!summary.enabled) {
    return summary;
  }

  const store = deps.store ?? new PostgresExpiredConfigCleanupStore();
  const graceDays = expiredCleanupGraceDays(deps.translationService);
  const warnDays = expiredCleanupWarnDays(deps.translationService);
  const enabledAt = expiredCleanupEnabledAt(deps.translationService);
  const nowMs = now.getTime();
  const nowSec = Math.floor(nowMs / 1000);

  let candidates: ExpiredConfigCandidate[];
  try {
    candidates = await store.listExpiredCandidates(now);
  } catch (err) {
    logger.error({ err }, 'Expired cleanup: failed to query candidate configs from DB');
    summary.skippedErrors += 1;
    return summary;
  }

  const downPanels = new Set<string>();

  for (const candidate of candidates) {
    if (downPanels.has(candidate.panelId)) {
      summary.skippedErrors += 1;
      continue;
    }

    summary.checked += 1;

    // Live verification against Rebecca BEFORE every warning or deletion.
    let remote: RebeccaUserDetail | null = null;
    let remoteMissing = false;
    try {
      remote = await getRebeccaService(deps.panels, candidate.panelId).getUser(
        candidate.configUsername
      );
      if (remote.status === 'deleted') {
        remoteMissing = true;
      }
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) {
        remoteMissing = true;
      } else if (err instanceof RebeccaOriginDownError) {
        downPanels.add(candidate.panelId);
        summary.skippedErrors += 1;
        logger.warn(
          { panelId: candidate.panelId, configUsername: candidate.configUsername },
          'Expired cleanup: Rebecca panel origin down, skipping remaining configs for panel'
        );
        continue;
      } else {
        summary.skippedErrors += 1;
        logger.warn(
          { err, panelId: candidate.panelId, configUsername: candidate.configUsername },
          'Expired cleanup: live remote verification failed, skipping safely'
        );
        continue;
      }
    }

    if (remoteMissing) {
      try {
        const deleted = await deps.configService.deleteConfigCompletely(
          candidate.configUsername,
          candidate.panelId
        );
        if (deleted) {
          await store.recordCleanupAudit({
            configId: candidate.id,
            telegramId: candidate.telegramId,
            panelId: candidate.panelId,
            configUsername: candidate.configUsername,
            panelExpire: candidate.panelExpire,
            graceDays,
            reason: 'remote_missing',
            now,
          });
          summary.deleted += 1;
          logger.info(
            { configId: candidate.id, configUsername: candidate.configUsername },
            'Expired cleanup: purged stale local config already missing on panel'
          );
        }
      } catch (err) {
        summary.skippedErrors += 1;
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'Expired cleanup: failed to purge remote-missing config'
        );
      }
      continue;
    }

    if (!remote) {
      continue;
    }

    const isUnexpiredLive =
      (remote.expire != null && remote.expire > nowSec) ||
      (remote.expire === null && (remote.status === 'active' || remote.status === 'on_hold'));

    if (isUnexpiredLive) {
      // Config was renewed or is still active/on-hold: NEVER delete or warn.
      try {
        await store.syncLocalConfigCache(candidate.id, remote, now);
        await store.clearWarnings(candidate, now);
        summary.renewedResynced += 1;
      } catch (err) {
        summary.skippedErrors += 1;
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'Expired cleanup: failed to refresh local cache for unexpired config'
        );
      }
      continue;
    }

    const effectiveExpireSec = remote.expire ?? candidate.panelExpire;
    if (effectiveExpireSec === null || effectiveExpireSec > nowSec) {
      continue;
    }

    const { deleteAtMs, daysRemaining } = computeCleanupSchedule({
      panelExpireSec: effectiveExpireSec,
      enabledAt,
      cleanupHoldUntil: candidate.cleanupHoldUntil,
      graceDays,
      nowMs,
    });

    const locale = candidate.locale ?? deps.translationService.resolveLocale();

    // Stage 3: Grace period elapsed -> permanent deletion + audit log + best-effort notice.
    if (nowMs >= deleteAtMs) {
      try {
        const deleted = await deps.configService.deleteConfigCompletely(
          candidate.configUsername,
          candidate.panelId
        );
        if (!deleted) {
          continue;
        }
        await store.recordCleanupAudit({
          configId: candidate.id,
          telegramId: candidate.telegramId,
          panelId: candidate.panelId,
          configUsername: candidate.configUsername,
          panelExpire: effectiveExpireSec,
          graceDays,
          reason: 'expired_grace_elapsed',
          now,
        });
        summary.deleted += 1;
        logger.info(
          {
            configId: candidate.id,
            telegramId: candidate.telegramId,
            panelId: candidate.panelId,
            configUsername: candidate.configUsername,
            graceDays,
          },
          'Expired cleanup: permanently deleted expired config after grace period'
        );
      } catch (err) {
        summary.skippedErrors += 1;
        logger.error(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'Expired cleanup: failed to delete expired config'
        );
        continue;
      }

      try {
        const deletedText = buildUserScreen({
          emoji: '🗑️',
          title: tForLocale(deps.translationService, locale, 'subscription_cleanup_deleted_title'),
          footer: tmForLocale(
            deps.translationService,
            locale,
            'subscription_cleanup_deleted_body',
            {
              username: sanitizeTelegramInlineCode(candidate.configUsername),
            }
          ),
          direction: locale === 'fa' ? 'rtl' : 'ltr',
        });
        await deps.telegramApi.sendMessage(candidate.telegramId, deletedText, {
          parse_mode: 'Markdown',
        });
      } catch (err) {
        logger.warn(
          {
            errorName: err instanceof Error ? err.name : typeof err,
            telegramId: candidate.telegramId,
            configUsername: candidate.configUsername,
          },
          'Expired cleanup: failed to send deletion notice to user'
        );
      }
      continue;
    }

    // Stage 2: Final warning window (daysRemaining <= lastWarnDays).
    if (daysRemaining <= warnDays.lastWarnDays) {
      let reserved: boolean;
      try {
        reserved = await store.reserveWarning(candidate, 'expired_cleanup_warn_last', now);
      } catch (err) {
        summary.skippedErrors += 1;
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'Expired cleanup: failed to reserve last warning'
        );
        continue;
      }
      if (!reserved) continue;

      try {
        const text = buildUserScreen({
          emoji: '🚨',
          title: tForLocale(
            deps.translationService,
            locale,
            'subscription_cleanup_warn_last_title'
          ),
          footer: tmForLocale(
            deps.translationService,
            locale,
            'subscription_cleanup_warn_last_body',
            {
              username: sanitizeTelegramInlineCode(candidate.configUsername),
              days: localizedNumberForLocale(daysRemaining, locale),
            }
          ),
          direction: locale === 'fa' ? 'rtl' : 'ltr',
        });
        const keyboard = new InlineKeyboard().text(
          tForLocale(deps.translationService, locale, 'subscription_cleanup_renew_button'),
          callbackData('renew', 'open', candidate.id)
        );
        await deps.telegramApi.sendMessage(candidate.telegramId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        summary.lastWarningsSent += 1;
      } catch (err) {
        await store.releaseWarning(candidate, 'expired_cleanup_warn_last', now);
        summary.skippedErrors += 1;
        logger.warn(
          {
            errorName: err instanceof Error ? err.name : typeof err,
            telegramId: candidate.telegramId,
            configUsername: candidate.configUsername,
          },
          'Expired cleanup: last warning delivery failed; reservation released'
        );
      }
      continue;
    }

    // Stage 1: First warning window (lastWarnDays < daysRemaining <= firstWarnDays).
    if (daysRemaining <= warnDays.firstWarnDays) {
      let reserved: boolean;
      try {
        reserved = await store.reserveWarning(candidate, 'expired_cleanup_warn_first', now);
      } catch (err) {
        summary.skippedErrors += 1;
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'Expired cleanup: failed to reserve first warning'
        );
        continue;
      }
      if (!reserved) continue;

      try {
        const text = buildUserScreen({
          emoji: '⏳',
          title: tForLocale(
            deps.translationService,
            locale,
            'subscription_cleanup_warn_first_title'
          ),
          footer: tmForLocale(
            deps.translationService,
            locale,
            'subscription_cleanup_warn_first_body',
            {
              username: sanitizeTelegramInlineCode(candidate.configUsername),
              days: localizedNumberForLocale(daysRemaining, locale),
            }
          ),
          direction: locale === 'fa' ? 'rtl' : 'ltr',
        });
        const keyboard = new InlineKeyboard().text(
          tForLocale(deps.translationService, locale, 'subscription_cleanup_renew_button'),
          callbackData('renew', 'open', candidate.id)
        );
        await deps.telegramApi.sendMessage(candidate.telegramId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        summary.firstWarningsSent += 1;
      } catch (err) {
        await store.releaseWarning(candidate, 'expired_cleanup_warn_first', now);
        summary.skippedErrors += 1;
        logger.warn(
          {
            errorName: err instanceof Error ? err.name : typeof err,
            telegramId: candidate.telegramId,
            configUsername: candidate.configUsername,
          },
          'Expired cleanup: first warning delivery failed; reservation released'
        );
      }
    }
  }

  logger.info(summary, 'Expired config cleanup cycle complete');
  return summary;
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startExpiredConfigCleanupJob(
  deps: ExpiredConfigCleanupDeps,
  schedule = '15 */6 * * *'
): void {
  stopExpiredConfigCleanupJob();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('expired-config-cleanup', async () => {
        await runExpiredConfigCleanupCycle(deps);
      });
    } catch (err) {
      logger.error({ err }, 'Expired config cleanup cron worker failed');
    }
  };

  task = cron.schedule(schedule, () => {
    void run();
  });
  logger.info({ schedule }, 'Expired config cleanup cron worker started');
}

export function stopExpiredConfigCleanupJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
