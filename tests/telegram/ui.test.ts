import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MenuContext, MyConversation } from '../../src/telegram/types.js';
import {
  cleanChatUiMiddleware,
  promptInConversation,
  rememberUiMessage,
  waitForTextInput,
} from '../../src/telegram/ui.js';

describe('private-chat UI cleanup', () => {
  it('removes the previous screen and replaces the pressed menu message', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 11 } },
      session: { uiMessageIds: [10, 11] },
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
      rememberUiMessage(ctx.session, 12);
    });

    expect(deleteMessage).toHaveBeenCalledWith(123, 10);
    expect(deleteMessage).toHaveBeenCalledWith(123, 11);
    expect(ctx.session.uiMessageIds).toEqual([12]);
  });

  it('lets users cancel a pending text step from its inline button', async () => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 20 });
    const input = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      callbackQuery: { data: 'conversation:cancel' },
      answerCallbackQuery,
      reply,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as ConversationContext;
    const outsideCtx = { session: {} };
    const conversation = {
      wait: vi.fn().mockResolvedValue(input),
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    await expect(waitForTextInput(conversation)).resolves.toBeUndefined();
    expect(answerCallbackQuery).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('operation_cancelled', expect.any(Object));
  });
});

describe('promptInConversation inline keyboard', () => {
  function buildCtx() {
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });
    const ctx = {
      reply,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as ConversationContext;
    const outsideCtx = { session: {} };
    const conversation = {
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;
    return { ctx, conversation, reply };
  }

  it('preserves a caller-supplied inline keyboard (e.g. category buttons)', async () => {
    const { ctx, conversation, reply } = buildCtx();
    const customKeyboard = new InlineKeyboard()
      .text('Pricing', 'set-group:pricing')
      .text('Payment', 'set-group:payment')
      .row()
      .text('menu_cancel', 'conversation:cancel');

    await promptInConversation(conversation, ctx, 'pick a category', {
      reply_markup: customKeyboard,
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const passedOptions = reply.mock.calls[0]![1] as { reply_markup: InlineKeyboard };
    // The caller's keyboard must be forwarded untouched — not replaced by a
    // bare cancel keyboard. grammY InlineKeyboard serializes to the same
    // object reference, so identity comparison is sufficient and robust.
    expect(passedOptions.reply_markup).toBe(customKeyboard);
  });

  it('falls back to a bare cancel keyboard when no keyboard is supplied', async () => {
    const { ctx, conversation, reply } = buildCtx();

    await promptInConversation(conversation, ctx, 'enter a value');

    expect(reply).toHaveBeenCalledTimes(1);
    const passedOptions = reply.mock.calls[0]![1] as { reply_markup: InlineKeyboard };
    expect(passedOptions.reply_markup).toBeInstanceOf(InlineKeyboard);
    // A bare cancel keyboard has exactly one button.
    expect(passedOptions.reply_markup.inline_keyboard).toHaveLength(1);
    expect(passedOptions.reply_markup.inline_keyboard[0]).toHaveLength(1);
    const button = passedOptions.reply_markup.inline_keyboard[0]![0] as {
      callback_data?: string;
    };
    expect(button.callback_data).toBe('conversation:cancel');
  });
});
