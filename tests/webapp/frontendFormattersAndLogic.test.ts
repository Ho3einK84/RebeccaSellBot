import { describe, expect, it } from 'vitest';
import {
  toPersianDigits,
  normalizeInputDigits,
  formatMoney,
  formatNumber,
  formatBytes,
  formatCardNumberSpaced,
  getAvatarChar,
  sanitizeDisplayName,
  formatIsoDate,
} from '../../webapp/src/shared/lib/formatters.js';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '../../webapp/src/shared/lib/transactionFormatters.js';
import { normalizeDataLimit } from '../../webapp/src/shared/lib/traffic.js';
import {
  getServiceStatusInfo,
  getServiceTrafficInfo,
  getServiceExpiryInfo,
  formatServiceCreatedDate,
  isAutoRenewActive,
} from '../../webapp/src/features/user-portal/components/ServiceStatusTraffic.js';
import {
  computeRevenueBarMetrics,
  computeSubscriptionSplit,
} from '../../webapp/src/features/admin/overview/components/OverviewAnalytics.js';
import type { DashboardStats } from '../../webapp/src/shared/types/admin.js';
import { fa } from '../../webapp/src/shared/i18n/locales/fa.js';
import { en } from '../../webapp/src/shared/i18n/locales/en.js';

function createTranslator<K extends string = string>(dict: Record<string, unknown>) {
  return (key: K): string => {
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

describe('Webapp Formatters & Locales', () => {
  it('converts ASCII digits to Persian digits', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    expect(toPersianDigits(12345)).toBe('۱۲۳۴۵');
    expect(toPersianDigits('Service ID: 42')).toBe('Service ID: ۴۲');
  });

  it('normalizes Persian and Arabic-Indic digits to ASCII digits for package inputs', () => {
    expect(normalizeInputDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeInputDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeInputDigits('۵۰')).toBe('50');
    expect(parseInt(normalizeInputDigits('۵۰'), 10)).toBe(50);
    expect(parseInt(normalizeInputDigits('١٠٠'), 10)).toBe(100);
    expect(normalizeInputDigits('۳۰ گیگ')).toBe('30 گیگ');
    expect(normalizeInputDigits('50')).toBe('50');
  });

  it('formats money and numbers consistently across fa/en locales and guards NaN/Infinity', () => {
    expect(formatMoney(1000000, 'fa')).toBe('۱٬۰۰۰٬۰۰۰');
    expect(formatMoney(50000, 'fa')).toBe('۵۰٬۰۰۰');
    expect(formatMoney(0, 'fa')).toBe('۰');
    expect(formatMoney(12.6, 'fa')).toBe('۱۳');

    expect(formatMoney(1000000, 'en')).toBe('1,000,000');
    expect(formatMoney(50000, 'en')).toBe('50,000');
    expect(formatMoney(0, 'en')).toBe('0');
    expect(formatMoney(12.6, 'en')).toBe('13');

    expect(formatMoney(Number.NaN, 'fa')).toBe('-');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'en')).toBe('-');

    expect(formatNumber(1234, 'fa')).toBe('۱٬۲۳۴');
    expect(formatNumber(42, 'fa')).toBe('۴۲');
    expect(formatNumber(1234, 'en')).toBe('1,234');
    expect(formatNumber(42, 'en')).toBe('42');
    expect(formatNumber(Number.NaN, 'en')).toBe('-');
  });

  it('formats 16-digit bank cards into 4-digit groups and normalizes Persian/Arabic numerals', () => {
    expect(formatCardNumberSpaced('6037997911112222')).toBe('6037 9979 1111 2222');
    expect(formatCardNumberSpaced('۶۰۳۷-۹۹۷۹-۱۱۱۱-۲۲۲۲')).toBe('6037 9979 1111 2222');
    expect(formatCardNumberSpaced('٦٠٣٧ ٩٩٧٩ ١١١١ ٢٢٢٢')).toBe('6037 9979 1111 2222');
    expect(formatCardNumberSpaced('')).toBe('');
  });

  it('formats bytes with Persian units/digits in fa locale and ASCII in en locale', () => {
    expect(formatBytes(null, 'fa')).toBe('-');
    expect(formatBytes(0, 'fa')).toBe('۰ بایت');
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(500 * 1024 * 1024, 'en')).toBe('500 MB');
    expect(formatBytes(500 * 1024 * 1024, 'fa')).toBe('۵۰۰ مگابایت');
    expect(formatBytes(2 * 1024 * 1024 * 1024, 'en')).toBe('2 GB');
    expect(formatBytes(2 * 1024 * 1024 * 1024, 'fa')).toBe('۲ گیگابایت');
  });

  it('sanitizes display names, extracts uppercase avatar initials, and handles ISO dates safely', () => {
    expect(sanitizeDisplayName('Ali', 'Reza')).toEqual({
      displayName: 'Ali Reza',
      isMeaningful: true,
      initials: 'AR',
    });
    expect(sanitizeDisplayName('...', '---', 'Fallback')).toEqual({
      displayName: 'Fallback',
      isMeaningful: false,
      initials: '',
    });
    expect(getAvatarChar('\u200Breza', 'u1')).toBe('R');
    expect(getAvatarChar('', 'admin')).toBe('A');
    expect(getAvatarChar('', '')).toBe('👤');
    expect(formatIsoDate(null, 'en')).toBe('-');
    expect(formatIsoDate('not-a-date', 'en')).toBe('not-a-date');
    expect(formatIsoDate('2026-09-29T10:00:00.000Z', 'en')).not.toBe('2026-09-29T10:00:00.000Z');
  });
});

