/**
 * Database-backed settings and translation service.
 *
 * The `settings` table deliberately remains a generic string key/value store:
 * operational values and locale-qualified bot copy use the same durable
 * persistence path. The in-memory map contains only committed database
 * overrides; hardcoded defaults stay separate so a missing, deleted, or
 * temporarily unreadable row can never make a bot handler fail.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { settings } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import {
  CONFIGURATION_DEFAULTS,
  DEFAULT_LOCALE,
  DEFAULT_SETTINGS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './TranslationCatalog.js';
import { FA_TEXTS } from './TranslationCatalog.fa.js';

export { DEFAULT_LOCALE, DEFAULT_SETTINGS, SUPPORTED_LOCALES } from './TranslationCatalog.js';
export type { SupportedLocale } from './TranslationCatalog.js';

export type TranslationServiceOptions = {
  /** Used when no usable Telegram/user locale is available. */
  defaultLocale?: string;
};

export class TranslationService {
  /** Only committed DB overrides live here; defaults are never mutable cache state. */
  private cache = new Map<string, string>();
  private readonly defaultLocale: SupportedLocale;

  constructor(options: TranslationServiceOptions = {}) {
    this.defaultLocale = normalizeLocale(options.defaultLocale, DEFAULT_LOCALE);
  }

  async init(): Promise<void> {
    await this.reloadCache();
  }

  /**
   * Load DB overrides into a new map and swap it in one assignment. Existing
   * readers see either the prior complete cache or the new complete cache,
   * never a transient empty/partially populated map.
   */
  async reloadCache(): Promise<void> {
    try {
      const rows = await getDb().select().from(settings);
      this.cache = new Map(rows.map((row) => [row.key, row.value]));
      logger.info({ overrides: this.cache.size }, 'Translation and settings cache loaded');
    } catch (err) {
      // Do not retain potentially stale overrides after a failed reload. All
      // reads now use the immutable hardcoded fallback set until DB recovery.
      this.cache = new Map();
      logger.error(
        { errorName: err instanceof Error ? err.name : typeof err },
        'Failed to load settings cache; using hardcoded defaults'
      );
    }
  }

  /** Resolve Telegram-style locale values such as `fa-IR` and `en_US`. */
  resolveLocale(locale?: string): SupportedLocale {
    return normalizeLocale(locale, this.getDefaultLocale());
  }

  getDefaultLocale(): SupportedLocale {
    const configured = this.cache.get('default_locale');
    return normalizeLocale(configured, this.defaultLocale);
  }

  /** Enumerate the stable text catalogue available to the Telegram editor. */
  getTranslationKeys(): string[] {
    return Object.keys(FA_TEXTS).sort();
  }

  hasTranslationKey(key: string): boolean {
    return Object.hasOwn(FA_TEXTS, key);
  }

  /**
   * Resolve a localized bot string. Translation lookup deliberately never
   * falls through to an unqualified setting key: a missing `en.foo` must use
   * a known language fallback, not accidentally expose an operational value.
   */
  get(key: string, locale?: string, params?: Record<string, string | number>): string {
    const { messageKey, requestedLocale } = this.parseTranslationKey(key, locale);
    const activeDefault = this.getDefaultLocale();
    const localeOrder = uniqueLocales([
      requestedLocale,
      activeDefault,
      this.defaultLocale,
      DEFAULT_LOCALE,
      ...SUPPORTED_LOCALES,
    ]);
    const qualifiedKeys = localeOrder.map((candidateLocale) => `${candidateLocale}.${messageKey}`);

    // Resolve one locale at a time: its persisted override, then its
    // immutable fallback, before considering another locale. A customized FA
    // string must therefore never displace a valid hardcoded EN string.
    const value =
      firstDefined(qualifiedKeys, (candidate) => this.resolveTranslationTemplate(candidate)) ?? key;

    const rendered = interpolate(value, params);
    // Check placeholders that belong to the translation template, not braces
    // introduced by a replacement value. Naming-template values intentionally
    // contain literals such as `{telegram_id}` and must survive interpolation.
    if (!hasMissingTemplatePlaceholders(value, params)) return rendered;

    const hardcodedFallback =
      firstDefined(qualifiedKeys, (candidate) => DEFAULT_SETTINGS[candidate]) ?? value;
    const safeFallback = interpolate(hardcodedFallback, params).replaceAll(
      /\{[a-z0-9_]+\}/giu,
      '—'
    );
    logger.warn({ key: messageKey }, 'Translation rendered with missing placeholder values');
    return safeFallback;
  }

  getSetting(key: string, defaultValue?: string): string {
    return this.cache.get(key) ?? DEFAULT_SETTINGS[key] ?? defaultValue ?? '';
  }

  /** Return only a committed database override, never a hardcoded fallback. */
  getStoredSetting(key: string): string | undefined {
    return this.cache.get(key);
  }

  getSettingNum(key: string, defaultValue = 0): number {
    const value = this.getSetting(key);
    if (value.trim() === '') return defaultValue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  getSettingBool(key: string, defaultValue = false): boolean {
    switch (this.getSetting(key).trim().toLowerCase()) {
      case 'true':
      case '1':
        return true;
      case 'false':
      case '0':
        return false;
      default:
        return defaultValue;
    }
  }

  /**
   * Persist a setting first, then atomically replace the local cache entry.
   * A failed write therefore cannot leak an uncommitted value into handlers.
   */
  async updateSetting(key: string, value: string): Promise<void> {
    assertValidTranslationOverride(key, value);
    const now = new Date();
    await getDb()
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });

