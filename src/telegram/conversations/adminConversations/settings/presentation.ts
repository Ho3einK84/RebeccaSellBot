import { InlineKeyboard } from 'grammy';
import type { PackageOption } from '../../../../domain/services/PricingService.js';
import { parsePackageOptionsJson } from '../../../../domain/services/PricingService.js';
import type { ConversationContext } from '../../../types.js';
import { localizedNumber, t, tm } from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import { buildPromptScreen, buildScreen } from '../../../ui.js';
import {
  SETTING_GROUPS,
  SETTING_LABELS,
  getSettingGroup,
  isSecretSetting,
  type SettingGroup,
  type SettingGroupId,
  type SettingKey,
} from './catalog.js';

export interface SelectionItem {
  id: string;
  labelKey: string;
}

export function buildSelectionKeyboard(
  ctx: ConversationContext,
  items: readonly SelectionItem[],
  prefix: string,
  cancelKey = 'menu_cancel'
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    keyboard.text(t(ctx, item.labelKey), callbackData(prefix, item.id)).row();
  }
  keyboard.text(t(ctx, cancelKey), 'conversation:cancel');
  return keyboard;
}

export function buildSettingsGroupKeyboard(ctx: ConversationContext): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of SETTING_GROUPS) {
    keyboard.text(t(ctx, item.labelKey), callbackData('set-group', item.id)).row();
  }
  keyboard.text(t(ctx, 'admin_menu_back'), 'nav:admin');
  return keyboard;
}

export function buildSettingsInGroupKeyboard(
  ctx: ConversationContext,
  group: SettingGroup
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const key of group.settings) {
    keyboard.text(t(ctx, SETTING_LABELS[key]), callbackData('set-edit', key)).row();
  }
  return keyboard
    .text(t(ctx, 'admin_settings_back_groups'), 'set-groups')
    .row()
    .text(t(ctx, 'admin_menu_back'), 'nav:admin');
}

export function buildBooleanSettingKeyboard(
  ctx: ConversationContext,
  settingKey: string,
  callbackPrefix: string
): InlineKeyboard {
  const current = readSettingBool(ctx, settingKey);
  const activeLabel = t(ctx, 'admin_setting_enabled_on');
  const inactiveLabel = t(ctx, 'admin_setting_enabled_off');
  return new InlineKeyboard()
    .text(current ? `✅ ${activeLabel}` : activeLabel, `${callbackPrefix}true`)
    .text(!current ? `✅ ${inactiveLabel}` : inactiveLabel, `${callbackPrefix}false`)
    .row()
    .text(t(ctx, 'admin_settings_back_category'), `${callbackPrefix}back`)
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
}

export function buildEditorNavigationKeyboard(
  ctx: ConversationContext,
  groupId: SettingGroupId
): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'admin_settings_back_category'), callbackData('set-edit-back', groupId))
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
}

export function buildSettingsPrompt(
  ctx: ConversationContext,
  body: string,
  options: { emoji?: string; title?: string; subtitle?: string } = {}
): string {
  return buildPromptScreen(
    options.emoji ?? '⚙️',
    options.title ?? t(ctx, 'admin_settings_title'),
    body,
    options.subtitle ?? t(ctx, 'admin_settings_subtitle')
  );
}

export function buildSettingSavedScreen(
  ctx: ConversationContext,
  setting: string,
  value: string
): string {
  return buildScreen({
    emoji: '✅',
    title: t(ctx, 'admin_setting_saved_title'),
    primary: {
      emoji: '⚙️',
      label: setting,
      value: escapeTelegramMarkdown(value),
    },
    footer: t(ctx, 'admin_setting_saved_hint'),
  });
}

export function buildSettingsGroupPrompt(ctx: ConversationContext, groupId: string): string {
  const group = getSettingGroup(groupId);
  if (!group) return '';
  const entries = group.settings.map(
    (key) =>
      `• ${escapeTelegramMarkdown(t(ctx, SETTING_LABELS[key]))}: \`${escapeInlineCode(displayAdminSettingValue(ctx, key))}\``
  );
  return tm(
    ctx,
    'admin_settings_group_prompt',
    {
      group: t(ctx, group.labelKey),
      description: t(ctx, group.descriptionKey),
      settings: entries.join('\n'),
    },
    ['group', 'description', 'settings']
  );
}

