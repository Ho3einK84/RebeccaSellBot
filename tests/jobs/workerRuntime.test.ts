import { describe, expect, it, vi } from 'vitest';
import {
  JobRunner,
  forEachConcurrent,
  type JobLockProvider,
} from '../../src/jobs/workerRuntime.js';

vi.mock('../../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('job worker runtime', () => {
  it('suppresses local overlap before requesting a second distributed lock', async () => {
    let releaseTask!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const releaseLock = vi.fn().mockResolvedValue(undefined);
    const lockProvider: JobLockProvider = {
      tryAcquire: vi.fn().mockResolvedValue(releaseLock),
    };
    const runner = new JobRunner(lockProvider);

    const first = runner.run('reconciliation', async () => gate);
    await vi.waitFor(() => expect(lockProvider.tryAcquire).toHaveBeenCalledTimes(1));

    await expect(runner.run('reconciliation', async () => undefined)).resolves.toBe(
      'skipped_local_overlap'
    );
    expect(lockProvider.tryAcquire).toHaveBeenCalledTimes(1);

    releaseTask();
    await expect(first).resolves.toBe('completed');
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('skips when another replica owns the advisory lock', async () => {
    const runner = new JobRunner({ tryAcquire: vi.fn().mockResolvedValue(null) });
    const task = vi.fn();

    await expect(runner.run('notifier', task)).resolves.toBe('skipped_distributed_lock');
    expect(task).not.toHaveBeenCalled();
  });

  it('waits for active workers to release their locks during shutdown', async () => {
    let releaseTask!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const releaseLock = vi.fn().mockResolvedValue(undefined);
    const runner = new JobRunner({ tryAcquire: vi.fn().mockResolvedValue(releaseLock) });

    const run = runner.run('broadcast-delivery', async () => gate);
    await vi.waitFor(() => expect(runner.activeJobNames()).toEqual(['broadcast-delivery']));
    let drainFinished = false;
    const drain = runner.waitForIdle(1_000).then((result) => {
      drainFinished = true;
      return result;
    });
    await Promise.resolve();
    expect(drainFinished).toBe(false);

    releaseTask();
    await expect(run).resolves.toBe('completed');
    await expect(drain).resolves.toBe(true);
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(runner.activeJobNames()).toEqual([]);
  });

  it('caps batch parallelism at the configured width', async () => {
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];

    await forEachConcurrent([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(item);
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
