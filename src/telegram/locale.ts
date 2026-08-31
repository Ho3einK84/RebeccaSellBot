/**
 * Telegram locale helpers.
 *
 * Telegram exposes the user's client language on every update, but it does
 * not provide a durable preference we can safely infer.  We therefore use
 * English only for `en` language codes and keep Persian as the product
 * default for every other locale.  TranslationService owns the DB cache and
 * fallback chain; this file deliberately contains no bot copy.
 */
import type { Context } from 'grammy';
import type { BotServices } from './types.js';
import type { SupportedLocale } from '../domain/services/TranslationService.js';
import { escapeTelegramMarkdownParams } from './rendering.js';

export type TranslationParams = Record<string, string | number>;

const DEFAULT_MARKDOWN_TRUSTED_KEYS = [
  'sub_url',
  'username',
  'promo_code',
  'ref_link',
  'code',
  'key',
  'uuid',
  'endpoint',
] as const;

type LocaleAwareContext = Pick<Context, 'from'> & {
  services?: Pick<BotServices, 'translationService'>;
  userLocale?: SupportedLocale;
};

/**
 * Normalize Persian (۰-۹) and Arabic (٠-٩) digits into ASCII digits (0-9)
 * and strip common formatting separators (, _ ، ٬ spaces).
 */
export function normalizeInputDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,_،٬\s]/gu, '');
}

/**
 * Format a labeled value ensuring the Latin value comes after a Persian label or emoji prefix.
 */
export function formatRtlLabeledValue(
  label: string,
  value: string | number,
  emoji?: string
): string {
  const prefix = emoji ? `${emoji} ${label}` : label;
  return `${prefix}: ${value}`;
}

/**
 * Let TranslationService apply its configured default locale when it is
 * available.  The structural optional type keeps this helper safe while the
 * service is bootstrapping or in focused handler tests.
 */
export function resolveContextLocale(ctx: LocaleAwareContext): SupportedLocale {
  if (ctx.userLocale === 'en' || ctx.userLocale === 'fa') return ctx.userLocale;
  return resolveServiceLocale(ctx.services?.translationService, ctx.from?.language_code);
}

/**
 * Return a locale only when Telegram actually supplied a language code. This
 * prevents an update without `language_code` from overwriting a previously
 * persisted English preference with the default Persian locale.
 */
export function observedContextLocale(ctx: LocaleAwareContext): SupportedLocale | undefined {
  return ctx.from?.language_code
    ? resolveServiceLocale(ctx.services?.translationService, ctx.from.language_code)
    : undefined;
}

export function resolveServiceLocale(
  translationService: BotServices['translationService'] | undefined,
  rawLocale?: string
): SupportedLocale {
  const localeAwareService = translationService as
    | (BotServices['translationService'] & {
        resolveLocale?: (rawLocale?: string) => string;
      })
    | undefined;
  const resolved = localeAwareService?.resolveLocale?.(rawLocale);
  if (resolved === 'en' || resolved === 'fa') return resolved;
  return rawLocale?.toLowerCase().startsWith('en') ? 'en' : 'fa';
}

export const EMOJI_PREFIX_REGEX =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\uE0020-\uE007F])*\s*)+/u;

export function stripLeadingEmoji(text: string): string {
  return text.replace(EMOJI_PREFIX_REGEX, '').trimStart();
}

/**
 * Resolve a user-facing key through the dynamic, DB-backed translation
 * service. Context service injection happens before all handlers, but the
 * key itself is retained as a defensive last-resort value for isolated tests
 * and malformed contexts.
 */
export function t(ctx: LocaleAwareContext, key: string, params?: TranslationParams): string {
  const locale = resolveContextLocale(ctx);
  const value = ctx.services?.translationService.get(key, locale, params) ?? key;
  return locale === 'fa' ? ensurePersianLineDirection(value) : ensureEnglishLineDirection(value);
}

/**
 * Resolve a legacy-Markdown Telegram template with every dynamic value
 * escaped. Constrained identifiers and generated links that templates place
 * inside inline-code markers remain raw so Telegram does not display escape
 * backslashes inside the code entity.
 */
export function tm(
  ctx: LocaleAwareContext,
  key: string,
  params?: TranslationParams,
  trustedKeys: readonly string[] = DEFAULT_MARKDOWN_TRUSTED_KEYS
): string {
  return t(ctx, key, escapeTelegramMarkdownParams(params, trustedKeys));
}

