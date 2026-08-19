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
import { buildConfirmationKeyboard, buildScreen, type ScreenDefinition } from './designSystem.js';

export * from './designSystem.js';
export {
  normalizeInputDigits,
  formatRtlLabeledValue,
  ensurePersianLineDirection,
} from './locale.js';

export type BackDestination = 'home' | 'main' | 'admin' | 'admin:sales' | 'wallet' | 'shop';

type EditMessageTextOptions = NonNullable<Parameters<MenuContext['editMessageText']>[1]>;

export type RenderUiScreenOptions = EditMessageTextOptions & {
  /** Set to false when a route intentionally opens a separate popover screen. */
  preferEdit?: boolean;
};

export type RenderUiScreenResult = 'edited' | 'unchanged' | 'replied';

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
  if (role === 'artifact' || role === 'notification') {
    const ids = session.artifactMessageIds ?? [];
    session.artifactMessageIds = [...new Set([...ids, messageId])].slice(-50);
    session.uiMessageIds = (session.uiMessageIds ?? []).filter((id) => id !== messageId);
    session.promptMessageIds = (session.promptMessageIds ?? []).filter((id) => id !== messageId);
  } else if (role === 'prompt') {
    // A durable message is never implicitly demoted by a later transformer.
    if ((session.artifactMessageIds ?? []).includes(messageId)) return;
    const ids = session.promptMessageIds ?? [];
    session.promptMessageIds = [...new Set([...ids, messageId])].slice(-20);
    session.uiMessageIds = (session.uiMessageIds ?? []).filter((id) => id !== messageId);
  } else {
    // Durable artifacts and notifications must never become replaceable screens.
    if ((session.artifactMessageIds ?? []).includes(messageId)) return;
    const ids = session.uiMessageIds ?? [];
    session.uiMessageIds = [...new Set([...ids, messageId])].slice(-20);
    session.promptMessageIds = (session.promptMessageIds ?? []).filter((id) => id !== messageId);
  }
}

/** Mark a message ID as a durable artifact that must NOT be deleted by UI navigation. */
export function rememberArtifactMessage(session: SessionData, messageId: number): void {
  rememberUiMessage(session, messageId, 'artifact');
}

/** Remove a message from every tracked UI role after it is explicitly deleted. */
export function forgetUiMessage(session: SessionData, messageId: number): void {
  session.uiMessageIds = (session.uiMessageIds ?? []).filter((id) => id !== messageId);
  session.promptMessageIds = (session.promptMessageIds ?? []).filter((id) => id !== messageId);
  session.artifactMessageIds = (session.artifactMessageIds ?? []).filter((id) => id !== messageId);
}

/** Durable artifacts must never be edited into another screen. */
export function isArtifactMessage(
  session: SessionData | undefined,
  messageId: number | undefined
): boolean {
  return messageId !== undefined && (session?.artifactMessageIds ?? []).includes(messageId);
}

/**
 * Treat a private bot chat like a small app: remove the previous screen and
 * temporary prompts while keeping durable artifact messages intact.
 */
