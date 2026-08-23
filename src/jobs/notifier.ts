/**
 * Notifier job — low-traffic and near-expiry config warnings.
 *
 * Each warning reason is persisted independently. This means a user receives
 * a fresh alert when a second reason becomes true, but not the same alert on
 * every hourly sweep. Recovery clears that reason so a later recurrence is
 * announced again.
 */
import cron from 'node-cron';
import { InlineKeyboard, type Api } from 'grammy';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RebeccaUserDetail } from '../domain/services/RebeccaService.js';
import { RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../domain/services/RebeccaService.js';
import { getRebeccaService } from '../domain/services/RebeccaPanelAccess.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { getDb } from '../infra/db.js';
import { notificationDeliveries, userConfigs, users } from '../infra/schema.js';
import { logger } from '../infra/logger.js';
import { buildScreen } from '../telegram/designSystem.js';
import { tForLocale } from '../telegram/locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../telegram/rendering.js';
import { jobRunner } from './workerRuntime.js';

export const NOTIFIER_CONDITION_TYPES = ['low_traffic', 'near_expiry'] as const;
export const NOTIFICATION_TYPES = [
  ...NOTIFIER_CONDITION_TYPES,
  'auto_renew_low_balance',
  'auto_renew_package_missing',
] as const;
const RENEWABLE_STATUSES = new Set(['active', 'disabled', 'on_hold', 'limited', 'expired']);
const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BYTES_PER_GB = 1024 ** 3;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type ConfigNotificationRecipient = {
  configId: string;
  panelId: string;
  serviceId: number;
  configUsername: string;
  telegramId: number;
  /** Persisted from the latest Telegram update; legacy rows default to FA. */
  locale?: SupportedLocale;
  autoRenewEnabled?: boolean;
};

export type NotificationAssessment = {
  renewable: boolean;
  lowTraffic: boolean;
  nearExpiry: boolean;
  remainingBytes: number | null;
  secondsToExpiry: number | null;
};

export interface NotificationDeliveryStore {
  /**
   * Only returns user configs that are NOT managed by auto-renew (autoRenewEnabled = false).
   */
  listConfigs(): Promise<ConfigNotificationRecipient[]>;
  reserve(
    recipient: ConfigNotificationRecipient,
    notificationType: NotificationType,
    now: Date
  ): Promise<boolean>;
  deactivate(
    recipient: ConfigNotificationRecipient,
    notificationType: NotificationType,
    now: Date
  ): Promise<void>;
  release(
    recipient: ConfigNotificationRecipient,
    notificationTypes: NotificationType[],
    now: Date
  ): Promise<void>;
}

/** PostgreSQL-backed dedupe state, shared across process restarts. */
export class PostgresNotificationDeliveryStore implements NotificationDeliveryStore {
  /** Only returns user configs that are NOT managed by auto-renew (autoRenewEnabled = false). */
  async listConfigs(): Promise<ConfigNotificationRecipient[]> {
    const rows = await getDb()
      .select({
        configId: userConfigs.id,
        panelId: userConfigs.panelId,
        serviceId: userConfigs.serviceId,
        configUsername: userConfigs.configUsername,
        telegramId: userConfigs.telegramId,
        locale: users.locale,
        autoRenewEnabled: userConfigs.autoRenewEnabled,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(eq(userConfigs.autoRenewEnabled, false));
    return rows.map(({ locale, ...recipient }) => ({
      ...recipient,
      locale: locale === 'en' || locale === 'fa' ? locale : undefined,
    }));
  }

  async reserve(
    recipient: ConfigNotificationRecipient,
    notificationType: NotificationType,
    now: Date
  ): Promise<boolean> {
    const cooldownCutoff = new Date(now.getTime() - NOTIFICATION_COOLDOWN_MS);
    const [reserved] = await getDb()
      .insert(notificationDeliveries)
      .values({
        telegramId: recipient.telegramId,
        panelId: recipient.panelId,
        configUsername: recipient.configUsername,
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
        // The database decides eligibility atomically. A condition that
        // recovered since its last alert is immediately eligible; a continuous
        // condition is eligible once per cooldown window at most.
        setWhere: sql`
          ${notificationDeliveries.conditionActive} = false
          OR ${notificationDeliveries.lastSentAt} IS NULL
          OR ${notificationDeliveries.lastSentAt} <= ${cooldownCutoff}
        `,
      })
      .returning({ notificationType: notificationDeliveries.notificationType });
    return reserved !== undefined;
  }

  async deactivate(
    recipient: ConfigNotificationRecipient,
    notificationType: NotificationType,
    now: Date
  ): Promise<void> {
    await getDb()
      .update(notificationDeliveries)
      .set({ conditionActive: false, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.telegramId, recipient.telegramId),
          eq(notificationDeliveries.panelId, recipient.panelId),
          eq(notificationDeliveries.configUsername, recipient.configUsername),
          eq(notificationDeliveries.notificationType, notificationType)
        )
      );
  }

  async release(
    recipient: ConfigNotificationRecipient,
    notificationTypes: NotificationType[],
    now: Date
  ): Promise<void> {
    if (notificationTypes.length === 0) return;
    await getDb()
      .update(notificationDeliveries)
      .set({ conditionActive: false, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.telegramId, recipient.telegramId),
          eq(notificationDeliveries.panelId, recipient.panelId),
          eq(notificationDeliveries.configUsername, recipient.configUsername),
          inArray(notificationDeliveries.notificationType, notificationTypes)
        )
      );
  }
}

let task: ReturnType<typeof cron.schedule> | null = null;
export function startNotifierCron(
  panels: RebeccaPanelRegistry,
  translationService: TranslationService,
  telegramApi: Api
) {
  stopNotifierCron();
  const deliveryStore = new PostgresNotificationDeliveryStore();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('notifier', async () => {
        await runNotifierSweep(panels, translationService, telegramApi, deliveryStore);
      });
    } catch (err) {
      logger.error({ err }, 'Notifier cron worker failed');
    }
  };
  // Run sweep every hour. The durable delivery store, rather than the cron
  // schedule alone, prevents repeated messages after restarts or overlap.
  task = cron.schedule('0 * * * *', () => {
    void run();
  });

  logger.info('Notifier cron worker started (hourly, persistent dedupe enabled)');
}

