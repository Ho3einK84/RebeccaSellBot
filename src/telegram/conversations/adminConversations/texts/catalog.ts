/**
 * Metadata, mutually exclusive categories, placeholder descriptions, and
 * locale-aware sample values for the Admin Bot Texts editor.
 */
import type { SupportedLocale } from '../../../../domain/services/TranslationService.js';

export type EssentialTextItem = {
  id: string;
  key: string;
  labelKey: string;
  descKey: string;
};

export const ESSENTIAL_USER_TEXTS: readonly EssentialTextItem[] = [
  {
    id: 'onboarding_welcome',
    key: 'onboarding_welcome',
    labelKey: 'admin_text_item_onboarding',
    descKey: 'admin_text_desc_onboarding',
  },
  {
    id: 'home_subtitle',
    key: 'home_subtitle',
    labelKey: 'admin_text_item_home_subtitle',
    descKey: 'admin_text_desc_home_subtitle',
  },
  {
    id: 'shop_subtitle',
    key: 'shop_subtitle',
    labelKey: 'admin_text_item_shop_subtitle',
    descKey: 'admin_text_desc_shop_subtitle',
  },
  {
    id: 'purchase_success_subtitle',
    key: 'purchase_success_subtitle',
    labelKey: 'admin_text_item_purchase_success',
    descKey: 'admin_text_desc_purchase_success',
  },
  {
    id: 'topup_subtitle',
    key: 'topup_subtitle',
    labelKey: 'admin_text_item_topup',
    descKey: 'admin_text_desc_topup',
  },
  {
    id: 'payment_method_card_to_card_desc',
    key: 'payment_method_card_to_card_desc',
    labelKey: 'admin_text_item_card_to_card',
    descKey: 'admin_text_desc_card_to_card',
  },
  {
    id: 'trial_preview_subtitle',
    key: 'trial_preview_subtitle',
    labelKey: 'admin_text_item_trial',
    descKey: 'admin_text_desc_trial',
  },
  {
    id: 'trial_terms',
    key: 'trial_terms',
    labelKey: 'admin_text_item_trial_terms',
    descKey: 'admin_text_desc_trial_terms',
  },
  {
    id: 'referral_subtitle',
    key: 'referral_subtitle',
    labelKey: 'admin_text_item_referral',
    descKey: 'admin_text_desc_referral',
  },
  {
    id: 'wheel_subtitle',
    key: 'wheel_subtitle',
    labelKey: 'admin_text_item_wheel',
    descKey: 'admin_text_desc_wheel',
  },
  {
    id: 'renewal_notification_subtitle',
    key: 'renewal_notification_subtitle',
    labelKey: 'admin_text_item_renewal_notice',
    descKey: 'admin_text_desc_renewal_notice',
  },
  {
    id: 'home_near_expiry_warning',
    key: 'home_near_expiry_warning',
    labelKey: 'admin_text_item_expiry_warning',
    descKey: 'admin_text_desc_expiry_warning',
  },
  {
    id: 'support_message',
    key: 'support_message',
    labelKey: 'admin_text_item_support',
    descKey: 'admin_text_desc_support',
  },
  {
    id: 'bot_maintenance_message',
    key: 'bot_maintenance_message',
    labelKey: 'admin_text_item_maintenance',
    descKey: 'admin_text_desc_maintenance',
  },
  {
    id: 'transfer_subtitle',
    key: 'transfer_subtitle',
    labelKey: 'admin_text_item_service_transfer',
    descKey: 'admin_text_desc_service_transfer',
  },
  {
    id: 'wallet_transfer_subtitle',
    key: 'wallet_transfer_subtitle',
    labelKey: 'admin_text_item_wallet_transfer',
    descKey: 'admin_text_desc_wallet_transfer',
  },
  {
    id: 'registration_closed_message',
    key: 'registration_closed_message',
    labelKey: 'admin_text_item_registration_closed',
    descKey: 'admin_text_desc_registration_closed',
  },
  {
    id: 'registration_invite_only_message',
    key: 'registration_invite_only_message',
    labelKey: 'admin_text_item_registration_invite_only',
    descKey: 'admin_text_desc_registration_invite_only',
  },
];

const ESSENTIAL_BY_KEY = new Map<string, EssentialTextItem>(
  ESSENTIAL_USER_TEXTS.map((item) => [item.key, item])
);

