import { describe, expect, it } from 'vitest';
import {
  getSettingDefinition,
  getSettingGroup,
  GENERAL_SETTING_GROUPS,
} from '../../src/telegram/conversations/adminConversations/settings/catalog.js';
import {
  validateAdminSetting,
  normalizeBackupTarget,
} from '../../src/telegram/conversations/adminConversations/settings/validation.js';
import {
  backupEnabled,
  backupIntervalHours,
  backupTargetChatId,
  backupIncludeEnv,
} from '../../src/domain/services/FeatureSettings.js';

describe('Backup Settings Configuration & Validation', () => {
  describe('Catalog definitions', () => {
    it('registers backup group in GENERAL_SETTING_GROUPS', () => {
      const group = getSettingGroup('backup');
      expect(group).toBeDefined();
      expect(group?.id).toBe('backup');
      expect(group?.settings).toContain('backup_enabled');
      expect(group?.settings).toContain('backup_interval_hours');
      expect(group?.settings).toContain('backup_target_chat_id');
      expect(group?.settings).toContain('backup_include_env');

      const inGeneral = GENERAL_SETTING_GROUPS.some((g) => g.id === 'backup');
      expect(inGeneral).toBe(true);
    });

    it('has definitions for all backup setting keys', () => {
      expect(getSettingDefinition('backup_enabled')?.editor.type).toBe('boolean');
      expect(getSettingDefinition('backup_interval_hours')?.editor.type).toBe('integer');
      expect(getSettingDefinition('backup_target_chat_id')?.editor.type).toBe('backup_target');
      expect(getSettingDefinition('backup_include_env')?.editor.type).toBe('boolean');
    });
  });

  describe('Validation', () => {
    it('validates backup_target_chat_id correctly', () => {
      expect(validateAdminSetting('backup_target_chat_id', '-1001234567890')).toBe(
        '-1001234567890'
      );
      expect(validateAdminSetting('backup_target_chat_id', '-123456789')).toBe('-123456789');
      expect(validateAdminSetting('backup_target_chat_id', '123456789')).toBe('123456789');
      expect(validateAdminSetting('backup_target_chat_id', '@backup_channel')).toBe(
        '@backup_channel'
      );
      expect(validateAdminSetting('backup_target_chat_id', 'backup_channel')).toBe(
        '@backup_channel'
      );
      expect(validateAdminSetting('backup_target_chat_id', '')).toBe('');

      // Invalid formats
      expect(
        validateAdminSetting('backup_target_chat_id', 'invalid target with spaces')
      ).toBeUndefined();
      expect(validateAdminSetting('backup_target_chat_id', 'abc!')).toBeUndefined();
    });

    it('validates backup_interval_hours correctly', () => {
      expect(validateAdminSetting('backup_interval_hours', '1')).toBe('1');
      expect(validateAdminSetting('backup_interval_hours', '24')).toBe('24');
      expect(validateAdminSetting('backup_interval_hours', '720')).toBe('720');

      // Out of bounds or invalid
      expect(validateAdminSetting('backup_interval_hours', '0')).toBeUndefined();
      expect(validateAdminSetting('backup_interval_hours', '1000')).toBeUndefined();
      expect(validateAdminSetting('backup_interval_hours', 'invalid')).toBeUndefined();
    });

    it('normalizes Persian and Arabic digits in backup targets', () => {
      expect(normalizeBackupTarget('-۱۰۰۱۲۳۴۵۶۷۸۹۰')).toBe('-1001234567890');
    });
  });

  describe('FeatureSettings helpers', () => {
    it('reads backup settings with defaults', () => {
      const mockSettings = {
        getSetting: (key: string, fallback = '') => {
          const map: Record<string, string> = {
            backup_enabled: 'true',
            backup_interval_hours: '12',
            backup_target_chat_id: '-100999888',
            backup_include_env: 'false',
          };
          return map[key] ?? fallback;
        },
      };

      expect(backupEnabled(mockSettings)).toBe(true);
      expect(backupIntervalHours(mockSettings)).toBe(12);
      expect(backupTargetChatId(mockSettings)).toBe('-100999888');
      expect(backupIncludeEnv(mockSettings)).toBe(false);
    });
  });
});
