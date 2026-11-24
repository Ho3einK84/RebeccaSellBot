import { InlineKeyboard, type Bot, type MiddlewareFn } from 'grammy';
import type {
  ForcedJoinAction,
  ForcedJoinPublicChannel,
} from '../../domain/services/ForcedJoinService.js';
import { t } from '../locale.js';
import { escapeTelegramMarkdown } from '../rendering.js';
import type { BotServices, ConversationContext, MenuContext, SessionData } from '../types.js';
import { buildUserScreen, renderScreen } from '../ui.js';

export const FORCED_JOIN_CHECK_CALLBACK = 'fj:check';

/** Extract optional payload from a `/start` command message (`/start ref_abc` or `/start@bot ref_abc`). */
export function extractStartPayload(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/u.exec(text.trim());
  if (!match) return undefined;
  const payload = match[1]?.trim();
  return payload && payload.length > 0 ? payload : undefined;
}

export function isStartCommandText(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/u.test(text.trim());
}

/** Build the user-facing Mandatory Channel Join lock screen and inline keyboard. */
export function buildForcedJoinGateScreen(
  ctx: ConversationContext,
  missingChannels: readonly ForcedJoinPublicChannel[]
): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  for (const ch of missingChannels) {
    keyboard.url(`📢 ${ch.title}`, ch.inviteLink).row();
  }
  keyboard.text(t(ctx, 'forced_join_verify_button'), FORCED_JOIN_CHECK_CALLBACK);

  const text = buildUserScreen({
    emoji: '📢',
    title: t(ctx, 'forced_join_title'),
    subtitle: t(ctx, 'forced_join_subtitle'),
    sections: [
      {
        title: t(ctx, 'forced_join_channels_section'),
        fields: missingChannels.map((ch) => ({
          emoji: '🔹',
          value: escapeTelegramMarkdown(ch.title),
        })),
      },
    ],
    footer: t(ctx, 'forced_join_footer'),
  });

  return { text, keyboard };
}

/**
 * Global middleware mounted in `botRuntime.ts` for `forced_join_scope === 'all'`.
 * Preserves `/start ref_...` referral payloads in Postgres-backed session before
 * diverting unjoined users to the channel lock screen.
 */
export function forcedJoinGlobalMiddleware(services: BotServices): MiddlewareFn<MenuContext> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || ctx.chat?.type !== 'private') return next();
    if (services.isAdmin(telegramId)) return next();

    const forcedJoinService = services.forcedJoinService;
    if (!forcedJoinService) return next();

    const cbData = ctx.callbackQuery?.data;
    if (cbData === FORCED_JOIN_CHECK_CALLBACK || cbData === 'ui:dismiss' || cbData === 'ui:noop') {
      return next();
    }

    if (forcedJoinService.getScope() !== 'all') {
      return next();
    }

    const check = await forcedJoinService.checkMembership(telegramId, 'any');
    if (check.allowed) {
      return next();
    }

    // Preserve `/start <payload>` (especially `ref_...` referral links) across the lock screen
    const rawText = ctx.message?.text;
    if (isStartCommandText(rawText)) {
      const startPayload = extractStartPayload(rawText);
      ctx.session.pendingStartPayload = startPayload ?? '';
      if (startPayload?.startsWith('ref_')) {
        ctx.session.pendingReferralCode = startPayload;
      }
      ctx.session.pendingForcedJoinAction = {
        kind: 'start',
        ...(startPayload ? { payload: startPayload } : {}),
      };
    } else if (!ctx.session.pendingForcedJoinAction) {
      ctx.session.pendingForcedJoinAction = { kind: 'home' };
    }

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'forced_join_required_toast') }).catch(() => {});
    }

    const { text, keyboard } = buildForcedJoinGateScreen(ctx, check.missingChannels);
    await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  };
}

/**
 * Scoped guard for `trial_only` and `purchase_and_trial` flows.
 * Returns `true` when the user is blocked (lock screen rendered), `false` when allowed.
 */
export async function enforceForcedJoin(
  ctx: MenuContext,
  action: Extract<ForcedJoinAction, 'trial' | 'purchase'>,
  pendingAction: NonNullable<SessionData['pendingForcedJoinAction']>
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  const forcedJoinService = ctx.services?.forcedJoinService;
  if (!telegramId || !forcedJoinService) return false;
  if (ctx.services?.isAdmin(telegramId)) return false;

  const check = await forcedJoinService.checkMembership(telegramId, action);
  if (check.allowed) return false;

  ctx.session.pendingForcedJoinAction = pendingAction;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'forced_join_required_toast') }).catch(() => {});
  }

  const { text, keyboard } = buildForcedJoinGateScreen(ctx, check.missingChannels);
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  return true;
}

export interface ForcedJoinResumeHandlers {
  resumeStart: (ctx: MenuContext, payload: string) => Promise<void>;
  resumeTrial: (ctx: MenuContext) => Promise<void>;
  resumeShop: (ctx: MenuContext) => Promise<void>;
  resumeCustomAmount: (ctx: MenuContext) => Promise<void>;
  resumeHome: (ctx: MenuContext) => Promise<void>;
}

/** Register the `fj:check` verification button callback route. */
export function registerForcedJoinRoutes(
  bot: Bot<MenuContext>,
  services: BotServices,
  handlers: ForcedJoinResumeHandlers
): void {
  bot.callbackQuery(FORCED_JOIN_CHECK_CALLBACK, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const forcedJoinService = services.forcedJoinService;
    if (!forcedJoinService) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'forced_join_verified_toast') }).catch(() => {});
      await handlers.resumeHome(ctx);
      return;
    }

    const pending = ctx.session.pendingForcedJoinAction;
    const scope = forcedJoinService.getScope();
    const action: ForcedJoinAction =
      scope === 'all'
        ? 'any'
        : pending?.kind === 'trial'
          ? 'trial'
          : pending?.kind === 'shop' || pending?.kind === 'custom_amount'
            ? 'purchase'
            : 'any';

    // Always clear user cache immediately on explicit re-check
    forcedJoinService.invalidateUserCache(telegramId);
    const check = await forcedJoinService.checkMembership(telegramId, action, {
      bypassCache: true,
    });

    if (!check.allowed) {
      await ctx
        .answerCallbackQuery({
          text: t(ctx, 'forced_join_still_not_joined'),
          show_alert: true,
        })
        .catch(() => {});
      const { text, keyboard } = buildForcedJoinGateScreen(ctx, check.missingChannels);
      await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(
        () => {}
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: t(ctx, 'forced_join_verified_toast') }).catch(() => {});
    const nextAction = ctx.session.pendingForcedJoinAction;
    const savedStartPayload = ctx.session.pendingStartPayload;
    const savedReferral = ctx.session.pendingReferralCode;
    delete ctx.session.pendingForcedJoinAction;
    delete ctx.session.pendingStartPayload;

    if (nextAction?.kind === 'start' || savedStartPayload !== undefined || savedReferral) {
      const payload = nextAction?.payload || savedStartPayload || savedReferral || '';
      await handlers.resumeStart(ctx, payload);
      return;
    }
    if (nextAction?.kind === 'trial') {
      await handlers.resumeTrial(ctx);
      return;
    }
    if (nextAction?.kind === 'shop') {
      await handlers.resumeShop(ctx);
      return;
    }
    if (nextAction?.kind === 'custom_amount') {
      await handlers.resumeCustomAmount(ctx);
      return;
    }

    await handlers.resumeHome(ctx);
  });
}
