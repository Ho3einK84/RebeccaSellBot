import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoistedMocks = vi.hoisted(() => ({
  getPool: vi.fn(),
}));

vi.mock('../../src/infra/db.js', () => ({
  getPool: hoistedMocks.getPool,
}));

import {
  JobRunner,
  PostgresAdvisoryJobLockProvider,
  forEachConcurrent,
  type JobLockProvider,
} from '../../src/jobs/workerRuntime.js';
import { logger } from '../../src/infra/logger.js';

describe('workerRuntime — JobRunner, advisory locks, shutdown drain, and bounded concurrency', () => {
  beforeEach(() => {
    hoistedMocks.getPool.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('suppresses local overlap before requesting a second distributed lock', async () => {
    let releaseFirstTask!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirstTask = resolve;
    });

    const lockProvider: JobLockProvider = {
      tryAcquire: vi.fn(async () => vi.fn(async () => undefined)),
    };
    const runner = new JobRunner(lockProvider);

    const first = runner.run('reconciler', () => firstGate);
    const second = await runner.run('reconciler', async () => undefined);

    expect(second).toBe('skipped_local_overlap');
    expect(lockProvider.tryAcquire).toHaveBeenCalledTimes(1);

    releaseFirstTask();
    expect(await first).toBe('completed');
  });

  it('skips when another replica owns the advisory lock', async () => {
    const lockProvider: JobLockProvider = {
      tryAcquire: vi.fn(async () => null),
    };
    const runner = new JobRunner(lockProvider);
    const task = vi.fn(async () => undefined);

    expect(await runner.run('notifier', task)).toBe('skipped_distributed_lock');
    expect(task).not.toHaveBeenCalled();
  });

  it('waits for active workers during shutdown and returns false on timeout', async () => {
    vi.useFakeTimers();
    let releaseTask!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const releaseLock = vi.fn(async () => undefined);
    const runner = new JobRunner({
      tryAcquire: async () => releaseLock,
    });

    const active = runner.run('auto-renewal', () => gate);
    expect(runner.activeJobNames()).toEqual(['auto-renewal']);

    // Timed wait expires while job is still running
    const timedOutWait = runner.waitForIdle(250);
    await vi.advanceTimersByTimeAsync(250);
    await expect(timedOutWait).resolves.toBe(false);

    // Once task completes, waitForIdle resolves true and lock has been released
    const drainWait = runner.waitForIdle(1000);
    releaseTask();
    await expect(active).resolves.toBe('completed');
    await expect(drainWait).resolves.toBe(true);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(runner.activeJobNames()).toEqual([]);
  });

  it('logs and isolates release() failures in JobRunner without masking task result or task error', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const runner = new JobRunner({
      tryAcquire: async () => async () => {
        throw new Error('unlock failure');
      },
    });

    await expect(runner.run('backup', async () => undefined)).resolves.toBe('completed');
    expect(errSpy).toHaveBeenCalledTimes(1);

    await expect(
      runner.run('backup', async () => {
        throw new Error('task failed');
      })
    ).rejects.toThrow('task failed');
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('PostgresAdvisoryJobLockProvider destroys broken connection when pg_advisory_unlock throws', async () => {
    const unlockErr = new Error('connection terminated unexpectedly');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ locked: true }] })
        .mockRejectedValueOnce(unlockErr),
      release: vi.fn(),
    };
    hoistedMocks.getPool.mockReturnValue({
      connect: vi.fn(async () => client),
    });
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);

    const provider = new PostgresAdvisoryJobLockProvider();
    const release = await provider.tryAcquire('notifier');
    expect(release).toBeTypeOf('function');

    await release!();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(unlockErr);
  });

  it('PostgresAdvisoryJobLockProvider releases cleanly when lock not acquired or acquire throws', async () => {
    const clientA = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ locked: false }] }),
      release: vi.fn(),
    };
    const clientB = {
      query: vi.fn().mockRejectedValueOnce(new Error('PG timeout')),
      release: vi.fn(),
    };
    hoistedMocks.getPool.mockReturnValue({
      connect: vi.fn().mockResolvedValueOnce(clientA).mockResolvedValueOnce(clientB),
    });

    const provider = new PostgresAdvisoryJobLockProvider();
    expect(await provider.tryAcquire('job-a')).toBeNull();
    expect(clientA.release).toHaveBeenCalledWith();

    await expect(provider.tryAcquire('job-b')).rejects.toThrow('PG timeout');
    expect(clientB.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('caps batch parallelism and normalizes non-finite/non-positive concurrency safely', async () => {
    let active = 0;
    let peak = 0;
    const processed: number[] = [];

    await forEachConcurrent([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      processed.push(item);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    // NaN / 0 / Infinity must fall back safely to concurrency >= 1 without hanging
    const badResults: string[] = [];
    for (const width of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      await forEachConcurrent(['a', 'b'], width, async (item) => {
        badResults.push(item);
      });
    }
    expect(badResults).toHaveLength(8);
  });
});
