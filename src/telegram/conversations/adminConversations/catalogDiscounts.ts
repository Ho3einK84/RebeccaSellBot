import { InlineKeyboard } from 'grammy';
import type { BotServices, ConversationContext, MyConversation } from '../../types.js';
import {
  CatalogDiscountService,
  type CatalogDiscountRow,
  type CatalogDiscountScope,
  type CatalogDiscountType,
} from '../../../domain/services/CatalogDiscountService.js';
import { callbackData } from '../../callbackData.js';
import { localizedDate, localizedNumber, t } from '../../locale.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { renderSalesMenu } from '../../keyboards/adminMenu.js';
import { parseNonnegativeSafeInteger, parsePositiveSafeInteger, requireAdmin } from './shared.js';

function getCatalogDiscountService(services: BotServices): CatalogDiscountService {
  return services.catalogDiscountService ?? new CatalogDiscountService();
}

function normalizeDateDigits(raw: string): string {
  return raw
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

function parseDiscountDate(raw: string, endOfDay: boolean): Date | undefined {
  const normalized = normalizeDateDigits(raw);
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized);
  if (dateOnlyMatch) {
    const iso = endOfDay
      ? `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T23:59:59.999Z`
      : `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00.000Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return undefined;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function formatDiscountScope(ctx: ConversationContext, discount: CatalogDiscountRow): string {
  if (discount.scope === 'category') {
    const label = t(ctx, 'admin_sales_discount_scope_category');
    return discount.targetId ? `${label} (${escapeTelegramMarkdown(discount.targetId)})` : label;
  }
  if (discount.scope === 'package') {
    const label = t(ctx, 'admin_sales_discount_scope_package');
    return discount.targetId ? `${label} (${escapeTelegramMarkdown(discount.targetId)})` : label;
  }
  return t(ctx, 'admin_sales_discount_scope_all');
}

function formatDiscountType(ctx: ConversationContext, discount: CatalogDiscountRow): string {
  return discount.discountType === 'fixed'
    ? t(ctx, 'admin_sales_discount_type_fixed')
    : t(ctx, 'admin_sales_discount_type_percent');
}

function formatDiscountValue(ctx: ConversationContext, discount: CatalogDiscountRow): string {
  if (discount.discountType === 'fixed') {
    return `${localizedNumber(discount.value, ctx)} ${t(ctx, 'currency_toman')}`;
  }
  return `${localizedNumber(discount.value, ctx)}%`;
}

function buildDiscountListScreen(
  ctx: ConversationContext,
  discounts: readonly CatalogDiscountRow[]
): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  for (const discount of discounts) {
    const statusDot = discount.active ? '🟢' : '⚪️';
    const label = `${statusDot} ${discount.title} · ${formatDiscountValue(ctx, discount)}`;
    keyboard.text(label.slice(0, 60), callbackData('cdisc', 'open', discount.id)).row();
  }
  keyboard
    .text(t(ctx, 'admin_sales_discount_create_button'), callbackData('cdisc', 'create'))
    .row()
    .text(t(ctx, 'admin_menu_back_to_sales'), callbackData('cdisc', 'back'));

  if (discounts.length === 0) {
    return {
      text: buildEmptyState(
        '🔥',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discounts_empty')
      ),
      keyboard,
    };
  }

  const text = buildScreen({
    emoji: '🔥',
    title: t(ctx, 'admin_sales_discounts_title'),
    subtitle: t(ctx, 'admin_sales_discounts_subtitle'),
    sections: [
      {
        emoji: '📋',
        title: t(ctx, 'admin_sales_discounts_title'),
        fields: discounts.map((discount) => ({
          emoji: discount.active ? '🟢' : '⚪️',
          label: escapeTelegramMarkdown(discount.title),
          value: `${formatDiscountValue(ctx, discount)} · ${formatDiscountScope(ctx, discount)}`,
        })),
      },
    ],
  });

  return { text, keyboard };
}

function buildDiscountDetailScreen(
  ctx: ConversationContext,
  discount: CatalogDiscountRow
): { text: string; keyboard: InlineKeyboard } {
  const statusLabel = discount.active
    ? t(ctx, 'admin_overview_active')
    : t(ctx, 'admin_overview_inactive');

  const text = buildScreen({
    emoji: '🔥',
    title: t(ctx, 'admin_sales_discount_detail_title'),
    primary: {
      emoji: discount.active ? '🟢' : '⚪️',
      label: t(ctx, 'admin_sales_discount_title_label'),
      value: `${escapeTelegramMarkdown(discount.title)} (${statusLabel})`,
    },
    sections: [
      {
        emoji: '📋',
        title: t(ctx, 'admin_sales_discount_detail_title'),
        fields: [
          {
            label: t(ctx, 'admin_sales_discount_scope_label'),
            value: formatDiscountScope(ctx, discount),
          },
          {
            label: t(ctx, 'admin_sales_discount_type_label'),
            value: formatDiscountType(ctx, discount),
          },
          {
            label: t(ctx, 'admin_sales_discount_value_label'),
            value: formatDiscountValue(ctx, discount),
          },
          {
            label: t(ctx, 'admin_sales_discount_max_cap_label'),
            value:
              discount.maxDiscountAmount && discount.maxDiscountAmount > 0
                ? `${localizedNumber(discount.maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                : '—',
          },
          {
            label: t(ctx, 'admin_sales_discount_starts_label'),
            value: localizedDate(new Date(discount.startsAt), ctx),
          },
          {
            label: t(ctx, 'admin_sales_discount_expires_label'),
            value: discount.expiresAt ? localizedDate(new Date(discount.expiresAt), ctx) : '∞',
          },
        ],
      },
    ],
  });

  const keyboard = new InlineKeyboard()
    .text(
      discount.active
        ? t(ctx, 'admin_sales_discount_deactivate_button')
        : t(ctx, 'admin_sales_discount_activate_button'),
      callbackData('cdisc', 'toggle', discount.id)
    )
    .row()
    .text(
      t(ctx, 'admin_sales_discount_broadcast_button'),
      callbackData('cdisc', 'bcast', discount.id)
    )
    .row()
    .text(
      t(ctx, 'admin_sales_discount_delete_button'),
      callbackData('cdisc', 'delete', discount.id)
    )
    .row()
    .text(t(ctx, 'menu_back'), callbackData('cdisc', 'list'));

  return { text, keyboard };
}

