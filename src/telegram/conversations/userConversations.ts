/**
 * User-facing conversations.
 *
 * buyConfigConversation  — package picker (redirected from shop menu for custom amounts)
 * customAmountConversation — free-form GB + days entry
 * promoConversation      — promo/gift code redemption
 */
import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../types.js';
import { clearPendingPromo, getPendingPromoPricing } from '../promoSelection.js';
import { purchaseFailureMessage } from '../purchaseFeedback.js';
import {
  formatSubscriptionLink,
  localizedNumber,
  localizedNumberForLocale,
  normalizeInputDigits,
  resolveContextLocale,
  t,
  tForLocale,
} from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  promptInConversation,
  rememberArtifactMessage,
  replyInConversation,
  sendArtifactInConversation,
  waitForCallbackInput,
  waitForTextInput,
} from '../ui.js';
import { logger } from '../../infra/logger.js';
import { recordCheckoutCompleted, recordCheckoutFailed } from '../checkoutLifecycle.js';
import {
  customVolumeEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../domain/services/FeatureSettings.js';
import {
  PurchaseCheckoutUnavailableError,
  type PurchaseCheckout,
} from '../../domain/services/PurchaseCheckoutService.js';

async function requireCustomVolume(
  conversation: MyConversation,
  ctx: ConversationContext,
  clearRenewalSession = false
): Promise<boolean> {
  const enabled = await conversation.external((outsideCtx) => {
    const isEnabled =
      !!outsideCtx.services && customVolumeEnabled(outsideCtx.services.translationService);
    if (!isEnabled && clearRenewalSession) {
      outsideCtx.session.renewConfigUsername = undefined;
    }
    return isEnabled;
  });
  if (!enabled) {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_volume_unavailable'));
  }
  return enabled;
}

function customPackageName(
  ctx: ConversationContext,
  gbAmount: number,
  durationDays: number
): string {
  return t(ctx, 'custom_package_name', {
    gb: localizedNumber(gbAmount, ctx),
    days: localizedNumber(durationDays, ctx),
  });
}

function buildCustomVolumeInputScreen(ctx: ConversationContext): string {
  return buildScreen({
    emoji: '✏️',
    title: t(ctx, 'custom_volume_title'),
    subtitle: t(ctx, 'custom_volume_subtitle'),
    footer: `ℹ️ ${t(ctx, 'custom_volume_input_hint')}`,
  });
}

function buildCustomCheckoutScreen(
  ctx: ConversationContext,
  input: {
    mode: 'purchase' | 'renewal';
    username?: string;
    gbAmount: number;
    durationDays: number;
    amount: number;
    pricePerGb: number;
    promoCode?: string;
  }
): string {
  const renewal = input.mode === 'renewal';
  return buildScreen({
    emoji: renewal ? '🔄' : '🛒',
    title: t(ctx, renewal ? 'renewal_review_title' : 'purchase_review_title'),
    subtitle: t(ctx, renewal ? 'renewal_review_subtitle' : 'purchase_review_subtitle'),
    primary: {
      emoji: '💰',
      label: t(ctx, 'checkout_total_label'),
      value: `${localizedNumber(input.amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      ...(input.username
        ? [
            {
              emoji: '📱',
              title: t(ctx, 'checkout_service_label'),
              fields: [
                {
                  emoji: '🆔',
                  label: t(ctx, 'checkout_service_label'),
                  value: `\`${sanitizeTelegramInlineCode(input.username)}\``,
                },
              ],
            },
          ]
        : []),
      {
        emoji: '📦',
        title: t(ctx, 'checkout_package_section'),
        fields: [
          {
            emoji: '📦',
            label: t(ctx, 'renewal_success_package_label'),
            value: customPackageName(ctx, input.gbAmount, input.durationDays),
          },
          {
            emoji: '📊',
            label: t(ctx, 'checkout_traffic_label'),
            value: `${localizedNumber(input.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            emoji: '⏳',
            label: t(ctx, 'checkout_duration_label'),
            value: `${localizedNumber(input.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            emoji: '💳',
            label: t(ctx, 'checkout_unit_price_label'),
            value: `${localizedNumber(input.pricePerGb, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      ...(input.promoCode
        ? [
            {
              emoji: '🎟️',
              title: t(ctx, 'checkout_promo_section'),
              fields: [
                {
                  emoji: '🎟️',
                  label: t(ctx, 'shop_promo_section'),
                  value: `\`${sanitizeTelegramInlineCode(input.promoCode)}\``,
                },
              ],
            },
          ]
        : []),
    ],
    footer: `ℹ️ ${t(ctx, renewal ? 'checkout_confirmation_hint' : 'purchase_confirmation_hint')}`,
  });
}

// ── Shared helper ─────────────────────────────────────────────────────────────

