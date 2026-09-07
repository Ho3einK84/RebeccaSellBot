import crypto from 'node:crypto';

export interface ValidatedTelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  authDate: number;
  queryId?: string;
  user: ValidatedTelegramUser;
  rawParams: Record<string, string>;
}

/**
 * Validates Telegram Mini App initData according to Telegram's two-step HMAC specification:
 * 1. secretKey = HMAC_SHA256(key = "WebAppData", data = BOT_TOKEN)
 * 2. Build data_check_string from all fields except hash, sorted alphabetically as key=value joined by \n
 * 3. computedHash = HMAC_SHA256(key = secretKey, data = data_check_string) as hex
 * 4. Constant-time comparison using crypto.timingSafeEqual
 * 5. Freshness window check (default 24h)
 *
 * NOTE: Never log the raw initData, derived secretKey, or tokens.
 */
export function validateTelegramInitData(
  rawInitData: string,
  botToken: string,
  maxAgeSeconds = 86_400
): ValidatedInitData | null {
  if (!rawInitData || typeof rawInitData !== 'string') {
    return null;
  }

  try {
    const params = new URLSearchParams(rawInitData);
    const hash = params.get('hash');
    if (!hash) {
      return null;
    }

    params.delete('hash');

    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys.map((key) => `${key}=${params.get(key)}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const computedBuffer = Buffer.from(computedHash, 'utf8');
    const providedBuffer = Buffer.from(hash, 'utf8');

    if (computedBuffer.length !== providedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(computedBuffer, providedBuffer)) {
      return null;
    }

    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      return null;
    }

    const authDate = Number(authDateStr);
    if (!Number.isSafeInteger(authDate) || authDate <= 0) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - authDate > maxAgeSeconds || authDate > nowSeconds + 300) {
      return null;
    }

    const rawUser = params.get('user');
    if (!rawUser) {
      return null;
    }

    const parsedUser = JSON.parse(rawUser) as ValidatedTelegramUser;
    if (!parsedUser || !Number.isSafeInteger(parsedUser.id) || parsedUser.id <= 0) {
      return null;
    }

    const rawParams: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      rawParams[k] = v;
    }

    return {
      authDate,
      queryId: params.get('query_id') ?? undefined,
      user: parsedUser,
      rawParams,
    };
  } catch {
    return null;
  }
}
