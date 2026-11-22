import { InlineKeyboard } from 'grammy';
import { callbackData } from '../callbackData.js';
import { localizedNumber, t } from '../locale.js';
import type { ConversationContext, MenuContext, SessionData } from '../types.js';

export const ADMIN_NAV_STACK_MAX = 8;

/** Build a validated `adm:*` callback data string enforcing the 64-byte Bot API limit. */
export function admCb(...parts: Array<string | number>): string {
  return callbackData('adm', ...parts);
}

/** Record that the administrator is currently navigating inside the Admin UI. */
export function markAdminContext(ctx: Pick<MenuContext, 'session'>): void {
  if (ctx.session) {
    ctx.session.adminLastContext = 'admin';
  }
}

/** Record that the administrator switched back to User UI. */
export function markUserContext(ctx: Pick<MenuContext, 'session'>): void {
  if (ctx.session) {
    ctx.session.adminLastContext = 'user';
  }
}

/** Push a return route onto the bounded admin navigation stack (deduplicating consecutive entries). */
export function pushAdminNav(session: SessionData | undefined, route: string): void {
  if (!session || !route.startsWith('adm:')) return;
  const stack = [...(session.adminNavStack ?? [])];
  if (stack[stack.length - 1] !== route) {
    stack.push(route);
  }
  session.adminNavStack = stack.slice(-ADMIN_NAV_STACK_MAX);
}

/** Pop the previous route from the admin navigation stack, falling back when empty. */
export function popAdminNav(session: SessionData | undefined, fallback = 'adm:home'): string {
  if (!session?.adminNavStack?.length) return fallback;
  const stack = [...session.adminNavStack];
  const prev = stack.pop();
  session.adminNavStack = stack;
  return prev && prev.startsWith('adm:') ? prev : fallback;
}

/** Peek the top route on the admin navigation stack without popping. */
export function peekAdminNav(session: SessionData | undefined): string | undefined {
  const stack = session?.adminNavStack;
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/** Clear the admin navigation stack when returning to root hubs. */
export function resetAdminNav(session: SessionData | undefined): void {
  if (session) {
    delete session.adminNavStack;
  }
}

/** Append a standardized pagination row `[ ‹ Prev ] [ 1 / 5 ] [ Next › ]`. */
export function appendAdminPagination(
  keyboard: InlineKeyboard,
  ctx: ConversationContext,
  options: {
    page: number;
    totalPages: number;
    pageCallback: (page: number) => string;
  }
): InlineKeyboard {
  const { page, totalPages, pageCallback } = options;
  if (totalPages <= 1) return keyboard;

  if (page > 1) {
    keyboard.text(t(ctx, 'pagination_previous'), pageCallback(page - 1));
  }
  keyboard.text(`${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`, 'ui:noop');
  if (page < totalPages) {
    keyboard.text(t(ctx, 'pagination_next'), pageCallback(page + 1));
  }
  keyboard.row();
  return keyboard;
}

/**
 * Append a consistent bottom navigation row:
 * - Always shows `[ ‹ Parent ]`
 * - On deeper screens (`showHome: true` and backCallback !== 'adm:home'), pairs `[ 🛠️ مدیریت ]` beside it.
 */
export function appendAdminFooterNav(
  keyboard: InlineKeyboard,
  ctx: ConversationContext,
  options: {
    backCallback: string;
    backLabel?: string;
    showHome?: boolean;
  }
): InlineKeyboard {
  const label = options.backLabel ?? t(ctx, 'menu_back');
  keyboard.text(label, options.backCallback);
  if (options.showHome && options.backCallback !== 'adm:home') {
    keyboard.text(t(ctx, 'admin_nav_root_short'), 'adm:home');
  }
  return keyboard;
}

/**
 * Build a safe, vertically stacked confirmation keyboard.
 * Destructive or high-impact Confirm buttons are NEVER placed side-by-side with Cancel.
 */
export function buildAdminConfirmKeyboard(
  ctx: ConversationContext,
  options: {
    confirmCallback: string;
    cancelCallback: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): InlineKeyboard {
  return new InlineKeyboard()
    .text(options.confirmLabel ?? t(ctx, 'admin_confirm_button'), options.confirmCallback)
    .row()
    .text(options.cancelLabel ?? t(ctx, 'menu_cancel'), options.cancelCallback);
}