async function executePurchaseFlow(
  conversation: MyConversation,
  ctx: ConversationContext,
  gbAmount: number,
  durationDays: number
) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  // Pricing rules live in settings and are evaluated server-side. The
  // confirmation uses the same base amount that the wallet saga receives;
  // promo settlement remains authoritative inside the saga transaction.
  const customQuote = ctx.services.pricingService.getCustomPriceQuote(gbAmount, durationDays);
  const pricePerGb = customQuote.pricePerGb;
  const totalCost = customQuote.totalPrice;

  const pendingPromo = await conversation.external((outsideCtx) =>
    getPendingPromoPricing(outsideCtx, telegramId, totalCost, gbAmount)
  );
  if (pendingPromo.messageKey) {
    await replyInConversation(conversation, ctx, t(ctx, pendingPromo.messageKey));
    return;
  }
  const displayedCost = pendingPromo.quote?.finalAmount ?? totalCost;

  const balance = await ctx.services.walletService.getBalance(telegramId);
  if (balance < displayedCost) {
    await replyInConversation(conversation, ctx, t(ctx, 'insufficient_balance'));
    return;
  }

  const packageNameStr = customPackageName(ctx, gbAmount, durationDays);
  const target = ctx.services.pricingService.getCustomVolumeTarget();
  let checkout: PurchaseCheckout;
  let res: { configUsername: string; subUrl?: string };
  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.create({
        telegramId,
        kind: 'new_config',
        pkg: {
          id: `custom_${gbAmount}gb_${durationDays}d`,
          name: packageNameStr,
          gbAmount,
          durationDays,
          price: totalCost,
        },
        ...target,
        promoCode: pendingPromo.promoCode,
        quotedAmount: displayedCost,
      })
    );
  } catch {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_volume_unavailable'));
    return;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'buy_confirm_button'), 'buy_confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildCustomCheckoutScreen(ctx, {
      mode: 'purchase',
      gbAmount,
      durationDays,
      amount: displayedCost,
      pricePerGb,
      promoCode: pendingPromo.quote?.code,
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: confirmKeyboard,
    }
  );

  const confirmChoice = await waitForCallbackInput(conversation, ['buy_confirm']);
  if (confirmChoice === undefined) return;
  // Re-check after confirmation: an admin may disable custom volume while the
  // conversation is waiting. Never reach the purchase saga in that case.
  if (!(await requireCustomVolume(conversation, ctx))) return;

  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.claim(checkout.id, telegramId)
    );
  } catch (error) {
    await replyInConversation(
      conversation,
      ctx,
      t(
        ctx,
        error instanceof PurchaseCheckoutUnavailableError
          ? 'purchase_confirmation_expired'
          : 'operation_failed'
      )
    );
    return;
  }
  const progressMessage = await replyInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '⏳',
      title: t(ctx, 'purchase_issuing_title'),
      subtitle: t(ctx, 'purchase_issuing_subtitle'),
      primary: {
        emoji: '📦',
        label: t(ctx, 'purchase_issuing_package_label'),
        value: escapeTelegramMarkdown(packageNameStr),
      },
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'operation_in_progress'), 'ui:noop'),
    }
  );

  try {
    const configName = await ctx.services.configService.generateConfigName(
      telegramId,
      checkout.panelId
    );
    // This is the authoritative last check: no awaited work may occur between
    // it and entering the purchase saga.
    if (!(await requireCustomVolume(conversation, ctx))) {
      await conversation.external((outsideCtx) =>
        recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
      );
      return;
    }
    res = await ctx.services.walletService.executePurchaseSaga({
      telegramId,
      amount: checkout.amount,
      maxAmount: checkout.quotedAmount,
      type: 'new_config',
      configUsername: configName,
      gbAmount: checkout.gbAmount,
      durationDays: checkout.durationDays,
      panelId: checkout.panelId,
      serviceId: checkout.serviceId,
      checkoutId: checkout.id,
      ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
    });
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
    );
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      buildEmptyState(
        '⚠️',
        t(ctx, 'purchase_failed_title'),
        purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back_main'), 'nav:main'),
      }
    );
    return;
  }

  await conversation.external((outsideCtx) =>
    recordCheckoutCompleted(outsideCtx.services!.purchaseCheckoutService, checkout.id)
  );
  if (checkout.promoCode) {
    await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
  }

  const successText = buildScreen({
    emoji: '🎉',
    title: t(ctx, 'purchase_success_title'),
    subtitle: t(ctx, 'purchase_success_subtitle'),
    primary: {
      emoji: '🔗',
      label: t(ctx, 'purchase_success_link_label'),
      value: formatSubscriptionLink(res.subUrl, t(ctx, 'subscription_link_unavailable')),
    },
  });
  try {
    const createdMsg = await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      successText,
      { parse_mode: 'Markdown' }
    );
    if (typeof createdMsg === 'object' && createdMsg && 'message_id' in createdMsg) {
      await conversation.external((outsideCtx) => {
        rememberArtifactMessage(outsideCtx.session, createdMsg.message_id);
      });
    }
  } catch (err) {
    logger.warn(
      { errorName: err instanceof Error ? err.name : typeof err, checkoutId: checkout.id },
      'Custom purchase succeeded but its progress message could not be edited'
    );
    await sendArtifactInConversation(conversation, ctx, successText, { parse_mode: 'Markdown' });
  }
  await replyInConversation(conversation, ctx, t(ctx, 'navigation_continue_hint'), {
    reply_markup: new InlineKeyboard()
      .text(t(ctx, 'menu_my_configs'), 'subs:page:1')
      .row()
      .text(t(ctx, 'menu_back_main'), 'nav:main'),
  });
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function buyConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!ctx.from?.id || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx))) return;

  let gbAmount: number | undefined;
  while (gbAmount === undefined) {
    await promptInConversation(conversation, ctx, buildCustomVolumeInputScreen(ctx), {
      parse_mode: 'Markdown',
    });
    const gbInput = await waitForTextInput(conversation);
    if (gbInput === undefined) return;
    const trimmed = normalizeInputDigits(gbInput);
    if (!/^[1-9]\d*$/.test(trimmed)) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'custom_volume_title'), t(ctx, 'custom_gb_invalid')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    const val = Number(trimmed);
    if (!Number.isSafeInteger(val) || val < 1 || val > 10_000) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'custom_volume_title'),
          t(ctx, 'custom_gb_invalid_range', {
            min: localizedNumber(1, ctx),
            max: localizedNumber(10_000, ctx),
          })
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    gbAmount = val;
  }

  // The custom volume flow no longer asks for a duration. It reuses the
  // admin-configured default subscription length rather than prompting the
  // user for a separate duration input.
  await executePurchaseFlow(conversation, ctx, gbAmount, customDurationDays(ctx));
}

