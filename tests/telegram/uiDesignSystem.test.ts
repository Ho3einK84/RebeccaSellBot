import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MenuContext } from '../../src/telegram/types.js';
import {
  buildConfirmationKeyboard,
  buildHeader,
  buildSectionCard,
  buildStatusBadge,
  cleanChatUiMiddleware,
  ensurePersianLineDirection,
  formatRtlLabeledValue,
  normalizeInputDigits,
  rememberArtifactMessage,
  rememberUiMessage,
} from '../../src/telegram/ui.js';

describe('Design System and Number Normalization', () => {
  it('normalizes Persian and Arabic digits and strips formatting separators', () => {
    expect(normalizeInputDigits('۵۰۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰,۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰،۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰ ۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('٥٠٠٠٠')).toBe('50000');
    expect(normalizeInputDigits(' 50_000 ')).toBe('50000');
    expect(normalizeInputDigits('')).toBe('');
  });

  it('formats RTL labeled values cleanly', () => {
    expect(formatRtlLabeledValue('لینک اتصال', 'https://example.com', '🔗')).toBe(
      '🔗 لینک اتصال: https://example.com'
    );
    expect(formatRtlLabeledValue('شناسه', 'abc_123')).toBe('شناسه: abc_123');
  });

  it('enforces RTL line direction on lines starting with Latin characters, @handles, URLs, or IDs', () => {
    const multiline = `👋 به ربات خوش آمدید!
@username
https://example.com
🆔 شناسه: 123
ABC_456`;

    const formatted = ensurePersianLineDirection(multiline);
    expect(formatted).toBe(
      `👋 به ربات خوش آمدید!
\u200f@username
\u200fhttps://example.com
🆔 شناسه: 123
\u200fABC_456`
    );
  });

  it('builds standard header and status badges', () => {
    expect(buildHeader('🏠', 'منوی اصلی', 'داشبورد کاربر')).toBe(
      '🏠 *منوی اصلی*\n_داشبورد کاربر_\n'
    );

    expect(buildStatusBadge('active')).toBe('🟢 فعال');
    expect(buildStatusBadge('inactive')).toBe('⏸️ غیرفعال');
    expect(buildStatusBadge('pending')).toBe('⏳ در انتظار');
    expect(buildStatusBadge('expired')).toBe('⚠️ منقضیشده');
  });

  it('renders section card properly', () => {
    const card = buildSectionCard('اطلاعات سرویس', [
      { label: 'وضعیت', value: 'فعال', emoji: '🟢' },
      { label: 'شناسه', value: 'cfg_101', emoji: '🆔' },
    ]);
    expect(card).toBe('📌 *اطلاعات سرویس*\n\n🟢 *وضعیت:* فعال\n🆔 *شناسه:* cfg_101');
  });

  it('builds standard confirmation keyboard', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => (key === 'buy_confirm_button' ? 'تأیید' : 'انصراف')),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    const kb = buildConfirmationKeyboard(ctx, 'buy:confirm');
    expect(kb).toBeInstanceOf(InlineKeyboard);
    expect(kb.inline_keyboard).toHaveLength(2);
  });
});

describe('UI Cleanup with Message Roles & Artifact Retention', () => {
  it('protects artifact message IDs from deletion during cleanChatUiMiddleware', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const session = {
      uiMessageIds: [10, 11],
      promptMessageIds: [12],
      artifactMessageIds: [11], // message 11 is marked as an artifact!
    };

    const ctx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 10 } },
      session,
      api: {
        deleteMessage,
        config: { use: vi.fn() },
      },
    } as unknown as MenuContext;

    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => {
      rememberUiMessage(ctx.session, 13, 'screen');
    });

    // Message 10 is deleted (ephemeral screen message replaced by 13).
    // Message 12 is deleted (ephemeral prompt message).
    // Message 11 MUST NOT be deleted because it is in artifactMessageIds!
    expect(deleteMessage).toHaveBeenCalledWith(123, 10);
    expect(deleteMessage).toHaveBeenCalledWith(123, 12);
    expect(deleteMessage).not.toHaveBeenCalledWith(123, 11);
  });

  it('stores message IDs in role-specific session stores', () => {
    const session = {};
    rememberUiMessage(session, 1, 'screen');
    rememberUiMessage(session, 2, 'prompt');
    rememberArtifactMessage(session, 3);

    expect(session).toEqual({
      uiMessageIds: [1],
      promptMessageIds: [2],
      artifactMessageIds: [3],
    });
  });
});
