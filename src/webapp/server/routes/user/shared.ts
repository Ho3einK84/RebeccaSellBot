import type { FastifyRequest } from 'fastify';
import type { Api } from 'grammy';
import { resolveRateLimitKey } from '../../server.js';
import type { AdminService } from '../../../../domain/services/AdminService.js';
import type { UserService } from '../../../../domain/services/UserService.js';
import type { WalletService } from '../../../../domain/services/WalletService.js';
import type { ConfigService } from '../../../../domain/services/ConfigService.js';
import type { PricingService } from '../../../../domain/services/PricingService.js';
import type { PackageCategoryService } from '../../../../domain/services/PackageCategoryService.js';
import type { PromoService } from '../../../../domain/services/PromoService.js';
import type { PaymentService } from '../../../../domain/services/PaymentService.js';
import type { AutomatedPaymentService } from '../../../../domain/services/AutomatedPaymentService.js';
import type {
  SupportedLocale,
  TranslationService,
} from '../../../../domain/services/TranslationService.js';
import type { PurchaseCheckoutService } from '../../../../domain/services/PurchaseCheckoutService.js';
import type { CatalogDiscountService } from '../../../../domain/services/CatalogDiscountService.js';
import type { ContactVerificationService } from '../../../../domain/services/ContactVerificationService.js';
import type { LuckyWheelService } from '../../../../domain/services/LuckyWheelService.js';
import type { TrialService } from '../../../../domain/services/TrialService.js';
import type { ReferralService } from '../../../../domain/services/ReferralService.js';
import type { RefundService } from '../../../../domain/services/RefundService.js';
import type { ConfigTransferService } from '../../../../domain/services/ConfigTransferService.js';
import type { RebeccaPanelRegistry } from '../../../../domain/services/RebeccaPanelRegistry.js';
import { resolveSupportDestination } from '../../../../domain/services/SupportDestination.js';

export interface UserRoutesOptions {
  userService: UserService;
  walletService: WalletService;
  configService?: ConfigService;
  pricingService?: PricingService;
  packageCategoryService?: PackageCategoryService;
  promoService?: PromoService;
  paymentService?: PaymentService;
  automatedPaymentService?: AutomatedPaymentService;
  translationService?: TranslationService;
  purchaseCheckoutService?: PurchaseCheckoutService;
  catalogDiscountService?: CatalogDiscountService;
  contactVerificationService?: ContactVerificationService;
  luckyWheelService?: LuckyWheelService;
  trialService?: TrialService;
  referralService?: ReferralService;
  refundService?: RefundService;
  configTransferService?: ConfigTransferService;
  panelRegistry?: RebeccaPanelRegistry;
  adminService?: AdminService;
  adminIds?: number[];
  botApi?: Api;
  botUsername?: string;
  supportUrl?: string;
  webAppUrl?: string;
}

export interface UserRateLimitConfigs {
  standard: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
  checkout: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
  confirm: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
  action30: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
  action10: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
  action6: {
    max: number;
    timeWindow: string;
    hook: 'preHandler';
    keyGenerator: (req: FastifyRequest) => string;
  };
}

