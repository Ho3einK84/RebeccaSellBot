import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  DEFAULT_SETTINGS,
  TranslationService,
  isValidTranslationOverride,
  normalizeLocale,
  templatePlaceholders,
  validateTranslationOverrideDetailed,
} from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type FakeDatabaseOptions = {
  rows?: Array<{ key: string; value: string }>;
  failUpsert?: boolean;
  failTransaction?: boolean;
  failSelect?: boolean;
};

function createDatabaseMock(options: FakeDatabaseOptions = {}) {
  const upsert = vi.fn(() => {
    if (options.failUpsert) return Promise.reject(new Error('write failed'));
    return Promise.resolve();
  });
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: upsert,
      onConflictDoNothing: upsert,
    })),
  }));
  const tx = { insert };
  const transaction = vi.fn(async (callback: (transactionDb: typeof tx) => Promise<void>) => {
    await callback(tx);
    if (options.failTransaction) throw new Error('transaction rolled back');
  });

  return {
    select: vi.fn(() => ({
      from: vi.fn(() =>
        options.failSelect
          ? Promise.reject(new Error('database unavailable'))
          : Promise.resolve(options.rows ?? [])
      ),
    })),
    insert,
    transaction,
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
  };
}

describe('TranslationService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses hardcoded fallbacks before DB initialization and interpolates parameters', () => {
    const service = new TranslationService();

    expect(service.get('welcome', 'fa')).toBe(DEFAULT_SETTINGS['fa.welcome']);
    expect(service.get('balance', 'fa', { balance: 50_000 })).toContain('50000');
    expect(service.get('completely_unknown_key_xyz', 'fa')).toBe('completely_unknown_key_xyz');
  });

  it('preserves naming placeholders introduced by interpolation values', () => {
    const service = new TranslationService();
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
    expect(rendered).toContain('`{telegram_id}`');
    expect(rendered).toContain('`{counter}`');
    expect(rendered).toContain('`{year}`');
    expect(rendered).toContain('`{month}`');
    expect(rendered).toContain('`{jyear}`');
    expect(rendered).toContain('`{jmonth}`');
    expect(rendered).toContain('`{date}`');
    expect(rendered).toContain('`{random4}`');
    expect(rendered).toContain('کد قالب دلخواه را بفرستین');
    expect(rendered).not.toContain('`—`');
    expect(rendered).not.toContain('h_—_—');
  });

  it('normalizes FA/EN locale variants and uses the configured default locale', () => {
    const service = new TranslationService({ defaultLocale: 'en' });

    expect(normalizeLocale('fa-IR')).toBe('fa');
    expect(normalizeLocale('en_US')).toBe('en');
    expect(normalizeLocale('de-DE')).toBe('fa');
    expect(service.resolveLocale('de-DE')).toBe('en');
    expect(service.get('welcome', 'de-DE')).toBe(DEFAULT_SETTINGS['en.welcome']);
    expect(service.get('EN.welcome')).toBe(DEFAULT_SETTINGS['en.welcome']);
  });

  it('keeps the FA and EN fallback catalogues in parity', () => {
    const keysFor = (locale: 'fa' | 'en') =>
      Object.keys(DEFAULT_SETTINGS)
        .filter((key) => key.startsWith(`${locale}.`))
        .map((key) => key.slice(3))
        .sort();

    expect(keysFor('fa')).toEqual(keysFor('en'));
  });

  it('uses Telegram Markdown markers and preserves clean inline-code values', () => {
    const service = new TranslationService();
    const heading = service.get('subscription_detail_heading', 'en', {
      username: 'h_6698253699_8',
    });
    const prompt = service.get('admin_setting_custom_volume_enabled_prompt', 'en', {
      current: 'Enabled',
    });
    const expiry = service.get('subscription_expiry_remaining', 'en', {
      date: '2026-09-06',
      days: 30,
    });

    expect(Object.values(DEFAULT_SETTINGS).some((value) => value.includes('**'))).toBe(false);
    expect(heading).toContain('Service · `h_6698253699_8`');
    expect(prompt).toContain('*Enabled*');
    expect(expiry).toContain('2026-09-06 (30 days remaining)');
    expect(expiry).not.toContain('\\(');
  });

  it('validates translation placeholder parity and rejects malformed overrides', async () => {
    expect(templatePlaceholders('Hello {name}; balance {balance}; {name}')).toEqual([
      'balance',
      'name',
    ]);
    expect(isValidTranslationOverride('Balance: {balance}', 'Wallet: {balance}')).toBe(true);
    expect(isValidTranslationOverride('Balance unavailable', 'Wallet: {balance}')).toBe(false);

    vi.mocked(getDb).mockReturnValue(createDatabaseMock() as never);
    const service = new TranslationService();
    await expect(service.updateSetting('en.balance', 'No placeholder')).rejects.toThrow(
      'TRANSLATION_TEMPLATE_INVALID'
    );
  });

  it('falls back from an invalid persisted override and neutralizes missing values', async () => {
    vi.mocked(getDb).mockReturnValue(
      createDatabaseMock({ rows: [{ key: 'en.balance', value: 'Broken override' }] }) as never
    );
    const service = new TranslationService();
    await service.reloadCache();

    expect(service.get('balance', 'en', { balance: 25 })).toBe(
      DEFAULT_SETTINGS['en.balance'].replace('{balance}', '25')
    );
    expect(service.get('balance', 'en')).not.toContain('{balance}');
  });

  it('checks each locale override and fallback before trying the next locale', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService({ defaultLocale: 'en' });

    await service.updateSetting('en.custom_only', 'Configured English');
    expect(service.get('custom_only', 'fa')).toBe('Configured English');

    await service.updateSetting('fa.custom_only', 'Customized Persian');
    expect(service.get('custom_only', 'fa')).toBe('Customized Persian');

    await service.updateSetting('fa.welcome', 'Customized Persian welcome');
    expect(service.get('welcome', 'en')).toBe(DEFAULT_SETTINGS['en.welcome']);
  });

  it('never falls through from a missing translation to an unqualified setting', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService();

    await service.updateSetting('unqualified_message', 'Operational setting value');
    expect(service.get('unqualified_message', 'fa')).toBe('unqualified_message');
    expect(service.getSetting('unqualified_message')).toBe('Operational setting value');
  });

  it('keeps Markdown subscription links tappable with legacy inline-code templates', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService();
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

  it('keeps a prior cache value when a single setting write fails', async () => {
    const service = new TranslationService();
    vi.mocked(getDb).mockReturnValue(createDatabaseMock() as never);
    await service.updateSetting('en.welcome', 'Committed value');

    vi.mocked(getDb).mockReturnValue(createDatabaseMock({ failUpsert: true }) as never);
    await expect(service.updateSetting('en.welcome', 'Uncommitted value')).rejects.toThrow(
      'write failed'
    );
    expect(service.get('welcome', 'en')).toBe('Committed value');
  });

  it('only replaces bulk cache entries after the transaction commits', async () => {
    const service = new TranslationService();
    vi.mocked(getDb).mockReturnValue(createDatabaseMock() as never);
    await service.updateSetting('en.welcome', 'Before bulk edit');

    vi.mocked(getDb).mockReturnValue(createDatabaseMock({ failTransaction: true }) as never);
    await expect(
      service.updateSettings({
        'en.welcome': 'Rolled back',
        'en.main_menu': 'Rolled back menu',
      })
    ).rejects.toThrow('transaction rolled back');

    expect(service.get('welcome', 'en')).toBe('Before bulk edit');
    expect(service.get('main_menu', 'en')).toBe(DEFAULT_SETTINGS['en.main_menu']);

    vi.mocked(getDb).mockReturnValue(createDatabaseMock() as never);
    await service.updateSettings({
      'en.welcome': 'Committed bulk',
      'en.main_menu': 'Committed menu',
    });
    expect(service.get('welcome', 'en')).toBe('Committed bulk');
    expect(service.get('main_menu', 'en')).toBe('Committed menu');
  });

  it('drops stale overrides after a reload failure and reveals hardcoded fallbacks', async () => {
    const service = new TranslationService();
    vi.mocked(getDb).mockReturnValue(
      createDatabaseMock({ rows: [{ key: 'en.welcome', value: 'Cached DB text' }] }) as never
    );
    await service.reloadCache();
    expect(service.get('welcome', 'en')).toBe('Cached DB text');

    vi.mocked(getDb).mockReturnValue(createDatabaseMock({ failSelect: true }) as never);
    await service.reloadCache();
    expect(service.get('welcome', 'en')).toBe(DEFAULT_SETTINGS['en.welcome']);
  });

  it('deleting an override immediately restores its hardcoded fallback', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService();

    await service.updateSetting('en.welcome', 'Temporary override');
    await service.deleteSetting('en.welcome');
    expect(service.get('welcome', 'en')).toBe(DEFAULT_SETTINGS['en.welcome']);
  });

  it('seeds a DB-backed default package list and strictly parses scalar settings', async () => {
    const service = new TranslationService();
    const packages = JSON.parse(service.getSetting('packages_json')) as Array<{ id: string }>;

    expect(packages.map((pkg) => pkg.id)).toEqual([
      'pkg_10gb_30d',
      'pkg_30gb_30d',
      'pkg_50gb_30d',
      'pkg_100gb_60d',
    ]);
    expect(service.getSettingNum('price_per_gb', 0)).toBe(5000);
    expect(service.getSettingBool('trial_enabled', false)).toBe(true);

    vi.mocked(getDb).mockReturnValue(createDatabaseMock() as never);
    await service.updateSetting('price_per_gb', '5000oops');
    expect(service.getSettingNum('price_per_gb', 7000)).toBe(7000);
  });

  it('dynamically adapts default locale when default_locale setting is updated in DB', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService({ defaultLocale: 'fa' });

    await service.updateSetting('default_locale', 'en');
    expect(service.getDefaultLocale()).toBe('en');
    expect(service.resolveLocale()).toBe('en');
  });

  it('provides detailed validation breakdown for translation overrides', () => {
    // Valid
    const valid = validateTranslationOverrideDetailed(
      'Welcome {name} to {shop}',
      'Hi {name} in {shop}'
    );
    expect(valid.valid).toBe(true);
    expect(valid.missingPlaceholders).toEqual([]);
    expect(valid.extraPlaceholders).toEqual([]);

    // Missing
    const missing = validateTranslationOverrideDetailed('Welcome {name}', 'Hi {name} in {shop}');
    expect(missing.valid).toBe(false);
    expect(missing.errorReason).toBe('MISSING_PLACEHOLDERS');
    expect(missing.missingPlaceholders).toEqual(['shop']);

    // Extra
    const extra = validateTranslationOverrideDetailed('Welcome {name} {extra}', 'Hi {name}');
    expect(extra.valid).toBe(false);
    expect(extra.errorReason).toBe('EXTRA_PLACEHOLDERS');
    expect(extra.extraPlaceholders).toEqual(['extra']);

    // Empty
    const empty = validateTranslationOverrideDetailed('   ', 'Hi {name}');
    expect(empty.valid).toBe(false);
    expect(empty.errorReason).toBe('EMPTY');
  });

  it('retrieves customized keys and performs bilingual searches', async () => {
    const db = createDatabaseMock();
    vi.mocked(getDb).mockReturnValue(db as never);
    const service = new TranslationService();

    await service.updateSetting('fa.welcome', 'سلام اختصاصی');
    await service.updateSetting('en.welcome', 'Custom Welcome');

    expect(service.getCustomizedKeys('fa')).toContain('welcome');
    expect(service.getCustomizedKeys('en')).toContain('welcome');

    const searchFa = service.searchTranslations('سلام اختصاصی', 'fa');
    expect(searchFa).toContain('welcome');

    const searchEn = service.searchTranslations('Custom Welcome', 'en');
    expect(searchEn).toContain('welcome');
  });
});
