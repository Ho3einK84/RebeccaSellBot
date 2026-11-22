/**
 * 5-Minute ForApp Manual-Receipt Fallback Nudge Worker.
 *
 * If a user created a `forapp_card` automated top-up invoice and 5 minutes have
 * elapsed without automatic SMS confirmation (e.g., bank SMS delay or the admin's
 * ForApp phone temporarily offline), this worker atomically stamps
 * `metadata.manualHintSentAt` BEFORE sending a single reassuring Telegram message
 * guiding the user to submit their receipt photo manually if they already paid.
 *
 * Guarantees:
 * - At-most-once delivery per invoice via atomic DB metadata claim.
 * - Skips users who already submitted a pending manual receipt.
 * - Skips completed, cancelled, failed, or expired invoices.
 */
import cron from 'node-cron';
import { InlineKeyboard, type Api } from 'grammy';
import { and, eq, gt, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import {
  FORAPP_MANUAL_HINT_DELAY_MS,
  formatPaymentOrderShortId,
} from '../domain/services/AutomatedPaymentService.js';
import { forappEnabled } from '../domain/services/FeatureSettings.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';
import { getDb } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { paymentOrders, topupReceipts, users } from '../infra/schema.js';
import { buildUserScreen } from '../telegram/designSystem.js';
import { localizedNumberForLocale, tForLocale } from '../telegram/locale.js';
import { jobRunner } from './workerRuntime.js';

export interface ForAppFallbackCandidate {
  id: string;
  telegramId: number;
  payableAmount: number;
  metadata: string | null;
  createdAt: Date;
  expiresAt: Date;
  locale?: SupportedLocale;
}

export interface ForAppFallbackNudgeStore {
  listCandidates(thresholdCreatedAt: Date, now: Date): Promise<ForAppFallbackCandidate[]>;
  /**
   * Atomically stamp `manualHintSentAt` into `payment_orders.metadata` while
   * the order is still pending and has not yet been nudged.
   */
  claimManualHint(orderId: string, existingMetadata: string | null, now: Date): Promise<boolean>;
}

export interface ForAppFallbackNudgeDeps {
  translationService: TranslationService;
  telegramApi: Pick<Api, 'sendMessage'>;
  store?: ForAppFallbackNudgeStore;
}

export interface ForAppFallbackNudgeSummary {
  enabled: boolean;
  checked: number;
  nudged: number;
  skippedErrors: number;
}

export function buildClaimedMetadataJson(existingMetadata: string | null, now: Date): string {
  let base: Record<string, unknown> = {};
  if (existingMetadata) {
    try {
      const parsed: unknown = JSON.parse(existingMetadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  base.manualHintSentAt = now.toISOString();
  return JSON.stringify(base);
}

export class PostgresForAppFallbackNudgeStore implements ForAppFallbackNudgeStore {
  async listCandidates(thresholdCreatedAt: Date, now: Date): Promise<ForAppFallbackCandidate[]> {
    const rows = await getDb()
      .select({
        id: paymentOrders.id,
        telegramId: paymentOrders.telegramId,
        payableAmount: paymentOrders.payableAmount,
        metadata: paymentOrders.metadata,
        createdAt: paymentOrders.createdAt,
        expiresAt: paymentOrders.expiresAt,
        locale: users.locale,
      })
      .from(paymentOrders)
      .innerJoin(users, eq(paymentOrders.telegramId, users.telegramId))
      .where(
        and(
          eq(paymentOrders.provider, 'forapp_card'),
          eq(paymentOrders.status, 'pending'),
          lte(paymentOrders.createdAt, thresholdCreatedAt),
          gt(paymentOrders.expiresAt, now),
          or(
            isNull(paymentOrders.metadata),
            sql`${paymentOrders.metadata} NOT LIKE '%"manualHintSentAt"%'`
          ),
          notExists(
            getDb()
              .select({ id: topupReceipts.id })
              .from(topupReceipts)
              .where(
                and(
                  eq(topupReceipts.telegramId, paymentOrders.telegramId),
                  eq(topupReceipts.status, 'pending')
                )
              )
          )
        )
      )
      .limit(50);

    return rows.map(({ locale, ...row }) => ({
      ...row,
      locale: locale === 'en' || locale === 'fa' ? locale : undefined,
    }));
  }

  async claimManualHint(
    orderId: string,
    existingMetadata: string | null,
    now: Date
  ): Promise<boolean> {
    const nextMetadata = buildClaimedMetadataJson(existingMetadata, now);
    const [claimed] = await getDb()
      .update(paymentOrders)
      .set({ metadata: nextMetadata, updatedAt: now })
      .where(
        and(
          eq(paymentOrders.id, orderId),
          eq(paymentOrders.status, 'pending'),
          or(
            isNull(paymentOrders.metadata),
            sql`${paymentOrders.metadata} NOT LIKE '%"manualHintSentAt"%'`
          )
        )
      )
      .returning({ id: paymentOrders.id });
    return claimed !== undefined;
  }
}

export async function runForAppFallbackNudgeCycle(
  deps: ForAppFallbackNudgeDeps,
  now = new Date()
): Promise<ForAppFallbackNudgeSummary> {
  const summary: ForAppFallbackNudgeSummary = {
    enabled: forappEnabled(deps.translationService),
    checked: 0,
    nudged: 0,
    skippedErrors: 0,
  };

  if (!summary.enabled) {
    return summary;
  }

  const store = deps.store ?? new PostgresForAppFallbackNudgeStore();
  const thresholdCreatedAt = new Date(now.getTime() - FORAPP_MANUAL_HINT_DELAY_MS);

  let candidates: ForAppFallbackCandidate[];
  try {
    candidates = await store.listCandidates(thresholdCreatedAt, now);
  } catch (err) {
    logger.error({ err }, 'ForApp fallback nudge: failed to query pending orders');
    summary.skippedErrors += 1;
    return summary;
  }

  for (const candidate of candidates) {
    if (
      now.getTime() - candidate.createdAt.getTime() < FORAPP_MANUAL_HINT_DELAY_MS ||
      candidate.expiresAt.getTime() <= now.getTime()
    ) {
      continue;
    }

    summary.checked += 1;

    let claimed: boolean;
    try {
      claimed = await store.claimManualHint(candidate.id, candidate.metadata, now);
    } catch (err) {
      summary.skippedErrors += 1;
      logger.warn({ err, orderId: candidate.id }, 'ForApp fallback nudge: atomic claim failed');
      continue;
    }
    if (!claimed) {
      continue;
    }

    const locale = candidate.locale ?? deps.translationService.resolveLocale();
    const currency = tForLocale(deps.translationService, locale, 'currency_toman');
    const shortId = formatPaymentOrderShortId(candidate.id);
    const amountFormatted = localizedNumberForLocale(candidate.payableAmount, locale);

    const messageText = buildUserScreen({
      emoji: '💡',
      title: tForLocale(deps.translationService, locale, 'forapp_delayed_hint_title'),
      subtitle: tForLocale(deps.translationService, locale, 'forapp_delayed_hint_subtitle'),
      sections: [
        {
          fields: [
            {
              label: tForLocale(deps.translationService, locale, 'auto_pay_order_id_label'),
              value: `\`#${shortId}\``,
            },
            {
              label: tForLocale(deps.translationService, locale, 'auto_pay_exact_amount_label'),
              value: `${amountFormatted} ${currency}`,
            },
          ],
        },
      ],
      footer: tForLocale(deps.translationService, locale, 'forapp_delayed_hint_body'),
      direction: locale === 'fa' ? 'rtl' : 'ltr',
    });

    const keyboard = new InlineKeyboard()
      .text(
        tForLocale(deps.translationService, locale, 'forapp_manual_fallback_button'),
        `porder:manual:${candidate.id}`
      )
      .row()
      .text(
        tForLocale(deps.translationService, locale, 'auto_pay_check_status_button'),
        `porder:check:${candidate.id}`
      )
      .row()
      .text(tForLocale(deps.translationService, locale, 'menu_close'), 'ui:dismiss');

    try {
      await deps.telegramApi.sendMessage(candidate.telegramId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      summary.nudged += 1;
      logger.info(
        { telegramId: candidate.telegramId, orderId: candidate.id },
        'ForApp 5-minute manual-receipt fallback hint delivered'
      );
    } catch (err) {
      summary.skippedErrors += 1;
      logger.warn(
        {
          errorName: err instanceof Error ? err.name : typeof err,
          telegramId: candidate.telegramId,
          orderId: candidate.id,
        },
        'ForApp fallback nudge: Telegram delivery failed after atomic claim'
      );
    }
  }

  return summary;
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startForAppFallbackNudgeJob(
  deps: ForAppFallbackNudgeDeps,
  schedule = '* * * * *'
): void {
  stopForAppFallbackNudgeJob();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('forapp-fallback-nudge', async () => {
        await runForAppFallbackNudgeCycle(deps);
      });
    } catch (err) {
      logger.error({ err }, 'ForApp fallback nudge cron worker failed');
    }
  };

  task = cron.schedule(schedule, () => {
    void run();
  });
  logger.info({ schedule }, 'ForApp fallback nudge cron worker started (every minute)');
}

export function stopForAppFallbackNudgeJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
