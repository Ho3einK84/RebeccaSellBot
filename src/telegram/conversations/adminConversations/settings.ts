import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { t, tm } from '../../locale.js';
import { parsePackageOptionsJson } from '../../../domain/services/PricingService.js';
import type { PackageOption } from '../../../domain/services/PricingService.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import {
  promptInConversation,
  replyInConversation,
  waitForCallbackInput,
  waitForTextInput,
} from '../../ui.js';
import { parseNonnegativeSafeInteger, parsePositiveSafeInteger, requireAdmin } from './shared.js';

export async function adminEditSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  entryPoint?: string
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  // Sales-menu shortcuts deep-link straight past the group picker so admins
  // land on the setting they came for. The full picker ("Settings Center")
  // is still reachable — from System & Settings — with no entry point.
  let pendingEntry = entryPoint;

  for (;;) {
    if (pendingEntry === 'packages') {
      pendingEntry = undefined;
      await managePackages(conversation, ctx);
      continue;
    }

    const shortcutGroup = pendingEntry
      ? SETTING_GROUPS.find((item) => item.id === pendingEntry)
      : undefined;
    pendingEntry = undefined;

    const group = shortcutGroup ?? (await chooseSettingsGroup(conversation, ctx));
    if (!group) return;

    const target = await chooseSettingInGroup(conversation, ctx, group);
    if (target === 'back') continue; // return to the group list
    if (target === undefined) return;
    const setting = target;

    if (setting.key === 'packages_json') {
      await managePackages(conversation, ctx);
      continue;
    }

    const storedCurrentValue = ctx.services.translationService.getSetting(setting.key, '—');
    const currentValue = editableSettingValue(ctx, setting.key);

    if (setting.key === 'naming_mode') {
      const keyboard = new InlineKeyboard()
        .text(t(ctx, 'admin_setting_naming_mode_prefix_number'), 'set-nm:prefix_number')
        .row()
        .text(t(ctx, 'admin_setting_naming_mode_telegramid_number'), 'set-nm:telegramid_number')
        .row()
        .text(t(ctx, 'admin_setting_naming_mode_custom'), 'set-nm:custom')
        .row()
        .text(t(ctx, 'admin_settings_back_groups'), 'set-nm:back');

      await promptInConversation(
        conversation,
        ctx,
        tm(ctx, 'admin_setting_naming_mode_prompt', {
          current: displaySettingValue(ctx, 'naming_mode'),
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const data = await waitForCallbackInput(conversation, ['set-nm:']);
      if (!data || data === 'set-nm:back') continue;

      const selectedMode = data.slice('set-nm:'.length);
      if (['custom', 'prefix_number', 'telegramid_number'].includes(selectedMode)) {
        await ctx.services.translationService.updateSetting('naming_mode', selectedMode);
        try {
          await ctx.services.configService.syncCounters();
        } catch {
          await ctx.services.translationService.updateSetting('naming_mode', storedCurrentValue);
          await replyInConversation(conversation, ctx, t(ctx, 'admin_setting_apply_failed'));
          continue;
        }
        const settingLabel = t(ctx, SETTING_LABELS['naming_mode']);
        await replyInConversation(
          conversation,
          ctx,
          tm(ctx, 'admin_setting_saved', {
            setting: settingLabel,
            key: settingLabel,
            value: displaySettingValue(ctx, 'naming_mode'),
          }),
          { parse_mode: 'Markdown' }
        );
      }
      continue;
    }

    if (setting.key === 'trial_enabled' || setting.key === 'custom_volume_enabled') {
      const callbackPrefix = setting.key === 'trial_enabled' ? 'set-tr:' : 'set-cv:';
      const keyboard = buildBooleanSettingKeyboard(ctx, setting.key, callbackPrefix);

      await promptInConversation(
        conversation,
        ctx,
        tm(
          ctx,
          setting.key === 'trial_enabled'
            ? 'admin_setting_trial_enabled_prompt'
            : 'admin_setting_custom_volume_enabled_prompt',
          { current: displaySettingValue(ctx, setting.key) }
        ),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const data = await waitForCallbackInput(conversation, [callbackPrefix]);
      if (!data || data === `${callbackPrefix}back`) continue;

      const selectedValue = data.slice(callbackPrefix.length);
      if (selectedValue === 'true' || selectedValue === 'false') {
        await ctx.services.translationService.updateSetting(setting.key, selectedValue);
        const settingLabel = t(ctx, SETTING_LABELS[setting.key]);
        await replyInConversation(
          conversation,
          ctx,
          tm(ctx, 'admin_setting_saved', {
            setting: settingLabel,
            key: settingLabel,
            value: displaySettingValue(ctx, setting.key),
          }),
          { parse_mode: 'Markdown' }
        );
      }
      continue;
    }

    const settingLabel = t(ctx, SETTING_LABELS[setting.key] || setting.key);
    let promptMsg: string;
    if (setting.key === 'custom_naming_template') {
      promptMsg = buildCustomNamingTemplatePrompt(ctx);
    } else if (setting.key === 'naming_prefix') {
      promptMsg = tm(ctx, 'admin_setting_naming_prefix_prompt', {
        current: currentValue,
      });
    } else {
      promptMsg = tm(ctx, 'admin_setting_value_prompt', {
        setting: settingLabel,
        key: settingLabel,
        current_value: currentValue,
      });
    }

    await promptInConversation(conversation, ctx, promptMsg, { parse_mode: 'Markdown' });
    const valueInput = await waitForTextInput(conversation);
    if (valueInput === undefined) return;
    const newValue = validateAdminSetting(setting.key, valueInput);
    if (newValue === undefined) {
      await replyInConversation(conversation, ctx, t(ctx, 'admin_setting_invalid'));
      continue;
    }
    await ctx.services.translationService.updateSetting(setting.key, newValue);
    if (isNamingSetting(setting.key)) {
      try {
        await ctx.services.configService.syncCounters();
      } catch {
        await ctx.services.translationService.updateSetting(setting.key, storedCurrentValue);
        await replyInConversation(conversation, ctx, t(ctx, 'admin_setting_apply_failed'));
        continue;
      }
    }
    await replyInConversation(
      conversation,
      ctx,
      tm(ctx, 'admin_setting_saved', {
        setting: settingLabel,
        key: settingLabel,
        value: displaySettingValue(ctx, setting.key),
      }),
      { parse_mode: 'Markdown' }
    );
  }
}

// ── Group navigation ──────────────────────────────────────────────────────────

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
    keyboard.text(t(ctx, item.labelKey), `${prefix}:${item.id}`).row();
  }
  keyboard.text(t(ctx, cancelKey), 'conversation:cancel');
  return keyboard;
}

export function buildSettingsGroupKeyboard(ctx: ConversationContext): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of SETTING_GROUPS) {
    keyboard.text(t(ctx, item.labelKey), `set-group:${item.id}`).row();
  }
  keyboard.text(t(ctx, 'admin_menu_back'), 'nav:main').row();
  return keyboard;
}

