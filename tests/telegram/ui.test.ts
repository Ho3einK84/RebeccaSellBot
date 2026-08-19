import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MenuContext, MyConversation } from '../../src/telegram/types.js';
import {
  backKeyboard,
  cleanChatUiMiddleware,
  dismissKeyboard,
  forgetUiMessage,
  forwardConversationNavigation,
  promptInConversation,
  rememberArtifactMessage,
  rememberUiMessage,
  renderUiScreen,
  safelyDeleteMessage,
  waitForCallbackInput,
  waitForPhotoInput,
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

  it('does not delete ordinary user text globally', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 123, type: 'private' },
      message: { message_id: 99, text: 'hello' },
      session: { uiMessageIds: [10] },
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => undefined);

    expect(deleteMessage).toHaveBeenCalledWith(123, 10);
    expect(deleteMessage).not.toHaveBeenCalledWith(123, 99);
  });

  it('dismisses only a QR popover and keeps the screen underneath', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { data: 'ui:dismiss', message: { message_id: 100 } },
      session: { uiMessageIds: [50], artifactMessageIds: [100] },
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => {
      if (await safelyDeleteMessage(ctx, 100)) forgetUiMessage(ctx.session, 100);
    });

    expect(deleteMessage).toHaveBeenCalledOnce();
    expect(deleteMessage).toHaveBeenCalledWith(123, 100);
    expect(ctx.session.uiMessageIds).toEqual([50]);
    expect(ctx.session.artifactMessageIds).toEqual([]);
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

  it('deletes text only after a conversation consumes it', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const input = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      chat: { id: 123, type: 'private' },
      message: { message_id: 77, text: '250000' },
      api: { deleteMessage },
    } as unknown as ConversationContext;
    const outsideCtx = { from: { id: 123 }, session: {} };
    const conversation = {
      wait: vi.fn().mockResolvedValue(input),
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    await expect(waitForTextInput(conversation)).resolves.toBe('250000');
    expect(deleteMessage).toHaveBeenCalledWith(123, 77);
  });

  it('accepts an image document when a receipt is sent as a file', async () => {
    const input = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      message: { document: { file_id: 'image-file', mime_type: 'image/png' } },
    } as unknown as ConversationContext;
    const outsideCtx = { from: { id: 123 }, session: {} };
    const conversation = {
      wait: vi.fn().mockResolvedValue(input),
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    await expect(waitForPhotoInput(conversation)).resolves.toBe('image-file');
  });

  it('answers an unrelated callback instead of leaving Telegram spinner active', async () => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const validInput = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      callbackQuery: { data: 'valid:choice' },
      answerCallbackQuery,
    } as unknown as ConversationContext;
    const invalidInput = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      callbackQuery: { data: 'other:choice' },
      answerCallbackQuery,
      services: {
        translationService: { get: vi.fn((key: string) => key) },
      },
    } as unknown as ConversationContext;
    const outsideCtx = { from: { id: 123 }, session: {} };
    const conversation = {
      wait: vi.fn().mockResolvedValueOnce(invalidInput).mockResolvedValueOnce(validInput),
      external: vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    await expect(waitForCallbackInput(conversation, ['valid:'])).resolves.toBe('valid:choice');
    expect(answerCallbackQuery).toHaveBeenCalledTimes(2);
    expect(answerCallbackQuery).toHaveBeenNthCalledWith(1, { text: 'button_action_failed' });
  });

  it('keeps transiently undeletable screen IDs so cleanup can retry later', async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const ctx = {
      chat: { id: 123, type: 'private' },
      session: { uiMessageIds: [10] },
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => undefined);

    expect(ctx.session.uiMessageIds).toEqual([10]);
  });

  it('adopts an untracked callback screen without deleting it after an in-place edit', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 15 } },
      session: {},
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => rememberUiMessage(ctx.session, 15, 'screen'));

    expect(deleteMessage).not.toHaveBeenCalledWith(123, 15);
    expect(ctx.session.uiMessageIds).toEqual([15]);
  });
});

