import { InlineKeyboard } from 'grammy';
import type { MenuContext } from './types.js';
import { callbackData } from './callbackData.js';
import { localizedDate, localizedNumber, t } from './locale.js';
import { buildEmptyState, buildScreen, buildStatusBadge, renderUiScreen } from './ui.js';

const PROMO_PAGE_SIZE = 8;

export async function showPromoCenter(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.promoService.listCodes(requestedPage, PROMO_PAGE_SIZE);
  if (result.items.length === 0) {
    await renderPromoScreen(
      ctx,
      buildEmptyState('🎟️', t(ctx, 'admin_promo_center_title'), t(ctx, 'admin_no_promo_codes')),
      new InlineKeyboard()
        .text(t(ctx, 'admin_promo_create_button'), callbackData('promo', 'create'))
        .row()
        .text(t(ctx, 'menu_back'), 'nav:admin:sales'),
      'Markdown'
    );
    return;
  }
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
      'ui:noop'
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
    .text(t(ctx, 'menu_back'), 'nav:admin:sales');

  const text = buildScreen({
    emoji: '🎟️',
    title: t(ctx, 'admin_promo_center_title'),
    subtitle: t(ctx, 'admin_promo_center_subtitle'),
    primary: {
      emoji: '🎟️',
      label: t(ctx, 'admin_promo_total_label'),
      value: localizedNumber(result.total, ctx),
    },
    footer: t(ctx, 'admin_promo_page_label', {
      page: localizedNumber(result.page, ctx),
      total_pages: localizedNumber(result.totalPages, ctx),
    }),
  });
  await renderPromoScreen(ctx, text, keyboard, 'Markdown');
}

export async function promoDetailView(
  ctx: MenuContext,
  id: string
): Promise<{ text: string; keyboard: InlineKeyboard; code: string } | undefined> {
  if (!ctx.services) return undefined;
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) return undefined;
  const text = buildScreen({
    emoji: '🎟️',
    title: t(ctx, 'admin_promo_detail_title'),
    subtitle: `\`${promo.code}\``,
    primary: {
      emoji: promo.active ? '🟢' : '⚪️',
      label: t(ctx, 'admin_promo_status_label'),
      value: buildStatusBadge(
        ctx,
        promo.active ? 'active' : 'inactive',
        t(ctx, promo.active ? 'admin_promo_active' : 'admin_promo_inactive')
      ),
    },
    sections: [
      {
        emoji: '⚙️',
        title: t(ctx, 'admin_promo_configuration_section'),
        fields: [
          {
            emoji: '🏷️',
            label: t(ctx, 'admin_promo_type_label'),
            value: promoTypeLabel(ctx, promo.type),
          },
          {
            emoji: '💰',
            label: t(ctx, 'admin_promo_value_label'),
            value: localizedNumber(promo.value, ctx),
          },
          {
            emoji: '🛍️',
            label: t(ctx, 'admin_promo_min_purchase_label'),
            value: `${localizedNumber(promo.minPurchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '📅',
            label: t(ctx, 'admin_promo_expiry_label'),
            value: promo.expiresAt
              ? localizedDate(promo.expiresAt, ctx)
              : t(ctx, 'admin_promo_never_expires'),
          },
        ],
      },
      {
        emoji: '📈',
        title: t(ctx, 'admin_promo_usage_section'),
        fields: [
          {
            emoji: '🧾',
            label: t(ctx, 'admin_promo_uses_label'),
            value: `${localizedNumber(promo.currentUses, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
          },
          {
            emoji: '👤',
            label: t(ctx, 'admin_promo_per_user_label'),
            value: localizedNumber(promo.maxUsesPerUser, ctx),
          },
        ],
      },
    ],
  });
  const keyboard = new InlineKeyboard()
    .text(
      t(ctx, promo.active ? 'admin_promo_deactivate_button' : 'admin_promo_activate_button'),
      callbackData('promo', 'set', promo.active ? 0 : 1, promo.id)
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
    .text(t(ctx, 'menu_back'), 'nav:admin:sales');
}

export async function renderPromoScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'Markdown'
): Promise<void> {
  const isPromoCallback = ctx.callbackQuery?.data?.startsWith('promo:');
  await renderUiScreen(ctx, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: keyboard,
    preferEdit: isPromoCallback,
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
