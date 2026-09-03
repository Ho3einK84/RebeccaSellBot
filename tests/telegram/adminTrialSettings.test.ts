import { describe, expect, it, vi } from 'vitest';
import { adminTrialSettingsConversation } from '../../src/telegram/conversations/adminConversations.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';

describe('admin trial settings conversation', () => {
  function createHarness(
    initialSettings: Record<string, string>,
    script: Array<{ callback: string } | { text: string }>
  ) {
    const settings = new Map(Object.entries(initialSettings));
    const reply = vi.fn(async () => ({ message_id: 101 }));
    const updateSetting = vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    });

    const translationService = {
      get: vi.fn((key: string) => key),
      getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
      getSettingBool: vi.fn((key: string, fallback = false) => {
        const val = settings.get(key);
        return val ? val === 'true' : fallback;
      }),
      getSettingNum: vi.fn((key: string, fallback = 0) => {
        const val = settings.get(key);
        return val ? Number(val) : fallback;
      }),
      updateSetting,
    };

    const ctx = {
      from: { id: 1 },
      session: {},
      services: {
        translationService,
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
            callbackQuery: { data: next.callback, message: { message_id: 101 } },
            answerCallbackQuery: vi.fn(async () => undefined),
          } as unknown as ConversationContext;
        }
        return {
          ...ctx,
          message: { text: next.text },
        } as ConversationContext;
      }),
    } as unknown as MyConversation;

    return { ctx, conversation, settings, updateSetting, reply, remaining };
  }

  it('toggles trial_enabled on trial:toggle and exits cleanly on trial:back', async () => {
    const harness = createHarness({ trial_enabled: 'true', trial_gb: '1', trial_days: '3' }, [
      { callback: 'trial:toggle' },
      { callback: 'trial:back' },
    ]);

    await adminTrialSettingsConversation(harness.conversation, harness.ctx);

    expect(harness.updateSetting).toHaveBeenCalledWith('trial_enabled', 'false');
    expect(harness.settings.get('trial_enabled')).toBe('false');
    expect(harness.remaining).toHaveLength(0);
  });
});