export async function customAmountConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!ctx.from?.id || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx))) return;

  let gbAmount: number | undefined;
  while (gbAmount === undefined) {
    await promptInConversation(conversation, ctx, buildCustomVolumeInputScreen(ctx), {
      parse_mode: 'Markdown',
    });
    const gbInput = await waitForTextInput(conversation);
    if (gbInput === undefined) return;
    const trimmed = normalizeInputDigits(gbInput);
    if (!/^[1-9]\d*$/.test(trimmed)) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'custom_volume_title'), t(ctx, 'custom_gb_invalid')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    const val = Number(trimmed);
    if (!Number.isSafeInteger(val) || val < 1 || val > 10_000) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'custom_volume_title'),
          t(ctx, 'custom_gb_invalid_range', {
            min: localizedNumber(1, ctx),
            max: localizedNumber(10_000, ctx),
          })
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    gbAmount = val;
  }

  // Use the admin-configured default duration instead of asking the user.
  await executePurchaseFlow(conversation, ctx, gbAmount, customDurationDays(ctx));
}

export async function renewConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  const configId = await conversation.external(
    (outsideCtx) => outsideCtx.session.renewConfigId as string | undefined
  );
  const config = configId
    ? await conversation.external((outsideCtx) =>
        outsideCtx.services!.configService.getOwnedConfigById(telegramId, configId)
      )
    : undefined;
  if (!config) {
    await replyInConversation(conversation, ctx, t(ctx, 'user_not_found'));
    return;
  }

  // Step 1: prompt for a custom traffic quota in the same structured flow with retry loop.
  let gbAmount: number | undefined;
  while (gbAmount === undefined) {
    await promptInConversation(conversation, ctx, buildCustomVolumeInputScreen(ctx), {
      parse_mode: 'Markdown',
    });
    const gbInput = await waitForTextInput(conversation);
    if (gbInput === undefined) return;
    const trimmed = normalizeInputDigits(gbInput);
    if (!/^[1-9]\d*$/.test(trimmed)) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'custom_volume_title'), t(ctx, 'custom_gb_invalid')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    const val = Number(trimmed);
    if (!Number.isSafeInteger(val) || val < 1 || val > 10_000) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'custom_volume_title'),
          t(ctx, 'custom_gb_invalid_range', {
            min: localizedNumber(1, ctx),
            max: localizedNumber(10_000, ctx),
          })
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    gbAmount = val;
  }

  // Use the admin-configured default duration instead of prompting for custom days
  const durationDays = customDurationDays(ctx);

  const customQuote = ctx.services.pricingService.getCustomPriceQuote(gbAmount, durationDays);
  const pricePerGb = customQuote.pricePerGb;
  const totalCost = customQuote.totalPrice;

  const pendingPromo = await conversation.external((outsideCtx) =>
    getPendingPromoPricing(outsideCtx, telegramId, totalCost, gbAmount)
  );
  if (pendingPromo.messageKey) {
    await replyInConversation(conversation, ctx, t(ctx, pendingPromo.messageKey));
    return;
  }
  const displayedCost = pendingPromo.quote?.finalAmount ?? totalCost;

  const balance = await ctx.services.walletService.getBalance(telegramId);
  if (balance < displayedCost) {
    await replyInConversation(conversation, ctx, t(ctx, 'insufficient_balance'));
    return;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'renew_confirm_button'), 'renew_confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  let checkout: PurchaseCheckout;
  let res: { configUsername: string; subUrl?: string };
  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.create({
        telegramId,
        kind: 'renew_config',
        configId: config.id,
        pkg: {
          id: `custom_${gbAmount}gb_${durationDays}d`,
          name: customPackageName(ctx, gbAmount, durationDays),
          gbAmount,
          durationDays,
          price: totalCost,
        },
        panelId: config.panelId,
        serviceId: config.serviceId,
        promoCode: pendingPromo.promoCode,
        quotedAmount: displayedCost,
      })
    );
  } catch {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_volume_unavailable'));
    return;
  }

  await promptInConversation(
    conversation,
    ctx,
    buildCustomCheckoutScreen(ctx, {
      mode: 'renewal',
      username: config.configUsername,
      gbAmount,
      durationDays,
      amount: displayedCost,
      pricePerGb,
      promoCode: pendingPromo.quote?.code,
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const confirmChoice = await waitForCallbackInput(conversation, ['renew_confirm']);
  if (confirmChoice === undefined) return;
  // Close stale conversations if the switch changed while awaiting confirmation.
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.claim(checkout.id, telegramId)
    );
  } catch (error) {
    await replyInConversation(
      conversation,
      ctx,
      t(
        ctx,
        error instanceof PurchaseCheckoutUnavailableError
          ? 'purchase_confirmation_expired'
          : 'operation_failed'
      )
    );
    return;
  }

  const progressMessage = await replyInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '⏳',
      title: t(ctx, 'renewal_processing_title'),
      subtitle: t(ctx, 'renewal_processing_subtitle'),
      primary: {
        emoji: '📱',
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
      },
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'operation_in_progress'), 'ui:noop'),
    }
  );

  try {
    // This is the authoritative last check: no awaited work may occur between
    // it and entering the purchase saga.
    if (!(await requireCustomVolume(conversation, ctx, true))) {
      await conversation.external((outsideCtx) =>
        recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
      );
      return;
    }
    const isAdmin = Boolean(
      ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
    );
    res = await ctx.services.walletService.executePurchaseSaga({
      telegramId,
      amount: checkout.amount,
      maxAmount: checkout.quotedAmount,
      type: 'renew_config',
      configUsername: config.configUsername,
      gbAmount: checkout.gbAmount,
      durationDays: checkout.durationDays,
      panelId: checkout.panelId,
      serviceId: checkout.serviceId,
      checkoutId: checkout.id,
      ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
      allowAdminOverride: isAdmin,
    });
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
    );
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      buildEmptyState(
        '⚠️',
        t(ctx, 'renewal_failed_title'),
        purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back'), 'subs:page:1'),
      }
    );
    return;
  }

  await conversation.external((outsideCtx) =>
    recordCheckoutCompleted(outsideCtx.services!.purchaseCheckoutService, checkout.id)
  );
  if (checkout.promoCode) {
    await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
  }

  const renewalSuccessText = buildScreen({
    emoji: '✅',
    title: t(ctx, 'renewal_success_title'),
    subtitle: t(ctx, 'renewal_success_subtitle'),
    primary: {
      emoji: '📱',
      label: t(ctx, 'renewal_success_service_label'),
      value: `\`${sanitizeTelegramInlineCode(res.configUsername)}\``,
    },
    sections: [
      {
        emoji: '📦',
        title: t(ctx, 'checkout_package_section'),
        fields: [
          {
            label: t(ctx, 'renewal_success_package_label'),
            value: customPackageName(ctx, gbAmount, durationDays),
          },
        ],
      },
    ],
  });
  try {
    await ctx.api.editMessageText(ctx.chat!.id, progressMessage.message_id, renewalSuccessText, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back'), 'subs:page:1'),
    });
  } catch (err) {
    logger.warn(
      { errorName: err instanceof Error ? err.name : typeof err, checkoutId: checkout.id },
      'Custom renewal succeeded but its progress message could not be edited'
    );
    await replyInConversation(conversation, ctx, renewalSuccessText, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back'), 'subs:page:1'),
    });
  }
}

