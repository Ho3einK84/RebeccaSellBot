import { describe, expect, it, vi } from 'vitest';
import {
  backupEnabled,
  backupIncludeEnv,
  backupIntervalHours,
  backupTargetChatId,
} from '../../src/domain/services/FeatureSettings.js';
import { type PackageOption } from '../../src/domain/services/PricingService.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { logger } from '../../src/infra/logger.js';
import {
  adminEditSettingsConversation,
  adminNamingSettingsConversation,
  adminTrialSettingsConversation,
  adminWebAppSettingsConversation,
  buildBooleanSettingKeyboard,
  buildCustomNamingTemplatePrompt,
  buildEditorNavigationKeyboard,
  buildLocaleSettingKeyboard,
  buildSelectionKeyboard,
  buildSettingsGroupKeyboard,
  buildSettingsGroupPrompt,
  buildWebAppSettingsKeyboard,
  buildWebAppSettingsScreen,
  displayAdminSettingValue,
  isValidNamingTemplate,
  manageNamingSettings,
  normalizeSupportDestination,
  SETTING_GROUPS,
  validateAdminSetting,
} from '../../src/telegram/conversations/adminConversations.js';
import {
  GENERAL_SETTING_GROUPS,
  getSettingDefinition,
  getSettingGroup,
} from '../../src/telegram/conversations/adminConversations/settings/catalog.js';
import { adminLuckyWheelSettingsConversation } from '../../src/telegram/conversations/adminConversations/settings/luckyWheel.js';
import { adminPaymentSettingsConversation } from '../../src/telegram/conversations/adminConversations/settings/payment.js';
import {
  buildPackageManagerScreen,
  buildSettingsOverviewScreen,
} from '../../src/telegram/conversations/adminConversations/settings/presentation.js';
import {
  normalizeBackupTarget,
  validateNamingTemplateDetailed,
} from '../../src/telegram/conversations/adminConversations/settings/validation.js';
import {
  appendNamingToken,
  nextNamingSeparator,
  popLastNamingSegment,
} from '../../src/telegram/conversations/adminConversations/settings/namingTemplateBuilder.js';
import {
  renderAdminSalesMenuScreen,
  salesMenuKeyboard,
} from '../../src/telegram/keyboards/adminMenu.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import type {
  ConversationContext,
  MenuContext,
  MyConversation,
  SessionData,
} from '../../src/telegram/types.js';
import { extractCallbackDataList } from './helpers/botHarness.js';

type ScriptedInput = { callback: string } | { text: string };

function starterPackage(): PackageOption {
  return {
    id: 'starter',
    name: 'Starter',
    gbAmount: 10,
    durationDays: 30,
    price: 50_000,
    panelId: 'rp_primary',
    serviceId: 2,
  };
}

function createPresentationContext(settings: Record<string, string>): ConversationContext {
  const translationService = {
    getSetting: vi.fn((key: string, fallback = '') => settings[key] ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) =>
      settings[key] !== undefined ? settings[key] === 'true' : fallback
    ),
    resolveLocale: vi.fn(() => 'fa'),
    get: vi.fn((key: string, _locale?: string, params?: Record<string, string | number>) => {
      const texts: Record<string, string> = {
        admin_setting_naming_mode_val_prefix_number: 'پیشوند + شمارنده',
        admin_setting_naming_mode_val_telegramid_number: 'آیدی تلگرام + شمارنده',
        admin_setting_naming_mode_val_custom: 'قالب سفارشی',
        admin_setting_enabled_on: '🟢 فعال',
        admin_setting_enabled_off: '🔴 غیرفعال',
        admin_setting_custom_naming_template_prompt:
          'مقدار فعلی: `{current}`\n• `{code_prefix}` ({prefix_value})\n• `{code_telegram_id}`\n• `{code_counter}`\n• `{code_random4}`\nنمونه: `{example_primary}`',
        admin_settings_group_prompt:
          '⚙️ {group}\n{description}\n\n{settings}\n\n👇 گزینه موردنظر را انتخاب کنید.',
        admin_setting_group_naming: '🏷️ نامگذاری اشتراکها',
        admin_setting_group_naming_desc: 'الگوی ساخت نام کاربران جدید در پنل Rebecca.',
        admin_setting_naming_mode: '🎯 روش نامگذاری',
        admin_setting_naming_prefix: '🔤 پیشوند نام',
        admin_setting_custom_naming_template: '🧩 قالب سفارشی',
      };
      let value = texts[key] ?? key;
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
      return value;
    }),
  };

  return {
    from: { id: 1, is_bot: false, first_name: 'Admin', language_code: 'fa' },
    services: { translationService },
  } as unknown as ConversationContext;
}

