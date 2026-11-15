import { describe, expect, it, vi } from 'vitest';
import { MAX_PACKAGE_COUNT, type PackageOption } from '../../src/domain/services/PricingService.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { logger } from '../../src/infra/logger.js';
import {
  buildCategoryKeyboard,
  buildPackageManagerKeyboard,
  buildSettingsGroupKeyboard,
  buildSettingsInGroupKeyboard,
  generatePackageId,
  getSettingGroup,
  managePackages,
  SETTING_GROUPS,
  TEXT_CATEGORIES,
} from '../../src/telegram/conversations/adminConversations.js';
import {
  adminEditTextsConversation,
  ESSENTIAL_USER_TEXTS,
} from '../../src/telegram/conversations/adminConversations/texts.js';
import type { ConversationContext, MyConversation, SessionData } from '../../src/telegram/types.js';
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

function createPackageHarness(
  initialSettings: Record<string, string>,
  script: ScriptedInput[],
  options: { packages?: PackageOption[] } = {}
) {
  const settings = new Map(Object.entries(initialSettings));
  const session: SessionData = {};
  let messageId = 100;
  const reply = vi.fn(async () => ({ message_id: messageId++ }));
  const updateSetting = vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  });
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
  const translationService = {
    get: vi.fn((key: string, _locale?: string, params?: Record<string, string | number>) => {
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
    configService: { syncCounters: vi.fn().mockResolvedValue(undefined) },
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
  const conversation = {
    external: vi.fn(async (operation: (outsideCtx: unknown) => unknown) =>
      operation(ctx as unknown)
    ),
    wait: vi.fn(async () => {
      const next = remaining.shift();
      if (!next) throw new Error('TEST_INPUT_SCRIPT_EXHAUSTED');
      return {
        ...ctx,
        ...('callback' in next
          ? { callbackQuery: { data: next.callback }, answerCallbackQuery }
          : { message: { text: next.text } }),
      };
    }),
    halt: vi.fn(async () => {
      throw new Error('UNEXPECTED_NAVIGATION_HALT');
    }),
  } as unknown as MyConversation;

  return {
    conversation,
    ctx,
    remaining,
    reply,
    settings,
    updateSetting,
  };
}

function createTextsHarness(
  initialSettings: Record<string, string>,
  script: ScriptedInput[],
  options: {
    isAdmin?: boolean;
    failSave?: boolean;
    failDelete?: boolean;
    extraKeys?: string[];
  } = {}
) {
  const settings = new Map(Object.entries(initialSettings));
  const knownKeys = [
    'welcome',
    'shop',
    'onboarding_welcome',
    'home_title',
    ...(options.extraKeys ?? []),
  ];
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
    getTranslationKeys: vi.fn(() => knownKeys),
    hasTranslationKey: vi.fn((k: string) => knownKeys.includes(k)),
    getCustomizedKeys: vi.fn((locale?: string) => {
      const targetLocale = locale ?? 'fa';
      const keys: string[] = [];
      for (const k of settings.keys()) {
        if (k.startsWith(`${targetLocale}.`)) keys.push(k.slice(3));
      }
      return keys;
    }),
    searchTranslations: vi.fn((query: string) => {
      const q = query.toLowerCase();
      return knownKeys.filter((k) => k.toLowerCase().includes(q));
    }),
    resolveLocale: vi.fn(() => 'fa'),
    getDefaultLocale: vi.fn(() => 'fa'),
    updateSetting,
    deleteSetting,
  };

  const adminService = {
    isAdmin: vi.fn(async () => options.isAdmin ?? true),
  };

  let stepCount = 0;
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
  } as unknown as ConversationContext;

  const conversation = {
    external: vi.fn(async (operation: (outsideCtx: unknown) => unknown) =>
      operation(ctx as unknown)
    ),
    wait: vi.fn(async () => {
      const next = script[stepCount++];
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
  } as unknown as MyConversation;

  return { conversation, ctx, translationService, reply, updateSetting, deleteSetting };
}

function replyTexts(reply: ReturnType<typeof vi.fn>): string[] {
  return reply.mock.calls.map((call) => String(call[0]));
}

describe('Admin package manager & policy editor', () => {
  it('persists one validated package edit, canonicalizes Persian digits, and aborts partial Back or forged panel targets', async () => {
    const packages = [starterPackage()];
    const addHarness = createPackageHarness(
      { packages_json: JSON.stringify(packages) },
      [
        { callback: 'pkg-add' },
        { text: 'Professional' },
        { text: '۵۰' },
        { text: '۳۰' },
        { text: '۱۲۰٬۰۰۰' },
        { callback: 'pkg-target:rp_primary:2' },
        { callback: 'pkg-back' },
      ],
      { packages }
    );
    await expect(managePackages(addHarness.conversation, addHarness.ctx)).resolves.toBe('back');
    expect(addHarness.updateSetting).toHaveBeenCalledOnce();
    const persisted = JSON.parse(addHarness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({
      id: 'pkg_professional',
      name: 'Professional',
      gbAmount: 50,
      durationDays: 30,
      price: 120_000,
      panelId: 'rp_primary',
      serviceId: 2,
    });

    const partialHarness = createPackageHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: 'pkg-add' }, { callback: 'pkg-field-back' }, { callback: 'pkg-back' }],
      { packages }
    );
    await expect(managePackages(partialHarness.conversation, partialHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(partialHarness.updateSetting).not.toHaveBeenCalled();

    const forgedHarness = createPackageHarness(
      { packages_json: JSON.stringify(packages) },
      [
        { callback: 'pkg-add' },
        { text: 'Stale target' },
        { text: '10' },
        { text: '30' },
        { text: '50000' },
        { callback: 'pkg-target:missing_panel:2' },
        { callback: 'pkg-back' },
      ],
      { packages }
    );
    await expect(managePackages(forgedHarness.conversation, forgedHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(forgedHarness.updateSetting).not.toHaveBeenCalled();
  });

  it('supports sequential toggle/reorder/clone and enforces MAX_PACKAGE_COUNT pagination limit', async () => {
    const pair = [
      starterPackage(),
      { ...starterPackage(), id: 'second', name: 'Second package', gbAmount: 20 },
    ];
    const seqHarness = createPackageHarness(
      { packages_json: JSON.stringify(pair) },
      [
        { callback: 'pkg-toggle:starter' },
        { callback: 'pkg-down:starter' },
        { callback: 'pkg-toggle:starter' },
        { callback: 'pkg-back' },
      ],
      { packages: pair }
    );
    await expect(managePackages(seqHarness.conversation, seqHarness.ctx)).resolves.toBe('back');
    expect(seqHarness.updateSetting).toHaveBeenCalledTimes(3);
    const reordered = JSON.parse(seqHarness.updateSetting.mock.calls[2]![1]!) as PackageOption[];
    expect(reordered.map((pkg) => pkg.id)).toEqual(['second', 'starter']);
    expect(reordered[1]?.enabled).toBe(true);

    const previewHarness = createPackageHarness({}, []);
    const toggleCb = extractCallbackDataList(
      buildPackageManagerKeyboard(previewHarness.ctx, [starterPackage()])
    ).find((c) => c.startsWith('pkg-toggle:'))!;
    const toggleHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [{ callback: toggleCb }, { callback: 'pkg-back' }],
      { packages: [starterPackage()] }
    );
    await expect(managePackages(toggleHarness.conversation, toggleHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(JSON.parse(toggleHarness.updateSetting.mock.calls[0]![1]!)[0]?.enabled).toBe(false);

    const cloneCb = extractCallbackDataList(
      buildPackageManagerKeyboard(previewHarness.ctx, [starterPackage()])
    ).find((c) => c.startsWith('pkg-clone:'))!;
    const cloneHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [{ callback: cloneCb }, { callback: 'pkg-back' }],
      { packages: [starterPackage()] }
    );
    await expect(managePackages(cloneHarness.conversation, cloneHarness.ctx)).resolves.toBe('back');
    const cloned = JSON.parse(cloneHarness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
    expect(cloned).toHaveLength(2);
    expect(cloned[1]?.name).toContain('admin_pkg_copy_suffix');
    expect(cloned[1]?.id).toBe('pkg_starter_admin_pkg_copy_suffix');
    expect(cloned[1]?.gbAmount).toBe(10);
    expect(cloned[1]?.durationDays).toBe(30);
    expect(cloned[1]?.price).toBe(50_000);

    const fullCatalog = Array.from({ length: MAX_PACKAGE_COUNT }, (_, index) => ({
      ...starterPackage(),
      id: `pkg_${index}`,
      name: `Package ${index}`,
    }));
    const limitHarness = createPackageHarness(
      { packages_json: JSON.stringify(fullCatalog) },
      [{ callback: 'pkg-add' }, { callback: 'pkg-back' }],
      { packages: fullCatalog }
    );
    const firstPageCbs = extractCallbackDataList(
      buildPackageManagerKeyboard(limitHarness.ctx, fullCatalog)
    );
    expect(firstPageCbs.filter((d) => d.startsWith('pkg-edit:'))).toHaveLength(8);
    expect(firstPageCbs).toContain('pkg-page:1');

    await expect(managePackages(limitHarness.conversation, limitHarness.ctx)).resolves.toBe('back');
    expect(limitHarness.updateSetting).not.toHaveBeenCalled();
    expect(replyTexts(limitHarness.reply)).toContainEqual(
      expect.stringContaining('admin_pkg_limit_reached')
    );
  });

  it('edits package policies and enforces unique IDs and 64-byte Telegram callback limits', async () => {
    const packages = [starterPackage()];
    const policyHarness = createPackageHarness(
      {
        packages_json: JSON.stringify(packages),
        package_display_mode: 'specs',
        low_traffic_threshold_gb: '2',
        expiry_warning_days: '3',
        refund_window_hours: '0',
      },
      [
        { callback: 'pkg-settings' },
        { callback: 'pp:toggle:mode' },
        { callback: 'pp:edit:low_traffic_threshold_gb' },
        { text: '۵' },
        { callback: 'set-return:pricing' },
        { callback: 'pp:back' },
        { callback: 'pkg-back' },
      ],
      { packages }
    );
    await expect(managePackages(policyHarness.conversation, policyHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(policyHarness.updateSetting).toHaveBeenCalledWith('package_display_mode', 'name');
    expect(policyHarness.updateSetting).toHaveBeenCalledWith('low_traffic_threshold_gb', '5');
    expect(policyHarness.settings.get('package_display_mode')).toBe('name');
    expect(policyHarness.settings.get('low_traffic_threshold_gb')).toBe('5');
    expect(policyHarness.remaining).toHaveLength(0);

    const longPackages = Array.from({ length: MAX_PACKAGE_COUNT }, (_, index) => ({
      ...starterPackage(),
      id: index === 0 ? 'pkg_very_long_package_name' : `pkg_${index}`,
      name: `${'Very long package name '.repeat(8)}${index}`,
    }));
    expect(generatePackageId('Very long package name', longPackages)).toBe(
      'pkg_very_long_package_name_2'
    );
    expect(generatePackageId('طرح ویژه', longPackages)).toBe('pkg_package');

    const keyboards = [
      buildSettingsGroupKeyboard(policyHarness.ctx),
      ...SETTING_GROUPS.map((group) => buildSettingsInGroupKeyboard(policyHarness.ctx, group)),
      buildPackageManagerKeyboard(policyHarness.ctx, longPackages),
    ];
    for (const button of keyboards.flatMap((keyboard) => keyboard.inline_keyboard.flat())) {
      expect(Buffer.byteLength(button.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64);
      expect([...button.text].length).toBeLessThanOrEqual(60);
    }
    expect(getSettingGroup('pricing')?.settings).toContain('packages_json');
  });
});

describe('Admin text editor & translation catalog coverage', () => {
  it('builds category keyboard and blocks non-admin users immediately', async () => {
    const fakeCtx = createTextsHarness({}, []).ctx;
    const keyboard = buildCategoryKeyboard(fakeCtx);
    const buttons = keyboard.inline_keyboard.flat();
    expect(TEXT_CATEGORIES.length).toBeGreaterThan(0);
    expect(buttons).toHaveLength(TEXT_CATEGORIES.length + 1);
    for (const category of TEXT_CATEGORIES) {
      expect(category.descriptionKey).toBeDefined();
      const match = buttons.find((btn) => btn.callback_data === `text-cat:${category.id}`);
      expect(match?.text).toBe(category.labelKey);
    }
    expect(buttons.find((btn) => btn.callback_data === 'text-nav:mode_select')?.text).toBe(
      'admin_text_back_to_menu'
    );

    const nonAdmin = createTextsHarness({}, [], { isAdmin: false });
    await adminEditTextsConversation(nonAdmin.conversation, nonAdmin.ctx);
    expect(nonAdmin.reply).toHaveBeenCalledWith(
      expect.stringContaining('access_denied'),
      expect.anything()
    );
  });

  it('supports essential, language switch, edit, reset, category, search & direct-edit flows', async () => {
    const essential = createTextsHarness({}, [
      { callback: 'text-mode:essential' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(essential.conversation, essential.ctx);
    expect(essential.reply).toHaveBeenCalled();

    const langSwitch = createTextsHarness({}, [
      { callback: 'text-lang:toggle' },
      { callback: 'text-mode:essential' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(langSwitch.conversation, langSwitch.ctx);
    expect(langSwitch.reply).toHaveBeenCalled();

    const editHarness = createTextsHarness({}, [
      { callback: 'text-mode:essential' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-act:edit' },
      { text: 'سلام و درود به ربات ما خوش آمدید!' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(editHarness.conversation, editHarness.ctx);
    expect(editHarness.updateSetting).toHaveBeenCalledWith(
      'fa.welcome',
      'سلام و درود به ربات ما خوش آمدید!'
    );

    const resetHarness = createTextsHarness({ 'fa.welcome': 'متن اختصاصی' }, [
      { callback: 'text-mode:customized' },
      { callback: 'text-pk:welcome' },
      { callback: 'text-act:reset' },
      { callback: 'text-act:reset_confirm' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(resetHarness.conversation, resetHarness.ctx);
    expect(resetHarness.deleteSetting).toHaveBeenCalledWith('fa.welcome');

    const catHarness = createTextsHarness({}, [
      { callback: 'text-mode:advanced' },
      { callback: 'text-cat:user_home' },
      { callback: 'text-nav:categories' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(catHarness.conversation, catHarness.ctx);
    expect(catHarness.reply).toHaveBeenCalled();

    const searchHarness = createTextsHarness({}, [
      { callback: 'text-mode:search' },
      { text: 'shop' },
      { callback: 'text-pk:shop' },
      { callback: 'text-act:preview' },
      { callback: 'text-nav:detail' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(searchHarness.conversation, searchHarness.ctx);
    expect(searchHarness.translationService.searchTranslations).toHaveBeenCalledWith('shop', 'fa');

    const incatHarness = createTextsHarness({}, [
      { callback: 'text-mode:advanced' },
      { callback: 'text-cat:user_home' },
      { callback: 'text-incat-search' },
      { text: 'welcome' },
      { callback: 'text-incat-clear' },
      { callback: 'text-nav:categories' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(incatHarness.conversation, incatHarness.ctx);
    expect(incatHarness.reply).toHaveBeenCalled();

    const directHarness = createTextsHarness({}, [
      { callback: 'text-mode:essential' },
      { callback: 'text-pk:welcome' },
      { text: 'متن مستقیم جدید' },
      { callback: 'text-nav:back' },
      { callback: 'text-nav:mode_select' },
      { callback: 'nav:admin' },
    ]);
    await adminEditTextsConversation(directHarness.conversation, directHarness.ctx);
    expect(directHarness.updateSetting).toHaveBeenCalledWith('fa.welcome', 'متن مستقیم جدید');
  });

  it('uses text-pi: index callbacks for >64B keys, single-escapes search queries, and surfaces DB write failures', async () => {
    const longKey = 'admin_very_long_translation_key_exceeding_sixty_four_bytes_callback_budget';
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const longHarness = createTextsHarness(
        {},
        [
          { callback: 'text-mode:search' },
          { text: 'exceeding_sixty_four' },
          { callback: 'text-pi:0' },
          { callback: 'text-act:edit' },
          { text: 'متن آزمایشی جدید' },
          { callback: 'text-nav:back' },
          { callback: 'text-nav:mode_select' },
          { callback: 'nav:admin' },
        ],
        { failSave: true, extraKeys: [longKey] }
      );

      await adminEditTextsConversation(longHarness.conversation, longHarness.ctx);

      const searchResultCall = longHarness.reply.mock.calls.find((call) =>
        String(call[0]).includes('admin_text_search_results_title')
      );
      expect(searchResultCall).toBeDefined();
      expect(String(searchResultCall![0])).toContain('exceeding\\_sixty\\_four');
      expect(String(searchResultCall![0])).not.toContain('exceeding\\\\_sixty');

      const kbCallbacks = extractCallbackDataList(
        (searchResultCall![1] as { reply_markup?: unknown }).reply_markup
      );
      expect(kbCallbacks).toContain('text-pi:0');
      expect(kbCallbacks.every((cb) => Buffer.byteLength(cb, 'utf8') <= 64)).toBe(true);

      expect(longHarness.updateSetting).toHaveBeenCalledWith(`fa.${longKey}`, 'متن آزمایشی جدید');
      expect(replyTexts(longHarness.reply)).toContainEqual(
        expect.stringContaining('operation_failed')
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('keeps ESSENTIAL_USER_TEXTS, TEXT_CATEGORIES, and config_delete_* keys complete across FA and EN catalogs', () => {
    const essentialIds = ESSENTIAL_USER_TEXTS.map((item) => item.id);
    const essentialKeys = ESSENTIAL_USER_TEXTS.map((item) => item.key);
    expect(new Set(essentialIds).size).toBe(ESSENTIAL_USER_TEXTS.length);
    expect(new Set(essentialKeys).size).toBe(ESSENTIAL_USER_TEXTS.length);

    for (const item of ESSENTIAL_USER_TEXTS) {
      expect(FA_TEXTS[item.key], `Missing FA key for ${item.key}`).toBeDefined();
      expect(EN_TEXTS[item.key], `Missing EN key for ${item.key}`).toBeDefined();
      expect(FA_TEXTS[item.labelKey], `Missing FA labelKey ${item.labelKey}`).toBeDefined();
      expect(EN_TEXTS[item.labelKey], `Missing EN labelKey ${item.labelKey}`).toBeDefined();
      expect(FA_TEXTS[item.descKey], `Missing FA descKey ${item.descKey}`).toBeDefined();
      expect(EN_TEXTS[item.descKey], `Missing EN descKey ${item.descKey}`).toBeDefined();
    }

    const catIds = TEXT_CATEGORIES.map((cat) => cat.id);
    expect(new Set(catIds).size).toBe(TEXT_CATEGORIES.length);
    for (const cat of TEXT_CATEGORIES) {
      expect(FA_TEXTS[cat.labelKey], `Missing FA labelKey ${cat.labelKey}`).toBeDefined();
      expect(EN_TEXTS[cat.labelKey], `Missing EN labelKey ${cat.labelKey}`).toBeDefined();
      expect(
        FA_TEXTS[cat.descriptionKey],
        `Missing FA descKey ${cat.descriptionKey}`
      ).toBeDefined();
      expect(
        EN_TEXTS[cat.descriptionKey],
        `Missing EN descKey ${cat.descriptionKey}`
      ).toBeDefined();
    }

    const deleteKeys = Object.keys(FA_TEXTS).filter((k) => k.startsWith('config_delete_'));
    expect(deleteKeys.length).toBeGreaterThan(0);
    for (const key of deleteKeys) {
      expect(EN_TEXTS[key], `Missing EN key for ${key}`).toBeDefined();
    }

    const uncoveredFa = Object.keys(FA_TEXTS).filter(
      (key) => !TEXT_CATEGORIES.some((cat) => cat.matches(key))
    );
    const uncoveredEn = Object.keys(EN_TEXTS).filter(
      (key) => !TEXT_CATEGORIES.some((cat) => cat.matches(key))
    );
    expect(uncoveredFa).toEqual([]);
    expect(uncoveredEn).toEqual([]);
  });
});