export async function autoRenewCustomConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  const configId = await conversation.external((outsideCtx) => {
    const pendingConfigId = outsideCtx.session.pendingConfigId as string | undefined;
    delete outsideCtx.session.pendingConfigId;
    return pendingConfigId;
  });
  if (!configId) {
    await replyInConversation(conversation, ctx, t(ctx, 'user_not_found'));
    return;
  }

  const config = await conversation.external((outsideCtx) =>
    outsideCtx.services!.configService.getOwnedConfigById(telegramId, configId)
  );
  if (!config) {
    await replyInConversation(conversation, ctx, t(ctx, 'user_not_found'));
    return;
  }

  // Step 1: prompt for a custom traffic quota in the same structured flow with retry loop.
  let gbAmount: number | undefined;
  while (gbAmount === undefined) {
    await promptInConversation(conversation, ctx, buildCustomVolumeInputScreen(ctx), {
      parse_mode: 'Markdown',
    });
    const gbInput = await waitForTextInput(conversation);
    if (gbInput === undefined) return;
    const trimmed = normalizeInputDigits(gbInput);
    if (!/^[1-9]\d*$/.test(trimmed)) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'custom_volume_title'), t(ctx, 'custom_gb_invalid')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    const val = Number(trimmed);
    if (!Number.isSafeInteger(val) || val < 1 || val > 10_000) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'custom_volume_title'),
          t(ctx, 'custom_gb_invalid_range', {
            min: localizedNumber(1, ctx),
            max: localizedNumber(10_000, ctx),
          })
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    gbAmount = val;
  }

  const durationDays = customDurationDays(ctx);
  const customPackageId = `custom_${gbAmount}gb_${durationDays}d`;
  const approvedPrice = ctx.services.pricingService.getCustomPriceQuote(
    gbAmount,
    durationDays
  ).totalPrice;

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '♻️',
      title: t(ctx, 'auto_renew_review_title'),
      subtitle: t(ctx, 'auto_renew_review_subtitle'),
      primary: {
        emoji: '💰',
        label: t(ctx, 'auto_renew_charge_label'),
        value: `${localizedNumber(approvedPrice, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '📱',
          title: t(ctx, 'renewal_selection_service_label'),
          fields: [
            {
              emoji: '🆔',
              label: t(ctx, 'checkout_service_label'),
              value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
            },
          ],
        },
        {
          emoji: '📦',
          title: t(ctx, 'checkout_package_section'),
          fields: [
            {
              emoji: '📦',
              label: t(ctx, 'renewal_success_package_label'),
              value: customPackageName(ctx, gbAmount, durationDays),
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'auto_renew_review_hint')}`,
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), 'autorenew:custom_confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'autorenew:custom_cancel'),
    }
  );
  const confirmation = await waitForCallbackInput(conversation, [
    'autorenew:custom_confirm',
    'autorenew:custom_cancel',
  ]);
  if (confirmation !== 'autorenew:custom_confirm') {
    await replyInConversation(conversation, ctx, t(ctx, 'operation_cancelled'));
    return;
  }

  await conversation.external((outsideCtx) =>
    outsideCtx.services!.configService.setAutoRenew(
      telegramId,
      config.id,
      true,
      customPackageId,
      approvedPrice
    )
  );

  const backKeyboard = new InlineKeyboard().text(t(ctx, 'menu_back'), `config:view:${config.id}`);
  await replyInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✅',
      title: t(ctx, 'auto_renew_enabled_title'),
      subtitle: t(ctx, 'auto_renew_enabled_subtitle'),
      primary: {
        emoji: '📱',
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
      },
    }),
    { parse_mode: 'Markdown', reply_markup: backKeyboard }
  );
}

