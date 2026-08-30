import type { Api } from 'grammy';
import type { BroadcastService } from '../domain/services/BroadcastService.js';
import { logger } from '../infra/logger.js';
import { forEachConcurrent, jobRunner } from './workerRuntime.js';

const BROADCAST_POLL_INTERVAL_MS = 5_000;
const BROADCAST_BATCH_SIZE = 15;
const BROADCAST_CONCURRENCY = 3;
const BROADCAST_INTER_BATCH_DELAY_MS = 500;
let timer: NodeJS.Timeout | null = null;

export interface ProcessBroadcastOptions {
  batchSize?: number;
  concurrency?: number;
  interBatchDelayMs?: number;
}

export function startBroadcastWorker(broadcastService: BroadcastService, telegramApi: Api): void {
  stopBroadcastWorker();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('broadcast-delivery', async () => {
        await processNextBroadcast(broadcastService, telegramApi);
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
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export async function processNextBroadcast(
  broadcastService: BroadcastService,
  telegramApi: Pick<Api, 'sendMessage'>,
  options: ProcessBroadcastOptions = {}
): Promise<void> {
  const batchSize = options.batchSize ?? BROADCAST_BATCH_SIZE;
  const concurrency = options.concurrency ?? BROADCAST_CONCURRENCY;
  const interBatchDelayMs = options.interBatchDelayMs ?? BROADCAST_INTER_BATCH_DELAY_MS;

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

  for (;;) {
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
      try {
        await telegramApi.sendMessage(telegramId, current.message);
        await broadcastService.markRecipientSent(current.id, telegramId);
      } catch (err) {
        await broadcastService.markRecipientFailed(current.id, telegramId, err);
        const retryAfter =
          typeof err === 'object' &&
          err !== null &&
          'parameters' in err &&
          typeof (err as { parameters?: { retry_after?: number } }).parameters?.retry_after ===
            'number'
            ? (err as { parameters?: { retry_after?: number } }).parameters!.retry_after!
            : undefined;
        if (retryAfter && retryAfter > 0) {
          logger.warn(
            { retryAfter, broadcastId: current.id },
            'Broadcast rate limit reached; backing off'
          );
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        } else {
          logger.warn({ err, telegramId, broadcastId: current.id }, 'Broadcast recipient failed');
        }
      }
    });

    if (interBatchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, interBatchDelayMs));
    }
  }
}
