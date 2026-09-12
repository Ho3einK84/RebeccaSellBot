import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedDate, localizedNumber, t } from '../../locale.js';
import type { PromoType } from '../../../domain/services/PromoService.js';
import { callbackData } from '../../callbackData.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  buildStatusBadge,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

export async function adminCreatePromoConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const code = await promptPromoCode(conversation, ctx);
  if (!code) return;
  await runPromoEditor(conversation, ctx, code);
}

export async function adminEditPromoConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const id = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.adminPromoEditId;
    delete outsideCtx.session.adminPromoEditId;
    return selected;
  });
  if (!id) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_promo_center_title'), t(ctx, 'admin_promo_not_found')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_promo_center_title'), t(ctx, 'admin_promo_not_found')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  await runPromoEditor(conversation, ctx, promo.code, promo);
}

export async function adminSearchPromoConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '🔎',
      t(ctx, 'admin_promo_center_title'),
      t(ctx, 'admin_promo_search_prompt'),
      t(ctx, 'admin_promo_center_subtitle')
    ),
    { parse_mode: 'Markdown' }
  );
  const input = await waitForAdminTextInput(conversation);
  if (input === undefined) return;
  const result = await ctx.services.promoService.listCodes(1, 10, input);
  if (result.items.length === 0) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('📭', t(ctx, 'admin_promo_center_title'), t(ctx, 'admin_no_promo_codes')),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'))
          .row()
          .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
      }
    );
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const promo of result.items) {
    keyboard
      .text(`${promo.active ? '🟢' : '⚪️'} ${promo.code}`, callbackData('promo', 'open', promo.id))
      .row();
  }
  keyboard
    .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'))
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await replyInAdminConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '🔎',
      title: t(ctx, 'admin_promo_center_title'),
      subtitle: t(ctx, 'admin_promo_search_results', { count: localizedNumber(result.total, ctx) }),
      primary: {
        emoji: '🎟️',
        label: t(ctx, 'admin_promo_total_label'),
        value: localizedNumber(result.total, ctx),
      },
      sections: [
        {
          emoji: '📋',
          title: t(ctx, 'admin_promo_center_title'),
          fields: result.items.map((promo) => ({
            emoji: promo.active ? '🟢' : '⚪️',
            label: escapeTelegramMarkdown(promo.code),
            value: `${localizedNumber(promo.currentUses, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
          })),
        },
      ],
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function adminBulkPromoConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const prefix = await promptPromoBulkPrefix(conversation, ctx);
  if (prefix === undefined) return;
  const count = await promptPromoBulkCount(conversation, ctx);
  if (count === undefined) return;
  const type = await promptPromoType(conversation, ctx);
  if (!type) return;
  const value = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_value_prompt'),
    t(ctx, 'admin_invalid_promo_value'),
    type === 'discount_percent' ? 100 : undefined
  );
  if (value === undefined) return;
  const maxUses = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_max_uses_prompt'),
    t(ctx, 'admin_invalid_promo_max_uses')
  );
  if (maxUses === undefined) return;
  const maxUsesPerUser = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_per_user_prompt'),
    t(ctx, 'admin_invalid_promo_per_user'),
    maxUses
  );
  if (maxUsesPerUser === undefined) return;
  const minPurchaseAmount = await promptPromoNonNegativeNumber(conversation, ctx);
  if (minPurchaseAmount === undefined) return;

  let maxDiscountAmount: number | null | undefined = null;
  if (type === 'discount_percent') {
    maxDiscountAmount = await promptPromoMaxDiscountAmount(conversation, ctx);
    if (maxDiscountAmount === undefined) return;
  }
  const firstPurchaseOnly = await promptPromoFirstPurchaseOnly(conversation, ctx, false);
  if (firstPurchaseOnly === undefined) return;
  const expiresAt = await promptPromoExpiry(conversation, ctx);
  if (expiresAt === undefined) return;

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_save_confirm_button'), 'promo-bulk-save:confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '⚡',
      title: t(ctx, 'admin_promo_bulk_title'),
      primary: {
        emoji: '🔢',
        label: t(ctx, 'admin_promo_total_label'),
        value: localizedNumber(count, ctx),
      },
      sections: [
        {
          emoji: '⚙️',
          title: t(ctx, 'admin_promo_configuration_section'),
          fields: [
            { label: t(ctx, 'admin_promo_type_label'), value: promoTypeLabel(ctx, type) },
            { label: t(ctx, 'admin_promo_value_label'), value: localizedNumber(value, ctx) },
            ...(type === 'discount_percent'
              ? [
                  {
                    label: t(ctx, 'admin_promo_max_discount_label'),
                    value: maxDiscountAmount
                      ? `${localizedNumber(maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                      : t(ctx, 'admin_promo_no_cap'),
                  },
                ]
              : []),
            {
              label: t(ctx, 'admin_promo_first_purchase_label'),
              value: firstPurchaseOnly
                ? t(ctx, 'admin_promo_first_purchase_yes')
                : t(ctx, 'admin_promo_first_purchase_no'),
            },
            {
              label: t(ctx, 'admin_promo_min_purchase_label'),
              value: `${localizedNumber(minPurchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_promo_expiry_label'),
              value: expiresAt
                ? localizedDate(expiresAt, ctx)
                : t(ctx, 'admin_promo_never_expires'),
            },
          ],
        },
      ],
      footer: t(ctx, 'admin_promo_save_consequence'),
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const confirmation = await waitForAdminCallbackInput(conversation, ['promo-bulk-save:confirm']);
  if (!confirmation) return;

  try {
    const codes = await ctx.services.promoService.createBulkPromoCodes({
      count,
      prefix: prefix || undefined,
      type,
      value,
      maxUses,
      maxUsesPerUser,
      minPurchaseAmount,
      maxDiscountAmount,
      firstPurchaseOnly,
      expiresAt,
    });

    const codeList = codes.map((c) => `\`${c}\``).join('\n');
    await replyInAdminConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_promo_bulk_title'),
        subtitle: t(ctx, 'admin_promo_bulk_success', { count: localizedNumber(codes.length, ctx) }),
        sections: [
          {
            emoji: '📋',
            title: t(ctx, 'admin_promo_bulk_copy_hint'),
            fields: [
              {
                emoji: '🎟️',
                label: t(ctx, 'admin_promo_total_label'),
                value: localizedNumber(codes.length, ctx),
              },
            ],
          },
        ],
        footer: codeList,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          t(ctx, 'admin_promo_back_to_list'),
          callbackData('promo', 'list')
        ),
      }
    );
  } catch (err) {
    logger.warn({ err }, 'Promo bulk creation failed');
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_promo_bulk_title'), t(ctx, 'admin_promo_create_failed')),
      { parse_mode: 'Markdown' }
    );
  }
}

