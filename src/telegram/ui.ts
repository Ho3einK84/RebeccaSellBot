import { AsyncLocalStorage } from 'node:async_hooks';
import { InlineKeyboard, type Middleware, type Transformer } from 'grammy';
import type {
  ConversationContext,
  MenuContext,
  MyConversation,
  SessionData,
  UiMessageRole,
} from './types.js';
import { t } from './locale.js';

export * from './designSystem.js';
export {
  normalizeInputDigits,
  formatRtlLabeledValue,
  ensurePersianLineDirection,
} from './locale.js';

export type BackDestination = 'home' | 'main' | 'admin';

const TRACKED_SEND_METHODS = new Set([
  'sendMessage',
  'sendPhoto',
  'sendDocument',
  'sendVideo',
  'sendAnimation',
  'sendAudio',
  'sendVoice',
]);

type UiTrackingStore = {
  chatId: number | string;
  session: SessionData;
};

const uiTracking = new AsyncLocalStorage<UiTrackingStore>();

/** Install exactly once on the bot API. The active update is isolated by ALS. */
export function uiMessageTrackingTransformer(): Transformer {
  return async (prev, method, payload, signal) => {
    const response = await prev(method, payload, signal);
    const store = uiTracking.getStore();
    if (!store || !TRACKED_SEND_METHODS.has(method)) return response;

    const targetChatId = (payload as { chat_id?: number | string }).chat_id;
    if (String(targetChatId) !== String(store.chatId)) return response;

    const result = (response as { result?: unknown }).result;
    if (isMessageResult(result)) rememberUiMessage(store.session, result.message_id, 'screen');
    return response;
  };
}

/** Remember a message ID assigned to a specific UI role. */
export function rememberUiMessage(
  session: SessionData,
  messageId: number,
  role: UiMessageRole = 'screen'
): void {
  if (role === 'artifact') {
    const ids = session.artifactMessageIds ?? [];
    session.artifactMessageIds = [...new Set([...ids, messageId])].slice(-50);
  } else if (role === 'prompt') {
    const ids = session.promptMessageIds ?? [];
    session.promptMessageIds = [...new Set([...ids, messageId])].slice(-20);
  } else {
    const ids = session.uiMessageIds ?? [];
    session.uiMessageIds = [...new Set([...ids, messageId])].slice(-20);
  }
}

/** Mark a message ID as a durable artifact that must NOT be deleted by UI navigation. */
export function rememberArtifactMessage(session: SessionData, messageId: number): void {
  rememberUiMessage(session, messageId, 'artifact');
}

/**
 * Treat a private bot chat like a small app: remove the previous screen and
 * temporary prompts while keeping durable artifact messages intact.
 */
export function cleanChatUiMiddleware(): Middleware<MenuContext> {
  return async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();

    const callbackMessageId = ctx.callbackQuery?.message?.message_id;
    const previousUiIds = [...new Set(ctx.session.uiMessageIds ?? [])];
    const promptIds = [...new Set(ctx.session.promptMessageIds ?? [])];
    const artifactIds = new Set(ctx.session.artifactMessageIds ?? []);

    // Filter out artifact messages from cleanup candidates
    const cleanupCandidates = [...new Set([...previousUiIds, ...promptIds])].filter(
      (messageId) => !artifactIds.has(messageId)
    );

    const preservedIds =
      callbackMessageId && previousUiIds.includes(callbackMessageId) ? [callbackMessageId] : [];
    ctx.session.uiMessageIds = preservedIds;
    ctx.session.promptMessageIds = [];

    await Promise.all(
      cleanupCandidates
        .filter(
          (messageId) =>
            messageId !== callbackMessageId || !preservedIds.includes(callbackMessageId)
        )
        .map((messageId) => safelyDeleteMessage(ctx, messageId))
    );

    if (ctx.message?.message_id) {
      await safelyDeleteMessage(ctx, ctx.message.message_id);
    }

    const initialIds = new Set(ctx.session.uiMessageIds);
    await uiTracking.run({ chatId: ctx.chat.id, session: ctx.session }, async () => await next());

    const sentNewScreen = (ctx.session.uiMessageIds ?? []).some(
      (messageId) => !initialIds.has(messageId)
    );
    if (callbackMessageId && sentNewScreen && !artifactIds.has(callbackMessageId)) {
      await safelyDeleteMessage(ctx, callbackMessageId);
      ctx.session.uiMessageIds = (ctx.session.uiMessageIds ?? []).filter(
        (messageId) => messageId !== callbackMessageId
      );
    }
  };
}