export function displayAdminSettingValue(ctx: ConversationContext, key: string): string {
  if (!ctx.services) return '—';
  if (isSecretSetting(key)) {
    return ctx.services.translationService.getSetting(key)
      ? t(ctx, 'admin_setting_configured')
      : t(ctx, 'admin_bootstrap_env');
  }
  if (key === 'packages_json') {
    const packages = parsePackageOptionsJson(ctx.services.translationService.getSetting(key));
    return packages
      ? t(ctx, 'admin_setting_packages_summary', { count: localizedNumber(packages.length, ctx) })
      : t(ctx, 'admin_setting_invalid');
  }
  if (key === 'naming_mode') {
    const mode = ctx.services.translationService.getSetting(key, 'custom');
    const labels: Readonly<Record<string, string>> = {
      prefix_number: 'admin_setting_naming_mode_val_prefix_number',
      telegramid_number: 'admin_setting_naming_mode_val_telegramid_number',
      custom: 'admin_setting_naming_mode_val_custom',
    };
    return labels[mode] ? t(ctx, labels[mode]) : mode;
  }
  if (key === 'support_destination') {
    const value = ctx.services.translationService.getSetting(key)?.trim();
    if (!value) return t(ctx, 'admin_setting_not_configured');
    if (value.startsWith('@') || /^[a-zA-Z0-9_]{5,32}$/u.test(value)) {
      return value.startsWith('@') ? value : `@${value}`;
    }
    return value;
  }
  if (key === 'trial_enabled' || key === 'custom_volume_enabled') {
    return t(
      ctx,
      readSettingBool(ctx, key) ? 'admin_setting_enabled_on' : 'admin_setting_enabled_off'
    );
  }
  return ctx.services.translationService.getSetting(key, '—');
}

export function editableSettingValue(ctx: ConversationContext, key: SettingKey): string {
  if (!ctx.services || isSecretSetting(key)) return displayAdminSettingValue(ctx, key);
  const value = ctx.services.translationService.getSetting(key, '—');
  return value.length <= 3_000 ? value : displayAdminSettingValue(ctx, key);
}

export function buildCustomNamingTemplatePrompt(ctx: ConversationContext): string {
  if (!ctx.services) return '';
  const current = ctx.services.translationService.getSetting(
    'custom_naming_template',
    '{prefix}_{telegram_id}_{counter}'
  );
  const prefixValue = ctx.services.translationService.getSetting('naming_prefix', 'rebecca');
  return tm(
    ctx,
    'admin_setting_custom_naming_template_prompt',
    {
      current,
      prefix_value: prefixValue,
      code_prefix: '{prefix}',
      code_telegram_id: '{telegram_id}',
      code_counter: '{counter}',
      code_random4: '{random4}',
      example_primary: '{prefix}_{telegram_id}_{counter}',
      example_random: '{prefix}_{counter}_{random4}',
    },
    [
      'current',
      'prefix_value',
      'code_prefix',
      'code_telegram_id',
      'code_counter',
      'code_random4',
      'example_primary',
      'example_random',
    ]
  );
}

export function buildPackageManagerScreen(
  ctx: ConversationContext,
  packages: readonly PackageOption[],
  options: { totalCount?: number; page?: number; totalPages?: number } = {}
): string {
  const totalCount = options.totalCount ?? packages.length;
  const pageStatus =
    options.page !== undefined && options.totalPages !== undefined && options.totalPages > 1
      ? t(ctx, 'admin_pkg_page_status', {
          page: localizedNumber(options.page + 1, ctx),
          total: localizedNumber(options.totalPages, ctx),
        })
      : undefined;
  return buildScreen({
    emoji: '📦',
    title: t(ctx, 'admin_package_manager_title'),
    subtitle: t(ctx, 'admin_package_manager_subtitle'),
    primary: {
      emoji: '📦',
      label: t(ctx, 'admin_promo_total_label'),
      value: localizedNumber(totalCount, ctx),
    },
    sections: [
      {
        emoji: '🛍️',
        title: t(ctx, 'admin_pkg_manager_prompt', { count: localizedNumber(totalCount, ctx) }),
        fields: packages.map((pkg) => ({
          label: escapeTelegramMarkdown(pkg.name),
          value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')} · ${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')} · ${localizedNumber(pkg.price, ctx)} ${t(ctx, 'currency_toman')}`,
        })),
      },
    ],
    ...(pageStatus ? { footer: pageStatus } : {}),
  });
}

export function truncateButtonLabel(value: string, maximum = 60): string {
  const characters = [...value];
  return characters.length <= maximum ? value : `${characters.slice(0, maximum - 1).join('')}…`;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`');
}

function readSettingBool(ctx: ConversationContext, key: string): boolean {
  const service = ctx.services?.translationService;
  if (!service) return false;

  const boolReader = (
    service as typeof service & {
      getSettingBool?: (settingKey: string, fallback?: boolean) => boolean;
    }
  ).getSettingBool;
  if (typeof boolReader === 'function') return boolReader.call(service, key, false);

  return service.getSetting(key, 'false').trim().toLowerCase() === 'true';
}
