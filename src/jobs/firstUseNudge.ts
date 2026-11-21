/**
 * 24h Smart "First-Use Nudge" worker.
 *
 * Checks configs provisioned 24–72 hours ago whose `first_use_checked_at` is
 * still NULL. If a live Rebecca API lookup confirms zero current and lifetime
 * traffic on an active or on-hold service, the worker atomically stamps
 * `first_use_checked_at` BEFORE sending a single friendly connection-guide
 * message (at-most-once delivery guarantee).
 */
import cron from 'node-cron';
import { InlineKeyboard, type Api } from 'grammy';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { firstUseNudgeEnabled } from '../domain/services/FeatureSettings.js';
import { getRebeccaService } from '../domain/services/RebeccaPanelAccess.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import { RebeccaOriginDownError, type RebeccaService } from '../domain/services/RebeccaService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { getDb } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { notificationDeliveries, userConfigs, users } from '../infra/schema.js';
import { callbackData } from '../telegram/callbackData.js';
import { buildUserScreen } from '../telegram/designSystem.js';
import { tForLocale, tmForLocale } from '../telegram/locale.js';
import { sanitizeTelegramInlineCode } from '../telegram/rendering.js';
import { jobRunner } from './workerRuntime.js';

export const FIRST_USE_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const FIRST_USE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export interface FirstUseNudgeCandidate {
  id: string;
  telegramId: number;
  panelId: string;
  configUsername: string;
  createdAt: Date;
  locale?: SupportedLocale;
}

export interface FirstUseNudgeStore {
  listCandidates(windowStart: Date, windowEnd: Date): Promise<FirstUseNudgeCandidate[]>;
  /**
   * Atomically claim `first_use_checked_at` while it is still NULL.
   * Returns `true` only for the single caller that wins the claim.
   */
  claimFirstUseCheck(configId: string, now: Date): Promise<boolean>;
  /**
   * Durable dedupe guard in `notification_deliveries` (`notification_type = 'first_use_nudge'`).
   */
  recordDelivery?(candidate: FirstUseNudgeCandidate, now: Date): Promise<boolean>;
}

export interface FirstUseNudgeDeps {
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService;
  translationService: TranslationService;
  telegramApi: Pick<Api, 'sendMessage'>;
  supportUrl?: string;
  store?: FirstUseNudgeStore;
}

export interface FirstUseNudgeSummary {
  enabled: boolean;
  checked: number;
  nudged: number;
  stampedWithoutNudge: number;
  skippedErrors: number;
}

