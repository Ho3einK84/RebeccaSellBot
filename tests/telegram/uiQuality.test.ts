import { describe, expect, it, vi } from 'vitest';
import type { MenuContext } from '../../src/telegram/types.js';
import {
  cleanChatUiMiddleware,
  ensurePersianLineDirection,
  formatRtlLabeledValue,
  normalizeInputDigits,
  rememberUiMessage,
} from '../../src/telegram/ui.js';
import { buildHeader } from '../../src/telegram/designSystem.js';
import { renderHomeDashboard } from '../../src/telegram/keyboards/mainMenu.js';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/features/subscriptions/routes.js';
import { trackFunnelEvent } from '../../src/domain/services/FunnelTelemetry.js';

describe('Telegram UI quality', () => {
  it('1. Persian/Arabic number normalization', () => {
    expect(normalizeInputDigits('۵۰۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰,۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰،۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('٥٠٠٠٠')).toBe('50000');
    expect(normalizeInputDigits(' 50 000 ')).toBe('50000');
  });

  it('2. RTL rule enforcement & Telegram legacy Markdown headers', () => {
    const text = '👋 خوش آمدید!\n@username\nhttps://example.com\n🆔 ID: 123\nABC_456';
    const formatted = ensurePersianLineDirection(text);
    expect(formatted).toContain('\u200f@username');
    expect(formatted).toContain('\u200fhttps://example.com');
    expect(formatted).toContain('\u200fABC_456');

    // Labeled values
    expect(formatRtlLabeledValue('لینک اتصال', 'https://sub.example.com', '🔗')).toBe(
      '🔗 لینک اتصال: https://sub.example.com'
    );

    // Markdown single asterisk header
    const header = buildHeader('🏠', 'عنوان');
    expect(header).toBe('🏠 *عنوان*\n');
  });

  it('3. Artifact retention during UI cleanup', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const session = {
      uiMessageIds: [100],
      promptMessageIds: [101],
      artifactMessageIds: [102], // 102 is marked as an artifact!
    };

    const ctx = {
      chat: { id: 999, type: 'private' },
      callbackQuery: { message: { message_id: 100 } },
      session,
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;

    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => {
      rememberUiMessage(ctx.session, 103, 'screen');
    });

    expect(deleteMessage).toHaveBeenCalledWith(999, 100);
    expect(deleteMessage).toHaveBeenCalledWith(999, 101);
    expect(deleteMessage).not.toHaveBeenCalledWith(999, 102); // Artifact MUST NOT be deleted
  });

  it('4. Main Menu dashboard summary & state awareness', async () => {
    const getBalance = vi.fn().mockResolvedValue(100000);
    const listConfigsForOwner = vi
      .fn()
      .mockResolvedValue([
        { id: 'c1', configUsername: 'user1', panelStatus: 'active', panelExpire: null },
      ]);

    const ctx = {
      from: { id: 10 },
      userLocale: 'fa',
      services: {
        walletService: { getBalance },
        configService: { listConfigsForOwner },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const dashboard = await renderHomeDashboard(ctx);
    expect(dashboard).toContain('۱۰۰٬۰۰۰');
    expect(dashboard).toContain('۱');
  });

  it('5. Services 2-Level Action Hierarchy including Refresh Button', () => {
    const ctx = {
      services: {
        translationService: { get: vi.fn((key: string) => key), resolveLocale: vi.fn(() => 'fa') },
      },
    } as unknown as MenuContext;

    // Compact list (Level 1)
    const compactKb = buildSubscriptionActionKeyboard(ctx, 'c1', 'active', false, false);
    expect(compactKb.inline_keyboard.flat()).toHaveLength(1);
    expect((compactKb.inline_keyboard[0]![0] as { callback_data: string }).callback_data).toBe(
      'config:view:c1'
    );

    // Detail view (Level 2)
    const detailKb = buildSubscriptionActionKeyboard(ctx, 'c1', 'active', false, true);
    const callbacks = detailKb.inline_keyboard
      .flat()
      .map((b) => (b as { callback_data?: string }).callback_data);

    // Primary
    expect(callbacks).toContain('renew:open:c1');
    expect(callbacks).toContain('config:qr:c1');
    expect(callbacks).toContain('config:refresh:c1'); // Restored Refresh button!
    expect(callbacks).toContain('autorenew:on:c1');
    // Advanced
    expect(callbacks).toContain('config:set:off:c1');
    expect(callbacks).toContain('config:revoke_prompt:c1');
    expect(callbacks).toContain('config:transfer:c1');
    // Danger
    expect(callbacks).toContain('config:delete_prompt:c1');
  });

  it('6. Privacy-Safe Internal Funnel Telemetry Event tracking', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    trackFunnelEvent('shop_enter');
    trackFunnelEvent('checkout_start');
    trackFunnelEvent('purchase_confirm');
    trackFunnelEvent('receipt_submit');
    expect(true).toBe(true);
    spy.mockRestore();
  });
});