export function getEssentialTextItem(key: string): EssentialTextItem | undefined {
  return ESSENTIAL_BY_KEY.get(key);
}

// ── Mutually Exclusive & Exhaustive Categories ───────────────────────────────

export type TextCategoryId =
  | 'user_home_nav'
  | 'user_shop_offers'
  | 'user_wallet'
  | 'user_services'
  | 'admin_users_receipts'
  | 'admin_sales_promos'
  | 'admin_panels_infra'
  | 'admin_system_texts';

export type TextCategory = {
  id: TextCategoryId;
  labelKey: string;
  descriptionKey: string;
  matches: (key: string) => boolean;
};

const ADMIN_USERS_RECEIPTS_PREFIXES = [
  'admin_user_',
  'admin_users_',
  'admin_groups_',
  'admin_search_',
  'admin_username_',
  'admin_name_',
  'admin_target_',
  'admin_invalid_telegram_id',
  'admin_receipt_',
  'admin_balance_',
  'admin_new_balance_',
  'admin_invalid_balance',
  'admin_broadcast_',
  'admin_gift_',
  'admin_direct_',
  'admin_message_',
  'admin_msg_',
] as const;

const ADMIN_USERS_RECEIPTS_EXACT = new Set([
  'admin_yes',
  'admin_no',
  'admin_banned',
  'admin_active',
]);

const ADMIN_SALES_PROMOS_PREFIXES = [
  'admin_pkg_',
  'admin_package_',
  'admin_category_',
  'admin_sales_',
  'admin_bank_cards_',
  'admin_auto_pay_',
  'admin_forapp_',
  'admin_nowpayments_',
  'admin_stats_',
  'admin_promo_',
  'admin_invalid_promo_',
  'admin_growth_',
  'admin_cdisc_',
] as const;

const ADMIN_SALES_PROMOS_EXACT = new Set(['admin_no_promo_codes']);

const ADMIN_PANELS_INFRA_PREFIXES = [
  'admin_panel_',
  'admin_panels_',
  'admin_rebecca_',
  'admin_orphan_',
  'admin_backup_',
  'admin_webapp_',
] as const;

const ADMIN_SYSTEM_TEXTS_PREFIXES = [
  'admin_setting_',
  'admin_settings_',
  'admin_overview_',
  'admin_naming_',
  'admin_support_',
  'admin_menu_',
  'admin_home_',
  'admin_group_',
  'admin_daily_',
  'admin_system_',
  'admin_registry_',
  'admin_admin_',
  'admin_add_admin_',
  'admin_remove_admin_',
  'admin_detail_',
  'admin_last_admin_',
  'admin_text_',
  'admin_nav_',
  'admin_cfg_',
  'admin_fj_',
  'admin_registration_',
] as const;

const ADMIN_SYSTEM_TEXTS_EXACT = new Set([
  'admin_bootstrap_env',
  'admin_access_denied',
  'admin_confirm_button',
  'admin_unset_value',
]);

const USER_HOME_NAV_PREFIXES = [
  'onboarding_',
  'home_',
  'ui_status_',
  'menu_',
  'navigation_',
  'button_',
  'pagination_',
  'language_',
  'support_',
  'bot_maintenance_',
  'operation_',
  'text_input_',
  'photo_input_',
  'forced_join_',
  'registration_',
  'user_group_',
] as const;

const USER_HOME_NAV_EXACT = new Set([
  'main_menu',
  'access_denied',
  'private_chat_only',
  'unexpected_text_hint',
  'user_not_found',
  'user_unit',
  'panel_origin_down_user_notice',
  'currency_toman',
  'currency_rial',
  'service_unit',
  'days_unit',
  'hours_unit',
  'minutes_unit',
  'traffic_unit_gb',
  'cached_data_label',
  'remaining',
  'expiry',
  'renewing',
  'user_confirm_button',
]);

const USER_SHOP_OFFERS_PREFIXES = [
  'shop_',
  'package_',
  'custom_',
  'checkout_',
  'purchase_',
  'buy_',
  'insufficient_balance',
  'trial_',
  'promo_',
  'referral_',
  'wheel_',
] as const;

const USER_SHOP_OFFERS_EXACT = new Set(['unlimited']);

const USER_WALLET_PREFIXES = [
  'wallet_',
  'balance',
  'topup_',
  'payment_method_',
  'receipt_',
  'tx_type_',
  'forapp_',
  'auto_pay_',
  'nowpayments_',
] as const;

