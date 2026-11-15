import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { BackupService } from '../../src/domain/services/BackupService.js';
import type { BroadcastService } from '../../src/domain/services/BroadcastService.js';
import type { ConfigService } from '../../src/domain/services/ConfigService.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
  type RebeccaService,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';

const hoistedMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  schedule: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('../../src/infra/db.js', () => ({
  getDb: () => hoistedMocks.getDb(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: hoistedMocks.schedule },
}));

import { runBackupSweep, startBackupCron, stopBackupCron } from '../../src/jobs/backup.js';
import {
  processNextBroadcast,
  startBroadcastWorker,
  stopBroadcastWorker,
} from '../../src/jobs/broadcast.js';
import {
  TRIAL_EXPIRY_GRACE_DAYS,
  startTrialCleanupCron,
  stopTrialCleanupCron,
  sweepExpiredTrialConfigs,
} from '../../src/jobs/trialCleanup.js';

describe('backup worker — sweep delegation and cron scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBackupCron();
  });

  it('delegates scheduled backup sweep with deterministic timestamp and starts/stops cron', async () => {
    const now = new Date('2026-08-15T12:00:00Z');
    const performScheduledSweep = vi.fn().mockResolvedValue({
      ran: true,
      success: true,
      messageId: 42,
    });
    const backupService = { performScheduledSweep } as unknown as BackupService;
    const telegramApi = {} as Api;

    const result = await runBackupSweep(backupService, telegramApi, now);
    expect(result).toEqual({ ran: true, success: true, messageId: 42 });
    expect(performScheduledSweep).toHaveBeenCalledWith(telegramApi, now);

    startBackupCron(backupService, telegramApi);
    expect(hoistedMocks.schedule).toHaveBeenCalledTimes(1);
    stopBackupCron();
  });
});

describe('broadcast worker — batch delivery, cancellation, 429 retry_after, and abort signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBroadcastWorker();
    vi.useRealTimers();
  });

  it('delivers a claimed batch, records per-recipient outcomes, and finalizes completion', async () => {
    const markRecipientSent = vi.fn(async () => undefined);
    const markRecipientFailed = vi.fn(async () => undefined);
    const finalizeCompleted = vi.fn(async () => undefined);

    const job = { id: 'job_1', status: 'queued', messageText: 'Maintenance tonight' };
    const claimBatch = vi.fn().mockResolvedValueOnce([101, 102]).mockResolvedValueOnce([]);

    const broadcastService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => job),
      markRunning: vi.fn(async () => ({ ...job, status: 'running' })),
      getJob: vi.fn(async () => ({ ...job, status: 'running' })),
      claimBatch,
      markRecipientSent,
      markRecipientFailed,
      finalizeCancelled: vi.fn(async () => undefined),
      finalizeCompleted,
    } as unknown as BroadcastService;

    const telegramApi = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({ message_id: 1 })
        .mockRejectedValueOnce(new Error('403: Forbidden: bot was blocked by the user')),
    } as unknown as Pick<Api, 'sendMessage'>;

    await processNextBroadcast(broadcastService, telegramApi, { interBatchDelayMs: 0 });

    expect(markRecipientSent).toHaveBeenCalledWith('job_1', 101);
    expect(markRecipientFailed).toHaveBeenCalledWith('job_1', 102, expect.any(Error));
    expect(finalizeCompleted).toHaveBeenCalledWith('job_1');
  });

  it('honors persisted cancellation before dispatching messages', async () => {
    const finalizeCancelled = vi.fn(async () => undefined);
    const claimBatch = vi.fn(async () => [101]);
    const sendMessage = vi.fn();

    const broadcastService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => ({
        id: 'job_cancel',
        status: 'cancel_requested',
        message: 'Ignored',
      })),
      markRunning: vi.fn(),
      getJob: vi.fn(),
      claimBatch,
      markRecipientSent: vi.fn(),
      markRecipientFailed: vi.fn(),
      finalizeCancelled,
      finalizeCompleted: vi.fn(),
    } as unknown as BroadcastService;

    await processNextBroadcast(broadcastService, { sendMessage }, { interBatchDelayMs: 0 });
    expect(finalizeCancelled).toHaveBeenCalledWith('job_cancel');
    expect(claimBatch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('retries Telegram 429 retry_after up to 2 times using fake timers before succeeding', async () => {
    vi.useFakeTimers();
    const markRecipientSent = vi.fn(async () => undefined);
    const markRecipientFailed = vi.fn(async () => undefined);

    const job = { id: 'job_429', status: 'queued', message: 'Hello' };
    const broadcastService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => job),
      markRunning: vi.fn(async () => ({ ...job, status: 'running' })),
      getJob: vi.fn(async () => ({ ...job, status: 'running' })),
      claimBatch: vi.fn().mockResolvedValueOnce([201]).mockResolvedValueOnce([]),
      markRecipientSent,
      markRecipientFailed,
      finalizeCancelled: vi.fn(),
      finalizeCompleted: vi.fn(async () => undefined),
    } as unknown as BroadcastService;

    const telegramApi = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 2 } })
        .mockResolvedValueOnce({ message_id: 99 }),
    } as unknown as Pick<Api, 'sendMessage'>;

    const promise = processNextBroadcast(broadcastService, telegramApi, {
      concurrency: 1,
      interBatchDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(2);
    expect(markRecipientSent).toHaveBeenCalledWith('job_429', 201);
    expect(markRecipientFailed).not.toHaveBeenCalled();
  });

  it('aborts retry_after sleep immediately when signal is aborted without marking claimed recipient failed', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const job = { id: 'job_abort', status: 'queued', message: 'Hello' };
    const markRecipientFailed = vi.fn(async () => undefined);

    const broadcastService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => job),
      markRunning: vi.fn(async () => ({ ...job, status: 'running' })),
      getJob: vi.fn(async () => ({ ...job, status: 'running' })),
      claimBatch: vi.fn().mockResolvedValueOnce([301]).mockResolvedValueOnce([]),
      markRecipientSent: vi.fn(),
      markRecipientFailed,
      finalizeCancelled: vi.fn(),
      finalizeCompleted: vi.fn(),
    } as unknown as BroadcastService;

    const telegramApi = {
      sendMessage: vi.fn().mockRejectedValue({ error_code: 429, parameters: { retry_after: 60 } }),
    } as unknown as Pick<Api, 'sendMessage'>;

    const promise = processNextBroadcast(broadcastService, telegramApi, {
      concurrency: 1,
      interBatchDelayMs: 0,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.runAllTimersAsync();
    await promise;

    expect(markRecipientFailed).not.toHaveBeenCalled();

    startBroadcastWorker(broadcastService, telegramApi as unknown as Api);
    stopBroadcastWorker();
  });
});

