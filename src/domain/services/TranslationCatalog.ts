/**
 * Immutable translation and operational-setting defaults.
 *
 * Kept separate from the database-backed service so the large bilingual
 * catalog can evolve without obscuring cache/persistence behavior.
 */

import { FA_TEXTS } from './TranslationCatalog.fa.js';
import { EN_TEXTS } from './TranslationCatalog.en.js';

export const SUPPORTED_LOCALES = ['fa', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'fa';

const DEFAULT_PACKAGES = [
  { id: 'pkg_10gb_30d', name: '10 GB - 30 Days', gbAmount: 10, durationDays: 30, price: 50_000 },
  { id: 'pkg_30gb_30d', name: '30 GB - 30 Days', gbAmount: 30, durationDays: 30, price: 120_000 },
  { id: 'pkg_50gb_30d', name: '50 GB - 30 Days', gbAmount: 50, durationDays: 30, price: 180_000 },
  {
    id: 'pkg_100gb_60d',
    name: '100 GB - 60 Days',
    gbAmount: 100,
    durationDays: 60,
    price: 320_000,
  },
] as const;

export const CONFIGURATION_DEFAULTS: Record<string, string> = {
  // Pricing, packages, and payment instructions.
  price_per_gb: '5000',
  price_per_day: '0',
  // Validated pricing policy inputs. Empty arrays retain the simple
  // price_per_gb + price_per_day calculation until an admin configures rules.
  volume_pricing_tiers_json: '[]',
  custom_price_overrides_json: '[]',
  packages_json: JSON.stringify(DEFAULT_PACKAGES),
  package_display_mode: 'specs',
  // Default subscription length (days) applied to the custom-volume flow.
  custom_default_days: '30',
  // Admin switch for exposing custom-volume purchase and renewal flows.
  custom_volume_enabled: 'true',
  custom_volume_target_json: '{}',
  card_number: '6037997900000000',
  card_holder: 'Name',
  topup_min_amount: '10000',
  topup_max_amount: '10000000',
  wallet_transfer_enabled: 'true',
  wallet_transfer_min_amount: '5000',
  support_message: 'برای پشتیبانی با مدیر در تماس باشید.',
  support_destination: '',
  support_enabled: 'true',

  // Notification thresholds. Rebecca connection/service configuration lives
  // in normalized, encrypted panel tables rather than this generic K/V store.
  low_traffic_threshold_gb: '2',
  expiry_warning_days: '3',
  refund_window_hours: '0',

  // Trial, referral, cashback, and dynamic naming.
  trial_enabled: 'true',
  trial_gb: '1',
  trial_days: '3',
  referral_bonus_toman: '10000',
  cashback_percent: '5',
  naming_mode: 'custom',
  custom_naming_template: '{prefix}_{telegram_id}_{counter}',
  naming_prefix: 'rebecca',

  // System, maintenance, and language settings.
  bot_enabled: 'true',
  language_selection_enabled: 'true',
  default_locale: 'fa',
};

function qualify(locale: SupportedLocale, texts: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(texts).map(([key, value]) => [`${locale}.${key}`, value])
  );
}

/**
 * Complete hardcoded safety net. Rows in `settings` override these values, but
 * translation handlers always have a usable string if a row was never seeded
 * or has been deleted by an administrator.
 */
export const DEFAULT_SETTINGS: Readonly<Record<string, string>> = Object.freeze({
  ...CONFIGURATION_DEFAULTS,
  ...qualify('fa', FA_TEXTS),
  ...qualify('en', EN_TEXTS),
});
