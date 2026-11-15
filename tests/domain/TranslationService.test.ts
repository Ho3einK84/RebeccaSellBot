import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { CONFIGURATION_DEFAULTS } from '../../src/domain/services/TranslationCatalog.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import {
  DEFAULT_SETTINGS,
  TranslationService,
  isValidTranslationOverride,
  normalizeLocale,
  templatePlaceholders,
  validateTranslationOverrideDetailed,
} from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const CATALOG_PATHS = new Set([
  resolve(SOURCE_ROOT, 'domain/services/TranslationCatalog.fa.ts'),
  resolve(SOURCE_ROOT, 'domain/services/TranslationCatalog.en.ts'),
]);

const DYNAMIC_TRANSLATION_KEYS = [
  {
    generator: '`package_${packageId}_name`',
    pattern: /^package_(pkg_10gb_30d|pkg_30gb_30d|pkg_50gb_30d|pkg_100gb_60d)_name$/u,
  },
  {
    generator: '`subscription_state_${status}`',
    pattern: /^subscription_state_(active|disabled|on_hold|expired|depleted)$/u,
  },
  {
    generator: '`admin_broadcast_audience_${audience}`',
    pattern:
      /^admin_broadcast_audience_(active_subscription|no_subscription|no_purchase_30d|no_active_subscription)$/u,
  },
  {
    generator: '`admin_broadcast_status_${job.status}`',
    pattern: /^admin_broadcast_status_(queued|running|cancel_requested|cancelled|completed)$/u,
  },
  {
    generator: '`refund_reason_${result.reason}`',
    pattern:
      /^refund_reason_(config_not_found|remote_unavailable|already_used|not_purchased_here|ownership_mismatch|renewed_service|refund_window_expired|referral_reward_attached|already_refunded|refund_in_progress)$/u,
  },
  {
    generator: '`admin_panel_credential_${panel.credentialMode}`',
    pattern: /^admin_panel_credential_(api_key|password|none)$/u,
  },
  {
    generator: '`admin_receipt_reject_reason_${reason}`',
    pattern:
      /^admin_receipt_reject_reason_(unclear|not_received|duplicate|amount_mismatch|other)$/u,
  },
  {
    generator: '`receipt_result_rejected_reason_${reason}`',
    pattern:
      /^receipt_result_rejected_reason_(unclear|not_received|duplicate|amount_mismatch|other)$/u,
  },
] as const;

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(filePath);
    return entry.name.endsWith('.ts') ? [filePath] : [];
  });
}