describe('trial cleanup worker — grace expiry, 404 purge, false deletion guard, and down-panel isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopTrialCleanupCron();
  });

  function mockTrialRows(rows: Array<{ panelId: string; configUsername: string }>) {
    hoistedMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve(rows),
          }),
        }),
      }),
    });
  }

  it('deletes expired trials past grace period and purges remote 404 trials while keeping active renewals', async () => {
    const nowMs = Date.UTC(2026, 7, 15, 12, 0, 0);
    const nowSec = Math.floor(nowMs / 1000);
    mockTrialRows([
      { panelId: 'legacy', configUsername: 'trial_expired' },
      { panelId: 'legacy', configUsername: 'trial_404' },
      { panelId: 'legacy', configUsername: 'trial_renewed' },
    ]);

    const rebecca = {
      getUser: vi.fn(async (username: string) => {
        if (username === 'trial_404') {
          throw new RebeccaApiError(404, '/api/user/trial_404', 'Not Found');
        }
        if (username === 'trial_renewed') {
          return { username, status: 'active', expire: nowSec + 86_400 };
        }
        return {
          username,
          status: 'expired',
          expire: nowSec - (TRIAL_EXPIRY_GRACE_DAYS + 1) * 86_400,
        };
      }),
    } as unknown as RebeccaService;
    const configService = {
      deleteConfigCompletely: vi.fn(async () => true),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(rebecca, configService, nowMs);
    expect(removed).toBe(2);
    expect(configService.deleteConfigCompletely).toHaveBeenCalledTimes(2);
    expect(configService.deleteConfigCompletely).toHaveBeenCalledWith('trial_expired', 'legacy');
    expect(configService.deleteConfigCompletely).toHaveBeenCalledWith('trial_404', 'legacy');
  });

  it('skips further trials on a down panel once worker slots observe outage and only counts true deletions', async () => {
    const nowMs = Date.UTC(2026, 7, 15, 12, 0, 0);
    const nowSec = Math.floor(nowMs / 1000);
    mockTrialRows([
      { panelId: 'down_panel', configUsername: 'down_1' },
      { panelId: 'down_panel', configUsername: 'down_2' },
      { panelId: 'down_panel', configUsername: 'down_3' },
      { panelId: 'down_panel', configUsername: 'down_4' },
      { panelId: 'down_panel', configUsername: 'down_5' },
      { panelId: 'down_panel', configUsername: 'down_6' },
      { panelId: 'ok_panel', configUsername: 'not_deleted' },
    ]);

    const downService = {
      getUser: vi.fn(async () => {
        throw new RebeccaOriginDownError('/api/user/down', 521, 3, true);
      }),
    } as unknown as RebeccaService;
    const okService = {
      getUser: vi.fn(async () => ({
        username: 'not_deleted',
        status: 'expired',
        expire: nowSec - (TRIAL_EXPIRY_GRACE_DAYS + 2) * 86_400,
      })),
    } as unknown as RebeccaService;
    const registry = {
      getService: vi.fn((panelId?: string) => (panelId === 'down_panel' ? downService : okService)),
    } as unknown as RebeccaPanelRegistry;
    const configService = {
      deleteConfigCompletely: vi.fn(async () => false),
    } as unknown as ConfigService;

    const removed = await sweepExpiredTrialConfigs(registry, configService, nowMs);
    expect(removed).toBe(0);
    // Worker pool is 4, so once down_panel fails, remaining queued items (5-6) are skipped
    expect(downService.getUser.mock.calls.length).toBeLessThan(6);
    expect(okService.getUser).toHaveBeenCalledTimes(1);
    expect(configService.deleteConfigCompletely).toHaveBeenCalledTimes(1);

    startTrialCleanupCron(registry, configService);
    expect(hoistedMocks.schedule).toHaveBeenCalledTimes(1);
  });
});
