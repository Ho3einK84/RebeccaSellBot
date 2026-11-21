import { describe, expect, it, vi } from 'vitest';
import { MAX_PACKAGE_COUNT, type PackageOption } from '../../src/domain/services/PricingService.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { logger } from '../../src/infra/logger.js';
import {
  buildCategoryKeyboard,
  buildPackageDetailKeyboard,
  buildPackageDetailScreen,
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
  buildKeyDetailScreen,
  classifyTranslationKey,
  composeLivePreviewPayload,
  ESSENTIAL_USER_TEXTS,
  formatKeyListButtonLabels,
  getSamplePlaceholderValues,
  PLACEHOLDER_DESCRIPTIONS,
  PLACEHOLDER_METADATA,
  validateTemplateMarkdown,
} from '../../src/telegram/conversations/adminConversations/texts.js';
import { templatePlaceholders } from '../../src/domain/services/TranslationService.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
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
    failFirstMarkdownReply?: boolean;
    extraKeys?: string[];
    useRealTranslationService?: boolean;
  } = {}
) {
  const settings = new Map(Object.entries(initialSettings));
  const knownKeys = [
    'onboarding_welcome',
    'home_subtitle',
    'shop_subtitle',
    'home_title',
    'home_near_expiry_detail',
    ...(options.extraKeys ?? []),
  ];
  let messageId = 100;
  let failedMarkdownOnce = false;
  const reply = vi.fn(async (_text: string, extra?: { parse_mode?: string }) => {
    if (options.failFirstMarkdownReply && extra?.parse_mode === 'Markdown' && !failedMarkdownOnce) {
      failedMarkdownOnce = true;
      throw new Error("Bad Request: can't parse entities: Can't find end of entity");
    }
    return { message_id: messageId++ };
  });
  const deleteMessage = vi.fn(async () => true);
  const updateSetting = vi.fn(async (key: string, value: string) => {
    if (options.failSave) throw new Error('DB_WRITE_FAILED');
    settings.set(key, value);
  });
  const deleteSetting = vi.fn(async (key: string) => {
    if (options.failDelete) throw new Error('DB_DELETE_FAILED');
    settings.delete(key);
  });

  const realTs = options.useRealTranslationService ? new TranslationService() : undefined;
  const translationService = realTs
    ? {
        get: vi.fn((key: string, locale?: string, params?: Record<string, string | number>) => {
          const explicit = /^(fa|en)\.(.+)$/iu.exec(key);
          const resolvedLocale = explicit ? explicit[1]!.toLowerCase() : (locale ?? 'fa');
          const bareKey = explicit ? explicit[2]! : key;
          const override = settings.get(`${resolvedLocale}.${bareKey}`);
          if (override !== undefined) {
            if (!params) return override;
            return Object.entries(params).reduce(
              (acc, [name, val]) => acc.replaceAll(`{${name}}`, String(val)),
              override
            );
          }
          return realTs.get(key, locale, params);
        }),
        getRawTemplate: vi.fn((key: string, locale?: string) => {
          const explicit = /^(fa|en)\.(.+)$/iu.exec(key);
          const resolvedLocale = explicit ? explicit[1]!.toLowerCase() : (locale ?? 'fa');
          const bareKey = explicit ? explicit[2]! : key;
          return settings.get(`${resolvedLocale}.${bareKey}`) ?? realTs.getRawTemplate(key, locale);
        }),
        getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
        getStoredSetting: vi.fn((key: string) => settings.get(key)),
        getTranslationKeys: vi.fn(() => [
          ...realTs.getTranslationKeys(),
          ...(options.extraKeys ?? []),
        ]),
        hasTranslationKey: vi.fn(
          (k: string) => realTs.hasTranslationKey(k) || (options.extraKeys ?? []).includes(k)
        ),
        getCustomizedKeys: vi.fn((locale?: string) => {
          const targetLocale = locale ?? 'fa';
          return [...settings.keys()]
            .filter((k) => k.startsWith(`${targetLocale}.`))
            .map((k) => k.slice(3))
            .sort();
        }),
        searchTranslations: vi.fn(
          (
            query: string,
            locale?: 'fa' | 'en',
            filterOrOpts?:
              | ((k: string) => boolean)
              | {
                  filter?: (k: string) => boolean;
                  extraText?: (k: string) => string | readonly string[] | undefined;
                }
          ) => {
            const realMatches = realTs.searchTranslations(query, locale, filterOrOpts);
            const extraMatches = (options.extraKeys ?? []).filter((k) =>
              k.toLowerCase().includes(query.toLowerCase())
            );
            return [...new Set([...realMatches, ...extraMatches])];
          }
        ),
        resolveLocale: vi.fn((raw?: string) => realTs.resolveLocale(raw)),
        getDefaultLocale: vi.fn(() => 'fa' as const),
        updateSetting,
        deleteSetting,
      }
    : {
        get: vi.fn((key: string, _locale?: string, params?: Record<string, string | number>) => {
          const stored = settings.get(key);
          let rendered = stored ?? key;
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
          return keys.sort();
        }),
        searchTranslations: vi.fn(
          (
            query: string,
            _locale?: string,
            filterOrOpts?: ((k: string) => boolean) | { filter?: (k: string) => boolean }
          ) => {
            const q = query.toLowerCase();
            const filterFn =
              typeof filterOrOpts === 'function' ? filterOrOpts : filterOrOpts?.filter;
            return knownKeys.filter(
              (k) => (!filterFn || filterFn(k)) && k.toLowerCase().includes(q)
            );
          }
        ),
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
    api: { deleteMessage },
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

  return {
    conversation,
    ctx,
    translationService,
    reply,
    deleteMessage,
    updateSetting,
    deleteSetting,
  };
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
      buildPackageDetailKeyboard(previewHarness.ctx, starterPackage(), 0, 2)
    ).find((c) => c.startsWith('pkg-toggle:'))!;
    expect(toggleCb).toBe('pkg-toggle:starter');
    const toggleHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [
        { callback: 'pkg-edit:starter' },
        { callback: toggleCb },
        { callback: 'pkg-detail-back' },
        { callback: 'pkg-back' },
      ],
      { packages: [starterPackage()] }
    );
    await expect(managePackages(toggleHarness.conversation, toggleHarness.ctx)).resolves.toBe(
      'back'
    );
    expect(JSON.parse(toggleHarness.updateSetting.mock.calls[0]![1]!)[0]?.enabled).toBe(false);

    const cloneCb = extractCallbackDataList(
      buildPackageDetailKeyboard(previewHarness.ctx, starterPackage(), 0, 2)
    ).find((c) => c.startsWith('pkg-clone:'))!;
    expect(cloneCb).toBe('pkg-clone:starter');
    const cloneHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [
        { callback: 'pkg-edit:starter' },
        { callback: cloneCb },
        { callback: 'pkg-detail-back' },
        { callback: 'pkg-back' },
      ],
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
      buildPackageDetailKeyboard(policyHarness.ctx, longPackages[0]!, 0, MAX_PACKAGE_COUNT),
    ];
    for (const button of keyboards.flatMap((keyboard) => keyboard.inline_keyboard.flat())) {
      expect(Buffer.byteLength(button.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64);
      expect([...button.text].length).toBeLessThanOrEqual(60);
    }
    expect(getSettingGroup('pricing')?.settings).toContain('packages_json');

    const realTs = new TranslationService();
    const realCtx = {
      from: { id: 42, language_code: 'fa' },
      userLocale: 'fa',
      services: { translationService: realTs },
    } as unknown as ConversationContext;
    const detailScreen = buildPackageDetailScreen(realCtx, longPackages[0]!, {
      index: 0,
      total: MAX_PACKAGE_COUNT,
      categoryLabel: 'VIP_Plan*',
      targetLabel: 'Primary [Node]',
    });
    expect(validateTelegramMarkdown(detailScreen).valid).toBe(true);
    expect(detailScreen).toContain('VIP\\_Plan\\*');
  });

  it('supports single-field quick edits in package detail and category detail management', async () => {
    const quickHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [
        { callback: 'pkg-edit:starter' },
        { callback: 'pkg-q:p:starter' },
        { text: '۹۵٬۰۰۰' },
        { callback: 'pkg-q:n:starter' },
        { text: 'Pro Gold' },
        { callback: 'pkg-detail-back' },
        { callback: 'pkg-back' },
      ],
      { packages: [starterPackage()] }
    );
    await expect(managePackages(quickHarness.conversation, quickHarness.ctx)).resolves.toBe('back');
    expect(quickHarness.updateSetting).toHaveBeenCalledTimes(2);
    const updatedAfterPriceAndName = JSON.parse(
      quickHarness.updateSetting.mock.calls[1]![1]!
    ) as PackageOption[];
    expect(updatedAfterPriceAndName[0]).toMatchObject({
      id: 'starter',
      name: 'Pro Gold',
      price: 95_000,
      gbAmount: 10,
      durationDays: 30,
    });

    const categories: Array<{
      id: string;
      name: string;
      icon?: string;
      description?: string;
      displayOrder: number;
      enabled: boolean;
    }> = [];
    const catHarness = createPackageHarness(
      { packages_json: JSON.stringify([starterPackage()]) },
      [
        { callback: 'pkg-categories' },
        { callback: 'cat:add' },
        { text: 'Europe VIP' },
        { text: '🌍' },
        { callback: 'cat:edit:cat_1' },
        { callback: 'cat:edit-desc:cat_1' },
        { text: 'Low latency routes' },
        { callback: 'cat:edit-back' },
        { callback: 'cat:back' },
        { callback: 'pkg-back' },
      ],
      { packages: [starterPackage()] }
    );
    catHarness.ctx.services!.packageCategoryService = {
      listCategories: vi.fn(async () => [...categories]),
      getCategoryById: vi.fn(async (id: string) => categories.find((c) => c.id === id) ?? null),
      createCategory: vi.fn(async (input: { name: string; icon?: string }) => {
        const created = {
          id: `cat_${categories.length + 1}`,
          name: input.name,
          icon: input.icon,
          displayOrder: categories.length,
          enabled: true,
        };
        categories.push(created);
        return created;
      }),
      updateCategory: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const idx = categories.findIndex((c) => c.id === id);
        if (idx === -1) return null;
        categories[idx] = { ...categories[idx]!, ...patch };
        return categories[idx]!;
      }),
      reorderCategories: vi.fn(async () => {}),
      deleteCategory: vi.fn(async () => true),
    } as never;

    await expect(managePackages(catHarness.conversation, catHarness.ctx)).resolves.toBe('back');
    expect(categories[0]).toMatchObject({
      id: 'cat_1',
      name: 'Europe VIP',
      icon: '🌍',
      description: 'Low latency routes',
    });
    const detailReplyCall = catHarness.reply.mock.calls.find((call) =>
      extractCallbackDataList((call[1] as { reply_markup?: unknown })?.reply_markup).includes(
        'cat:edit-icon:cat_1'
      )
    );
    expect(detailReplyCall).toBeDefined();
    const iconBtn = (
      detailReplyCall![1] as {
        reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
      }
    ).reply_markup.inline_keyboard
      .flat()
      .find((b) => b.callback_data === 'cat:edit-icon:cat_1');
    expect(iconBtn?.text).toBe('admin_category_edit_icon_btn');
  });
});