export async function runNotifierSweep(
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService,
  translationService: TranslationService,
  telegramApi: Api,
  deliveryStore: NotificationDeliveryStore = new PostgresNotificationDeliveryStore(),
  now = new Date()
): Promise<void> {
  logger.info('Running low-traffic and expiry notification sweep...');
  let configs: ConfigNotificationRecipient[];
  try {
    configs = await deliveryStore.listConfigs();
  } catch (err) {
    logger.error({ err }, 'Notifier: failed to read user configs from DB');
    return;
  }

  const thresholdGb = positiveFinite(
    translationService.getSettingNum('low_traffic_threshold_gb', 2)
  );
  const expiryWarningDays = positiveFinite(
    translationService.getSettingNum('expiry_warning_days', 3)
  );

  const downPanels = new Set<string>();
  for (const cfg of configs) {
    if (downPanels.has(cfg.panelId)) continue;
    try {
      const apiUser = await getRebeccaService(panels, cfg.panelId).getUser(cfg.configUsername);
      const assessment = assessNotificationConditions(apiUser, {
        thresholdGb,
        expiryWarningDays,
        now,
      });

      if (!assessment.renewable) {
        await deactivateAllConditions(deliveryStore, cfg, now);
        logger.debug(
          { configUsername: cfg.configUsername, status: apiUser.status },
          'Notifier: config is not in a renewable state'
        );
        continue;
      }

      const notificationTypes = await reserveActiveConditions(deliveryStore, cfg, assessment, now);
      if (notificationTypes.length === 0) continue;

      try {
        const locale = cfg.locale ?? translationService.resolveLocale();
        const reasons = notificationTypes
          .map((type) => notificationReason(type, assessment, translationService, locale))
          .join('\n');
        const keyboard = new InlineKeyboard().text(
          tForLocale(translationService, locale, 'renewal_button'),
          `renew:open:${cfg.configId}`
        );
        await telegramApi.sendMessage(
          cfg.telegramId,
          buildScreen({
            emoji: '⚠️',
            title: tForLocale(translationService, locale, 'renewal_notification_title'),
            subtitle: tForLocale(translationService, locale, 'renewal_notification_subtitle'),
            primary: {
              emoji: '📱',
              label: tForLocale(translationService, locale, 'renewal_service_label'),
              value: `\`${sanitizeTelegramInlineCode(cfg.configUsername)}\``,
            },
            sections: [
              {
                emoji: '⚠️',
                title: tForLocale(translationService, locale, 'renewal_attention_section'),
                fields: [
                  {
                    label: tForLocale(translationService, locale, 'ui_status_attention'),
                    value: reasons,
                  },
                ],
              },
            ],
          }),
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        logger.info(
          {
            telegramId: cfg.telegramId,
            configUsername: cfg.configUsername,
            notificationTypes,
          },
          'Subscription renewal notification delivered'
        );
      } catch (err) {
        // The reservation is deliberately released only for an undelivered
        // Telegram message. The next sweep can retry without creating hourly
        // duplicates after a successful send.
        await deliveryStore.release(cfg, notificationTypes, new Date());
        logger.warn(
          {
            errorName: err instanceof Error ? err.name : typeof err,
            telegramId: cfg.telegramId,
            configUsername: cfg.configUsername,
            notificationTypes,
          },
          'Notifier: Telegram delivery failed; notification reservation released'
        );
      }
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        downPanels.add(cfg.panelId);
        logger.warn(
          { panelId: cfg.panelId, configUsername: cfg.configUsername },
          'Notifier: Rebecca panel origin down, skipping remaining configs for panel'
        );
        continue;
      }
      // A deleted/malformed config must not block warnings for other users.
      logger.debug({ configUsername: cfg.configUsername, err }, 'Notifier: skipping config');
    }
  }

  logger.info({ checked: configs.length }, 'Notifier sweep complete');
}