function collectProductionStringLiterals(): {
  literals: Set<string>;
  sourceText: string;
} {
  const literals = new Set<string>();
  let sourceText = '';

  for (const filePath of listTypeScriptFiles(SOURCE_ROOT)) {
    if (CATALOG_PATHS.has(resolve(filePath))) continue;
    const fileText = readFileSync(filePath, 'utf8');
    sourceText += fileText;
    const source = ts.createSourceFile(filePath, fileText, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) literals.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { literals, sourceText };
}

describe('TranslationService & Catalog Standards', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses hardcoded fallbacks before DB initialization and preserves placeholder text inside values', () => {
    const service = new TranslationService();
    expect(service.get('welcome', 'fa')).toBe(DEFAULT_SETTINGS['fa.welcome']);
    expect(service.get('balance', 'fa', { balance: 50_000 })).toContain('50000');
    expect(service.get('completely_unknown_key_xyz', 'fa')).toBe('completely_unknown_key_xyz');

    const rendered = service.get('admin_setting_custom_naming_template_prompt', 'fa', {
      current: 'h_{telegram_id}_{counter}',
      prefix_value: 'h',
      code_prefix: '{prefix}',
      code_telegram_id: '{telegram_id}',
      code_counter: '{counter}',
      code_year: '{year}',
      code_yy: '{yy}',
      code_month: '{month}',
      code_day: '{day}',
      code_jyear: '{jyear}',
      code_jmonth: '{jmonth}',
      code_jday: '{jday}',
      code_date: '{date}',
      code_random4: '{random4}',
      code_random6: '{random6}',
      code_random8: '{random8}',
      example_primary: '{prefix}_{telegram_id}_{counter}',
      example_date: '{prefix}_{year}_{month}_{counter}',
      example_random: '{prefix}_{counter}_{random4}',
    });
    expect(rendered).toContain('`h_{telegram_id}_{counter}`');
    expect(rendered).toContain('`{prefix}`');
    expect(rendered).toContain('کد قالب دلخواه را بفرستین');
    expect(rendered).not.toContain('h_—_—');
  });

  it('normalizes locales, uses strict fallback lookup order, and avoids falling through to raw settings', async () => {
    const mock = createMockDb();
    getDbMock.mockReturnValue(mock.db as never);
    const service = new TranslationService({ defaultLocale: 'en' });

    expect(normalizeLocale('fa-IR')).toBe('fa');
    expect(normalizeLocale('en_US')).toBe('en');
    expect(normalizeLocale('de-DE')).toBe('fa');
    expect(service.resolveLocale('de-DE')).toBe('en');
    expect(service.get('welcome', 'de-DE')).toBe(DEFAULT_SETTINGS['en.welcome']);
    expect(service.get('EN.welcome')).toBe(DEFAULT_SETTINGS['en.welcome']);

    await service.updateSetting('en.custom_only', 'Configured English');
    expect(service.get('custom_only', 'fa')).toBe('Configured English');

    await service.updateSetting('fa.custom_only', 'Customized Persian');
    expect(service.get('custom_only', 'fa')).toBe('Customized Persian');

    await service.updateSetting('unqualified_message', 'Operational setting value');
    expect(service.get('unqualified_message', 'fa')).toBe('unqualified_message');
    expect(service.getSetting('unqualified_message')).toBe('Operational setting value');

    await service.updateSetting('default_locale', 'en');
    expect(service.getDefaultLocale()).toBe('en');
  });

  it('keeps Telegram Markdown formatting clean and tappable links valid', async () => {
    const mock = createMockDb();
    getDbMock.mockReturnValue(mock.db as never);
    const service = new TranslationService();

    expect(Object.values(DEFAULT_SETTINGS).some((value) => value.includes('**'))).toBe(false);
    expect(
      service.get('subscription_detail_heading', 'en', { username: 'h_6698253699_8' })
    ).toContain('Service · `h_6698253699_8`');
    expect(
      service.get('admin_setting_custom_volume_enabled_prompt', 'en', { current: 'Enabled' })
    ).toContain('*Enabled*');
    const expiry = service.get('subscription_expiry_remaining', 'en', {
      date: '2026-09-06',
      days: 30,
    });
    expect(expiry).toContain('2026-09-06 (30 days remaining)');
    expect(expiry).not.toContain('\\(');

    const url = 'https://panel.example.com:2087/sub/abc123';
    const markdownLink = `[${url}](${url})`;
    await service.updateSetting(
      'en.legacy_subscription_url',
      'Your trial subscription URL:\n`{sub_url}`'
    );
    expect(service.get('legacy_subscription_url', 'en', { sub_url: markdownLink })).toBe(
      `Your trial subscription URL:\n${markdownLink}`
    );
  });

  it('validates placeholders, fails closed on overrides, and updates cache strictly post-commit in bulk batch', async () => {
    expect(templatePlaceholders('Hello {name}; balance {balance}; {name}')).toEqual([
      'balance',
      'name',
    ]);
    expect(isValidTranslationOverride('Balance: {balance}', 'Wallet: {balance}')).toBe(true);
    expect(isValidTranslationOverride('Balance unavailable', 'Wallet: {balance}')).toBe(false);
    expect(
      validateTranslationOverrideDetailed('Welcome {name}', 'Hi {name} in {shop}')
    ).toMatchObject({
      valid: false,
      errorReason: 'MISSING_PLACEHOLDERS',
      missingPlaceholders: ['shop'],
    });
    expect(
      validateTranslationOverrideDetailed('Welcome {name} {extra}', 'Hi {name}')
    ).toMatchObject({
      valid: false,
      errorReason: 'EXTRA_PLACEHOLDERS',
      extraPlaceholders: ['extra'],
    });
    expect(validateTranslationOverrideDetailed('   ', 'Hi {name}')).toMatchObject({
      valid: false,
      errorReason: 'EMPTY',
    });

    const service = new TranslationService();
    getDbMock.mockReturnValue(createMockDb().db as never);
    await expect(service.updateSetting('en.balance', 'No placeholder')).rejects.toThrow(
      'TRANSLATION_TEMPLATE_INVALID'
    );

    const failUpsertMock = createMockDb({
      insertError: () => new Error('write failed'),
    });
    getDbMock.mockReturnValue(createMockDb().db as never);
    await service.updateSetting('en.welcome', 'Before write');
    getDbMock.mockReturnValue(failUpsertMock.db as never);
    await expect(service.updateSetting('en.welcome', 'After fail')).rejects.toThrow('write failed');
    expect(service.get('welcome', 'en')).toBe('Before write');

    // Batched updateSettings commits single multi-row upsert and isolates rollback
    const rollbackMock = createMockDb();
    (rollbackMock.db.transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('transaction rolled back');
    });
    getDbMock.mockReturnValue(rollbackMock.db as never);
    await expect(
      service.updateSettings({ 'en.welcome': 'Rolled back', 'en.main_menu': 'Rolled back' })
    ).rejects.toThrow('transaction rolled back');
    expect(service.get('welcome', 'en')).toBe('Before write');

    const batchMock = createMockDb();
    getDbMock.mockReturnValue(batchMock.db as never);
    await service.updateSettings({ 'en.welcome': 'Committed bulk', 'en.main_menu': 'Bulk menu' });
    expect(batchMock.state.insertCalls).toHaveLength(1);
    expect(Array.isArray(batchMock.state.insertCalls[0]?.values)).toBe(true);
    expect(service.get('welcome', 'en')).toBe('Committed bulk');
    expect(service.get('main_menu', 'en')).toBe('Bulk menu');

    // Delete restores fallback
    await service.deleteSetting('en.welcome');
    expect(service.get('welcome', 'en')).toBe(DEFAULT_SETTINGS['en.welcome']);
  });

  it('batches stock translation cleanup in ensureDefaultSettings and handles reload/search', async () => {
    const cleanupDb = createMockDb({
      selectResults: [
        [
          { key: 'en.welcome', value: DEFAULT_SETTINGS['en.welcome'] },
          { key: 'fa.welcome', value: DEFAULT_SETTINGS['fa.welcome'] },
          { key: 'en.main_menu', value: 'Admin Customized Menu' },
        ],
        [{ key: 'en.main_menu', value: 'Admin Customized Menu' }],
      ],
    });
    getDbMock.mockReturnValue(cleanupDb.db as never);

    const service = new TranslationService();
    await service.ensureDefaultSettings();
    expect(cleanupDb.state.insertCalls).toHaveLength(1);
    expect(cleanupDb.state.deleteCalls).toHaveLength(1);
    expect(service.get('main_menu', 'en')).toBe('Admin Customized Menu');
    expect(service.getCustomizedKeys('en')).toContain('main_menu');
    expect(service.searchTranslations('Admin Customized', 'en')).toContain('main_menu');

    // Reload failure resets stale cache to safe hardcoded fallbacks
    getDbMock.mockReturnValue(
      createMockDb({ selectResults: [new Error('database unavailable')] }).db as never
    );
    await service.reloadCache();
    expect(service.get('main_menu', 'en')).toBe(DEFAULT_SETTINGS['en.main_menu']);

    expect(CONFIGURATION_DEFAULTS.custom_min_gb).toBe('5');
    expect(CONFIGURATION_DEFAULTS.custom_max_gb).toBe('500');
    expect(service.getSettingNum('price_per_gb', 0)).toBe(5000);
    expect(service.getSettingBool('trial_enabled', false)).toBe(true);
  });

  it('enforces FA/EN catalog key parity, ZWNJ orthography, placeholder parity, and production usage', () => {
    expect(CONFIGURATION_DEFAULTS.card_holder).toBe('Name');
    expect(CONFIGURATION_DEFAULTS.topup_min_amount).toBe('10000');
    expect(CONFIGURATION_DEFAULTS.topup_max_amount).toBe('10000000');

    const faKeys = Object.keys(FA_TEXTS).sort();
    const enKeys = Object.keys(EN_TEXTS).sort();
    expect(faKeys).toEqual(enKeys);

    const forbiddenPatterns = [
      /میتوانید/,
      /میتواند/,
      /میتوان\b/,
      /میباشد/,
      /می‌باشد/,
      /پیشنمایش/,
      /سرویسهای/,
      /سرویسها\b/,
      /پنلهای/,
      /پنلها\b/,
      /اشتراکهای/,
      /اشتراکها\b/,
      /بستههای/,
      /حسابهای/,
      /گزینههای/,
      /بخشهای/,
      /نامگذاری/,
      /معرفیشده/,
      /امکانپذیر/,
      /فعالسازی/,
      /بروزرسانی/,
      /دسته بندی/,
      /کسر نگردید/,
      /ذخیره نگردید/,
      /واریز نموده/,
      /مدیریت نموده/,
    ];
    const zwnjErrors: string[] = [];
    const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;

    for (const key of faKeys) {
      const faText = FA_TEXTS[key] ?? '';
      const enText = EN_TEXTS[key] ?? '';
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(faText)) zwnjErrors.push(`${key}: ${pattern}`);
      }
      const faPlaceholders = new Set([...faText.matchAll(placeholderRegex)].map((m) => m[1]));
      const enPlaceholders = new Set([...enText.matchAll(placeholderRegex)].map((m) => m[1]));
      expect(faPlaceholders, `Placeholder mismatch on "${key}"`).toEqual(enPlaceholders);
    }
    expect(zwnjErrors).toEqual([]);

    const { literals, sourceText } = collectProductionStringLiterals();
    for (const { generator } of DYNAMIC_TRANSLATION_KEYS) {
      expect(sourceText, `Missing dynamic lookup ${generator}`).toContain(generator);
    }
    const unusedKeys = Object.keys(FA_TEXTS).filter(
      (key) =>
        !literals.has(key) && !DYNAMIC_TRANSLATION_KEYS.some(({ pattern }) => pattern.test(key))
    );
    expect(unusedKeys, 'Catalog entries must be referenced by production source').toEqual([]);
  });
});
