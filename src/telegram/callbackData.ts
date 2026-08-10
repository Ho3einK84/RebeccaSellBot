const TELEGRAM_CALLBACK_MAX_BYTES = 64;

/** Build callback data and fail during rendering rather than at Telegram API time. */
export function callbackData(...parts: Array<string | number>): string {
  const value = parts.join(':');
  if (Buffer.byteLength(value, 'utf8') > TELEGRAM_CALLBACK_MAX_BYTES) {
    throw new Error('TELEGRAM_CALLBACK_DATA_TOO_LONG');
  }
  if (!value || [...value].some((character) => character.codePointAt(0)! < 32)) {
    throw new Error('TELEGRAM_CALLBACK_DATA_INVALID');
  }
  return value;
}

export function isUuidCallbackValue(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
