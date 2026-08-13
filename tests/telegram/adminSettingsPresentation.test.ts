import { describe, expect, it, vi } from 'vitest';
import {
  buildBooleanSettingKeyboard,
  buildCustomNamingTemplatePrompt,
  buildSettingsGroupPrompt,
  displayAdminSettingValue,
} from '../../src/telegram/conversations/adminConversations.js';
import type { ConversationContext } from '../../src/telegram/types.js';

function createContext(settings: Record<string, string>): ConversationContext {
  const translationService = {
    getSetting: vi.fn((key: string, fallback = '') => settings[key] ?? fallback),
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

describe('admin settings presentation', () => {
  it('renders naming and toggle values as localized, human-readable labels', () => {
    const ctx = createContext({
      naming_mode: 'custom',
      trial_enabled: 'true',
      custom_volume_enabled: 'false',
    });

    expect(displayAdminSettingValue(ctx, 'naming_mode')).toBe('قالب سفارشی');
    expect(displayAdminSettingValue(ctx, 'trial_enabled')).toBe('🟢 فعال');
    expect(displayAdminSettingValue(ctx, 'custom_volume_enabled')).toBe('🔴 غیرفعال');
  });

  it('renders literal naming tokens and examples without unresolved placeholders or em dashes', () => {
    const ctx = createContext({
      naming_prefix: 'h',
      custom_naming_template: 'h_{telegram_id}_{counter}',
    });

    const prompt = buildCustomNamingTemplatePrompt(ctx);

    expect(prompt).toContain('`h_{telegram_id}_{counter}`');
    expect(prompt).toContain('`{prefix}` (h)');
    expect(prompt).toContain('`{telegram_id}`');
    expect(prompt).toContain('`{counter}`');
    expect(prompt).toContain('`{random4}`');
    expect(prompt).toContain('`{prefix}_{telegram_id}_{counter}`');
    expect(prompt).not.toContain('—');
    expect(prompt).not.toContain('{code_');
  });

  it('escapes editable setting values before placing them in Markdown code spans', () => {
    const ctx = createContext({ card_holder: 'Name`_*[' });

    const prompt = buildSettingsGroupPrompt(ctx, 'payment');

    expect(prompt).toContain('Name\\`_*[');
    expect(prompt).not.toContain('`Name`_*[`');
  });

  it('builds a compact toggle keyboard with active-state indication and back navigation', () => {
    const ctx = createContext({ custom_volume_enabled: 'true' });

    const keyboard = buildBooleanSettingKeyboard(ctx, 'custom_volume_enabled', 'set-bool:');
    const buttons = keyboard.inline_keyboard.flat();

    expect(buttons.map((button) => button.callback_data)).toEqual([
      'set-bool:true',
      'set-bool:false',
      'set-bool:back',
      'conversation:cancel',
    ]);
    expect(buttons[0]?.text).toContain('✅');
    expect(buttons[1]?.text).not.toContain('✅');
  });

  it('builds a concise settings card with readable names and values', () => {
    const ctx = createContext({
      naming_mode: 'custom',
      naming_prefix: 'h',
      custom_naming_template: 'h_{telegram_id}_{counter}',
    });

    const prompt = buildSettingsGroupPrompt(ctx, 'naming');

    expect(prompt).toContain('🎯 روش نامگذاری: `قالب سفارشی`');
    expect(prompt).toContain('🔤 پیشوند نام: `h`');
    expect(prompt).toContain('🧩 قالب سفارشی: `h_{telegram_id}_{counter}`');
    expect(prompt).not.toContain('custom\n');
    expect(prompt).not.toContain('—_{telegram_id}_—');
  });
});
