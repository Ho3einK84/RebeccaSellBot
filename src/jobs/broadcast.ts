import type { Api } from 'grammy';
import type { BroadcastService } from '../domain/services/BroadcastService.js';
import { logger } from '../infra/logger.js';
import { forEachConcurrent, jobRunner } from './workerRuntime.js';

const BROADCAST_POLL_INTERVAL_MS = 5_000;
const BROADCAST_BATCH_SIZE = 15;
const BROADCAST_CONCURRENCY = 3;
const BROADCAST_INTER_BATCH_DELAY_MS = 500;
const BROADCAST_MAX_RATE_LIMIT_RETRIES = 2;
let timer: NodeJS.Timeout | null = null;
let stopController: AbortController | null = null;

export interface ProcessBroadcastOptions {
  batchSize?: number;
  concurrency?: number;
  interBatchDelayMs?: number;
  signal?: AbortSignal;
}

export function startBroadcastWorker(broadcastService: BroadcastService, telegramApi: Api): void {
  stopBroadcastWorker();
  stopController = new AbortController();
  const signal = stopController.signal;
  const run = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      await jobRunner.run('broadcast-delivery', async () => {
        await processNextBroadcast(broadcastService, telegramApi, { signal });
      });
    } catch (err) {
      logger.error({ err }, 'Broadcast worker failed');
    }
  };
  void run();
  timer = setInterval(() => void run(), BROADCAST_POLL_INTERVAL_MS);
  logger.info('Durable broadcast worker started');
}

export function stopBroadcastWorker(): void {
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

export async function processNextBroadcast(
  broadcastService: BroadcastService,
  telegramApi: Pick<Api, 'sendMessage'>,
  options: ProcessBroadcastOptions = {}
): Promise<void> {
  const batchSize = options.batchSize ?? BROADCAST_BATCH_SIZE;
  const concurrency = options.concurrency ?? BROADCAST_CONCURRENCY;
  const interBatchDelayMs = options.interBatchDelayMs ?? BROADCAST_INTER_BATCH_DELAY_MS;
  const signal = options.signal;

  if (signal?.aborted) return;

  await broadcastService.requeueStaleClaims();
  const initial = await broadcastService.nextRunnableJob();
  if (!initial) return;
  if (initial.status === 'cancel_requested') {
    await broadcastService.finalizeCancelled(initial.id);
    return;
  }

  const running = await broadcastService.markRunning(initial.id);
  if (!running || running.status === 'cancel_requested') {
    if (running?.status === 'cancel_requested')
      await broadcastService.finalizeCancelled(running.id);
    return;
  }

  let cooldownUntil = 0;

  for (;;) {
    if (signal?.aborted) return;
    const current = await broadcastService.getJob(running.id);
    if (!current || current.status === 'completed' || current.status === 'cancelled') return;
    if (current.status === 'cancel_requested') {
      await broadcastService.finalizeCancelled(current.id);
      return;
    }

    const recipients = await broadcastService.claimBatch(current.id, batchSize);
    if (recipients.length === 0) {
      await broadcastService.finalizeCompleted(current.id);
      return;
    }

    await forEachConcurrent(recipients, concurrency, async (telegramId) => {
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) return;
        const waitMs = cooldownUntil - Date.now();
        if (waitMs > 0) {
          const continued = await sleepWithSignal(waitMs, signal);
          if (!continued) return;
        }

        try {
          await telegramApi.sendMessage(telegramId, current.message);
          await broadcastService.markRecipientSent(current.id, telegramId);
          return;
        } catch (err) {
          const retryAfter = extractRetryAfterSeconds(err);
          if (retryAfter !== undefined && attempt < BROADCAST_MAX_RATE_LIMIT_RETRIES) {
            const backoffMs = retryAfter * 1000;
            cooldownUntil = Math.max(cooldownUntil, Date.now() + backoffMs);
            logger.warn(
              { retryAfter, broadcastId: current.id, attempt: attempt + 1 },
              'Broadcast rate limit reached; backing off before retry'
            );
            const continued = await sleepWithSignal(backoffMs, signal);
            if (!continued) return;
            continue;
          }

          await broadcastService.markRecipientFailed(current.id, telegramId, err);
          logger.warn({ err, telegramId, broadcastId: current.id }, 'Broadcast recipient failed');
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
