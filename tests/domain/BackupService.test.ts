import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Api } from 'grammy';
import fs from 'node:fs/promises';
import { BackupService, BACKUP_FORMAT_VERSION } from '../../src/domain/services/BackupService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

function mockTranslationService(initialSettings: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialSettings));
  return {
    store,
    getSetting: vi.fn((key: string, fallback = '') => store.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = store.get(key);
      if (val === undefined) return fallback;
      return val.trim().toLowerCase() === 'true' || val === '1';
    }),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const val = store.get(key);
      if (val === undefined) return fallback;
      const num = Number(val);
      return Number.isFinite(num) ? num : fallback;
    }),
    get: vi.fn((key: string, _locale?: string, params?: Record<string, string | number>) => {
      let text = store.get(key) ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    }),
    updateSetting: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    updateSettings: vi.fn(async (pairs: Record<string, string>) => {
      for (const [k, v] of Object.entries(pairs)) store.set(k, v);
    }),
  } as unknown as TranslationService & { store: Map<string, string> };
}

describe('BackupService', () => {
  let mockTs: ReturnType<typeof mockTranslationService>;
  let backupService: BackupService;

  beforeEach(() => {
    mockTs = mockTranslationService({
      backup_enabled: 'true',
      backup_interval_hours: '24',
      backup_target_chat_id: '-1001234567890',
      backup_include_env: 'false',
    });
    backupService = new BackupService(mockTs, {
      databaseUrl: 'postgres://user:pass@localhost:5432/testdb',
      instanceName: 'test_instance',
    });
  });

  describe('isBackupDue', () => {
    it('returns false when backup is disabled', () => {
      mockTs.store.set('backup_enabled', 'false');
      expect(backupService.isBackupDue()).toBe(false);
    });

    it('returns false when target chat ID is missing', () => {
      mockTs.store.set('backup_target_chat_id', '');
      expect(backupService.isBackupDue()).toBe(false);
    });

    it('returns true when last_run_at is empty (never executed)', () => {
      mockTs.store.set('backup_last_run_at', '');
      expect(backupService.isBackupDue()).toBe(true);
    });

    it('returns false when last execution was recent', () => {
      const now = new Date('2026-08-24T12:00:00Z');
      const twoHoursAgo = new Date('2026-08-24T10:00:00Z');
      mockTs.store.set('backup_last_run_at', twoHoursAgo.toISOString());
      mockTs.store.set('backup_interval_hours', '24');

      expect(backupService.isBackupDue(now)).toBe(false);
    });

    it('returns true when interval hours have elapsed', () => {
      const now = new Date('2026-08-24T12:00:00Z');
      const twentyFiveHoursAgo = new Date('2026-08-23T11:00:00Z');
      mockTs.store.set('backup_last_run_at', twentyFiveHoursAgo.toISOString());
      mockTs.store.set('backup_interval_hours', '24');

      expect(backupService.isBackupDue(now)).toBe(true);
    });
  });

  describe('getBackupStatus', () => {
    it('returns snapshot of current settings and status', () => {
      const now = new Date('2026-08-24T12:00:00Z');
      const status = backupService.getBackupStatus(now);

      expect(status).toEqual({
        enabled: true,
        intervalHours: 24,
        targetChatId: '-1001234567890',
        includeEnv: false,
        lastRunAt: null,
        lastStatus: null,
        isDue: true,
      });
    });
  });

  describe('createBackupBundle', () => {
    it('generates a compressed archive with manifest and cleans up', async () => {
      const bundle = await backupService.createBackupBundle({
        label: 'unit_test',
        includeEnv: false,
      });

      expect(bundle.fileName).toContain('unit_test_test_instance');
      expect(bundle.fileName).toMatch(/\.tar\.gz$/);
      expect(bundle.sizeBytes).toBeGreaterThan(0);
      expect(bundle.manifest.format_version).toBe(BACKUP_FORMAT_VERSION);
      expect(bundle.manifest.instance).toBe('test_instance');

      // Verify file exists on disk
      const stat = await fs.stat(bundle.archivePath);
      expect(stat.isFile()).toBe(true);

      // Clean up and verify deletion
      await bundle.cleanup();
      await expect(fs.stat(bundle.archivePath)).rejects.toThrow();
    });

    it('includes .env and docker-compose.yml when includeEnv is true', async () => {
      const bundle = await backupService.createBackupBundle({
        label: 'env_test',
        includeEnv: true,
      });

      expect(bundle.manifest.contents).toContain('.env');
      expect(bundle.manifest.contents).toContain('docker-compose.yml');
      expect(bundle.manifest.contents).toContain('database.dump');
      expect(bundle.manifest.contents).toContain('manifest.txt');

      await bundle.cleanup();
    });
  });

  describe('sendBackupToChat', () => {
    it('delivers backup to Telegram API and updates last run metadata on success', async () => {
      const mockApi = {
        sendDocument: vi.fn().mockResolvedValue({ message_id: 12345 }),
      } as unknown as Api;

      const result = await backupService.sendBackupToChat(mockApi, '-1001234567890');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(12345);
      expect(mockApi.sendDocument).toHaveBeenCalledTimes(1);
      expect(mockTs.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          backup_last_status: 'success',
        })
      );
    });

    it('records error status when Telegram API call fails', async () => {
      const mockApi = {
        sendDocument: vi.fn().mockRejectedValue(new Error('CHAT_NOT_FOUND')),
      } as unknown as Api;

      const result = await backupService.sendBackupToChat(mockApi, '-1001234567890');

      expect(result.success).toBe(false);
      expect(result.error).toContain('CHAT_NOT_FOUND');
      expect(mockTs.updateSetting).toHaveBeenCalledWith(
        'backup_last_status',
        expect.stringContaining('CHAT_NOT_FOUND')
      );
    });
  });

  describe('performScheduledSweep', () => {
    it('skips when disabled', async () => {
      mockTs.store.set('backup_enabled', 'false');
      const mockApi = { sendDocument: vi.fn() } as unknown as Api;

      const result = await backupService.performScheduledSweep(mockApi);
      expect(result).toEqual({ ran: false, reason: 'disabled' });
      expect(mockApi.sendDocument).not.toHaveBeenCalled();
    });

    it('skips when destination target is missing', async () => {
      mockTs.store.set('backup_target_chat_id', '');
      const mockApi = { sendDocument: vi.fn() } as unknown as Api;

      const result = await backupService.performScheduledSweep(mockApi);
      expect(result).toEqual({ ran: false, reason: 'missing_target' });
      expect(mockApi.sendDocument).not.toHaveBeenCalled();
    });

    it('skips when not yet due', async () => {
      const now = new Date('2026-08-24T12:00:00Z');
      mockTs.store.set('backup_last_run_at', new Date('2026-08-24T10:00:00Z').toISOString());
      const mockApi = { sendDocument: vi.fn() } as unknown as Api;

      const result = await backupService.performScheduledSweep(mockApi, now);
      expect(result).toEqual({ ran: false, reason: 'not_due' });
      expect(mockApi.sendDocument).not.toHaveBeenCalled();
    });

    it('runs and delivers backup when due', async () => {
      const now = new Date('2026-08-24T12:00:00Z');
      mockTs.store.set('backup_last_run_at', new Date('2026-08-23T10:00:00Z').toISOString());
      const mockApi = {
        sendDocument: vi.fn().mockResolvedValue({ message_id: 999 }),
      } as unknown as Api;

      const result = await backupService.performScheduledSweep(mockApi, now);
      expect(result.ran).toBe(true);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(999);
      expect(mockApi.sendDocument).toHaveBeenCalledTimes(1);
    });

    it('throws error in production when pg_dump fails', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(backupService.createBackupBundle({ label: 'test_prod' })).rejects.toThrow(
          /DATABASE_DUMP_FAILED/
        );
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('rejects concurrent backup generation requests', async () => {
      const bundle1 = await backupService.createBackupBundle({ label: 'concurrent_1' });
      try {
        await expect(backupService.createBackupBundle({ label: 'concurrent_2' })).rejects.toThrow(
          /BACKUP_ALREADY_IN_PROGRESS/
        );
      } finally {
        await bundle1.cleanup();
      }

      // After cleanup, next backup should succeed
      const bundle2 = await backupService.createBackupBundle({ label: 'concurrent_3' });
      await bundle2.cleanup();
    });

    it('fails when backup size exceeds Telegram 50MB limit', async () => {
      const mockApi = {
        sendDocument: vi.fn(),
      } as unknown as Api;

      vi.spyOn(backupService, 'createBackupBundle').mockResolvedValueOnce({
        archivePath: '/tmp/fake_large_backup.tar.gz',
        fileName: 'fake_large_backup.tar.gz',
        sizeBytes: 52 * 1024 * 1024,
        manifest: {
          format_version: BACKUP_FORMAT_VERSION,
          instance: 'test_instance',
          created_at_utc: new Date().toISOString(),
          git_commit: 'unknown',
          contents: ['database.dump'],
        },
        cleanup: vi.fn().mockResolvedValue(undefined),
      });

      const result = await backupService.sendBackupToChat(mockApi, '-1001234567890');
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds Telegram 50 MB document limit');
      expect(mockApi.sendDocument).not.toHaveBeenCalled();
    });
  });
});