type ExistingPromo = Awaited<
  ReturnType<NonNullable<ConversationContext['services']>['promoService']['getPromoCodeById']>
>;

async function runPromoEditor(
  conversation: MyConversation,
  ctx: ConversationContext,
  code: string,
  existing?: ExistingPromo
): Promise<void> {
  if (!ctx.services) return;
  const type = await promptPromoType(conversation, ctx);
  if (!type) return;
  const value = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_value_prompt'),
    t(ctx, 'admin_invalid_promo_value'),
    type === 'discount_percent' ? 100 : undefined
  );
  if (value === undefined) return;
  const maxUses = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_max_uses_prompt'),
    t(ctx, 'admin_invalid_promo_max_uses')
  );
  if (maxUses === undefined) return;
  const maxUsesPerUser = await promptPromoPositiveNumber(
    conversation,
    ctx,
    t(ctx, 'admin_promo_per_user_prompt'),
    t(ctx, 'admin_invalid_promo_per_user'),
    maxUses
  );
  if (maxUsesPerUser === undefined) return;
  const minPurchaseAmount = await promptPromoNonNegativeNumber(conversation, ctx);
  if (minPurchaseAmount === undefined) return;

  let maxDiscountAmount: number | null | undefined = null;
  if (type === 'discount_percent') {
    maxDiscountAmount = await promptPromoMaxDiscountAmount(
      conversation,
      ctx,
      existing?.maxDiscountAmount
    );
    if (maxDiscountAmount === undefined) return;
  }

  const firstPurchaseOnly = await promptPromoFirstPurchaseOnly(
    conversation,
    ctx,
    existing?.firstPurchaseOnly ?? false
  );
  if (firstPurchaseOnly === undefined) return;

  const expiresAt = await promptPromoExpiry(conversation, ctx);
  if (expiresAt === undefined) return;
  const active = await promptPromoActive(conversation, ctx, existing?.active ?? true);
  if (active === undefined) return;

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_save_confirm_button'), 'promo-save:confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '🎟️',
      title: t(ctx, 'admin_promo_detail_title'),
      subtitle: escapeTelegramMarkdown(code),
      primary: {
        emoji: active ? '🟢' : '⚪️',
        label: t(ctx, 'admin_promo_status_label'),
        value: buildStatusBadge(
          ctx,
          active ? 'active' : 'inactive',
          t(ctx, active ? 'admin_promo_active' : 'admin_promo_inactive')
        ),
      },
      sections: [
        {
          emoji: '⚙️',
          title: t(ctx, 'admin_promo_configuration_section'),
          fields: [
            { label: t(ctx, 'admin_promo_type_label'), value: promoTypeLabel(ctx, type) },
            { label: t(ctx, 'admin_promo_value_label'), value: localizedNumber(value, ctx) },
            ...(type === 'discount_percent'
              ? [
                  {
                    label: t(ctx, 'admin_promo_max_discount_label'),
                    value: maxDiscountAmount
                      ? `${localizedNumber(maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                      : t(ctx, 'admin_promo_no_cap'),
                  },
                ]
              : []),
            {
              label: t(ctx, 'admin_promo_first_purchase_label'),
              value: firstPurchaseOnly
                ? t(ctx, 'admin_promo_first_purchase_yes')
                : t(ctx, 'admin_promo_first_purchase_no'),
            },
            {
              label: t(ctx, 'admin_promo_min_purchase_label'),
              value: `${localizedNumber(minPurchaseAmount, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_promo_expiry_label'),
              value: expiresAt
                ? localizedDate(expiresAt, ctx)
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
              value: localizedNumber(maxUses, ctx),
            },
            {
              label: t(ctx, 'admin_promo_per_user_label'),
              value: localizedNumber(maxUsesPerUser, ctx),
            },
          ],
        },
      ],
      footer: t(ctx, 'admin_promo_save_consequence'),
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );
  const confirmation = await waitForAdminCallbackInput(conversation, ['promo-save:confirm']);
  if (!confirmation) return;

  try {
    await ctx.services.promoService.createPromoCode({
      code,
      type,
      value,
      maxUses,
      maxUsesPerUser,
      minPurchaseAmount,
      maxDiscountAmount,
      firstPurchaseOnly,
      expiresAt,
    });
    const saved = await ctx.services.promoService.getPromoCode(code);
    if (!saved) throw new Error('PROMO_SAVE_READBACK_FAILED');
    if (saved.active !== active) {
      await ctx.services.promoService.setPromoActiveById(saved.id, active);
    }
    await replyInAdminConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_promo_detail_title'),
        primary: {
          emoji: '🎟️',
          label: t(ctx, 'checkout_promo_section'),
          value: escapeTelegramMarkdown(code),
        },
        footer: t(ctx, existing ? 'admin_promo_updated' : 'admin_promo_created', {
          code: escapeTelegramMarkdown(code),
        }),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_promo_open_button'), callbackData('promo', 'open', saved.id))
          .row()
          .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list')),
      }
    );
  } catch (err) {
    logger.warn({ err, code }, 'Promo admin save failed');
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_promo_create_failed')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoCode(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<string | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🎟️',
        t(ctx, 'admin_promo_center_title'),
        t(ctx, 'admin_promo_code_prompt'),
        t(ctx, 'admin_promo_center_subtitle')
      ),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const code = input
      .trim()
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
      .toUpperCase();
    if (/^[A-Z0-9_-]{3,128}$/u.test(code)) return code;
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_promo_center_title'), t(ctx, 'admin_promo_code_invalid')),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoType(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PromoType | undefined> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_type_percent'), 'promo-type:discount_percent')
    .text(t(ctx, 'admin_promo_type_fixed'), 'promo-type:discount_fixed')
    .row()
    .text(t(ctx, 'admin_promo_type_credit'), 'promo-type:gift_credit')
    .text(t(ctx, 'admin_promo_type_gb'), 'promo-type:gift_gb')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '⚙️',
      t(ctx, 'admin_promo_detail_title'),
      t(ctx, 'admin_promo_type_prompt'),
      t(ctx, 'admin_promo_center_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const data = await waitForAdminCallbackInput(conversation, ['promo-type:']);
  if (!data) return undefined;
  const type = data.slice('promo-type:'.length);
  return ['discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb'].includes(type)
    ? (type as PromoType)
    : undefined;
}

