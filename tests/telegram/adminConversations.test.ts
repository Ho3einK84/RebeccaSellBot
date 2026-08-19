import { describe, expect, it, vi } from 'vitest';
import {
  buildCategoryKeyboard,
  buildSelectionKeyboard,
  buildSettingsGroupKeyboard,
  SETTING_GROUPS,
  TEXT_CATEGORIES,
} from '../../src/telegram/conversations/adminConversations.js';
import type { ConversationContext } from '../../src/telegram/types.js';

describe('admin category and settings group keyboards', () => {
  const fakeCtx = {
    services: {
      translationService: {
        get: vi.fn((key: string) => key),
      },
    },
  } as unknown as ConversationContext;

  it('buildSelectionKeyboard creates formatted grid with custom prefix and cancel button', () => {
    const testItems = [
      { id: 'opt1', labelKey: 'lbl_opt1' },
      { id: 'opt2', labelKey: 'lbl_opt2' },
    ];
    const keyboard = buildSelectionKeyboard(fakeCtx, testItems, 'custom-prefix', 'custom_cancel');
    const buttons = keyboard.inline_keyboard.flat();

    expect(buttons.length).toBe(3);
    expect(buttons[0]?.text).toBe('lbl_opt1');
    expect(buttons[0]?.callback_data).toBe('custom-prefix:opt1');
    expect(buttons[1]?.text).toBe('lbl_opt2');
    expect(buttons[1]?.callback_data).toBe('custom-prefix:opt2');
    expect(buttons[2]?.text).toBe('custom_cancel');
    expect(buttons[2]?.callback_data).toBe('conversation:cancel');
  });

  it('buildSettingsGroupKeyboard builds buttons for SETTING_GROUPS plus back to main', () => {
    const keyboard = buildSettingsGroupKeyboard(fakeCtx, SETTING_GROUPS);
    const buttons = keyboard.inline_keyboard.flat();

    expect(SETTING_GROUPS.length).toBeGreaterThan(0);
    expect(buttons.length).toBe(SETTING_GROUPS.length + 1);

    for (const group of SETTING_GROUPS) {
      expect(group.descriptionKey).toBeDefined();
      const match = buttons.find((btn) => btn.callback_data === `set-group:${group.id}`);
      expect(match).toBeDefined();
      expect(match?.text).toBe(group.labelKey);
    }

    const backBtn = buttons.find((btn) => btn.callback_data === 'nav:admin');
    expect(backBtn).toBeDefined();
    expect(backBtn?.text).toBe('admin_menu_back_to_admin');
  });

  it('buildCategoryKeyboard builds one button per TEXT_CATEGORIES entry plus cancel', () => {
    const keyboard = buildCategoryKeyboard(fakeCtx);
    const buttons = keyboard.inline_keyboard.flat();

    expect(TEXT_CATEGORIES.length).toBeGreaterThan(0);
    expect(buttons.length).toBe(TEXT_CATEGORIES.length + 1);

    for (const category of TEXT_CATEGORIES) {
      expect(category.descriptionKey).toBeDefined();
      const match = buttons.find((btn) => btn.callback_data === `text-cat:${category.id}`);
      expect(match).toBeDefined();
      expect(match?.text).toBe(category.labelKey);
    }

    const cancelBtn = buttons.find((btn) => btn.callback_data === 'conversation:cancel');
    expect(cancelBtn).toBeDefined();
    expect(cancelBtn?.text).toBe('menu_cancel');
  });
});
