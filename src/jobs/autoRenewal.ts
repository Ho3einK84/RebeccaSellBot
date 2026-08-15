/**
 * Wallet auto-renewal job. Enabled subscriptions are renewed when the same
 * low-traffic/near-expiry conditions used by the notifier become active.
 */
import cron from 'node-cron';
import { InlineKeyboard, type Api } from 'grammy';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../infra/db.js';
import { userConfigs, users } from '../infra/schema.js';
import { logger } from '../infra/logger.js';
import { jobRunner } from './workerRuntime.js';
import { RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../domain/services/RebeccaService.js';
import { getRebeccaService } from '../domain/services/RebeccaPanelAccess.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
  type WalletService,
} from '../domain/services/WalletService.js';
import type { PricingService } from '../domain/services/PricingService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { buildScreen } from '../telegram/designSystem.js';
import { tForLocale } from '../telegram/locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../telegram/rendering.js';
import {
  PostgresNotificationDeliveryStore,
  assessNotificationConditions,
  type ConfigNotificationRecipient,
  type NotificationDeliveryStore,
} from './notifier.js';

export type AutoRenewalCandidate = ConfigNotificationRecipient & {
  autoRenewPackageId: string | null;
  autoRenewPrice: number | null;
};

export interface AutoRenewalCandidateStore {
  listEnabledConfigs(): Promise<AutoRenewalCandidate[]>;
  disableAutoRenew?(
    candidate: Pick<AutoRenewalCandidate, 'configId' | 'panelId' | 'configUsername'>
  ): Promise<void>;
}

export class PostgresAutoRenewalCandidateStore implements AutoRenewalCandidateStore {
  async listEnabledConfigs(): Promise<AutoRenewalCandidate[]> {
    const rows = await getDb()
      .select({
        configId: userConfigs.id,
        panelId: userConfigs.panelId,
        serviceId: userConfigs.serviceId,
        configUsername: userConfigs.configUsername,
        telegramId: userConfigs.telegramId,
        locale: users.locale,
        autoRenewPackageId: userConfigs.autoRenewPackageId,
        autoRenewPrice: userConfigs.autoRenewPrice,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(eq(userConfigs.autoRenewEnabled, true));

    return rows.map(({ locale, ...candidate }) => ({
      ...candidate,
      locale: normalizeLocale(locale),
    }));
  }

  async disableAutoRenew(
    candidate: Pick<AutoRenewalCandidate, 'configId' | 'panelId' | 'configUsername'>
  ): Promise<void> {
    const db = getDb();
    if (candidate.configId) {
      await db
        .update(userConfigs)
        .set({ autoRenewEnabled: false, updatedAt: new Date() })
        .where(eq(userConfigs.id, candidate.configId));
    } else {
      await db
        .update(userConfigs)
        .set({ autoRenewEnabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(userConfigs.panelId, candidate.panelId),
            eq(userConfigs.configUsername, candidate.configUsername)
          )
        );
    }
  }
}

export type AutoRenewalSweepSummary = {
  checked: number;
  renewed: number;
  skipped: number;
};

let task: ReturnType<typeof cron.schedule> | null = null;
export function startAutoRenewalCron(
  panels: RebeccaPanelRegistry,
  walletService: WalletService,
  pricingService: PricingService,
  translationService: TranslationService,
  telegramApi: Api
): void {
  stopAutoRenewalCron();
  const candidateStore = new PostgresAutoRenewalCandidateStore();
  const deliveryStore = new PostgresNotificationDeliveryStore();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('auto-renewal', async () => {
        await runAutoRenewalSweep(
          panels,
          walletService,
          pricingService,
          translationService,
          telegramApi,
          candidateStore,
          deliveryStore
        );
      });
    } catch (err) {
      logger.error({ err }, 'Auto-renewal sweep failed');
    }
  };

  task = cron.schedule('20 * * * *', () => {
    void run();
  });
  void run();
  logger.info('Wallet auto-renewal cron started');
}

export function stopAutoRenewalCron(): void {
  task?.stop();
  task = null;
}

