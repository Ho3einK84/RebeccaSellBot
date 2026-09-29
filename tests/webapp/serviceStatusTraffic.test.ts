import { describe, expect, it } from 'vitest';
import {
  getServiceStatusInfo,
  getServiceTrafficInfo,
  getServiceExpiryInfo,
  formatServiceCreatedDate,
  isAutoRenewActive,
} from '../../webapp/src/features/user-portal/components/ServiceStatusTraffic.js';
import { fa } from '../../webapp/src/shared/i18n/locales/fa.js';
import { en } from '../../webapp/src/shared/i18n/locales/en.js';

function createTranslator(dict: Record<string, unknown>) {
  return (key: string): string => {
    const parts = key.split('.');
    let cur: unknown = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return key;
      }
    }
    return typeof cur === 'string' ? cur : key;
  };
}

const tFa = createTranslator(fa as unknown as Record<string, unknown>);
const tEn = createTranslator(en as unknown as Record<string, unknown>);

describe('ServiceStatusTraffic Helper & Components', () => {
  describe('Status Mapping', () => {
    it('maps "active" status to green badge and pulsing green dot', () => {
      const faInfo = getServiceStatusInfo('active', tFa);
      expect(faInfo.type).toBe('active');
      expect(faInfo.label).toBe('فعال');
      expect(faInfo.isPulsing).toBe(true);
      expect(faInfo.dotClass).toContain('animate-pulse');
      expect(faInfo.dotClass).toContain('bg-emerald-500');
      expect(faInfo.badgeClass).toContain('bg-emerald-500');

      const enInfo = getServiceStatusInfo('active', tEn);
      expect(enInfo.label).toBe('Active');
      expect(enInfo.isPulsing).toBe(true);
    });

    it('maps "limited" status to amber badge and non-pulsing dot', () => {
      const faInfo = getServiceStatusInfo('limited', tFa);
      expect(faInfo.type).toBe('limited');
      expect(faInfo.label).toBe('پایان حجم');
      expect(faInfo.isPulsing).toBe(false);
      expect(faInfo.dotClass).not.toContain('animate-pulse');
      expect(faInfo.dotClass).toContain('bg-amber-500');
      expect(faInfo.badgeClass).toContain('bg-amber-500');

      const enInfo = getServiceStatusInfo('limited', tEn);
      expect(enInfo.label).toBe('Traffic Limit Reached');
      expect(enInfo.isPulsing).toBe(false);
    });

    it('maps "expired" status to rose badge and non-pulsing dot', () => {
      const faInfo = getServiceStatusInfo('expired', tFa);
      expect(faInfo.type).toBe('expired');
      expect(faInfo.label).toBe('منقضی شده');
      expect(faInfo.isPulsing).toBe(false);
      expect(faInfo.dotClass).not.toContain('animate-pulse');
      expect(faInfo.dotClass).toContain('bg-rose-500');
      expect(faInfo.badgeClass).toContain('bg-rose-500');

      const enInfo = getServiceStatusInfo('expired', tEn);
      expect(enInfo.label).toBe('Expired');
      expect(enInfo.isPulsing).toBe(false);
    });

    it('maps "disabled" status to gray badge and non-pulsing dot', () => {
      const faInfo = getServiceStatusInfo('disabled', tFa);
      expect(faInfo.type).toBe('disabled');
      expect(faInfo.label).toBe('غیرفعال');
      expect(faInfo.isPulsing).toBe(false);
      expect(faInfo.dotClass).not.toContain('animate-pulse');
      expect(faInfo.dotClass).toContain('bg-zinc-400');
      expect(faInfo.badgeClass).toContain('bg-zinc-500');

      const enInfo = getServiceStatusInfo('disabled', tEn);
      expect(enInfo.label).toBe('Disabled');
      expect(enInfo.isPulsing).toBe(false);
    });

    it('maps "on_hold" status to yellow badge and non-pulsing dot', () => {
      const faInfo = getServiceStatusInfo('on_hold', tFa);
      expect(faInfo.type).toBe('on_hold');
      expect(faInfo.label).toBe('در انتظار اتصال');
      expect(faInfo.isPulsing).toBe(false);
      expect(faInfo.dotClass).not.toContain('animate-pulse');
      expect(faInfo.dotClass).toContain('bg-yellow-500');
      expect(faInfo.badgeClass).toContain('bg-yellow-500');

      const enInfo = getServiceStatusInfo('on_hold', tEn);
      expect(enInfo.label).toBe('On Hold');
      expect(enInfo.isPulsing).toBe(false);
    });

    it('maps unknown, null, or undefined to gray badge with Unknown label and no pulse', () => {
      const nullInfo = getServiceStatusInfo(null, tFa);
      expect(nullInfo.type).toBe('unknown');
      expect(nullInfo.label).toBe('نامشخص');
      expect(nullInfo.isPulsing).toBe(false);
      expect(nullInfo.dotClass).not.toContain('animate-pulse');

      const undefInfo = getServiceStatusInfo(undefined, tEn);
      expect(undefInfo.type).toBe('unknown');
      expect(undefInfo.label).toBe('Unknown');
      expect(undefInfo.isPulsing).toBe(false);

      const otherInfo = getServiceStatusInfo('some_random_status', tEn);
      expect(otherInfo.type).toBe('unknown');
      expect(otherInfo.label).toBe('Unknown');
    });

    it('handles uppercase and trimmed status gracefully', () => {
      const activeUpper = getServiceStatusInfo('  ACTIVE  ', tFa);
      expect(activeUpper.type).toBe('active');
      expect(activeUpper.isPulsing).toBe(true);

      const limitedUpper = getServiceStatusInfo('LIMITED', tEn);
      expect(limitedUpper.type).toBe('limited');
      expect(limitedUpper.isPulsing).toBe(false);
    });
  });

  describe('Traffic Limit and Usage', () => {
    it('handles null or undefined data limits as unknown ("—")', () => {
      const nullLimitFa = getServiceTrafficInfo(null, 1024 * 1024 * 1024, 'fa', tFa);
      expect(nullLimitFa.isUnknownLimit).toBe(true);
      expect(nullLimitFa.isUnlimited).toBe(false);
      expect(nullLimitFa.formattedLimit).toBe('—');
      expect(nullLimitFa.formattedUsed).toBe('۱ گیگابایت');
      expect(nullLimitFa.percentage).toBeNull();

      const undefLimitEn = getServiceTrafficInfo(undefined, 500 * 1024 * 1024, 'en', tEn);
      expect(undefLimitEn.isUnknownLimit).toBe(true);
      expect(undefLimitEn.isUnlimited).toBe(false);
      expect(undefLimitEn.formattedLimit).toBe('—');
      expect(undefLimitEn.formattedUsed).toBe('500 MB');
      expect(undefLimitEn.percentage).toBeNull();
    });

    it('handles limit === 0 as unlimited and distinguishes it from null', () => {
      const unlimitedFa = getServiceTrafficInfo(0, 2 * 1024 * 1024 * 1024, 'fa', tFa);
      expect(unlimitedFa.isUnlimited).toBe(true);
      expect(unlimitedFa.isUnknownLimit).toBe(false);
      expect(unlimitedFa.formattedLimit).toBe('نامحدود');
      expect(unlimitedFa.formattedUsed).toBe('۲ گیگابایت');
      expect(unlimitedFa.percentage).toBeNull();

      const unlimitedEn = getServiceTrafficInfo(0, 500 * 1024 * 1024, 'en', tEn);
      expect(unlimitedEn.isUnlimited).toBe(true);
      expect(unlimitedEn.isUnknownLimit).toBe(false);
      expect(unlimitedEn.formattedLimit).toBe('Unlimited');
      expect(unlimitedEn.formattedUsed).toBe('500 MB');
      expect(unlimitedEn.percentage).toBeNull();
    });

    it('does NOT round limits under 0.5 GB down to 0 or show unlimited', () => {
      // 250 MB limit (< 0.5 GB)
      const limit250Mb = 250 * 1024 * 1024;
      const used125Mb = 125 * 1024 * 1024;

      const fa250 = getServiceTrafficInfo(limit250Mb, used125Mb, 'fa', tFa);
      expect(fa250.isUnlimited).toBe(false);
      expect(fa250.isUnknownLimit).toBe(false);
      expect(fa250.formattedLimit).toBe('۲۵۰ مگابایت');
      expect(fa250.formattedUsed).toBe('۱۲۵ مگابایت');
      expect(fa250.percentage).toBe(50);
      expect(fa250.progressColorClass).toBe('bg-indigo-500');

      const en250 = getServiceTrafficInfo(limit250Mb, used125Mb, 'en', tEn);
      expect(en250.isUnlimited).toBe(false);
      expect(en250.isUnknownLimit).toBe(false);
      expect(en250.formattedLimit).toBe('250 MB');
      expect(en250.formattedUsed).toBe('125 MB');
      expect(en250.percentage).toBe(50);

      // 400 MB limit (< 0.5 GB) with 100% usage
      const limit400Mb = 400 * 1024 * 1024;
      const en400 = getServiceTrafficInfo(limit400Mb, limit400Mb, 'en', tEn);
      expect(en400.isUnlimited).toBe(false);
      expect(en400.formattedLimit).toBe('400 MB');
      expect(en400.percentage).toBe(100);
      expect(en400.progressColorClass).toBe('bg-rose-500');
    });

    it('formats multi-gigabyte limits and calculates correct color thresholds', () => {
      const limit10Gb = 10 * 1024 * 1024 * 1024;

      // 50% usage
      const info50 = getServiceTrafficInfo(limit10Gb, 5 * 1024 * 1024 * 1024, 'en', tEn);
      expect(info50.formattedLimit).toBe('10 GB');
      expect(info50.formattedUsed).toBe('5 GB');
      expect(info50.percentage).toBe(50);
      expect(info50.progressColorClass).toBe('bg-indigo-500');

      // 80% usage
      const info80 = getServiceTrafficInfo(limit10Gb, 8 * 1024 * 1024 * 1024, 'en', tEn);
      expect(info80.percentage).toBe(80);
      expect(info80.progressColorClass).toBe('bg-amber-500');

      // 95% usage
      const info95 = getServiceTrafficInfo(limit10Gb, 9.5 * 1024 * 1024 * 1024, 'en', tEn);
      expect(info95.percentage).toBe(95);
      expect(info95.progressColorClass).toBe('bg-rose-500');
    });

    it('handles zero or null used traffic gracefully', () => {
      const zeroUsed = getServiceTrafficInfo(5 * 1024 * 1024 * 1024, 0, 'en', tEn);
      expect(zeroUsed.formattedUsed).toBe('0 B');
      expect(zeroUsed.percentage).toBe(0);

      const nullUsed = getServiceTrafficInfo(5 * 1024 * 1024 * 1024, null, 'en', tEn);
      expect(nullUsed.formattedUsed).toBe('0 B');
      expect(nullUsed.percentage).toBe(0);
    });
  });

  describe('Expiry and Remaining Days', () => {
    const fixedNowSec = 1700000000;

    it('handles null or undefined expiry as "—"', () => {
      const nullExp = getServiceExpiryInfo(null, 'fa', tFa, fixedNowSec);
      expect(nullExp.isExpired).toBe(false);
      expect(nullExp.remainingText).toBe('—');
      expect(nullExp.formattedDate).toBe('—');
      expect(nullExp.daysRemaining).toBeNull();

      const undefExp = getServiceExpiryInfo(undefined, 'en', tEn, fixedNowSec);
      expect(undefExp.isExpired).toBe(false);
      expect(undefExp.remainingText).toBe('—');
      expect(undefExp.formattedDate).toBe('—');
      expect(undefExp.daysRemaining).toBeNull();
    });

    it('detects expired timestamp (<= nowSec)', () => {
      // Exactly now
      const expNow = getServiceExpiryInfo(fixedNowSec, 'fa', tFa, fixedNowSec);
      expect(expNow.isExpired).toBe(true);
      expect(expNow.daysRemaining).toBe(0);
      expect(expNow.remainingText).toBe('منقضی شده');
      expect(expNow.formattedDate).not.toBe('—');

      // In the past
      const expPast = getServiceExpiryInfo(fixedNowSec - 3600, 'en', tEn, fixedNowSec);
      expect(expPast.isExpired).toBe(true);
      expect(expPast.daysRemaining).toBe(0);
      expect(expPast.remainingText).toBe('Expired');
    });

    it('detects less than 24 hours remaining (0 < diffSec < 86400)', () => {
      // 2 hours remaining
      const exp2hFa = getServiceExpiryInfo(fixedNowSec + 7200, 'fa', tFa, fixedNowSec);
      expect(exp2hFa.isExpired).toBe(false);
      expect(exp2hFa.daysRemaining).toBe(1);
      expect(exp2hFa.remainingText).toBe('کمتر از ۱ روز باقی‌مانده');

      const exp2hEn = getServiceExpiryInfo(fixedNowSec + 7200, 'en', tEn, fixedNowSec);
      expect(exp2hEn.isExpired).toBe(false);
      expect(exp2hEn.daysRemaining).toBe(1);
      expect(exp2hEn.remainingText).toBe('Less than a day remaining');

      // 86399 seconds remaining (just under 24h)
      const exp23h = getServiceExpiryInfo(fixedNowSec + 86399, 'fa', tFa, fixedNowSec);
      expect(exp23h.isExpired).toBe(false);
      expect(exp23h.remainingText).toBe('کمتر از ۱ روز باقی‌مانده');
    });

    it('formats multi-day remaining time with localized digits', () => {
      // Exactly 5 days (5 * 86400)
      const exp5dFa = getServiceExpiryInfo(fixedNowSec + 5 * 86400, 'fa', tFa, fixedNowSec);
      expect(exp5dFa.isExpired).toBe(false);
      expect(exp5dFa.daysRemaining).toBe(5);
      expect(exp5dFa.remainingText).toBe('۵ روز باقی‌مانده');

      const exp5dEn = getServiceExpiryInfo(fixedNowSec + 5 * 86400, 'en', tEn, fixedNowSec);
      expect(exp5dEn.isExpired).toBe(false);
      expect(exp5dEn.daysRemaining).toBe(5);
      expect(exp5dEn.remainingText).toBe('5 days left');

      // 12 days and 3 hours (ceil to 13 days)
      const exp13dFa = getServiceExpiryInfo(
        fixedNowSec + 12 * 86400 + 3 * 3600,
        'fa',
        tFa,
        fixedNowSec
      );
      expect(exp13dFa.daysRemaining).toBe(13);
      expect(exp13dFa.remainingText).toBe('۱۳ روز باقی‌مانده');
    });

    it('formats expiry date alongside remaining days', () => {
      const exp = getServiceExpiryInfo(fixedNowSec + 5 * 86400, 'en', tEn, fixedNowSec);
      expect(exp.formattedDate).toBe(
        new Date((fixedNowSec + 5 * 86400) * 1000).toLocaleDateString('en-US')
      );
    });
  });

  describe('Auto-Renew Indicator', () => {
    it('correctly checks whether auto-renew is active', () => {
      expect(isAutoRenewActive(true)).toBe(true);
      expect(isAutoRenewActive(false)).toBe(false);
      expect(isAutoRenewActive(null)).toBe(false);
      expect(isAutoRenewActive(undefined)).toBe(false);
    });
  });

  describe('Service Created Date', () => {
    it('formats created date with localized label', () => {
      const sampleDate = '2026-09-29T10:00:00.000Z';

      const faCreated = formatServiceCreatedDate(sampleDate, 'fa', tFa);
      expect(faCreated).toContain('تاریخ ایجاد:');

      const enCreated = formatServiceCreatedDate(sampleDate, 'en', tEn);
      expect(enCreated).toContain('Created:');

      const nullCreated = formatServiceCreatedDate(null, 'fa', tFa);
      expect(nullCreated).toBe('—');
    });
  });
});
