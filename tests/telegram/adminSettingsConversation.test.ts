import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/infra/logger.js';
import {
  adminEditSettingsConversation,
  buildPackageManagerKeyboard,
  buildSettingsGroupKeyboard,
  buildSettingsInGroupKeyboard,
  generatePackageId,
  getSettingGroup,
  managePackages,
  SETTING_GROUPS,
} from '../../src/telegram/conversations/adminConversations.js';
import { MAX_PACKAGE_COUNT, type PackageOption } from '../../src/domain/services/PricingService.js';
import type { ConversationContext, MyConversation, SessionData } from '../../src/telegram/types.js';

type ScriptedInput = { callback: string } | { text: string };

function createHarness(
  initialSettings: Record<string, string>,
  script: ScriptedInput[],
  options: {
    failSave?: boolean;
    failNamingSync?: boolean;
    packages?: PackageOption[];
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
  const conversation = {
    external: vi.fn(async (operation: (outsideCtx: unknown) => unknown) =>
      operation(ctx as unknown)
    ),
    wait: vi.fn(async () => {
      const next = remaining.shift();
      if (!next) throw new Error('TEST_INPUT_SCRIPT_EXHAUSTED');
      return {
        ...ctx,
        ...(next && 'callback' in next
          ? { callbackQuery: { data: next.callback }, answerCallbackQuery }
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
    remaining,
    reply,
    settings,
    syncCounters,
    updateSetting,
  };
}

describe('admin settings conversation', () => {
  it('navigates home, category, instant toggle save, Back, and Cancel', async () => {
    const harness = createHarness({ trial_enabled: 'true', trial_gb: '1', trial_days: '3' }, [
      { callback: 'set-group:trial' },
      { callback: 'set-edit:trial_enabled' },
      { callback: 'set-groups' },
      { callback: 'conversation:cancel' },
    ]);

    await adminEditSettingsConversation(harness.conversation, harness.ctx);

    expect(harness.updateSetting).toHaveBeenCalledOnce();
    expect(harness.updateSetting).toHaveBeenCalledWith('trial_enabled', 'false');
    expect(harness.settings.get('trial_enabled')).toBe('false');
    expect(keyboardRenderCount(harness.reply, 'set-group:trial')).toBe(2);
    expect(keyboardRenderCount(harness.reply, 'set-edit:trial_enabled')).toBe(2);
    expect(harness.remaining).toHaveLength(0);
  });

  it('rolls a naming value back when applying it to existing configs fails', async () => {
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const harness = createHarness(
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

    await adminEditSettingsConversation(harness.conversation, harness.ctx, 'naming');

    expect(harness.updateSetting.mock.calls).toEqual([
      ['naming_mode', 'prefix_number'],
      ['naming_mode', 'custom'],
    ]);
    expect(harness.settings.get('naming_mode')).toBe('custom');
    expect(harness.syncCounters).toHaveBeenCalledOnce();
    expect(replyTexts(harness.reply)).toContainEqual(
      expect.stringContaining('admin_setting_apply_failed')
    );
    logSpy.mockRestore();
  });

  it('shows a recoverable failure and keeps the old value when persistence fails', async () => {
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const harness = createHarness(
      { trial_enabled: 'true', trial_gb: '1', trial_days: '1' },
      [
        { callback: 'set-edit:trial_days' },
        { text: '۳۰' },
        { callback: 'set-return:trial' },
        { callback: 'conversation:cancel' },
      ],
      { failSave: true }
    );

    await adminEditSettingsConversation(harness.conversation, harness.ctx, 'trial');

    expect(harness.updateSetting).toHaveBeenCalledWith('trial_days', '30');
    expect(harness.settings.get('trial_days')).toBe('1');
    expect(replyTexts(harness.reply)).toContainEqual(
      expect.stringContaining('admin_setting_save_failed')
    );
    logSpy.mockRestore();
  });
});

describe('admin package manager', () => {
  it('persists one fully validated package edit and canonicalizes Persian numbers', async () => {
    const packages = [starterPackage()];
    const harness = createHarness(
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

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');

    expect(harness.updateSetting).toHaveBeenCalledOnce();
    const persisted = JSON.parse(harness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
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
  });

  it('does not persist a partial package when Back cancels field editing', async () => {
    const packages = [starterPackage()];
    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: 'pkg-add' }, { callback: 'pkg-field-back' }, { callback: 'pkg-back' }],
      { packages }
    );

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');

    expect(harness.updateSetting).not.toHaveBeenCalled();
    expect(harness.settings.get('packages_json')).toBe(JSON.stringify(packages));
  });

  it('rejects a stale or forged panel target without persisting it', async () => {
    const packages = [starterPackage()];
    const harness = createHarness(
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

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');

    expect(harness.updateSetting).not.toHaveBeenCalled();
  });

  it('supports multiple sequential actions without errors', async () => {
    const packages = [
      starterPackage(),
      { ...starterPackage(), id: 'second', name: 'Second package', gbAmount: 20 },
    ];
    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [
        { callback: 'pkg-toggle:starter' }, // 1. Toggle starter to disabled
        { callback: 'pkg-down:starter' }, // 2. Move starter down (swap with second)
        { callback: 'pkg-toggle:starter' }, // 3. Toggle starter back to enabled
        { callback: 'pkg-back' },
      ],
      { packages }
    );

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');

    expect(harness.updateSetting).toHaveBeenCalledTimes(3);
    const lastCall = harness.updateSetting.mock.calls[2]![1]!;
    const persisted = JSON.parse(lastCall) as PackageOption[];
    expect(persisted.map((pkg) => pkg.id)).toEqual(['second', 'starter']);
    expect(persisted[1]?.enabled).toBe(true);
  });

  it('paginates large valid catalogs and refuses to exceed the domain limit', async () => {
    const packages = Array.from({ length: MAX_PACKAGE_COUNT }, (_, index) => ({
      ...starterPackage(),
      id: `pkg_${index}`,
      name: `Package ${index}`,
    }));
    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: 'pkg-add' }, { callback: 'pkg-back' }],
      { packages }
    );

    const firstPageCallbacks = buildPackageManagerKeyboard(harness.ctx, packages)
      .inline_keyboard.flat()
      .map((button) => button.callback_data);
    expect(firstPageCallbacks.filter((data) => data?.startsWith('pkg-edit:'))).toHaveLength(8);
    expect(firstPageCallbacks).toContain('pkg-page:1');

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');
    expect(harness.updateSetting).not.toHaveBeenCalled();
    expect(replyTexts(harness.reply)).toContainEqual(
      expect.stringContaining('admin_pkg_limit_reached')
    );
  });

  it('toggles package active state immediately', async () => {
    const packages = [starterPackage()];
    const previewHarness = createHarness({}, []);
    const toggleCallback = buildPackageManagerKeyboard(previewHarness.ctx, packages)
      .inline_keyboard.flat()
      .find((button) => button.callback_data?.startsWith('pkg-toggle:'))?.callback_data;
    expect(toggleCallback).toBeDefined();

    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: toggleCallback! }, { callback: 'pkg-back' }],
      { packages }
    );

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');
    expect(harness.updateSetting).toHaveBeenCalledOnce();
    const persisted = JSON.parse(harness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
    expect(persisted[0]?.enabled).toBe(false);
  });

  it('clones an existing package with copy suffix and preserves settings', async () => {
    const packages = [starterPackage()];
    const previewHarness = createHarness({}, []);
    const cloneCallback = buildPackageManagerKeyboard(previewHarness.ctx, packages)
      .inline_keyboard.flat()
      .find((button) => button.callback_data?.startsWith('pkg-clone:'))?.callback_data;
    expect(cloneCallback).toBeDefined();

    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: cloneCallback! }, { callback: 'pkg-back' }],
      { packages }
    );

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');
    expect(harness.updateSetting).toHaveBeenCalledOnce();
    const persisted = JSON.parse(harness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
    expect(persisted).toHaveLength(2);
    expect(persisted[1]?.name).toContain('admin_pkg_copy_suffix');
    expect(persisted[1]?.gbAmount).toBe(10);
    expect(persisted[1]?.durationDays).toBe(30);
    expect(persisted[1]?.price).toBe(50_000);
    expect(persisted[1]?.id).toBe('pkg_starter_admin_pkg_copy_suffix');
  });

  it('reorders packages by moving them up and down', async () => {
    const packages = [
      starterPackage(),
      { ...starterPackage(), id: 'second', name: 'Second package' },
    ];
    const previewHarness = createHarness({}, []);
    const downCallback = buildPackageManagerKeyboard(previewHarness.ctx, packages)
      .inline_keyboard.flat()
      .find((button) => button.callback_data?.startsWith('pkg-down:'))?.callback_data;
    expect(downCallback).toBeDefined();

    const harness = createHarness(
      { packages_json: JSON.stringify(packages) },
      [{ callback: downCallback! }, { callback: 'pkg-back' }],
      { packages }
    );

    await expect(managePackages(harness.conversation, harness.ctx)).resolves.toBe('back');
    expect(harness.updateSetting).toHaveBeenCalledOnce();
    const persisted = JSON.parse(harness.updateSetting.mock.calls[0]![1]!) as PackageOption[];
    expect(persisted.map((pkg) => pkg.id)).toEqual(['second', 'starter']);
  });

  it('generates stable unique IDs and keeps rendered callback data within Telegram limits', () => {
    const harness = createHarness({}, []);
    const packages = Array.from({ length: MAX_PACKAGE_COUNT }, (_, index) => ({
      ...starterPackage(),
      id: index === 0 ? 'pkg_very_long_package_name' : `pkg_${index}`,
      name: `${'Very long package name '.repeat(8)}${index}`,
    }));

    expect(generatePackageId('Very long package name', packages)).toBe(
      'pkg_very_long_package_name_2'
    );
    expect(generatePackageId('طرح ویژه', packages)).toBe('pkg_package');

    const keyboards = [
      buildSettingsGroupKeyboard(harness.ctx),
      ...SETTING_GROUPS.map((group) => buildSettingsInGroupKeyboard(harness.ctx, group)),
      buildPackageManagerKeyboard(harness.ctx, packages),
    ];
    for (const button of keyboards.flatMap((keyboard) => keyboard.inline_keyboard.flat())) {
      expect(Buffer.byteLength(button.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64);
      expect([...button.text].length).toBeLessThanOrEqual(60);
    }
    expect(getSettingGroup('pricing')?.settings).toContain('packages_json');
  });

  it('toggles bot_enabled and changes default_locale in the system group', async () => {
    const harness = createHarness(
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

    await adminEditSettingsConversation(harness.conversation, harness.ctx);

    expect(harness.updateSetting).toHaveBeenCalledWith('bot_enabled', 'false');
    expect(harness.settings.get('bot_enabled')).toBe('false');
    expect(harness.updateSetting).toHaveBeenCalledWith('default_locale', 'en');
    expect(harness.settings.get('default_locale')).toBe('en');
    expect(harness.remaining).toHaveLength(0);
  });
});

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

function replyTexts(reply: ReturnType<typeof vi.fn>): unknown[] {
  return reply.mock.calls.map((call) => call[0]);
}

function keyboardRenderCount(reply: ReturnType<typeof vi.fn>, callback: string): number {
  return reply.mock.calls.filter((call) => {
    const options = call[1] as { reply_markup?: { inline_keyboard?: unknown[][] } } | undefined;
    return options?.reply_markup?.inline_keyboard?.flat().some((button) => {
      return (button as { callback_data?: string }).callback_data === callback;
    });
  }).length;
}