function createSettingsHarness(
  initialSettings: Record<string, string>,
  script: ScriptedInput[],
  options: {
    failSave?: boolean;
    failNamingSync?: boolean;
    packages?: PackageOption[];
    randomValue?: number;
    useRealTranslations?: boolean;
  } = {}
) {
  const settings = new Map(Object.entries(initialSettings));
  const session: SessionData = {};
  let messageId = 100;
  const reply = vi.fn(async () => ({ message_id: messageId++ }));
  const updateSetting = vi.fn(async (key: string, value: string) => {
    if (options.failSave) throw new Error('DB_WRITE_FAILED');
    settings.set(key, value);
  });
  const syncCounters = options.failNamingSync
    ? vi.fn().mockRejectedValue(new Error('SYNC_FAILED'))
    : vi.fn().mockResolvedValue(undefined);
  const fallbackPackages = options.packages ?? [starterPackage()];
  const panels = [
    {
      id: 'rp_primary',
      name: 'Primary panel',
      enabled: true,
      isDefault: true,
      credentialConfigured: true,
      credentialMode: 'api_key',
      services: [{ serviceId: 2, name: 'Default service', isDefault: true }],
    },
  ];
  const realTs = options.useRealTranslations ? new TranslationService() : undefined;
  const translationService = {
    resolveLocale: vi.fn((loc?: string | null) => (realTs ? realTs.resolveLocale(loc) : 'en')),
    get: vi.fn((key: string, locale?: string, params?: Record<string, string | number>) => {
      if (realTs) return realTs.get(key, locale, params);
      let rendered = key;
      for (const [name, value] of Object.entries(params ?? {})) {
        rendered += ` ${name}=${String(value)}`;
      }
      return rendered;
    }),
    getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const value = settings.get(key);
      return value === undefined ? fallback : value === 'true';
    }),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const value = settings.get(key);
      if (value === undefined || value.trim() === '') return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }),
    updateSetting,
  };
  const services = {
    translationService,
    configService: { syncCounters },
    pricingService: { getPackages: vi.fn(() => fallbackPackages.map((pkg) => ({ ...pkg }))) },
    packageCategoryService: {
      listCategories: vi.fn(async () => []),
      getCategoryById: vi.fn(async () => null),
    },
    panelRegistry: {
      listPanels: vi.fn(() => panels),
      getPanel: vi.fn((panelId: string) => panels.find((panel) => panel.id === panelId)),
    },
    isAdmin: vi.fn(() => true),
    adminIds: [42],
  };
  const ctx = {
    from: { id: 42, is_bot: false, first_name: 'Admin', language_code: 'en' },
    userLocale: 'en',
    services,
    session,
    reply,
  } as unknown as ConversationContext;
  const remaining = [...script];
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const random = vi.fn(async () => options.randomValue ?? 0.42);
  const conversation = {
    external: vi.fn(async (operation: (outsideCtx: unknown) => unknown) =>
      operation(ctx as unknown)
    ),
    random,
    wait: vi.fn(async () => {
      const next = remaining.shift();
      if (!next) throw new Error('TEST_INPUT_SCRIPT_EXHAUSTED');
      return {
        ...ctx,
        ...('callback' in next
          ? {
              callbackQuery: { data: next.callback, message: { message_id: 201 } },
              answerCallbackQuery,
            }
          : { message: { text: next.text } }),
      };
    }),
    halt: vi.fn(async () => {
      throw new Error('UNEXPECTED_NAVIGATION_HALT');
    }),
  } as unknown as MyConversation;

  return {
    answerCallbackQuery,
    conversation,
    ctx,
    random,
    remaining,
    reply,
    settings,
    syncCounters,
    updateSetting,
  };
}

function replyTexts(reply: ReturnType<typeof vi.fn>): string[] {
  return reply.mock.calls.map((call) => String(call[0]));
}

function keyboardRenderCount(reply: ReturnType<typeof vi.fn>, callback: string): number {
  return reply.mock.calls.filter((call) => {
    const options = call[1] as { reply_markup?: { inline_keyboard?: unknown[][] } } | undefined;
    return options?.reply_markup?.inline_keyboard?.flat().some((button) => {
      return (button as { callback_data?: string }).callback_data === callback;
    });
  }).length;
}

