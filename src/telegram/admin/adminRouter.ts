import type { Bot, InlineKeyboard } from 'grammy';
import type { AdminScreenNotice } from '../designSystem.js';
import type { MenuContext } from '../types.js';
import { t } from '../locale.js';
import { clearAdminInput } from './adminInput.js';
import { markAdminContext, popAdminNav } from './adminNav.js';
import { requireAdminCallback, renderScreen } from '../ui.js';
import { buildAdminEmptyState } from '../designSystem.js';

export type AdminRouteHandler = (
  ctx: MenuContext,
  match: RegExpExecArray | null,
  notice?: AdminScreenNotice
) => Promise<void>;

interface RegisteredAdminRoute {
  pattern: string | RegExp;
  handler: AdminRouteHandler;
}

const routes: RegisteredAdminRoute[] = [];

/** Register a stateless `adm:*` route handler. Exact string or RegExp match. */
export function registerAdminRoute(pattern: string | RegExp, handler: AdminRouteHandler): void {
  const key = typeof pattern === 'string' ? pattern : pattern.toString();
  const existingIndex = routes.findIndex(
    (entry) =>
      (typeof entry.pattern === 'string' ? entry.pattern : entry.pattern.toString()) === key
  );
  if (existingIndex >= 0) {
    routes[existingIndex] = { pattern, handler };
    return;
  }
  routes.push({ pattern, handler });
}

/** Clear all registered routes (useful for isolated tests). */
export function clearRegisteredAdminRoutes(): void {
  routes.length = 0;
}

/**
 * Dispatch an `adm:*` route directly (used by callback handlers, `adm:back`,
 * quick slash commands, and post-input return navigation).
 */
export async function dispatchAdminRoute(
  ctx: MenuContext,
  route: string,
  notice?: AdminScreenNotice
): Promise<boolean> {
  if (ctx.session) {
    markAdminContext(ctx);
  }
  const target = route === 'adm:back' ? popAdminNav(ctx.session, 'adm:home') : route;

  for (const entry of routes) {
    if (typeof entry.pattern === 'string') {
      if (entry.pattern === target) {
        await entry.handler(ctx, null, notice);
        return true;
      }
    } else {
      const match = entry.pattern.exec(target);
      if (match) {
        await entry.handler(ctx, match, notice);
        return true;
      }
    }
  }
  return false;
}

/**
 * Attach the unified `adm:*` callback listener onto a grammY Bot.
 * Every `adm:*` callback enforces admin auth, cancels stale text prompts,
 * and falls back cleanly inside Admin Mode if a button is expired.
 */
export function attachAdminRouter(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^adm:/u, async (ctx) => {
    if (!(await requireAdminCallback(ctx))) return;
    const data = ctx.callbackQuery.data;

    if (data === 'adm:in:cancel') {
      const returnRoute = ctx.session?.adminInput?.returnRoute ?? 'adm:home';
      clearAdminInput(ctx.session);
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') }).catch(() => {});
      const handled = await dispatchAdminRoute(ctx, returnRoute, {
        tone: 'info',
        text: t(ctx, 'operation_cancelled'),
      });
      if (!handled) {
        await dispatchAdminRoute(ctx, 'adm:home');
      }
      return;
    }

    // Any normal admin navigation automatically cancels a pending non-blocking text prompt.
    clearAdminInput(ctx.session);
    markAdminContext(ctx);

    const handled = await dispatchAdminRoute(ctx, data);
    if (handled) {
      // Handlers may answer with a toast/alert; answer silently if still unacknowledged.
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    await ctx
      .answerCallbackQuery({ text: t(ctx, 'button_expired'), show_alert: true })
      .catch(() => {});
    const recovered = await dispatchAdminRoute(ctx, 'adm:home', {
      tone: 'warning',
      text: t(ctx, 'button_expired'),
    });
    if (!recovered) {
      await renderScreen(
        ctx,
        buildAdminEmptyState('⌛️', t(ctx, 'button_expired'), t(ctx, 'button_expired_help')),
        {
          parse_mode: 'Markdown',
          reply_markup: undefined as unknown as InlineKeyboard,
        }
      );
    }
  });
}
