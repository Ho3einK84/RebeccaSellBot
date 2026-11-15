import { describe, expect, it, vi } from 'vitest';
import {
  ensurePersianLineDirection,
  formatPackageButtonLabel,
  formatSubscriptionLink,
  localizedPackageName,
  observedContextLocale,
  resolveContextLocale,
  t,
  tm,
  type LocaleAwareContext,
} from '../../src/telegram/locale.js';
import { escapeTelegramMarkdown } from '../../src/telegram/rendering.js';
import type { MenuContext } from '../../src/telegram/types.js';

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

describe('Telegram locale resolution and translation helpers', () => {
  it('normalizes Telegram English locale variants and respects durable user preferences', () => {
    const ctx = context('en-US');
    expect(resolveContextLocale(ctx)).toBe('en');
    expect(t(ctx, 'welcome')).toBe('translated:en');
    expect(ctx.services?.translationService.get).toHaveBeenCalledWith('welcome', 'en', undefined);

    ctx.userLocale = 'fa';
    expect(resolveContextLocale(ctx)).toBe('fa');
    expect(t(ctx, 'welcome')).toBe('translated:fa');
  });

  it('handles unsupported languages, missing service, and omitted Telegram language_code', () => {
    expect(resolveContextLocale(context('de-DE', () => 'en'))).toBe('en');

    const fallbackCtx = { from: { language_code: 'fa-IR' } } as MenuContext;
    expect(resolveContextLocale(fallbackCtx)).toBe('fa');
    expect(t(fallbackCtx, 'welcome')).toBe('welcome');

    const omittedCtx = context(undefined, () => 'en');
    expect(resolveContextLocale(omittedCtx)).toBe('en');
    expect(observedContextLocale(omittedCtx)).toBeUndefined();
  });

  it('renders HTTPS subscription URLs safely and rejects relative paths', () => {
    const url = 'https://panel.example.com:2087/sub/b0e112fa874aa70cf74f91110b8b73bd';
    expect(formatSubscriptionLink(url, 'Unavailable')).toBe(`[${url}](${url})`);
    expect(formatSubscriptionLink('/sub/relative', 'Unavailable')).toBe('Unavailable');
  });

  it('escapes Markdown controls in tm() while preserving trusted code-span keys', () => {
    expect(escapeTelegramMarkdown('plan_(30 days) [beta] \\ path')).toBe(
      'plan\\_(30 days) \\[beta] \\\\ path'
    );

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

  it('localizes custom volume, bilingual pipe, and Persian/English package names', () => {
    const ctxFa = {
      from: { language_code: 'fa' },
      userLocale: 'fa',
      services: {
        translationService: {
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => (key === 'traffic_unit_gb' ? 'گیگابایت' : key)),
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

    expect(localizedPackageName(ctxFa, 'custom_30gb_30d', '30 GB')).toBe('۳۰ گیگابایت');
    expect(localizedPackageName(ctxFa, 'pkg_custom_1', 'پلن طلایی | Gold Plan')).toBe('پلن طلایی');
    expect(localizedPackageName(ctxEn, 'pkg_custom_1', 'پلن طلایی | Gold Plan')).toBe('Gold Plan');
    expect(localizedPackageName(ctxEn, 'pkg_50gb', '۵۰ گیگ')).toBe('50 GB');
    expect(localizedPackageName(ctxEn, 'pkg_50gb_30d', '۵۰ گیگ · ۳۰ روز')).toBe('50 GB · 30 days');
  });

  it('keeps Latin-first Persian lines RTL without breaking pure English lines', () => {
    const rendered = ensurePersianLineDirection(
      '🛡️ مدیریت ادمین‌ها\nADMIN_IDS فقط برای راه‌اندازی است.\n`https://panel.example`'
    );
    expect(rendered).toBe(
      '🛡️ مدیریت ادمین‌ها\n\u200fADMIN_IDS فقط برای راه‌اندازی است.\n\u200f`https://panel.example`'
    );
    expect(ensurePersianLineDirection('Check the package and final amount.')).toBe(
      'Check the package and final amount.'
    );
    expect(ensurePersianLineDirection('ADMIN_IDS')).toBe('ADMIN_IDS');
  });
});

describe('packageDisplayMode button formatting', () => {
  const pkg = {
    id: 'pkg_vip_100gb',
    name: '100 GB - 60 Days',
    price: 150_000,
    gbAmount: 100,
    durationDays: 60,
  };

  it('renders volume + days + price in specs mode and infers missing specs from package ID', () => {
    const translationService = {
      getSetting: vi.fn(() => 'specs'),
      resolveLocale: vi.fn(() => 'fa'),
      get: vi.fn((key: string, _loc?: string, params?: Record<string, string | number>) => {
        if (key === 'package_button_specs')
          return `📦 ${params?.volume} · ${params?.days} · ${params?.price} تومان`;
        if (key === 'traffic_unit_gb') return 'گیگ';
        if (key === 'days_unit') return 'روز';
        return key;
      }),
    };
    const ctx = { services: { translationService } } as unknown as LocaleAwareContext;

    expect(formatPackageButtonLabel(ctx as MenuContext, pkg)).toBe(
      '📦 ۱۰۰ گیگ · ۶۰ روز · ۱۵۰٬۰۰۰ تومان'
    );
    expect(
      formatPackageButtonLabel(ctx as MenuContext, {
        id: 'custom_50gb_30d',
        name: 'Custom',
        price: 200_000,
      })
    ).toBe('📦 ۵۰ گیگ · ۳۰ روز · ۲۰۰٬۰۰۰ تومان');
  });

  it('renders package name only in name mode while preserving custom stock-ID names', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => 'name'),
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) =>
            key === 'package_pkg_50gb_30d_name' ? '۵۰ گیگ · ۳۰ روز' : key
          ),
        },
      },
    } as unknown as LocaleAwareContext;

    expect(formatPackageButtonLabel(ctx as MenuContext, pkg)).toBe('100 گیگ - 60 Days');
    expect(
      formatPackageButtonLabel(ctx as MenuContext, {
        id: 'pkg_50gb_30d',
        name: 'سرویس پیش فرض',
        price: 150_000,
        gbAmount: 50,
        durationDays: 30,
      })
    ).toBe('سرویس پیش فرض');
  });
});
