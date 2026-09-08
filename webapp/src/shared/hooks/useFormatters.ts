import { useCallback } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import {
  formatMoney as formatMoneyUtil,
  formatNumber as formatNumberUtil,
  formatIsoDate as formatIsoDateUtil,
  getAvatarChar as getAvatarCharUtil,
  sanitizeDisplayName as sanitizeDisplayNameUtil,
} from '@/shared/lib/formatters.js';

export function useFormatters() {
  const { locale } = useLanguage();

  const formatMoney = useCallback((amount: number) => formatMoneyUtil(amount, locale), [locale]);

  const formatNumber = useCallback((num: number) => formatNumberUtil(num, locale), [locale]);

  const formatIsoDate = useCallback(
    (isoString?: string | null) => formatIsoDateUtil(isoString, locale),
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

  return {
    formatMoney,
    formatNumber,
    formatIsoDate,
    getAvatarChar,
    sanitizeDisplayName,
  };
}
