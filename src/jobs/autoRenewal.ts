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
import type { CatalogDiscountService } from '../domain/services/CatalogDiscountService.js';
import { safeListActiveDiscounts } from '../domain/services/CatalogDiscountService.js';
import {
  safeGetEffectiveUserPolicy,
  type UserGroupService,
} from '../domain/services/UserGroupService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { buildUserScreen } from '../telegram/designSystem.js';
import { tForLocale } from '../telegram/locale.js';
import { escapeTelegramMarkdown } from '../telegram/rendering.js';
import { formatTelegramConfigRef } from '../domain/services/TelegramFormatting.js';
import {
  PostgresNotificationDeliveryStore,
  assessNotificationConditions,
  positiveFinite,
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
        userLabel: userConfigs.userLabel,
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

export interface AutoRenewalPolicyDeps {
  userGroupService?: Pick<UserGroupService, 'getEffectiveUserPolicy'>;
  catalogDiscountService?: Pick<CatalogDiscountService, 'listActiveDiscounts'>;
}

let task: ReturnType<typeof cron.schedule> | null = null;
export function startAutoRenewalCron(
  panels: RebeccaPanelRegistry,
  walletService: WalletService,
  pricingService: PricingService,
  translationService: TranslationService,
  telegramApi: Api,
  policyDeps?: AutoRenewalPolicyDeps
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
          deliveryStore,
          new Date(),
          policyDeps
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
  now = new Date(),
  policyDeps?: AutoRenewalPolicyDeps
): Promise<AutoRenewalSweepSummary> {
  const configs = await candidateStore.listEnabledConfigs();
  const activeCatalogDiscounts = policyDeps?.catalogDiscountService
    ? await safeListActiveDiscounts(policyDeps.catalogDiscountService, now)
    : [];
  const thresholdGb = positiveFinite(
    translationService.getSettingNum('low_traffic_threshold_gb', 2)
  );
  const expiryWarningDays = positiveFinite(
    translationService.getSettingNum('expiry_warning_days', 3)
  );
  const summary: AutoRenewalSweepSummary = { checked: 0, renewed: 0, skipped: 0 };
  const downPanels = new Set<string>();

  for (const config of configs) {
    if (downPanels.has(config.panelId)) {
      summary.checked += 1;
      summary.skipped += 1;
      continue;
    }
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
      const isExpiredOrExhausted =
        apiUser.status === 'expired' ||
        apiUser.status === 'limited' ||
        (assessment.secondsToExpiry !== null && assessment.secondsToExpiry <= 0);
      if (
        !assessment.renewable ||
        (!assessment.lowTraffic && !assessment.nearExpiry && !isExpiredOrExhausted)
      ) {
        await deliveryStore.deactivate(config, 'auto_renew_low_balance', now);
        await deliveryStore.deactivate(config, 'auto_renew_package_missing', now);
        summary.skipped += 1;
        continue;
      }

      const availablePackages =
        pricingService.getPackages?.(config.panelId, config.serviceId, false) ?? [];
      let selectedPackage = availablePackages.find((pkg) => pkg.id === config.autoRenewPackageId);

      // Check fallback via getPackageById:
      // - Static packages: must be enabled and match panel/service.
      // - Custom packages (`custom_XXgb_YYd`): allowed only when custom volume is enabled
      //   and bounds still hold; price ceiling is still enforced below.
      if (!selectedPackage && pricingService.getPackageById && config.autoRenewPackageId) {
        const customMatch = /^custom_(\d+)gb_(\d+)d$/i.exec(config.autoRenewPackageId);
        if (customMatch) {
          const cvEnabled =
            typeof translationService.getSetting === 'function'
              ? translationService
                  .getSetting('custom_volume_enabled', 'true')
                  .trim()
                  .toLowerCase() !== 'false' &&
                translationService
                  .getSetting('custom_volume_enabled', 'true')
                  .trim()
                  .toLowerCase() !== '0'
              : true;
          const gb = Number(customMatch[1]);
          const days = Number(customMatch[2]);
          const minGb =
            typeof translationService.getSettingNum === 'function'
              ? translationService.getSettingNum('custom_min_gb', 5)
              : 5;
          const maxGb =
            typeof translationService.getSettingNum === 'function'
              ? translationService.getSettingNum('custom_max_gb', 500)
              : 500;
          if (cvEnabled && gb >= minGb && gb <= maxGb && days >= 1 && days <= 365) {
            const candidatePkg = pricingService.getPackageById(config.autoRenewPackageId);
            if (candidatePkg && candidatePkg.enabled !== false) {
              selectedPackage = candidatePkg;
            }
          }
        } else {
          const candidatePkg = pricingService.getPackageById(config.autoRenewPackageId);
          if (
            candidatePkg &&
            candidatePkg.enabled !== false &&
            (candidatePkg.panelId === undefined || candidatePkg.panelId === config.panelId) &&
            (candidatePkg.serviceId === undefined || candidatePkg.serviceId === config.serviceId)
          ) {
            selectedPackage = candidatePkg;
          }
        }
      }

      const userPolicy = await safeGetEffectiveUserPolicy(
        policyDeps?.userGroupService,
        config.telegramId,
        now
      );

      let effectivePrice = selectedPackage?.price ?? 0;
      if (selectedPackage) {
        const customMatch = /^custom_(\d+)gb_(\d+)d$/i.exec(selectedPackage.id);
        if (customMatch && typeof pricingService.resolveCustomPriceWithDiscount === 'function') {
          effectivePrice = pricingService.resolveCustomPriceWithDiscount(
            selectedPackage.gbAmount,
            selectedPackage.durationDays,
            activeCatalogDiscounts,
            now,
            userPolicy
          ).effectivePrice;
        } else if (typeof pricingService.resolvePackagePrice === 'function') {
          effectivePrice = pricingService.resolvePackagePrice(
            selectedPackage,
            activeCatalogDiscounts,
            now,
            userPolicy
          ).effectivePrice;
        }
      }

      const ceilingPrice = config.autoRenewPrice;
      const isPriceExceeded =
        Boolean(selectedPackage) &&
        (typeof ceilingPrice !== 'number' ||
          !Number.isFinite(ceilingPrice) ||
          effectivePrice > ceilingPrice);

      if (!selectedPackage || isPriceExceeded) {
        const reserved = await deliveryStore.reserve(config, 'auto_renew_package_missing', now);
        if (reserved) {
          try {
            const locale = config.locale ?? translationService.resolveLocale();
            const titleKey = isPriceExceeded
              ? 'auto_renew_price_changed_title'
              : 'auto_renew_package_unavailable_title';
            const subtitleKey = isPriceExceeded
              ? 'auto_renew_price_changed_subtitle'
              : 'auto_renew_package_unavailable_subtitle';
            const footerKey = isPriceExceeded
              ? 'auto_renew_price_changed'
              : 'auto_renew_package_unavailable';

            await telegramApi.sendMessage(
              config.telegramId,
              buildUserScreen({
                emoji: '⚠️',
                title: tForLocale(translationService, locale, titleKey),
                subtitle: tForLocale(translationService, locale, subtitleKey),
                primary: {
                  label: tForLocale(translationService, locale, 'auto_renew_service_label'),
                  value: formatTelegramConfigRef(config.configUsername, config.userLabel),
                  inline: true,
                },
                footer: tForLocale(translationService, locale, footerKey),
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
            await deliveryStore.release(config, ['auto_renew_package_missing'], now);
            logger.warn(
              { err, configUsername: config.configUsername },
              'Auto-renewal missing package notice delivery failed'
            );
          }
        }
        // Disable auto-renew unconditionally once the package is unavailable or
        // exceeds the approved price ceiling, even if notice delivery was
        // skipped (deduped) or blocked by the user.
        if (candidateStore.disableAutoRenew) {
          await candidateStore.disableAutoRenew(config).catch((disableErr) => {
            logger.warn(
              { err: disableErr, configUsername: config.configUsername },
              'Failed to disable auto-renew after package/price check'
            );
          });
        }
        summary.skipped += 1;
        continue;
      }

      const balance =
        typeof walletService.getAvailableBalance === 'function'
          ? await walletService.getAvailableBalance(config.telegramId)
          : await walletService.getBalance(config.telegramId);
      const purchasingPower = Math.max(0, balance + userPolicy.creditLimit);
      if (purchasingPower < effectivePrice) {
        const reserved = await deliveryStore.reserve(config, 'auto_renew_low_balance', now);
        if (reserved) {
          try {
            const locale = config.locale ?? translationService.resolveLocale();
            await telegramApi.sendMessage(
              config.telegramId,
              buildUserScreen({
                emoji: '💳',
                title: tForLocale(translationService, locale, 'auto_renew_low_balance_title'),
                subtitle: tForLocale(translationService, locale, 'auto_renew_low_balance_subtitle'),
                primary: {
                  label: tForLocale(translationService, locale, 'auto_renew_required_label'),
                  value: formatAutoRenewalCurrency(effectivePrice, translationService, locale),
                  emphasizeValue: true,
                },
                sections: [
                  {
                    fields: [
                      {
                        label: tForLocale(translationService, locale, 'auto_renew_service_label'),
                        value: formatTelegramConfigRef(config.configUsername, config.userLabel),
                      },
                      {
                        label: tForLocale(translationService, locale, 'auto_renew_balance_label'),
                        value: formatAutoRenewalCurrency(
                          userPolicy.creditLimit > 0 ? purchasingPower : balance,
                          translationService,
                          locale
                        ),
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
            await deliveryStore.release(config, ['auto_renew_low_balance'], now);
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
          amount: effectivePrice,
          type: 'renew_config',
          configUsername: config.configUsername,
          gbAmount: selectedPackage.gbAmount,
          durationDays: selectedPackage.durationDays,
          panelId: config.panelId,
          serviceId: config.serviceId,
          ...(selectedPackage.rolloverQuota !== undefined
            ? { rolloverQuota: selectedPackage.rolloverQuota }
            : {}),
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
          buildUserScreen({
            emoji: '✅',
            title: tForLocale(translationService, locale, 'auto_renew_success_title'),
            subtitle: tForLocale(translationService, locale, 'auto_renew_success_subtitle'),
            primary: {
              label: tForLocale(translationService, locale, 'auto_renew_service_label'),
              value: formatTelegramConfigRef(config.configUsername, config.userLabel),
              inline: true,
            },
            sections: [
              {
                fields: [
                  {
                    label: tForLocale(translationService, locale, 'auto_renew_package_label'),
                    value: escapeTelegramMarkdown(
                      formatAutoRenewalPackageName(
                        translationService,
                        locale,
                        selectedPackage.id,
                        selectedPackage.name
                      )
                    ),
                  },
                  {
                    label: tForLocale(translationService, locale, 'auto_renew_quota_label'),
                    value: `${formatAutoRenewalNumber(selectedPackage.gbAmount, locale)} ${tForLocale(translationService, locale, 'traffic_unit_gb')}`,
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
        downPanels.add(config.panelId);
        logger.warn(
          { panelId: config.panelId, configUsername: config.configUsername },
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

function formatAutoRenewalPackageName(
  translationService: TranslationService,
  locale: SupportedLocale,
  packageId: string,
  fallback: string
): string {
  if (fallback.includes('|')) {
    const parts = fallback.split('|').map((s) => s.trim());
    return locale === 'fa' ? parts[0] || fallback : parts[1] || parts[0] || fallback;
  }
  const translatedKey = `package_${packageId}_name`;
  const translated = tForLocale(translationService, locale, translatedKey);
  if (translated !== translatedKey) {
    return translated;
  }
  return locale === 'fa' ? fallback.replace(/\b(\d+)\s*GB\b/gi, '$1 گیگ') : fallback;
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