export function buildBooleanSettingKeyboard(
  ctx: ConversationContext,
  settingKey: string,
  callbackPrefix: string
): InlineKeyboard {
  const current = ctx.services?.translationService.getSetting(settingKey, 'false') === 'true';
  const activeLabel = t(ctx, 'admin_setting_enabled_on');
  const inactiveLabel = t(ctx, 'admin_setting_enabled_off');
  return new InlineKeyboard()
    .text(current ? `✅ ${activeLabel}` : activeLabel, `${callbackPrefix}true`)
    .text(!current ? `✅ ${inactiveLabel}` : inactiveLabel, `${callbackPrefix}false`)
    .row()
    .text(t(ctx, 'admin_settings_back_groups'), `${callbackPrefix}back`);
}

async function chooseSettingsGroup(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<SettingGroup | undefined> {
  const keyboard = buildSettingsGroupKeyboard(ctx);

  await promptInConversation(conversation, ctx, tm(ctx, 'admin_settings_groups_prompt'), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
  const data = await waitForCallbackInput(conversation, ['set-group:', 'nav:main']);
  if (data === undefined || data === 'nav:main') return undefined;
  return SETTING_GROUPS.find((group) => group.id === data.slice('set-group:'.length));
}

/** Returns the chosen setting, 'back' for group list, or undefined to stop. */
async function chooseSettingInGroup(
  conversation: MyConversation,
  ctx: ConversationContext,
  group: SettingGroup
): Promise<{ key: string; labelKey: string } | 'back' | undefined> {
  const keyboard = new InlineKeyboard();
  for (const key of group.settings) {
    keyboard.text(t(ctx, SETTING_LABELS[key]), `set-edit:${key}`).row();
  }
  keyboard.text(t(ctx, 'admin_settings_back_groups'), 'set-groups').row();
  keyboard.text(t(ctx, 'admin_menu_back'), 'nav:main').row();

  await promptInConversation(conversation, ctx, buildSettingsGroupPrompt(ctx, group.id), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
  const data = await waitForCallbackInput(conversation, ['set-edit:', 'set-groups', 'nav:main']);
  if (data === undefined || data === 'nav:main') return undefined;
  if (data === 'set-groups') return 'back';
  const key = data.slice('set-edit:'.length);
  if (!SETTING_LABELS[key]) return undefined;
  return { key, labelKey: SETTING_LABELS[key] };
}

export function buildSettingsGroupPrompt(ctx: ConversationContext, groupId: string): string {
  const group = SETTING_GROUPS.find((item) => item.id === groupId);
  if (!group) return '';
  const entries = group.settings.map(
    (key) =>
      `• ${escapeTelegramMarkdown(t(ctx, SETTING_LABELS[key]))}: \`${escapeInlineCode(displaySettingValue(ctx, key))}\``
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

function escapeInlineCode(value: string): string {
  return value.replaceAll('`', '\\`');
}

// ── Interactive package manager ───────────────────────────────────────────────

async function managePackages(conversation: MyConversation, ctx: ConversationContext) {
  if (!ctx.services) return;
  let packages = currentPackages(ctx);

  for (;;) {
    const keyboard = new InlineKeyboard();
    packages.forEach((pkg, index) => {
      const panel = pkg.panelId ? ctx.services!.panelRegistry.getPanel(pkg.panelId) : undefined;
      const service = panel?.services.find((item) => item.serviceId === pkg.serviceId);
      const target =
        panel && service
          ? ` · ${panel.name}/${service.name}`
          : ` · ${t(ctx, 'admin_pkg_default_target')}`;
      keyboard
        .text(`${pkg.name}${target}  ✏️`, `pkg-edit:${index}`)
        .text('🗑', `pkg-del:${index}`)
        .row();
    });
    keyboard.text(t(ctx, 'admin_pkg_add'), 'pkg-add').row();
    keyboard.text(t(ctx, 'admin_settings_back_groups'), 'pkg-back').row();
    keyboard.text(t(ctx, 'admin_menu_back'), 'nav:main').row();

    await promptInConversation(
      conversation,
      ctx,
      t(ctx, 'admin_pkg_manager_prompt', { count: packages.length }),
      { reply_markup: keyboard }
    );
    const data = await waitForCallbackInput(conversation, [
      'pkg-edit:',
      'pkg-del:',
      'pkg-add',
      'pkg-back',
      'nav:main',
    ]);
    if (data === undefined || data === 'nav:main') return;
    if (data === 'pkg-back') return;

    if (data === 'pkg-add') {
      const created = await promptPackageFields(conversation, ctx);
      if (created) {
        const existingIndex = packages.findIndex(
          (p) => p.name.trim().toLowerCase() === created.name.trim().toLowerCase()
        );
        if (existingIndex >= 0) {
          packages = packages.map((pkg, i) => (i === existingIndex ? created : pkg));
        } else {
          packages = [...packages, created];
        }
      }
    } else if (data.startsWith('pkg-edit:')) {
      const index = Number(data.slice('pkg-edit:'.length));
      const existing = packages[index];
      if (!existing) continue;
      const updated = await promptPackageFields(conversation, ctx, existing);
      if (updated) packages = packages.map((pkg, i) => (i === index ? updated : pkg));
    } else if (data.startsWith('pkg-del:')) {
      const index = Number(data.slice('pkg-del:'.length));
      // Never leave the shop with zero packages.
      if (!Number.isNaN(index) && packages.length > 1) {
        packages = packages.filter((_, i) => i !== index);
      } else {
        await replyInConversation(conversation, ctx, t(ctx, 'admin_pkg_last_removed'));
        continue;
      }
    }

    await ctx.services.translationService.updateSetting('packages_json', JSON.stringify(packages));
    await replyInConversation(conversation, ctx, t(ctx, 'admin_pkg_saved'));
  }
}

async function promptPackageFields(
  conversation: MyConversation,
  ctx: ConversationContext,
  existing?: PackageOption
): Promise<PackageOption | undefined> {
  const name = await askPackageString(
    conversation,
    ctx,
    'admin_pkg_name_prompt',
    existing?.name,
    (value) => value.length >= 1 && value.length <= 120
  );
  if (name === undefined) return undefined;

  const gbAmount = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_gb_prompt',
    existing?.gbAmount,
    1,
    10_000
  );
  if (gbAmount === undefined) return undefined;

  const durationDays = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_days_prompt',
    existing?.durationDays,
    1,
    3_650
  );
  if (durationDays === undefined) return undefined;

  const price = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_price_prompt',
    existing?.price,
    1,
    Number.MAX_SAFE_INTEGER
  );
  if (price === undefined) return undefined;

  const target = await choosePackageTarget(conversation, ctx, existing);
  if (!target) return undefined;

  return {
    id: existing?.id ?? generatePackageId(name),
    name,
    gbAmount,
    durationDays,
    price,
    panelId: target.panelId,
    serviceId: target.serviceId,
  };
}

async function choosePackageTarget(
  conversation: MyConversation,
  ctx: ConversationContext,
  existing?: PackageOption
): Promise<{ panelId: string; serviceId: number } | undefined> {
  const panels = ctx.services?.panelRegistry
    .listPanels()
    .filter((panel) => panel.enabled && panel.services.length > 0);
  if (!panels?.length) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_panel_required_first'));
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  for (const panel of panels) {
    for (const service of panel.services) {
      const selected = panel.id === existing?.panelId && service.serviceId === existing.serviceId;
      keyboard
        .text(
          `${selected ? '✅ ' : ''}${panel.name} · ${service.name} (${service.serviceId})`,
          `pkg-target:${panel.id}:${service.serviceId}`
        )
        .row();
    }
  }
  keyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(conversation, ctx, t(ctx, 'admin_pkg_target_prompt'), {
    reply_markup: keyboard,
  });
  const selected = await waitForCallbackInput(conversation, ['pkg-target:']);
  if (!selected) return undefined;
  const match = /^pkg-target:([a-z0-9_-]{3,40}):(\d+)$/iu.exec(selected);
  if (!match) return undefined;
  return { panelId: match[1]!, serviceId: Number(match[2]) };
}

async function askPackageString(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  current: string | undefined,
  validate: (value: string) => boolean
): Promise<string | undefined> {
  await promptInConversation(conversation, ctx, t(ctx, promptKey, { current: current ?? '—' }));
  const input = await waitForTextInput(conversation);
  if (input === undefined) return undefined;
  const value = input.trim();
  if (!validate(value)) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_setting_invalid'));
    return undefined;
  }
  return value;
}

async function askPackageInteger(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  current: number | undefined,
  minimum: number,
  maximum: number
): Promise<number | undefined> {
  await promptInConversation(conversation, ctx, t(ctx, promptKey, { current: current ?? '—' }));
  const input = await waitForTextInput(conversation);
  if (input === undefined) return undefined;
  const value = parsePositiveSafeInteger(input);
  if (value === undefined || value < minimum || value > maximum) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_setting_invalid'));
    return undefined;
  }
  return value;
}