export async function promoConversation(conversation: MyConversation, ctx: ConversationContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  const returnDestination = await conversation.external((outsideCtx) =>
    outsideCtx.session.promoReturnDestination === 'shop' ? 'shop' : 'wallet'
  );
  const finishPromoFlow = () =>
    conversation.external((outsideCtx) => {
      delete outsideCtx.session.promoReturnDestination;
    });

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '🎟️',
      title: t(ctx, 'promo_title'),
      subtitle: t(ctx, 'promo_subtitle'),
      footer: `ℹ️ ${t(ctx, 'promo_input_hint')}`,
    }),
    { parse_mode: 'Markdown' }
  );
  const codeInput = await waitForTextInput(conversation, returnDestination);
  if (codeInput === undefined) {
    await finishPromoFlow();
    return;
  }
  const code = codeInput.trim();

  const res = await conversation.external((outsideCtx) =>
    outsideCtx.services!.promoService.redeemCode(telegramId, code)
  );
  const text = t(ctx, res.messageKey);
  if (res.success && res.code && res.codeType && res.codeType !== 'gift_credit') {
    const selectedAt = await conversation.now();
    const pendingPromo = {
      code: res.code,
      type: res.codeType,
      value: res.value ?? 0,
      selectedAt,
    };
    await conversation.external((outsideCtx) => {
      outsideCtx.session.pendingPromo = pendingPromo;
    });
    await replyInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'promo_applied_title'),
        subtitle: t(ctx, 'promo_applied_subtitle'),
        primary: {
          emoji: '🎟️',
          label: t(ctx, 'checkout_promo_section'),
          value: `\`${sanitizeTelegramInlineCode(res.code)}\``,
        },
        footer: text,
      }),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, returnDestination) }
    );
    await finishPromoFlow();
    return;
  }
  await replyInConversation(
    conversation,
    ctx,
    res.success
      ? buildScreen({
          emoji: '✅',
          title: t(ctx, 'promo_title'),
          subtitle: text,
        })
      : buildEmptyState('⚠️', t(ctx, 'promo_title'), text),
    { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, returnDestination) }
  );
  await finishPromoFlow();
}