export function backKeyboard(
  ctx: ConversationContext,
  destination: BackDestination = 'home'
): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'menu_back'), `nav:${destination}`);
}

export function dismissKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'menu_back'), 'ui:dismiss');
}

export function cancelKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'menu_cancel'), 'conversation:cancel');
}

type ReplyOptions = Parameters<ConversationContext['reply']>[1];

/** Send a conversation response and include it in message tracking under a given role. */
export async function replyInConversationWithRole(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string,
  role: UiMessageRole = 'prompt',
  options: ReplyOptions = {}
) {
  const message = await ctx.reply(text, {
    ...options,
    reply_markup: options.reply_markup ?? (role === 'artifact' ? undefined : backKeyboard(ctx)),
  });
  await conversation.external((outsideCtx) => {
    rememberUiMessage(outsideCtx.session, message.message_id, role);
  });
  return message;
}

/** Send a conversation response and include it in the next-screen cleanup. */
export async function replyInConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string,
  options: ReplyOptions = {}
) {
  return replyInConversationWithRole(conversation, ctx, text, 'prompt', options);
}

/** Send a durable artifact message in conversation that will NOT be deleted by UI transitions. */
export async function sendArtifactInConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string,
  options: ReplyOptions = {}
) {
  return replyInConversationWithRole(conversation, ctx, text, 'artifact', options);
}

/**
 * Send a prompt that always exposes an explicit cancellation action.
 */
export function promptInConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string,
  options: ReplyOptions = {}
) {
  return replyInConversationWithRole(conversation, ctx, text, 'prompt', {
    ...options,
    reply_markup: options.reply_markup ?? cancelKeyboard(ctx),
  });
}

export async function waitForTextInput(conversation: MyConversation): Promise<string | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input)) return undefined;
    if (input.message && 'text' in input.message) return input.message.text;
    await promptInConversation(conversation, input, t(input, 'text_input_required'));
  }
}

export async function waitForPhotoInput(conversation: MyConversation): Promise<string | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input)) return undefined;
    const photos = input.message && 'photo' in input.message ? input.message.photo : undefined;
    if (photos && photos.length > 0) {
      return photos[photos.length - 1]!.file_id;
    }
    await promptInConversation(conversation, input, t(input, 'photo_input_required'));
  }
}

/**
 * Wait for an inline-button selection whose callback data starts with one of
 * the accepted prefixes.
 */
export async function waitForCallbackInput(
  conversation: MyConversation,
  validPrefixes: readonly string[]
): Promise<string | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input)) return undefined;
    const data = input.callbackQuery?.data;
    if (data && validPrefixes.some((prefix) => data.startsWith(prefix))) {
      await input.answerCallbackQuery();
      return data;
    }
    await promptInConversation(conversation, input, t(input, 'text_input_required'));
  }
}

export async function conversationOwnerId(
  conversation: MyConversation
): Promise<number | undefined> {
  return conversation.external((outsideCtx) => outsideCtx.from?.id);
}

export async function acceptConversationOwner(
  ctx: ConversationContext,
  ownerId: number | undefined
): Promise<boolean> {
  if (ownerId === undefined) return true;
  if (ownerId !== undefined && ctx.from?.id === ownerId) return true;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'access_denied'), show_alert: true });
  }
  return false;
}

export async function handleConversationCancel(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<boolean> {
  const isCancelCallback = ctx.callbackQuery?.data === 'conversation:cancel';
  const isCancelCommand = ctx.message?.text?.trim() === '/cancel';
  if (!isCancelCallback && !isCancelCommand) return false;

  if (isCancelCallback) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
  }
  await replyInConversation(conversation, ctx, t(ctx, 'operation_cancelled'));
  return true;
}

export async function safelyDeleteMessage(
  ctx: Pick<MenuContext, 'api' | 'chat'>,
  messageId: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  await ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
}

function isMessageResult(value: unknown): value is { message_id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message_id' in value &&
    typeof value.message_id === 'number'
  );
}
