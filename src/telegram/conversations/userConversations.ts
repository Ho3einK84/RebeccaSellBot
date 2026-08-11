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
  normalizeInputDigits,
  resolveContextLocale,
  t,
  tmForLocale,
  tm,
} from '../locale.js';
import {
  promptInConversation,
  rememberArtifactMessage,
  replyInConversation,
  waitForCallbackInput,
  waitForTextInput,
} from '../ui.js';
import { customVolumeEnabled } from '../../domain/services/FeatureSettings.js';
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

  const packageNameStr = `${gbAmount} GB (${durationDays} Days)`;
  const target = ctx.services.pricingService.getCustomVolumeTarget();
  let checkout: PurchaseCheckout;
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

  const summaryText = pendingPromo.quote
    ? tm(ctx, 'purchase_quote_with_promo', {
        gb: localizedNumber(gbAmount, ctx),
        days: localizedNumber(durationDays, ctx),
        amount: localizedNumber(displayedCost, ctx),
        price_per_gb: localizedNumber(pricePerGb, ctx),
        promo_code: pendingPromo.quote.code,
      })
    : tm(ctx, 'purchase_quote', {
        gb: localizedNumber(gbAmount, ctx),
        days: localizedNumber(durationDays, ctx),
        amount: localizedNumber(displayedCost, ctx),
        price_per_gb: localizedNumber(pricePerGb, ctx),
      });

  await promptInConversation(conversation, ctx, summaryText, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard,
  });

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
    pendingPromo.quote
      ? t(ctx, 'purchase_issuing_with_promo', {
          package_name: packageNameStr,
          promo_code: pendingPromo.quote.code,
          amount: localizedNumber(displayedCost, ctx),
        })
      : t(ctx, 'purchase_issuing', { package_name: packageNameStr })
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
        outsideCtx.services!.purchaseCheckoutService.fail(checkout.id)
      );
      return;
    }
    const res = await ctx.services.walletService.executePurchaseSaga({
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
    await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.complete(checkout.id)
    );

    if (checkout.promoCode) {
      await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
    }

    const createdMsg = await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      tm(ctx, 'config_created', {
        sub_url: formatSubscriptionLink(res.subUrl, t(ctx, 'subscription_link_unavailable')),
      }),
      { parse_mode: 'Markdown', reply_markup: progressMessage.reply_markup }
    );
    if (typeof createdMsg === 'object' && createdMsg && 'message_id' in createdMsg) {
      await conversation.external((outsideCtx) => {
        rememberArtifactMessage(outsideCtx.session, createdMsg.message_id);
      });
    }
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.fail(checkout.id)
    );
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx)),
      { reply_markup: progressMessage.reply_markup }
    );
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function buyConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!ctx.from?.id || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx))) return;

  await promptInConversation(conversation, ctx, t(ctx, 'custom_gb_prompt'));
  const gbInput = await waitForTextInput(conversation);
  if (gbInput === undefined) return;
  const gbAmount = parseBoundedWholeNumber(gbInput, 10_000);

  if (gbAmount === undefined) {
    await replyInConversation(
      conversation,
      ctx,
      t(ctx, 'custom_gb_invalid_range', { min: 1, max: 10_000 })
    );
    return;
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

  await promptInConversation(conversation, ctx, t(ctx, 'custom_gb_simple_prompt'));
  const gbInput = await waitForTextInput(conversation);
  if (gbInput === undefined) return;
  const gbAmount = parseBoundedWholeNumber(gbInput, 10_000);

  if (gbAmount === undefined) {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_gb_invalid'));
    return;
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

  // Step 1: Prompt for custom traffic quota (GB)
  await promptInConversation(conversation, ctx, t(ctx, 'custom_gb_prompt'));
  const gbInput = await waitForTextInput(conversation);
  if (gbInput === undefined) return;
  const gbAmount = parseBoundedWholeNumber(gbInput, 10_000);
  if (gbAmount === undefined) {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_gb_invalid'));
    return;
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

  const summaryText = pendingPromo.quote
    ? tm(ctx, 'renewal_quote_with_promo', {
        username: config.configUsername,
        gb: localizedNumber(gbAmount, ctx),
        days: localizedNumber(durationDays, ctx),
        amount: localizedNumber(displayedCost, ctx),
        price_per_gb: localizedNumber(pricePerGb, ctx),
        promo_code: pendingPromo.quote.code,
      })
    : tm(ctx, 'renewal_quote', {
        username: config.configUsername,
        gb: localizedNumber(gbAmount, ctx),
        days: localizedNumber(durationDays, ctx),
        amount: localizedNumber(displayedCost, ctx),
        price_per_gb: localizedNumber(pricePerGb, ctx),
      });

  let checkout: PurchaseCheckout;
  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.create({
        telegramId,
        kind: 'renew_config',
        configId: config.id,
        pkg: {
          id: `custom_${gbAmount}gb_${durationDays}d`,
          name: `${gbAmount} GB (${durationDays} Days)`,
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

  await promptInConversation(conversation, ctx, summaryText, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard,
  });

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

  const progressMessage = await replyInConversation(conversation, ctx, t(ctx, 'renewing'));

  try {
    // This is the authoritative last check: no awaited work may occur between
    // it and entering the purchase saga.
    if (!(await requireCustomVolume(conversation, ctx, true))) {
      await conversation.external((outsideCtx) =>
        outsideCtx.services!.purchaseCheckoutService.fail(checkout.id)
      );
      return;
    }
    const res = await ctx.services.walletService.executePurchaseSaga({
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
    });
    await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.complete(checkout.id)
    );

    if (checkout.promoCode) {
      await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
    }

    const packageNameStr = `${gbAmount} GB (${durationDays} Days)`;
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      tm(ctx, 'renewal_success', {
        username: res.configUsername,
        package_name: packageNameStr,
      }),
      { parse_mode: 'Markdown', reply_markup: progressMessage.reply_markup }
    );
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.fail(checkout.id)
    );
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMessage.message_id,
      purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx)),
      { reply_markup: progressMessage.reply_markup }
    );
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

  // Step 1: Prompt for custom traffic quota (GB)
  await promptInConversation(conversation, ctx, t(ctx, 'custom_gb_prompt'));
  const gbInput = await waitForTextInput(conversation);
  if (gbInput === undefined) return;
  const gbAmount = parseBoundedWholeNumber(gbInput, 10_000);
  if (gbAmount === undefined) {
    await replyInConversation(conversation, ctx, t(ctx, 'custom_gb_invalid'));
    return;
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
    t(ctx, 'auto_renew_confirm', {
      username: config.configUsername,
      package: t(ctx, 'auto_renew_custom_package', {
        gb: localizedNumber(gbAmount, ctx),
        days: localizedNumber(durationDays, ctx),
      }),
      price: localizedNumber(approvedPrice, ctx),
    }),
    {
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

  const backKeyboard = new InlineKeyboard().text(
    t(ctx, 'admin_menu_back'),
    `config:view:${config.id}`
  );
  await replyInConversation(conversation, ctx, t(ctx, 'auto_renew_enabled'), {
    reply_markup: backKeyboard,
  });
}

export async function promoConversation(conversation: MyConversation, ctx: ConversationContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  await promptInConversation(conversation, ctx, t(ctx, 'promo_prompt'));
  const codeInput = await waitForTextInput(conversation);
  if (codeInput === undefined) return;
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
      `${text}\n\n${t(ctx, 'promo_selected_for_purchase', { promo_code: res.code })}`
    );
    return;
  }
  await replyInConversation(conversation, ctx, text);
}

