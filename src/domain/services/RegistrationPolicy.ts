import { registrationMode, type RegistrationMode, type SettingReader } from './FeatureSettings.js';
import type { SupportedLocale } from './TranslationCatalog.js';

export type RegistrationBlockReason = 'closed' | 'invite_only';

export type RegistrationBlockCode = 'REGISTRATION_CLOSED' | 'REGISTRATION_INVITE_ONLY';

export type RegistrationAccessResult =
  | {
      allowed: true;
      mode: RegistrationMode;
      isExistingUser: boolean;
      isAdmin: boolean;
      referrerId?: number;
    }
  | {
      allowed: false;
      mode: RegistrationMode;
      reason: RegistrationBlockReason;
      code: RegistrationBlockCode;
    };

export interface RegistrationPolicyTranslationReader extends SettingReader {
  get(key: string, locale?: SupportedLocale, params?: Record<string, string | number>): string;
}

export interface ReferrerLookup {
  resolveReferrerId(
    rawReferralCode: string | undefined,
    recipientTelegramId: number
  ): Promise<number | undefined>;
}

/**
 * Extract a `ref_...` token from either a `/start` command (`/start ref_123`,
 * `/start@BotName ref_123`) or a raw payload (`ref_123`).
 */
export function extractStartReferralCode(
  textOrPayload: string | null | undefined
): string | undefined {
  const trimmed = (textOrPayload ?? '').trim();
  if (!trimmed) return undefined;

  let payload = trimmed;
  if (trimmed.startsWith('/')) {
    const startMatch = /^\/start(?:@[a-z0-9_]+)?(?:\s+([^\s]+))?/iu.exec(trimmed);
    if (!startMatch) return undefined;
    payload = (startMatch[1] ?? '').trim();
  }

  return payload.startsWith('ref_') && payload.length <= 128 ? payload : undefined;
}

/**
 * Evaluate whether a Telegram / Mini App visitor is allowed to create or access
 * an account under the configured `registration_mode`.
 *
 * Invariants:
 * - Already-registered users (`userExists === true`) and admins (`isAdmin === true`)
 *   are NEVER blocked regardless of mode.
 * - In `invite_only` mode, new non-admin users require a valid non-self referral code
 *   resolved via `ReferralService.resolveReferrerId`.
 */
export async function evaluateRegistrationAccess(input: {
  telegramId: number;
  isAdmin: boolean;
  userExists: boolean;
  settings: SettingReader;
  referralCode?: string | null;
  referralService?: ReferrerLookup | null;
}): Promise<RegistrationAccessResult> {
  const mode = registrationMode(input.settings);

  if (input.isAdmin || input.userExists || mode === 'open') {
    return {
      allowed: true,
      mode,
      isExistingUser: input.userExists,
      isAdmin: input.isAdmin,
    };
  }

  if (mode === 'closed') {
    return {
      allowed: false,
      mode,
      reason: 'closed',
      code: 'REGISTRATION_CLOSED',
    };
  }

  const candidateCode = input.referralCode?.trim();
  if (
    candidateCode &&
    input.referralService &&
    typeof input.referralService.resolveReferrerId === 'function'
  ) {
    const referrerId = await input.referralService.resolveReferrerId(
      candidateCode,
      input.telegramId
    );
    if (referrerId !== undefined && referrerId !== null) {
      return {
        allowed: true,
        mode,
        isExistingUser: false,
        isAdmin: false,
        referrerId,
      };
    }
  }

  return {
    allowed: false,
    mode,
    reason: 'invite_only',
    code: 'REGISTRATION_INVITE_ONLY',
  };
}

/** Resolve localized user-facing title, body, and short callback alert for blocked registrations. */
export function resolveRegistrationBlockedCopy(
  translationService: Partial<RegistrationPolicyTranslationReader> | null | undefined,
  locale: SupportedLocale,
  reason: RegistrationBlockReason
): { title: string; message: string; alert: string } {
  const titleKey =
    reason === 'closed' ? 'registration_closed_title' : 'registration_invite_only_title';
  const messageKey =
    reason === 'closed' ? 'registration_closed_message' : 'registration_invite_only_message';

  if (typeof translationService?.get === 'function') {
    return {
      title: translationService.get(titleKey, locale),
      message: translationService.get(messageKey, locale),
      alert: translationService.get('registration_blocked_alert', locale),
    };
  }

  return reason === 'closed'
    ? {
        title: locale === 'en' ? 'Registration Closed' : 'ثبت‌نام موقتاً بسته است',
        message:
          locale === 'en'
            ? 'New user registration is currently closed.'
            : 'در حال حاضر پذیرش کاربر جدید غیرفعال است.',
        alert:
          locale === 'en'
            ? 'New user registration is currently restricted.'
            : 'امکان ثبت‌نام کاربر جدید در حال حاضر فعال نیست.',
      }
    : {
        title: locale === 'en' ? 'Invite-Only Registration' : 'ثبت‌نام فقط با دعوت',
        message:
          locale === 'en'
            ? 'Registration is currently invite-only.'
            : 'ثبت‌نام در حال حاضر فقط از طریق لینک دعوت معتبر امکان‌پذیر است.',
        alert:
          locale === 'en'
            ? 'New user registration is currently restricted.'
            : 'امکان ثبت‌نام کاربر جدید در حال حاضر فعال نیست.',
      };
}