export function assessNotificationConditions(
  apiUser: RebeccaUserDetail,
  {
    thresholdGb,
    expiryWarningDays,
    now,
  }: { thresholdGb: number; expiryWarningDays: number; now: Date }
): NotificationAssessment {
  const renewable = RENEWABLE_STATUSES.has(apiUser.status);
  const dataLimit = apiUser.data_limit;
  const usedTraffic = apiUser.used_traffic;
  const limitedData = typeof dataLimit === 'number' && Number.isFinite(dataLimit) && dataLimit > 0;
  const validUsage = typeof usedTraffic === 'number' && Number.isFinite(usedTraffic);
  const remainingBytes = limitedData && validUsage ? dataLimit - usedTraffic : null;
  const thresholdBytes = thresholdGb * BYTES_PER_GB;
  const lowTraffic =
    renewable && thresholdBytes > 0 && remainingBytes !== null && remainingBytes < thresholdBytes;

  const expiry = apiUser.expire;
  const secondsToExpiry =
    typeof expiry === 'number' && Number.isFinite(expiry)
      ? expiry - Math.floor(now.getTime() / 1000)
      : null;
  const nearExpiry =
    renewable &&
    expiryWarningDays > 0 &&
    secondsToExpiry !== null &&
    secondsToExpiry > 0 &&
    secondsToExpiry <= expiryWarningDays * 86_400;

  return { renewable, lowTraffic, nearExpiry, remainingBytes, secondsToExpiry };
}

export function stopNotifierCron() {
  if (task) {
    task.stop();
    task = null;
  }
}

async function reserveActiveConditions(
  deliveryStore: NotificationDeliveryStore,
  recipient: ConfigNotificationRecipient,
  assessment: NotificationAssessment,
  now: Date
): Promise<NotificationType[]> {
  const active: NotificationType[] = [];
  const conditionState: Record<(typeof NOTIFIER_CONDITION_TYPES)[number], boolean> = {
    low_traffic: assessment.lowTraffic,
    near_expiry: assessment.nearExpiry,
  };

  for (const notificationType of NOTIFIER_CONDITION_TYPES) {
    if (!conditionState[notificationType]) {
      await deliveryStore.deactivate(recipient, notificationType, now);
      continue;
    }
    if (await deliveryStore.reserve(recipient, notificationType, now)) {
      active.push(notificationType);
    }
  }
  return active;
}

async function deactivateAllConditions(
  deliveryStore: NotificationDeliveryStore,
  recipient: ConfigNotificationRecipient,
  now: Date
): Promise<void> {
  await Promise.all(
    NOTIFIER_CONDITION_TYPES.map((notificationType) =>
      deliveryStore.deactivate(recipient, notificationType, now)
    )
  );
}

function notificationReason(
  type: NotificationType,
  assessment: NotificationAssessment,
  translationService: TranslationService,
  locale: SupportedLocale
): string {
  if (type === 'low_traffic') {
    const remainingGb = Math.max(0, assessment.remainingBytes ?? 0) / BYTES_PER_GB;
    return escapeTelegramMarkdown(
      tForLocale(translationService, locale, 'renewal_reason_low_traffic', {
        remaining: `${formatNotificationNumber(Number(remainingGb.toFixed(2)), locale)} GB`,
      })
    );
  }
  const daysRemaining = Math.max(1, Math.ceil((assessment.secondsToExpiry ?? 0) / 86_400));
  return escapeTelegramMarkdown(
    tForLocale(translationService, locale, 'renewal_reason_near_expiry', {
      remaining: formatNotificationNumber(daysRemaining, locale),
    })
  );
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatNotificationNumber(value: number, locale: SupportedLocale): string {
  return value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
}
