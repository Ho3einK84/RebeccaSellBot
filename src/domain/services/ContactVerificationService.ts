import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { users } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import {
  phoneVerifyIranOnly,
  requirePhoneForPurchase,
  requirePhoneForTrial,
  type SettingReader,
} from './FeatureSettings.js';

export type PhoneVerificationErrorCode =
  'invalid' | 'iran_only' | 'already_bound' | 'secret_missing';

export type VerifyPhoneResult =
  | { ok: true; phoneHash: string; alreadyVerified: boolean }
  | { ok: false; reason: PhoneVerificationErrorCode };

export interface ContactVerificationServiceOptions {
  translationService?: SettingReader;
  botToken?: string;
}

function normalizePhoneDigits(raw: string): string {
  return raw
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalize a raw phone string into E.164 (`+<digits>`) format.
 * Handles Persian/Arabic digits, formatting characters, Iranian local `09...`,
 * international `00...`, bare country-coded numbers (e.g. `98912...`), and `+...`.
 */
export function normalizePhoneNumber(raw: string): string | null {
  if (typeof raw !== 'string') return null;

  const ascii = normalizePhoneDigits(raw).replace(/[\s\-()./\u200c\u200e\u200f]/gu, '');
  if (!ascii || !/^\+?\d+$/u.test(ascii)) return null;

  let digits: string;
  if (ascii.startsWith('+')) {
    digits = ascii.slice(1);
  } else if (ascii.startsWith('00')) {
    digits = ascii.slice(2);
  } else if (ascii.startsWith('09') && ascii.length === 11) {
    digits = `98${ascii.slice(1)}`;
  } else if (ascii.startsWith('0')) {
    // Reject ambiguous local numbers other than standard Iranian 09xxxxxxxxx mobile
    return null;
  } else {
    digits = ascii;
  }

  // Standard E.164 length: 8..15 digits with non-zero country code.
  if (!/^[1-9]\d{7,14}$/u.test(digits)) {
    return null;
  }

  return `+${digits}`;
}

/**
 * Returns true if the normalized E.164 phone number is a valid Iranian (+98) number.
 */
export function isIranPhoneNumber(normalized: string): boolean {
  return /^\+98[1-9]\d{9}$/u.test(normalized);
}

/**
 * Compute an irreversible keyed HMAC-SHA256 digest of a normalized phone number
 * using a key derived from the bot token. Raw phone numbers are never stored or logged.
 */
export function computePhoneHash(normalizedPhone: string, botToken: string): string {
  const token = botToken?.trim() ?? '';
  if (!token) {
    throw new Error('PHONE_HASH_SECRET_MISSING');
  }
  const normalized = normalizedPhone?.trim() ?? '';
  if (!normalized) {
    throw new Error('PHONE_HASH_INPUT_EMPTY');
  }
  const derivedKey = crypto.createHash('sha256').update(`phone-verify:${token}`).digest();
  return crypto.createHmac('sha256', derivedKey).update(normalized).digest('hex');
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

export class ContactVerificationService {
  constructor(private readonly options: ContactVerificationServiceOptions = {}) {}

  private resolveBotToken(): string {
    return (this.options.botToken ?? process.env.BOT_TOKEN ?? '').trim();
  }

  async isUserPhoneVerified(telegramId: number): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .select({
        phoneHash: users.phoneHash,
        phoneVerifiedAt: users.phoneVerifiedAt,
      })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    return Boolean(row && row.phoneHash && row.phoneVerifiedAt);
  }

  async shouldRequirePhoneForTrial(telegramId: number, settings?: SettingReader): Promise<boolean> {
    const reader = settings ?? this.options.translationService;
    if (!reader || typeof reader.getSetting !== 'function' || !requirePhoneForTrial(reader)) {
      return false;
    }
    return !(await this.isUserPhoneVerified(telegramId));
  }

  async shouldRequirePhoneForPurchase(
    telegramId: number,
    settings?: SettingReader
  ): Promise<boolean> {
    const reader = settings ?? this.options.translationService;
    if (!reader || typeof reader.getSetting !== 'function' || !requirePhoneForPurchase(reader)) {
      return false;
    }
    return !(await this.isUserPhoneVerified(telegramId));
  }

  async verifyAndBindPhone(params: {
    telegramId: number;
    rawPhoneNumber: string;
    settings?: SettingReader;
  }): Promise<VerifyPhoneResult> {
    const normalized = normalizePhoneNumber(params.rawPhoneNumber);
    if (!normalized) {
      return { ok: false, reason: 'invalid' };
    }

    const reader = params.settings ?? this.options.translationService;
    const iranOnly =
      reader && typeof reader.getSetting === 'function' ? phoneVerifyIranOnly(reader) : true;
    if (iranOnly && !isIranPhoneNumber(normalized)) {
      return { ok: false, reason: 'iran_only' };
    }

    const botToken = this.resolveBotToken();
    if (!botToken) {
      logger.error(
        { telegramId: params.telegramId },
        'Phone verification failed: BOT_TOKEN missing'
      );
      return { ok: false, reason: 'secret_missing' };
    }

    const phoneHash = computePhoneHash(normalized, botToken);
    const db = getDb();

    const [existingOwner] = await db
      .select({
        telegramId: users.telegramId,
        phoneVerifiedAt: users.phoneVerifiedAt,
      })
      .from(users)
      .where(eq(users.phoneHash, phoneHash))
      .limit(1);

    if (existingOwner && existingOwner.telegramId !== params.telegramId) {
      return { ok: false, reason: 'already_bound' };
    }

    if (
      existingOwner &&
      existingOwner.telegramId === params.telegramId &&
      existingOwner.phoneVerifiedAt
    ) {
      return { ok: true, phoneHash, alreadyVerified: true };
    }

    const now = new Date();
    try {
      await db
        .update(users)
        .set({
          phoneHash,
          phoneVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(users.telegramId, params.telegramId));
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return { ok: false, reason: 'already_bound' };
      }
      throw err;
    }

    logger.info({ telegramId: params.telegramId }, 'User phone verified via HMAC-SHA256 hash');
    return { ok: true, phoneHash, alreadyVerified: false };
  }
}
