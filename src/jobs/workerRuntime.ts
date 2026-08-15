import crypto from 'crypto';
import { getPool } from '../infra/db.js';
import { logger } from '../infra/logger.js';

export type JobRunResult = 'completed' | 'skipped_local_overlap' | 'skipped_distributed_lock';

export interface JobLockProvider {
  tryAcquire(name: string): Promise<(() => Promise<void>) | null>;
}

/**
 * PostgreSQL advisory locks are session-scoped. Keeping the client checked out
 * while a sweep runs guarantees only one replica owns a named job at a time.
 */
export class PostgresAdvisoryJobLockProvider implements JobLockProvider {
  async tryAcquire(name: string): Promise<(() => Promise<void>) | null> {
    const client = await getPool().connect();
    const lockKey = advisoryLockKey(name);
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [lockKey.toString()]
      );
      if (!result.rows[0]?.locked) {
        client.release();
        return null;
      }
    } catch (err) {
      client.release();
      throw err;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey.toString()]);
      } finally {
        client.release();
      }
    };
  }
}

/** Local single-flight plus cross-replica advisory-lock execution. */
export class JobRunner {
  private readonly running = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly lockProvider: JobLockProvider = new PostgresAdvisoryJobLockProvider()
  ) {}

  async run(name: string, task: () => Promise<void>): Promise<JobRunResult> {
    if (this.running.has(name)) {
      logger.debug({ job: name }, 'Job skipped because a local run is still active');
      return 'skipped_local_overlap';
    }

    this.running.add(name);
    let release: (() => Promise<void>) | null = null;
    try {
      release = await this.lockProvider.tryAcquire(name);
      if (!release) {
        logger.debug({ job: name }, 'Job skipped because another replica owns the advisory lock');
        return 'skipped_distributed_lock';
      }

      await task();
      return 'completed';
    } finally {
      try {
        await release?.();
      } finally {
        this.running.delete(name);
        if (this.running.size === 0) {
          const waiters = [...this.idleWaiters];
          this.idleWaiters.clear();
          for (const resolve of waiters) resolve();
        }
      }
    }
  }

  /** Wait for active workers to release their advisory locks before shutdown. */
  async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('INVALID_JOB_DRAIN_TIMEOUT');
    }
    if (this.running.size === 0) return true;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = (): void => finish(true);
      this.idleWaiters.add(onIdle);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  activeJobNames(): string[] {
    return [...this.running].sort();
  }
}

export const jobRunner = new JobRunner();

/**
 * Process a finite batch with bounded parallelism. The worker receives the
 * original index so callers can keep deterministic logging/aggregation.
 */
export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let cursor = 0;

  const consume = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: width }, () => consume()));
}

function advisoryLockKey(name: string): bigint {
  const digest = crypto.createHash('sha256').update(`RebeccaSellBot:job:${name}`).digest();
  const unsigned = digest.readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned);
}