describe('Admin text editor & translation catalog coverage', () => {
  it('builds category keyboard and blocks non-admin users immediately', async () => {
    const fakeCtx = createTextsHarness({}, []).ctx;
    const keyboard = buildCategoryKeyboard(fakeCtx);
    const buttons = keyboard.inline_keyboard.flat();
    expect(TEXT_CATEGORIES).toHaveLength(8);
    expect(buttons).toHaveLength(TEXT_CATEGORIES.length + 1);
    for (const category of TEXT_CATEGORIES) {
      expect(category.descriptionKey).toBeDefined();
      const match = buttons.find((btn) => btn.callback_data === `text-cat:${category.id}`);
      expect(match?.text).toBe(category.labelKey);
      expect(Buffer.byteLength(match?.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64);
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

  it('supports hub/in-detail 🦁 فارسی ↔ 🇬🇧 English switching, direct & button edit, reset, category filter & unified search without Iran flag emoji', async () => {
    const IRAN_FLAG = '\u{1F1EE}\u{1F1F7}';

    // Hub language toggle + in-detail language toggle edits both FA and EN in one visit
    const dualLang = createTextsHarness(
      {},
      [
        { callback: 'text-lang:toggle' },
        { callback: 'text-lang:toggle' },
        { callback: 'text-mode:essential' },
        { callback: 'text-pk:onboarding_welcome' },
        { text: '✨ *خوش آمدید به نسخه جدید*' },
        { callback: 'text-act:lang' },
        { callback: 'text-act:edit' },
        { text: '✨ *Welcome to our updated bot*' },
        { callback: 'text-nav:back' },
        { callback: 'text-nav:mode_select' },
        { callback: 'nav:admin' },
      ],
      { useRealTranslationService: true }
    );
    await adminEditTextsConversation(dualLang.conversation, dualLang.ctx);
    expect(dualLang.updateSetting).toHaveBeenCalledWith(
      'fa.onboarding_welcome',
      '✨ *خوش آمدید به نسخه جدید*'
    );
    expect(dualLang.updateSetting).toHaveBeenCalledWith(
      'en.onboarding_welcome',
      '✨ *Welcome to our updated bot*'
    );
    // Consumed input messages are deleted cleanly
    expect(dualLang.deleteMessage).toHaveBeenCalledTimes(2);
    const renderedOutputs = replyTexts(dualLang.reply).join('\n');
    expect(renderedOutputs).toContain('🦁 فارسی');
    expect(renderedOutputs).toContain('🇬🇧 English');
    expect(renderedOutputs).not.toContain(IRAN_FLAG);
    expect(renderedOutputs).not.toContain('—:');

    // Reset flow only works on customized keys and updates inline without spam
    const resetHarness = createTextsHarness(
      { 'fa.home_subtitle': 'زیرعنوان اختصاصی' },
      [
        { callback: 'text-mode:customized' },
        { callback: 'text-pk:home_subtitle' },
        { callback: 'text-act:reset' },
        { callback: 'text-act:reset_confirm' },
        // Forged reset when already reset back to default must be rejected without deleting again
        { callback: 'text-act:reset' },
        { callback: 'text-nav:back' },
        { callback: 'text-nav:mode_select' },
        { callback: 'nav:admin' },
      ],
      { useRealTranslationService: true }
    );
    await adminEditTextsConversation(resetHarness.conversation, resetHarness.ctx);
    expect(resetHarness.deleteSetting).toHaveBeenCalledTimes(1);
    expect(resetHarness.deleteSetting).toHaveBeenCalledWith('fa.home_subtitle');

    // Category browsing + unified in-category normalized Persian/Arabic search + clear
    const catSearchHarness = createTextsHarness(
      {},
      [
        { callback: 'text-mode:categories' },
        { callback: 'text-cat:user_wallet' },
        { callback: 'text-list:search' },
        { text: 'كارت به كارت' },
        { callback: 'text-pk:topup_subtitle' },
        { callback: 'text-nav:back' },
        { callback: 'text-list:clear' },
        { callback: 'text-nav:categories' },
        { callback: 'text-nav:mode_select' },
        { callback: 'nav:admin' },
      ],
      { useRealTranslationService: true }
    );
    await adminEditTextsConversation(catSearchHarness.conversation, catSearchHarness.ctx);
    expect(catSearchHarness.translationService.searchTranslations).toHaveBeenCalledWith(
      'كارت به كارت',
      'fa',
      expect.objectContaining({ filter: expect.any(Function) })
    );
  });

  it('conditionally shows default text & placeholders, validates placeholders/Markdown, and renders real Markdown live preview with safe fallback', async () => {
    const realHarness = createTextsHarness({}, [], { useRealTranslationService: true });
    // Default text with NO placeholders: hides default section AND hides placeholders section
    const simpleDefaultScreen = buildKeyDetailScreen(realHarness.ctx, {
      key: 'home_subtitle',
      editLocale: 'fa',
      uiLocale: 'fa',
      currentValue: FA_TEXTS.home_subtitle!,
      defaultValue: FA_TEXTS.home_subtitle!,
      isCustomized: false,
      placeholders: [],
    });
    expect(simpleDefaultScreen).toContain('متن فعلی');
    expect(simpleDefaultScreen).not.toContain('متن پیش‌فرض');
    expect(simpleDefaultScreen).not.toContain('متغیرهای مجاز');
    expect(validateTelegramMarkdown(simpleDefaultScreen).valid).toBe(true);

    // Customized text WITH placeholders: shows BOTH default text AND placeholder descriptions
    const customWithPlaceholders = buildKeyDetailScreen(realHarness.ctx, {
      key: 'home_near_expiry_detail',
      editLocale: 'fa',
      uiLocale: 'fa',
      currentValue: '`{username}` · {days} {days_unit} باقی',
      defaultValue: FA_TEXTS.home_near_expiry_detail!,
      isCustomized: true,
      placeholders: templatePlaceholders(FA_TEXTS.home_near_expiry_detail!),
    });
    expect(customWithPlaceholders).toContain('متن فعلی');
    expect(customWithPlaceholders).toContain('متن پیش‌فرض');
    expect(customWithPlaceholders).toContain('متغیرهای مجاز');
    expect(customWithPlaceholders).toContain('`{username}`');
    expect(customWithPlaceholders).toContain('`{days}`');
    expect(validateTelegramMarkdown(customWithPlaceholders).valid).toBe(true);

    // Validation rejects missing placeholders, extra placeholders, and broken Markdown before saving
    const validationHarness = createTextsHarness(
      {},
      [
        { callback: 'text-mode:search' },
        { text: 'home_near_expiry_detail' },
        { callback: 'text-pk:home_near_expiry_detail' },
        // Missing placeholders
        { text: 'فقط متن بدون متغیر' },
        // Extra unknown placeholder
        { text: '`{username}` · {days} {days_unit} {bogus}' },
        // Broken Telegram Markdown (* unclosed)
        { text: '*خراب `{username}` · {days} {days_unit}' },
        // Valid update finally succeeds
        { text: '*یادآوری* `{username}` · {days} {days_unit}' },
        // Real Live Preview renders unescaped Markdown with FA samples, then toggles to EN samples
        { callback: 'text-act:preview' },
        { callback: 'text-act:lang' },
        { callback: 'text-nav:detail' },
        { callback: 'text-nav:back' },
        { callback: 'text-nav:mode_select' },
        { callback: 'nav:admin' },
      ],
      { useRealTranslationService: true }
    );
    await adminEditTextsConversation(validationHarness.conversation, validationHarness.ctx);
    expect(validationHarness.updateSetting).toHaveBeenCalledTimes(1);
    expect(validationHarness.updateSetting).toHaveBeenCalledWith(
      'fa.home_near_expiry_detail',
      '*یادآوری* `{username}` · {days} {days_unit}'
    );

    const allReplies = validationHarness.reply.mock.calls;
    const allTexts = replyTexts(validationHarness.reply);
    expect(allTexts.some((txt) => txt.includes('باید در متن وجود داشته باشند'))).toBe(true);
    expect(allTexts.some((txt) => txt.includes('مجاز نیستند'))).toBe(true);
    expect(allTexts.some((txt) => txt.includes('قالب‌بندی Markdown معتبر نیست'))).toBe(true);

    // Verify Live Preview did NOT escape *یادآوری* or `reb1042` and used FA then EN sample values
    const faPreviewCall = allReplies.find(
      (call) => String(call[0]).includes('پیش‌نمایش واقعی') && String(call[0]).includes('🦁 فارسی')
    );
    expect(faPreviewCall).toBeDefined();
    expect(String(faPreviewCall![0])).toContain('*یادآوری* `reb1042` · ۳۰ روز');
    expect(String(faPreviewCall![0])).not.toContain('\\*یادآوری\\*');
    expect((faPreviewCall![1] as { parse_mode?: string })?.parse_mode).toBe('Markdown');

    const enPreviewCall = allReplies.find(
      (call) =>
        String(call[0]).includes('پیش‌نمایش واقعی') && String(call[0]).includes('🇬🇧 English')
    );
    expect(enPreviewCall).toBeDefined();
    expect(String(enPreviewCall![0])).toContain('`reb1042` · 30 days left');

    // Safe fallback when template has invalid Markdown or Telegram rejects entities
    const malformedPayload = composeLivePreviewPayload(
      realHarness.ctx,
      'home_subtitle',
      'fa',
      '*عنوان نیمه‌کاره'
    );
    expect(malformedPayload.usedFallback).toBe(true);
    expect(malformedPayload.parseMode).toBeUndefined();
    expect(malformedPayload.text).toContain('رندر Markdown با خطا مواجه شد');

    const apiRejectHarness = createTextsHarness(
      {},
      [
        { callback: 'text-mode:essential' },
        { callback: 'text-pk:onboarding_welcome' },
        { callback: 'text-act:preview' },
        { callback: 'text-nav:detail' },
        { callback: 'text-nav:back' },
        { callback: 'text-nav:mode_select' },
        { callback: 'nav:admin' },
      ],
      { useRealTranslationService: true, failFirstMarkdownReply: false }
    );
    // Simulate Telegram parse_entities rejection specifically during preview
    let previewRejected = false;
    apiRejectHarness.reply.mockImplementation(
      async (txt: string, opts?: { parse_mode?: string }) => {
        if (
          txt.includes('پیش‌نمایش واقعی') &&
          opts?.parse_mode === 'Markdown' &&
          !previewRejected
        ) {
          previewRejected = true;
          throw new Error("Bad Request: can't parse entities");
        }
        return { message_id: 999 };
      }
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await adminEditTextsConversation(apiRejectHarness.conversation, apiRejectHarness.ctx);
      expect(previewRejected).toBe(true);
      const fallbackCall = apiRejectHarness.reply.mock.calls.find(
        (call) =>
          String(call[0]).includes('رندر Markdown با خطا مواجه شد') &&
          (call[1] as { parse_mode?: string })?.parse_mode === undefined
      );
      expect(fallbackCall).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
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
          { callback: 'text-nav:detail' },
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

  it('enforces 100% mutually exclusive & exhaustive TEXT_CATEGORIES, valid ESSENTIAL_USER_TEXTS, full placeholder metadata, and zero Iran flag emojis', () => {
    const IRAN_FLAG = '\u{1F1EE}\u{1F1F7}';

    // 1. ESSENTIAL_USER_TEXTS integrity
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

    // 2. TEXT_CATEGORIES: unique IDs, valid labels/descriptions, non-empty, 100% exhaustive, ZERO overlap
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

    const allFaKeys = Object.keys(FA_TEXTS);
    const allEnKeys = Object.keys(EN_TEXTS);
    expect(new Set(allFaKeys)).toEqual(new Set(allEnKeys));

    const uncovered: string[] = [];
    const overlapped: Array<{ key: string; categories: string[] }> = [];
    const countsByCategory = new Map<string, number>();

    for (const key of allFaKeys) {
      const matched = TEXT_CATEGORIES.filter((cat) => cat.matches(key)).map((cat) => cat.id);
      if (matched.length === 0) uncovered.push(key);
      if (matched.length > 1) overlapped.push({ key, categories: matched });
      if (matched.length === 1) {
        expect(classifyTranslationKey(key)).toBe(matched[0]);
        countsByCategory.set(matched[0]!, (countsByCategory.get(matched[0]!) ?? 0) + 1);
      }
    }
    expect(uncovered, 'Every catalog key must belong to one category').toEqual([]);
    expect(overlapped, 'Categories must be strictly mutually exclusive').toEqual([]);
    for (const cat of TEXT_CATEGORIES) {
      expect(
        countsByCategory.get(cat.id) ?? 0,
        `Category ${cat.id} should not be empty`
      ).toBeGreaterThan(0);
    }

    // 3. Every real catalog placeholder has bilingual descriptions AND bilingual sample values (zero missing, zero stale)
    const catalogPlaceholders = new Set<string>();
    for (const value of Object.values(FA_TEXTS)) {
      for (const p of templatePlaceholders(value)) catalogPlaceholders.add(p);
    }
    const missingMeta = [...catalogPlaceholders]
      .filter((p) => !PLACEHOLDER_DESCRIPTIONS[p]?.fa || !PLACEHOLDER_DESCRIPTIONS[p]?.en)
      .sort();
    const staleMeta = Object.keys(PLACEHOLDER_METADATA)
      .filter((p) => !catalogPlaceholders.has(p))
      .sort();
    expect(missingMeta, 'Missing placeholder descriptions').toEqual([]);
    expect(staleMeta, 'Stale placeholder metadata not present in catalog').toEqual([]);

    const faSamples = getSamplePlaceholderValues('fa');
    const enSamples = getSamplePlaceholderValues('en');
    for (const p of catalogPlaceholders) {
      expect(faSamples[p], `Missing FA sample for ${p}`).toBeTruthy();
      expect(enSamples[p], `Missing EN sample for ${p}`).toBeTruthy();
    }

    // 4. Zero Iran flag emoji anywhere in FA/EN catalogs or placeholder metadata
    for (const [k, v] of Object.entries(FA_TEXTS)) {
      expect(v, `Iran flag found in FA_TEXTS.${k}`).not.toContain(IRAN_FLAG);
    }
    for (const [k, v] of Object.entries(EN_TEXTS)) {
      expect(v, `Iran flag found in EN_TEXTS.${k}`).not.toContain(IRAN_FLAG);
    }
    for (const [p, meta] of Object.entries(PLACEHOLDER_METADATA)) {
      expect(meta.sampleFa, `Iran flag in sampleFa.${p}`).not.toContain(IRAN_FLAG);
      expect(meta.sampleEn, `Iran flag in sampleEn.${p}`).not.toContain(IRAN_FLAG);
    }

    // 5. config_delete_* keys parity preserved
    const deleteKeys = allFaKeys.filter((k) => k.startsWith('config_delete_'));
    expect(deleteKeys.length).toBeGreaterThan(0);
    for (const key of deleteKeys) {
      expect(EN_TEXTS[key], `Missing EN key for ${key}`).toBeDefined();
    }

    // 6. Readable button labels: human snippets, duplicate disambiguation, subtle ✏️ marker without duplicate leading emoji
    const labels = formatKeyListButtonLabels(
      [
        {
          key: 'onboarding_welcome',
          activeText: FA_TEXTS.onboarding_welcome!,
          isCustomized: true,
          essentialLabel: FA_TEXTS.admin_text_item_onboarding!,
        },
        {
          key: 'admin_panel_status_label',
          activeText: 'وضعیت',
          isCustomized: false,
        },
        {
          key: 'admin_promo_status_label',
          activeText: 'وضعیت',
          isCustomized: true,
        },
      ],
      'fa'
    );
    expect(labels[0]).toBe('👋 خوش‌آمدگویی شروع · ✏️');
    expect(labels[1]).toBe('وضعیت (panel_status)');
    expect(labels[2]).toBe('✏️ وضعیت (promo_status)');
    expect(labels.every((l) => [...l].length <= 48)).toBe(true);

    // 7. Template Markdown validation preserves {snake_case} placeholders & live preview stays safe across all keys
    expect(validateTemplateMarkdown('*یادآوری* `{username}` · {days} {days_unit}').valid).toBe(
      true
    );
    expect(validateTemplateMarkdown('صفحه {page} از {total_pages}').valid).toBe(true);
    expect(validateTemplateMarkdown('*خراب {days_unit}').valid).toBe(false);
    expect(validateTemplateMarkdown('_خراب {days_unit}').valid).toBe(false);

    const realTs = new TranslationService();
    const previewCtx = {
      from: { id: 1001, language_code: 'fa' },
      userLocale: 'fa' as const,
      services: { translationService: realTs },
    } as unknown as ConversationContext;
    for (const locale of ['fa', 'en'] as const) {
      const samples = getSamplePlaceholderValues(locale);
      for (const key of allFaKeys) {
        const raw = realTs.getRawTemplate(`${locale}.${key}`, locale);
        expect(raw).toBe((locale === 'fa' ? FA_TEXTS : EN_TEXTS)[key]);
        const rendered = realTs.get(`${locale}.${key}`, locale, samples);
        const payload = composeLivePreviewPayload(previewCtx, key, locale, rendered);
        expect(payload.text.length, `Preview too long for ${locale}.${key}`).toBeLessThanOrEqual(
          4_096
        );
        if (!payload.usedFallback) {
          expect(
            validateTelegramMarkdown(payload.text).valid,
            `Invalid Markdown in live preview for ${locale}.${key}`
          ).toBe(true);
        }
      }
    }
  });
});