/**
 * Admin-configurable default subscription length for the custom-volume flow.
 * Falls back to 30 days if the stored value is missing or not a usable integer.
 */
function customDurationDays(ctx: ConversationContext): number {
  const configured =
    ctx.services?.translationService.getSettingNum('custom_default_days', 30) ?? 30;
  if (!Number.isSafeInteger(configured) || configured <= 0) return 30;
  return Math.min(configured, 3_650);
}

/** Transfer a locally-owned Rebecca subscription to another bot user. */
export async function transferConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const actorTelegramId = ctx.from?.id;
  if (!actorTelegramId || !ctx.services) return;

  const sessionState = await conversation.external((outsideCtx) => ({
    configId: outsideCtx.session.transferConfigId as string | undefined,
    ownerTelegramId: outsideCtx.session.transferConfigOwnerTelegramId as number | undefined,
  }));
  if (!sessionState.configId) {
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_config_missing')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const ownerTelegramId = sessionState.ownerTelegramId ?? actorTelegramId;
  if (ownerTelegramId !== actorTelegramId && !ctx.services.isAdmin(actorTelegramId)) {
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'admin_access_denied')),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let target;
  while (!target) {
    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '🔁',
        title: t(ctx, 'transfer_title'),
        subtitle: t(ctx, 'transfer_subtitle'),
        footer: `ℹ️ ${t(ctx, 'transfer_target_hint')}`,
      }),
      { parse_mode: 'Markdown' }
    );
    const targetInput = await waitForTextInput(conversation);
    if (targetInput === undefined) return;
    const found = await ctx.services.userService.findProfile(targetInput);
    if (!found) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_not_found')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    if (found.telegramId === ownerTelegramId) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_same_user')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    if (found.isBanned) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_banned')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    target = found;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'transfer_confirm_button'), 'transfer_confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '🔁',
      title: t(ctx, 'transfer_review_title'),
      subtitle: t(ctx, 'transfer_review_subtitle'),
      primary: {
        emoji: '👤',
        label: t(ctx, 'transfer_recipient_label'),
        value: target.username
          ? `@${escapeTelegramMarkdown(target.username)}`
          : `\`${target.telegramId}\``,
      },
      sections: [
        {
          emoji: '🆔',
          title: t(ctx, 'transfer_recipient_label'),
          fields: [
            {
              emoji: '🆔',
              label: t(ctx, 'transfer_recipient_id_label'),
              value: `\`${target.telegramId}\``,
            },
          ],
        },
      ],
      footer: `⚠️ ${t(ctx, 'transfer_consequence')}`,
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );
  const choice = await waitForCallbackInput(conversation, ['transfer_confirm']);
  if (choice === undefined) return;

  try {
    const result = await ctx.services.configTransferService.transfer({
      configId: sessionState.configId,
      fromTelegramId: ownerTelegramId,
      toTelegramId: target.telegramId,
      actorTelegramId,
      allowAdminOverride: ownerTelegramId !== actorTelegramId,
    });
    await conversation.external((outsideCtx) => {
      outsideCtx.session.transferConfigId = undefined;
      outsideCtx.session.transferConfigOwnerTelegramId = undefined;
    });
    await replyInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'transfer_success_title'),
        subtitle: t(ctx, 'transfer_success_subtitle'),
        primary: {
          emoji: '📱',
          label: t(ctx, 'transfer_service_label'),
          value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
        },
        sections: [
          {
            emoji: '👤',
            title: t(ctx, 'transfer_recipient_label'),
            fields: [
              {
                emoji: '🆔',
                label: t(ctx, 'transfer_recipient_id_label'),
                value: `\`${target.telegramId}\``,
              },
            ],
          },
        ],
      }),
      { parse_mode: 'Markdown' }
    );
    try {
      const recipientLocale =
        (await ctx.services.userService.getLocale(target.telegramId)) ?? resolveContextLocale(ctx);
      await ctx.api.sendMessage(
        target.telegramId,
        buildScreen({
          emoji: '🎁',
          title: tForLocale(
            ctx.services.translationService,
            recipientLocale,
            'transfer_recipient_notice_title'
          ),
          subtitle: tForLocale(
            ctx.services.translationService,
            recipientLocale,
            'transfer_recipient_notice_subtitle'
          ),
          primary: {
            emoji: '📱',
            label: tForLocale(
              ctx.services.translationService,
              recipientLocale,
              'transfer_service_label'
            ),
            value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
          },
          sections: [
            {
              emoji: '👤',
              title: tForLocale(
                ctx.services.translationService,
                recipientLocale,
                'transfer_sender_label'
              ),
              fields: [
                {
                  emoji: '🆔',
                  label: tForLocale(
                    ctx.services.translationService,
                    recipientLocale,
                    'transfer_recipient_id_label'
                  ),
                  value: `\`${result.fromTelegramId}\``,
                },
              ],
            },
          ],
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            tForLocale(ctx.services.translationService, recipientLocale, 'menu_my_subscriptions'),
            'subs:page:1'
          ),
        }
      );
    } catch {
      // Transfer ownership is authoritative even if Telegram delivery is blocked.
    }
  } catch (err) {
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'transfer_title'),
        t(
          ctx,
          err instanceof Error && err.message === 'TRANSFER_TARGET_BANNED'
            ? 'transfer_target_banned'
            : 'transfer_failed'
        )
      ),
      { parse_mode: 'Markdown' }
    );
  }
}

