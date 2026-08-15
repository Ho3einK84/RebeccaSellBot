import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import type { MenuContext } from '../../src/telegram/types.js';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/features/subscriptions/routes.js';

describe('Subscription views and action hierarchy', () => {
  it('renders level 1 compact card action keyboard with single detail view button', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) =>
            key === 'subscription_view_detail' ? '👁 مشاهده سرویس' : key
          ),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const keyboard = buildSubscriptionActionKeyboard(ctx, 'cfg_101', 'active', false, false);
    expect(keyboard).toBeInstanceOf(InlineKeyboard);
    const nonEmptyRows = keyboard.inline_keyboard.filter((row) => row.length > 0);
    expect(nonEmptyRows).toHaveLength(1);
    const button = nonEmptyRows[0]![0] as { text: string; callback_data: string };
    expect(button.text).toBe('👁 مشاهده سرویس');
    expect(button.callback_data).toBe('config:view:cfg_101');
  });

  it('renders level 2 detail view action keyboard with primary, advanced, and danger actions', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const keyboard = buildSubscriptionActionKeyboard(ctx, 'cfg_101', 'active', false, true);
    expect(keyboard).toBeInstanceOf(InlineKeyboard);
    expect(keyboard.inline_keyboard.length).toBeGreaterThanOrEqual(4);

    const flattenedCallbacks = keyboard.inline_keyboard.flat().map((btn) => btn.callback_data);
    expect(flattenedCallbacks).toContain('renew:open:cfg_101');
    expect(flattenedCallbacks).toContain('config:qr:cfg_101');
    expect(flattenedCallbacks).toContain('autorenew:on:cfg_101');
    expect(flattenedCallbacks).toContain('config:set:off:cfg_101');
    expect(flattenedCallbacks).toContain('config:revoke_prompt:cfg_101');
    expect(flattenedCallbacks).toContain('config:transfer:cfg_101');
    expect(flattenedCallbacks).toContain('config:delete_prompt:cfg_101');
  });
});
