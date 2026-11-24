import type { Api } from 'grammy';
import type {
  BulkGiftItem,
  BulkGiftJob,
  BulkGiftService,
} from '../domain/services/BulkGiftService.js';
import type { TranslationService } from '../domain/services/TranslationService.js';
import type { UserService } from '../domain/services/UserService.js';
import { logger } from '../infra/logger.js';
import { localizedNumberForLocale, resolveServiceLocale, tForLocale } from '../telegram/locale.js';
import { buildUserScreen } from '../telegram/designSystem.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../telegram/rendering.js';
import { forEachConcurrent, jobRunner } from './workerRuntime.js';

const BULK_GIFT_POLL_INTERVAL_MS = 5_000;
const BULK_GIFT_BATCH_SIZE = 10;
const BULK_GIFT_CONCURRENCY = 2;
const BULK_GIFT_INTER_BATCH_DELAY_MS = 350;
const BULK_GIFT_MAX_RATE_LIMIT_RETRIES = 2;

let timer: NodeJS.Timeout | null = null;
let stopController: AbortController | null = null;

export interface BulkGiftWorkerDeps {
  bulkGiftService: BulkGiftService;
  telegramApi?: Pick<Api, 'sendMessage'>;
  userService?: Pick<UserService, 'getLocale'>;
  translationService?: TranslationService;
}

export interface ProcessBulkGiftOptions {
  batchSize?: number;
  concurrency?: number;
  interBatchDelayMs?: number;
  signal?: AbortSignal;
  telegramApi?: Pick<Api, 'sendMessage'>;
  userService?: Pick<UserService, 'getLocale'>;
  translationService?: TranslationService;
}

export function startBulkGiftWorker(deps: BulkGiftWorkerDeps): void {
  stopBulkGiftWorker();
  stopController = new AbortController();
  const signal = stopController.signal;

  const run = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      await jobRunner.run('bulk-gift-execution', async () => {
        await processNextBulkGift(deps.bulkGiftService, {
          signal,
          telegramApi: deps.telegramApi,
          userService: deps.userService,
          translationService: deps.translationService,
        });
      });
    } catch (err) {
      logger.error({ err }, 'Bulk gift worker failed');
    }
  };

  void run();
  timer = setInterval(() => void run(), BULK_GIFT_POLL_INTERVAL_MS);
  logger.info('Durable bulk gift worker started');
}

