import { describe, expect, it } from 'vitest';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { DEFAULT_SETTINGS } from '../../src/domain/services/TranslationCatalog.js';
import { templatePlaceholders } from '../../src/domain/services/TranslationService.js';
import { escapeTelegramMarkdown, validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import { buildScreen } from '../../src/telegram/designSystem.js';

describe('Markdown validity for key detail screens', () => {
  it('validates buildScreen output for every key in FA and EN', () => {
    const keys = Object.keys(FA_TEXTS);
    const errors: string[] = [];

    for (const locale of ['fa', 'en'] as const) {
      for (const key of keys) {
        const qualifiedKey = `${locale}.${key}`;
        const defaultValue =
          DEFAULT_SETTINGS[qualifiedKey] ?? (locale === 'fa' ? FA_TEXTS[key] : EN_TEXTS[key]);
        const currentValue = defaultValue ?? '';
        const placeholders = templatePlaceholders(defaultValue ?? '');
        const placeholderInfoText =
          placeholders.length === 0
            ? 'هیچ متغیری ندارد'
            : placeholders.map((p) => `• {${escapeTelegramMarkdown(p)}}: توضیحات`).join('\n');

        const chars = [...currentValue];
        const visible = chars.slice(0, 800).join('');
        const currentPreview = { text: escapeTelegramMarkdown(visible) };

        const screen = buildScreen({
          emoji: '📝',
          title: 'ویرایشگر متن',
          subtitle: escapeTelegramMarkdown(`${key} · ${locale === 'fa' ? 'فارسی' : 'English'}`),
          primary: {
            emoji: '🔑',
            label: 'وضعیت',
            value: 'پیش‌فرض سیستم',
          },
          sections: [
            {
              emoji: '✏️',
              title: 'متن فعلی',
              fields: [{ label: '—', value: currentPreview.text }],
            },
            {
              emoji: '📚',
              title: 'متن پیش‌فرض',
              fields: [{ label: '—', value: currentPreview.text }],
            },
            {
              emoji: '💡',
              title: 'متغیرها',
              fields: [{ label: '—', value: placeholderInfoText }],
            },
          ],
        });

        const val = validateTelegramMarkdown(screen);
        if (!val.valid) {
          errors.push(`${qualifiedKey}: ${val.error}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