const USER_WALLET_EXACT = new Set(['direct_topup_button']);

const USER_SERVICES_PREFIXES = [
  'subscription_',
  'config_',
  'renewal_',
  'renew_',
  'auto_renew_',
  'claim_',
  'claimed_',
  'webhook_',
  'transfer_',
  'refund_reason_',
  'bulk_gift_',
] as const;

const USER_SERVICES_EXACT = new Set(['subscriptions_loading', 'traffic_unavailable']);

function matchesAnyPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * Deterministic single-owner classifier for every catalog key.
 * Returns `undefined` for unrecognized keys so tests catch missing rules
 * instead of silently sweeping them into a catch-all bucket.
 */
export function classifyTranslationKey(key: string): TextCategoryId | undefined {
  if (key.startsWith('admin_')) {
    if (
      ADMIN_USERS_RECEIPTS_EXACT.has(key) ||
      matchesAnyPrefix(key, ADMIN_USERS_RECEIPTS_PREFIXES)
    ) {
      return 'admin_users_receipts';
    }
    if (ADMIN_SALES_PROMOS_EXACT.has(key) || matchesAnyPrefix(key, ADMIN_SALES_PROMOS_PREFIXES)) {
      return 'admin_sales_promos';
    }
    if (matchesAnyPrefix(key, ADMIN_PANELS_INFRA_PREFIXES)) {
      return 'admin_panels_infra';
    }
    if (ADMIN_SYSTEM_TEXTS_EXACT.has(key) || matchesAnyPrefix(key, ADMIN_SYSTEM_TEXTS_PREFIXES)) {
      return 'admin_system_texts';
    }
    return undefined;
  }

  if (USER_HOME_NAV_EXACT.has(key) || matchesAnyPrefix(key, USER_HOME_NAV_PREFIXES)) {
    return 'user_home_nav';
  }
  if (USER_SHOP_OFFERS_EXACT.has(key) || matchesAnyPrefix(key, USER_SHOP_OFFERS_PREFIXES)) {
    return 'user_shop_offers';
  }
  if (USER_WALLET_EXACT.has(key) || matchesAnyPrefix(key, USER_WALLET_PREFIXES)) {
    return 'user_wallet';
  }
  if (USER_SERVICES_EXACT.has(key) || matchesAnyPrefix(key, USER_SERVICES_PREFIXES)) {
    return 'user_services';
  }
  return undefined;
}

function defineCategory(
  id: TextCategoryId,
  labelKey: string,
  descriptionKey: string
): TextCategory {
  return {
    id,
    labelKey,
    descriptionKey,
    matches: (key: string) => classifyTranslationKey(key) === id,
  };
}

export const TEXT_CATEGORIES: readonly TextCategory[] = [
  defineCategory(
    'user_home_nav',
    'admin_text_cat_user_home_nav',
    'admin_text_cat_desc_user_home_nav'
  ),
  defineCategory(
    'user_shop_offers',
    'admin_text_cat_user_shop_offers',
    'admin_text_cat_desc_user_shop_offers'
  ),
  defineCategory('user_wallet', 'admin_text_cat_user_wallet', 'admin_text_cat_desc_user_wallet'),
  defineCategory(
    'user_services',
    'admin_text_cat_user_services',
    'admin_text_cat_desc_user_services'
  ),
  defineCategory(
    'admin_users_receipts',
    'admin_text_cat_admin_users_receipts',
    'admin_text_cat_desc_admin_users_receipts'
  ),
  defineCategory(
    'admin_sales_promos',
    'admin_text_cat_admin_sales_promos',
    'admin_text_cat_desc_admin_sales_promos'
  ),
  defineCategory(
    'admin_panels_infra',
    'admin_text_cat_admin_panels_infra',
    'admin_text_cat_desc_admin_panels_infra'
  ),
  defineCategory(
    'admin_system_texts',
    'admin_text_cat_admin_system_texts',
    'admin_text_cat_desc_admin_system_texts'
  ),
];

export function getTextCategory(categoryId: string): TextCategory | undefined {
  return TEXT_CATEGORIES.find((cat) => cat.id === categoryId);
}

// ── Locale Labels (Mandatory: 🦁 فارسی / 🇬🇧 English) ─────────────────────────

export function localeDisplayLabel(locale: SupportedLocale): string {
  return locale === 'fa' ? '🦁 فارسی' : '🇬🇧 English';
}

