import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import {
  formatSubscriptionLink,
  ensurePersianLineDirection,
  localizedPackageName,
  observedContextLocale,
  resolveContextLocale,
  t,
  tm,
} from '../../src/telegram/locale.js';
import { escapeTelegramMarkdown } from '../../src/telegram/rendering.js';

function context(languageCode?: string, resolveLocale?: (raw?: string) => string): MenuContext {
  const translationService = {
    resolveLocale: vi.fn(
      resolveLocale ?? ((raw?: string) => (raw?.startsWith('en') ? 'en' : 'fa'))
    ),
    get: vi.fn((_key: string, locale: string) => `translated:${locale}`),
  };
  return {
    from: { id: 1, is_bot: false, first_name: 'Test', language_code: languageCode },
    services: { translationService },
  } as unknown as MenuContext;
}

describe('Telegram locale resolution', () => {
  it('normalizes Telegram English locale variants through TranslationService', () => {
    const ctx = context('en-US');

    expect(resolveContextLocale(ctx)).toBe('en');
    expect(t(ctx, 'welcome')).toBe('translated:en');
    expect(ctx.services?.translationService.get).toHaveBeenCalledWith('welcome', 'en', undefined);
  });

  it('prefers the durable user selection over Telegram client language', () => {
    const ctx = context('en-US');
    ctx.userLocale = 'fa';

    expect(resolveContextLocale(ctx)).toBe('fa');
    expect(t(ctx, 'welcome')).toBe('translated:fa');
  });

  it('uses TranslationService default locale for an unsupported Telegram language', () => {
    const ctx = context('de-DE', () => 'en');

    expect(resolveContextLocale(ctx)).toBe('en');
  });

  it('falls back to Persian without an injected service', () => {
    const ctx = { from: { language_code: 'fa-IR' } } as MenuContext;

    expect(resolveContextLocale(ctx)).toBe('fa');
    expect(t(ctx, 'welcome')).toBe('welcome');
  });

  it('does not invent a persisted locale when Telegram omitted language_code', () => {
    const ctx = context(undefined, () => 'en');

    expect(resolveContextLocale(ctx)).toBe('en');
    expect(observedContextLocale(ctx)).toBeUndefined();
  });

  it('renders a complete HTTPS subscription URL as a clickable Markdown link', () => {
    const url = 'https://panel.example.com:2087/sub/b0e112fa874aa70cf74f91110b8b73bd';

    expect(formatSubscriptionLink(url, 'Unavailable')).toBe(`[${url}](${url})`);
    expect(formatSubscriptionLink('/sub/relative', 'Unavailable')).toBe('Unavailable');
  });

  it('escapes only legacy Markdown controls and preserves parentheses', () => {
    expect(escapeTelegramMarkdown('plan_(30 days) [beta] \\ path')).toBe(
      'plan\\_(30 days) \\[beta] \\\\ path'
    );
  });

  it('keeps trusted inline-code identifiers and links free of escape artifacts', () => {
    const template =
      '*Subscription:* `{username}`\n*Link:* `{sub_url}`\n*Promo:* `{promo_code}`\n{note}';
    const get = vi.fn((_key: string, _locale: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
        template
      )
    );
    const ctx = {
      from: { id: 1, is_bot: false, first_name: 'Test', language_code: 'en' },
      services: { translationService: { get, resolveLocale: vi.fn(() => 'en') } },
    } as unknown as MenuContext;
    const username = 'h_6698253699_8';
    const subUrl = `https://panel.example.com/sub/${username}`;

    expect(
      tm(ctx, 'subscription_test', {
        username,
        sub_url: subUrl,
        promo_code: 'SAVE_10',
        note: 'Standard (30 days)',
      })
    ).toBe(
      `*Subscription:* \`${username}\`\n*Link:* \`${subUrl}\`\n*Promo:* \`SAVE_10\`\nStandard (30 days)`
    );
  });

  it('localizes custom volume auto-renew package names in Persian', () => {
    const translationService = {
      resolveLocale: vi.fn(() => 'fa'),
      get: vi.fn((key: string) => (key === 'traffic_unit_gb' ? 'گیگابایت' : key)),
    };
    const ctx = {
      from: { language_code: 'fa' },
      userLocale: 'fa',
      services: { translationService },
    } as unknown as MenuContext;

    expect(localizedPackageName(ctx, 'custom_30gb_30d', '30 GB')).toBe('۳۰ گیگابایت');
  });

  it('supports bilingual pipe separator in package names', () => {
    const ctxFa = {
      from: { language_code: 'fa' },
      userLocale: 'fa',
      services: {
        translationService: {
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as MenuContext;

    const ctxEn = {
      from: { language_code: 'en' },
      userLocale: 'en',
      services: {
        translationService: {
          resolveLocale: vi.fn(() => 'en'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as MenuContext;

    expect(localizedPackageName(ctxFa, 'pkg_custom_1', 'پلن طلایی | Gold Plan')).toBe('پلن طلایی');
    expect(localizedPackageName(ctxEn, 'pkg_custom_1', 'پلن طلایی | Gold Plan')).toBe('Gold Plan');
  });

  it('automatically converts Persian package names to English when viewing in English locale', () => {
    const ctxEn = {
      from: { language_code: 'en' },
      userLocale: 'en',
      services: {
        translationService: {
          resolveLocale: vi.fn(() => 'en'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as MenuContext;

    expect(localizedPackageName(ctxEn, 'pkg_50gb', '۵۰ گیگ')).toBe('50 GB');
    expect(localizedPackageName(ctxEn, 'pkg_50gb_30d', '۵۰ گیگ · ۳۰ روز')).toBe('50 GB · 30 days');
  });

  it('keeps Latin-first Persian lines RTL without breaking pure English lines or punctuation', () => {
    const rendered = ensurePersianLineDirection(
      '🛡️ مدیریت ادمین‌ها\nADMIN_IDS فقط برای راه‌اندازی است.\n`https://panel.example`'
    );

    expect(rendered).toBe(
      '🛡️ مدیریت ادمین‌ها\n\u200fADMIN_IDS فقط برای راه‌اندازی است.\n\u200f`https://panel.example`'
    );
    expect(ensurePersianLineDirection('ADMIN_IDS فقط برای راه‌اندازی است.')).toBe(
      '\u200fADMIN_IDS فقط برای راه‌اندازی است.'
    );
    expect(ensurePersianLineDirection('Check the package and final amount.')).toBe(
      'Check the package and final amount.'
    );
    expect(ensurePersianLineDirection('ADMIN_IDS')).toBe('ADMIN_IDS');
  });
});
