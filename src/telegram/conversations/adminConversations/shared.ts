import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { normalizeInputDigits, t } from '../../locale.js';
import {
  buildEmptyState,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
} from '../../ui.js';
import type { LocalUserProfile } from '../../../domain/services/UserService.js';

export function parsePositiveSafeInteger(value: string): number | undefined {
  const trimmed = normalizeInputDigits(value);
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseNonnegativeSafeInteger(value: string): number | undefined {
  const trimmed = normalizeInputDigits(value);
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function requireAdmin(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  const telegramId = ctx.from?.id;
  if (telegramId && ctx.services?.isAdmin(telegramId)) return telegramId;
  if (ctx.services) {
    await replyInAdminConversation(conversation, ctx, t(ctx, 'admin_access_denied'));
  }
  return undefined;
}

export type AdminTargetResolutionOptions = {
  titleKey: string;
  subtitleKey: string;
  initialTelegramId?: number;
};

/**
 * Unified interactive user target resolver for daily admin tasks (search, balance, direct message).
 * Supports:
 * - Immediate resolution if initialTelegramId is passed.
 * - Multi-criteria search (Telegram ID, @username, UUID, Name, Sub URL, Config Username, Receipt ID, Transaction ID).
 * - Interactive multi-candidate picker menu if multiple users match.
 * - Clear retry and cancellation flows.
 */
export async function promptAndResolveAdminTargetUser(
  conversation: MyConversation,
  ctx: ConversationContext,
  options: AdminTargetResolutionOptions
): Promise<LocalUserProfile | undefined> {
  if (!ctx.services) return undefined;

  if (options.initialTelegramId) {
    const existing = await conversation.external(async (outsideCtx) => {
      if (!outsideCtx.services) return null;
      return outsideCtx.services.userService.findProfile(String(options.initialTelegramId));
    });
    if (existing) return existing;
  }

  let resolvedUser: LocalUserProfile | undefined;

  while (!resolvedUser) {
    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '🔎',
        title: t(ctx, options.titleKey),
        subtitle: t(ctx, options.subtitleKey),
        footer: t(ctx, 'admin_search_prompt'),
      }),
      { parse_mode: 'Markdown' }
    );

    const userInput = await waitForAdminTextInput(conversation);
    if (userInput === undefined) return undefined;

    const candidates = await conversation.external(async (outsideCtx) => {
      if (!outsideCtx.services) return [];
      return outsideCtx.services.userService.searchProfiles(userInput, 6);
    });

    if (candidates.length === 0) {
      const notFoundKeyboard = new InlineKeyboard()
        .text(t(ctx, 'admin_search_again'), 'target:search:again')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('📭', t(ctx, options.titleKey), t(ctx, 'admin_user_not_found')),
        { parse_mode: 'Markdown', reply_markup: notFoundKeyboard }
      );

      const decision = await waitForAdminCallbackInput(conversation, ['target:search:again']);
      if (!decision) return undefined;
      continue;
    }

    if (candidates.length === 1) {
      resolvedUser = candidates[0];
      break;
    }

    // Multiple candidates found (2 to 6)
    const pickerKeyboard = new InlineKeyboard();
    for (const candidate of candidates) {
      const displayName =
        `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim() ||
        (candidate.username ? `@${candidate.username}` : String(candidate.telegramId));
      const badge = candidate.isBanned ? '🚫 ' : candidate.activeSubscriptionCount > 0 ? '🟢 ' : '';
      const buttonLabel = `${badge}${displayName} (ID: ${candidate.telegramId})`;
      pickerKeyboard.text(buttonLabel, `target:select:${candidate.telegramId}`).row();
    }
    pickerKeyboard
      .text(t(ctx, 'admin_search_again'), 'target:search:again')
      .row()
      .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '👥',
        title: t(ctx, 'admin_search_multiple_title'),
        subtitle: t(ctx, 'admin_search_multiple_subtitle'),
        footer: `ℹ️ ${t(ctx, 'admin_search_prompt')}`,
      }),
      { parse_mode: 'Markdown', reply_markup: pickerKeyboard }
    );

    const selection = await waitForAdminCallbackInput(conversation, [
      'target:select:',
      'target:search:again',
    ]);
    if (!selection) return undefined;

    if (selection.startsWith('target:select:')) {
      const selectedId = Number(selection.slice('target:select:'.length));
      resolvedUser = candidates.find((c) => c.telegramId === selectedId);
      if (resolvedUser) break;
    }
    // If 'target:search:again' selected, loop restarts
  }

  return resolvedUser;
}
