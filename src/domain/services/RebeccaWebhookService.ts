import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { InlineKeyboard, type Api } from 'grammy';
import { getDb } from '../../infra/db.js';
import { userConfigs, users } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { TranslationService, SupportedLocale } from './TranslationService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { WalletService } from './WalletService.js';
import type { PricingService } from './PricingService.js';
import type { ConfigReconciliationService } from './ConfigReconciliationService.js';
import { buildScreen } from '../../telegram/designSystem.js';
import { tForLocale } from '../../telegram/locale.js';
import { escapeTelegramMarkdown } from '../../telegram/rendering.js';

export type RebeccaWebhookAction =
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'user_limited'
  | 'user_expired'
  | 'user_disabled'
  | 'user_enabled'
  | (string & {});

export interface RebeccaWebhookPayload {
  username: string;
  action: RebeccaWebhookAction;
  enqueued_at?: number;
  tries?: number;
}

export interface RebeccaWebhookServiceOptions {
  panels: RebeccaPanelRegistry;
  translationService: TranslationService;
  telegramApi: Api;
  walletService?: WalletService;
  pricingService?: PricingService;
  configReconciliationService?: ConfigReconciliationService;
  secret?: string;
  dedupeWindowMs?: number;
}

export interface RebeccaWebhookResult {
  handled: boolean;
  statusCode: number;
  message?: string;
  matchedConfigs?: number;
  actionsPerformed?: string[];
}

const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export class RebeccaWebhookService {
  private readonly panels: RebeccaPanelRegistry;
  private readonly translationService: TranslationService;
  private readonly telegramApi: Api;
  private readonly walletService?: WalletService;
  private readonly pricingService?: PricingService;
  private readonly configReconciliationService?: ConfigReconciliationService;
  private readonly secret?: string;
  private readonly dedupeWindowMs: number;
  private readonly recentAlertTimestamps = new Map<string, number>();

  constructor(options: RebeccaWebhookServiceOptions) {
    this.panels = options.panels;
    this.translationService = options.translationService;
    this.telegramApi = options.telegramApi;
    this.walletService = options.walletService;
    this.pricingService = options.pricingService;
    this.configReconciliationService = options.configReconciliationService;
    this.secret = options.secret?.trim() || undefined;
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  }

  verifySecret(secretHeader?: string | string[]): boolean {
    if (!this.secret) {
      // If no secret configured, secret verification is skipped
      return true;
    }
    const headerValue = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    if (!headerValue) return false;

    const expected = Buffer.from(this.secret, 'utf8');
    const actual = Buffer.from(headerValue.trim(), 'utf8');
    if (expected.length !== actual.length) return false;

    return crypto.timingSafeEqual(expected, actual);
  }

  private isDuplicate(key: string, now: number): boolean {
    const lastSent = this.recentAlertTimestamps.get(key);
    if (lastSent && now - lastSent < this.dedupeWindowMs) {
      return true;
    }
    this.recentAlertTimestamps.set(key, now);
    if (this.recentAlertTimestamps.size > 2000) {
      const cutoff = now - this.dedupeWindowMs;
      for (const [k, timestamp] of this.recentAlertTimestamps) {
        if (timestamp < cutoff) {
          this.recentAlertTimestamps.delete(k);
        }
      }
    }
    return false;
  }

  async handleWebhook(
    payload: RebeccaWebhookPayload,
    secretHeader?: string | string[],
    now = Date.now()
  ): Promise<RebeccaWebhookResult> {
    if (!this.verifySecret(secretHeader)) {
      logger.warn('Unauthorized Rebecca webhook request rejected');
      return { handled: false, statusCode: 401, message: 'Unauthorized' };
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.username !== 'string' ||
      typeof payload.action !== 'string'
    ) {
      return { handled: false, statusCode: 400, message: 'Invalid payload structure' };
    }

    const { username, action } = payload;
    logger.info({ username, action }, 'Processing Rebecca panel webhook event');

    const matchingConfigs = await getDb()
      .select({
        configId: userConfigs.id,
        panelId: userConfigs.panelId,
        serviceId: userConfigs.serviceId,
        configUsername: userConfigs.configUsername,
        telegramId: userConfigs.telegramId,
        autoRenewEnabled: userConfigs.autoRenewEnabled,
        autoRenewPackageId: userConfigs.autoRenewPackageId,
        autoRenewPrice: userConfigs.autoRenewPrice,
        locale: users.locale,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(eq(userConfigs.configUsername, username));

    if (matchingConfigs.length === 0) {
      logger.info({ username, action }, 'Rebecca webhook received for unknown or untracked config');
      return { handled: true, statusCode: 200, matchedConfigs: 0 };
    }

    const actionsPerformed: string[] = [];

    for (const cfg of matchingConfigs) {
      const locale: SupportedLocale =
        cfg.locale === 'en' || cfg.locale === 'fa'
          ? cfg.locale
          : this.translationService.resolveLocale();

      if (action === 'user_limited' || action === 'user_expired') {
        const dedupeKey = `${cfg.telegramId}:${cfg.configUsername}:${action}`;
        if (this.isDuplicate(dedupeKey, now)) {
          logger.debug({ dedupeKey }, 'Duplicate Rebecca webhook event suppressed');
          continue;
        }

        const isLimited = action === 'user_limited';
        const titleKey = isLimited ? 'webhook_alert_limited_title' : 'webhook_alert_expired_title';
        const bodyKey = isLimited ? 'webhook_alert_limited_body' : 'webhook_alert_expired_body';

        const screen = buildScreen({
          emoji: isLimited ? '⚠️' : '⏳',
          title: tForLocale(this.translationService, locale, titleKey),
          subtitle: tForLocale(this.translationService, locale, bodyKey),
          primary: {
            emoji: '📱',
            label: tForLocale(this.translationService, locale, 'webhook_service_label'),
            value: `\`${escapeTelegramMarkdown(cfg.configUsername)}\``,
          },
        });

        const keyboard = new InlineKeyboard().text(
          tForLocale(this.translationService, locale, 'webhook_renew_button'),
          `sub:detail:${cfg.configId}`
        );

        try {
          await this.telegramApi.sendMessage(cfg.telegramId, screen, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
          actionsPerformed.push(`notified_user_${action}:${cfg.configId}`);
        } catch (sendErr) {
          logger.warn(
            { telegramId: cfg.telegramId, configId: cfg.configId, err: sendErr },
            'Failed to deliver Rebecca webhook notification to user'
          );
        }
      } else if (action === 'user_deleted') {
        actionsPerformed.push(`recorded_remote_deletion:${cfg.configId}`);
        logger.info(
          { configUsername: cfg.configUsername, panelId: cfg.panelId },
          'Rebecca webhook reported config deletion'
        );
        if (this.configReconciliationService) {
          void this.configReconciliationService.scan().catch((err) => {
            logger.warn({ err }, 'Deferred reconciliation scan failed after webhook deletion');
          });
        }
      } else {
        actionsPerformed.push(`logged_action_${action}:${cfg.configId}`);
      }
    }

    // Reference optional services to preserve extensible lifecycle access
    void this.panels;
    void this.walletService;
    void this.pricingService;

    return {
      handled: true,
      statusCode: 200,
      matchedConfigs: matchingConfigs.length,
      actionsPerformed,
    };
  }
}