export function cleanChatUiMiddleware(): Middleware<MenuContext> {
  return async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();

    // A dismissible popover (for example a QR image) sits on top of the current
    // screen. Closing it must only run the explicit dismiss handler; the normal
    // pre-route sweep would otherwise delete the screen underneath as well.
    if (ctx.callbackQuery?.data === 'ui:dismiss') {
      await uiTracking.run({ chatId: ctx.chat.id, session: ctx.session }, async () => await next());
      return;
    }

    const callbackMessageId = ctx.callbackQuery?.message?.message_id;
    const previousUiIds = [...new Set(ctx.session.uiMessageIds ?? [])];
    const promptIds = [...new Set(ctx.session.promptMessageIds ?? [])];
    const artifactIdsBefore = new Set(ctx.session.artifactMessageIds ?? []);

    // Filter out artifact messages from cleanup candidates. Artifacts may also
    // exist in a legacy screen/prompt list from an older deployment.
    const cleanupCandidates = [...new Set([...previousUiIds, ...promptIds])].filter(
      (messageId) => !artifactIdsBefore.has(messageId)
    );

    const preservedIds =
      callbackMessageId && previousUiIds.includes(callbackMessageId) ? [callbackMessageId] : [];
    const failedScreenDeletes: number[] = [];
    const failedPromptDeletes: number[] = [];

    // Optimistically update session lists immediately so next() works with clean state,
    // and run network deletions in background concurrent with route execution.
    ctx.session.uiMessageIds = [...preservedIds];
    ctx.session.promptMessageIds = [];

    const cleanupPromise = Promise.all(
      cleanupCandidates
        .filter(
          (messageId) =>
            messageId !== callbackMessageId || !preservedIds.includes(callbackMessageId)
        )
        .map(async (messageId) => {
          const removed = await safelyDeleteMessage(ctx, messageId);
          if (removed) return;
          if (previousUiIds.includes(messageId)) failedScreenDeletes.push(messageId);
          if (promptIds.includes(messageId)) failedPromptDeletes.push(messageId);
        })
    );

    // User-authored messages are intentionally NOT deleted here. Only input that
    // is actually consumed by a conversation or a sensitive one-shot handler is
    // removed by that handler. Ordinary text therefore never appears to vanish.
    const initialIds = new Set([
      ...(ctx.session.uiMessageIds ?? []),
      ...(ctx.session.promptMessageIds ?? []),
    ]);
    await uiTracking.run({ chatId: ctx.chat.id, session: ctx.session }, async () => await next());
    await Promise.allSettled([cleanupPromise]);

    if (failedScreenDeletes.length > 0 || failedPromptDeletes.length > 0) {
      ctx.session.uiMessageIds = [
        ...new Set([...(ctx.session.uiMessageIds ?? []), ...failedScreenDeletes]),
      ].slice(-20);
      ctx.session.promptMessageIds = [
        ...new Set([...(ctx.session.promptMessageIds ?? []), ...failedPromptDeletes]),
      ].slice(-20);
    }

    const sentNewScreen = [
      ...(ctx.session.uiMessageIds ?? []),
      ...(ctx.session.promptMessageIds ?? []),
    ].some((messageId) => messageId !== callbackMessageId && !initialIds.has(messageId));
    // Re-read artifacts after the handler: a purchase/revoke handler may have
    // promoted the callback message to an artifact during this update.
    const artifactIdsAfter = new Set(ctx.session.artifactMessageIds ?? []);
    if (callbackMessageId && sentNewScreen && !artifactIdsAfter.has(callbackMessageId)) {
      if (await safelyDeleteMessage(ctx, callbackMessageId)) {
        forgetUiMessage(ctx.session, callbackMessageId);
      }
    }
  };
}

/**
 * Render the current app screen. Callback-driven screens are edited in place;
 * durable artifacts and messages Telegram can no longer edit are replaced by
 * a fresh tracked screen instead.
 */
export async function renderUiScreen(
  ctx: MenuContext,
  text: string,
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult> {
  const { preferEdit = true, ...apiOptions } = options;
  const callbackMessageId = ctx.callbackQuery?.message?.message_id;

  if (
    preferEdit &&
    callbackMessageId !== undefined &&
    !isArtifactMessage(ctx.session, callbackMessageId)
  ) {
    try {
      await ctx.editMessageText(text, apiOptions);
      if (ctx.session) rememberUiMessage(ctx.session, callbackMessageId, 'screen');
      return 'edited';
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        if (ctx.session) rememberUiMessage(ctx.session, callbackMessageId, 'screen');
        return 'unchanged';
      }
      if (!isMessageEditUnavailableError(error)) throw error;
      if (ctx.session) forgetUiMessage(ctx.session, callbackMessageId);
    }
  }

  const message = await ctx.reply(
    text,
    apiOptions as NonNullable<Parameters<MenuContext['reply']>[1]>
  );
  if (ctx.session) rememberUiMessage(ctx.session, message.message_id, 'screen');
  return 'replied';
}

export type UiScreenContent = string | ScreenDefinition;

function resolveScreenContent(content: UiScreenContent): string {
  return typeof content === 'string' ? content : buildScreen(content);
}