export function createUserRateLimits(): UserRateLimitConfigs {
  const keyGenerator = (req: FastifyRequest) => resolveRateLimitKey(req);
  return {
    standard: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
    checkout: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
    confirm: { max: 5, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
    action30: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
    action10: { max: 10, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
    action6: { max: 6, timeWindow: '1 minute', hook: 'preHandler', keyGenerator },
  };
}

export function clampPositiveInt(
  val: string | number | undefined,
  fallback: number,
  max = 1000
): number {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = typeof val === 'number' ? val : Number.parseInt(String(val), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const DEFAULT_PACKAGE_FALLBACK_NAMES = new Set([
  '10 GB - 30 Days',
  '30 GB - 30 Days',
  '50 GB - 30 Days',
  '100 GB - 60 Days',
]);

export async function resolveUserLocale(
  telegramId: number,
  options: Pick<UserRoutesOptions, 'userService' | 'translationService'>
): Promise<SupportedLocale> {
  try {
    const stored = await options.userService.getLocale?.(telegramId);
    if (stored === 'fa' || stored === 'en') return stored;
  } catch {
    // Fallback to default
  }
  const fallback =
    typeof options.translationService?.getDefaultLocale === 'function'
      ? options.translationService.getDefaultLocale()
      : 'fa';
  return fallback === 'en' ? 'en' : 'fa';
}

/**
 * Localizes package names consistently with Telegram's `localizedPackageName`:
 * 1. Custom IDs (`custom_50gb_30d`) -> `50 گیگابایت · 30 روز` / `50 GB · 30d`
 * 2. Bilingual pipe format (`نام فارسی | English Name`)
 * 3. Translation catalog overrides (`package_<id>_name`) when available
 * 4. Smart GB/گیگ conversion
 */
export function localizePackageName(
  packageId: string,
  fallback: string,
  locale: SupportedLocale,
  translationService?: TranslationService
): string {
  const isFa = locale === 'fa';
  const trimmedFallback = fallback?.trim() ?? '';

  // 1. Bilingual pipe separator: "نام فارسی | English Name"
  if (trimmedFallback.includes('|')) {
    const parts = trimmedFallback.split('|').map((s) => s.trim());
    const faPart = parts[0] || '';
    const enPart = parts[1] || faPart;
    return isFa ? faPart : enPart;
  }

  // 2. Custom package IDs when no human-formatted label was already supplied
  const customMatch = /^custom_(\d+)gb(?:_(\d+)d)?$/iu.exec(packageId);
  if (customMatch && (!trimmedFallback || trimmedFallback === packageId)) {
    const gb = Number(customMatch[1]);
    const days = customMatch[2] ? Number(customMatch[2]) : undefined;
    const numLocale = isFa ? 'fa-IR' : 'en-US';
    const gbStr = gb.toLocaleString(numLocale);
    if (days) {
      const daysStr = days.toLocaleString(numLocale);
      return isFa ? `${gbStr} گیگابایت · ${daysStr} روز` : `${gbStr} GB · ${daysStr}d`;
    }
    return isFa ? `${gbStr} گیگابایت` : `${gbStr} GB`;
  }

  // 3. Explicit translation catalog overrides for default package IDs
  if (
    typeof translationService?.get === 'function' &&
    (!trimmedFallback || DEFAULT_PACKAGE_FALLBACK_NAMES.has(trimmedFallback))
  ) {
    const key = `package_${packageId}_name`;
    const translated = translationService.get(key, locale);
    if (translated && translated !== key) {
      return translated;
    }
  }

  // 4. In English locale, translate pure Persian volume/day names (e.g. "۵۰ گیگ - ۳۰ روز")
  if (!isFa && trimmedFallback) {
    const normalizedFallback = trimmedFallback.replace(/[۰-۹]/gu, (d) =>
      String(d.charCodeAt(0) - 0x06f0)
    );
    const match = /^(\d+)\s*(?:گیگ|گیگابایت)(?:\s*[-·]\s*(\d+)\s*روز)?$/iu.exec(
      normalizedFallback.trim()
    );
    if (match) {
      return match[2] ? `${match[1]} GB · ${match[2]}d` : `${match[1]} GB`;
    }
  }

  return trimmedFallback || packageId;
}

export function localizeBilingualLabel(raw: string, locale: SupportedLocale): string {
  if (!raw || !raw.includes('|')) return raw;
  const parts = raw.split('|').map((s) => s.trim());
  const faPart = parts[0] || '';
  const enPart = parts[1] || faPart;
  return locale === 'fa' ? faPart : enPart;
}

export function resolveSupportInfoForUser(options: UserRoutesOptions) {
  const rawDestination = options.translationService?.getSetting('support_destination', '') || '';
  const fallbackAdminId = options.adminService?.adminIds?.[0] ?? options.adminIds?.[0];
  const resolved = resolveSupportDestination({
    rawDestination,
    supportUrl: options.supportUrl,
    fallbackAdminId,
  });
  const supportEnabled =
    options.translationService?.getSettingBool('support_enabled', true) ?? true;
  return {
    supportEnabled,
    supportUsername: resolved.username,
    supportUrl: resolved.url,
    supportLabel: resolved.label,
  };
}

/**
 * Masks a user's display name/username for safe transfer confirmation previews
 * (enough for the sender to confirm identity without leaking full private data).
 */
export function buildMaskedRecipientPreview(user: {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}): {
  telegramId: number;
  displayName: string;
  username: string | null;
} {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const displayName =
    fullName || (user.username ? `@${user.username}` : `User #${user.telegramId}`);
  return {
    telegramId: user.telegramId,
    displayName,
    username: user.username ? `@${user.username}` : null,
  };
}

export function formatReceiptShortId(receiptId: string): string {
  const match = receiptId.match(/_([a-zA-Z0-9]{4,8})$/u);
  if (match) return match[1]!;
  return receiptId.length > 8 ? receiptId.slice(-6) : receiptId;
}

export interface DecodedReceiptUpload {
  buffer: Buffer;
  mediaType: 'photo' | 'document';
  mimeType: string;
  extension: string;
}

const MAX_RECEIPT_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB

/**
 * Validates and decodes a base64 receipt upload by inspecting raw magic bytes
 * (never trusts client-supplied MIME header alone).
 */
export function decodeAndValidateReceiptUpload(
  fileBase64: string
): { ok: true; file: DecodedReceiptUpload } | { ok: false; code: string; error: string } {
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    return { ok: false, code: 'INVALID_RECEIPT_FILE', error: 'Receipt image is required' };
  }

  // Strip optional data URI prefix (`data:image/jpeg;base64,...`)
  const commaIdx = fileBase64.indexOf(',');
  const rawBase64 =
    fileBase64.startsWith('data:') && commaIdx > 0 ? fileBase64.slice(commaIdx + 1) : fileBase64;
  const cleaned = rawBase64.replace(/\s+/gu, '');
  if (!cleaned || cleaned.length > Math.ceil((MAX_RECEIPT_UPLOAD_BYTES * 4) / 3) + 16) {
    return {
      ok: false,
      code: 'RECEIPT_FILE_TOO_LARGE',
      error: 'Receipt file exceeds the 5 MB size limit',
    };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleaned, 'base64');
  } catch {
    return { ok: false, code: 'INVALID_RECEIPT_FILE', error: 'Invalid base64 image payload' };
  }

  if (buffer.byteLength < 16) {
    return { ok: false, code: 'INVALID_RECEIPT_FILE', error: 'Receipt file is empty or corrupt' };
  }
  if (buffer.byteLength > MAX_RECEIPT_UPLOAD_BYTES) {
    return {
      ok: false,
      code: 'RECEIPT_FILE_TOO_LARGE',
      error: 'Receipt file exceeds the 5 MB size limit',
    };
  }

  // Magic byte detection
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      ok: true,
      file: { buffer, mediaType: 'photo', mimeType: 'image/jpeg', extension: 'jpg' },
    };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      ok: true,
      file: { buffer, mediaType: 'photo', mimeType: 'image/png', extension: 'png' },
    };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return {
      ok: true,
      file: { buffer, mediaType: 'photo', mimeType: 'image/webp', extension: 'webp' },
    };
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return {
      ok: true,
      file: { buffer, mediaType: 'document', mimeType: 'application/pdf', extension: 'pdf' },
    };
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_RECEIPT_TYPE',
    error: 'Only JPG, PNG, WEBP images or PDF files are supported',
  };
}