function generatePackageId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 40) || 'pkg';
  return `pkg_${slug}_${Date.now().toString(36)}`;
}

function currentPackages(ctx: ConversationContext): PackageOption[] {
  if (!ctx.services) return [];
  const packages = parsePackageOptionsJson(
    ctx.services.translationService.getSetting('packages_json')
  );
  if (packages) return packages.map((pkg) => ({ ...pkg }));
  return ctx.services.pricingService.getPackages();
}

function isSecretSetting(key: string): boolean {
  return /(?:api[_-]?key|token|password|secret)/i.test(key);
}

function isNamingSetting(key: string): boolean {
  return key === 'naming_mode' || key === 'naming_prefix' || key === 'custom_naming_template';
}

type SettingGroup = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  settings: readonly string[];
};

const SETTING_LABELS: Readonly<Record<string, string>> = {
  price_per_gb: 'admin_setting_price_per_gb',
  packages_json: 'admin_setting_packages_json',
  custom_volume_enabled: 'admin_setting_custom_volume_enabled',
  custom_default_days: 'admin_setting_custom_default_days',
  low_traffic_threshold_gb: 'admin_setting_low_traffic_threshold_gb',
  expiry_warning_days: 'admin_setting_expiry_warning_days',
  refund_window_hours: 'admin_setting_refund_window_hours',
  card_number: 'admin_setting_card_number',
  card_holder: 'admin_setting_card_holder',
  trial_enabled: 'admin_setting_trial_enabled',
  trial_gb: 'admin_setting_trial_gb',
  trial_days: 'admin_setting_trial_days',
  referral_bonus_toman: 'admin_setting_referral_bonus_toman',
  cashback_percent: 'admin_setting_cashback_percent',
  naming_mode: 'admin_setting_naming_mode',
  naming_prefix: 'admin_setting_naming_prefix',
  custom_naming_template: 'admin_setting_custom_naming_template',
};

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    id: 'pricing',
    labelKey: 'admin_setting_group_pricing',
    descriptionKey: 'admin_setting_group_pricing_desc',
    settings: ['price_per_gb', 'packages_json', 'expiry_warning_days', 'refund_window_hours'],
  },
  {
    id: 'custom_volume',
    labelKey: 'admin_setting_group_custom_volume',
    descriptionKey: 'admin_setting_group_custom_volume_desc',
    settings: ['custom_volume_enabled', 'custom_default_days', 'low_traffic_threshold_gb'],
  },
  {
    id: 'payment',
    labelKey: 'admin_setting_group_payment',
    descriptionKey: 'admin_setting_group_payment_desc',
    settings: ['card_number', 'card_holder'],
  },
  {
    id: 'trial',
    labelKey: 'admin_setting_group_trial',
    descriptionKey: 'admin_setting_group_trial_desc',
    settings: ['trial_enabled', 'trial_gb', 'trial_days'],
  },
  {
    id: 'referral',
    labelKey: 'admin_setting_group_referral',
    descriptionKey: 'admin_setting_group_referral_desc',
    settings: ['referral_bonus_toman', 'cashback_percent'],
  },
  {
    id: 'naming',
    labelKey: 'admin_setting_group_naming',
    descriptionKey: 'admin_setting_group_naming_desc',
    settings: ['naming_mode', 'naming_prefix', 'custom_naming_template'],
  },
];

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
      ? t(ctx, 'admin_setting_packages_summary', { count: packages.length })
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
  if (key === 'trial_enabled' || key === 'custom_volume_enabled') {
    return t(
      ctx,
      ctx.services.translationService.getSetting(key, 'false') === 'true'
        ? 'admin_setting_enabled_on'
        : 'admin_setting_enabled_off'
    );
  }
  return ctx.services.translationService.getSetting(key, '—');
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