describe('Webapp i18n Locales Parity & Copy Quality', () => {
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

    expect(faKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !faKeys.includes(k))).toEqual([]);
    expect(faKeys).toEqual(enKeys);
  });

  it('does not duplicate "Toman" currency word in en admin receipt confirmation strings', () => {
    expect(en.admin.receipts.approveConfirmBody).not.toMatch(/toman\s+toman/i);
    expect(en.admin.receipts.approveConfirmBody).not.toMatch(/\{amount\}\s+Toman/i);
    expect(en.admin.receipts.batchApproveConfirmBody).not.toMatch(/toman\s+toman/i);
  });

  it('removes all obsolete Beta/Preview gate keys from User Portal while preserving free-trial strings', () => {
    const removedUserKeys = [
      'betaBadge',
      'betaNotice',
      'betaPreviewActive',
      'enterBetaMode',
      'enterBetaModeDesc',
      'backToComingSoon',
      'adminPreviewBadge',
      'portalTitle',
      'portalDesc',
      'inDevelopmentStatus',
      'upcomingFeaturesTitle',
    ];
    for (const key of removedUserKeys) {
      expect(key in fa.user, `unexpected beta key fa.user.${key}`).toBe(false);
      expect(key in en.user, `unexpected beta key en.user.${key}`).toBe(false);
    }

    const removedAdminKeys = ['betaBadge', 'betaNotice', 'enterUserBeta'];
    for (const key of removedAdminKeys) {
      expect(key in fa.admin, `unexpected beta key fa.admin.${key}`).toBe(false);
      expect(key in en.admin, `unexpected beta key en.admin.${key}`).toBe(false);
    }

    // Production view-switch & UX copy must be present in both locales
    expect(fa.user.adminViewBadge.length).toBeGreaterThan(0);
    expect(en.user.adminViewBadge.length).toBeGreaterThan(0);
    expect(fa.admin.switchToUserPortal.length).toBeGreaterThan(0);
    expect(en.admin.switchToUserPortal.length).toBeGreaterThan(0);
    expect(fa.user.shop.deficitLabel.length).toBeGreaterThan(0);
    expect(en.user.shop.deficitLabel.length).toBeGreaterThan(0);
    expect(fa.user.referral.codeCopied.length).toBeGreaterThan(0);
    expect(en.user.referral.codeCopied.length).toBeGreaterThan(0);

    // Free-trial module strings must remain preserved
    expect(fa.admin.modules.trial.length).toBeGreaterThan(0);
    expect(en.admin.modules.trial.length).toBeGreaterThan(0);
  });
});