export function stopBulkGiftWorker(): void {
  if (stopController) {
    stopController.abort();
    stopController = null;
  }
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function extractRetryAfterSeconds(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('parameters' in err)) return undefined;
  const retryAfter = (err as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter
    : undefined;
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  if (ms <= 0) return true;
  return await new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      resolve(false);
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function formatGiftNotificationMessage(
  job: BulkGiftJob,
  item: BulkGiftItem,
  locale: 'fa' | 'en',
  translationService?: TranslationService
): { text: string; parseMode?: 'Markdown' } {
  const customMessage = job.notifyMessage?.trim() ?? '';
  if (!translationService) {
    const parts: string[] = [];
    if (job.giftGb > 0) parts.push(`+${job.giftGb} GB`);
    if (job.giftDays > 0) parts.push(`+${job.giftDays}d`);
    const summary = parts.join(' · ');
    return {
      text: `🎁 ${item.configUsername} (${summary})\n\n${customMessage}`.trim(),
    };
  }

  const giftParts: string[] = [];
  if (job.giftGb > 0) {
    giftParts.push(
      `+${localizedNumberForLocale(job.giftGb, locale)} ${tForLocale(translationService, locale, 'traffic_unit_gb')}`
    );
  }
  if (job.giftDays > 0) {
    giftParts.push(
      `+${localizedNumberForLocale(job.giftDays, locale)} ${tForLocale(translationService, locale, 'days_unit')}`
    );
  }

  const screen = buildUserScreen({
    emoji: '🎁',
    title: tForLocale(translationService, locale, 'bulk_gift_user_notice_title'),
    subtitle: tForLocale(translationService, locale, 'bulk_gift_user_notice_subtitle'),
    primary: {
      emoji: '✨',
      label: tForLocale(translationService, locale, 'bulk_gift_user_notice_reward_label'),
      value: giftParts.join(' · '),
      inline: true,
    },
    sections: [
      {
        bullet: '',
        fields: [
          {
            label: tForLocale(translationService, locale, 'bulk_gift_user_notice_service_label'),
            value: `\`${sanitizeTelegramInlineCode(item.configUsername)}\``,
          },
          ...(customMessage
            ? [
                {
                  value: escapeTelegramMarkdown(customMessage),
                },
              ]
            : []),
        ],
      },
    ],
  });

  return { text: screen, parseMode: 'Markdown' };
}

export async function processNextBulkGift(
  bulkGiftService: BulkGiftService,
  options: ProcessBulkGiftOptions = {}
): Promise<void> {
  const batchSize = options.batchSize ?? BULK_GIFT_BATCH_SIZE;
  const concurrency = options.concurrency ?? BULK_GIFT_CONCURRENCY;
  const interBatchDelayMs = options.interBatchDelayMs ?? BULK_GIFT_INTER_BATCH_DELAY_MS;
  const signal = options.signal;

  if (signal?.aborted) return;

  await bulkGiftService.requeueStaleClaims();
  const initial = await bulkGiftService.nextRunnableJob();
  if (!initial) return;
  if (initial.status === 'cancel_requested') {
    await bulkGiftService.finalizeCancelled(initial.id);
    return;
  }

  const running = await bulkGiftService.markRunning(initial.id);
  if (!running || running.status === 'cancel_requested') {
    if (running?.status === 'cancel_requested') {
      await bulkGiftService.finalizeCancelled(running.id);
    }
    return;
  }

  let notifyCooldownUntil = 0;

  for (;;) {
    if (signal?.aborted) return;
    const current = await bulkGiftService.getJob(running.id);
    if (!current || current.status === 'completed' || current.status === 'cancelled') return;
    if (current.status === 'cancel_requested') {
      await bulkGiftService.finalizeCancelled(current.id);
      return;
    }

    const batch = await bulkGiftService.claimBatch(current.id, batchSize);
    if (batch.length === 0) {
      await bulkGiftService.finalizeCompleted(current.id);
      return;
    }

    await forEachConcurrent(batch, concurrency, async (item) => {
      if (signal?.aborted) return;
      const outcome = await bulkGiftService.applyGiftToItem(current, item);
      if (outcome.status !== 'applied') return;

      const notifyText = current.notifyMessage?.trim();
      if (!notifyText || !options.telegramApi) return;

      const locale =
        (await options.userService?.getLocale?.(item.telegramId).catch(() => undefined)) ??
        resolveServiceLocale(options.translationService);
      const formatted = formatGiftNotificationMessage(
        current,
        item,
        locale,
        options.translationService
      );

      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) return;
        const waitMs = notifyCooldownUntil - Date.now();
        if (waitMs > 0) {
          const continued = await sleepWithSignal(waitMs, signal);
          if (!continued) return;
        }
        try {
          await options.telegramApi.sendMessage(
            item.telegramId,
            formatted.text,
            formatted.parseMode ? { parse_mode: formatted.parseMode } : undefined
          );
          await bulkGiftService.markItemNotified(current.id, item.configId);
          return;
        } catch (err) {
          const retryAfter = extractRetryAfterSeconds(err);
          if (retryAfter !== undefined && attempt < BULK_GIFT_MAX_RATE_LIMIT_RETRIES) {
            const backoffMs = retryAfter * 1000;
            notifyCooldownUntil = Math.max(notifyCooldownUntil, Date.now() + backoffMs);
            logger.warn(
              { retryAfter, jobId: current.id, telegramId: item.telegramId, attempt: attempt + 1 },
              'Bulk gift notification rate limited; backing off before retry'
            );
            const continued = await sleepWithSignal(backoffMs, signal);
            if (!continued) return;
            continue;
          }
          // Notification failures must NOT undo or fail an already-applied panel gift.
          logger.warn(
            { err, jobId: current.id, telegramId: item.telegramId, configId: item.configId },
            'Bulk gift notification failed after gift was applied'
          );
          return;
        }
      }
    });

    if (interBatchDelayMs > 0) {
      const continued = await sleepWithSignal(interBatchDelayMs, signal);
      if (!continued) return;
    }
  }
}
