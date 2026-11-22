import type { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t } from '../../../locale.js';
import {
  acceptConversationOwner,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  handleAdminConversationCancel,
  isMessageNotModifiedError,
  promptInConversation,
} from '../../../ui.js';

export async function renderSettingsScreen(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const messageId = activeCtx.callbackQuery?.message?.message_id;
  const chatId = activeCtx.chat?.id;
  if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
    const rendered = await conversation.external(async (outsideCtx) => {
      const api = outsideCtx?.api ?? activeCtx.api;
      if (!api) return false;
      try {
        await api.editMessageText(chatId, messageId, text, {
          parse_mode: 'Markdown',
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
        return true;
      } catch (error) {
        return isMessageNotModifiedError(error);
      }
    });
    if (rendered) return;
  }

  await promptInConversation(conversation, activeCtx, text, {
    parse_mode: 'Markdown',
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export type SettingsInput =
  | { type: 'text'; value: string; ctx: ConversationContext }
  | { type: 'callback'; data: string; ctx: ConversationContext }
  | { type: 'back'; ctx?: ConversationContext }
  | { type: 'cancel' };

type SettingsInputOptions = {
  allowText?: boolean;
  callbackPrefixes?: readonly string[];
  backCallbacks?: readonly string[];
  retryKeyboard?: InlineKeyboard;
};

/**
 * Wait for one settings input while preserving global navigation and explicit
 * cancellation. This avoids consuming a Back/Home/Admin button inside a
 * conversation without ever rendering its destination.
 */
export async function waitForSettingsInput(
  conversation: MyConversation,
  options: SettingsInputOptions = {}
): Promise<SettingsInput> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleAdminConversationCancel(conversation, input)) return { type: 'cancel' };
    await forwardConversationNavigation(conversation, input);

    const data = input.callbackQuery?.data;
    if (data) {
      if (data === 'ui:noop') {
        await input.answerCallbackQuery();
        continue;
      }
      if (options.backCallbacks?.includes(data)) {
        await input.answerCallbackQuery();
        return { type: 'back', ctx: input };
      }
      if (options.callbackPrefixes?.some((prefix) => data.startsWith(prefix))) {
        await input.answerCallbackQuery();
        return { type: 'callback', data, ctx: input };
      }
      await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
      continue;
    }

    if (
      options.allowText &&
      input.message &&
      'text' in input.message &&
      typeof input.message.text === 'string'
    ) {
      await deleteConsumedInputMessage(input);
      return { type: 'text', value: input.message.text, ctx: input };
    }

    await deleteConsumedInputMessage(input);
    await promptInConversation(
      conversation,
      input,
      t(input, options.allowText ? 'text_input_required' : 'button_input_required'),
      options.retryKeyboard ? { reply_markup: options.retryKeyboard } : {}
    );
  }
}
