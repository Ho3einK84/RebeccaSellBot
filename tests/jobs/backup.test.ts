import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Api } from 'grammy';
import { runBackupSweep, startBackupCron, stopBackupCron } from '../../src/jobs/backup.js';
import type { BackupService } from '../../src/domain/services/BackupService.js';

describe('Backup Job Worker', () => {
  let mockBackupService: BackupService;
  let mockApi: Api;

  beforeEach(() => {
    mockBackupService = {
      performScheduledSweep: vi.fn().mockResolvedValue({ ran: true, success: true }),
    } as unknown as BackupService;
    mockApi = {} as unknown as Api;
  });

  afterEach(() => {
    stopBackupCron();
  });

  it('runs backup sweep via backupService.performScheduledSweep', async () => {
    const now = new Date('2026-08-24T12:00:00Z');
    const result = await runBackupSweep(mockBackupService, mockApi, now);

    expect(mockBackupService.performScheduledSweep).toHaveBeenCalledWith(mockApi, now);
    expect(result).toEqual({ ran: true, success: true });
  });

  it('starts and stops cron job worker gracefully', () => {
    expect(() => {
      startBackupCron(mockBackupService, mockApi, '0 * * * *');
      stopBackupCron();
    }).not.toThrow();
  });
});
