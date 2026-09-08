import { describe, expect, it } from 'vitest';
import {
  toPersianDigits,
  formatMoney,
  formatNumber,
} from '../../webapp/src/shared/lib/formatters.js';
import { fa } from '../../webapp/src/shared/i18n/locales/fa.js';
import { en } from '../../webapp/src/shared/i18n/locales/en.js';

describe('Webapp Formatters', () => {
  it('converts ASCII digits to Persian digits', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    expect(toPersianDigits(12345)).toBe('۱۲۳۴۵');
    expect(toPersianDigits('Service ID: 42')).toBe('Service ID: ۴۲');
  });

  it('formats money with Persian digits and separator in fa locale, ASCII in en locale', () => {
    expect(formatMoney(1000000, 'fa')).toBe('۱٬۰۰۰٬۰۰۰');
    expect(formatMoney(50000, 'fa')).toBe('۵۰٬۰۰۰');
    expect(formatMoney(0, 'fa')).toBe('۰');

    expect(formatMoney(1000000, 'en')).toBe('1,000,000');
    expect(formatMoney(50000, 'en')).toBe('50,000');
    expect(formatMoney(0, 'en')).toBe('0');
  });

  it('formats numbers with Persian digits in fa locale, ASCII in en locale', () => {
    expect(formatNumber(1234, 'fa')).toBe('۱٬۲۳۴');
    expect(formatNumber(42, 'fa')).toBe('۴۲');
    expect(formatNumber(1234, 'en')).toBe('1,234');
    expect(formatNumber(42, 'en')).toBe('42');
  });
});

describe('Webapp i18n Locales Parity', () => {
  function getDeepKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        keys.push(...getDeepKeys(value as Record<string, unknown>, fullKey));
      } else {
        keys.push(fullKey);
      }
    }
    return keys.sort();
  }

  it('has identical keys between fa and en translations', () => {
    const faKeys = getDeepKeys(fa as unknown as Record<string, unknown>);
    const enKeys = getDeepKeys(en as unknown as Record<string, unknown>);

    const missingInEn = faKeys.filter((k) => !enKeys.includes(k));
    const missingInFa = enKeys.filter((k) => !faKeys.includes(k));

    expect(missingInEn).toEqual([]);
    expect(missingInFa).toEqual([]);
    expect(faKeys).toEqual(enKeys);
  });
});
