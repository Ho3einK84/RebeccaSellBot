import { InlineKeyboard } from 'grammy';
import type { MenuContext } from './types.js';
import { callbackData } from './callbackData.js';
import { localizedDate, localizedNumber, t, tm } from './locale.js';

const PROMO_PAGE_SIZE = 8;

export async function showPromoCenter(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.promoService.listCodes(requestedPage, PROMO_PAGE_SIZE);
  const keyboard = new InlineKeyboard();

  for (const promo of result.items) {
    const state = promo.active ? '🟢' : '⚪';
    keyboard
      .text(
        `${state} ${promo.code} · ${localizedNumber(promo.currentUses, ctx)}/${localizedNumber(promo.maxUses, ctx)}`,
        callbackData('promo', 'open', promo.id)
      )
      .row();
  }

  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'admin_promo_previous_page'),
        callbackData('promo', 'page', result.page - 1)
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      callbackData('promo', 'page', result.page)
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'admin_promo_next_page'),
        callbackData('promo', 'page', result.page + 1)
      );
    }
    keyboard.row();
  }

  keyboard
    .text(t(ctx, 'admin_promo_search_button'), callbackData('promo', 'search'))
    .text(t(ctx, 'admin_promo_create_button'), callbackData('promo', 'create'))
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');

  const text = t(ctx, result.total === 0 ? 'admin_no_promo_codes' : 'admin_promo_center', {
    count: localizedNumber(result.total, ctx),
    page: localizedNumber(result.page, ctx),
    total_pages: localizedNumber(result.totalPages, ctx),
  });
  await renderPromoScreen(ctx, text, keyboard);
}

export async function promoDetailView(
  ctx: MenuContext,
  id: string
): Promise<{ text: string; keyboard: InlineKeyboard; code: string } | undefined> {
  if (!ctx.services) return undefined;
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) return undefined;
  const text = tm(ctx, 'admin_promo_detail', {
    code: promo.code,
    type: promoTypeLabel(ctx, promo.type),
    value: localizedNumber(promo.value, ctx),
    current_uses: localizedNumber(promo.currentUses, ctx),
    max_uses: localizedNumber(promo.maxUses, ctx),
    max_uses_per_user: localizedNumber(promo.maxUsesPerUser, ctx),
    min_purchase_amount: localizedNumber(promo.minPurchaseAmount, ctx),
    expires_at: promo.expiresAt
      ? localizedDate(promo.expiresAt, ctx)
      : t(ctx, 'admin_promo_never_expires'),
    active: t(ctx, promo.active ? 'admin_promo_active' : 'admin_promo_inactive'),
  });
  const keyboard = new InlineKeyboard()
    .text(
      t(ctx, promo.active ? 'admin_promo_deactivate_button' : 'admin_promo_activate_button'),
      callbackData('promo', 'toggle', promo.id)
    )
    .row()
    .text(t(ctx, 'admin_promo_edit_button'), callbackData('promo', 'edit', promo.id))
    .text(t(ctx, 'admin_promo_delete_button'), callbackData('promo', 'delete', promo.id))
    .row()
    .text(t(ctx, 'admin_promo_create_button'), callbackData('promo', 'create'))
    .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'));
  return { text, keyboard, code: promo.code };
}

export function promoDeleteConfirmKeyboard(ctx: MenuContext, id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'admin_promo_delete_confirm_button'), callbackData('promo', 'delete_confirm', id))
    .text(t(ctx, 'menu_cancel'), callbackData('promo', 'open', id));
}

export function promoCenterKeyboard(ctx: MenuContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'))
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
}

export async function renderPromoScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'Markdown'
): Promise<void> {
  const isPromoCallback = ctx.callbackQuery?.data?.startsWith('promo:');
  if (isPromoCallback && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      ...(parseMode ? { parse_mode: parseMode } : {}),
      reply_markup: keyboard,
    });
    return;
  }
  await ctx.reply(text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: keyboard,
  });
}

function promoTypeLabel(ctx: MenuContext, type: string): string {
  switch (type) {
    case 'discount_percent':
      return t(ctx, 'admin_promo_type_percent');
    case 'discount_fixed':
      return t(ctx, 'admin_promo_type_fixed');
    case 'gift_credit':
      return t(ctx, 'admin_promo_type_credit');
    case 'gift_gb':
      return t(ctx, 'admin_promo_type_gb');
    default:
      return type;
  }
}
