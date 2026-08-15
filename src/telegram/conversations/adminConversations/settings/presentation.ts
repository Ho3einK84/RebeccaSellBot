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
  getSettingDefinition,
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
    const definition = getSettingDefinition(key);
    let label = t(ctx, SETTING_LABELS[key]);
    if (definition?.editor.type === 'boolean') {
      const isEnabled = readSettingBool(ctx, key);
      const badge = isEnabled ? t(ctx, 'admin_overview_active') : t(ctx, 'admin_overview_inactive');
      label = `${label}: ${badge}`;
    }
    keyboard.text(truncateButtonLabel(label, 60), callbackData('set-edit', key)).row();
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

export function buildLocaleSettingKeyboard(
  ctx: ConversationContext,
  currentLocale: string,
  callbackPrefix: string
): InlineKeyboard {
  const isFa = currentLocale !== 'en';
  const isEn = currentLocale === 'en';
  const faLabel = t(ctx, 'admin_setting_locale_fa');
  const enLabel = t(ctx, 'admin_setting_locale_en');
  return new InlineKeyboard()
    .text(isFa ? `✅ ${faLabel}` : faLabel, `${callbackPrefix}fa`)
    .text(isEn ? `✅ ${enLabel}` : enLabel, `${callbackPrefix}en`)
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

function parseSettingNum(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSettingsOverviewScreen(ctx: ConversationContext): string {
  if (!ctx.services) return '';
  const ts = ctx.services.translationService;
  const botEnabled = ts.getSettingBool('bot_enabled', true);
  const langEnabled = ts.getSettingBool('language_selection_enabled', true);
  const defLocale = ts.getSetting('default_locale', 'fa');
  const trialEnabled = ts.getSettingBool('trial_enabled', true);
  const trialGb = parseSettingNum(ts.getSetting('trial_gb'), 1);
  const trialDays = parseSettingNum(ts.getSetting('trial_days'), 3);
  const customVolEnabled = ts.getSettingBool('custom_volume_enabled', true);
  const pricePerGb = parseSettingNum(ts.getSetting('price_per_gb'), 5000);
  const customDays = parseSettingNum(ts.getSetting('custom_default_days'), 30);
  const cardNumber = ts.getSetting('card_number', '—');
  const cardHolder = ts.getSetting('card_holder', '—');
  const supportEnabled = ts.getSettingBool('support_enabled', true);
  const supportDest = ts.getSetting('support_destination', '') || '—';
  const refBonus = parseSettingNum(ts.getSetting('referral_bonus_toman'), 10000);
  const cashback = parseSettingNum(ts.getSetting('cashback_percent'), 5);
  const lowTraffic = parseSettingNum(ts.getSetting('low_traffic_threshold_gb'), 2);
  const expiryDays = parseSettingNum(ts.getSetting('expiry_warning_days'), 3);

  const onBadge = t(ctx, 'admin_overview_active');
  const offBadge = t(ctx, 'admin_overview_inactive');
  const maintBadge = t(ctx, 'admin_overview_maintenance');

  return buildScreen({
    emoji: '⚙️',
    title: t(ctx, 'admin_overview_title'),
    subtitle: t(ctx, 'admin_overview_subtitle'),
    primary: {
      emoji: botEnabled ? '🟢' : '🔴',
      label: t(ctx, 'admin_overview_bot_status'),
      value: botEnabled ? onBadge : maintBadge,
    },
    sections: [
      {
        emoji: '🌐',
        title: t(ctx, 'admin_overview_language'),
        fields: [
          {
            label: t(ctx, 'admin_setting_default_locale'),
            value:
              defLocale === 'en'
                ? t(ctx, 'admin_setting_locale_en')
                : t(ctx, 'admin_setting_locale_fa'),
          },
          {
            label: t(ctx, 'admin_setting_language_selection_enabled'),
            value: langEnabled ? onBadge : offBadge,
          },
        ],
      },
      {
        emoji: '💳',
        title: t(ctx, 'admin_overview_payment'),
        fields: [
          {
            label: t(ctx, 'admin_setting_card_number'),
            value: `\`${escapeTelegramMarkdown(cardNumber)}\``,
          },
          {
            label: t(ctx, 'admin_setting_card_holder'),
            value: escapeTelegramMarkdown(cardHolder),
          },
        ],
      },
      {
        emoji: '🎁',
        title: t(ctx, 'admin_overview_trial'),
        fields: [
          {
            label: t(ctx, 'admin_setting_trial_enabled'),
            value: trialEnabled
              ? `${onBadge} (${localizedNumber(trialGb, ctx)} GB / ${localizedNumber(trialDays, ctx)} ${t(ctx, 'days_unit')})`
              : offBadge,
          },
        ],
      },
      {
        emoji: '📦',
        title: t(ctx, 'admin_overview_custom_volume'),
        fields: [
          {
            label: t(ctx, 'admin_setting_custom_volume_enabled'),
            value: customVolEnabled
              ? `${onBadge} (${localizedNumber(pricePerGb, ctx)} ${t(ctx, 'currency_toman')}/GB - ${localizedNumber(customDays, ctx)} ${t(ctx, 'days_unit')})`
              : offBadge,
          },
        ],
      },
      {
        emoji: '👥',
        title: t(ctx, 'admin_overview_referral'),
        fields: [
          {
            label: t(ctx, 'admin_setting_referral_bonus_toman'),
            value: `${localizedNumber(refBonus, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_setting_cashback_percent'),
            value: `${localizedNumber(cashback, ctx)}%`,
          },
        ],
      },
      {
        emoji: '💬',
        title: t(ctx, 'admin_overview_support'),
        fields: [
          {
            label: t(ctx, 'admin_setting_support_enabled'),
            value: supportEnabled
              ? `${onBadge} (\`${escapeTelegramMarkdown(supportDest)}\`)`
              : offBadge,
          },
        ],
      },
      {
        emoji: '⚠️',
        title: t(ctx, 'admin_overview_alerts'),
        fields: [
          {
            label: t(ctx, 'admin_setting_low_traffic_threshold_gb'),
            value: `${localizedNumber(lowTraffic, ctx)} GB`,
          },
          {
            label: t(ctx, 'admin_setting_expiry_warning_days'),
            value: `${localizedNumber(expiryDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
        ],
      },
      {
        emoji: '🏷️',
        title: t(ctx, 'admin_overview_naming'),
        fields: [
          {
            label: t(ctx, 'admin_setting_naming_mode'),
            value: displayAdminSettingValue(ctx, 'naming_mode'),
          },
        ],
      },
    ],
    footer: `ℹ️ ${t(ctx, 'admin_settings_groups_prompt')}`,
  });
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
  if (key === 'default_locale') {
    const loc = ctx.services.translationService.getSetting(key, 'fa');
    return loc === 'en' ? t(ctx, 'admin_setting_locale_en') : t(ctx, 'admin_setting_locale_fa');
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
  const definition = getSettingDefinition(key);
  if (definition?.editor.type === 'boolean') {
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

export function readSettingBool(ctx: ConversationContext, key: string): boolean {
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
