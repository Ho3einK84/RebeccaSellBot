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

/**
 * Whether new purchases default to Rebecca's `on_hold` status (start validity on
 * first connection). Disabled by default for backwards compatibility.
 */
export function onHoldDefaultEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('on_hold_default_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Whether remaining traffic quota and remaining validity carry over into the
 * renewed period. Enabled by default.
 */
export function renewalRolloverEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('renewal_rollover_enabled', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Whether buyers may enter a custom English service name during purchase.
 * Disabled by default.
 */
export function customServiceNameEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('custom_service_name_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export type ReceiptDuplicatePolicy = 'warn' | 'block';

/**
 * Policy when a submitted top-up receipt matches an existing receipt's
 * Telegram file_unique_id or SHA-256 hash. Defaults to `'warn'`.
 */
export function receiptDuplicatePolicy(settings: SettingReader): ReceiptDuplicatePolicy {
  const value = settings.getSetting('receipt_duplicate_policy', 'warn').trim().toLowerCase();
  return value === 'block' ? 'block' : 'warn';
}

/**
 * Whether manual card-to-card top-ups allocate a unique slightly-offset
 * payable amount (e.g. -1..-999 Toman) to ease receipt matching.
 * Disabled by default for backwards compatibility.
 */
export function uniqueTopupAmountEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('unique_topup_amount_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Whether users must verify their phone number (stored only as HMAC-SHA256
 * hash) before claiming a free trial. Disabled by default.
 */
export function requirePhoneForTrial(settings: SettingReader): boolean {
  const value = settings.getSetting('require_phone_for_trial', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Whether users must verify their phone number (stored only as HMAC-SHA256
 * hash) before completing a paid purchase. Disabled by default.
 */
export function requirePhoneForPurchase(settings: SettingReader): boolean {
  const value = settings.getSetting('require_phone_for_purchase', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Whether phone verification is restricted to Iranian (+98) mobile numbers.
 * Enabled by default.
 */
export function phoneVerifyIranOnly(settings: SettingReader): boolean {
  const value = settings.getSetting('phone_verify_iran_only', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Whether the 24-hour first-use connection guide nudge is enabled for newly
 * provisioned services with zero traffic. Enabled by default.
 */
export function firstUseNudgeEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('first_use_nudge_enabled', 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Whether automatic cleanup of long-expired services is enabled.
 * Disabled by default until explicitly enabled by an administrator.
 */
export function expiredCleanupEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('expired_cleanup_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Grace period (in days after expiration) before an expired service is removed
 * by the cleanup worker.
 */
export function expiredCleanupGraceDays(settings: SettingReader, fallback = 14): number {
  const raw = settings.getSetting('expired_cleanup_grace_days', String(fallback)).trim();
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : fallback;
}

export interface ExpiredCleanupWarnDays {
  firstWarnDays: number;
  lastWarnDays: number;
}

const DEFAULT_EXPIRED_CLEANUP_WARN_DAYS: ExpiredCleanupWarnDays = {
  firstWarnDays: 3,
  lastWarnDays: 1,
};

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Warning thresholds (days remaining before automatic expired-service deletion)
 * parsed from `expired_cleanup_warn_days` (e.g. `'3,1'`). Enforces
 * `firstWarnDays > lastWarnDays >= 1` and falls back to `{ firstWarnDays: 3, lastWarnDays: 1 }`.
 */
export function expiredCleanupWarnDays(settings: SettingReader): ExpiredCleanupWarnDays {
  const raw = normalizeDigits(settings.getSetting('expired_cleanup_warn_days', '3,1')).trim();
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== 2) return { ...DEFAULT_EXPIRED_CLEANUP_WARN_DAYS };
  const firstWarnDays = Number(parts[0]);
  const lastWarnDays = Number(parts[1]);
  if (
    !Number.isSafeInteger(firstWarnDays) ||
    !Number.isSafeInteger(lastWarnDays) ||
    lastWarnDays < 1 ||
    firstWarnDays <= lastWarnDays ||
    firstWarnDays > 365
  ) {
    return { ...DEFAULT_EXPIRED_CLEANUP_WARN_DAYS };
  }
  return { firstWarnDays, lastWarnDays };
}

/**
 * Timestamp when expired-service cleanup was enabled (used as a safety floor so
 * pre-existing expired services receive a full grace window before deletion).
 */
export function expiredCleanupEnabledAt(settings: SettingReader): Date | null {
  const raw = settings.getSetting('expired_cleanup_enabled_at', '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseBoundedIntSetting(
  settings: SettingReader,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = normalizeDigits(settings.getSetting(key, String(fallback)))
    .replace(/[,_،٬\s]/gu, '')
    .trim();
  if (!/^\d+$/u.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Whether automated card-to-card deposit verification via ForApp webhook is enabled. */
export function forappEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('forapp_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/** Expiry window (minutes) for pending ForApp automated card-to-card orders (5..120, default 20). */
export function forappOrderExpiryMinutes(settings: SettingReader, fallback = 20): number {
  return parseBoundedIntSetting(settings, 'forapp_order_expiry_minutes', fallback, 5, 120);
}

/** Whether NOWPayments cryptocurrency top-up gateway is enabled. */
export function nowpaymentsEnabled(settings: SettingReader): boolean {
  const value = settings.getSetting('nowpayments_enabled', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/** Whether NOWPayments requests target the sandbox environment. */
export function nowpaymentsSandbox(settings: SettingReader): boolean {
  const value = settings.getSetting('nowpayments_sandbox', 'false').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export type NowPaymentsRateMode = 'manual' | 'auto';

/** Exchange rate strategy for Toman -> USD conversion ('manual' or 'auto' with fallback). */
export function nowpaymentsRateMode(settings: SettingReader): NowPaymentsRateMode {
  const value = settings.getSetting('nowpayments_rate_mode', 'manual').trim().toLowerCase();
  return value === 'auto' ? 'auto' : 'manual';
}

/** Manual (and auto-fallback) USD/USDT exchange rate in Toman (default 80,000). */
export function nowpaymentsManualUsdRateToman(settings: SettingReader, fallback = 80_000): number {
  return parseBoundedIntSetting(
    settings,
    'nowpayments_usd_rate_toman',
    fallback,
    10_000,
    5_000_000
  );
}

/** Minimum NOWPayments top-up amount in Toman (default 100,000). */
export function nowpaymentsMinAmountToman(settings: SettingReader, fallback = 100_000): number {
  return parseBoundedIntSetting(
    settings,
    'nowpayments_min_amount_toman',
    fallback,
    10_000,
    Number.MAX_SAFE_INTEGER
  );
}

/** Maximum NOWPayments top-up amount in Toman (default 50,000,000). */
export function nowpaymentsMaxAmountToman(settings: SettingReader, fallback = 50_000_000): number {
  const min = nowpaymentsMinAmountToman(settings);
  const parsed = parseBoundedIntSetting(
    settings,
    'nowpayments_max_amount_toman',
    fallback,
    min,
    Number.MAX_SAFE_INTEGER
  );
  return Math.max(min, parsed);
}

/** Optional extra cashback percentage (0..50) credited on completed NOWPayments top-ups. */
export function nowpaymentsCashbackPercent(settings: SettingReader, fallback = 0): number {
  return parseBoundedIntSetting(settings, 'nowpayments_cashback_percent', fallback, 0, 50);
}

/** Expiry window (minutes) for pending NOWPayments invoices (10..1440, default 60). */
export function nowpaymentsOrderExpiryMinutes(settings: SettingReader, fallback = 60): number {
  return parseBoundedIntSetting(settings, 'nowpayments_order_expiry_minutes', fallback, 10, 1440);
}

export const FORCED_JOIN_SCOPES = ['off', 'all', 'trial_only', 'purchase_and_trial'] as const;
export type ForcedJoinScope = (typeof FORCED_JOIN_SCOPES)[number];

/** Enforcement scope for mandatory channel membership. Defaults to `'off'`. */
export function forcedJoinScope(settings: SettingReader): ForcedJoinScope {
  const raw = settings.getSetting('forced_join_scope', 'off').trim().toLowerCase();
  if (raw === 'all' || raw === 'trial_only' || raw === 'purchase_and_trial') {
    return raw;
  }
  return 'off';
}

export const PAYMENT_MESSAGE_AUTO_DELETE_MIN_HOURS = 0;
export const PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS = 48;

/**
 * Delay (in hours, 0..48) before payment / card-number messages sent in
 * Telegram are automatically deleted. `0` disables auto-deletion.
 */
export function paymentMessageAutoDeleteHours(settings: SettingReader, fallback = 0): number {
  return parseBoundedIntSetting(
    settings,
    'payment_message_auto_delete_hours',
    fallback,
    PAYMENT_MESSAGE_AUTO_DELETE_MIN_HOURS,
    PAYMENT_MESSAGE_AUTO_DELETE_MAX_HOURS
  );
}

export const REGISTRATION_MODES = ['open', 'invite_only', 'closed'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];
export const DEFAULT_REGISTRATION_MODE: RegistrationMode = 'open';

/** Parse a raw `registration_mode` string, defaulting to `'open'`. */
export function parseRegistrationMode(raw: string | null | undefined): RegistrationMode {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'invite_only' || normalized === 'closed') {
    return normalized;
  }
  return DEFAULT_REGISTRATION_MODE;
}

/** Policy controlling whether new users may register (`open`, `invite_only`, or `closed`). */
export function registrationMode(settings: SettingReader): RegistrationMode {
  if (typeof settings?.getSetting !== 'function') {
    return DEFAULT_REGISTRATION_MODE;
  }
  return parseRegistrationMode(settings.getSetting('registration_mode', DEFAULT_REGISTRATION_MODE));
}
