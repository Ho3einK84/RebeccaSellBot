import { describe, expect, it, vi } from 'vitest';
import { adminEditTextsConversation } from '../../src/telegram/conversations/adminConversations/texts.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';

type ScriptedInput = { callback: string } | { text: string };

function createTextsHarness(
  initialSettings: Record<string, string>,
  script: ScriptedInput[],
  options: {
    isAdmin?: boolean;
    failSave?: boolean;
    failDelete?: boolean;
  } = {}
) {
  const settings = new Map(Object.entries(initialSettings));
  let messageId = 100;
  const reply = vi.fn(async () => ({ message_id: messageId++ }));
  const updateSetting = vi.fn(async (key: string, value: string) => {
    if (options.failSave) throw new Error('DB_WRITE_FAILED');
    settings.set(key, value);
  });
  const deleteSetting = vi.fn(async (key: string) => {
    if (options.failDelete) throw new Error('DB_DELETE_FAILED');
    settings.delete(key);
  });

  const translationService = {
    get: vi.fn((key: string, _locale?: string, params?: Record<string, string | number>) => {
      let rendered = key;
      for (const [name, value] of Object.entries(params ?? {})) {
        rendered += ` ${name}=${String(value)}`;
      }
      return rendered;
    }),
    getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
    getStoredSetting: vi.fn((key: string) => settings.get(key)),
    getTranslationKeys: vi.fn(() => ['welcome', 'shop', 'onboarding_welcome', 'home_title']),
    hasTranslationKey: vi.fn((k: string) =>
      ['welcome', 'shop', 'onboarding_welcome', 'home_title'].includes(k)
    ),
    getCustomizedKeys: vi.fn((locale?: string) => {
      const targetLocale = locale ?? 'fa';
      const keys: string[] = [];
      for (const k of settings.keys()) {
        if (k.startsWith(`${targetLocale}.`)) keys.push(k.slice(3));
      }
      return keys;
    }),
    searchTranslations: vi.fn((query: string) => {
      return ['welcome', 'shop'].filter((k) => k.includes(query.toLowerCase()));
    }),
    resolveLocale: vi.fn(() => 'fa'),
    getDefaultLocale: vi.fn(() => 'fa'),
    updateSetting,
    deleteSetting,
  };

  const adminService = {
    isAdmin: vi.fn(async () => options.isAdmin ?? true),
  };

  const stepCount = { value: 0 };
  const conversation = {
    external: vi.fn(async (operation: (outsideCtx: unknown) => unknown) =>
      operation(ctx as unknown)
    ),
    wait: vi.fn(async () => {
      const next = script[stepCount.value++];
      const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
      if (!next) {
        return {
          ...ctx,
          callbackQuery: { data: 'conversation:cancel' },
          answerCallbackQuery,
          from: { id: 1001, first_name: 'Admin', language_code: 'fa' },
        };
      }
      if ('callback' in next) {
        return {
          ...ctx,
          callbackQuery: { data: next.callback },
          answerCallbackQuery,
          from: { id: 1001, first_name: 'Admin', language_code: 'fa' },
        };
      }
      return {
        ...ctx,
        message: { text: next.text, message_id: messageId++, date: Date.now() },
        answerCallbackQuery,
        from: { id: 1001, first_name: 'Admin', language_code: 'fa' },
      };
    }),
    halt: vi.fn(async () => undefined),
  };

  const ctx = {
    from: { id: 1001, first_name: 'Admin', language_code: 'fa' },
    chat: { id: 1001 },
    session: {},
    reply,
    services: {
      translationService,
      adminService,
      isAdmin: vi.fn(() => options.isAdmin ?? true),
    },
  };

  return { conversation, ctx, translationService, reply, updateSetting, deleteSetting };
}

describe('adminEditTextsConversation', () => {
  it('rejects non-admin users immediately', async () => {
    const harness = createTextsHarness({}, [], { isAdmin: false });
    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.reply).toHaveBeenCalledWith(
      expect.stringContaining('access_denied'),
      expect.anything()
    );
  });

  it('navigates to Essential Texts mode and opens a key detail', async () => {
    const harness = createTextsHarness({}, [
      { callback: 'text-mode:essential' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.reply).toHaveBeenCalled();
  });

  it('switches active language between Persian and English', async () => {
    const harness = createTextsHarness({}, [
      { callback: 'text-lang:toggle' },
      { callback: 'text-mode:essential' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.reply).toHaveBeenCalled();
  });

  it('edits a text key and saves the override to the database', async () => {
    const harness = createTextsHarness({}, [
      { callback: 'text-mode:essential' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-act:edit' },
      { text: 'سلام و درود به ربات ما خوش آمدید!' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.updateSetting).toHaveBeenCalledWith(
      'fa.welcome',
      'سلام و درود به ربات ما خوش آمدید!'
    );
  });

  it('resets a customized text key to default upon confirmation', async () => {
    const harness = createTextsHarness({ 'fa.welcome': 'متن اختصاصی' }, [
      { callback: 'text-mode:customized' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-act:reset' },
      { callback: 'text-act:reset_confirm' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.deleteSetting).toHaveBeenCalledWith('fa.welcome');
  });

  it('navigates through categories in advanced mode', async () => {
    const harness = createTextsHarness({}, [
      { callback: 'text-mode:advanced' },
      { callback: 'text-cat:user_home' },
      { callback: 'text-nav:categories' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.reply).toHaveBeenCalled();
  });

  it('performs global search and opens key from search results', async () => {
    const harness = createTextsHarness({}, [
      { callback: 'text-mode:search' },
      { text: 'shop' },
      { callback: 'text-pk:shop' },
      { callback: 'text-act:preview' },
      { callback: 'text-nav:detail' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);

    await adminEditTextsConversation(harness.conversation as any, harness.ctx as any);
    expect(harness.translationService.searchTranslations).toHaveBeenCalledWith('shop', 'fa');
  });
});
