/**
 * Automated backup worker — periodically checks and delivers database backups.
 *
 * Runs on a lightweight schedule (default every 10 minutes) and uses PostgreSQL
 * advisory locks via jobRunner to prevent overlapping or multi-replica executions.
 */
import cron from 'node-cron';
import type { Api } from 'grammy';
import { logger } from '../infra/logger.js';
import { jobRunner } from './workerRuntime.js';
import type { BackupService, BackupSweepResult } from '../domain/services/BackupService.js';

let task: ReturnType<typeof cron.schedule> | null = null;

export function startBackupCron(
  backupService: BackupService,
  telegramApi: Api,
  schedule = '*/10 * * * *'
): void {
  stopBackupCron();

  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('auto-backup', async () => {
        await runBackupSweep(backupService, telegramApi);
      });
    } catch (err) {
      logger.error({ err }, 'Automated backup worker encountered an error');
    }
  };

  // Trigger one-time check on startup (non-blocking)
  void run();

  task = cron.schedule(schedule, () => {
    void run();
  });

  logger.info({ schedule }, 'Automated backup cron worker started');
}

export function stopBackupCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export async function runBackupSweep(
  backupService: BackupService,
  telegramApi: Api,
  now = new Date()
): Promise<BackupSweepResult> {
  return backupService.performScheduledSweep(telegramApi, now);
}
