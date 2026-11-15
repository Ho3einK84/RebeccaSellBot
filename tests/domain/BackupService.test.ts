import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  BackupService,
  type BackupTelegramClient,
} from '../../src/domain/services/BackupService.js';
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
    vi.restoreAllMocks();
    mockTs = mockTranslationService({
      backup_enabled: 'true',
      backup_interval_hours: '24',
      backup_target_chat_id: '-1001234567890',
      backup_include_env: 'false',
      admin_backup_caption_header: 'Backup Ready',
      admin_backup_caption_instance: 'Instance: `{instance}`',
      admin_backup_caption_date: 'Date: {date}',
      admin_backup_caption_size: 'Size: {size}',
      admin_backup_caption_version: 'Version: `{version}`',
    });
    backupService = new BackupService(mockTs, {
      databaseUrl: 'postgres://user:pass@localhost:5432/testdb',
      instanceName: 'test_instance',
      createDocumentInput: (filePath, fileName) => ({ filePath, fileName, kind: 'custom_input' }),
    });
  });

  describe('isBackupDue & getBackupStatus', () => {
    it('evaluates disabled, missing target, empty last_run, recent run, and due interval', () => {
      const now = new Date('2026-08-24T12:00:00Z');
      expect(backupService.getBackupStatus(now)).toEqual({
        enabled: true,
        intervalHours: 24,
        targetChatId: '-1001234567890',
        includeEnv: false,
        lastRunAt: null,
        lastStatus: null,
        isDue: true,
      });

      mockTs.store.set('backup_last_run_at', new Date('2026-08-24T10:00:00Z').toISOString());
      expect(backupService.isBackupDue(now)).toBe(false);

      mockTs.store.set('backup_last_run_at', new Date('2026-08-23T11:00:00Z').toISOString());
      expect(backupService.isBackupDue(now)).toBe(true);

      mockTs.store.set('backup_target_chat_id', '');
      expect(backupService.isBackupDue(now)).toBe(false);

      mockTs.store.set('backup_target_chat_id', '-1001234567890');
      mockTs.store.set('backup_enabled', 'false');
      expect(backupService.isBackupDue(now)).toBe(false);
    });
  });

  describe('createBackupBundle', () => {
    it('generates archive with manifest, optionally includes .env, and cleans up', async () => {
      const bundle = await backupService.createBackupBundle({
        label: 'unit_test',
        includeEnv: false,
      });
      expect(bundle.fileName).toContain('unit_test_test_instance');
      expect(bundle.fileName).toMatch(/\.tar\.gz$/);
      expect(bundle.sizeBytes).toBeGreaterThan(0);
      expect(bundle.manifest.format_version).toBe(BACKUP_FORMAT_VERSION);
      expect(bundle.manifest.instance).toBe('test_instance');
      expect((await fs.stat(bundle.archivePath)).isFile()).toBe(true);
      await bundle.cleanup();
      await expect(fs.stat(bundle.archivePath)).rejects.toThrow();

      const envBundle = await backupService.createBackupBundle({
        label: 'env_test',
        includeEnv: true,
      });
      expect(envBundle.manifest.contents).toEqual(
        expect.arrayContaining(['.env', 'docker-compose.yml', 'database.dump', 'manifest.txt'])
      );
      await envBundle.cleanup();
    });

    it('rejects concurrent backups and resets lock even when mkdir fails', async () => {
      const bundle1 = await backupService.createBackupBundle({ label: 'concurrent_1' });
      try {
        await expect(backupService.createBackupBundle({ label: 'concurrent_2' })).rejects.toThrow(
          /BACKUP_ALREADY_IN_PROGRESS/
        );
      } finally {
        await bundle1.cleanup();
      }

      const badTempBase = path.join(os.tmpdir(), `rsbot-not-a-dir-${Date.now()}`);
      await fs.writeFile(badTempBase, 'file-blocking-mkdir');
      try {
        const mkdirSpy = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('EACCES'));
        await expect(backupService.createBackupBundle({ label: 'mkdir_fail' })).rejects.toThrow(
          'EACCES'
        );
        mkdirSpy.mockRestore();

        // Lock must not remain wedged after mkdir failure
        const recovered = await backupService.createBackupBundle({ label: 'recovered' });
        await recovered.cleanup();
      } finally {
        await fs.rm(badTempBase, { force: true });
      }
    });

    it('throws DATABASE_DUMP_FAILED in production when pg_dump fails', async () => {
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
  });

  describe('sendBackupToChat & performScheduledSweep', () => {
    it('delivers backup via createDocumentInput adapter, sanitizes Markdown caption, and records success', async () => {
      const sendDocument = vi.fn().mockResolvedValue({ message_id: 12345 });
      const client: BackupTelegramClient = { sendDocument };
      const trickyService = new BackupService(mockTs, {
        databaseUrl: 'postgres://user:pass@localhost:5432/testdb',
        instanceName: 'shop`prod_1',
        createDocumentInput: (filePath, fileName) => ({ wrappedPath: filePath, fileName }),
      });

      const result = await trickyService.sendBackupToChat(client, '-1001234567890');
      expect(result).toMatchObject({ success: true, messageId: 12345 });
      expect(sendDocument).toHaveBeenCalledTimes(1);
      const [, doc, opts] = sendDocument.mock.calls[0]!;
      expect(doc).toMatchObject({ fileName: expect.stringMatching(/\.tar\.gz$/) });
      expect(opts?.caption).toContain('`shopprod_1`');
      expect(opts?.parse_mode).toBe('Markdown');
      expect(mockTs.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ backup_last_status: 'success' })
      );
    });

    it('records error and returns success: false when createBackupBundle or Telegram API fails', async () => {
      const client: BackupTelegramClient = {
        sendDocument: vi.fn().mockRejectedValue(new Error('CHAT_NOT_FOUND')),
      };
      const sendErr = await backupService.sendBackupToChat(client, '-1001234567890');
      expect(sendErr.success).toBe(false);
      expect(sendErr.error).toContain('CHAT_NOT_FOUND');
      expect(mockTs.updateSetting).toHaveBeenCalledWith(
        'backup_last_status',
        expect.stringContaining('CHAT_NOT_FOUND')
      );

      vi.spyOn(backupService, 'createBackupBundle').mockRejectedValueOnce(new Error('DISK_FULL'));
      const bundleErr = await backupService.sendBackupToChat(client, '-1001234567890');
      expect(bundleErr).toEqual({ success: false, error: 'DISK_FULL' });
      expect(mockTs.updateSetting).toHaveBeenLastCalledWith(
        'backup_last_status',
        'error: DISK_FULL'
      );
    });

    it('fails cleanly when bundle exceeds Telegram 50MB limit', async () => {
      const client: BackupTelegramClient = { sendDocument: vi.fn() };
      const cleanup = vi.fn().mockResolvedValue(undefined);
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
        cleanup,
      });

      const result = await backupService.sendBackupToChat(client, '-1001234567890');
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds Telegram 50 MB document limit');
      expect(client.sendDocument).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('handles scheduled sweep skip conditions and due execution', async () => {
      const client: BackupTelegramClient = {
        sendDocument: vi.fn().mockResolvedValue({ message_id: 999 }),
      };

      mockTs.store.set('backup_enabled', 'false');
      await expect(backupService.performScheduledSweep(client)).resolves.toEqual({
        ran: false,
        reason: 'disabled',
      });

      mockTs.store.set('backup_enabled', 'true');
      mockTs.store.set('backup_target_chat_id', '');
      await expect(backupService.performScheduledSweep(client)).resolves.toEqual({
        ran: false,
        reason: 'missing_target',
      });

      const now = new Date('2026-08-24T12:00:00Z');
      mockTs.store.set('backup_target_chat_id', '-1001234567890');
      mockTs.store.set('backup_last_run_at', new Date('2026-08-24T10:00:00Z').toISOString());
      await expect(backupService.performScheduledSweep(client, now)).resolves.toEqual({
        ran: false,
        reason: 'not_due',
      });

      mockTs.store.set('backup_last_run_at', new Date('2026-08-23T10:00:00Z').toISOString());
      await expect(backupService.performScheduledSweep(client, now)).resolves.toMatchObject({
        ran: true,
        success: true,
        messageId: 999,
      });
    });
  });
});
