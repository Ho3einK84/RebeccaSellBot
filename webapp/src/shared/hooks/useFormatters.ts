import { useCallback } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import {
  formatMoney as formatMoneyUtil,
  formatNumber as formatNumberUtil,
  formatDecimal as formatDecimalUtil,
  formatId as formatIdUtil,
  formatIsoDate as formatIsoDateUtil,
  formatBytes as formatBytesUtil,
  formatReceiptShortId as formatReceiptShortIdUtil,
  getAvatarChar as getAvatarCharUtil,
  sanitizeDisplayName as sanitizeDisplayNameUtil,
  toPersianDigits as toPersianDigitsUtil,
} from '@/shared/lib/formatters.js';

export function useFormatters() {
  const { locale } = useLanguage();

  const toPersianDigits = useCallback((value: string | number) => toPersianDigitsUtil(value), []);

  const formatMoney = useCallback((amount: number) => formatMoneyUtil(amount, locale), [locale]);

  const formatNumber = useCallback((num: number) => formatNumberUtil(num, locale), [locale]);

  const formatDecimal = useCallback(
    (num: number, maxFractionDigits?: number) => formatDecimalUtil(num, locale, maxFractionDigits),
    [locale]
  );

  const formatId = useCallback(
    (value: string | number | null | undefined) => formatIdUtil(value, locale),
    [locale]
  );

  const formatIsoDate = useCallback(
    (isoString?: string | null) => formatIsoDateUtil(isoString, locale),
    [locale]
  );

  const formatBytes = useCallback(
    (bytes?: number | null) => formatBytesUtil(bytes, locale),
    [locale]
  );

  const getAvatarChar = useCallback(
    (name?: string | null, username?: string | null) => getAvatarCharUtil(name, username),
    []
  );

  const sanitizeDisplayName = useCallback(
    (firstName?: string | null, lastName?: string | null, fallback?: string) =>
      sanitizeDisplayNameUtil(firstName, lastName, fallback),
    []
  );

  const formatReceiptShortId = useCallback(
    (receiptId: string) => formatIdUtil(formatReceiptShortIdUtil(receiptId), locale),
    [locale]
  );

  return {
    formatMoney,
    formatToman: formatMoney,
    formatNumber,
    formatDecimal,
    formatId,
    formatIsoDate,
    formatBytes,
    formatReceiptShortId,
    getAvatarChar,
    sanitizeDisplayName,
    toPersianDigits,
  };
}
