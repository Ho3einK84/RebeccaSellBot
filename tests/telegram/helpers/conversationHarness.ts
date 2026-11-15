import { conversations, createConversation } from '@grammyjs/conversations';
import type { ConversationBuilder } from '@grammyjs/conversations';
import { conversationContextMiddleware } from '../../../src/telegram/bot.js';
import type { ConversationContext, MenuContext } from '../../../src/telegram/types.js';
import { createBotHarness, type BotHarnessOptions } from './botHarness.js';

export interface ConversationHarnessOptions extends BotHarnessOptions {
  conversations: Array<
    [id: string, builder: ConversationBuilder<MenuContext, ConversationContext>]
  >;
}

export function createConversationHarness(options: ConversationHarnessOptions) {
  const harness = createBotHarness(options);

  harness.bot.use(
    conversations<MenuContext, ConversationContext>({
      plugins: [conversationContextMiddleware(harness.services)],
    })
  );

  for (const [id, builder] of options.conversations) {
    harness.bot.use(createConversation(builder, id));
  }

  return harness;
}