describe('transactionFormatters', () => {
  describe('getTransactionTypeLabel', () => {
    it('correctly maps purchase types to new purchase vs renewal', () => {
      expect(
        getTransactionTypeLabel('purchase', 'Purchase new_config: user_1 (50GB / 30d)', tFa)
      ).toBe('خرید اشتراک');
      expect(
        getTransactionTypeLabel('purchase', 'Purchase renew_config: user_1 (50GB / 30d)', tFa)
      ).toBe('تمدید اشتراک');
      expect(getTransactionTypeLabel('purchase', 'بسته تمدید ۳۰ روزه', tFa)).toBe('تمدید اشتراک');

      expect(
        getTransactionTypeLabel('purchase', 'Purchase new_config: user_1 (50GB / 30d)', tEn)
      ).toBe('Purchase');
      expect(
        getTransactionTypeLabel('purchase', 'Purchase renew_config: user_1 (50GB / 30d)', tEn)
      ).toBe('Renewal');
    });

    it('maps all standard transaction types', () => {
      expect(getTransactionTypeLabel('topup', '', tFa)).toBe('افزایش موجودی');
      expect(getTransactionTypeLabel('refund', '', tFa)).toBe('بازگشت وجه');
      expect(getTransactionTypeLabel('cashback', '', tFa)).toBe('کش‌بک خرید');
      expect(getTransactionTypeLabel('referral_bonus', '', tFa)).toBe('پاداش دعوت');
      expect(getTransactionTypeLabel('admin_adjustment', '', tFa)).toBe('تنظیم مدیریت');
      expect(getTransactionTypeLabel('transfer_sent', '', tFa)).toBe('انتقال ارسالی');
      expect(getTransactionTypeLabel('transfer_received', '', tFa)).toBe('انتقال دریافتی');
      expect(getTransactionTypeLabel('other_unknown', '', tFa)).toBe('تراکنش کیف پول');

      expect(getTransactionTypeLabel('topup', '', tEn)).toBe('Deposit');
      expect(getTransactionTypeLabel('refund', '', tEn)).toBe('Refund');
      expect(getTransactionTypeLabel('cashback', '', tEn)).toBe('Cashback');
      expect(getTransactionTypeLabel('referral_bonus', '', tEn)).toBe('Referral Bonus');
    });
  });

  describe('formatTransactionDescription', () => {
    it('formats unused subscription refunds with or without cashback withheld', () => {
      const withWithheld = 'Refund for deleted service 33; gross=150000; cashback_withheld=7500';
      expect(formatTransactionDescription(withWithheld, 'fa')).toBe(
        'عودت اشتراک ۳۳ (با کسر کش‌بک)'
      );
      expect(formatTransactionDescription(withWithheld, 'en')).toBe(
        'Refund for subscription 33 (cashback deducted)'
      );

      const withoutWithheld =
        'Unused subscription refund h_6698253699_75; gross=150000; cashback_withheld=0';
      expect(formatTransactionDescription(withoutWithheld, 'fa')).toBe(
        'عودت اشتراک h_6698253699_75'
      );
      expect(formatTransactionDescription(withoutWithheld, 'en')).toBe(
        'Refund for subscription h_6698253699_75'
      );
    });

    it('formats new purchases and renewals with GB/days and promo codes', () => {
      const newPurchase = 'Purchase new_config: h_6698253699_75 (50GB / 30d)';
      expect(formatTransactionDescription(newPurchase, 'fa')).toBe(
        'خرید اشتراک جدید: h_6698253699_75 (۵۰ گیگ / ۳۰ روز)'
      );
      expect(formatTransactionDescription(newPurchase, 'en')).toBe(
        'New subscription: h_6698253699_75 (50GB / 30d)'
      );

      const renewalWithPromo = 'Purchase renew_config: h_6698253699_75 (100GB / 60d); promo VIP50';
      expect(formatTransactionDescription(renewalWithPromo, 'fa')).toBe(
        'تمدید اشتراک: h_6698253699_75 (۱۰۰ گیگ / ۶۰ روز) | کد تخفیف: VIP50'
      );
      expect(formatTransactionDescription(renewalWithPromo, 'en')).toBe(
        'Renewal: h_6698253699_75 (100GB / 60d) | Promo: VIP50'
      );
    });

    it('formats reconciled purchases, cashback, promos, approvals, wheel, trials, transfers & adjustments', () => {
      const reconciled = 'Reconciled purchase new_config: h_user (20GB / 30d)';
      expect(formatTransactionDescription(reconciled, 'fa')).toBe(
        'تکمیل خودکار خرید: h_user (۲۰ گیگ / ۳۰ روز)'
      );
      expect(formatTransactionDescription(reconciled, 'en')).toBe(
        'Reconciled purchase: h_user (20GB / 30d)'
      );

      const cashback = 'Cashback 5% for purchase pi_1791222385825_5ffcb0';
      expect(formatTransactionDescription(cashback, 'fa')).toBe('کش‌بک ۵٪ خرید اشتراک');
      expect(formatTransactionDescription(cashback, 'en')).toBe('5% purchase cashback');

      const promo = 'Redeemed gift credit promo code: TESTCODE';
      expect(formatTransactionDescription(promo, 'fa')).toBe('اعتبار هدیه با کد تخفیف: TESTCODE');
      expect(formatTransactionDescription(promo, 'en')).toBe('Gift promo code credit: TESTCODE');

      const receipt = 'Top-up receipt approved by admin 12345';
      expect(formatTransactionDescription(receipt, 'fa')).toBe('تأیید فیش واریزی توسط پشتیبانی');
      expect(formatTransactionDescription(receipt, 'en')).toBe(
        'Deposit receipt approved by support'
      );

      const wheel = 'Lucky wheel spin #3 prize (+10000 Toman, Luck: 50%)';
      expect(formatTransactionDescription(wheel, 'fa')).toBe('جایزه گردونه شانس (چرخش #۳)');
      expect(formatTransactionDescription(wheel, 'en')).toBe('Lucky wheel prize (Spin #3)');

      const trial = 'Claimed free trial config: trial_vip (1GB / 1d)';
      expect(formatTransactionDescription(trial, 'fa')).toBe(
        'اشتراک آزمایشی رایگان: trial_vip (۱ گیگ / ۱ روز)'
      );

      const transfer = 'Transfer to user 98765: gift';
      expect(formatTransactionDescription(transfer, 'fa')).toBe('انتقال موجودی به کاربر');

      const adminAdjustmentWithNote = 'Admin 6698253699: credit; شارژ توسط مدیریت';
      expect(formatTransactionDescription(adminAdjustmentWithNote, 'fa')).toBe(
        'تنظیم مدیریت: شارژ توسط مدیریت'
      );
      expect(formatTransactionDescription(adminAdjustmentWithNote, 'en')).toBe(
        'Admin adjustment: شارژ توسط مدیریت'
      );

      const adminAdjustmentPlain = 'Admin 6698253699: credit';
      expect(formatTransactionDescription(adminAdjustmentPlain, 'fa')).toBe(
        'تنظیم موجودی توسط مدیریت'
      );
      expect(formatTransactionDescription(adminAdjustmentPlain, 'en')).toBe(
        'Admin balance adjustment'
      );
    });

    it('passes through custom or unknown descriptions unaltered', () => {
      const custom = 'Manual credit for festival campaign';
      expect(formatTransactionDescription(custom, 'fa')).toBe(custom);
      expect(formatTransactionDescription(custom, 'en')).toBe(custom);
    });
  });
});