/** PostgreSQL-backed store for atomic first-use nudge claims and delivery dedupe. */
export class PostgresFirstUseNudgeStore implements FirstUseNudgeStore {
  async listCandidates(windowStart: Date, windowEnd: Date): Promise<FirstUseNudgeCandidate[]> {
    const rows = await getDb()
      .select({
        id: userConfigs.id,
        telegramId: userConfigs.telegramId,
        panelId: userConfigs.panelId,
        configUsername: userConfigs.configUsername,
        createdAt: userConfigs.createdAt,
        locale: users.locale,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(
        and(
          isNull(userConfigs.firstUseCheckedAt),
          gte(userConfigs.createdAt, windowStart),
          lte(userConfigs.createdAt, windowEnd)
        )
      );

    return rows.map(({ locale, ...row }) => ({
      ...row,
      locale: locale === 'en' || locale === 'fa' ? locale : undefined,
    }));
  }

  async claimFirstUseCheck(configId: string, now: Date): Promise<boolean> {
    const [claimed] = await getDb()
      .update(userConfigs)
      .set({ firstUseCheckedAt: now, updatedAt: now })
      .where(and(eq(userConfigs.id, configId), isNull(userConfigs.firstUseCheckedAt)))
      .returning({ id: userConfigs.id });
    return claimed !== undefined;
  }

  async recordDelivery(candidate: FirstUseNudgeCandidate, now: Date): Promise<boolean> {
    const [inserted] = await getDb()
      .insert(notificationDeliveries)
      .values({
        telegramId: candidate.telegramId,
        panelId: candidate.panelId,
        configUsername: candidate.configUsername,
        notificationType: 'first_use_nudge',
        conditionActive: true,
        lastSentAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          notificationDeliveries.telegramId,
          notificationDeliveries.panelId,
          notificationDeliveries.configUsername,
          notificationDeliveries.notificationType,
        ],
      })
      .returning({ notificationType: notificationDeliveries.notificationType });
    return inserted !== undefined;
  }
}

/** Resolve support button destination from admin settings or environment fallback. */
export function resolveNudgeSupportUrl(
  translationService: Pick<TranslationService, 'getSetting'>,
  supportUrl?: string
): string | undefined {
  const dest = translationService.getSetting('support_destination', '').trim();
  if (dest) {
    if (dest.startsWith('@') || /^[a-zA-Z0-9_]{5,32}$/u.test(dest)) {
      const username = dest.replace(/^@/u, '');
      return `https://t.me/${username}`;
    }
    if (/^[1-9]\d{4,16}$/u.test(dest)) {
      return `tg://user?id=${dest}`;
    }
  }
  const trimmedFallback = supportUrl?.trim();
  if (trimmedFallback && /^(?:https?:\/\/|tg:\/\/)/iu.test(trimmedFallback)) {
    return trimmedFallback;
  }
  return undefined;
}

export async function runFirstUseNudgeCycle(
  deps: FirstUseNudgeDeps,
  now = new Date()
): Promise<FirstUseNudgeSummary> {
  const summary: FirstUseNudgeSummary = {
    enabled: firstUseNudgeEnabled(deps.translationService),
    checked: 0,
    nudged: 0,
    stampedWithoutNudge: 0,
    skippedErrors: 0,
  };

  if (!summary.enabled) {
    return summary;
  }

  const store = deps.store ?? new PostgresFirstUseNudgeStore();
  const windowStart = new Date(now.getTime() - FIRST_USE_MAX_AGE_MS);
  const windowEnd = new Date(now.getTime() - FIRST_USE_MIN_AGE_MS);

  let candidates: FirstUseNudgeCandidate[];
  try {
    candidates = await store.listCandidates(windowStart, windowEnd);
  } catch (err) {
    logger.error({ err }, 'First-use nudge: failed to query candidate configs from DB');
    summary.skippedErrors += 1;
    return summary;
  }

  const downPanels = new Set<string>();
  const resolvedSupportUrl = resolveNudgeSupportUrl(deps.translationService, deps.supportUrl);

  for (const candidate of candidates) {
    const createdAtMs = candidate.createdAt.getTime();
    if (createdAtMs < windowStart.getTime() || createdAtMs > windowEnd.getTime()) {
      continue;
    }

    if (downPanels.has(candidate.panelId)) {
      summary.skippedErrors += 1;
      continue;
    }

    summary.checked += 1;

    let remote;
    try {
      remote = await getRebeccaService(deps.panels, candidate.panelId).getUser(
        candidate.configUsername
      );
    } catch (err) {
      summary.skippedErrors += 1;
      if (err instanceof RebeccaOriginDownError) {
        downPanels.add(candidate.panelId);
        logger.warn(
          { panelId: candidate.panelId, configUsername: candidate.configUsername },
          'First-use nudge: Rebecca panel origin down, skipping remaining configs for panel'
        );
        continue;
      }
      logger.debug(
        { err, panelId: candidate.panelId, configUsername: candidate.configUsername },
        'First-use nudge: skipping config due to remote lookup error'
      );
      continue;
    }

    const usedTraffic = remote.used_traffic ?? 0;
    const lifetimeUsedTraffic = remote.lifetime_used_traffic ?? 0;
    const eligible =
      usedTraffic === 0 &&
      lifetimeUsedTraffic === 0 &&
      (remote.status === 'active' || remote.status === 'on_hold');

    if (!eligible) {
      try {
        await store.claimFirstUseCheck(candidate.id, now);
      } catch (err) {
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'First-use nudge: failed to stamp already-used config'
        );
      }
      summary.stampedWithoutNudge += 1;
      continue;
    }

    // At-most-once atomic claim MUST succeed before sending any Telegram message.
    let claimed: boolean;
    try {
      claimed = await store.claimFirstUseCheck(candidate.id, now);
    } catch (err) {
      summary.skippedErrors += 1;
      logger.warn(
        { err, configId: candidate.id, configUsername: candidate.configUsername },
        'First-use nudge: atomic claim failed'
      );
      continue;
    }
    if (!claimed) {
      continue;
    }

    if (store.recordDelivery) {
      try {
        const recorded = await store.recordDelivery(candidate, now);
        if (!recorded) {
          continue;
        }
      } catch (err) {
        summary.skippedErrors += 1;
        logger.warn(
          { err, configId: candidate.id, configUsername: candidate.configUsername },
          'First-use nudge: failed to record delivery dedupe row'
        );
        continue;
      }
    }

    const locale = candidate.locale ?? deps.translationService.resolveLocale();
    const messageText = buildUserScreen({
      emoji: '💡',
      title: tForLocale(deps.translationService, locale, 'subscription_first_use_nudge_title'),
      footer: tmForLocale(deps.translationService, locale, 'subscription_first_use_nudge_body', {
        username: sanitizeTelegramInlineCode(candidate.configUsername),
      }),
      direction: locale === 'fa' ? 'rtl' : 'ltr',
    });

    const keyboard = new InlineKeyboard().text(
      tForLocale(deps.translationService, locale, 'subscription_first_use_view_button'),
      callbackData('config', 'view', candidate.id)
    );
    const supportLabel = tForLocale(
      deps.translationService,
      locale,
      'subscription_first_use_support_button'
    );
    if (resolvedSupportUrl) {
      keyboard.row().url(supportLabel, resolvedSupportUrl);
    } else {
      keyboard.row().text(supportLabel, 'nav:main');
    }

    try {
      await deps.telegramApi.sendMessage(candidate.telegramId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      summary.nudged += 1;
      logger.info(
        {
          telegramId: candidate.telegramId,
          panelId: candidate.panelId,
          configUsername: candidate.configUsername,
        },
        'First-use connection guide nudge delivered'
      );
    } catch (err) {
      summary.skippedErrors += 1;
      logger.warn(
        {
          errorName: err instanceof Error ? err.name : typeof err,
          telegramId: candidate.telegramId,
          configUsername: candidate.configUsername,
        },
        'First-use nudge: Telegram delivery failed after atomic claim'
      );
    }
  }

  logger.info(summary, 'First-use nudge cycle complete');
  return summary;
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startFirstUseNudgeJob(deps: FirstUseNudgeDeps, schedule = '40 * * * *'): void {
  stopFirstUseNudgeJob();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('first-use-nudge', async () => {
        await runFirstUseNudgeCycle(deps);
      });
    } catch (err) {
      logger.error({ err }, 'First-use nudge cron worker failed');
    }
  };

  task = cron.schedule(schedule, () => {
    void run();
  });
  logger.info({ schedule }, 'First-use nudge cron worker started (hourly)');
}

export function stopFirstUseNudgeJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
