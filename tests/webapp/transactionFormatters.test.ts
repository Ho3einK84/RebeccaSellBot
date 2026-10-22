import { describe, expect, it } from 'vitest';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '../../webapp/src/shared/lib/transactionFormatters.js';
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

    it('formats reconciled purchases', () => {
      const reconciled = 'Reconciled purchase new_config: h_user (20GB / 30d)';
      expect(formatTransactionDescription(reconciled, 'fa')).toBe(
        'تکمیل خودکار خرید: h_user (۲۰ گیگ / ۳۰ روز)'
      );
      expect(formatTransactionDescription(reconciled, 'en')).toBe(
        'Reconciled purchase: h_user (20GB / 30d)'
      );
    });

    it('formats cashback descriptions', () => {
      const cashback = 'Cashback 5% for purchase pi_1791222385825_5ffcb0';
      expect(formatTransactionDescription(cashback, 'fa')).toBe('کش‌بک ۵٪ خرید اشتراک');
      expect(formatTransactionDescription(cashback, 'en')).toBe('5% purchase cashback');
    });

    it('formats promo gift codes', () => {
      const promo = 'Redeemed gift credit promo code: TESTCODE';
      expect(formatTransactionDescription(promo, 'fa')).toBe('اعتبار هدیه با کد تخفیف: TESTCODE');
      expect(formatTransactionDescription(promo, 'en')).toBe('Gift promo code credit: TESTCODE');
    });

    it('formats admin receipt topup approval', () => {
      const receipt = 'Top-up receipt approved by admin 12345';
      expect(formatTransactionDescription(receipt, 'fa')).toBe('تأیید فیش واریزی توسط پشتیبانی');
      expect(formatTransactionDescription(receipt, 'en')).toBe(
        'Deposit receipt approved by support'
      );
    });

    it('formats lucky wheel spin prizes', () => {
      const wheel = 'Lucky wheel spin #3 prize (+10000 Toman, Luck: 50%)';
      expect(formatTransactionDescription(wheel, 'fa')).toBe('جایزه گردونه شانس (چرخش #۳)');
      expect(formatTransactionDescription(wheel, 'en')).toBe('Lucky wheel prize (Spin #3)');
    });

    it('formats free trial configs and transfers', () => {
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
