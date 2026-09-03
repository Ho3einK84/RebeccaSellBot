import { describe, expect, it, vi } from 'vitest';
import {
  adminNamingSettingsConversation,
  manageNamingSettings,
} from '../../src/telegram/conversations/adminConversations.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';

describe('admin naming settings center', () => {
  function createHarness(
    initialSettings: Record<string, string>,
    script: Array<{ callback: string } | { text: string }>
  ) {
    const settings = new Map(Object.entries(initialSettings));
    const reply = vi.fn(async () => ({ message_id: 201 }));
    const updateSetting = vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    });
    const syncCounters = vi.fn(async () => undefined);

    const translationService = {
      get: vi.fn((key: string) => key),
      getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
      getSettingBool: vi.fn((key: string, fallback = false) => {
        const val = settings.get(key);
        return val ? val === 'true' : fallback;
      }),
      updateSetting,
    };

    const configService = {
      syncCounters,
    };

    const ctx = {
      from: { id: 1 },
      session: {},
      services: {
        translationService,
        configService,
        isAdmin: vi.fn(() => true),
      },
      reply,
    } as unknown as ConversationContext;

    const remaining = [...script];
    const conversation = {
      external: vi.fn(async (fn: (c: ConversationContext) => Promise<unknown>) => fn(ctx)),
      wait: vi.fn(async () => {
        const next = remaining.shift();
        if (!next) throw new Error('TEST_INPUT_EXHAUSTED');
        if ('callback' in next) {
          return {
            ...ctx,
            callbackQuery: { data: next.callback, message: { message_id: 201 } },
            answerCallbackQuery: vi.fn(async () => undefined),
          } as unknown as ConversationContext;
        }
        return {
          ...ctx,
          message: { text: next.text },
        } as ConversationContext;
      }),
    } as unknown as MyConversation;

    return { ctx, conversation, settings, updateSetting, syncCounters, reply, remaining };
  }

  it('selects new naming mode and syncs counters', async () => {
    const harness = createHarness(
      {
        naming_mode: 'prefix_number',
        naming_prefix: 'rebecca',
        custom_naming_template: '{prefix}_{counter}',
      },
      [
        { callback: 'naming:mode' },
        { callback: 'nm-set:prefix_date_counter' },
        { callback: 'set-return:naming' },
        { callback: 'naming:back' },
      ]
    );

    const outcome = await manageNamingSettings(harness.conversation, harness.ctx);

    expect(outcome).toBe('back');
    expect(harness.updateSetting).toHaveBeenCalledWith('naming_mode', 'prefix_date_counter');
    expect(harness.settings.get('naming_mode')).toBe('prefix_date_counter');
    expect(harness.syncCounters).toHaveBeenCalled();
  });

  it('allows editing custom template via preset buttons', async () => {
    const harness = createHarness(
      {
        naming_mode: 'prefix_number',
        naming_prefix: 'rebecca',
        custom_naming_template: '{prefix}_{counter}',
      },
      [
        { callback: 'naming:template' },
        { callback: 'tmpl-preset:p3' }, // preset: {prefix}_{date}_{counter}
        { callback: 'set-return:naming' },
        { callback: 'set-return:naming' },
        { callback: 'naming:back' },
      ]
    );

    await adminNamingSettingsConversation(harness.conversation, harness.ctx);

    expect(harness.updateSetting).toHaveBeenCalledWith(
      'custom_naming_template',
      '{prefix}_{date}_{counter}'
    );
    expect(harness.updateSetting).toHaveBeenCalledWith('naming_mode', 'custom');
  });

  it('allows updating naming prefix with valid value', async () => {
    const harness = createHarness(
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

    const outcome = await manageNamingSettings(harness.conversation, harness.ctx);

    expect(outcome).toBe('back');
    expect(harness.updateSetting).toHaveBeenCalledWith('naming_prefix', 'vpn_node');
    expect(harness.settings.get('naming_prefix')).toBe('vpn_node');
  });
});
