import { toPersianDigits } from './formatters.js';

export type TransactionTypeTranslationKey =
  | 'user.wallet.typeRenewal'
  | 'user.wallet.typePurchase'
  | 'user.wallet.typeTopup'
  | 'user.wallet.typeTopupVoid'
  | 'user.wallet.typeRefund'
  | 'user.wallet.typeCashback'
  | 'user.wallet.typeReferral'
  | 'user.wallet.typePromo'
  | 'user.wallet.typeLuckyWheel'
  | 'user.wallet.typeTrial'
  | 'user.wallet.typeAdminAdjustment'
  | 'user.wallet.typeTransferSent'
  | 'user.wallet.typeTransferReceived'
  | 'user.wallet.typeOther';

/**
 * Returns a human-friendly title for a transaction type.
 * Accurately detects renewal purchases vs new config purchases.
 */
export function getTransactionTypeLabel(
  type: string,
  description: string = '',
  t: (key: TransactionTypeTranslationKey) => string
): string {
  const descLower = description.toLowerCase();
  if (type === 'purchase') {
    if (
      descLower.includes('renew_config') ||
      descLower.includes('renew') ||
      descLower.includes('تمدید')
    ) {
      return t('user.wallet.typeRenewal');
    }
    return t('user.wallet.typePurchase');
  }

  switch (type) {
    case 'topup':
      return t('user.wallet.typeTopup');
    case 'topup_void':
      return t('user.wallet.typeTopupVoid');
    case 'refund':
      return t('user.wallet.typeRefund');
    case 'cashback':
      return t('user.wallet.typeCashback');
    case 'referral_bonus':
      return t('user.wallet.typeReferral');
    case 'promo':
      return t('user.wallet.typePromo');
    case 'lucky_wheel':
      return t('user.wallet.typeLuckyWheel');
    case 'trial':
      return t('user.wallet.typeTrial');
    case 'admin_adjustment':
      return t('user.wallet.typeAdminAdjustment');
    case 'transfer_sent':
      return t('user.wallet.typeTransferSent');
    case 'transfer_received':
      return t('user.wallet.typeTransferReceived');
    default:
      return t('user.wallet.typeOther');
  }
}

/**
 * Parses internal technical transaction descriptions and formats them into
 * friendly, transparent human-readable explanations so the user understands
 * exactly what occurred.
 */
