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
