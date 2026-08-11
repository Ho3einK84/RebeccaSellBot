import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import type { PromoType } from '../../../domain/services/PromoService.js';
import { callbackData } from '../../callbackData.js';
import {
  promptInConversation,
  replyInConversation,
  waitForCallbackInput,
  waitForTextInput,
} from '../../ui.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';

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
    await replyInConversation(conversation, ctx, t(ctx, 'admin_promo_not_found'));
    return;
  }
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_promo_not_found'));
    return;
  }
  await runPromoEditor(conversation, ctx, promo.code, promo);
}

export async function adminSearchPromoConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_search_prompt'));
  const input = await waitForTextInput(conversation);
  if (input === undefined) return;
  const result = await ctx.services.promoService.listCodes(1, 10, input);
  if (result.items.length === 0) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_no_promo_codes'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'))
        .row()
        .text(t(ctx, 'menu_back'), 'nav:admin'),
    });
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const promo of result.items) {
    keyboard
      .text(`${promo.active ? '🟢' : '⚪'} ${promo.code}`, callbackData('promo', 'open', promo.id))
      .row();
  }
  keyboard
    .text(t(ctx, 'admin_promo_back_to_list'), callbackData('promo', 'list'))
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await replyInConversation(
    conversation,
    ctx,
    t(ctx, 'admin_promo_search_results', { count: localizedNumber(result.total, ctx) }),
    { reply_markup: keyboard }
  );
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
    tm(ctx, 'admin_promo_save_summary', {
      code,
      type: promoTypeLabel(ctx, type),
      value: localizedNumber(value, ctx),
      max_uses: localizedNumber(maxUses, ctx),
      max_uses_per_user: localizedNumber(maxUsesPerUser, ctx),
      min_purchase_amount: localizedNumber(minPurchaseAmount, ctx),
      expires_at: expiresAt ? localizedDate(expiresAt, ctx) : t(ctx, 'admin_promo_never_expires'),
      active: t(ctx, active ? 'admin_promo_active' : 'admin_promo_inactive'),
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );
  const confirmation = await waitForCallbackInput(conversation, ['promo-save:confirm']);
  if (!confirmation) return;

  try {
    await ctx.services.promoService.createPromoCode({
      code,
      type,
      value,
      maxUses,
      maxUsesPerUser,
      minPurchaseAmount,
      expiresAt,
    });
    const saved = await ctx.services.promoService.getPromoCode(code);
    if (!saved) throw new Error('PROMO_SAVE_READBACK_FAILED');
    if (saved.active !== active) {
      await ctx.services.promoService.setPromoActiveById(saved.id, active);
    }
    await replyInConversation(
      conversation,
      ctx,
      tm(ctx, existing ? 'admin_promo_updated' : 'admin_promo_created', { code }),
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
    await replyInConversation(conversation, ctx, t(ctx, 'admin_promo_create_failed'));
  }
}

async function promptPromoCode(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<string | undefined> {
  for (;;) {
    await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_code_prompt'));
    const input = await waitForTextInput(conversation);
    if (input === undefined) return undefined;
    const code = input.trim().toUpperCase();
    if (/^[A-Z0-9_-]{3,128}$/u.test(code)) return code;
    await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_code_invalid'));
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
  await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_type_prompt'), {
    reply_markup: keyboard,
  });
  const data = await waitForCallbackInput(conversation, ['promo-type:']);
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
    await promptInConversation(conversation, ctx, prompt);
    const input = await waitForTextInput(conversation);
    if (input === undefined) return undefined;
    const value = parsePositiveSafeInteger(input);
    if (value !== undefined && value <= maximum) return value;
    await promptInConversation(conversation, ctx, invalid);
  }
}

async function promptPromoNonNegativeNumber(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  for (;;) {
    await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_min_purchase_prompt'));
    const input = await waitForTextInput(conversation);
    if (input === undefined) return undefined;
    if (/^\d+$/u.test(input.trim())) {
      const value = Number(input.trim());
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    await promptInConversation(conversation, ctx, t(ctx, 'admin_invalid_promo_min_purchase'));
  }
}

async function promptPromoExpiry(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<Date | null | undefined> {
  for (;;) {
    await promptInConversation(conversation, ctx, t(ctx, 'admin_promo_expiry_prompt'));
    const input = await waitForTextInput(conversation);
    if (input === undefined) return undefined;
    const value = input.trim().toLowerCase();
    if (['0', 'never', 'none', 'بدون'].includes(value)) return null;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      const date = new Date(`${value}T23:59:59.999Z`);
      if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) return date;
    }
    await promptInConversation(conversation, ctx, t(ctx, 'admin_invalid_promo_expiry'));
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
    t(ctx, 'admin_promo_active_prompt', {
      active: t(ctx, current ? 'admin_promo_active' : 'admin_promo_inactive'),
    }),
    { reply_markup: keyboard }
  );
  const data = await waitForCallbackInput(conversation, ['promo-active:']);
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
