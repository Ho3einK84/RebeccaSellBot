import { describe, expect, it } from 'vitest';
import { callbackData, isUuidCallbackValue } from '../../src/telegram/callbackData.js';

describe('Telegram callback data', () => {
  it('keeps stable UUID actions within Telegram UTF-8 limits', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const value = callbackData('promo', 'delete_confirm', id);
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
    expect(isUuidCallbackValue(id)).toBe(true);
  });

  it('keeps lifecycle UUID actions within Telegram limits', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(Buffer.byteLength(callbackData('admin', 'orphan', 'remove_confirm', id), 'utf8')).toBe(
      64
    );
    expect(
      Buffer.byteLength(callbackData('admin', 'broadcast', 'status', id), 'utf8')
    ).toBeLessThanOrEqual(64);
  });

  it('rejects oversized or control-character payloads before rendering', () => {
    expect(() => callbackData('x', 'a'.repeat(64))).toThrow('TELEGRAM_CALLBACK_DATA_TOO_LONG');
    expect(() => callbackData('x', '\n')).toThrow('TELEGRAM_CALLBACK_DATA_INVALID');
  });
});