describe('Admin settings presentation & selection keyboards', () => {
  it('builds selection and settings group keyboards cleanly', () => {
    const fakeCtx = createPresentationContext({});
    const selKb = buildSelectionKeyboard(
      fakeCtx,
      [
        { id: 'opt1', labelKey: 'lbl_opt1' },
        { id: 'opt2', labelKey: 'lbl_opt2' },
      ],
      'custom-prefix',
      'custom_cancel'
    );
    const selButtons = selKb.inline_keyboard.flat();
    expect(selButtons).toHaveLength(3);
    expect(selButtons.map((b) => [b.text, b.callback_data])).toEqual([
      ['lbl_opt1', 'custom-prefix:opt1'],
      ['lbl_opt2', 'custom-prefix:opt2'],
      ['custom_cancel', 'conversation:cancel'],
    ]);

    const groupKb = buildSettingsGroupKeyboard(fakeCtx, SETTING_GROUPS);
    const groupButtons = groupKb.inline_keyboard.flat();
    expect(SETTING_GROUPS.length).toBeGreaterThan(0);
    expect(groupButtons).toHaveLength(SETTING_GROUPS.length + 1);
    for (const group of SETTING_GROUPS) {
      expect(group.descriptionKey).toBeDefined();
      expect(extractCallbackDataList(groupKb)).toContain(`set-group:${group.id}`);
    }
    const backBtn = groupButtons.find((btn) => btn.callback_data === 'nav:admin');
    expect(backBtn?.text).toBe('admin_menu_back_to_admin');
  });

  it('renders localized setting values, literal naming prompts, and sanitized Markdown cards', () => {
    const ctx = createPresentationContext({
      naming_mode: 'custom',
      trial_enabled: 'true',
      custom_volume_enabled: 'false',
      naming_prefix: 'h',
      custom_naming_template: 'h_{telegram_id}_{counter}',
    });

    expect(displayAdminSettingValue(ctx, 'naming_mode')).toBe('قالب سفارشی');
    expect(displayAdminSettingValue(ctx, 'trial_enabled')).toBe('🟢 فعال');
    expect(displayAdminSettingValue(ctx, 'custom_volume_enabled')).toBe('🔴 غیرفعال');

    const namingPrompt = buildCustomNamingTemplatePrompt(ctx);
    expect(namingPrompt).toContain('`h_{telegram_id}_{counter}`');
    expect(namingPrompt).toContain('`{prefix}` (h)');
    expect(namingPrompt).toContain('`{telegram_id}`');
    expect(namingPrompt).toContain('`{counter}`');
    expect(namingPrompt).toContain('`{random4}`');
    expect(namingPrompt).toContain('`{prefix}_{telegram_id}_{counter}`');
    expect(namingPrompt).not.toContain('—');
    expect(namingPrompt).not.toContain('{code_');

    const groupPrompt = buildSettingsGroupPrompt(ctx, 'naming');
    expect(groupPrompt).toContain('🎯 روش نامگذاری: `قالب سفارشی`');
    expect(groupPrompt).toContain('🔤 پیشوند نام: `h`');
    expect(groupPrompt).toContain('🧩 قالب سفارشی: `h_{telegram_id}_{counter}`');
    expect(groupPrompt).not.toContain('custom\n');

    const paymentPrompt = buildSettingsGroupPrompt(
      createPresentationContext({ card_holder: 'Name`_*[' }),
      'payment'
    );
    expect(paymentPrompt).toContain('Name\\`_*[');
    expect(paymentPrompt).not.toContain('`Name`_*[`');
  });

  it('builds toggle, editor, locale keyboards and exact-order overview screen', () => {
    const toggleKb = buildBooleanSettingKeyboard(
      createPresentationContext({ custom_volume_enabled: 'true' }),
      'custom_volume_enabled',
      'set-bool:'
    );
    const toggleButtons = toggleKb.inline_keyboard.flat();
    expect(extractCallbackDataList(toggleKb)).toEqual([
      'set-bool:true',
      'set-bool:false',
      'set-bool:back',
    ]);
    expect(toggleButtons[0]?.text).toContain('✅');
    expect(toggleButtons[1]?.text).not.toContain('✅');

    const ctx = createPresentationContext({
      bot_enabled: 'true',
      trial_enabled: 'true',
      support_enabled: 'true',
      support_destination: '@support_admin',
      default_locale: 'fa',
    });
    expect(extractCallbackDataList(buildEditorNavigationKeyboard(ctx, 'pricing'))).toEqual([
      'set-edit-back:pricing',
    ]);
    expect(extractCallbackDataList(buildLocaleSettingKeyboard(ctx, 'fa', 'set-loc:'))).toEqual([
      'set-loc:fa',
      'set-loc:en',
      'set-loc:back',
    ]);

    const overview = buildSettingsOverviewScreen(ctx);
    expect(overview).toContain('admin_overview_bot_status');
    expect(overview).toContain('`@support_admin`');
    expect(overview).toContain('admin_overview_naming');
    expect(overview).not.toContain('admin_setting_trial_enabled');

    const sysIdx = overview.indexOf('admin_overview_language');
    const supIdx = overview.indexOf('admin_overview_support');
    const namIdx = overview.indexOf('admin_overview_naming');
    expect(sysIdx).toBeGreaterThan(-1);
    expect(supIdx).toBeGreaterThan(sysIdx);
    expect(namIdx).toBeGreaterThan(supIdx);
  });
});