describe('Traffic Normalization & ServiceStatusTraffic', () => {
  describe('normalizeDataLimit', () => {
    it('treats null, undefined, empty string, and <= 0 as null (Unlimited)', () => {
      expect(normalizeDataLimit(undefined)).toBeNull();
      expect(normalizeDataLimit(null)).toBeNull();
      expect(normalizeDataLimit(0)).toBeNull();
      expect(normalizeDataLimit(-10)).toBeNull();
      expect(normalizeDataLimit(0n)).toBeNull();
      expect(normalizeDataLimit(-5n)).toBeNull();
      expect(normalizeDataLimit('  ')).toBeNull();
      expect(normalizeDataLimit('0')).toBeNull();
    });

    it('normalizes positive numbers, bigints, and numeric strings via floor', () => {
      expect(normalizeDataLimit(1024.9)).toBe(1024);
      expect(normalizeDataLimit(5000n)).toBe(5000);
      expect(normalizeDataLimit(' 2048 ')).toBe(2048);
    });

    it('returns undefined for NaN, invalid strings, or non-numeric types', () => {
      expect(normalizeDataLimit(Number.NaN)).toBeUndefined();
      expect(normalizeDataLimit('abc')).toBeUndefined();
      expect(normalizeDataLimit({})).toBeUndefined();
    });
  });

  describe('Status Mapping', () => {
    it('maps all statuses including active, limited, expired, disabled, on_hold, unknown & trimmed uppercase', () => {
      const activeFa = getServiceStatusInfo('active', tFa);
      expect(activeFa.type).toBe('active');
      expect(activeFa.label).toBe('فعال');
      expect(activeFa.isPulsing).toBe(false);
      expect(activeFa.dotClass).not.toContain('animate-pulse');
      expect(activeFa.dotClass).toContain('bg-ok');
      expect(activeFa.badgeClass).toContain('bg-ok');
      expect(getServiceStatusInfo('active', tEn).label).toBe('Active');

      const limitedFa = getServiceStatusInfo('limited', tFa);
      expect(limitedFa.type).toBe('limited');
      expect(limitedFa.label).toBe('پایان حجم');
      expect(limitedFa.isPulsing).toBe(false);
      expect(limitedFa.dotClass).not.toContain('animate-pulse');
      expect(limitedFa.dotClass).toContain('bg-warn');
      expect(getServiceStatusInfo('limited', tEn).label).toBe('Traffic Limit Reached');

      const expiredFa = getServiceStatusInfo('expired', tFa);
      expect(expiredFa.type).toBe('expired');
      expect(expiredFa.label).toBe('منقضی شده');
      expect(expiredFa.dotClass).toContain('bg-danger');
      expect(getServiceStatusInfo('expired', tEn).label).toBe('Expired');

      const disabledFa = getServiceStatusInfo('disabled', tFa);
      expect(disabledFa.type).toBe('disabled');
      expect(disabledFa.label).toBe('غیرفعال');
      expect(disabledFa.dotClass).toContain('bg-ink-muted');
      expect(disabledFa.badgeClass).toContain('bg-surface-2');
      expect(getServiceStatusInfo('disabled', tEn).label).toBe('Disabled');

      const onHoldFa = getServiceStatusInfo('on_hold', tFa);
      expect(onHoldFa.type).toBe('on_hold');
      expect(onHoldFa.label).toBe('در انتظار اتصال');
      expect(onHoldFa.dotClass).toContain('bg-warn');
      expect(getServiceStatusInfo('on_hold', tEn).label).toBe('On Hold');

      expect(getServiceStatusInfo(null, tFa).type).toBe('unknown');
      expect(getServiceStatusInfo(undefined, tEn).label).toBe('Unknown');
      expect(getServiceStatusInfo('some_random_status', tEn).label).toBe('Unknown');

      expect(getServiceStatusInfo('  ACTIVE  ', tFa).isPulsing).toBe(false);
      expect(getServiceStatusInfo('LIMITED', tEn).type).toBe('limited');
    });
  });

  describe('Traffic Limit and Usage', () => {
    it('handles unlimited, unknown, sub-0.5GB, and multi-GB thresholds accurately', () => {
      const nullLimitFa = getServiceTrafficInfo(null, 1024 * 1024 * 1024, 'fa', tFa);
      expect(nullLimitFa.isUnlimited).toBe(true);
      expect(nullLimitFa.formattedLimit).toBe('نامحدود');
      expect(nullLimitFa.formattedUsed).toBe('۱ گیگابایت');
      expect(nullLimitFa.percentage).toBeNull();

      const undefLimitEn = getServiceTrafficInfo(undefined, 500 * 1024 * 1024, 'en', tEn);
      expect(undefLimitEn.isUnlimited).toBe(true);
      expect(undefLimitEn.formattedLimit).toBe('Unlimited');

      const zeroLimitFa = getServiceTrafficInfo(0, 2 * 1024 * 1024 * 1024, 'fa', tFa);
      expect(zeroLimitFa.isUnlimited).toBe(true);
      expect(zeroLimitFa.formattedLimit).toBe('نامحدود');

      const nanLimitFa = getServiceTrafficInfo(Number.NaN, 1024 * 1024 * 1024, 'fa', tFa);
      expect(nanLimitFa.isUnknownLimit).toBe(true);
      expect(nanLimitFa.formattedLimit).toBe('—');

      const limit250Mb = 250 * 1024 * 1024;
      const used125Mb = 125 * 1024 * 1024;
      const fa250 = getServiceTrafficInfo(limit250Mb, used125Mb, 'fa', tFa);
      expect(fa250.isUnlimited).toBe(false);
      expect(fa250.formattedLimit).toBe('۲۵۰ مگابایت');
      expect(fa250.percentage).toBe(50);
      expect(fa250.progressColorClass).toBe('bg-brand');

      const limit10Gb = 10 * 1024 * 1024 * 1024;
      expect(
        getServiceTrafficInfo(limit10Gb, 8 * 1024 * 1024 * 1024, 'en', tEn).progressColorClass
      ).toBe('bg-warn');
      expect(
        getServiceTrafficInfo(limit10Gb, 9.5 * 1024 * 1024 * 1024, 'en', tEn).progressColorClass
      ).toBe('bg-danger');

      expect(getServiceTrafficInfo(5 * 1024 * 1024 * 1024, null, 'en', tEn).formattedUsed).toBe(
        '0 B'
      );
    });
  });

  describe('Expiry, Auto-Renew & Created Date', () => {
    const fixedNowSec = 1700000000;

    it('handles expiry timestamps across null, past, <24h, and multi-day ranges', () => {
      const nullExp = getServiceExpiryInfo(null, 'fa', tFa, fixedNowSec);
      expect(nullExp.isExpired).toBe(false);
      expect(nullExp.remainingText).toBe('—');
      expect(nullExp.daysRemaining).toBeNull();

      const expNow = getServiceExpiryInfo(fixedNowSec, 'fa', tFa, fixedNowSec);
      expect(expNow.isExpired).toBe(true);
      expect(expNow.remainingText).toBe('منقضی شده');

      const expPast = getServiceExpiryInfo(fixedNowSec - 3600, 'en', tEn, fixedNowSec);
      expect(expPast.isExpired).toBe(true);
      expect(expPast.remainingText).toBe('Expired');

      const exp2hFa = getServiceExpiryInfo(fixedNowSec + 7200, 'fa', tFa, fixedNowSec);
      expect(exp2hFa.daysRemaining).toBe(1);
      expect(exp2hFa.remainingText).toBe('کمتر از ۱ روز باقی‌مانده');

      const exp2hEn = getServiceExpiryInfo(fixedNowSec + 7200, 'en', tEn, fixedNowSec);
      expect(exp2hEn.remainingText).toBe('Less than a day remaining');

      const exp5dEn = getServiceExpiryInfo(fixedNowSec + 5 * 86400, 'en', tEn, fixedNowSec);
      expect(exp5dEn.daysRemaining).toBe(5);
      expect(exp5dEn.remainingText).toBe('5 days left');
      expect(exp5dEn.formattedDate).toBe(
        new Date((fixedNowSec + 5 * 86400) * 1000).toLocaleDateString('en-US')
      );

      const exp13dFa = getServiceExpiryInfo(
        fixedNowSec + 12 * 86400 + 3 * 3600,
        'fa',
        tFa,
        fixedNowSec
      );
      expect(exp13dFa.daysRemaining).toBe(13);
      expect(exp13dFa.remainingText).toBe('۱۳ روز باقی‌مانده');

      const onHold30dFa = getServiceExpiryInfo(null, 'fa', tFa, fixedNowSec, {
        panelStatus: 'on_hold',
        onHoldExpireDurationSec: 30 * 86400,
      });
      expect(onHold30dFa).toEqual({
        isExpired: false,
        remainingText: 'در انتظار اولین اتصال (۳۰ روز)',
        formattedDate: '—',
        daysRemaining: 30,
      });

      const onHold30dEn = getServiceExpiryInfo(null, 'en', tEn, fixedNowSec, {
        panelStatus: 'on_hold',
        onHoldExpireDurationSec: 30 * 86400,
      });
      expect(onHold30dEn).toEqual({
        isExpired: false,
        remainingText: 'Waiting for first connection (30 days)',
        formattedDate: '—',
        daysRemaining: 30,
      });

      const onHoldUnknownFa = getServiceExpiryInfo(null, 'fa', tFa, fixedNowSec, {
        panelStatus: 'on_hold',
        onHoldExpireDurationSec: null,
      });
      expect(onHoldUnknownFa.remainingText).toBe('در انتظار اولین اتصال');
      expect(onHoldUnknownFa.daysRemaining).toBeNull();
    });

    it('checks auto-renew and service created date', () => {
      expect(isAutoRenewActive(true)).toBe(true);
      expect(isAutoRenewActive(false)).toBe(false);
      expect(isAutoRenewActive(null)).toBe(false);
      expect(isAutoRenewActive(undefined)).toBe(false);

      const sampleDate = '2026-09-29T10:00:00.000Z';
      expect(formatServiceCreatedDate(sampleDate, 'fa', tFa)).toContain('تاریخ ایجاد:');
      expect(formatServiceCreatedDate(sampleDate, 'en', tEn)).toContain('Created:');
      expect(formatServiceCreatedDate(null, 'fa', tFa)).toBe('—');
    });
  });

  describe('Overview Analytics Pure Calculators (OverviewAnalytics.tsx)', () => {
    const baseStats: DashboardStats = {
      totalUsers: 100,
      totalSales: 50,
      dailyRevenue: 0,
      weeklyRevenue: 0,
      monthlyRevenue: 0,
      totalReferralBonus: 0,
      totalCashback: 0,
      activeSubscriptions: 0,
      inactiveSubscriptions: 0,
      pendingReceipts: 0,
    };

    it('clamps zero and tiny revenue ratios safely while scaling proportional bars accurately', () => {
      const zeroBars = computeRevenueBarMetrics(baseStats);
      expect(zeroBars.map((b) => [b.id, b.ratio])).toEqual([
        ['daily', 0.06],
        ['weekly', 0.06],
        ['monthly', 0.06],
      ]);

      const scaled = computeRevenueBarMetrics({
        ...baseStats,
        dailyRevenue: 10_000,
        weeklyRevenue: 500_000,
        monthlyRevenue: 1_000_000,
      });
      expect(scaled[0]).toMatchObject({ id: 'daily', value: 10_000, ratio: 0.06 });
      expect(scaled[1]).toMatchObject({ id: 'weekly', value: 500_000, ratio: 0.5 });
      expect(scaled[2]).toMatchObject({ id: 'monthly', value: 1_000_000, ratio: 1 });
    });

    it('handles zero totals, negative clamps, exact percentage rounding, and dash offset', () => {
      const zeroSplit = computeSubscriptionSplit(baseStats, 44);
      expect(zeroSplit.total).toBe(0);
      expect(zeroSplit.activePercent).toBe(0);
      expect(zeroSplit.circumference).toBeCloseTo(2 * Math.PI * 44, 6);
      expect(zeroSplit.dashOffset).toBeCloseTo(zeroSplit.circumference, 6);

      const negSplit = computeSubscriptionSplit({
        ...baseStats,
        activeSubscriptions: -5,
        inactiveSubscriptions: 4,
      });
      expect(negSplit.active).toBe(0);
      expect(negSplit.inactive).toBe(4);
      expect(negSplit.total).toBe(4);
      expect(negSplit.activePercent).toBe(0);

      const ratioSplit = computeSubscriptionSplit({
        ...baseStats,
        activeSubscriptions: 2,
        inactiveSubscriptions: 1,
      });
      expect(ratioSplit.total).toBe(3);
      expect(ratioSplit.activePercent).toBe(67);
      expect(ratioSplit.dashOffset).toBeCloseTo(ratioSplit.circumference * (1 / 3), 6);
    });
  });

  describe('User Wallet Top-up Presets Removal', () => {
    it('omits preset top-up amount chips and obsolete quickAmounts key from user wallet dictionary', () => {
      expect('quickAmounts' in fa.user.wallet).toBe(false);
      expect('quickAmounts' in en.user.wallet).toBe(false);
      expect(fa.user.wallet.topupMinMaxHint).toContain('{min}');
      expect(en.user.wallet.topupMinMaxHint).toContain('{min}');
    });
  });
});
