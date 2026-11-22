import { InlineKeyboard } from 'grammy';
import type { AdminPromoListFilter, MenuContext } from './types.js';
import { callbackData } from './callbackData.js';
import { localizedDate, localizedDateTime, localizedNumber, t } from './locale.js';
import {
  buildAdminEmptyState,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  type AdminScreenNotice,
} from './ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from './rendering.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
  pushAdminNav,
} from './admin/adminNav.js';

const PROMO_PAGE_SIZE = 8;

const PROMO_FILTERS: ReadonlyArray<{ id: AdminPromoListFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'admin_promo_filter_all' },
  { id: 'active', labelKey: 'admin_promo_filter_active' },
  { id: 'inactive', labelKey: 'admin_promo_filter_inactive' },
  { id: 'expired', labelKey: 'admin_promo_filter_expired' },
];

export function formatPromoValue(ctx: MenuContext, promo: { type: string; value: number }): string {
  const formatted = localizedNumber(promo.value, ctx);
  switch (promo.type) {
    case 'discount_percent':
      return `${formatted}%`;
    case 'discount_fixed':
    case 'gift_credit':
      return `${formatted} ${t(ctx, 'currency_toman')}`;
    case 'gift_gb':
      return `${formatted} ${t(ctx, 'traffic_unit_gb')}`;
    default:
      return formatted;
  }
}

function appendPromoFilterTabs(
  keyboard: InlineKeyboard,
  ctx: MenuContext,
  activeFilter: AdminPromoListFilter
): void {
  for (const item of PROMO_FILTERS) {
    const label = t(ctx, item.labelKey);
    keyboard.text(activeFilter === item.id ? `• ${label} •` : label, `adm:prm:f:${item.id}`);
  }
  keyboard.row();
}