export function formatTransactionDescription(
  rawDescription: string,
  locale: string = 'fa'
): string {
  if (!rawDescription || typeof rawDescription !== 'string') return '';
  const desc = rawDescription.trim();
  const isFa = locale === 'fa';

  let m: RegExpMatchArray | null;

  // 1. Unused subscription refund / Refund for deleted service
  // e.g. "Unused subscription refund h_6698253699_75; gross=150000; cashback_withheld=7500"
  // e.g. "Refund for deleted service 33; gross=150000; cashback_withheld=7500"
  if (
    (m = desc.match(
      /(?:Unused subscription refund|Refund for deleted service)\s+([^;]+)(?:;\s*gross=(\d+)(?:;\s*cashback_withheld=(\d+))?)?/i
    ))
  ) {
    const target = m[1]?.trim() ?? '';
    const withheld = Number(m[3] || 0);
    const displayTarget = isFa && /^\d+$/.test(target) ? toPersianDigits(target) : target;
    if (isFa) {
      return withheld > 0
        ? `عودت اشتراک ${displayTarget} (با کسر کش‌بک)`
        : `عودت اشتراک ${displayTarget}`;
    }
    return withheld > 0
      ? `Refund for subscription ${target} (cashback deducted)`
      : `Refund for subscription ${target}`;
  }

  // 2. Reconciled purchase
  // e.g. "Reconciled purchase new_config: h_6698253699_75 (50GB / 30d)"
  if (
    (m = desc.match(/^Reconciled purchase\s+(new_config|renew_config):\s*([^\s(]+)\s*\(([^)]+)\)/i))
  ) {
    const isRenew = m[1]?.toLowerCase() === 'renew_config';
    const username = m[2]?.trim() ?? '';
    const details = m[3]?.trim() ?? '';
    if (isFa) {
      const faDetails = toPersianDigits(
        details.replace(/(\d+)\s*GB/gi, '$1 گیگ').replace(/(\d+)\s*d/gi, '$1 روز')
      );
      return `تکمیل خودکار ${isRenew ? 'تمدید' : 'خرید'}: ${username} (${faDetails})`;
    }
    return `Reconciled ${isRenew ? 'renewal' : 'purchase'}: ${username} (${details})`;
  }

  // 3. Purchase new_config / renew_config
  // e.g. "Purchase new_config: h_6698253699_75 (50GB / 30d); promo VIP20"
  if (
    (m = desc.match(
      /^Purchase\s+(new_config|renew_config):\s*([^\s(]+)\s*\(([^)]+)\)(?:;\s*promo\s*(\S+))?/i
    ))
  ) {
    const isRenew = m[1]?.toLowerCase() === 'renew_config';
    const username = m[2]?.trim() ?? '';
    const details = m[3]?.trim() ?? '';
    const promo = m[4]?.trim();

    if (isFa) {
      const faDetails = toPersianDigits(
        details.replace(/(\d+)\s*GB/gi, '$1 گیگ').replace(/(\d+)\s*d/gi, '$1 روز')
      );
      const actionLabel = isRenew ? 'تمدید اشتراک' : 'خرید اشتراک جدید';
      const promoSuffix = promo ? ` | کد تخفیف: ${promo}` : '';
      return `${actionLabel}: ${username} (${faDetails})${promoSuffix}`;
    }
    const actionLabel = isRenew ? 'Renewal' : 'New subscription';
    const promoSuffix = promo ? ` | Promo: ${promo}` : '';
    return `${actionLabel}: ${username} (${details})${promoSuffix}`;
  }

  // 4. Cashback
  // e.g. "Cashback 5% for purchase pi_1791222385825_5ffcb0"
  if ((m = desc.match(/Cashback\s+(\d+)%\s+for purchase/i))) {
    const percent = m[1];
    return isFa
      ? `کش‌بک ${toPersianDigits(percent)}٪ خرید اشتراک`
      : `${percent}% purchase cashback`;
  }

  // 5. Promo gift code
  // e.g. "Redeemed gift credit promo code: TEST"
  if ((m = desc.match(/Redeemed gift credit promo code:\s*(\S+)/i))) {
    const code = m[1];
    return isFa ? `اعتبار هدیه با کد تخفیف: ${code}` : `Gift promo code credit: ${code}`;
  }

  // 6. Top-up receipt approved / voided
  // e.g. "Top-up receipt approved by admin 123"
  // e.g. "Top-up receipt rec_123 voided by admin 456"
  if (/Top-up receipt approved/i.test(desc)) {
    return isFa ? 'تأیید فیش واریزی توسط پشتیبانی' : 'Deposit receipt approved by support';
  }
  if (/Void approved top-up receipt/i.test(desc) || /Top-up receipt\s+\S+\s+voided/i.test(desc)) {
    return isFa ? 'ابطال رسید تأییدشده توسط مدیریت' : 'Approved receipt voided by admin';
  }

  // 7. Lucky wheel spin
  // e.g. "Lucky wheel spin #1 prize (+10000 Toman, Luck: 50%)"
  if ((m = desc.match(/Lucky wheel spin\s*#?(\d*)/i))) {
    const spinNum = m[1];
    if (isFa) {
      return spinNum
        ? `جایزه گردونه شانس (چرخش #${toPersianDigits(spinNum)})`
        : 'جایزه گردونه شانس';
    }
    return spinNum ? `Lucky wheel prize (Spin #${spinNum})` : 'Lucky wheel prize';
  }

  // 8. Referral bonus
  // e.g. "Referral bonus for user 12345"
  if (/Referral bonus/i.test(desc)) {
    return isFa ? 'پاداش معرفی کاربر جدید' : 'Referral bonus';
  }

  // 9. Admin quick top-up
  if (/Admin quick top-up/i.test(desc)) {
    return isFa ? 'شارژ مستقیم توسط مدیریت' : 'Admin direct balance top-up';
  }

  // 10. Claimed free trial config
  // e.g. "Claimed free trial config: test_user (1GB / 1d)"
  if ((m = desc.match(/Claimed free trial config:\s*([^\s(]+)\s*\(([^)]+)\)/i))) {
    const username = m[1]?.trim() ?? '';
    const details = m[2]?.trim() ?? '';
    if (isFa) {
      const faDetails = toPersianDigits(
        details
          .replace(/(\d+(?:\.\d+)?)\s*GB/gi, (_, gb: string) => `${gb.replace('.', '٫')} گیگ`)
          .replace(/(\d+)\s*d/gi, '$1 روز')
      );
      return `اشتراک آزمایشی رایگان: ${username} (${faDetails})`;
    }
    return `Free trial config: ${username} (${details})`;
  }

  // 11. Transfer to user (matches both legacy "Transfer to user" and WalletService "Transfer to <id>[: note]")
  if ((m = desc.match(/^Transfer to\s+(\d+)(?::\s*(.*))?$/i))) {
    const targetId = isFa ? toPersianDigits(m[1]!) : m[1]!;
    const note = m[2]?.trim();
    if (isFa) {
      return note ? `انتقال به کاربر ${targetId} (${note})` : `انتقال موجودی به کاربر ${targetId}`;
    }
    return note ? `Transfer to user ${targetId} (${note})` : `Transfer to user ${targetId}`;
  }
  if (/Transfer to user/i.test(desc)) {
    return isFa ? 'انتقال موجودی به کاربر' : 'Balance transfer to user';
  }

  // 12. Transfer received from user (matches both legacy and WalletService "Transfer from <id>[: note]")
  if ((m = desc.match(/^Transfer from\s+(\d+)(?::\s*(.*))?$/i))) {
    const senderId = isFa ? toPersianDigits(m[1]!) : m[1]!;
    const note = m[2]?.trim();
    if (isFa) {
      return note ? `دریافت از کاربر ${senderId} (${note})` : `دریافت موجودی از کاربر ${senderId}`;
    }
    return note ? `Transfer from user ${senderId} (${note})` : `Transfer from user ${senderId}`;
  }
  if (/Transfer received from user/i.test(desc)) {
    return isFa ? 'انتقال موجودی دریافتی از کاربر' : 'Balance transfer received';
  }

  // 13. Admin adjustment: Admin <id>: <operation>; <note>
  if ((m = desc.match(/^Admin\s+(\d+):\s*([^;]+)(?:;\s*(.*))?/i))) {
    const note = m[3]?.trim();
    if (note && note !== m[2].trim()) {
      return isFa ? `تنظیم مدیریت: ${note}` : `Admin adjustment: ${note}`;
    }
    return isFa ? 'تنظیم موجودی توسط مدیریت' : 'Admin balance adjustment';
  }

  return desc;
}