async function runCreateDiscountWizard(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<CatalogDiscountRow | undefined> {
  // 1. Title
  let title: string | undefined;
  while (!title) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🔥',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_title_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const raw = await waitForAdminTextInput(conversation);
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length >= 1 && trimmed.length <= 120) {
      title = trimmed;
    }
  }

  // 2. Scope
  const scopeKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_sales_discount_scope_all'), callbackData('cdisc', 'scope', 'all'))
    .row()
    .text(t(ctx, 'admin_sales_discount_scope_category'), callbackData('cdisc', 'scope', 'category'))
    .row()
    .text(t(ctx, 'admin_sales_discount_scope_package'), callbackData('cdisc', 'scope', 'package'))
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '🎯',
      t(ctx, 'admin_sales_discounts_title'),
      t(ctx, 'admin_sales_discount_scope_prompt')
    ),
    { parse_mode: 'Markdown', reply_markup: scopeKeyboard }
  );
  const scopeChoice = await waitForAdminCallbackInput(conversation, ['cdisc:scope:']);
  if (!scopeChoice) return undefined;
  const scope = scopeChoice.slice('cdisc:scope:'.length) as CatalogDiscountScope;

  // 3. Optional Target (category or package)
  let targetId: string | null = null;
  if (scope === 'category') {
    const categories = await conversation.external(
      async (outsideCtx) =>
        (await outsideCtx.services?.packageCategoryService?.listCategories(true)) ?? []
    );
    if (categories.length === 0) {
      await replyInAdminConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'admin_sales_discounts_title'), t(ctx, 'shop_category_empty')),
        { parse_mode: 'Markdown' }
      );
      return undefined;
    }
    const targetKeyboard = new InlineKeyboard();
    categories.forEach((cat, idx) => {
      targetKeyboard
        .text(`${cat.icon ? `${cat.icon} ` : ''}${cat.name}`, callbackData('cdisc', 'tgt', idx))
        .row();
    });
    targetKeyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '📦',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_target_prompt')
      ),
      { parse_mode: 'Markdown', reply_markup: targetKeyboard }
    );
    const chosen = await waitForAdminCallbackInput(conversation, ['cdisc:tgt:']);
    if (!chosen) return undefined;
    const idx = Number(chosen.slice('cdisc:tgt:'.length));
    const selected = categories[idx];
    if (!selected) return undefined;
    targetId = selected.id;
  } else if (scope === 'package') {
    const packages = await conversation.external(
      (outsideCtx) =>
        outsideCtx.services?.pricingService?.getPackages(undefined, undefined, true) ?? []
    );
    if (packages.length === 0) {
      await replyInAdminConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'admin_sales_discounts_title'), t(ctx, 'shop_empty_message')),
        { parse_mode: 'Markdown' }
      );
      return undefined;
    }
    const targetKeyboard = new InlineKeyboard();
    packages.forEach((pkg, idx) => {
      targetKeyboard.text(pkg.name.slice(0, 60), callbackData('cdisc', 'tgt', idx)).row();
    });
    targetKeyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '📦',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_target_prompt')
      ),
      { parse_mode: 'Markdown', reply_markup: targetKeyboard }
    );
    const chosen = await waitForAdminCallbackInput(conversation, ['cdisc:tgt:']);
    if (!chosen) return undefined;
    const idx = Number(chosen.slice('cdisc:tgt:'.length));
    const selected = packages[idx];
    if (!selected) return undefined;
    targetId = selected.id;
  }

  // 4. Discount Type
  const typeKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_sales_discount_type_percent'), callbackData('cdisc', 'type', 'percent'))
    .row()
    .text(t(ctx, 'admin_sales_discount_type_fixed'), callbackData('cdisc', 'type', 'fixed'))
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '💰',
      t(ctx, 'admin_sales_discounts_title'),
      t(ctx, 'admin_sales_discount_type_prompt')
    ),
    { parse_mode: 'Markdown', reply_markup: typeKeyboard }
  );
  const typeChoice = await waitForAdminCallbackInput(conversation, ['cdisc:type:']);
  if (!typeChoice) return undefined;
  const discountType = typeChoice.slice('cdisc:type:'.length) as CatalogDiscountType;

  // 5. Value (normalizes Persian digits)
  let value: number | undefined;
  while (value === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🔢',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_value_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const raw = await waitForAdminTextInput(conversation);
    if (raw === undefined) return undefined;
    const parsed = parsePositiveSafeInteger(raw);
    if (parsed !== undefined && (discountType !== 'percent' || parsed <= 100)) {
      value = parsed;
    }
  }

  // 6. Optional Max Discount Cap (only applicable to percent discounts)
  let maxDiscountAmount: number | null | undefined = discountType === 'fixed' ? null : undefined;
  while (maxDiscountAmount === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🛑',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_max_cap_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const raw = await waitForAdminTextInput(conversation);
    if (raw === undefined) return undefined;
    const parsed = parseNonnegativeSafeInteger(raw);
    if (parsed !== undefined) {
      maxDiscountAmount = parsed === 0 ? null : parsed;
    }
  }

  // 7. Starts At
  let startsAt: Date | undefined;
  while (!startsAt) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '📅',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_start_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const raw = await waitForAdminTextInput(conversation);
    if (raw === undefined) return undefined;
    const normalized = normalizeDateDigits(raw).toLowerCase();
    if (normalized === 'now' || normalized === '0' || normalized === 'الان') {
      startsAt = new Date();
    } else {
      startsAt = parseDiscountDate(normalized, false);
    }
  }

  // 8. Expires At
  let expiresAt: Date | null | undefined;
  while (expiresAt === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '⏳',
        t(ctx, 'admin_sales_discounts_title'),
        t(ctx, 'admin_sales_discount_expiry_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const raw = await waitForAdminTextInput(conversation);
    if (raw === undefined) return undefined;
    const normalized = normalizeDateDigits(raw).toLowerCase();
    if (normalized === '0' || normalized === '-') {
      expiresAt = null;
    } else {
      const parsed = parseDiscountDate(normalized, true);
      if (parsed && parsed.getTime() > startsAt.getTime()) {
        expiresAt = parsed;
      }
    }
  }

  const created = await conversation.external((outsideCtx) =>
    getCatalogDiscountService(outsideCtx.services!).createDiscount({
      title,
      scope,
      targetId,
      discountType,
      value,
      maxDiscountAmount,
      startsAt,
      expiresAt,
      active: true,
    })
  );

  await replyInAdminConversation(
    conversation,
    ctx,
    t(ctx, 'admin_sales_discount_created', { name: escapeTelegramMarkdown(created.title) }),
    { parse_mode: 'Markdown' }
  );
  return created;
}

