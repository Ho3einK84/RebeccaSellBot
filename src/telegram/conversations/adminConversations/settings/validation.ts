import type { ConversationContext } from '../../../types.js';
import { localizedNumber, normalizeInputDigits, t } from '../../../locale.js';
import { parsePackageOptionsJson } from '../../../../domain/services/PricingService.js';
import { getSettingDefinition, type SettingKey } from './catalog.js';

const NAMING_MODES = new Set([
  'custom',
  'prefix_number',
  'telegramid_number',
  'prefix_telegramid_number',
  'prefix_random',
  'random_alphanumeric',
  'prefix_date_counter',
]);
const NAMING_TOKENS = [
  '{prefix}',
  '{telegram_id}',
  '{counter}',
  '{year}',
  '{yy}',
  '{month}',
  '{day}',
  '{jyear}',
  '{jalali_year}',
  '{jmonth}',
  '{jalali_month}',
  '{jday}',
  '{jalali_day}',
  '{date}',
  '{random4}',
  '{random6}',
  '{random8}',
] as const;

/** Validate and canonicalize one persisted setting value. */
export function validateAdminSetting(
  key: SettingKey,
  rawValue: string,
  options?: { graceDays?: number }
): string | undefined {
  const definition = getSettingDefinition(key);
  if (!definition) return undefined;
  const value = rawValue.trim();

  switch (definition.editor.type) {
    case 'integer': {
      const normalized = normalizeInputDigits(value);
      if (!/^\d+$/u.test(normalized)) return undefined;
      const parsed = Number(normalized);
      return Number.isSafeInteger(parsed) &&
        parsed >= definition.editor.minimum &&
        parsed <= definition.editor.maximum
        ? String(parsed)
        : undefined;
    }
    case 'decimal': {
      const normalized = normalizeLocalizedDecimal(value);
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(normalized)) return undefined;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) &&
        parsed >= definition.editor.minimum &&
        parsed <= definition.editor.maximum
        ? String(parsed)
        : undefined;
    }
    case 'boolean':
      return value === 'true' || value === 'false' ? value : undefined;
    case 'locale':
      return value === 'fa' || value === 'en' ? value : undefined;
    case 'card_number': {
      const normalized = normalizeInputDigits(value.replaceAll('-', ''));
      return /^\d{12,24}$/u.test(normalized) ? normalized : undefined;
    }
    case 'bank_cards_json':
      return validateBankCardsJson(value);
    case 'receipt_duplicate_policy':
      return validateReceiptDuplicatePolicy(value);
    case 'cleanup_warn_days':
      return validateExpiredCleanupWarnDays(value, options?.graceDays);
    case 'text':
      if (key === 'webapp_url') {
        if (!value.startsWith('https://')) return undefined;
        try {
          new URL(value);
          return value;
        } catch {
          return undefined;
        }
      }
      return value.length >= definition.editor.minimumLength &&
        value.length <= definition.editor.maximumLength
        ? value
        : undefined;
    case 'support':
      return normalizeSupportDestination(value);
    case 'backup_target':
      return normalizeBackupTarget(value);
    case 'packages': {
      const packages = parsePackageOptionsJson(value);
      return packages ? JSON.stringify(packages) : undefined;
    }
    case 'naming_mode':
      return NAMING_MODES.has(value) ? value : undefined;
    case 'naming_prefix': {
      const cleanedPrefix = cleanNamingInput(value);
      return /^[a-z0-9][a-z0-9_-]{0,23}$/iu.test(cleanedPrefix) ? cleanedPrefix : undefined;
    }
    case 'naming_template': {
      const normalizedTemplate = normalizeNamingTemplate(value);
      return isValidNamingTemplate(normalizedTemplate) ? normalizedTemplate : undefined;
    }
  }
}

export function validateReceiptDuplicatePolicy(rawValue: string): 'warn' | 'block' | undefined {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'warn' || normalized === 'block') return normalized;
  return undefined;
}