/** Transfer available wallet balance to another bot user. */
export async function transferBalanceConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const senderTelegramId = ctx.from?.id;
  if (!senderTelegramId || !ctx.services) return;

  const isEnabled = walletTransferEnabled(ctx.services.translationService);
  if (!isEnabled) {
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'wallet_transfer_title'), t(ctx, 'wallet_transfer_disabled')),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const senderBalance = await ctx.services.walletService.getBalance(senderTelegramId);
  const minAmount = walletTransferMinAmount(ctx.services.translationService);

  if (senderBalance < minAmount) {
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '👛',
        t(ctx, 'wallet_transfer_title'),
        t(ctx, 'wallet_transfer_insufficient_balance')
      ),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Step 1: Prompt for recipient in loop
  let target;
  while (!target) {
    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '💸',
        title: t(ctx, 'wallet_transfer_title'),
        subtitle: t(ctx, 'wallet_transfer_subtitle'),
        footer: `ℹ️ ${t(ctx, 'wallet_transfer_target_hint')}`,
      }),
      { parse_mode: 'Markdown' }
    );

    const targetInput = await waitForTextInput(conversation);
    if (targetInput === undefined) return;

    const found = await ctx.services.userService.findProfile(targetInput);
    if (!found) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'wallet_transfer_title'), t(ctx, 'transfer_target_not_found')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (found.telegramId === senderTelegramId) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'wallet_transfer_self_error')
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (found.isBanned) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'wallet_transfer_title'), t(ctx, 'transfer_target_banned')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    target = found;
  }

  // Step 2: Prompt for amount in loop
  let parsedAmount: number | undefined;
  while (parsedAmount === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '💰',
        title: t(ctx, 'wallet_transfer_title'),
        subtitle: t(ctx, 'wallet_transfer_amount_prompt'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'wallet_transfer_recipient_label'),
          value: target.username
            ? `@${escapeTelegramMarkdown(target.username)}`
            : `\`${target.telegramId}\``,
        },
        sections: [
          {
            emoji: '👛',
            title: t(ctx, 'wallet_available_balance'),
            fields: [
              {
                emoji: '💰',
                label: t(ctx, 'wallet_available_balance'),
                value: `${localizedNumber(senderBalance, ctx)} ${t(ctx, 'currency_toman')}`,
              },
            ],
          },
        ],
        footer: `ℹ️ ${t(ctx, 'wallet_transfer_min_amount_hint', { min: localizedNumber(minAmount, ctx) })}`,
      }),
      { parse_mode: 'Markdown' }
    );

    const amountInput = await waitForTextInput(conversation);
    if (amountInput === undefined) return;

    const normalized = normalizeInputDigits(amountInput).replace(/[,_\s]/g, '');
    const amountVal = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;

    if (!Number.isSafeInteger(amountVal) || amountVal <= 0) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'wallet_transfer_invalid_amount')
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (amountVal < minAmount) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'wallet_transfer_below_min', { min: localizedNumber(minAmount, ctx) })
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (amountVal > senderBalance) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'wallet_transfer_insufficient_balance')
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    parsedAmount = amountVal;
  }

  // Step 3: Review & Confirm Screen
  const balanceAfter = senderBalance - parsedAmount;
  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'wallet_transfer_confirm_button'), 'wallet_transfer_confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '💸',
      title: t(ctx, 'wallet_transfer_review_title'),
      subtitle: t(ctx, 'wallet_transfer_review_subtitle'),
      primary: {
        emoji: '💰',
        label: t(ctx, 'wallet_transfer_amount_label'),
        value: `${localizedNumber(parsedAmount, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '👤',
          title: t(ctx, 'wallet_transfer_recipient_label'),
          fields: [
            {
              emoji: '👤',
              label: t(ctx, 'wallet_transfer_recipient_label'),
              value: target.username
                ? `@${escapeTelegramMarkdown(target.username)}`
                : `\`${target.telegramId}\``,
            },
            {
              emoji: '🆔',
              label: t(ctx, 'transfer_recipient_id_label'),
              value: `\`${target.telegramId}\``,
            },
          ],
        },
        {
          emoji: '👛',
          title: t(ctx, 'wallet_transfer_balance_after_label'),
          fields: [
            {
              emoji: '💳',
              label: t(ctx, 'wallet_transfer_balance_after_label'),
              value: `${localizedNumber(balanceAfter, ctx)} ${t(ctx, 'currency_toman')}`,
            },
          ],
        },
      ],
      footer: `⚠️ ${t(ctx, 'wallet_transfer_consequence')}`,
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const choice = await waitForCallbackInput(conversation, ['wallet_transfer_confirm']);
  if (choice === undefined) return;

  try {
    const result = await ctx.services.walletService.transferBalance({
      fromTelegramId: senderTelegramId,
      toTelegramId: target.telegramId,
      amount: parsedAmount,
    });

    // Notify sender of success
    await replyInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'wallet_transfer_success_title'),
        subtitle: t(ctx, 'wallet_transfer_success_subtitle'),
        primary: {
          emoji: '💰',
          label: t(ctx, 'wallet_transfer_amount_label'),
          value: `${localizedNumber(result.amount, ctx)} ${t(ctx, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '👤',
            title: t(ctx, 'wallet_transfer_recipient_label'),
            fields: [
              {
                emoji: '🆔',
                label: t(ctx, 'transfer_recipient_id_label'),
                value: `\`${target.telegramId}\``,
              },
            ],
          },
          {
            emoji: '👛',
            title: t(ctx, 'wallet_available_balance'),
            fields: [
              {
                emoji: '💳',
                label: t(ctx, 'wallet_available_balance'),
                value: `${localizedNumber(result.fromBalanceAfter, ctx)} ${t(ctx, 'currency_toman')}`,
              },
            ],
          },
        ],
        footer: t(ctx, 'wallet_transfer_sender_new_balance', {
          balance: localizedNumber(result.fromBalanceAfter, ctx),
        }),
      }),
      { parse_mode: 'Markdown' }
    );

    // Notify recipient in their configured language
    try {
      const recipientLocale =
        (await ctx.services.userService.getLocale(target.telegramId)) ?? resolveContextLocale(ctx);
      await ctx.api.sendMessage(
        target.telegramId,
        buildScreen({
          emoji: '🎁',
          title: tForLocale(
            ctx.services.translationService,
            recipientLocale,
            'wallet_transfer_recipient_notice_title'
          ),
          subtitle: tForLocale(
            ctx.services.translationService,
            recipientLocale,
            'wallet_transfer_recipient_notice_subtitle'
          ),
          primary: {
            emoji: '💰',
            label: tForLocale(
              ctx.services.translationService,
              recipientLocale,
              'wallet_transfer_amount_label'
            ),
            value: `${localizedNumberForLocale(result.amount, recipientLocale)} ${tForLocale(ctx.services.translationService, recipientLocale, 'currency_toman')}`,
          },
          sections: [
            {
              emoji: '👤',
              title: tForLocale(
                ctx.services.translationService,
                recipientLocale,
                'wallet_transfer_sender_label'
              ),
              fields: [
                {
                  emoji: '🆔',
                  label: tForLocale(
                    ctx.services.translationService,
                    recipientLocale,
                    'transfer_recipient_id_label'
                  ),
                  value: `\`${senderTelegramId}\``,
                },
              ],
            },
            {
              emoji: '👛',
              title: tForLocale(
                ctx.services.translationService,
                recipientLocale,
                'wallet_available_balance'
              ),
              fields: [
                {
                  emoji: '💳',
                  label: tForLocale(
                    ctx.services.translationService,
                    recipientLocale,
                    'wallet_available_balance'
                  ),
                  value: `${localizedNumberForLocale(result.toBalanceAfter, recipientLocale)} ${tForLocale(ctx.services.translationService, recipientLocale, 'currency_toman')}`,
                },
              ],
            },
          ],
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            tForLocale(ctx.services.translationService, recipientLocale, 'menu_wallet'),
            'nav:wallet'
          ),
        }
      );
    } catch {
      // Transfer is authoritative even if Telegram notification fails (e.g. user blocked bot)
    }
  } catch (err) {
    const errorKey =
      err instanceof Error && err.message === 'TRANSFER_TARGET_BANNED'
        ? 'transfer_target_banned'
        : err instanceof Error && err.message === 'INSUFFICIENT_BALANCE'
          ? 'wallet_transfer_insufficient_balance'
          : 'wallet_transfer_failed';
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'wallet_transfer_title'), t(ctx, errorKey)),
      { parse_mode: 'Markdown' }
    );
  }
}
