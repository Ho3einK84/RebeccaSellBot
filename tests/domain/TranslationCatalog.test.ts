import { describe, expect, it } from 'vitest';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';

describe('Translation Catalog Parity and Standard', () => {
  it('has identical key sets in Persian and English catalogs', () => {
    const faKeys = Object.keys(FA_TEXTS).sort();
    const enKeys = Object.keys(EN_TEXTS).sort();

    expect(faKeys).toEqual(enKeys);
    expect(faKeys.length).toBe(1011);
  });

  it('contains no missing ZWNJ errors in Persian catalog for common compound patterns', () => {
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
      /بسته های/,
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

    const errors: string[] = [];

    for (const [key, text] of Object.entries(FA_TEXTS)) {
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          errors.push(`Key "${key}" failed pattern ${pattern}: "${text}"`);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('ensures parameter placeholders match between Persian and English entries', () => {
    const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;

    for (const key of Object.keys(FA_TEXTS)) {
      const faText = FA_TEXTS[key] ?? '';
      const enText = EN_TEXTS[key] ?? '';

      const faMatches = new Set([...faText.matchAll(placeholderRegex)].map((m) => m[1]));
      const enMatches = new Set([...enText.matchAll(placeholderRegex)].map((m) => m[1]));

      expect(faMatches, `Placeholder mismatch on key "${key}"`).toEqual(enMatches);
    }
  });
});