async function promptPromoPositiveNumber(
  conversation: MyConversation,
  ctx: ConversationContext,
  prompt: string,
  invalid: string,
  maximum = 2_147_483_647
): Promise<number | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen('🔢', t(ctx, 'admin_promo_detail_title'), prompt),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const value = parsePositiveSafeInteger(input);
    if (value !== undefined && value <= maximum) return value;
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_promo_detail_title'), invalid),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoNonNegativeNumber(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🔢',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_promo_min_purchase_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const normalized = input
      .trim()
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,_،٬\s]/gu, '');
    if (/^\d+$/u.test(normalized)) {
      const value = Number(normalized);
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_invalid_promo_min_purchase')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoMaxDiscountAmount(
  conversation: MyConversation,
  ctx: ConversationContext,
  _current?: number | null
): Promise<number | null | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🛑',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_promo_max_discount_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,_،٬\s]/gu, '');
    if (['0', 'none', 'بدون', 'no'].includes(normalized)) return null;
    if (/^\d+$/u.test(normalized)) {
      const value = Number(normalized);
      if (Number.isSafeInteger(value) && value >= 0) return value === 0 ? null : value;
    }
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_promo_invalid_max_discount')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoFirstPurchaseOnly(
  conversation: MyConversation,
  ctx: ConversationContext,
  _current = false
): Promise<boolean | undefined> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_first_purchase_yes'), 'promo-first-purchase:true')
    .text(t(ctx, 'admin_promo_first_purchase_no'), 'promo-first-purchase:false')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '✨',
      t(ctx, 'admin_promo_detail_title'),
      t(ctx, 'admin_promo_first_purchase_prompt')
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const data = await waitForAdminCallbackInput(conversation, ['promo-first-purchase:']);
  return data === 'promo-first-purchase:true'
    ? true
    : data === 'promo-first-purchase:false'
      ? false
      : undefined;
}

