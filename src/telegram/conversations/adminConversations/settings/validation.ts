import type { ConversationContext } from '../../../types.js';
import { localizedNumber, normalizeInputDigits, t } from '../../../locale.js';
import { parsePackageOptionsJson } from '../../../../domain/services/PricingService.js';
import { getSettingDefinition, type SettingKey } from './catalog.js';

const NAMING_MODES = new Set(['custom', 'prefix_number', 'telegramid_number']);
const NAMING_TOKENS = ['{prefix}', '{telegram_id}', '{counter}', '{random4}'] as const;

/** Validate and canonicalize one persisted setting value. */
export function validateAdminSetting(key: SettingKey, rawValue: string): string | undefined {
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
    case 'card_number': {
      const normalized = normalizeInputDigits(value.replaceAll('-', ''));
      return /^\d{12,24}$/u.test(normalized) ? normalized : undefined;
    }
    case 'text':
      return value.length >= definition.editor.minimumLength &&
        value.length <= definition.editor.maximumLength
        ? value
        : undefined;
    case 'support':
      return normalizeSupportDestination(value);
    case 'packages': {
      const packages = parsePackageOptionsJson(value);
      return packages ? JSON.stringify(packages) : undefined;
    }
    case 'naming_mode':
      return NAMING_MODES.has(value) ? value : undefined;
    case 'naming_prefix':
      return /^[a-z0-9][a-z0-9_-]{0,23}$/iu.test(value) ? value : undefined;
    case 'naming_template':
      return isValidNamingTemplate(value) ? value : undefined;
  }
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
    case 'naming_prefix':
      return t(ctx, 'admin_setting_naming_prefix_invalid');
    case 'naming_template':
      return t(ctx, 'admin_setting_naming_template_invalid');
    default:
      return t(ctx, 'admin_setting_invalid');
  }
}

export function normalizeSupportDestination(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (value === '') return '';
  if (value.startsWith('@') || /^[a-zA-Z0-9_]{5,32}$/u.test(value)) {
    const username = value.replace(/^@/u, '');
    return /^[a-zA-Z0-9_]{5,32}$/u.test(username) ? `@${username}` : undefined;
  }
  const numeric = normalizeInputDigits(value);
  return /^[1-9]\d{4,16}$/u.test(numeric) ? numeric : undefined;
}

export function isValidNamingTemplate(value: string): boolean {
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
