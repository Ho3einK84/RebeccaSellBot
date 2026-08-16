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