describe('Admin settings validation, backup catalog & sales navigation', () => {
  it('canonicalizes Persian/Arabic numbers, enforces bounds, and normalizes cards & support handles', () => {
    expect(validateAdminSetting('low_traffic_threshold_gb', ' ۱۲٫۵ ')).toBe('12.5');
    expect(validateAdminSetting('low_traffic_threshold_gb', '١٬٢٣٤٫٥')).toBe('1234.5');
    expect(validateAdminSetting('expiry_warning_days', '۳۶۵')).toBe('365');
    expect(validateAdminSetting('referral_bonus_toman', '۱٬۰۰۰٬۰۰۰')).toBe('1000000');

    expect(validateAdminSetting('expiry_warning_days', '۰')).toBe('0');
    expect(validateAdminSetting('refund_window_hours', '0')).toBe('0');
    expect(validateAdminSetting('cashback_percent', '0')).toBe('0');
    expect(validateAdminSetting('trial_gb', '0.1')).toBe('0.1');
    expect(validateAdminSetting('trial_gb', '0.05')).toBe('0.05');
    expect(validateAdminSetting('trial_gb', '۰٫۰۵')).toBe('0.05');
    expect(validateAdminSetting('trial_gb', '۰/۱')).toBe('0.1');
    expect(validateAdminSetting('trial_gb', '.5')).toBe('0.5');
    expect(validateAdminSetting('trial_gb', '0.001')).toBe('0.001');
    expect(validateAdminSetting('trial_gb', '0')).toBeUndefined();
    expect(validateAdminSetting('trial_gb', '0.0005')).toBeUndefined();
    expect(validateAdminSetting('trial_gb', '-0.1')).toBeUndefined();
    expect(validateAdminSetting('trial_gb', '10000.1')).toBeUndefined();
    expect(validateAdminSetting('trial_gb', '1/2/3')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', '-1')).toBeUndefined();
    expect(validateAdminSetting('trial_days', '1.5')).toBeUndefined();
    expect(validateAdminSetting('cashback_percent', '101')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', 'Infinity')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', 'NaN')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', '9007199254740992')).toBeUndefined();
    expect(validateAdminSetting('wallet_transfer_min_amount', '5000')).toBe('5000');
    expect(validateAdminSetting('wallet_transfer_min_amount', '۵٬۰۰۰')).toBe('5000');
    expect(validateAdminSetting('wallet_transfer_min_amount', '0')).toBeUndefined();

    expect(validateAdminSetting('card_number', '۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۰')).toBe('6037991234567890');
    expect(validateAdminSetting('card_number', '6037 9912 3456')).toBe('603799123456');
    expect(validateAdminSetting('card_number', '1234')).toBeUndefined();
    expect(validateAdminSetting('card_number', '6037x991234567890')).toBeUndefined();

    expect(normalizeSupportDestination('support_team')).toBe('@support_team');
    expect(normalizeSupportDestination(' @support_team ')).toBe('@support_team');
    expect(normalizeSupportDestination('۱۲۳۴۵۶۷۸۹')).toBe('123456789');
    expect(normalizeSupportDestination('-1001234567890')).toBe('-1001234567890');
    expect(normalizeSupportDestination('-۱۰۰۱۲۳۴۵۶۷۸۹۰')).toBe('-1001234567890');
    expect(normalizeSupportDestination('')).toBe('');
    expect(normalizeSupportDestination('@bad')).toBeUndefined();
    expect(normalizeSupportDestination('https://t.me/support_team')).toBeUndefined();
  });

  it('validates naming templates, packages_json, and https-only webapp URLs', () => {
    expect(validateAdminSetting('naming_prefix', ' Rebecca_2 ')).toBe('Rebecca_2');
    expect(validateAdminSetting('naming_prefix', ' \u200eRebecca_۲\u200f ')).toBe('Rebecca_2');
    expect(validateAdminSetting('naming_prefix', '_hidden')).toBeUndefined();
    expect(isValidNamingTemplate('{prefix}_{telegram_id}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('\u200e`{PREFIX}_{Telegram_Id}_{Random۴}`\u200f')).toBe(true);
    expect(
      validateAdminSetting(
        'custom_naming_template',
        '\u200e`{PREFIX}_{Telegram_Id}_{Random۴}`\u200f'
      )
    ).toBe('{prefix}_{telegram_id}_{random4}');
    expect(isValidNamingTemplate('{prefix}_{year}_{month}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('{prefix}_{yy}{month}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('{prefix}_{jyear}_{jmonth}_{day}_{counter}')).toBe(true);
    expect(
      isValidNamingTemplate('{prefix}_{jalali_year}_{jalali_month}_{jalali_day}_{counter}')
    ).toBe(true);
    expect(isValidNamingTemplate('{prefix}-{random4}.user')).toBe(true);
    expect(isValidNamingTemplate('{unknown}_{counter}')).toBe(false);
    expect(isValidNamingTemplate('{prefix}_{counter}!')).toBe(false);
    expect(isValidNamingTemplate('{}')).toBe(false);

    expect(validateNamingTemplateDetailed('')).toEqual({ valid: false, reason: 'empty' });
    expect(validateNamingTemplateDetailed('a'.repeat(81))).toEqual({
      valid: false,
      reason: 'too_long',
    });
    expect(validateNamingTemplateDetailed('سرویس_{counter}')).toEqual({
      valid: false,
      reason: 'invalid_chars',
    });
    expect(validateNamingTemplateDetailed('{prefix}_{userid}_{counter}')).toEqual({
      valid: false,
      reason: 'unknown_token',
      unknownToken: '{userid}',
    });
    expect(validateNamingTemplateDetailed('{prefix}_{counter')).toEqual({
      valid: false,
      reason: 'unbalanced_braces',
    });
    expect(validateNamingTemplateDetailed('___')).toEqual({
      valid: false,
      reason: 'no_content',
    });
    expect(validateNamingTemplateDetailed('VIP-{JYEAR}-{Random۴}')).toEqual({
      valid: true,
      normalized: 'VIP-{jyear}-{random4}',
    });

    // Interactive template builder pure operations
    expect(nextNamingSeparator('_')).toBe('-');
    expect(nextNamingSeparator('-')).toBe('.');
    expect(nextNamingSeparator('.')).toBe('');
    expect(nextNamingSeparator('')).toBe('_');

    expect(appendNamingToken('', '{prefix}', '_')).toEqual({
      template: '{prefix}',
      exceededMaxLength: false,
    });
    expect(appendNamingToken('{prefix}', '{jyear}', '-')).toEqual({
      template: '{prefix}-{jyear}',
      exceededMaxLength: false,
    });
    expect(appendNamingToken('{prefix}-{jyear}', '{jmonth}', '')).toEqual({
      template: '{prefix}-{jyear}{jmonth}',
      exceededMaxLength: false,
    });
    expect(appendNamingToken('a'.repeat(76), '{prefix}', '_')).toEqual({
      template: 'a'.repeat(76),
      exceededMaxLength: true,
    });

    expect(popLastNamingSegment('{prefix}_{telegram_id}_{random4}')).toBe('{prefix}_{telegram_id}');
    expect(popLastNamingSegment('{prefix}_{jyear}{jmonth}')).toBe('{prefix}_{jyear}');
    expect(popLastNamingSegment('vip-{jyear}-pro')).toBe('vip-{jyear}');
    expect(popLastNamingSegment('vip')).toBe('');
    expect(popLastNamingSegment('')).toBe('');

    expect(validateAdminSetting('packages_json', '[]')).toBeUndefined();
    expect(validateAdminSetting('packages_json', '{not json}')).toBeUndefined();
    expect(
      validateAdminSetting(
        'packages_json',
        JSON.stringify([
          { id: 'starter', name: 'Starter', gbAmount: 10, durationDays: 30, price: 50_000 },
        ])
      )
    ).toBe('[{"id":"starter","name":"Starter","gbAmount":10,"durationDays":30,"price":50000}]');

    expect(validateAdminSetting('webapp_url', 'https://app.example.com')).toBe(
      'https://app.example.com'
    );
    expect(validateAdminSetting('webapp_url', ' https://sub.domain.tld:8443 ')).toBe(
      'https://sub.domain.tld:8443'
    );
    expect(validateAdminSetting('webapp_url', 'http://insecure.com')).toBeUndefined();
    expect(validateAdminSetting('webapp_url', 'not-a-url')).toBeUndefined();
    expect(validateAdminSetting('webapp_url', 'ftp://example.com')).toBeUndefined();
  });

  it('registers backup settings in catalog, validates chat targets/intervals, and resolves defaults', () => {
    const group = getSettingGroup('backup');
    expect(group?.id).toBe('backup');
    expect(group?.settings).toEqual(
      expect.arrayContaining([
        'backup_enabled',
        'backup_interval_hours',
        'backup_target_chat_id',
        'backup_include_env',
      ])
    );
    expect(GENERAL_SETTING_GROUPS.some((g) => g.id === 'backup')).toBe(false);
    expect(getSettingDefinition('backup_enabled')?.editor.type).toBe('boolean');
    expect(getSettingDefinition('backup_interval_hours')?.editor.type).toBe('integer');
    expect(getSettingDefinition('backup_target_chat_id')?.editor.type).toBe('backup_target');
    expect(getSettingDefinition('backup_include_env')?.editor.type).toBe('boolean');

    expect(validateAdminSetting('backup_target_chat_id', '-1001234567890')).toBe('-1001234567890');
    expect(validateAdminSetting('backup_target_chat_id', '-123456789')).toBe('-123456789');
    expect(validateAdminSetting('backup_target_chat_id', '123456789')).toBe('123456789');
    expect(validateAdminSetting('backup_target_chat_id', '@backup_channel')).toBe(
      '@backup_channel'
    );
    expect(validateAdminSetting('backup_target_chat_id', 'backup_channel')).toBe('@backup_channel');
    expect(validateAdminSetting('backup_target_chat_id', '')).toBe('');
    expect(
      validateAdminSetting('backup_target_chat_id', 'invalid target with spaces')
    ).toBeUndefined();
    expect(validateAdminSetting('backup_target_chat_id', 'abc!')).toBeUndefined();

    expect(validateAdminSetting('backup_interval_hours', '1')).toBe('1');
    expect(validateAdminSetting('backup_interval_hours', '24')).toBe('24');
    expect(validateAdminSetting('backup_interval_hours', '720')).toBe('720');
    expect(validateAdminSetting('backup_interval_hours', '0')).toBeUndefined();
    expect(validateAdminSetting('backup_interval_hours', '1000')).toBeUndefined();
    expect(validateAdminSetting('backup_interval_hours', 'invalid')).toBeUndefined();
    expect(normalizeBackupTarget('-۱۰۰۱۲۳۴۵۶۷۸۹۰')).toBe('-1001234567890');

    const mockSettings = {
      getSetting: (key: string, fallback = '') =>
        ({
          backup_enabled: 'true',
          backup_interval_hours: '12',
          backup_target_chat_id: '-100999888',
          backup_include_env: 'false',
        })[key] ?? fallback,
    };
    expect(backupEnabled(mockSettings)).toBe(true);
    expect(backupIntervalHours(mockSettings)).toBe(12);
    expect(backupTargetChatId(mockSettings)).toBe('-100999888');
    expect(backupIncludeEnv(mockSettings)).toBe(false);
  });

  it('renders admin sales menu, callbacks, and non-duplicated package screen count', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => {
            const map: Record<string, string> = {
              admin_package_manager_title: 'بسته‌ها',
              admin_package_manager_subtitle: 'بسته‌های قابل فروش',
              admin_pkg_total_label: 'تعداد کل بسته‌ها',
              admin_pkg_manager_prompt: 'فهرست بسته‌های فعال و غیرفعال',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const screen = renderAdminSalesMenuScreen(ctx);
    expect(screen).toContain('admin_sales_title');
    expect(screen).toContain('admin_sales_subtitle');

    const callbacks = extractCallbackDataList(salesMenuKeyboard(ctx));
    expect(callbacks).toEqual(
      expect.arrayContaining([
        'admin:sales:packages',
        'admin:sales:custom_volume',
        'admin:sales:promo',
        'admin:sales:referral',
        'admin:sales:payment',
        'nav:admin',
      ])
    );

    const pkgScreen = buildPackageManagerScreen(
      ctx as unknown as ConversationContext,
      [starterPackage()],
      {
        totalCount: 1,
      }
    );
    expect(pkgScreen).toContain('بسته‌ها');
    expect(pkgScreen).toContain('تعداد کل بسته‌ها');
    expect(pkgScreen).toContain('فهرست بسته‌های فعال و غیرفعال');
    expect(pkgScreen).not.toContain('(۱ بسته)');
  });
});

describe('Admin settings, trial, naming, lucky wheel & payment conversations', () => {
  it('toggles trial_enabled and exits cleanly on trial:back', async () => {
    const harness = createSettingsHarness(
      { trial_enabled: 'true', trial_gb: '1', trial_days: '3' },
      [{ callback: 'trial:toggle' }, { callback: 'trial:back' }]
    );

    await adminTrialSettingsConversation(harness.conversation, harness.ctx);

    expect(harness.updateSetting).toHaveBeenCalledWith('trial_enabled', 'false');
    expect(harness.settings.get('trial_enabled')).toBe('false');
    expect(harness.remaining).toHaveLength(0);
  });

  it('manages naming mode, custom template, naming prefix, and replay-safe random preview refresh', async () => {
    const modeHarness = createSettingsHarness(
      {
        naming_mode: 'prefix_number',
        naming_prefix: 'rebecca',
        custom_naming_template: '{prefix}_{counter}',
      },
      [
        { callback: 'naming:mode' },
        { callback: 'nm-set:prefix_date_counter' },
        { callback: 'set-return:naming' },
        { callback: 'naming:refresh' },
        { callback: 'naming:back' },
      ]
    );
    await expect(manageNamingSettings(modeHarness.conversation, modeHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(modeHarness.updateSetting).toHaveBeenCalledWith('naming_mode', 'prefix_date_counter');
    expect(modeHarness.syncCounters).toHaveBeenCalled();
    expect(modeHarness.random).toHaveBeenCalledOnce();

    const templateHarness = createSettingsHarness(
      {
        naming_mode: 'prefix_number',
        naming_prefix: 'rebecca',
        custom_naming_template: '{prefix}_{counter}',
      },
      [
        { callback: 'naming:template' },
        { text: '{prefix}_{year}_{month}_{counter}' },
        { callback: 'set-return:naming' },
        { callback: 'naming:template' },
        { callback: 'tmpl:preset:prefix_tid_rand4' },
        { callback: 'set-return:naming' },
        { callback: 'naming:back' },
      ]
    );
    await adminNamingSettingsConversation(templateHarness.conversation, templateHarness.ctx);
    expect(templateHarness.updateSetting).toHaveBeenCalledWith(
      'custom_naming_template',
      '{prefix}_{year}_{month}_{counter}'
    );
    expect(templateHarness.updateSetting).toHaveBeenCalledWith(
      'custom_naming_template',
      '{prefix}_{telegram_id}_{random4}'
    );
    expect(templateHarness.updateSetting).toHaveBeenCalledWith('naming_mode', 'custom');

    const prefixHarness = createSettingsHarness(
      {
        naming_mode: 'custom',
        naming_prefix: 'rebecca',
        custom_naming_template: '{prefix}_{counter}',
      },
      [
        { callback: 'naming:prefix' },
        { text: 'vpn_node' },
        { callback: 'set-return:naming' },
        { callback: 'naming:back' },
      ]
    );
    await expect(manageNamingSettings(prefixHarness.conversation, prefixHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(prefixHarness.updateSetting).toHaveBeenCalledWith('naming_prefix', 'vpn_node');
  });

  it('navigates general settings, toggles support & system settings, and handles rollback/failure', async () => {
    const navHarness = createSettingsHarness(
      { support_enabled: 'true', support_destination: '@support' },
      [
        { callback: 'set-group:support' },
        { callback: 'set-edit:support_enabled' },
        { callback: 'set-groups' },
        { callback: 'conversation:cancel' },
      ]
    );
    await adminEditSettingsConversation(navHarness.conversation, navHarness.ctx);
    expect(navHarness.updateSetting).toHaveBeenCalledOnce();
    expect(navHarness.updateSetting).toHaveBeenCalledWith('support_enabled', 'false');
    expect(keyboardRenderCount(navHarness.reply, 'set-group:support')).toBe(2);
    expect(keyboardRenderCount(navHarness.reply, 'set-edit:support_enabled')).toBe(2);
    expect(navHarness.remaining).toHaveLength(0);

    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const rollbackHarness = createSettingsHarness(
        {
          naming_mode: 'custom',
          naming_prefix: 'rebecca',
          custom_naming_template: '{prefix}_{telegram_id}_{counter}',
        },
        [
          { callback: 'set-edit:naming_mode' },
          { callback: 'set-nm:prefix_number' },
          { callback: 'set-return:naming' },
          { callback: 'conversation:cancel' },
        ],
        { failNamingSync: true }
      );
      await adminEditSettingsConversation(
        rollbackHarness.conversation,
        rollbackHarness.ctx,
        'naming'
      );
      expect(rollbackHarness.updateSetting.mock.calls).toEqual([
        ['naming_mode', 'prefix_number'],
        ['naming_mode', 'custom'],
      ]);
      expect(rollbackHarness.settings.get('naming_mode')).toBe('custom');
      expect(replyTexts(rollbackHarness.reply)).toContainEqual(
        expect.stringContaining('admin_setting_apply_failed')
      );

      const failSaveHarness = createSettingsHarness(
        { trial_enabled: 'true', trial_gb: '1', trial_days: '1' },
        [
          { callback: 'set-edit:trial_days' },
          { text: '۳۰' },
          { callback: 'set-return:trial' },
          { callback: 'conversation:cancel' },
        ],
        { failSave: true }
      );
      await adminEditSettingsConversation(
        failSaveHarness.conversation,
        failSaveHarness.ctx,
        'trial'
      );
      expect(failSaveHarness.updateSetting).toHaveBeenCalledWith('trial_days', '30');
      expect(failSaveHarness.settings.get('trial_days')).toBe('1');
      expect(replyTexts(failSaveHarness.reply)).toContainEqual(
        expect.stringContaining('admin_setting_save_failed')
      );
    } finally {
      logSpy.mockRestore();
    }

    const sysHarness = createSettingsHarness(
      { bot_enabled: 'true', default_locale: 'fa', language_selection_enabled: 'true' },
      [
        { callback: 'set-group:system' },
        { callback: 'set-edit:bot_enabled' },
        { callback: 'set-edit:default_locale' },
        { callback: 'set-loc:en' },
        { callback: 'set-return:system' },
        { callback: 'set-groups' },
        { callback: 'conversation:cancel' },
      ]
    );
    await adminEditSettingsConversation(sysHarness.conversation, sysHarness.ctx);
    expect(sysHarness.updateSetting).toHaveBeenCalledWith('bot_enabled', 'false');
    expect(sysHarness.updateSetting).toHaveBeenCalledWith('default_locale', 'en');
    expect(sysHarness.remaining).toHaveLength(0);
  });

  it('handles lucky wheel cancel cleanly without rendering sales menu and keeps payment Markdown valid', async () => {
    const cancelWheel = createSettingsHarness({ lucky_wheel_enabled: 'true' }, [
      { callback: 'wheel_cfg:toggle' },
      { callback: 'conversation:cancel' },
    ]);
    await adminLuckyWheelSettingsConversation(cancelWheel.conversation, cancelWheel.ctx);
    expect(cancelWheel.updateSetting).toHaveBeenCalledWith('lucky_wheel_enabled', 'false');
    expect(replyTexts(cancelWheel.reply).some((text) => text.includes('admin_sales_title'))).toBe(
      false
    );

    const backWheel = createSettingsHarness({ lucky_wheel_enabled: 'false' }, [
      { callback: 'wheel_cfg:back' },
    ]);
    await adminLuckyWheelSettingsConversation(backWheel.conversation, backWheel.ctx);
    expect(replyTexts(backWheel.reply).some((text) => text.includes('admin_sales_title'))).toBe(
      true
    );

    const payHarness = createSettingsHarness(
      {
        card_number: '6037`991234567890',
        card_holder: 'Ali_R*`[Owner]',
        wallet_transfer_enabled: 'true',
      },
      [{ callback: 'conversation:cancel' }],
      { useRealTranslations: true }
    );
    await adminPaymentSettingsConversation(payHarness.conversation, payHarness.ctx);
    const renderedPayScreen = replyTexts(payHarness.reply)[0];
    expect(renderedPayScreen).toBeDefined();
    expect(validateTelegramMarkdown(renderedPayScreen!).valid).toBe(true);
  });

  it('renders localized WebApp settings without Beta labels and supports live preview and disable flow', async () => {
    const faHarness = createSettingsHarness(
      { webapp_enabled: 'true', webapp_url: 'https://app.example.com' },
      [],
      { useRealTranslations: true }
    );
    (faHarness.ctx as { userLocale: string }).userLocale = 'fa';
    (faHarness.ctx.from as { language_code?: string }).language_code = 'fa';

    const faScreen = buildWebAppSettingsScreen(faHarness.ctx, {
      enabled: true,
      webAppUrl: 'https://app.example.com',
      port: 3002,
      isRunning: true,
      serverIp: '85.17.142.160',
    });
    expect(validateTelegramMarkdown(faScreen).valid).toBe(true);
    expect(faScreen).toContain('در حال اجرا');
    expect(faScreen).not.toContain('Beta');
    expect(faScreen).not.toContain('بتا');
    expect(faScreen).not.toContain('Reverse Proxy Port');
    expect(faScreen).not.toContain('🟢 Running');

    const enHarness = createSettingsHarness(
      { webapp_enabled: 'true', webapp_url: 'https://app.example.com' },
      [],
      { useRealTranslations: true }
    );
    const enScreen = buildWebAppSettingsScreen(enHarness.ctx, {
      enabled: true,
      webAppUrl: 'https://app.example.com',
      port: 3002,
      isRunning: false,
      serverIp: '',
    });
    expect(validateTelegramMarkdown(enScreen).valid).toBe(true);
    expect(enScreen).toContain('⚪ Stopped');

    const activeKb = buildWebAppSettingsKeyboard(faHarness.ctx, {
      enabled: true,
      webAppUrl: 'https://app.example.com',
    });
    const flatButtons = activeKb.inline_keyboard.flat() as Array<{
      text: string;
      callback_data?: string;
      web_app?: { url: string };
    }>;
    expect(flatButtons[0]?.web_app?.url).toBe('https://app.example.com');
    expect(flatButtons.some((b) => b.callback_data === 'webapp:check:dns')).toBe(true);

    const inactiveKb = buildWebAppSettingsKeyboard(faHarness.ctx, {
      enabled: false,
      webAppUrl: '',
    });
    expect(inactiveKb.inline_keyboard.flat().some((b) => 'web_app' in b)).toBe(false);

    const disableWebApp = vi.fn(async () => {});
    const flowHarness = createSettingsHarness(
      { webapp_enabled: 'true', webapp_url: 'https://app.example.com' },
      [{ callback: 'webapp:toggle:enabled' }, { callback: 'conversation:cancel' }],
      { useRealTranslations: true }
    );
    (flowHarness.ctx.services as Record<string, unknown>).webAppUrl = 'https://app.example.com';
    (flowHarness.ctx.services as Record<string, unknown>).disableWebApp = disableWebApp;
    (flowHarness.ctx.services as Record<string, unknown>).isWebAppRunning = () => true;

    await adminWebAppSettingsConversation(flowHarness.conversation, flowHarness.ctx);
    expect(disableWebApp).toHaveBeenCalledOnce();
    expect(
      replyTexts(flowHarness.reply).some((msg) => msg.includes('Mini App has been disabled'))
    ).toBe(true);
  });
});