describe('shared screen rendering', () => {
  it('edits a callback screen in place and tolerates Telegram no-op edits', async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValue(new Error('Bad Request: message is not modified'));
    const reply = vi.fn();
    const ctx = {
      callbackQuery: { message: { message_id: 15 } },
      session: {},
      editMessageText,
      reply,
    } as unknown as MenuContext;

    await expect(renderUiScreen(ctx, 'same screen')).resolves.toBe('unchanged');
    expect(reply).not.toHaveBeenCalled();
    expect(ctx.session.uiMessageIds).toEqual([15]);
  });

  it('never edits a durable artifact into an unrelated screen', async () => {
    const editMessageText = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 16 });
    const ctx = {
      callbackQuery: { message: { message_id: 15 } },
      session: { artifactMessageIds: [15] },
      editMessageText,
      reply,
    } as unknown as MenuContext;

    await expect(renderUiScreen(ctx, 'new screen')).resolves.toBe('replied');
    expect(editMessageText).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('new screen', {});
    expect(ctx.session.artifactMessageIds).toEqual([15]);
    expect(ctx.session.uiMessageIds).toEqual([16]);
  });

  it('falls back to a fresh screen when Telegram can no longer edit the callback message', async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValue(new Error("Bad Request: message can't be edited"));
    const reply = vi.fn().mockResolvedValue({ message_id: 17 });
    const ctx = {
      callbackQuery: { message: { message_id: 15 } },
      session: { uiMessageIds: [15] },
      editMessageText,
      reply,
    } as unknown as MenuContext;

    await expect(renderUiScreen(ctx, 'replacement')).resolves.toBe('replied');
    expect(ctx.session.uiMessageIds).toEqual([17]);
  });

  it('keeps message roles exclusive and never demotes artifacts', () => {
    const session = {};
    rememberUiMessage(session, 1, 'screen');
    rememberUiMessage(session, 1, 'prompt');
    expect(session).toEqual({ uiMessageIds: [], promptMessageIds: [1] });

    rememberArtifactMessage(session, 1);
    rememberUiMessage(session, 1, 'screen');
    expect(session).toEqual({ uiMessageIds: [], promptMessageIds: [], artifactMessageIds: [1] });
  });
});

describe('conversation escape navigation', () => {
  it('uses destination-specific labels for global back navigation', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as ConversationContext;

    expect(backKeyboard(ctx, 'shop').inline_keyboard[0]?.[0]?.text).toBe('menu_back_shop');
    expect(backKeyboard(ctx, 'wallet').inline_keyboard[0]?.[0]?.text).toBe('menu_back_wallet');
    expect(backKeyboard(ctx, 'admin').inline_keyboard[0]?.[0]?.text).toBe(
      'admin_menu_back_to_admin'
    );
  });

  it('halts a waiting conversation and forwards navigation to normal routes', async () => {
    const halt = vi.fn().mockResolvedValue(undefined);
    const conversation = { halt } as unknown as MyConversation;
    const ctx = { callbackQuery: { data: 'nav:admin' } } as unknown as ConversationContext;

    await forwardConversationNavigation(conversation, ctx);

    expect(halt).toHaveBeenCalledWith({ next: true });
  });

  it('does not forward ordinary conversation choices', async () => {
    const halt = vi.fn();
    const conversation = { halt } as unknown as MyConversation;
    const ctx = { callbackQuery: { data: 'set-group:pricing' } } as unknown as ConversationContext;

    await forwardConversationNavigation(conversation, ctx);

    expect(halt).not.toHaveBeenCalled();
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

  it('builds a dismiss keyboard with ui:dismiss callback target', () => {
    const fakeCtx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as ConversationContext;

    const keyboard = dismissKeyboard(fakeCtx);
    expect(keyboard).toBeInstanceOf(InlineKeyboard);
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.text).toBe('menu_close');
    expect((buttons[0] as { callback_data?: string })?.callback_data).toBe('ui:dismiss');
  });
});
