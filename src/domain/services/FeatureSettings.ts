export interface SettingReader {
  getSetting(key: string, fallback?: string): string;
}

/**
 * Custom volume remains enabled for existing installations until an admin
 * explicitly disables it. This preserves backwards compatibility when the
 * setting row has not been written to the database yet.
 */
export function customVolumeEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('custom_volume_enabled', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Wallet balance transfer between users is enabled by default.
 */
export function walletTransferEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('wallet_transfer_enabled', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Minimum wallet transfer amount in minor currency units (Toman).
 */
export function walletTransferMinAmount(settings: SettingReader, fallback = 5_000): number {
  const raw = settings.getSetting('wallet_transfer_min_amount', String(fallback)).trim();
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Automated backup is disabled by default until an administrator configures it.
 */
export function backupEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('backup_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Interval between automated backups in hours.
 */
export function backupIntervalHours(settings: SettingReader, fallback = 24): number {
  const raw = settings.getSetting('backup_interval_hours', String(fallback)).trim();
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 720 ? parsed : fallback;
}

/**
 * Target Telegram destination (chat ID, supergroup ID, or @channel).
 */
export function backupTargetChatId(settings: SettingReader): string {
  return settings.getSetting('backup_target_chat_id', '').trim();
}

/**
 * Whether to include .env in the backup bundle.
 */
export function backupIncludeEnv(settings: SettingReader): boolean {
  const value = settings.getSetting('backup_include_env', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Timestamp of the last successful backup.
 */
export function backupLastRunAt(settings: SettingReader): string {
  return settings.getSetting('backup_last_run_at', '').trim();
}

/**
 * Status message or result of the last backup run.
 */
export function backupLastStatus(settings: SettingReader): string {
  return settings.getSetting('backup_last_status', '').trim();
}