async function promptPromoBulkPrefix(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<string | undefined> {
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '🏷️',
      t(ctx, 'admin_promo_bulk_title'),
      t(ctx, 'admin_promo_bulk_prefix_prompt')
    ),
    { parse_mode: 'Markdown' }
  );
  const input = await waitForAdminTextInput(conversation);
  if (input === undefined) return undefined;
  const trimmed = input
    .trim()
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase();
  if (['0', 'none', 'بدون', 'no'].includes(trimmed.toLowerCase())) return '';
  return trimmed.replace(/[^A-Z0-9_-]/gu, '').slice(0, 16);
}

async function promptPromoBulkCount(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🔢',
        t(ctx, 'admin_promo_bulk_title'),
        t(ctx, 'admin_promo_bulk_count_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const normalized = input
      .trim()
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,_،٬\s]/gu, '');
    if (/^\d+$/u.test(normalized)) {
      const value = Number(normalized);
      if (Number.isSafeInteger(value) && value >= 1 && value <= 50) return value;
    }
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_bulk_title'),
        t(ctx, 'admin_promo_bulk_invalid_count')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoExpiry(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<Date | null | undefined> {
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '📅',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_promo_expiry_prompt')
      ),
      { parse_mode: 'Markdown' }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const value = input
      .trim()
      .toLowerCase()
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
    if (['0', 'never', 'none', 'بدون'].includes(value)) return null;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      const date = new Date(`${value}T23:59:59.999Z`);
      if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) return date;
    }
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_promo_detail_title'),
        t(ctx, 'admin_invalid_promo_expiry')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

async function promptPromoActive(
  conversation: MyConversation,
  ctx: ConversationContext,
  current: boolean
): Promise<boolean | undefined> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_promo_active'), 'promo-active:true')
    .text(t(ctx, 'admin_promo_inactive'), 'promo-active:false')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '⚙️',
      title: t(ctx, 'admin_promo_detail_title'),
      primary: {
        emoji: current ? '🟢' : '⚪️',
        label: t(ctx, 'admin_promo_status_label'),
        value: buildStatusBadge(
          ctx,
          current ? 'active' : 'inactive',
          t(ctx, current ? 'admin_promo_active' : 'admin_promo_inactive')
        ),
      },
      footer: t(ctx, 'admin_promo_active_prompt', {
        active: t(ctx, current ? 'admin_promo_active' : 'admin_promo_inactive'),
      }),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const data = await waitForAdminCallbackInput(conversation, ['promo-active:']);
  return data === 'promo-active:true' ? true : data === 'promo-active:false' ? false : undefined;
}

function promoTypeLabel(ctx: ConversationContext, type: PromoType): string {
  const key =
    type === 'discount_percent'
      ? 'admin_promo_type_percent'
      : type === 'discount_fixed'
        ? 'admin_promo_type_fixed'
        : type === 'gift_credit'
          ? 'admin_promo_type_credit'
          : 'admin_promo_type_gb';
  return t(ctx, key);
}
