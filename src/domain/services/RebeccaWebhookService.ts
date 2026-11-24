import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { userConfigs, users } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { TranslationService, SupportedLocale } from './TranslationService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { WalletService } from './WalletService.js';
import type { PricingService } from './PricingService.js';
import type { ConfigReconciliationService } from './ConfigReconciliationService.js';
import { formatTelegramConfigRef, formatWebhookAlertScreen } from './TelegramFormatting.js';

export interface WebhookInlineButton {
  text: string;
  callback_data: string;
}

export interface WebhookTelegramSender {
  sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      parse_mode?: string;
      reply_markup?: { inline_keyboard: WebhookInlineButton[][] };
    }
  ): Promise<unknown>;
}

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
  panelId?: string;
  panel_id?: string;
  enqueued_at?: number;
  tries?: number;
  send_at?: number;
  by?: string;
  user?: Record<string, unknown>;
  admin?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RebeccaWebhookServiceOptions {
  panels: RebeccaPanelRegistry;
  translationService: TranslationService;
  telegramApi: WebhookTelegramSender;
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

const MAX_DEDUPE_CACHE_SIZE = 2000;

export class RebeccaWebhookService {
  private readonly panels: RebeccaPanelRegistry;
  private readonly translationService: TranslationService;
  private readonly telegramApi: WebhookTelegramSender;
  private readonly walletService?: WalletService;
  private readonly pricingService?: PricingService;
  private readonly configReconciliationService?: ConfigReconciliationService;
  private readonly secret?: string;
  private readonly dedupeWindowMs: number;
  private readonly recentAlertTimestamps = new Map<string, number>();
  private scanInFlight: Promise<unknown> | null = null;

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
    return lastSent !== undefined && now - lastSent < this.dedupeWindowMs;
  }

  private markAlertSent(key: string, now: number): void {
    // Refresh insertion order so eviction always removes the oldest timestamp.
    this.recentAlertTimestamps.delete(key);
    this.recentAlertTimestamps.set(key, now);
    if (this.recentAlertTimestamps.size > MAX_DEDUPE_CACHE_SIZE) {
      const cutoff = now - this.dedupeWindowMs;
      for (const [k, timestamp] of this.recentAlertTimestamps) {
        if (timestamp < cutoff) {
          this.recentAlertTimestamps.delete(k);
        }
      }
      while (this.recentAlertTimestamps.size > MAX_DEDUPE_CACHE_SIZE) {
        const oldestKey = this.recentAlertTimestamps.keys().next().value;
        if (oldestKey === undefined) break;
        this.recentAlertTimestamps.delete(oldestKey);
      }
    }
  }

  private triggerReconciliationScan(): void {
    if (!this.configReconciliationService || this.scanInFlight) return;
    const scanPromise = this.configReconciliationService
      .scan()
      .catch((err) => {
        logger.warn({ err }, 'Deferred reconciliation scan failed after webhook deletion');
      })
      .finally(() => {
        if (this.scanInFlight === scanPromise) {
          this.scanInFlight = null;
        }
      });
    this.scanInFlight = scanPromise;
  }

  async handleWebhook(
    payload: RebeccaWebhookPayload | RebeccaWebhookPayload[],
    secretHeader?: string | string[],
    now = Date.now()
  ): Promise<RebeccaWebhookResult> {
    if (!this.verifySecret(secretHeader)) {
      logger.warn('Unauthorized Rebecca webhook request rejected');
      return { handled: false, statusCode: 401, message: 'Unauthorized' };
    }

    if (!payload || typeof payload !== 'object') {
      return { handled: false, statusCode: 400, message: 'Invalid payload structure' };
    }

    const events: RebeccaWebhookPayload[] = Array.isArray(payload) ? payload : [payload];

    if (events.length === 0) {
      return { handled: true, statusCode: 200, matchedConfigs: 0, actionsPerformed: [] };
    }

    for (const event of events) {
      if (
        !event ||
        typeof event !== 'object' ||
        typeof event.username !== 'string' ||
        typeof event.action !== 'string'
      ) {
        return { handled: false, statusCode: 400, message: 'Invalid payload structure' };
      }
    }

    let totalMatchedConfigs = 0;
    const allActionsPerformed: string[] = [];

    for (const event of events) {
      const { matched, actions } = await this.processEvent(event, now);
      totalMatchedConfigs += matched;
      allActionsPerformed.push(...actions);
    }

    return {
      handled: true,
      statusCode: 200,
      matchedConfigs: totalMatchedConfigs,
      actionsPerformed: allActionsPerformed,
    };
  }

  private async processEvent(
    payload: RebeccaWebhookPayload,
    now: number
  ): Promise<{ matched: number; actions: string[] }> {
    const { username, action } = payload;
    const rawPanelId =
      typeof payload.panelId === 'string'
        ? payload.panelId
        : typeof payload.panel_id === 'string'
          ? payload.panel_id
          : '';
    const panelId = rawPanelId.trim() || undefined;
    logger.info(
      { username, action, ...(panelId ? { panelId } : {}) },
      'Processing Rebecca panel webhook event'
    );

    const matchingConfigs = await getDb()
      .select({
        configId: userConfigs.id,
        panelId: userConfigs.panelId,
        serviceId: userConfigs.serviceId,
        configUsername: userConfigs.configUsername,
        userLabel: userConfigs.userLabel,
        telegramId: userConfigs.telegramId,
        autoRenewEnabled: userConfigs.autoRenewEnabled,
        autoRenewPackageId: userConfigs.autoRenewPackageId,
        autoRenewPrice: userConfigs.autoRenewPrice,
        locale: users.locale,
      })
      .from(userConfigs)
      .innerJoin(users, eq(userConfigs.telegramId, users.telegramId))
      .where(
        panelId
          ? and(eq(userConfigs.configUsername, username), eq(userConfigs.panelId, panelId))
          : eq(userConfigs.configUsername, username)
      );

    if (matchingConfigs.length === 0) {
      logger.info({ username, action }, 'Rebecca webhook received for unknown or untracked config');
      return { matched: 0, actions: [] };
    }

    const actionsPerformed: string[] = [];
    let shouldScanDeleted = false;

    for (const cfg of matchingConfigs) {
      const locale: SupportedLocale =
        cfg.locale === 'en' || cfg.locale === 'fa'
          ? cfg.locale
          : this.translationService.resolveLocale();

      if (action === 'user_limited' || action === 'user_expired') {
        const dedupeKey = `${cfg.panelId}:${cfg.telegramId}:${cfg.configUsername}:${action}`;
        if (this.isDuplicate(dedupeKey, now)) {
          logger.debug({ dedupeKey }, 'Duplicate Rebecca webhook event suppressed');
          continue;
        }

        const isLimited = action === 'user_limited';
        const titleKey = isLimited ? 'webhook_alert_limited_title' : 'webhook_alert_expired_title';
        const bodyKey = isLimited ? 'webhook_alert_limited_body' : 'webhook_alert_expired_body';

        const screen = formatWebhookAlertScreen({
          emoji: isLimited ? '⚠️' : '⏳',
          title: this.translationService.get(titleKey, locale),
          subtitle: this.translationService.get(bodyKey, locale),
          primary: {
            emoji: '📱',
            label: this.translationService.get('webhook_service_label', locale),
            value: formatTelegramConfigRef(cfg.configUsername, cfg.userLabel),
          },
        });

        const replyMarkup = {
          inline_keyboard: [
            [
              {
                text: this.translationService.get('webhook_renew_button', locale),
                callback_data: `sub:detail:${cfg.configId}`,
              },
            ],
          ],
        };

        try {
          await this.telegramApi.sendMessage(cfg.telegramId, screen, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
          });
          this.markAlertSent(dedupeKey, now);
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
        shouldScanDeleted = true;
      } else {
        actionsPerformed.push(`logged_action_${action}:${cfg.configId}`);
      }
    }

    if (shouldScanDeleted) {
      this.triggerReconciliationScan();
    }

    // Reference optional services to preserve extensible lifecycle access
    void this.panels;
    void this.walletService;
    void this.pricingService;

    return {
      matched: matchingConfigs.length,
      actions: actionsPerformed,
    };
  }
}