export function validateBankCardsJson(rawValue: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return undefined;
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    }
    return JSON.stringify(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Validate `expired_cleanup_warn_days` (`"first,last"`, e.g. `"3,1"`).
 * Normalizes Persian/Arabic digits and Persian commas (`،`), enforcing
 * `first > last >= 1`, `first <= 365`, and `first < graceDays` when supplied.
 */
export function validateExpiredCleanupWarnDays(
  rawValue: string,
  graceDays?: number
): string | undefined {
  const normalized = rawValue
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[،٬]/gu, ',')
    .trim();
  const parts = normalized.split(',').map((part) => part.trim());
  if (parts.length !== 2) return undefined;
  if (!/^\d+$/u.test(parts[0]!) || !/^\d+$/u.test(parts[1]!)) return undefined;
  const first = Number(parts[0]);
  const last = Number(parts[1]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return undefined;
  if (last < 1 || first <= last || first > 365) return undefined;
  if (graceDays !== undefined && Number.isFinite(graceDays) && first >= graceDays) {
    return undefined;
  }
  return `${first},${last}`;
}

export function settingValidationMessage(ctx: ConversationContext, key: SettingKey): string {
  const editor = getSettingDefinition(key)?.editor;
  if (!editor) return t(ctx, 'admin_setting_invalid');
  switch (editor.type) {
    case 'integer':
    case 'decimal':
      return t(ctx, 'admin_setting_number_range_invalid', {
        min: localizedNumber(editor.minimum, ctx),
        max: localizedNumber(editor.maximum, ctx),
      });
    case 'card_number':
      return t(ctx, 'admin_setting_card_invalid');
    case 'support':
      return t(ctx, 'admin_setting_support_invalid');
    case 'backup_target':
      return t(ctx, 'admin_backup_target_invalid');
    case 'naming_prefix':
      return t(ctx, 'admin_setting_naming_prefix_invalid');
    case 'naming_template':
      return t(ctx, 'admin_setting_naming_template_invalid');
    default:
      if (key === 'webapp_url') {
        return t(ctx, 'admin_webapp_invalid_url');
      }
      return t(ctx, 'admin_setting_invalid');
  }
}

export function normalizeBackupTarget(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (value === '') return '';
  if (value.startsWith('@')) {
    const username = value.replace(/^@/u, '');
    return /^[a-zA-Z0-9_]{4,32}$/u.test(username) ? `@${username}` : undefined;
  }
  const isNegative = value.startsWith('-');
  const digitsOnly = normalizeInputDigits(isNegative ? value.slice(1) : value);
  if (/^\d{4,20}$/u.test(digitsOnly)) {
    return isNegative ? `-${digitsOnly}` : digitsOnly;
  }
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/u.test(value)) {
    return `@${value}`;
  }
  return undefined;
}

export function normalizeSupportDestination(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (value === '') return '';
  if (value.startsWith('@') || /^[a-zA-Z0-9_]{5,32}$/u.test(value)) {
    const username = value.replace(/^@/u, '');
    return /^[a-zA-Z0-9_]{5,32}$/u.test(username) ? `@${username}` : undefined;
  }
  const isNegative = value.startsWith('-');
  const digitsOnly = normalizeInputDigits(isNegative ? value.slice(1) : value);
  if (/^\d{4,20}$/u.test(digitsOnly)) {
    return isNegative ? `-${digitsOnly}` : digitsOnly;
  }
  return undefined;
}

export function cleanNamingInput(rawValue: string): string {
  return rawValue
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff`]/gu, '')
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .trim();
}

export function normalizeNamingTemplate(rawValue: string): string {
  return cleanNamingInput(rawValue).replace(
    /\{([a-z0-9_]+)\}/giu,
    (_, token: string) => `{${token.toLowerCase()}}`
  );
}

export function isValidNamingTemplate(rawValue: string): boolean {
  const value = normalizeNamingTemplate(rawValue);
  if (value.length < 1 || value.length > 80 || !/^[a-z0-9_{}.-]+$/iu.test(value)) return false;
  let literal = value;
  for (const token of NAMING_TOKENS) literal = literal.replaceAll(token, 'token');
  if (/[{}]/u.test(literal)) return false;
  return /[a-z0-9]/iu.test(literal);
}

function normalizeLocalizedDecimal(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٫]/gu, '.')
    .replace(/[,_،٬\s]/gu, '');
}
