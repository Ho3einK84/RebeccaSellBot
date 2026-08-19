import type { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t } from '../../../locale.js';
import {
  acceptConversationOwner,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  handleAdminConversationCancel,
  promptInConversation,
} from '../../../ui.js';

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