export function tForLocale(
  translationService: BotServices['translationService'],
  locale: SupportedLocale,
  key: string,
  params?: TranslationParams
): string {
  const value = translationService.get(key, locale, params);
  return locale === 'fa' ? ensurePersianLineDirection(value) : ensureEnglishLineDirection(value);
}

export function tmForLocale(
  translationService: BotServices['translationService'],
  locale: SupportedLocale,
  key: string,
  params?: TranslationParams,
  trustedKeys: readonly string[] = DEFAULT_MARKDOWN_TRUSTED_KEYS
): string {
  const value = translationService.get(
    key,
    locale,
    escapeTelegramMarkdownParams(params, trustedKeys)
  );
  return locale === 'fa' ? ensurePersianLineDirection(value) : ensureEnglishLineDirection(value);
}

/** Force every Persian Telegram line to RTL even when it begins with Latin text, @handles, or a URL. */
export function ensurePersianLineDirection(value: string): string {
  if (!value || !/[\u0600-\u06ff]/u.test(value)) return value;
  const rlm = '\u200f';
  const lrm = '\u200e';
  return value
    .split('\n')
    .map((line) => {
      if (!line || line.startsWith(rlm) || line.includes(lrm)) return line;
      const strippedMarkdown = line.replace(/^[\s*_`[\]()#-]+/u, '');
      const textAfterEmoji = stripLeadingEmoji(strippedMarkdown).replace(/^[\s*_`[\]()#-]+/u, '');
      const candidate = textAfterEmoji || strippedMarkdown;
      if (/^[@A-Za-z0-9]/u.test(candidate)) {
        return `${rlm}${line}`;
      }
      return line;
    })
    .join('\n');
}

/** Force every English Telegram line to LTR and strip accidental RTL marks. */
export function ensureEnglishLineDirection(value: string): string {
  if (!value) return value;
  const lrm = '\u200e';
  const rlm = '\u200f';
  return value
    .split('\n')
    .map((line) => {
      if (!line) return line;
      const clean = line.replaceAll(rlm, '');
      if (clean.startsWith(lrm)) return clean;
      if (/[\u0600-\u06ff]/u.test(clean)) {
        return `${lrm}${clean}`;
      }
      return clean;
    })
    .join('\n');
}

export const APPLICATION_TIMEZONE = process.env.TIMEZONE || 'Asia/Tehran';

export function localizedNumber(value: number, ctx: LocaleAwareContext): string {
  return value.toLocaleString(resolveContextLocale(ctx) === 'fa' ? 'fa-IR' : 'en-US');
}

export function localizedDate(
  value: Date,
  ctx: LocaleAwareContext,
  timeZone = APPLICATION_TIMEZONE
): string {
  return value.toLocaleDateString(resolveContextLocale(ctx) === 'fa' ? 'fa-IR' : 'en-US', {
    timeZone,
  });
}

export function localizedDateTime(
  value: Date,
  ctx: LocaleAwareContext,
  timeZone = APPLICATION_TIMEZONE
): string {
  const localeStr = resolveContextLocale(ctx) === 'fa' ? 'fa-IR' : 'en-US';
  const d = value.toLocaleDateString(localeStr, { timeZone });
  const t = value.toLocaleTimeString(localeStr, { hour: '2-digit', minute: '2-digit', timeZone });
  return `${d} ${t}`;
}

export function localizedNumberForLocale(value: number, locale: SupportedLocale): string {
  return value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
}

export function localizedDateForLocale(
  value: Date,
  locale: SupportedLocale,
  timeZone = APPLICATION_TIMEZONE
): string {
  return value.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US', { timeZone });
}

/**
 * Render a full HTTPS subscription address as a Telegram Markdown link. The
 * API client expands relative Rebecca paths before they reach this formatter.
 */
export function formatSubscriptionLink(url: string | undefined, unavailable: string): string {
  if (!url) return unavailable;
  try {
    const normalized = new URL(url);
    if (normalized.protocol !== 'https:') return unavailable;
    const value = normalized.toString();
    const label = value.replace(/([\\[\]_*`])/gu, '\\$1');
    const target = value.replace(/([\\()])/gu, '\\$1');
    return `[${label}](${target})`;
  } catch {
    return unavailable;
  }
}

const DEFAULT_PACKAGE_FALLBACK_NAMES = new Set([
  '10 GB - 30 Days',
  '30 GB - 30 Days',
  '50 GB - 30 Days',
  '100 GB - 60 Days',
]);

/**
 * Localize package names, with fallback to configured package name.
 *
 * Supports:
 * 1. Generated custom package IDs (custom_10gb_30d).
 * 2. Bilingual separator: "نام فارسی | English Name".
 * 3. Catalog translations (package_pkg_10gb_30d_name).
 * 4. Automatic smart volume/day translation between English and Persian.
 */
export function localizedPackageName(
  ctx: LocaleAwareContext,
  packageId: string,
  fallback: string
): string {
  const isFa = resolveContextLocale(ctx) === 'fa';

  const customMatch = /^custom_(\d+)gb(?:_(\d+)d)?$/i.exec(packageId);
  if (customMatch) {
    const gbAmount = Number(customMatch[1]);
    const gb = localizedNumber(gbAmount, ctx);
    const unit = t(ctx, 'traffic_unit_gb');
    return `${gb} ${unit}`;
  }

  if (fallback && fallback.includes('|')) {
    const parts = fallback.split('|').map((s) => s.trim());
    const faPart = parts[0] || '';
    const enPart = parts[1] || faPart;
    return isFa ? faPart : enPart;
  }

  if (fallback && !DEFAULT_PACKAGE_FALLBACK_NAMES.has(fallback.trim())) {
    if (isFa) {
      return fallback.replace(/\b(\d+)\s*GB\b/gi, '$1 گیگ');
    }
    // In English locale, translate Persian-named fallback (e.g. "۵۰ گیگ" -> "50 GB")
    const faDigitsToEn = (str: string) =>
      str.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const normalizedFallback = faDigitsToEn(fallback);
    const match = /^(\d+)\s*(?:گیگ|گیگابایت)(?:\s*[-·]\s*(\d+)\s*روز)?$/i.exec(
      normalizedFallback.trim()
    );
    if (match) {
      const gb = match[1];
      const days = match[2];
      if (days) {
        return `${gb} GB · ${days} days`;
      }
      return `${gb} GB`;
    }
    return fallback;
  }

  const key = `package_${packageId}_name`;
  const translated = t(ctx, key);
  if (translated !== key) {
    return translated;
  }
  if (isFa) {
    return fallback.replace(/\b(\d+)\s*GB\b/gi, '$1 گیگ');
  }
  return fallback;
}

export function formatPackageButtonLabel(
  ctx: LocaleAwareContext & {
    services?: { translationService?: { getSetting: (k: string, d?: string) => string } };
  },
  pkg: {
    id: string;
    name: string;
    price: number;
    gbAmount?: number;
    durationDays?: number;
  },
  options?: {
    effectivePrice?: number;
    tag?: string;
  }
): string {
  const displayMode =
    ctx.services?.translationService?.getSetting('package_display_mode', 'specs') ?? 'specs';
  const tag = options?.tag ?? '';
  const effectivePrice = options?.effectivePrice ?? pkg.price;

  if (displayMode === 'name') {
    const name = localizedPackageName(ctx, pkg.id, pkg.name);
    return `${tag}${name}`;
  }

  let gbAmount = pkg.gbAmount;
  let durationDays = pkg.durationDays;

  if (gbAmount === undefined || durationDays === undefined) {
    const match = /^(?:pkg|custom)_(\d+)gb(?:_(\d+)d)?$/i.exec(pkg.id);
    if (match) {
      if (gbAmount === undefined) gbAmount = Number(match[1]);
      if (durationDays === undefined && match[2]) durationDays = Number(match[2]);
    }
  }

  if (gbAmount !== undefined && durationDays !== undefined && gbAmount > 0 && durationDays > 0) {
    const volume = `${localizedNumber(gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`;
    const days = `${localizedNumber(durationDays, ctx)} ${t(ctx, 'days_unit')}`;
    const price = localizedNumber(effectivePrice, ctx);
    return `${tag}${t(ctx, 'package_button_specs', { volume, days, price })}`;
  }

  if (gbAmount !== undefined && gbAmount > 0) {
    const volume = `${localizedNumber(gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`;
    const price = localizedNumber(effectivePrice, ctx);
    return `${tag}${t(ctx, 'package_button', { name: volume, price })}`;
  }

  const name = localizedPackageName(ctx, pkg.id, pkg.name);
  return `${tag}${t(ctx, 'package_button', { name, price: localizedNumber(effectivePrice, ctx) })}`;
}