function parseBoundedWholeNumber(value: string, maximum: number): number | undefined {
  const trimmed = normalizeInputDigits(value);
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return undefined;
  return parsed;
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
    await replyInConversation(conversation, ctx, t(ctx, 'transfer_config_missing'));
    return;
  }
  const ownerTelegramId = sessionState.ownerTelegramId ?? actorTelegramId;
  if (ownerTelegramId !== actorTelegramId && !ctx.services.isAdmin(actorTelegramId)) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_access_denied'));
    return;
  }

  await promptInConversation(conversation, ctx, t(ctx, 'transfer_target_prompt'));
  const targetInput = await waitForTextInput(conversation);
  if (targetInput === undefined) return;
  const target = await ctx.services.userService.findProfile(targetInput);
  if (!target) {
    await replyInConversation(conversation, ctx, t(ctx, 'transfer_target_not_found'));
    return;
  }
  if (target.telegramId === ownerTelegramId) {
    await replyInConversation(conversation, ctx, t(ctx, 'transfer_target_same_user'));
    return;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'transfer_confirm_button'), 'transfer_confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    tm(ctx, 'transfer_confirm_prompt', {
      telegram_id: localizedNumber(target.telegramId, ctx),
      username: target.username ? `@${target.username}` : '—',
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
      t(ctx, 'transfer_success', {
        username: result.configUsername,
        telegram_id: target.telegramId,
      })
    );
    try {
      const recipientLocale =
        (await ctx.services.userService.getLocale(target.telegramId)) ?? resolveContextLocale(ctx);
      await ctx.api.sendMessage(
        target.telegramId,
        tmForLocale(ctx.services.translationService, recipientLocale, 'transfer_recipient_notice', {
          username: result.configUsername,
          telegram_id: result.fromTelegramId,
        }),
        { parse_mode: 'Markdown' }
      );
    } catch {
      // Transfer ownership is authoritative even if Telegram delivery is blocked.
    }
  } catch (err) {
    await replyInConversation(
      conversation,
      ctx,
      t(
        ctx,
        err instanceof Error && err.message === 'TRANSFER_TARGET_BANNED'
          ? 'transfer_target_banned'
          : 'transfer_failed'
      )
    );
  }
}