/** Canonical renderer for app screens. Prefer this over direct edit/reply calls in routes. */
export function renderScreen(
  ctx: MenuContext,
  content: UiScreenContent,
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult> {
  return renderUiScreen(ctx, resolveScreenContent(content), options);
}

/** Semantic renderer for read-only detail views. */
export function renderDetailScreen(
  ctx: MenuContext,
  content: UiScreenContent,
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult> {
  return renderScreen(ctx, content, options);
}

/** Semantic renderer for menu-driven form entry points with a consistent cancel action. */
export function renderFormScreen(
  ctx: MenuContext,
  content: UiScreenContent,
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult> {
  return renderScreen(ctx, content, {
    ...options,
    reply_markup: options.reply_markup ?? cancelKeyboard(ctx),
  });
}

/** Render a confirmation screen and standardize confirm/cancel hierarchy. */
export function renderConfirmScreen(
  ctx: MenuContext,
  content: UiScreenContent,
  confirmCallback: string,
  options: RenderUiScreenOptions & {
    confirmLabelKey?: string;
    cancelCallback?: string;
    cancelLabelKey?: string;
  } = {}
): Promise<RenderUiScreenResult> {
  const { confirmLabelKey, cancelCallback, cancelLabelKey, ...renderOptions } = options;
  return renderScreen(ctx, content, {
    ...renderOptions,
    reply_markup:
      renderOptions.reply_markup ??
      buildConfirmationKeyboard(
        ctx,
        confirmCallback,
        confirmLabelKey,
        cancelCallback,
        cancelLabelKey
      ),
  });
}

/** Render a terminal success/error state with one predictable navigation action. */
export function renderResultScreen(
  ctx: MenuContext,
  content: UiScreenContent,
  destination: BackDestination = 'main',
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult> {
  return renderScreen(ctx, content, {
    ...options,
    reply_markup: options.reply_markup ?? backKeyboard(ctx, destination),
  });
}

export function isMessageNotModifiedError(error: unknown): boolean {
  return errorMessage(error).includes('message is not modified');
}

export function isMessageEditUnavailableError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes('message to edit not found') ||
    message.includes("message can't be edited") ||
    message.includes('there is no text in the message to edit') ||
    message.includes('message_id_invalid')
  );
}

function backLabelKey(destination: BackDestination): string {
  switch (destination) {
    case 'admin':
      return 'admin_menu_back_to_admin';
    case 'admin:sales':
      return 'admin_menu_back_to_sales';
    case 'wallet':
      return 'menu_back_wallet';
    case 'shop':
      return 'menu_back_shop';
    case 'home':
    case 'main':
    default:
      return 'menu_back_main';
  }
}

export function backKeyboard(
  ctx: ConversationContext,
  destination: BackDestination = 'home'
): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, backLabelKey(destination)), `nav:${destination}`);
}

/** Back button for a concrete nested screen that is not a global nav destination. */
export function backToKeyboard(
  ctx: ConversationContext,
  callbackData: string,
  labelKey = 'menu_back'
): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, labelKey), callbackData);
}

export function dismissKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'menu_close'), 'ui:dismiss');
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

/** Admin conversation response whose default Back action stays inside the admin UI. */
export async function replyInAdminConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string,
  options: ReplyOptions = {}
) {
  return replyInConversationWithRole(conversation, ctx, text, 'prompt', {
    ...options,
    reply_markup: options.reply_markup ?? backKeyboard(ctx, 'admin'),
  });
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

export async function waitForTextInput(
  conversation: MyConversation,
  cancelDestination: BackDestination = 'home'
): Promise<string | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input, cancelDestination)) return undefined;
    await forwardConversationNavigation(conversation, input);
    if (input.message && 'text' in input.message) {
      await deleteConsumedInputMessage(input);
      return input.message.text;
    }
    await deleteConsumedInputMessage(input);
    await promptInConversation(conversation, input, t(input, 'text_input_required'));
  }
}

/** Admin variant whose cancellation result returns to the admin dashboard. */
export function waitForAdminTextInput(conversation: MyConversation): Promise<string | undefined> {
  return waitForTextInput(conversation, 'admin');
}

export interface ReceiptMediaInput {
  fileId: string;
  type: 'photo' | 'document';
  mimeType?: string;
}