export function alternateLocale(locale: SupportedLocale): SupportedLocale {
  return locale === 'fa' ? 'en' : 'fa';
}

// ── Bilingual Placeholder Metadata (100% Catalog Coverage) ───────────────────

export type PlaceholderMeta = {
  fa: string;
  en: string;
  sampleFa: string;
  sampleEn: string;
};

export const PLACEHOLDER_METADATA: Readonly<Record<string, PlaceholderMeta>> = {
  active: {
    fa: 'تعداد یا وضعیت فعال',
    en: 'Active count or status',
    sampleFa: 'فعال',
    sampleEn: 'Active',
  },
  added: {
    fa: 'مقدار اضافه‌شده در تمدید (حجم یا روز)',
    en: 'Added traffic or days in renewal',
    sampleFa: '۳۰',
    sampleEn: '30',
  },
  amount: {
    fa: 'مبلغ تراکنش یا تخفیف',
    en: 'Transaction or discount amount',
    sampleFa: '۵۰٬۰۰۰',
    sampleEn: '50,000',
  },
  api_key: {
    fa: 'کلید امنیتی API درگاه',
    en: 'Gateway API secret key',
    sampleFa: 'fa_sample_key_1234',
    sampleEn: 'fa_sample_key_1234',
  },
  approved: {
    fa: 'تعداد رسیدهای تأییدشده',
    en: 'Approved receipts count',
    sampleFa: '۱۲',
    sampleEn: '12',
  },
  balance: {
    fa: 'موجودی کیف پول',
    en: 'Wallet balance',
    sampleFa: '۱۵۰٬۰۰۰',
    sampleEn: '150,000',
  },
  bank: {
    fa: 'نام بانک',
    en: 'Bank name',
    sampleFa: 'بانک صادرات',
    sampleEn: 'Bank Saderat',
  },
  card: {
    fa: 'شماره کارت بانکی',
    en: 'Bank card number',
    sampleFa: '6037 6981 1130 6846',
    sampleEn: '6037 6981 1130 6846',
  },
  categories: {
    fa: 'تعداد دسته‌بندی‌های فعال',
    en: 'Active categories count',
    sampleFa: '۳',
    sampleEn: '3',
  },
  code: {
    fa: 'کد تخفیف یا هدیه',
    en: 'Promo or gift code',
    sampleFa: 'OFF30',
    sampleEn: 'OFF30',
  },
  code_counter: {
    fa: 'متغیر شمارنده نام‌گذاری',
    en: 'Counter naming token',
    sampleFa: '{counter}',
    sampleEn: '{counter}',
  },
  code_date: {
    fa: 'متغیر سال و ماه میلادی',
    en: 'Year-month naming token',
    sampleFa: '{date}',
    sampleEn: '{date}',
  },
  code_day: {
    fa: 'متغیر روز میلادی',
    en: 'Gregorian day token',
    sampleFa: '{day}',
    sampleEn: '{day}',
  },
  code_jday: {
    fa: 'متغیر روز شمسی',
    en: 'Solar day token',
    sampleFa: '{jday}',
    sampleEn: '{jday}',
  },
  code_jmonth: {
    fa: 'متغیر ماه شمسی',
    en: 'Solar month token',
    sampleFa: '{jmonth}',
    sampleEn: '{jmonth}',
  },
  code_jyear: {
    fa: 'متغیر سال شمسی',
    en: 'Solar year token',
    sampleFa: '{jyear}',
    sampleEn: '{jyear}',
  },
  code_month: {
    fa: 'متغیر ماه میلادی',
    en: 'Gregorian month token',
    sampleFa: '{month}',
    sampleEn: '{month}',
  },
  code_prefix: {
    fa: 'متغیر پیشوند نام‌گذاری',
    en: 'Prefix naming token',
    sampleFa: '{prefix}',
    sampleEn: '{prefix}',
  },
  code_random4: {
    fa: 'متغیر کد تصادفی ۴ کاراکتری',
    en: '4-char random token',
    sampleFa: '{random4}',
    sampleEn: '{random4}',
  },
  code_random6: {
    fa: 'متغیر کد تصادفی ۶ کاراکتری',
    en: '6-char random token',
    sampleFa: '{random6}',
    sampleEn: '{random6}',
  },
  code_random8: {
    fa: 'متغیر کد تصادفی ۸ کاراکتری',
    en: '8-char random token',
    sampleFa: '{random8}',
    sampleEn: '{random8}',
  },
  code_telegram_id: {
    fa: 'متغیر شناسه تلگرام',
    en: 'Telegram ID naming token',
    sampleFa: '{telegram_id}',
    sampleEn: '{telegram_id}',
  },
  code_year: {
    fa: 'متغیر سال میلادی ۴ رقمی',
    en: '4-digit Gregorian year token',
    sampleFa: '{year}',
    sampleEn: '{year}',
  },
  code_yy: {
    fa: 'متغیر سال میلادی ۲ رقمی',
    en: '2-digit Gregorian year token',
    sampleFa: '{yy}',
    sampleEn: '{yy}',
  },
  configs: {
    fa: 'تعداد سرویس‌های مشمول',
    en: 'Eligible services count',
    sampleFa: '۴۲',
    sampleEn: '42',
  },
  count: {
    fa: 'تعداد موارد',
    en: 'Item count',
    sampleFa: '۱۲',
    sampleEn: '12',
  },
  currency: {
    fa: 'واحد پول',
    en: 'Currency unit',
    sampleFa: 'تومان',
    sampleEn: 'Toman',
  },
  current: {
    fa: 'مقدار یا وضعیت فعلی',
    en: 'Current value or status',
    sampleFa: 'فعال',
    sampleEn: 'Enabled',
  },
  current_balance: {
    fa: 'موجودی فعلی کاربر',
    en: 'User current balance',
    sampleFa: '۱۲۰٬۰۰۰',
    sampleEn: '120,000',
  },
  current_value: {
    fa: 'مقدار فعلی تنظیم',
    en: 'Current setting value',
    sampleFa: '5000',
    sampleEn: '5000',
  },
  date: {
    fa: 'تاریخ',
    en: 'Date',
    sampleFa: '۱۴۰۵/۰۸/۳۰',
    sampleEn: '2026-11-20',
  },
  days: {
    fa: 'تعداد روز اعتبار',
    en: 'Validity or remaining days',
    sampleFa: '۳۰',
    sampleEn: '30',
  },
  days_unit: {
    fa: 'واحد زمان (روز)',
    en: 'Day unit',
    sampleFa: 'روز',
    sampleEn: 'days',
  },
  description: {
    fa: 'توضیح بخش',
    en: 'Section description',
    sampleFa: 'تنظیمات فروش و بسته‌ها',
    sampleEn: 'Sales and package settings',
  },
  domain: {
    fa: 'نام دامنه',
    en: 'Domain name',
    sampleFa: 'app.example.com',
    sampleEn: 'app.example.com',
  },
  error: {
    fa: 'متن خطا',
    en: 'Error details',
    sampleFa: 'اتصال برقرار نشد',
    sampleEn: 'Connection timed out',
  },
  example_date: {
    fa: 'نمونه قالب با تاریخ',
    en: 'Date template example',
    sampleFa: '{prefix}_{year}_{month}_{counter}',
    sampleEn: '{prefix}_{year}_{month}_{counter}',
  },
  example_primary: {
    fa: 'نمونه قالب استاندارد',
    en: 'Primary template example',
    sampleFa: '{prefix}_{telegram_id}_{counter}',
    sampleEn: '{prefix}_{telegram_id}_{counter}',
  },
  example_random: {
    fa: 'نمونه قالب با کد تصادفی',
    en: 'Random template example',
    sampleFa: '{prefix}_{counter}_{random4}',
    sampleEn: '{prefix}_{counter}_{random4}',
  },
  failed: {
    fa: 'تعداد موارد ناموفق',
    en: 'Failed items count',
    sampleFa: '۱',
    sampleEn: '1',
  },
  gb: {
    fa: 'میزان حجم (گیگابایت)',
    en: 'Traffic quota (GB)',
    sampleFa: '۵۰',
    sampleEn: '50',
  },
  healthy: {
    fa: 'تعداد پنل‌های سالم',
    en: 'Healthy panels count',
    sampleFa: '۲',
    sampleEn: '2',
  },
  holder: {
    fa: 'نام صاحب کارت بانکی',
    en: 'Bank card holder name',
    sampleFa: 'حسین کریمی',
    sampleEn: 'Hossein Karimi',
  },
  hours: {
    fa: 'تعداد ساعت',
    en: 'Hours count',
    sampleFa: '۵',
    sampleEn: '5',
  },
  hours_unit: {
    fa: 'واحد ساعت',
    en: 'Hours unit',
    sampleFa: 'ساعت',
    sampleEn: 'hours',
  },
  id: {
    fa: 'شناسه عددی',
    en: 'Numeric ID',
    sampleFa: '123456789',
    sampleEn: '123456789',
  },
  ignored: {
    fa: 'تعداد موارد نادیده‌گرفته‌شده',
    en: 'Ignored items count',
    sampleFa: '۲',
    sampleEn: '2',
  },
  inactive: {
    fa: 'تعداد موارد غیرفعال',
    en: 'Inactive items count',
    sampleFa: '۲',
    sampleEn: '2',
  },
  index: {
    fa: 'شماره ردیف',
    en: 'Position index',
    sampleFa: '۱',
    sampleEn: '1',
  },
  instance: {
    fa: 'نام اینستنس ربات',
    en: 'Bot instance name',
    sampleFa: 'main',
    sampleEn: 'main',
  },
  label: {
    fa: 'برچسب شخصی سرویس',
    en: 'Personal service label',
    sampleFa: 'گوشی شخصی',
    sampleEn: 'My Phone',
  },
  lang: {
    fa: 'برچسب زبان',
    en: 'Language label',
    sampleFa: '🦁 فارسی',
    sampleEn: '🇬🇧 English',
  },
  latency: {
    fa: 'زمان پاسخ (میلی‌ثانیه)',
    en: 'Latency (ms)',
    sampleFa: '۴۲',
    sampleEn: '42',
  },
  local: {
    fa: 'تعداد رکوردهای محلی ناپدیدشده',
    en: 'Missing local records count',
    sampleFa: '۱',
    sampleEn: '1',
  },
  max: {
    fa: 'حداکثر مقدار مجاز',
    en: 'Maximum allowed value',
    sampleFa: '۵۰۰',
    sampleEn: '500',
  },
  min: {
    fa: 'حداقل مقدار مجاز',
    en: 'Minimum allowed value',
    sampleFa: '۵',
    sampleEn: '5',
  },
  minutes: {
    fa: 'تعداد دقیقه',
    en: 'Minutes count',
    sampleFa: '۲۰',
    sampleEn: '20',
  },
  minutes_unit: {
    fa: 'واحد دقیقه',
    en: 'Minutes unit',
    sampleFa: 'دقیقه',
    sampleEn: 'minutes',
  },
  mode: {
    fa: 'حالت نمایش فعلی',
    en: 'Display mode',
    sampleFa: 'مشخصات',
    sampleEn: 'Specs',
  },
  name: {
    fa: 'نام کاربر، بسته یا دسته',
    en: 'User, package, or category name',
    sampleFa: 'بسته نقره‌ای',
    sampleEn: 'Silver Plan',
  },
  operation: {
    fa: 'نوع عملیات تغییر موجودی',
    en: 'Balance operation type',
    sampleFa: 'افزایش موجودی',
    sampleEn: 'Add funds',
  },
  packages: {
    fa: 'تعداد بسته‌های فعال',
    en: 'Active packages count',
    sampleFa: '۶',
    sampleEn: '6',
  },
  page: {
    fa: 'شماره صفحه فعلی',
    en: 'Current page number',
    sampleFa: '۱',
    sampleEn: '1',
  },
  pending: {
    fa: 'تعداد موارد در انتظار',
    en: 'Pending items count',
    sampleFa: '۳',
    sampleEn: '3',
  },
  percent: {
    fa: 'درصد تخفیف',
    en: 'Discount percentage',
    sampleFa: '۲۰',
    sampleEn: '20',
  },
  placeholders: {
    fa: 'فهرست متغیرها',
    en: 'List of placeholders',
    sampleFa: '`{username}`, `{balance}`',
    sampleEn: '`{username}`, `{balance}`',
  },
  prefix_value: {
    fa: 'مقدار پیشوند فعلی',
    en: 'Current prefix value',
    sampleFa: 'reb',
    sampleEn: 'reb',
  },
  price: {
    fa: 'قیمت بسته یا هر گیگ',
    en: 'Package or per-GB price',
    sampleFa: '۱۲۰٬۰۰۰',
    sampleEn: '120,000',
  },
  rate: {
    fa: 'نرخ تبدیل ارز',
    en: 'Currency exchange rate',
    sampleFa: '۸۵٬۰۰۰',
    sampleEn: '85,000',
  },
  reason: {
    fa: 'علت یا جزئیات خطا',
    en: 'Reason or error message',
    sampleFa: 'خطای اتصال به درگاه',
    sampleEn: 'Gateway connection error',
  },
  rejected: {
    fa: 'تعداد موارد ردشده',
    en: 'Rejected items count',
    sampleFa: '۱',
    sampleEn: '1',
  },
  remaining: {
    fa: 'مقدار باقی‌مانده (حجم یا روز)',
    en: 'Remaining traffic or days',
    sampleFa: '۲ گیگ',
    sampleEn: '2 GB',
  },
  remote: {
    fa: 'تعداد سرویس‌های بدون مالک در پنل',
    en: 'Unassigned panel services count',
    sampleFa: '۲',
    sampleEn: '2',
  },
  resolvedIp: {
    fa: 'آی‌پی شناسایی‌شده دامنه',
    en: 'Resolved domain IP',
    sampleFa: '203.0.113.10',
    sampleEn: '203.0.113.10',
  },
  search: {
    fa: 'عبارت جست‌وجوشده',
    en: 'Search query',
    sampleFa: 'فروشگاه',
    sampleEn: 'shop',
  },
  serverIp: {
    fa: 'آی‌پی سرور',
    en: 'Server IP address',
    sampleFa: '198.51.100.42',
    sampleEn: '198.51.100.42',
  },
  settings: {
    fa: 'فهرست تنظیمات فعلی',
    en: 'Current settings list',
    sampleFa: '• وضعیت: فعال',
    sampleEn: '• Status: Enabled',
  },
  short_id: {
    fa: 'شناسه کوتاه رسید',
    en: 'Short receipt ID',
    sampleFa: 'A8F4',
    sampleEn: 'A8F4',
  },
  size: {
    fa: 'حجم فایل بکاپ',
    en: 'Backup file size',
    sampleFa: '4.2 MB',
    sampleEn: '4.2 MB',
  },
  status: {
    fa: 'وضعیت سرویس',
    en: 'Service status',
    sampleFa: 'فعال',
    sampleEn: 'active',
  },
  step: {
    fa: 'شماره مرحله فعلی',
    en: 'Current step number',
    sampleFa: '۲',
    sampleEn: '2',
  },
  telegram_id: {
    fa: 'شناسه عددی تلگرام',
    en: 'Telegram user ID',
    sampleFa: '123456789',
    sampleEn: '123456789',
  },
  total: {
    fa: 'تعداد کل',
    en: 'Total count',
    sampleFa: '۱۰',
    sampleEn: '10',
  },
  total_pages: {
    fa: 'تعداد کل صفحات',
    en: 'Total pages count',
    sampleFa: '۴',
    sampleEn: '4',
  },
  url: {
    fa: 'آدرس اینترنتی (URL)',
    en: 'Web URL',
    sampleFa: 'https://app.example.com',
    sampleEn: 'https://app.example.com',
  },
  username: {
    fa: 'نام کاربری سرویس',
    en: 'Service username',
    sampleFa: 'reb1042',
    sampleEn: 'reb1042',
  },
  users: {
    fa: 'تعداد کاربران مشمول',
    en: 'Eligible users count',
    sampleFa: '۲۸',
    sampleEn: '28',
  },
  version: {
    fa: 'نسخه فرمت بکاپ',
    en: 'Backup format version',
    sampleFa: 'v2',
    sampleEn: 'v2',
  },
  volume: {
    fa: 'حجم بسته با واحد',
    en: 'Package volume with unit',
    sampleFa: '۵۰ گیگ',
    sampleEn: '50 GB',
  },
  webhook_url: {
    fa: 'آدرس Webhook درگاه',
    en: 'Gateway Webhook URL',
    sampleFa: 'https://app.example.com/api/webhooks/forapp',
    sampleEn: 'https://app.example.com/api/webhooks/forapp',
  },
};

export const PLACEHOLDER_DESCRIPTIONS: Readonly<Record<string, { fa: string; en: string }>> =
  Object.fromEntries(
    Object.entries(PLACEHOLDER_METADATA).map(([name, meta]) => [name, { fa: meta.fa, en: meta.en }])
  );

export function getSamplePlaceholderValues(locale: SupportedLocale): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PLACEHOLDER_METADATA).map(([name, meta]) => [
      name,
      locale === 'fa' ? meta.sampleFa : meta.sampleEn,
    ])
  );
}