const displaySettingValue = displayAdminSettingValue;

function editableSettingValue(ctx: ConversationContext, key: string): string {
  if (!ctx.services || isSecretSetting(key)) return displaySettingValue(ctx, key);
  const value = ctx.services.translationService.getSetting(key, '—');
  return value.length <= 3_000 ? value : displaySettingValue(ctx, key);
}

function validateAdminSetting(key: string, rawValue: string): string | undefined {
  const value = rawValue.trim();
  switch (key) {
    case 'price_per_gb':
    case 'referral_bonus_toman':
      return normalizedPositiveInteger(value, Number.MAX_SAFE_INTEGER);
    case 'trial_gb':
      return normalizedPositiveInteger(value, 10_000);
    case 'trial_days':
    case 'expiry_warning_days':
    case 'custom_default_days':
      return normalizedPositiveInteger(value, 3_650);
    case 'refund_window_hours':
      return normalizedNonnegativeInteger(value, 8_760);
    case 'cashback_percent':
      return normalizedNonnegativeInteger(value, 100);
    case 'low_traffic_threshold_gb':
      return normalizedPositiveFinite(value, 100_000);
    case 'trial_enabled':
    case 'custom_volume_enabled':
      return value === 'true' || value === 'false' ? value : undefined;
    case 'card_number':
      return /^[0-9 -]{12,32}$/u.test(value) ? value : undefined;
    case 'card_holder':
      return value.length >= 1 && value.length <= 120 ? value : undefined;
    case 'packages_json': {
      const packages = parsePackageOptionsJson(value);
      return packages ? JSON.stringify(packages) : undefined;
    }
    case 'naming_mode':
      return ['custom', 'prefix_number', 'telegramid_number'].includes(value) ? value : undefined;
    case 'naming_prefix':
      return /^[a-z0-9_]{1,24}$/iu.test(value) ? value : undefined;
    case 'custom_naming_template':
      return /^[a-z0-9_{}-]{1,80}$/iu.test(value) ? value : undefined;
    default:
      return undefined;
  }
}

function normalizedPositiveInteger(value: string, maximum: number): string | undefined {
  const parsed = parsePositiveSafeInteger(value);
  return parsed !== undefined && parsed <= maximum ? String(parsed) : undefined;
}

function normalizedNonnegativeInteger(value: string, maximum: number): string | undefined {
  const parsed = parseNonnegativeSafeInteger(value);
  return parsed !== undefined && parsed <= maximum ? String(parsed) : undefined;
}

function normalizedPositiveFinite(value: string, maximum: number): string | undefined {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? String(parsed) : undefined;
}