export async function runAutoRenewalSweep(
  panels: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService,
  walletService: WalletService,
  pricingService: PricingService,
  translationService: TranslationService,
  telegramApi: Api,
  candidateStore: AutoRenewalCandidateStore = new PostgresAutoRenewalCandidateStore(),
  deliveryStore: NotificationDeliveryStore = new PostgresNotificationDeliveryStore(),
  now = new Date()
): Promise<AutoRenewalSweepSummary> {
  const configs = await candidateStore.listEnabledConfigs();
  const thresholdGb = translationService.getSettingNum('low_traffic_threshold_gb', 2);
  const expiryWarningDays = translationService.getSettingNum('expiry_warning_days', 3);
  const summary: AutoRenewalSweepSummary = { checked: 0, renewed: 0, skipped: 0 };

  for (const config of configs) {
    summary.checked += 1;
    try {
      const apiUser = await getRebeccaService(panels, config.panelId).getUser(
        config.configUsername
      );
      const assessment = assessNotificationConditions(apiUser, {
        thresholdGb,
        expiryWarningDays,
        now,
      });
      if (!assessment.renewable || (!assessment.lowTraffic && !assessment.nearExpiry)) {
        await deliveryStore.deactivate(config, 'auto_renew_low_balance', now);
        await deliveryStore.deactivate(config, 'auto_renew_package_missing', now);
        summary.skipped += 1;
        continue;
      }

      const selectedPackage =
        pricingService.getPackageById?.(config.autoRenewPackageId) ??
        pricingService
          .getPackages(config.panelId, config.serviceId)
          .find((pkg) => pkg.id === config.autoRenewPackageId);
      if (
        !selectedPackage ||
        (selectedPackage.panelId !== undefined && selectedPackage.panelId !== config.panelId) ||
        (selectedPackage.serviceId !== undefined &&
          selectedPackage.serviceId !== config.serviceId) ||
        config.autoRenewPrice === null ||
        (config.autoRenewPrice !== undefined && selectedPackage.price !== config.autoRenewPrice)
      ) {
        const reserved = await deliveryStore.reserve(config, 'auto_renew_package_missing', now);
        if (reserved) {
          try {
            const locale = config.locale ?? translationService.resolveLocale();
            await telegramApi.sendMessage(
              config.telegramId,
              buildScreen({
                emoji: '⚠️',
                title: tForLocale(
                  translationService,
                  locale,
                  'auto_renew_package_unavailable_title'
                ),
                subtitle: tForLocale(
                  translationService,
                  locale,
                  'auto_renew_package_unavailable_subtitle'
                ),
                primary: {
                  emoji: '📱',
                  label: tForLocale(translationService, locale, 'auto_renew_service_label'),
                  value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
                },
                footer: `ℹ️ ${tForLocale(
                  translationService,
                  locale,
                  'auto_renew_package_unavailable'
                )}`,
              }),
              {
                parse_mode: 'Markdown',
                reply_markup: new InlineKeyboard().text(
                  tForLocale(translationService, locale, 'subscription_view_detail'),
                  config.configId ? `config:view:${config.configId}` : 'subs:page:1'
                ),
              }
            );
            if (candidateStore.disableAutoRenew) {
              await candidateStore.disableAutoRenew(config);
            }
          } catch (err) {
            await deliveryStore.release(config, ['auto_renew_package_missing'], new Date());
            logger.warn(
              { err, configUsername: config.configUsername },
              'Auto-renewal missing package notice delivery failed'
            );
          }
        }
        summary.skipped += 1;
        continue;
      }

      const balance = await walletService.getBalance(config.telegramId);
      if (balance < selectedPackage.price) {
        const reserved = await deliveryStore.reserve(config, 'auto_renew_low_balance', now);
        if (reserved) {
          try {
            const locale = config.locale ?? translationService.resolveLocale();
            await telegramApi.sendMessage(
              config.telegramId,
              buildScreen({
                emoji: '💳',
                title: tForLocale(translationService, locale, 'auto_renew_low_balance_title'),
                subtitle: tForLocale(translationService, locale, 'auto_renew_low_balance_subtitle'),
                primary: {
                  emoji: '♻️',
                  label: tForLocale(translationService, locale, 'auto_renew_required_label'),
                  value: formatAutoRenewalCurrency(
                    selectedPackage.price,
                    translationService,
                    locale
                  ),
                },
                sections: [
                  {
                    emoji: '📱',
                    title: tForLocale(translationService, locale, 'auto_renew_service_label'),
                    fields: [
                      {
                        label: tForLocale(translationService, locale, 'auto_renew_service_label'),
                        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
                      },
                      {
                        label: tForLocale(translationService, locale, 'auto_renew_balance_label'),
                        value: formatAutoRenewalCurrency(balance, translationService, locale),
                      },
                    ],
                  },
                ],
              }),
              {
                parse_mode: 'Markdown',
                reply_markup: new InlineKeyboard().text(
                  tForLocale(translationService, locale, 'menu_top_up'),
                  'nav:wallet'
                ),
              }
            );
          } catch (err) {
            await deliveryStore.release(config, ['auto_renew_low_balance'], new Date());
            logger.warn(
              { err, configUsername: config.configUsername },
              'Auto-renewal low-balance notice delivery failed'
            );
          }
        }
        summary.skipped += 1;
        continue;
      }

      await deliveryStore.deactivate(config, 'auto_renew_low_balance', now);
      await deliveryStore.deactivate(config, 'auto_renew_package_missing', now);
      try {
        await walletService.executePurchaseSaga({
          telegramId: config.telegramId,
          amount: selectedPackage.price,
          type: 'renew_config',
          configUsername: config.configUsername,
          gbAmount: selectedPackage.gbAmount,
          durationDays: selectedPackage.durationDays,
          panelId: config.panelId,
          serviceId: config.serviceId,
        });
      } catch (err) {
        if (err instanceof PurchaseOutcomePendingError || err instanceof PurchaseInProgressError) {
          logger.info(
            { errorName: err.name, configUsername: config.configUsername },
            'Auto-renewal deferred to purchase reconciliation'
          );
        } else {
          logger.warn({ err, configUsername: config.configUsername }, 'Auto-renewal saga failed');
        }
        summary.skipped += 1;
        continue;
      }

      summary.renewed += 1;
      try {
        const locale = config.locale ?? translationService.resolveLocale();
        const expireAt = new Date(now.getTime() + selectedPackage.durationDays * 86_400_000);
        await telegramApi.sendMessage(
          config.telegramId,
          buildScreen({
            emoji: '✅',
            title: tForLocale(translationService, locale, 'auto_renew_success_title'),
            subtitle: tForLocale(translationService, locale, 'auto_renew_success_subtitle'),
            primary: {
              emoji: '📱',
              label: tForLocale(translationService, locale, 'auto_renew_service_label'),
              value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
            },
            sections: [
              {
                emoji: '📦',
                title: tForLocale(translationService, locale, 'auto_renew_package_label'),
                fields: [
                  {
                    label: tForLocale(translationService, locale, 'auto_renew_package_label'),
                    value: escapeTelegramMarkdown(selectedPackage.name),
                  },
                  {
                    label: tForLocale(translationService, locale, 'auto_renew_quota_label'),
                    value: `${formatAutoRenewalNumber(selectedPackage.gbAmount, locale)} GB`,
                  },
                  {
                    label: tForLocale(translationService, locale, 'auto_renew_expiry_label'),
                    value: expireAt.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US'),
                  },
                ],
              },
            ],
          }),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text(
              tForLocale(translationService, locale, 'subscription_view_detail'),
              config.configId ? `config:view:${config.configId}` : 'subs:page:1'
            ),
          }
        );
      } catch (err) {
        logger.warn(
          { err, configUsername: config.configUsername },
          'Auto-renewal confirmation delivery failed'
        );
      }
    } catch (err) {
      summary.skipped += 1;
      if (err instanceof RebeccaOriginDownError) {
        logger.warn(
          { configUsername: config.configUsername },
          'Auto-renewal config skipped: its Rebecca panel origin is down'
        );
        continue;
      }
      logger.warn({ err, configUsername: config.configUsername }, 'Auto-renewal config skipped');
    }
  }

  logger.info(summary, 'Auto-renewal sweep complete');
  return summary;
}

function normalizeLocale(locale: string): SupportedLocale | undefined {
  return locale === 'en' || locale === 'fa' ? locale : undefined;
}

function formatAutoRenewalNumber(value: number, locale: SupportedLocale): string {
  return value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
}

function formatAutoRenewalCurrency(
  value: number,
  translationService: TranslationService,
  locale: SupportedLocale
): string {
  return `${formatAutoRenewalNumber(value, locale)} ${tForLocale(
    translationService,
    locale,
    'currency_toman'
  )}`;
}