    const nextCache = new Map(this.cache);
    nextCache.set(key, value);
    this.cache = nextCache;
    logger.info({ key }, 'Setting persisted and local cache updated');
  }

  /**
   * Bulk changes are transactional. The cache remains untouched until the
   * transaction commits, then receives every edit in one map replacement.
   */
  async updateSettings(pairs: Record<string, string>): Promise<void> {
    const entries = Object.entries(pairs);
    if (entries.length === 0) return;
    for (const [key, value] of entries) assertValidTranslationOverride(key, value);

    const now = new Date();
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(settings)
          .values({ key, value, updatedAt: now })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
      }
    });

    const nextCache = new Map(this.cache);
    for (const [key, value] of entries) nextCache.set(key, value);
    this.cache = nextCache;
    logger.info({ count: entries.length }, 'Settings persisted and local cache updated');
  }

  /** Delete an override and immediately reveal its immutable fallback, if any. */
  async deleteSetting(key: string): Promise<void> {
    await getDb().delete(settings).where(eq(settings.key, key));
    const nextCache = new Map(this.cache);
    nextCache.delete(key);
    this.cache = nextCache;
    logger.info({ key }, 'Setting override deleted and local cache updated');
  }

  /** Return the effective settings view (defaults overlaid by DB overrides). */
  getAllSettings(): Record<string, string> {
    return Object.fromEntries(new Map([...Object.entries(DEFAULT_SETTINGS), ...this.cache]));
  }

  /** Seed missing configuration defaults and sync stock translation copy. */
  async ensureDefaultSettings(): Promise<void> {
    const now = new Date();
    const db = getDb();

    await db
      .insert(settings)
      .values(
        Object.entries(CONFIGURATION_DEFAULTS).map(([key, value]) => ({
          key,
          value,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing();

    // Clean up auto-seeded stock translation keys from settings table so the bot
    // uses the latest code defaults in DEFAULT_SETTINGS, while preserving admin edits.
    try {
      const rows = await db.select().from(settings);
      for (const row of rows) {
        if (!row.key.startsWith('fa.') && !row.key.startsWith('en.')) continue;
        const codeDefault = DEFAULT_SETTINGS[row.key];
        if (!codeDefault) continue;

        // Equality is the only safe evidence that a row was auto-seeded. Emoji
        // heuristics previously deleted legitimate administrator copy.
        if (row.value === codeDefault) {
          await db.delete(settings).where(eq(settings.key, row.key));
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to sync stock translation settings');
    }

    await this.reloadCache();
  }

  private parseTranslationKey(
    key: string,
    locale?: string
  ): { messageKey: string; requestedLocale: SupportedLocale } {
    const explicitLocale = key.match(/^(fa|en)\.(.+)$/iu);
    if (explicitLocale) {
      return {
        messageKey: explicitLocale[2]!,
        requestedLocale: normalizeLocale(explicitLocale[1], this.defaultLocale),
      };
    }
    return { messageKey: key, requestedLocale: this.resolveLocale(locale) };
  }

  private resolveTranslationTemplate(qualifiedKey: string): string | undefined {
    const hardcoded = DEFAULT_SETTINGS[qualifiedKey];
    const override = this.cache.get(qualifiedKey);
    if (override === undefined) return hardcoded;
    return isValidTranslationOverride(override, hardcoded) ? override : hardcoded;
  }
}

export function normalizeLocale(
  locale: string | undefined,
  fallback: SupportedLocale = DEFAULT_LOCALE
): SupportedLocale {
  const primary = locale?.trim().toLowerCase().split(/[-_]/u)[0];
  return primary === 'fa' || primary === 'en' ? primary : fallback;
}

function uniqueLocales(locales: readonly SupportedLocale[]): SupportedLocale[] {
  return [...new Set(locales)];
}

function firstDefined(
  keys: readonly string[],
  read: (key: string) => string | undefined
): string | undefined {
  for (const key of keys) {
    const value = read(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function interpolate(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  let rendered = value;
  for (const [key, param] of Object.entries(params)) {
    const replacement = String(param);
    // Older persisted copy placed subscription URLs in inline-code markers.
    // A Markdown link must not be wrapped in code, otherwise Telegram renders
    // the literal text instead of a tappable full URL.
    if (key === 'sub_url' && replacement.startsWith('[https://')) {
      rendered = rendered.replaceAll('`{' + key + '}`', replacement);
    }
    rendered = rendered.replaceAll(`{${key}}`, replacement);
  }
  return rendered;
}

export function templatePlaceholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{([a-z0-9_]+)\}/giu)].map((match) => match[1]!))].sort();
}

export function isValidTranslationOverride(value: string, hardcoded?: string): boolean {
  if (!value.trim() || value.length > 4_096) return false;
  if (hardcoded === undefined) return true;
  return arraysEqual(templatePlaceholders(value), templatePlaceholders(hardcoded));
}

function assertValidTranslationOverride(key: string, value: string): void {
  if (!/^(fa|en)\./u.test(key)) return;
  if (!isValidTranslationOverride(value, DEFAULT_SETTINGS[key])) {
    throw new Error('TRANSLATION_TEMPLATE_INVALID');
  }
}

function hasMissingTemplatePlaceholders(
  template: string,
  params?: Record<string, string | number>
): boolean {
  return templatePlaceholders(template).some((key) => !params || !Object.hasOwn(params, key));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