export async function showPromoCenter(
  ctx: MenuContext,
  requestedPage = 1,
  options?: { filter?: AdminPromoListFilter; notice?: AdminScreenNotice }
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);

  const filter: AdminPromoListFilter =
    options?.filter ?? ctx.session?.adminPromoView?.filter ?? 'all';
  const result = await ctx.services.promoService.listCodes(
    requestedPage,
    PROMO_PAGE_SIZE,
    undefined,
    filter
  );

  if (ctx.session) {
    ctx.session.adminPromoView = { filter, page: result.page };
  }

  const keyboard = new InlineKeyboard();
  appendPromoFilterTabs(keyboard, ctx, filter);

  if (result.items.length === 0) {
    keyboard
      .text(t(ctx, 'admin_promo_create_button'), callbackData('promo', 'create'))
      .text(t(ctx, 'admin_promo_bulk_create_button'), callbackData('promo', 'bulk'))
      .row();
    if (filter !== 'all') {
      keyboard.text(t(ctx, 'admin_promo_filter_all'), 'adm:prm:f:all').row();
    }
    appendAdminFooterNav(keyboard, ctx, {
      backCallback: 'adm:sales',
      backLabel: t(ctx, 'admin_menu_back_to_sales'),
      showHome: true,
    });

    const emptyText = buildAdminScreen({
      emoji: '🎟️',
      title: t(ctx, 'admin_promo_center_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_sales_title'),
        t(ctx, 'admin_promo_center_title')
      ),
      notice: options?.notice,
      footer: t(ctx, 'admin_no_promo_codes'),
    });
    await renderPromoScreen(ctx, emptyText, keyboard, 'Markdown');
    return;
  }

  const nowMs = Date.now();
  for (const promo of result.items) {
    const isExpired = Boolean(promo.expiresAt && new Date(promo.expiresAt).getTime() <= nowMs);
    const state = !promo.active ? '⚪' : isExpired ? '⌛' : '🟢';
    keyboard
      .text(
        `${state} ${promo.code} · ${formatPromoValue(ctx, promo)} · ${localizedNumber(promo.currentUses, ctx)}/${localizedNumber(promo.maxUses, ctx)}`,
        callbackData('promo', 'open', promo.id)
      )
      .row();
  }

  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:prm:p:${p}`,
  });

  keyboard
    .text(t(ctx, 'admin_promo_search_button'), 'adm:prm:search')
    .text(t(ctx, 'admin_promo_create_button'), callbackData('promo', 'create'))
    .row()
    .text(t(ctx, 'admin_promo_bulk_create_button'), callbackData('promo', 'bulk'))
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '🎟️',
    title: t(ctx, 'admin_promo_center_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_promo_center_title')
    ),
    notice: options?.notice,
    primary: {
      emoji: '🎟️',
      label: t(ctx, 'admin_promo_total_label'),
      value: localizedNumber(result.total, ctx),
      inline: true,
      emphasizeValue: true,
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
  id: string,
  notice?: AdminScreenNotice
): Promise<{ text: string; keyboard: InlineKeyboard; code: string } | undefined> {
  if (!ctx.services) return undefined;
  markAdminContext(ctx);
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) return undefined;

  const isExpired = Boolean(promo.expiresAt && new Date(promo.expiresAt).getTime() <= Date.now());
  const statusTone = !promo.active ? 'inactive' : isExpired ? 'warning' : 'active';
  const statusLabel = !promo.active
    ? t(ctx, 'admin_promo_inactive')
    : isExpired
      ? t(ctx, 'admin_promo_filter_expired')
      : t(ctx, 'admin_promo_active');

  const text = buildAdminScreen({
    emoji: '🎟️',
    title: t(ctx, 'admin_promo_detail_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_promo_center_title'),
      promo.code
    ),
    subtitle: `\`${sanitizeTelegramInlineCode(promo.code)}\``,
    notice,
    primary: {
      emoji: promo.active && !isExpired ? '🟢' : isExpired ? '🟡' : '⚪️',
      label: t(ctx, 'admin_promo_status_label'),
      value: buildStatusBadge(ctx, statusTone, statusLabel),
      inline: true,
    },
    sections: [
      {
        emoji: '⚙️',
        title: t(ctx, 'admin_promo_configuration_section'),
        fields: [
          {
            label: t(ctx, 'admin_promo_type_label'),
            value: promoTypeLabel(ctx, promo.type),
          },
          {
            label: t(ctx, 'admin_promo_value_label'),
            value: formatPromoValue(ctx, promo),
          },
          ...(promo.type === 'discount_percent'
            ? [
                {
                  label: t(ctx, 'admin_promo_max_discount_label'),
                  value: promo.maxDiscountAmount
                    ? `${localizedNumber(promo.maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                    : t(ctx, 'admin_promo_no_cap'),
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_promo_min_purchase_label'),
            value: `${localizedNumber(promo.minPurchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_promo_first_purchase_label'),
            value: promo.firstPurchaseOnly
              ? t(ctx, 'admin_promo_first_purchase_yes')
              : t(ctx, 'admin_promo_first_purchase_no'),
          },
          {
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
            label: t(ctx, 'admin_promo_uses_label'),
            value: `${localizedNumber(promo.currentUses, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
          },
          {
            label: t(ctx, 'admin_promo_per_user_label'),
            value: localizedNumber(promo.maxUsesPerUser, ctx),
          },
        ],
      },
    ],
  });

  const savedPage = ctx.session?.adminPromoView?.page ?? 1;
  const keyboard = new InlineKeyboard()
    .text(
      t(ctx, promo.active ? 'admin_promo_deactivate_button' : 'admin_promo_activate_button'),
      callbackData('promo', 'set', promo.active ? 0 : 1, promo.id)
    )
    .row()
    .text(
      `${t(ctx, 'admin_promo_redemptions_button')} (${localizedNumber(promo.currentUses, ctx)})`,
      callbackData('promo', 'redemptions', promo.id, '1')
    )
    .row()
    .text(t(ctx, 'admin_promo_edit_button'), `adm:prm:edit:${promo.id}`)
    .text(t(ctx, 'admin_promo_delete_button'), callbackData('promo', 'delete', promo.id))
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:prm:p:${savedPage}`,
    backLabel: t(ctx, 'admin_promo_back_to_list'),
    showHome: true,
  });

  return { text, keyboard, code: promo.code };
}

/** Single-card inline quick editor for any promo field without running a 9-step wizard. */
export async function showPromoQuickEditor(
  ctx: MenuContext,
  id: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) {
    await renderPromoScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_center_title'),
        t(ctx, 'admin_promo_not_found')
      ),
      promoCenterKeyboard(ctx),
      'Markdown'
    );
    return;
  }

  const text = buildAdminScreen({
    emoji: '✏️',
    title: t(ctx, 'admin_promo_edit_field_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_promo_center_title'), promo.code),
    subtitle: `\`${sanitizeTelegramInlineCode(promo.code)}\` · ${promoTypeLabel(ctx, promo.type)}`,
    notice,
    sections: [
      {
        fields: [
          { label: t(ctx, 'admin_promo_value_label'), value: formatPromoValue(ctx, promo) },
          {
            label: t(ctx, 'admin_promo_uses_label'),
            value: `${localizedNumber(promo.currentUses, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
          },
          {
            label: t(ctx, 'admin_promo_per_user_label'),
            value: localizedNumber(promo.maxUsesPerUser, ctx),
          },
          {
            label: t(ctx, 'admin_promo_min_purchase_label'),
            value: `${localizedNumber(promo.minPurchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(promo.type === 'discount_percent'
            ? [
                {
                  label: t(ctx, 'admin_promo_max_discount_label'),
                  value: promo.maxDiscountAmount
                    ? `${localizedNumber(promo.maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                    : t(ctx, 'admin_promo_no_cap'),
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_promo_first_purchase_label'),
            value: promo.firstPurchaseOnly
              ? t(ctx, 'admin_promo_first_purchase_yes')
              : t(ctx, 'admin_promo_first_purchase_no'),
          },
          {
            label: t(ctx, 'admin_promo_expiry_label'),
            value: promo.expiresAt
              ? localizedDate(promo.expiresAt, ctx)
              : t(ctx, 'admin_promo_never_expires'),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_edit_value_btn'), `adm:prm:ef:val:${promo.id}`)
    .text(t(ctx, 'admin_promo_edit_max_uses_btn'), `adm:prm:ef:max:${promo.id}`)
    .row()
    .text(t(ctx, 'admin_promo_edit_per_user_btn'), `adm:prm:ef:usr:${promo.id}`)
    .text(t(ctx, 'admin_promo_edit_min_purchase_btn'), `adm:prm:ef:min:${promo.id}`)
    .row();

  if (promo.type === 'discount_percent') {
    kb.text(t(ctx, 'admin_promo_edit_max_cap_btn'), `adm:prm:ef:cap:${promo.id}`);
  }
  kb.text(t(ctx, 'admin_promo_edit_expiry_btn'), `adm:prm:ef:exp:${promo.id}`).row();

  kb.text(
    `${t(ctx, 'admin_promo_toggle_first_purchase_btn')}: ${
      promo.firstPurchaseOnly
        ? t(ctx, 'admin_promo_first_purchase_yes')
        : t(ctx, 'admin_promo_first_purchase_no')
    }`,
    `adm:prm:fp:${promo.id}`
  ).row();

  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:prm:v:${promo.id}`,
    backLabel: t(ctx, 'admin_promo_back_to_detail'),
    showHome: true,
  });

  await renderPromoScreen(ctx, text, kb, 'Markdown');
}

export async function showPromoRedemptions(
  ctx: MenuContext,
  id: string,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) {
    await renderPromoScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_center_title'),
        t(ctx, 'admin_promo_not_found')
      ),
      promoCenterKeyboard(ctx),
      'Markdown'
    );
    return;
  }

  const result = await ctx.services.promoService.listRedemptions(id, requestedPage, 5);
  if (result.items.length === 0) {
    const emptyKb = new InlineKeyboard();
    appendAdminFooterNav(emptyKb, ctx, {
      backCallback: callbackData('promo', 'open', id),
      backLabel: t(ctx, 'admin_promo_back_to_detail'),
      showHome: true,
    });
    await renderPromoScreen(
      ctx,
      buildAdminEmptyState(
        '📭',
        t(ctx, 'admin_promo_redemptions_title'),
        t(ctx, 'admin_promo_no_redemptions')
      ),
      emptyKb,
      'Markdown'
    );
    return;
  }

  pushAdminNav(ctx.session, `adm:prm:red:${id}:${result.page}`);
  const keyboard = new InlineKeyboard();
  const seenUsers = new Set<number>();
  for (const r of result.items) {
    if (seenUsers.has(r.telegramId)) continue;
    seenUsers.add(r.telegramId);
    const shortName = r.username ? `@${r.username}` : r.firstName?.trim() || String(r.telegramId);
    keyboard.text(`👤 ${shortName.slice(0, 24)}`, `adm:usr:v:${r.telegramId}`).row();
  }

  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => callbackData('promo', 'redemptions', id, String(p)),
  });

  appendAdminFooterNav(keyboard, ctx, {
    backCallback: callbackData('promo', 'open', id),
    backLabel: t(ctx, 'admin_promo_back_to_detail'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '👥',
    title: t(ctx, 'admin_promo_redemptions_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_promo_center_title'), promo.code),
    subtitle: `\`${sanitizeTelegramInlineCode(promo.code)}\``,
    primary: {
      emoji: '🧾',
      label: t(ctx, 'admin_promo_uses_label'),
      value: `${localizedNumber(result.total, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
      inline: true,
    },
    sections: result.items.map((r, index) => {
      const userDisplay = r.username
        ? `@${r.username}`
        : r.firstName
          ? `${r.firstName} (${r.telegramId})`
          : String(r.telegramId);
      const statusInfo = promoRedemptionStatus(ctx, r.status);
      return {
        emoji: '👤',
        title: `${localizedNumber((result.page - 1) * 5 + index + 1, ctx)}. ${escapeTelegramMarkdown(userDisplay)}`,
        fields: [
          {
            label: t(ctx, 'admin_promo_redeemed_at_label'),
            value: localizedDateTime(r.redeemedAt, ctx),
          },
          {
            label: t(ctx, 'admin_promo_status_label'),
            value: `${statusInfo.emoji} ${statusInfo.label}`,
          },
          ...(r.purchaseAmount !== null && r.purchaseAmount !== undefined
            ? [
                {
                  label: t(ctx, 'checkout_total_label'),
                  value: `${localizedNumber(r.purchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
        ],
      };
    }),
    footer: t(ctx, 'admin_promo_page_label', {
      page: localizedNumber(result.page, ctx),
      total_pages: localizedNumber(result.totalPages, ctx),
    }),
  });

  await renderPromoScreen(ctx, text, keyboard, 'Markdown');
}

export function promoDeleteConfirmKeyboard(ctx: MenuContext, id: string): InlineKeyboard {
  return buildAdminConfirmKeyboard(ctx, {
    confirmCallback: callbackData('promo', 'delete_confirm', id),
    cancelCallback: callbackData('promo', 'open', id),
    confirmLabel: t(ctx, 'admin_promo_delete_confirm_button'),
    cancelLabel: t(ctx, 'menu_cancel'),
  });
}

export function promoCenterKeyboard(ctx: MenuContext): InlineKeyboard {
  const kb = new InlineKeyboard();
  return appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:prm:p:1',
    backLabel: t(ctx, 'admin_promo_back_to_list'),
    showHome: true,
  });
}

export async function renderPromoScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode: 'Markdown' | undefined = 'Markdown'
): Promise<void> {
  await renderScreen(ctx, text, {
    parse_mode: parseMode,
    reply_markup: keyboard,
    preferEdit: true,
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

function promoRedemptionStatus(ctx: MenuContext, status: string): { emoji: string; label: string } {
  switch (status) {
    case 'completed':
      return { emoji: '🟢', label: t(ctx, 'admin_promo_status_completed') };
    case 'pending':
      return { emoji: '⏳', label: t(ctx, 'admin_promo_status_pending') };
    default:
      return { emoji: '⚪️', label: escapeTelegramMarkdown(status) };
  }
}