export async function waitForReceiptMediaInput(
  conversation: MyConversation,
  cancelDestination: BackDestination = 'home'
): Promise<ReceiptMediaInput | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input, cancelDestination)) return undefined;
    await forwardConversationNavigation(conversation, input);
    const photos = input.message && 'photo' in input.message ? input.message.photo : undefined;
    if (photos && photos.length > 0) {
      await deleteConsumedInputMessage(input);
      return { fileId: photos[photos.length - 1]!.file_id, type: 'photo' };
    }
    const document =
      input.message && 'document' in input.message ? input.message.document : undefined;
    if (document) {
      await deleteConsumedInputMessage(input);
      return { fileId: document.file_id, type: 'document', mimeType: document.mime_type };
    }
    await deleteConsumedInputMessage(input);
    await promptInConversation(conversation, input, t(input, 'photo_input_required'));
  }
}

export async function waitForPhotoInput(
  conversation: MyConversation,
  cancelDestination: BackDestination = 'home'
): Promise<string | undefined> {
  const res = await waitForReceiptMediaInput(conversation, cancelDestination);
  return res?.fileId;
}

/**
 * Wait for an inline-button selection whose callback data starts with one of
 * the accepted prefixes.
 */
export async function waitForCallbackInput(
  conversation: MyConversation,
  validPrefixes: readonly string[],
  cancelDestination: BackDestination = 'home'
): Promise<string | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input, cancelDestination)) return undefined;
    await forwardConversationNavigation(conversation, input);
    const data = input.callbackQuery?.data;
    if (data && validPrefixes.some((prefix) => data.startsWith(prefix))) {
      await input.answerCallbackQuery();
      return data;
    }
    if (input.callbackQuery) {
      await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
      continue;
    }
    await deleteConsumedInputMessage(input);
    await promptInConversation(conversation, input, t(input, 'button_input_required'));
  }
}

/** Admin variant whose cancellation result returns to the admin dashboard. */
export function waitForAdminCallbackInput(
  conversation: MyConversation,
  validPrefixes: readonly string[]
): Promise<string | undefined> {
  return waitForCallbackInput(conversation, validPrefixes, 'admin');
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
  ctx: ConversationContext,
  destination: BackDestination = 'home'
): Promise<boolean> {
  const isCancelCallback = ctx.callbackQuery?.data === 'conversation:cancel';
  const isCancelCommand = ctx.message?.text?.trim() === '/cancel';
  if (!isCancelCallback && !isCancelCommand) return false;

  if (isCancelCallback) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
  } else {
    await deleteConsumedInputMessage(ctx);
  }
  await replyInConversationWithRole(conversation, ctx, t(ctx, 'operation_cancelled'), 'prompt', {
    reply_markup: backKeyboard(ctx, destination),
  });
  return true;
}

/** Admin variant of explicit conversation cancellation. */
export function handleAdminConversationCancel(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<boolean> {
  return handleConversationCancel(conversation, ctx, 'admin');
}

/**
 * Navigation buttons and bot commands remain global escape hatches while a
 * conversation is waiting. Halting with `next` lets the normal route own the
 * acknowledgement and destination rendering instead of trapping the user.
 */
export async function forwardConversationNavigation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const messageText = ctx.message?.text?.trim();
  const isNavigationCallback = /^nav:(?:home|main|admin|admin:sales|wallet|shop)$/u.test(
    callbackData ?? ''
  );
  const isBotCommand = /^\/[a-z][a-z0-9_]*(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(messageText ?? '');
  if (isNavigationCallback || (isBotCommand && messageText !== '/cancel')) {
    await conversation.halt({ next: true });
  }
}

/** Delete a user message only after a flow has explicitly consumed it as input. */
export async function deleteConsumedInputMessage(
  ctx: Pick<ConversationContext, 'api' | 'chat' | 'message'>
): Promise<boolean> {
  const messageId = ctx.message?.message_id;
  if (!messageId) return false;
  return safelyDeleteMessage(ctx, messageId);
}

export async function safelyDeleteMessage(
  ctx: Pick<ConversationContext, 'api' | 'chat'>,
  messageId: number
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;
  try {
    await ctx.api.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    // These failures are permanent and should not keep stale IDs in session.
    return (
      message.includes('message to delete not found') ||
      message.includes("message can't be deleted") ||
      message.includes('message_id_invalid')
    );
  }
}

function isMessageResult(value: unknown): value is { message_id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message_id' in value &&
    typeof value.message_id === 'number'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}
