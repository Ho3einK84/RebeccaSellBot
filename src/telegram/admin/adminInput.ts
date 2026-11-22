import { InlineKeyboard, type Bot } from 'grammy';
import type { AdminScreenNotice } from '../designSystem.js';
import type { AdminInputState, MenuContext, SessionData } from '../types.js';
import { t } from '../locale.js';
import { deleteConsumedInputMessage, renderScreen } from '../ui.js';
import { markAdminContext } from './adminNav.js';

export const ADMIN_INPUT_TTL_MS = 5 * 60 * 1000;

export type AdminInputResult =
  | { status: 'done'; redirectRoute?: string; notice?: AdminScreenNotice }
  | { status: 'retry'; promptText: string; keyboard?: InlineKeyboard }
  | { status: 'handled' };

export type AdminInputHandler = (
  ctx: MenuContext,
  text: string,
  state: AdminInputState
) => Promise<AdminInputResult>;

const inputHandlers = new Map<string, AdminInputHandler>();

/** Register a handler for a specific non-blocking admin text input kind. */
export function registerAdminInputHandler(kind: string, handler: AdminInputHandler): void {
  inputHandlers.set(kind, handler);
}

/** Clear active non-blocking admin text input state. */
export function clearAdminInput(session: SessionData | undefined): void {
  if (session) {
    delete session.adminInput;
  }
}

/** Check whether an admin text input prompt is active and within its 5-minute TTL. */
export function isAdminInputActive(session: SessionData | undefined, now = Date.now()): boolean {
  const input = session?.adminInput;
  if (!input) return false;
  if (now - input.createdAt > ADMIN_INPUT_TTL_MS) {
    delete session.adminInput;
    return false;
  }
  return true;
}

/** Default cancel keyboard for non-blocking admin prompts. */
export function adminInputCancelKeyboard(
  ctx: MenuContext,
  extraButtons?: (kb: InlineKeyboard) => void
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (extraButtons) {
    extraButtons(kb);
  }
  return kb.text(t(ctx, 'menu_cancel'), 'adm:in:cancel');
}

/**
 * Activate a restart-proof, non-blocking text prompt for an admin action.
 * Unlike `@grammyjs/conversations`, tapping any other button (such as an incoming
 * receipt notification or `ui:dismiss`) is NEVER blocked.
 */
export async function startAdminInput(
  ctx: MenuContext,
  options: {
    kind: string;
    payload?: Record<string, string | number | boolean | null>;
    returnRoute: string;
    promptText: string;
    keyboard?: InlineKeyboard;
  }
): Promise<void> {
  if (ctx.session) {
    markAdminContext(ctx);
    ctx.session.adminInput = {
      kind: options.kind,
      payload: options.payload,
      returnRoute: options.returnRoute,
      createdAt: Date.now(),
    };
  }
  await renderScreen(ctx, options.promptText, {
    parse_mode: 'Markdown',
    reply_markup: options.keyboard ?? adminInputCancelKeyboard(ctx),
  });
}

/**
 * Attach non-blocking admin input middleware.
 * Must run BEFORE `conversations()` and fallback text handlers so active prompts
 * capture admin text smoothly while never blocking incoming callbacks/commands.
 */
export function registerAdminInputMiddleware(
  bot: Bot<MenuContext>,
  dispatchRoute: (ctx: MenuContext, route: string, notice?: AdminScreenNotice) => Promise<boolean>
): void {
  bot.use(async (ctx, next) => {
    const session = ctx.session;
    if (!session?.adminInput) return next();

    // Non-admin safety guard
    const telegramId = ctx.from?.id;
    if (!telegramId || !ctx.services?.isAdmin(telegramId)) {
      clearAdminInput(session);
      return next();
    }

    // Ignore popovers / noops without cancelling the open prompt
    const cbData = ctx.callbackQuery?.data;
    if (cbData) {
      if (cbData === 'ui:dismiss' || cbData === 'ui:noop' || cbData === 'adm:in:cancel') {
        return next();
      }
      // Any other callback button (receipt alert, panel alert, nav, etc.) runs immediately!
      clearAdminInput(session);
      return next();
    }

    // Expire stale prompts silently
    if (!isAdminInputActive(session)) {
      return next();
    }

    const rawText = ctx.message?.text;
    if (typeof rawText !== 'string') {
      return next();
    }

    const trimmed = rawText.trim();
    const state = session.adminInput;

    // `/cancel` returns directly to parent route with zero intermediate screen
    if (trimmed === '/cancel') {
      await deleteConsumedInputMessage(ctx);
      clearAdminInput(session);
      await dispatchRoute(ctx, state.returnRoute, {
        tone: 'info',
        text: t(ctx, 'operation_cancelled'),
      });
      return;
    }

    // Any other slash command escapes cleanly and executes normally
    if (trimmed.startsWith('/')) {
      clearAdminInput(session);
      return next();
    }

    const handler = inputHandlers.get(state.kind);
    if (!handler) {
      clearAdminInput(session);
      return next();
    }

    await deleteConsumedInputMessage(ctx);
    const result = await handler(ctx, rawText, state);

    if (result.status === 'done') {
      clearAdminInput(session);
      await dispatchRoute(ctx, result.redirectRoute ?? state.returnRoute, result.notice);
      return;
    }

    if (result.status === 'retry') {
      // Refresh TTL and re-render prompt cleanly with inline error
      session.adminInput = { ...state, createdAt: Date.now() };
      await renderScreen(ctx, result.promptText, {
        parse_mode: 'Markdown',
        reply_markup: result.keyboard ?? adminInputCancelKeyboard(ctx),
      });
      return;
    }

    // 'handled': handler performed its own rendering & state management
  });
}