async function runDiscountDetailLoop(
  conversation: MyConversation,
  ctx: ConversationContext,
  adminId: number,
  discountId: string
): Promise<void> {
  for (;;) {
    const discount = await conversation.external((outsideCtx) =>
      getCatalogDiscountService(outsideCtx.services!).getDiscountById(discountId)
    );
    if (!discount) {
      await replyInAdminConversation(conversation, ctx, t(ctx, 'admin_sales_discount_not_found'), {
        parse_mode: 'Markdown',
      });
      return;
    }

    const { text, keyboard } = buildDiscountDetailScreen(ctx, discount);
    await promptInConversation(conversation, ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    const action = await waitForAdminCallbackInput(conversation, [
      'cdisc:toggle:',
      'cdisc:bcast:',
      'cdisc:delete:',
      'cdisc:list',
    ]);
    if (!action || action === 'cdisc:list') return;

    if (action.startsWith('cdisc:toggle:')) {
      const updated = await conversation.external((outsideCtx) =>
        getCatalogDiscountService(outsideCtx.services!).toggleDiscount(discount.id)
      );
      if (!updated) {
        await replyInAdminConversation(
          conversation,
          ctx,
          t(ctx, 'admin_sales_discount_not_found'),
          {
            parse_mode: 'Markdown',
          }
        );
        return;
      }
      const statusText = updated.active
        ? t(ctx, 'admin_overview_active')
        : t(ctx, 'admin_overview_inactive');
      await replyInAdminConversation(
        conversation,
        ctx,
        t(ctx, 'admin_sales_discount_toggled', {
          name: escapeTelegramMarkdown(updated.title),
          status: statusText,
        }),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (action.startsWith('cdisc:delete:')) {
      const deleted = await conversation.external((outsideCtx) =>
        getCatalogDiscountService(outsideCtx.services!).deleteDiscount(discount.id)
      );
      await replyInAdminConversation(
        conversation,
        ctx,
        deleted
          ? t(ctx, 'admin_sales_discount_deleted', {
              name: escapeTelegramMarkdown(discount.title),
            })
          : t(ctx, 'admin_sales_discount_not_found'),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (action.startsWith('cdisc:bcast:')) {
      const description = `${formatDiscountValue(ctx, discount)} · ${formatDiscountScope(ctx, discount)}`;
      const dateStr = discount.expiresAt ? localizedDate(new Date(discount.expiresAt), ctx) : '∞';
      const broadcastMessage = t(ctx, 'admin_sales_discount_broadcast_template', {
        name: escapeTelegramMarkdown(discount.title),
        description,
        date: dateStr,
      });

      const job = await conversation.external((outsideCtx) =>
        outsideCtx.services!.broadcastService.createJob({
          actorTelegramId: adminId,
          audience: 'all',
          message: broadcastMessage,
        })
      );

      await replyInAdminConversation(
        conversation,
        ctx,
        t(ctx, 'admin_sales_discount_broadcast_queued', {
          count: localizedNumber(job.recipientCount, ctx),
        }),
        { parse_mode: 'Markdown' }
      );
    }
  }
}

export async function adminCatalogDiscountsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;

  for (;;) {
    const discounts = await conversation.external((outsideCtx) =>
      getCatalogDiscountService(outsideCtx.services!).listDiscounts()
    );
    const { text, keyboard } = buildDiscountListScreen(ctx, discounts);

    await promptInConversation(conversation, ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    const selection = await waitForAdminCallbackInput(conversation, [
      'cdisc:create',
      'cdisc:open:',
      'cdisc:back',
    ]);
    if (!selection) return;

    if (selection === 'cdisc:back') {
      break;
    }

    if (selection === 'cdisc:create') {
      const created = await runCreateDiscountWizard(conversation, ctx);
      if (created) {
        await runDiscountDetailLoop(conversation, ctx, adminId, created.id);
      }
      continue;
    }

    if (selection.startsWith('cdisc:open:')) {
      const discountId = selection.slice('cdisc:open:'.length);
      await runDiscountDetailLoop(conversation, ctx, adminId, discountId);
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}
