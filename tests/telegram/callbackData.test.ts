import { describe, expect, it, vi } from 'vitest';
import { callbackData, isUuidCallbackValue } from '../../src/telegram/callbackData.js';
import { panelCallback } from '../../src/telegram/features/admin/panelRoutes.js';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/features/subscriptions/routes.js';
import type { MenuContext } from '../../src/telegram/types.js';

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

  it('keeps every panel action within the callback limit at maximum valid IDs', () => {
    const panelId = 'p'.repeat(40);
    const serviceId = 2_147_483_647;
    const callbacks = [
      panelCallback('v', panelId),
      panelCallback('t', panelId),
      panelCallback('g', panelId, 1),
      panelCallback('d', panelId),
      panelCallback('e', panelId, 'n'),
      panelCallback('e', panelId, 'u'),
      panelCallback('e', panelId, 'k'),
      panelCallback('e', panelId, 's'),
      panelCallback('s', 'd', panelId, serviceId),
      panelCallback('s', 'c', panelId, serviceId),
      panelCallback('s', 'x', panelId, serviceId),
      panelCallback('s', 'xc', panelId, serviceId),
      panelCallback('x', panelId),
      panelCallback('xc', panelId),
    ];

    expect(
      Math.max(...callbacks.map((value) => Buffer.byteLength(value, 'utf8')))
    ).toBeLessThanOrEqual(64);
  });

  it('keeps every subscription action within the callback limit at maximum config IDs', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as MenuContext;
    const keyboard = buildSubscriptionActionKeyboard(ctx, 'c'.repeat(40), 'active', false, true);
    const callbacks = keyboard.inline_keyboard
      .flat()
      .flatMap((button) => ('callback_data' in button ? [button.callback_data] : []));

    expect(callbacks.length).toBeGreaterThan(0);
    expect(
      Math.max(...callbacks.map((value) => Buffer.byteLength(value, 'utf8')))
    ).toBeLessThanOrEqual(64);
  });
});
