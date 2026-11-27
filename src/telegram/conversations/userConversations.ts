/**
 * User-facing conversations.
 *
 * buyConfigConversation  — package picker (redirected from shop menu for custom amounts)
 * customAmountConversation — free-form GB + days entry
 * promoConversation      — promo/gift code redemption
 */
import { InlineKeyboard, Keyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../types.js';
import { clearPendingPromo, getPendingPromoPricing } from '../promoSelection.js';
import { purchaseFailureMessage } from '../purchaseFeedback.js';
import {
  formatSubscriptionLink,
  localizedNumber,
  localizedNumberForLocale,
  localizedPackageName,
  normalizeInputDigits,
  resolveContextLocale,
  t,
  tForLocale,
} from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  acceptConversationOwner,
  backKeyboard,
  buildUserEmptyState,
  buildUserPromptScreen,
  buildUserScreen,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  promptInConversation,
  rememberArtifactMessage,
  rememberUiMessage,
  replyInConversation,
  sendArtifactInConversation,
  waitForCallbackInput,
  waitForTextInput,
  waitForTextOrCallbackInput,
} from '../ui.js';
import { logger } from '../../infra/logger.js';
import { recordCheckoutCompleted, recordCheckoutFailed } from '../checkoutLifecycle.js';
import { InventoryUnavailableError } from '../../domain/services/InventoryService.js';
import {
  MAX_CONFIG_USER_LABEL_LENGTH,
  normalizeCustomServiceName,
  sanitizeConfigUserLabel,
} from '../../domain/services/ConfigService.js';
import { formatTelegramConfigRef } from '../../domain/services/TelegramFormatting.js';
import { callbackData } from '../callbackData.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
  type ResolvedCatalogDiscount,
} from '../../domain/services/CatalogDiscountService.js';
import {
  applyGroupDiscount,
  parseVolumePricingTiersJson,
} from '../../domain/services/PricingService.js';
import {
  formatUserGroupDisplayLabel,
  safeGetEffectiveUserPolicy,
} from '../../domain/services/UserGroupService.js';
import { ContactVerificationService } from '../../domain/services/ContactVerificationService.js';
import { buildForcedJoinGateScreen } from '../middleware/forcedJoin.js';
import {
  customVolumeEnabled,
  isCustomServiceNameAllowed,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../domain/services/FeatureSettings.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';
import {
  PurchaseCheckoutUnavailableError,
  type PurchaseCheckout,
} from '../../domain/services/PurchaseCheckoutService.js';
import {
  buildInsufficientBalanceKeyboard,
  buildUnifiedCheckoutScreen,
  buildUnifiedInsufficientBalanceScreen,
  computeRolloverPreview,
  type RolloverPreview,
  type UnifiedCheckoutPromo,
} from '../checkoutRenderer.js';

async function requireCustomVolume(
  conversation: MyConversation,
  ctx: ConversationContext,
  clearRenewalSession = false
): Promise<boolean> {
  const enabled = await conversation.external((outsideCtx) => {
    const isEnabled =
      !!outsideCtx.services && customVolumeEnabled(outsideCtx.services.translationService);
    if (!isEnabled && clearRenewalSession) {
      outsideCtx.session.renewConfigId = undefined;
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

const CUSTOM_GB_PRESETS = [10, 20, 30, 50, 100, 200] as const;

function getCustomVolumeBounds(ctx: ConversationContext): { minGb: number; maxGb: number } {
  const ts = ctx.services?.translationService;
  const rawMin = typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('custom_min_gb', 5) : 5;
  const rawMax =
    typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('custom_max_gb', 500) : 500;
  const minGb = Number.isSafeInteger(rawMin) && rawMin >= 1 && rawMin <= 10_000 ? rawMin : 5;
  const maxGb =
    Number.isSafeInteger(rawMax) && rawMax >= minGb && rawMax <= 10_000
      ? rawMax
      : Math.max(minGb, 500);
  return { minGb, maxGb };
}

async function promptCustomVolumeGb(
  conversation: MyConversation,
  ctx: ConversationContext,
  options: { cancelDestination?: 'home' | 'shop' | 'wallet' } = {}
): Promise<number | undefined> {
  const config = await conversation.external(async (outsideCtx) => {
    const targetCtx = outsideCtx ?? ctx;
    const ts = targetCtx.services?.translationService;
    const bounds = getCustomVolumeBounds(targetCtx);
    const days = customDurationDays(targetCtx);
    const basePricePerGb =
      typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('price_per_gb', 5000) : 5000;
    const userPolicy = await safeGetEffectiveUserPolicy(
      targetCtx.services?.userGroupService,
      targetCtx.from?.id
    );
    const hasGroupCustomRate =
      userPolicy.customPricePerGb !== null || userPolicy.customPricePerDay !== null;
    const rawRate = userPolicy.customPricePerGb ?? basePricePerGb;
    const effectiveCustomDiscPct = userPolicy.applyDiscountToCustomVolume
      ? userPolicy.discountPercent
      : 0;
    const pricePerGb = applyGroupDiscount(rawRate, effectiveCustomDiscPct).finalAmount;
    const rawTiers = hasGroupCustomRate
      ? '[]'
      : typeof ts?.getSetting === 'function'
        ? ts.getSetting('volume_pricing_tiers_json', '[]')
        : '[]';
    const tiers = (parseVolumePricingTiersJson(rawTiers) ?? [])
      .slice()
      .sort((a, b) => a.minGb - b.minGb);
    return { ...bounds, days, pricePerGb, tiers };
  });

  const { minGb, maxGb, days, pricePerGb, tiers } = config;
  const gbUnit = t(ctx, 'traffic_unit_gb');
  const presets = CUSTOM_GB_PRESETS.filter((gb) => gb >= minGb && gb <= maxGb);

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < presets.length; i += 3) {
    const row = presets.slice(i, i + 3);
    for (const gb of row) {
      keyboard.text(`${localizedNumber(gb, ctx)} ${gbUnit}`, `cv_preset:${gb}`);
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  const sections = [
    {
      bullet: '',
      fields: [
        {
          emoji: '💰',
          value: t(ctx, 'custom_volume_rate_info', {
            price: localizedNumber(pricePerGb, ctx),
            days: localizedNumber(days, ctx),
          }),
        },
      ],
    },
    ...(tiers.length > 0
      ? [
          {
            emoji: '💎',
            title: t(ctx, 'custom_volume_tiers_section'),
            fields: tiers.map((tier) => ({
              value:
                tier.discountPercent !== undefined
                  ? t(ctx, 'custom_volume_tier_percent', {
                      min: localizedNumber(tier.minGb, ctx),
                      percent: localizedNumber(tier.discountPercent, ctx),
                    })
                  : t(ctx, 'custom_volume_tier_price', {
                      min: localizedNumber(tier.minGb, ctx),
                      price: localizedNumber(tier.pricePerGb ?? pricePerGb, ctx),
                    }),
            })),
          },
        ]
      : []),
  ];

  const promptText = buildUserScreen({
    emoji: '✏️',
    title: t(ctx, 'custom_volume_title'),
    subtitle: t(ctx, 'custom_volume_subtitle'),
    sections,
    footer: t(ctx, 'custom_volume_range_hint', {
      min: localizedNumber(minGb, ctx),
      max: localizedNumber(maxGb, ctx),
    }),
  });

  await promptInConversation(conversation, ctx, promptText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  for (;;) {
    const input = await waitForTextOrCallbackInput(
      conversation,
      ['cv_preset:'],
      options.cancelDestination ?? 'home'
    );
    if (!input) return undefined;

    let val: number;
    if (input.type === 'callback') {
      val = Number(input.data.slice('cv_preset:'.length));
    } else {
      const trimmed = normalizeInputDigits(input.text).trim();
      if (!/^[1-9]\d*$/.test(trimmed)) {
        await promptInConversation(
          conversation,
          ctx,
          buildUserEmptyState('⚠️', t(ctx, 'custom_volume_title'), t(ctx, 'custom_gb_invalid')),
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        continue;
      }
      val = Number(trimmed);
    }

    if (!Number.isSafeInteger(val) || val < minGb || val > maxGb) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'custom_volume_title'),
          t(ctx, 'custom_gb_invalid_range', {
            min: localizedNumber(minGb, ctx),
            max: localizedNumber(maxGb, ctx),
          })
        ),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      continue;
    }

    return val;
  }
}

export type CustomNamePromptResult =
  { kind: 'custom'; name: string } | { kind: 'random' } | { kind: 'cancel' };

export async function promptCustomServiceName(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<CustomNamePromptResult> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'custom_name_random_button'), 'custom_name:random')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildUserPromptScreen(
      '🏷️',
      t(ctx, 'custom_name_prompt_title'),
      t(ctx, 'custom_name_prompt_body'),
      t(ctx, 'custom_name_prompt_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  for (;;) {
    const input = await waitForTextOrCallbackInput(conversation, ['custom_name:random']);
    if (!input) return { kind: 'cancel' };
    if (input.type === 'callback' && input.data === 'custom_name:random') {
      return { kind: 'random' };
    }
    if (input.type === 'text') {
      const normalized = normalizeCustomServiceName(input.text);
      if (normalized) {
        return { kind: 'custom', name: normalized };
      }
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'custom_name_prompt_title'),
          t(ctx, 'custom_name_invalid')
        ),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    }
  }
}

export function buildCustomCheckoutScreen(
  ctx: ConversationContext,
  input: {
    mode: 'purchase' | 'renewal';
    username?: string;
    requestedUsername?: string;
    gbAmount: number;
    durationDays: number;
    amount: number;
    pricePerGb: number;
    walletAvailableBalance?: number;
    creditLimit?: number;
    groupLabel?: string | null;
    groupDiscountPercent?: number;
    groupDiscountAmount?: number;
    originalPrice?: number;
    startOnFirstUse?: boolean;
    promoCode?: string;
    promo?: UnifiedCheckoutPromo;
    rolloverEnabled?: boolean;
    rollover?: RolloverPreview;
    catalogDiscount?: ResolvedCatalogDiscount;
  }
): string {
  return buildUnifiedCheckoutScreen(ctx, {
    mode: input.mode,
    packageName: customPackageName(ctx, input.gbAmount, input.durationDays),
    gbAmount: input.gbAmount,
    durationDays: input.durationDays,
    finalAmount: input.amount,
    originalPrice: input.originalPrice ?? input.catalogDiscount?.originalPrice,
    effectivePrice: input.catalogDiscount?.effectivePrice,
    pricePerGb: input.pricePerGb,
    walletAvailableBalance: input.walletAvailableBalance,
    creditLimit: input.creditLimit,
    groupLabel: input.groupLabel,
    groupDiscountPercent: input.groupDiscountPercent,
    groupDiscountAmount: input.groupDiscountAmount,
    serviceUsername: input.username,
    requestedUsername: input.requestedUsername,
    startOnFirstUse: input.startOnFirstUse,
    rollover: input.rollover ?? (input.rolloverEnabled ? { enabled: true } : undefined),
    catalogDiscount: input.catalogDiscount,
    promo: input.promo ?? (input.promoCode ? { code: input.promoCode } : undefined),
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
  const forcedJoinBlocked = await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? ctx.services!;
    if (!services.forcedJoinService || services.isAdmin(telegramId)) return null;
    const check = await services.forcedJoinService.checkMembership(telegramId, 'purchase');
    if (check.allowed) return null;
    if (outsideCtx?.session) {
      outsideCtx.session.pendingForcedJoinAction = { kind: 'custom_amount' };
    }
    return check.missingChannels;
  });
  if (forcedJoinBlocked) {
    const { text, keyboard } = buildForcedJoinGateScreen(ctx, forcedJoinBlocked);
    await replyInConversation(conversation, ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    return;
  }

  const phoneRequired = await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? ctx.services!;
    const phoneService =
      services.contactVerificationService ??
      new ContactVerificationService({
        translationService: services.translationService,
      });
    return phoneService.shouldRequirePhoneForPurchase(telegramId);
  });
  if (phoneRequired) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '📱',
        t(ctx, 'onboarding_phone_verify_title'),
        t(ctx, 'purchase_phone_required')
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'button_share_phone'), 'phone:verify:start')
          .row()
          .text(t(ctx, 'menu_back_shop'), 'nav:shop'),
      }
    );
    return;
  }

  const customPkgId = `custom_${gbAmount}gb_${durationDays}d`;
  const { userPolicy, customQuote, catalogDiscount, startOnFirstUse } = await conversation.external(
    async (outsideCtx) => {
      const services = outsideCtx?.services ?? ctx.services!;
      const policy = await safeGetEffectiveUserPolicy(services.userGroupService, telegramId);
      const quote = services.pricingService.getCustomPriceQuote(gbAmount, durationDays, policy);
      const activeDiscounts = policy.allowCatalogDiscounts
        ? await safeListActiveDiscounts(services.catalogDiscountService)
        : [];
      const discount = policy.allowCatalogDiscounts
        ? resolveBestCatalogDiscount(activeDiscounts, {
            packageId: customPkgId,
            categoryId: null,
            originalPrice: quote.totalPrice,
          })
        : {
            originalPrice: quote.totalPrice,
            effectivePrice: quote.totalPrice,
            discountAmount: 0,
            activeDiscountId: null,
            activeDiscountTitle: null,
            discountExpiresAt: null,
          };
      const onHold =
        typeof services.translationService?.getSetting === 'function' &&
        onHoldDefaultEnabled(services.translationService);
      return {
        userPolicy: policy,
        customQuote: quote,
        catalogDiscount: discount,
        startOnFirstUse: onHold,
      };
    }
  );
  const pricePerGb = customQuote.pricePerGb;
  const totalCost = catalogDiscount.effectivePrice;

  const pendingPromo = userPolicy.allowPromoCodes
    ? await conversation.external((outsideCtx) =>
        getPendingPromoPricing(outsideCtx, telegramId, totalCost, gbAmount)
      )
    : {};
  if (pendingPromo.messageKey) {
    await replyInConversation(conversation, ctx, t(ctx, pendingPromo.messageKey));
    return;
  }
  const displayedCost = pendingPromo.quote?.finalAmount ?? totalCost;
  const bonusGb = Math.max(0, (pendingPromo.quote?.finalGbAmount ?? gbAmount) - gbAmount);
  const promoDiscountAmount = Math.max(0, totalCost - displayedCost);

  const balance = await conversation.external((outsideCtx) =>
    outsideCtx.services!.walletService.getAvailableBalance(telegramId)
  );
  const purchasingPower = Math.max(0, balance + userPolicy.creditLimit);
  if (purchasingPower < displayedCost) {
    const createdAt = await conversation.now();
    await conversation.external((outsideCtx) => {
      outsideCtx.session.pendingTopupIntent = {
        kind: 'new_config',
        packageId: customPkgId,
        deficitAmount: Math.max(0, displayedCost - purchasingPower),
        createdAt,
      };
    });
    await replyInConversation(
      conversation,
      ctx,
      buildUnifiedInsufficientBalanceScreen(ctx, {
        packagePrice: displayedCost,
        balance,
        creditLimit: userPolicy.creditLimit,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildInsufficientBalanceKeyboard(ctx, {
          backLabelKey: 'menu_back_shop',
          backCallback: 'nav:shop',
        }),
      }
    );
    return;
  }

  const askCustomName = await conversation.external(
    (outsideCtx) =>
      typeof outsideCtx.services?.translationService?.getSetting === 'function' &&
      isCustomServiceNameAllowed(outsideCtx.services.translationService, userPolicy)
  );
  let requestedUsername: string | undefined;
  if (askCustomName) {
    const nameChoice = await promptCustomServiceName(conversation, ctx);
    if (nameChoice.kind === 'cancel') return;
    if (nameChoice.kind === 'custom') requestedUsername = nameChoice.name;
  }

  const packageNameStr = customPackageName(ctx, gbAmount, durationDays);
  const target = await conversation.external((outsideCtx) =>
    outsideCtx.services!.pricingService.getCustomVolumeTarget()
  );
  let checkout: PurchaseCheckout;
  let res: { configUsername: string; subUrl?: string };
  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.create({
        telegramId,
        kind: 'new_config',
        pkg: {
          id: customPkgId,
          name: packageNameStr,
          gbAmount,
          durationDays,
          price: totalCost,
        },
        ...target,
        promoCode: pendingPromo.promoCode,
        ...(requestedUsername ? { requestedUsername } : {}),
        quotedAmount: displayedCost,
      })
    );
  } catch (err) {
    const msg =
      err instanceof InventoryUnavailableError
        ? purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
        : t(ctx, 'custom_volume_unavailable');
    await replyInConversation(conversation, ctx, msg);
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
      requestedUsername,
      gbAmount,
      durationDays,
      amount: displayedCost,
      pricePerGb,
      walletAvailableBalance: balance,
      creditLimit: userPolicy.creditLimit,
      groupLabel: formatUserGroupDisplayLabel(userPolicy),
      groupDiscountPercent: customQuote.groupDiscountPercent,
      groupDiscountAmount: customQuote.groupDiscountAmount,
      originalPrice: customQuote.originalPrice ?? catalogDiscount.originalPrice,
      startOnFirstUse,
      promo: pendingPromo.quote?.code
        ? {
            code: pendingPromo.quote.code,
            type: pendingPromo.quote.type,
            discountAmount: promoDiscountAmount,
            bonusGb,
          }
        : undefined,
      catalogDiscount,
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
    buildUserScreen({
      emoji: '⏳',
      title: t(ctx, 'purchase_issuing_title'),
      subtitle: t(ctx, 'purchase_issuing_subtitle'),
      primary: {
        label: t(ctx, 'purchase_issuing_package_label'),
        value: escapeTelegramMarkdown(packageNameStr),
        inline: true,
      },
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'operation_in_progress'), 'ui:noop'),
    }
  );

  try {
    const configName = await conversation.external((outsideCtx) =>
      checkout.requestedUsername
        ? outsideCtx.services!.configService.resolveCustomConfigName(
            checkout.requestedUsername,
            checkout.panelId
          )
        : outsideCtx.services!.configService.generateConfigName(telegramId, checkout.panelId)
    );
    // This is the authoritative last check: no awaited work may occur between
    // it and entering the purchase saga.
    if (!(await requireCustomVolume(conversation, ctx))) {
      await conversation.external((outsideCtx) =>
        recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
      );
      return;
    }
    res = await conversation.external((outsideCtx) =>
      outsideCtx.services!.walletService.executePurchaseSaga({
        telegramId,
        amount: checkout.amount,
        maxAmount: checkout.quotedAmount,
        type: 'new_config',
        configUsername: configName,
        gbAmount: checkout.gbAmount,
        durationDays: checkout.durationDays,
        panelId: checkout.panelId,
        serviceId: checkout.serviceId,
        packageId: checkout.packageId,
        checkoutId: checkout.id,
        ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
      })
    );
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
    );
    const failureText = buildUserEmptyState(
      '⚠️',
      t(ctx, 'purchase_failed_title'),
      purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
    );
    const failureMarkup = new InlineKeyboard().text(t(ctx, 'menu_back_main'), 'nav:main');
    try {
      await conversation.external(() =>
        ctx.api.editMessageText(ctx.chat!.id, progressMessage.message_id, failureText, {
          parse_mode: 'Markdown',
          reply_markup: failureMarkup,
        })
      );
    } catch {
      await replyInConversation(conversation, ctx, failureText, {
        parse_mode: 'Markdown',
        reply_markup: failureMarkup,
      });
    }
    return;
  }

  await conversation.external((outsideCtx) =>
    recordCheckoutCompleted(outsideCtx.services!.purchaseCheckoutService, checkout.id)
  );
  if (checkout.promoCode) {
    await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
  }

  const createdConfig = await conversation.external(async (outsideCtx) => {
    const cs = outsideCtx.services?.configService;
    if (typeof cs?.getOwnedConfigByUsername !== 'function') return undefined;
    try {
      return await cs.getOwnedConfigByUsername(telegramId, res.configUsername, checkout.panelId);
    } catch {
      return undefined;
    }
  });

  const successText = buildUserScreen({
    emoji: '🎉',
    title: t(ctx, 'purchase_success_title'),
    subtitle: t(ctx, 'purchase_success_subtitle'),
    primary: {
      emoji: '🔗',
      label: t(ctx, 'purchase_success_link_label'),
      value: formatSubscriptionLink(res.subUrl, t(ctx, 'subscription_link_unavailable')),
    },
    sections: [
      {
        bullet: '',
        fields: [
          {
            label: t(ctx, 'purchase_success_service_label'),
            value: `\`${sanitizeTelegramInlineCode(res.configUsername)}\``,
          },
          {
            label: t(ctx, 'purchase_success_package_label'),
            value: escapeTelegramMarkdown(packageNameStr),
          },
        ],
      },
    ],
    ...(startOnFirstUse ? { footer: t(ctx, 'purchase_success_on_hold_note') } : {}),
  });
  try {
    const createdMsg = await conversation.external(() =>
      ctx.api.editMessageText(ctx.chat!.id, progressMessage.message_id, successText, {
        parse_mode: 'Markdown',
      })
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

  const navKeyboard = new InlineKeyboard();
  if (createdConfig?.id) {
    navKeyboard
      .text(t(ctx, 'subscription_qr_button'), `config:qr:${createdConfig.id}`)
      .text(t(ctx, 'subscription_view_detail'), `config:view:${createdConfig.id}`)
      .row();
  }
  navKeyboard
    .text(t(ctx, 'menu_my_configs'), 'subs:page:1')
    .row()
    .text(t(ctx, 'menu_back_main'), 'nav:main');

  await replyInConversation(conversation, ctx, t(ctx, 'navigation_continue_hint'), {
    reply_markup: navKeyboard,
  });
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function buyPackageCustomNameConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  const forcedJoinBlocked = await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? ctx.services!;
    if (!services.forcedJoinService || services.isAdmin(telegramId)) return null;
    const check = await services.forcedJoinService.checkMembership(telegramId, 'purchase');
    if (check.allowed) return null;
    if (outsideCtx?.session) {
      outsideCtx.session.pendingForcedJoinAction = { kind: 'shop' };
    }
    return check.missingChannels;
  });
  if (forcedJoinBlocked) {
    const { text, keyboard } = buildForcedJoinGateScreen(ctx, forcedJoinBlocked);
    await replyInConversation(conversation, ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    return;
  }

  const packageId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.pendingCustomNamePurchase?.packageId;
    delete outsideCtx.session.pendingCustomNamePurchase;
    return selected;
  });
  if (!packageId) return;

  const pkg = await conversation.external((outsideCtx) =>
    outsideCtx.services!.pricingService.getPackageById(packageId)
  );
  if (!pkg || pkg.enabled === false) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '⚠️',
        t(ctx, 'purchase_review_title'),
        t(ctx, 'purchase_target_unavailable')
      ),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'shop') }
    );
    return;
  }

  const { userPolicy, groupDisc, catalogDiscount, effectivePkg, startOnFirstUse } =
    await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? ctx.services!;
      const policy = await safeGetEffectiveUserPolicy(services.userGroupService, telegramId);
      const gd = applyGroupDiscount(pkg.price, policy.discountPercent);
      const activeDiscounts = policy.allowCatalogDiscounts
        ? await safeListActiveDiscounts(services.catalogDiscountService)
        : [];
      const discount = policy.allowCatalogDiscounts
        ? resolveBestCatalogDiscount(activeDiscounts, {
            packageId: pkg.id,
            categoryId: pkg.categoryId ?? null,
            originalPrice: gd.finalAmount,
          })
        : {
            originalPrice: gd.finalAmount,
            effectivePrice: gd.finalAmount,
            discountAmount: 0,
            activeDiscountId: null,
            activeDiscountTitle: null,
            discountExpiresAt: null,
          };
      const defaultOnHold =
        typeof services.translationService?.getSetting === 'function' &&
        onHoldDefaultEnabled(services.translationService);
      return {
        userPolicy: policy,
        groupDisc: gd,
        catalogDiscount: discount,
        effectivePkg:
          discount.effectivePrice !== pkg.price ? { ...pkg, price: discount.effectivePrice } : pkg,
        startOnFirstUse: pkg.startOnFirstUse ?? defaultOnHold,
      };
    });

  const pendingPromo = userPolicy.allowPromoCodes
    ? await conversation.external((outsideCtx) =>
        getPendingPromoPricing(outsideCtx, telegramId, effectivePkg.price, pkg.gbAmount)
      )
    : {};
  if (pendingPromo.messageKey) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'purchase_review_title'), t(ctx, pendingPromo.messageKey)),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
    );
    return;
  }
  const displayedPrice = pendingPromo.quote?.finalAmount ?? effectivePkg.price;
  const bonusGb = Math.max(0, (pendingPromo.quote?.finalGbAmount ?? pkg.gbAmount) - pkg.gbAmount);
  const promoDiscountAmount = Math.max(0, effectivePkg.price - displayedPrice);

  const balance = await conversation.external((outsideCtx) =>
    outsideCtx.services!.walletService.getAvailableBalance(telegramId)
  );
  const purchasingPower = Math.max(0, balance + userPolicy.creditLimit);
  if (purchasingPower < displayedPrice) {
    const createdAt = await conversation.now();
    await conversation.external((outsideCtx) => {
      outsideCtx.session.promoCheckoutContext = { kind: 'new_config', packageId: pkg.id };
      outsideCtx.session.pendingTopupIntent = {
        kind: 'new_config',
        packageId: pkg.id,
        deficitAmount: Math.max(0, displayedPrice - purchasingPower),
        createdAt,
      };
    });
    const showPromoButton = userPolicy.allowPromoCodes && !pendingPromo.quote?.code;
    await replyInConversation(
      conversation,
      ctx,
      buildUnifiedInsufficientBalanceScreen(ctx, {
        packagePrice: displayedPrice,
        balance,
        creditLimit: userPolicy.creditLimit,
        includePromoHint: showPromoButton,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildInsufficientBalanceKeyboard(ctx, {
          backLabelKey: 'menu_back_shop',
          backCallback: 'nav:shop',
          ...(showPromoButton ? { promoCallback: 'shop:apply_promo' } : {}),
        }),
      }
    );
    return;
  }

  const nameChoice = await promptCustomServiceName(conversation, ctx);
  if (nameChoice.kind === 'cancel') return;
  const requestedUsername = nameChoice.kind === 'custom' ? nameChoice.name : undefined;

  let checkout: PurchaseCheckout;
  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.create({
        telegramId,
        kind: 'new_config',
        pkg: effectivePkg,
        promoCode: pendingPromo.promoCode,
        ...(requestedUsername ? { requestedUsername } : {}),
        quotedAmount: displayedPrice,
      })
    );
    await conversation.external((outsideCtx) => {
      outsideCtx.session.promoCheckoutContext = {
        kind: 'new_config',
        packageId: pkg.id,
        ...(requestedUsername ? { requestedUsername } : {}),
      };
    });
    trackFunnelEvent('checkout_start');
  } catch (err) {
    const reasonText =
      err instanceof InventoryUnavailableError
        ? purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
        : t(ctx, 'purchase_target_unavailable');
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'purchase_review_title'), reasonText),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
    );
    return;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'buy_confirm_button'), `buy:confirm:${checkout.id}`)
    .row();
  if (userPolicy.allowPromoCodes) {
    if (pendingPromo.quote?.code) {
      confirmKeyboard
        .text(t(ctx, 'shop_change_promo_button'), `checkout:promo:${checkout.id}`)
        .text(t(ctx, 'shop_clear_promo_button'), `checkout:clear_promo:${checkout.id}`)
        .row();
    } else {
      confirmKeyboard
        .text(t(ctx, 'shop_apply_promo_button'), `checkout:promo:${checkout.id}`)
        .row();
    }
  }
  confirmKeyboard.text(t(ctx, 'menu_back_shop'), 'nav:shop');

  const reviewScreen = buildUnifiedCheckoutScreen(ctx, {
    mode: 'purchase',
    packageName: localizedPackageName(ctx, pkg.id, pkg.name),
    gbAmount: pkg.gbAmount,
    durationDays: pkg.durationDays,
    finalAmount: displayedPrice,
    originalPrice: pkg.price,
    effectivePrice: catalogDiscount.effectivePrice,
    walletAvailableBalance: balance,
    creditLimit: userPolicy.creditLimit,
    groupLabel: formatUserGroupDisplayLabel(userPolicy),
    groupDiscountPercent: groupDisc.discountPercent,
    groupDiscountAmount: groupDisc.discountAmount,
    requestedUsername,
    startOnFirstUse,
    catalogDiscount,
    promo: pendingPromo.quote?.code
      ? {
          code: pendingPromo.quote.code,
          type: pendingPromo.quote.type,
          discountAmount: promoDiscountAmount,
          bonusGb,
        }
      : undefined,
  });

  await replyInConversation(conversation, ctx, reviewScreen, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard,
  });
}

export async function buyConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  return customAmountConversation(conversation, ctx);
}

export async function customAmountConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!ctx.from?.id || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx))) return;

  const gbAmount = await promptCustomVolumeGb(conversation, ctx, { cancelDestination: 'shop' });
  if (gbAmount === undefined) return;

  // Use the admin-configured default duration instead of asking the user.
  const durationDays = await conversation.external((outsideCtx) => customDurationDays(outsideCtx));
  await executePurchaseFlow(conversation, ctx, gbAmount, durationDays);
}

export async function renewConfigConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const actorTelegramId = ctx.from?.id;
  if (!actorTelegramId || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  const isAdmin = Boolean(
    ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
  );

  const configId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.renewConfigId as string | undefined;
    outsideCtx.session.renewConfigId = undefined;
    outsideCtx.session.renewConfigUsername = undefined;
    return selected;
  });
  const config = configId
    ? await conversation.external((outsideCtx) =>
        isAdmin
          ? outsideCtx.services!.configService.getConfigById(configId)
          : outsideCtx.services!.configService.getOwnedConfigById(actorTelegramId, configId)
      )
    : undefined;
  if (!config) {
    await replyInConversation(conversation, ctx, t(ctx, 'user_not_found'));
    return;
  }

  const targetTelegramId = config.telegramId;

  // Step 1: prompt for a custom traffic quota with quick presets and configured bounds.
  const gbAmount = await promptCustomVolumeGb(conversation, ctx);
  if (gbAmount === undefined) return;

  // Use the admin-configured default duration instead of prompting for custom days
  const durationDays = await conversation.external((outsideCtx) => customDurationDays(outsideCtx));
  const customPkgId = `custom_${gbAmount}gb_${durationDays}d`;

  const { userPolicy, customQuote, catalogDiscount } = await conversation.external(
    async (outsideCtx) => {
      const services = outsideCtx?.services ?? ctx.services!;
      const policy = await safeGetEffectiveUserPolicy(services.userGroupService, targetTelegramId);
      const quote = services.pricingService.getCustomPriceQuote(gbAmount, durationDays, policy);
      const activeDiscounts = policy.allowCatalogDiscounts
        ? await safeListActiveDiscounts(services.catalogDiscountService)
        : [];
      const discount = policy.allowCatalogDiscounts
        ? resolveBestCatalogDiscount(activeDiscounts, {
            packageId: customPkgId,
            categoryId: null,
            originalPrice: quote.totalPrice,
          })
        : {
            originalPrice: quote.totalPrice,
            effectivePrice: quote.totalPrice,
            discountAmount: 0,
            activeDiscountId: null,
            activeDiscountTitle: null,
            discountExpiresAt: null,
          };
      return { userPolicy: policy, customQuote: quote, catalogDiscount: discount };
    }
  );
  const pricePerGb = customQuote.pricePerGb;
  const totalCost = catalogDiscount.effectivePrice;

  const pendingPromo = userPolicy.allowPromoCodes
    ? await conversation.external((outsideCtx) =>
        getPendingPromoPricing(outsideCtx, targetTelegramId, totalCost, gbAmount)
      )
    : {};
  if (pendingPromo.messageKey) {
    await replyInConversation(conversation, ctx, t(ctx, pendingPromo.messageKey));
    return;
  }
  const displayedCost = pendingPromo.quote?.finalAmount ?? totalCost;
  const bonusGb = Math.max(0, (pendingPromo.quote?.finalGbAmount ?? gbAmount) - gbAmount);
  const promoDiscountAmount = Math.max(0, totalCost - displayedCost);

  const balance = await conversation.external((outsideCtx) =>
    outsideCtx.services!.walletService.getAvailableBalance(targetTelegramId)
  );
  const purchasingPower = Math.max(0, balance + userPolicy.creditLimit);
  if (purchasingPower < displayedCost) {
    const createdAt = await conversation.now();
    await conversation.external((outsideCtx) => {
      outsideCtx.session.pendingTopupIntent = {
        kind: 'renew_config',
        configId: config.id,
        configUsername: config.configUsername,
        deficitAmount: Math.max(0, displayedCost - purchasingPower),
        createdAt,
      };
    });
    await replyInConversation(
      conversation,
      ctx,
      buildUnifiedInsufficientBalanceScreen(ctx, {
        packagePrice: displayedCost,
        balance,
        creditLimit: userPolicy.creditLimit,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildInsufficientBalanceKeyboard(ctx, {
          backLabelKey: 'menu_back',
          backCallback: `config:view:${config.id}`,
        }),
      }
    );
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
        telegramId: targetTelegramId,
        kind: 'renew_config',
        configId: config.id,
        pkg: {
          id: customPkgId,
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
  } catch (err) {
    const msg =
      err instanceof InventoryUnavailableError
        ? purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
        : t(ctx, 'custom_volume_unavailable');
    await replyInConversation(conversation, ctx, msg);
    return;
  }

  const rolloverActive = await conversation.external((outsideCtx) =>
    typeof outsideCtx.services?.translationService?.getSetting === 'function'
      ? renewalRolloverEnabled(outsideCtx.services.translationService)
      : true
  );
  const rolloverPreview = computeRolloverPreview({
    enabled: rolloverActive,
    addedGb: gbAmount,
    addedDays: durationDays,
    dataLimitBytes: config.panelDataLimit,
    usedTrafficBytes: config.panelUsedTraffic,
    expireTimestampSec: config.panelExpire,
    status: config.panelStatus,
    onHoldExpireDurationSec: config.panelOnHoldExpireDuration ?? null,
  });

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
      walletAvailableBalance: balance,
      creditLimit: userPolicy.creditLimit,
      groupLabel: formatUserGroupDisplayLabel(userPolicy),
      groupDiscountPercent: customQuote.groupDiscountPercent,
      groupDiscountAmount: customQuote.groupDiscountAmount,
      originalPrice: customQuote.originalPrice ?? catalogDiscount.originalPrice,
      catalogDiscount,
      promo: pendingPromo.quote?.code
        ? {
            code: pendingPromo.quote.code,
            type: pendingPromo.quote.type,
            discountAmount: promoDiscountAmount,
            bonusGb,
          }
        : undefined,
      rollover: rolloverPreview,
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const confirmChoice = await waitForCallbackInput(conversation, ['renew_confirm']);
  if (confirmChoice === undefined) return;
  // Close stale conversations if the switch changed while awaiting confirmation.
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  try {
    checkout = await conversation.external((outsideCtx) =>
      outsideCtx.services!.purchaseCheckoutService.claim(checkout.id, actorTelegramId, isAdmin)
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
    buildUserScreen({
      emoji: '⏳',
      title: t(ctx, 'renewal_processing_title'),
      subtitle: t(ctx, 'renewal_processing_subtitle'),
      primary: {
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
        inline: true,
      },
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'operation_in_progress'), 'ui:noop'),
    }
  );

  const resolvedBack =
    isAdmin && targetTelegramId !== actorTelegramId
      ? `admin:user:subscriptions:${targetTelegramId}:1`
      : 'subs:page:1';

  try {
    // This is the authoritative last check: no awaited work may occur between
    // it and entering the purchase saga.
    if (!(await requireCustomVolume(conversation, ctx, true))) {
      await conversation.external((outsideCtx) =>
        recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
      );
      return;
    }
    res = await conversation.external((outsideCtx) =>
      outsideCtx.services!.walletService.executePurchaseSaga({
        telegramId: targetTelegramId,
        amount: checkout.amount,
        maxAmount: checkout.quotedAmount,
        type: 'renew_config',
        configUsername: config.configUsername,
        gbAmount: checkout.gbAmount,
        durationDays: checkout.durationDays,
        panelId: checkout.panelId,
        serviceId: checkout.serviceId,
        packageId: checkout.packageId,
        checkoutId: checkout.id,
        ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
        allowAdminOverride: isAdmin,
      })
    );
  } catch (err: unknown) {
    await conversation.external((outsideCtx) =>
      recordCheckoutFailed(outsideCtx.services!.purchaseCheckoutService, checkout.id)
    );
    const failureText = buildUserEmptyState(
      '⚠️',
      t(ctx, 'renewal_failed_title'),
      purchaseFailureMessage(ctx.services.translationService, err, resolveContextLocale(ctx))
    );
    const failureMarkup = new InlineKeyboard().text(t(ctx, 'menu_back'), resolvedBack);
    try {
      await conversation.external(() =>
        ctx.api.editMessageText(ctx.chat!.id, progressMessage.message_id, failureText, {
          parse_mode: 'Markdown',
          reply_markup: failureMarkup,
        })
      );
    } catch {
      await replyInConversation(conversation, ctx, failureText, {
        parse_mode: 'Markdown',
        reply_markup: failureMarkup,
      });
    }
    return;
  }

  await conversation.external((outsideCtx) =>
    recordCheckoutCompleted(outsideCtx.services!.purchaseCheckoutService, checkout.id)
  );
  if (checkout.promoCode) {
    await conversation.external((outsideCtx) => clearPendingPromo(outsideCtx));
  }

  const currency = t(ctx, 'currency_toman');
  const balanceAfter = balance - checkout.quotedAmount;
  const renewalSuccessText = buildUserScreen({
    emoji: '✅',
    title: t(ctx, 'renewal_success_title'),
    subtitle: t(ctx, 'renewal_success_subtitle'),
    sections: [
      {
        bullet: '',
        fields: [
          {
            label: t(ctx, 'renewal_success_service_label'),
            value: `\`${sanitizeTelegramInlineCode(res.configUsername)}\``,
          },
          {
            label: t(ctx, 'renewal_success_package_label'),
            value: customPackageName(ctx, gbAmount, durationDays),
          },
          ...(typeof rolloverPreview.projectedTotalGb === 'number'
            ? [
                {
                  label: t(ctx, 'renewal_success_new_quota_label'),
                  value: `${localizedNumber(rolloverPreview.projectedTotalGb + bonusGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
                },
              ]
            : []),
          ...(typeof rolloverPreview.projectedTotalDays === 'number'
            ? [
                {
                  label: t(ctx, 'renewal_success_new_expiry_label'),
                  value: `${localizedNumber(rolloverPreview.projectedTotalDays, ctx)} ${t(ctx, 'days_unit')}`,
                },
              ]
            : []),
          {
            label: t(ctx, 'renewal_success_balance_label'),
            value: `${localizedNumber(balanceAfter, ctx)} ${currency}`,
          },
        ],
      },
    ],
  });
  const successMarkup = new InlineKeyboard()
    .text(t(ctx, 'subscription_view_detail'), `config:view:${config.id}`)
    .row()
    .text(t(ctx, 'menu_back'), resolvedBack);
  try {
    await conversation.external(() =>
      ctx.api.editMessageText(ctx.chat!.id, progressMessage.message_id, renewalSuccessText, {
        parse_mode: 'Markdown',
        reply_markup: successMarkup,
      })
    );
  } catch (err) {
    logger.warn(
      { errorName: err instanceof Error ? err.name : typeof err, checkoutId: checkout.id },
      'Custom renewal succeeded but its progress message could not be edited'
    );
    await replyInConversation(conversation, ctx, renewalSuccessText, {
      parse_mode: 'Markdown',
      reply_markup: successMarkup,
    });
  }
}

export async function autoRenewCustomConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const actorTelegramId = ctx.from?.id;
  if (!actorTelegramId || !ctx.services) return;
  if (!(await requireCustomVolume(conversation, ctx, true))) return;

  const isAdmin = Boolean(
    ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
  );

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
    isAdmin
      ? outsideCtx.services!.configService.getConfigById(configId)
      : outsideCtx.services!.configService.getOwnedConfigById(actorTelegramId, configId)
  );
  if (!config) {
    await replyInConversation(conversation, ctx, t(ctx, 'user_not_found'));
    return;
  }

  // Step 1: prompt for a custom traffic quota with quick presets and configured bounds.
  const gbAmount = await promptCustomVolumeGb(conversation, ctx);
  if (gbAmount === undefined) return;

  const durationDays = await conversation.external((outsideCtx) => customDurationDays(outsideCtx));
  const customPackageId = `custom_${gbAmount}gb_${durationDays}d`;
  const approvedPrice = await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? ctx.services!;
    const policy = await safeGetEffectiveUserPolicy(services.userGroupService, config.telegramId);
    return services.pricingService.getCustomPriceQuote(gbAmount, durationDays, policy).totalPrice;
  });

  await promptInConversation(
    conversation,
    ctx,
    buildUserScreen({
      emoji: '♻️',
      title: t(ctx, 'auto_renew_review_title'),
      subtitle: t(ctx, 'auto_renew_review_subtitle'),
      primary: {
        label: t(ctx, 'auto_renew_charge_label'),
        value: `${localizedNumber(approvedPrice, ctx)} ${t(ctx, 'currency_toman')}`,
        emphasizeValue: true,
      },
      sections: [
        {
          title: t(ctx, 'renewal_selection_service_label'),
          fields: [
            {
              label: t(ctx, 'checkout_service_label'),
              value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
            },
            {
              label: t(ctx, 'renewal_success_package_label'),
              value: customPackageName(ctx, gbAmount, durationDays),
            },
          ],
        },
      ],
      footer: t(ctx, 'auto_renew_review_hint'),
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'user_confirm_button'), 'autorenew:custom_confirm')
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
      config.telegramId,
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
    buildUserScreen({
      emoji: '✅',
      title: t(ctx, 'auto_renew_enabled_title'),
      subtitle: t(ctx, 'auto_renew_enabled_subtitle'),
      primary: {
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
        inline: true,
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

  const promoAllowed = await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? ctx.services!;
    const policy = await safeGetEffectiveUserPolicy(services.userGroupService, telegramId);
    return policy.allowPromoCodes;
  });
  if (!promoAllowed) {
    await finishPromoFlow();
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('🎟️', t(ctx, 'promo_title'), t(ctx, 'promo_not_allowed_for_group')),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, returnDestination) }
    );
    return;
  }

  await promptInConversation(
    conversation,
    ctx,
    buildUserPromptScreen(
      '🎟️',
      t(ctx, 'promo_title'),
      t(ctx, 'promo_input_hint'),
      t(ctx, 'promo_subtitle')
    ),
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
      minPurchaseAmount: res.minPurchaseAmount,
      maxDiscountAmount: res.maxDiscountAmount,
      selectedAt,
    };
    const hasCheckoutContext = await conversation.external((outsideCtx) => {
      outsideCtx.session.pendingPromo = pendingPromo;
      return Boolean(outsideCtx.session.promoCheckoutContext);
    });
    const navKeyboard = hasCheckoutContext
      ? new InlineKeyboard()
          .text(t(ctx, 'checkout_continue_order_button'), 'checkout:resume')
          .row()
          .text(
            t(ctx, returnDestination === 'shop' ? 'menu_back_shop' : 'menu_back_wallet'),
            `nav:${returnDestination}`
          )
      : backKeyboard(ctx, returnDestination);

    await replyInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'promo_applied_title'),
        subtitle: t(ctx, 'promo_applied_subtitle'),
        primary: {
          emoji: '🎟️',
          label: t(ctx, 'checkout_promo_section'),
          value: `\`${sanitizeTelegramInlineCode(res.code)}\``,
          inline: true,
        },
        footer: text,
      }),
      { parse_mode: 'Markdown', reply_markup: navKeyboard }
    );
    await finishPromoFlow();
    return;
  }
  await replyInConversation(
    conversation,
    ctx,
    res.success
      ? buildUserScreen({
          emoji: '✅',
          title: t(ctx, 'promo_title'),
          subtitle: text,
        })
      : buildUserEmptyState('⚠️', t(ctx, 'promo_title'), text),
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

  const sessionState = await conversation.external((outsideCtx) => {
    const state = {
      configId: outsideCtx.session.transferConfigId as string | undefined,
      ownerTelegramId: outsideCtx.session.transferConfigOwnerTelegramId as number | undefined,
    };
    outsideCtx.session.transferConfigId = undefined;
    outsideCtx.session.transferConfigOwnerTelegramId = undefined;
    return state;
  });
  if (!sessionState.configId) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_config_missing')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const ownerTelegramId = sessionState.ownerTelegramId ?? actorTelegramId;
  if (ownerTelegramId !== actorTelegramId && !ctx.services.isAdmin(actorTelegramId)) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'admin_access_denied')),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let target;
  while (!target) {
    await promptInConversation(
      conversation,
      ctx,
      buildUserPromptScreen(
        '⇄',
        t(ctx, 'transfer_title'),
        t(ctx, 'transfer_target_hint'),
        t(ctx, 'transfer_subtitle')
      ),
      { parse_mode: 'Markdown' }
    );
    const targetInput = await waitForTextInput(conversation);
    if (targetInput === undefined) return;
    const found = await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? ctx.services)!.userService.findProfile(targetInput)
    );
    if (!found) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_not_found')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    if (found.telegramId === ownerTelegramId) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_same_user')),
        { parse_mode: 'Markdown' }
      );
      continue;
    }
    if (found.isBanned) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState('⚠️', t(ctx, 'transfer_title'), t(ctx, 'transfer_target_banned')),
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
    buildUserScreen({
      emoji: '⇄',
      title: t(ctx, 'transfer_review_title'),
      subtitle: t(ctx, 'transfer_review_subtitle'),
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'transfer_recipient_label'),
              value: target.username
                ? `@${escapeTelegramMarkdown(target.username)}`
                : `\`${target.telegramId}\``,
            },
            {
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
    const result = await conversation.external((outsideCtx) =>
      outsideCtx.services!.configTransferService.transfer({
        configId: sessionState.configId!,
        fromTelegramId: ownerTelegramId,
        toTelegramId: target.telegramId,
        actorTelegramId,
        allowAdminOverride: ownerTelegramId !== actorTelegramId,
      })
    );
    await replyInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'transfer_success_title'),
        subtitle: t(ctx, 'transfer_success_subtitle'),
        primary: {
          label: t(ctx, 'transfer_service_label'),
          value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
          inline: true,
        },
        sections: [
          {
            fields: [
              {
                label: t(ctx, 'transfer_recipient_label'),
                value: target.username
                  ? `@${escapeTelegramMarkdown(target.username)}`
                  : `\`${target.telegramId}\``,
              },
              {
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
      const recipientLocale = await conversation.external(
        async (outsideCtx) =>
          (await (outsideCtx?.services ?? ctx.services)!.userService.getLocale(
            target.telegramId
          )) ?? resolveContextLocale(ctx)
      );
      await conversation.external(() =>
        ctx.api.sendMessage(
          target.telegramId,
          buildUserScreen({
            emoji: '🎁',
            title: tForLocale(
              ctx.services!.translationService,
              recipientLocale,
              'transfer_recipient_notice_title'
            ),
            subtitle: tForLocale(
              ctx.services!.translationService,
              recipientLocale,
              'transfer_recipient_notice_subtitle'
            ),
            primary: {
              label: tForLocale(
                ctx.services!.translationService,
                recipientLocale,
                'transfer_service_label'
              ),
              value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
              inline: true,
            },
            sections: [
              {
                fields: [
                  {
                    label: tForLocale(
                      ctx.services!.translationService,
                      recipientLocale,
                      'transfer_sender_label'
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
              tForLocale(
                ctx.services!.translationService,
                recipientLocale,
                'menu_my_subscriptions'
              ),
              'subs:page:1'
            ),
          }
        )
      );
    } catch {
      // Transfer ownership is authoritative even if Telegram delivery is blocked.
    }
  } catch (err) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
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

/** Add, edit, or remove a private personal label (`user_label`) on an owned service. */
export async function editConfigLabelConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const actorTelegramId = ctx.from?.id;
  if (!actorTelegramId || !ctx.services) return;

  const initial = await conversation.external(async (outsideCtx) => {
    const targetCtx = outsideCtx ?? ctx;
    const services = targetCtx.services!;
    const configId = targetCtx.session.labelConfigId;
    targetCtx.session.labelConfigId = undefined;
    if (!configId) return { config: null as null, isAdmin: false };
    const isAdmin = typeof services.isAdmin === 'function' && services.isAdmin(actorTelegramId);
    const config = isAdmin
      ? await services.configService.getConfigById(configId)
      : await services.configService.getOwnedConfigById(actorTelegramId, configId);
    return { config: config ?? null, isAdmin };
  });

  if (!initial.config) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '⚠️',
        t(ctx, 'subscription_label_prompt_title'),
        t(ctx, 'config_not_owned')
      ),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const config = initial.config;
  const promptKeyboard = new InlineKeyboard();
  if (config.userLabel) {
    promptKeyboard.text(t(ctx, 'subscription_label_clear_button'), 'label:clear').row();
  }
  promptKeyboard.text(t(ctx, 'menu_back'), 'conversation:cancel');

  const promptScreen = buildUserScreen({
    emoji: '🏷️',
    title: t(ctx, 'subscription_label_prompt_title'),
    subtitle: t(ctx, 'subscription_label_prompt_subtitle'),
    primary: {
      label: t(ctx, 'checkout_service_label'),
      value: formatTelegramConfigRef(config.configUsername, config.userLabel),
      inline: true,
    },
    sections: [
      {
        bullet: '',
        fields: [
          {
            label: t(ctx, 'subscription_label_current_field'),
            value: config.userLabel
              ? escapeTelegramMarkdown(config.userLabel)
              : t(ctx, 'subscription_label_none'),
          },
        ],
      },
    ],
    footer: t(ctx, 'subscription_label_prompt_hint'),
  });

  await promptInConversation(conversation, ctx, promptScreen, {
    parse_mode: 'Markdown',
    reply_markup: promptKeyboard,
  });

  for (;;) {
    const input = await waitForTextOrCallbackInput(conversation, ['label:clear'], 'main');
    if (!input) return;

    if (input.type === 'callback' && input.data === 'label:clear') {
      const cleared = await conversation.external(async (outsideCtx) => {
        const services = (outsideCtx ?? ctx).services!;
        return services.configService.setUserLabel(config.telegramId, config.id, null, {
          allowAdminOverride: initial.isAdmin,
        });
      });
      if (!cleared) {
        await replyInConversation(
          conversation,
          ctx,
          buildUserEmptyState(
            '⚠️',
            t(ctx, 'subscription_label_prompt_title'),
            t(ctx, 'config_not_owned')
          ),
          { parse_mode: 'Markdown' }
        );
        return;
      }
      await replyInConversation(
        conversation,
        ctx,
        buildUserScreen({
          emoji: '🗑',
          title: t(ctx, 'subscription_label_prompt_title'),
          subtitle: t(ctx, 'subscription_label_cleared'),
          primary: {
            label: t(ctx, 'checkout_service_label'),
            value: formatTelegramConfigRef(cleared.configUsername, null),
            inline: true,
          },
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'subscription_view_detail'), callbackData('config', 'view', config.id))
            .row()
            .text(t(ctx, 'menu_my_configs'), 'subs:page:1'),
        }
      );
      return;
    }

    if (input.type !== 'text') continue;

    const sanitized = sanitizeConfigUserLabel(input.text);
    if (!sanitized.valid) {
      const errorMsg =
        sanitized.reason === 'too_long'
          ? t(ctx, 'subscription_label_too_long', {
              max: localizedNumber(MAX_CONFIG_USER_LABEL_LENGTH, ctx),
            })
          : t(ctx, 'subscription_label_invalid');
      await promptInConversation(conversation, ctx, errorMsg, {
        parse_mode: 'Markdown',
        preferEdit: false,
        reply_markup: promptKeyboard,
      });
      continue;
    }

    const saved = await conversation.external(async (outsideCtx) => {
      const services = (outsideCtx ?? ctx).services!;
      return services.configService.setUserLabel(config.telegramId, config.id, sanitized.value, {
        allowAdminOverride: initial.isAdmin,
      });
    });

    if (!saved) {
      await replyInConversation(
        conversation,
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'subscription_label_prompt_title'),
          t(ctx, 'config_not_owned')
        ),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await replyInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: saved.userLabel ? '✅' : '🗑',
        title: t(ctx, 'subscription_label_prompt_title'),
        subtitle: saved.userLabel
          ? t(ctx, 'subscription_label_saved', {
              label: escapeTelegramMarkdown(saved.userLabel),
            })
          : t(ctx, 'subscription_label_cleared'),
        primary: {
          label: t(ctx, 'checkout_service_label'),
          value: formatTelegramConfigRef(saved.configUsername, saved.userLabel),
          inline: true,
        },
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'subscription_view_detail'), callbackData('config', 'view', config.id))
          .row()
          .text(t(ctx, 'menu_my_configs'), 'subs:page:1'),
      }
    );
    return;
  }
}

/** Transfer available wallet balance to another bot user. */
export async function transferBalanceConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const senderTelegramId = ctx.from?.id;
  if (!senderTelegramId || !ctx.services) return;

  const isEnabled = await conversation.external((outsideCtx) =>
    walletTransferEnabled((outsideCtx?.services ?? ctx.services)!.translationService)
  );
  if (!isEnabled) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '⚠️',
        t(ctx, 'wallet_transfer_title'),
        t(ctx, 'wallet_transfer_disabled')
      ),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const { senderBalance, minAmount } = await conversation.external(async (outsideCtx) => {
    const services = (outsideCtx?.services ?? ctx.services)!;
    const ws = services.walletService;
    return {
      senderBalance: ws.getAvailableBalance
        ? await ws.getAvailableBalance(senderTelegramId)
        : await ws.getBalance(senderTelegramId),
      minAmount: walletTransferMinAmount(services.translationService),
    };
  });

  if (senderBalance < minAmount) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '💳',
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
      buildUserPromptScreen(
        '💸',
        t(ctx, 'wallet_transfer_title'),
        t(ctx, 'wallet_transfer_target_hint'),
        t(ctx, 'wallet_transfer_subtitle')
      ),
      { parse_mode: 'Markdown' }
    );

    const targetInput = await waitForTextInput(conversation);
    if (targetInput === undefined) return;

    const found = await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? ctx.services)!.userService.findProfile(targetInput)
    );
    if (!found) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'transfer_target_not_found')
        ),
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    if (found.telegramId === senderTelegramId) {
      await promptInConversation(
        conversation,
        ctx,
        buildUserEmptyState(
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
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'wallet_transfer_title'),
          t(ctx, 'transfer_target_banned')
        ),
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
      buildUserScreen({
        emoji: '💳',
        title: t(ctx, 'wallet_transfer_title'),
        subtitle: t(ctx, 'wallet_transfer_amount_prompt'),
        primary: {
          label: t(ctx, 'wallet_available_balance'),
          value: `${localizedNumber(senderBalance, ctx)} ${t(ctx, 'currency_toman')}`,
          emphasizeValue: true,
        },
        sections: [
          {
            fields: [
              {
                label: t(ctx, 'wallet_transfer_recipient_label'),
                value: target.username
                  ? `@${escapeTelegramMarkdown(target.username)}`
                  : `\`${target.telegramId}\``,
              },
            ],
          },
        ],
        footer: t(ctx, 'wallet_transfer_min_amount_hint', { min: localizedNumber(minAmount, ctx) }),
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
        buildUserEmptyState(
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
        buildUserEmptyState(
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
        buildUserEmptyState(
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
    buildUserScreen({
      emoji: '💸',
      title: t(ctx, 'wallet_transfer_review_title'),
      subtitle: t(ctx, 'wallet_transfer_review_subtitle'),
      primary: {
        label: t(ctx, 'wallet_transfer_amount_label'),
        value: `${localizedNumber(parsedAmount, ctx)} ${t(ctx, 'currency_toman')}`,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'wallet_transfer_recipient_label'),
              value: target.username
                ? `@${escapeTelegramMarkdown(target.username)}`
                : `\`${target.telegramId}\``,
            },
            {
              label: t(ctx, 'transfer_recipient_id_label'),
              value: `\`${target.telegramId}\``,
            },
            {
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
    const result = await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? ctx.services)!.walletService.transferBalance({
        fromTelegramId: senderTelegramId,
        toTelegramId: target.telegramId,
        amount: parsedAmount,
      })
    );

    // Notify sender of success
    await replyInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'wallet_transfer_success_title'),
        subtitle: t(ctx, 'wallet_transfer_success_subtitle'),
        primary: {
          label: t(ctx, 'wallet_transfer_amount_label'),
          value: `${localizedNumber(result.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          emphasizeValue: true,
        },
        sections: [
          {
            fields: [
              {
                label: t(ctx, 'wallet_transfer_recipient_label'),
                value: target.username
                  ? `@${escapeTelegramMarkdown(target.username)}`
                  : `\`${target.telegramId}\``,
              },
              {
                label: t(ctx, 'transfer_recipient_id_label'),
                value: `\`${target.telegramId}\``,
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
      const recipientLocale = await conversation.external(
        async (outsideCtx) =>
          (await (outsideCtx?.services ?? ctx.services)!.userService.getLocale(
            target.telegramId
          )) ?? resolveContextLocale(ctx)
      );
      await conversation.external(() =>
        ctx.api.sendMessage(
          target.telegramId,
          buildUserScreen({
            emoji: '🎁',
            title: tForLocale(
              ctx.services!.translationService,
              recipientLocale,
              'wallet_transfer_recipient_notice_title'
            ),
            subtitle: tForLocale(
              ctx.services!.translationService,
              recipientLocale,
              'wallet_transfer_recipient_notice_subtitle'
            ),
            primary: {
              label: tForLocale(
                ctx.services!.translationService,
                recipientLocale,
                'wallet_transfer_amount_label'
              ),
              value: `${localizedNumberForLocale(result.amount, recipientLocale)} ${tForLocale(ctx.services!.translationService, recipientLocale, 'currency_toman')}`,
              emphasizeValue: true,
            },
            sections: [
              {
                fields: [
                  {
                    label: tForLocale(
                      ctx.services!.translationService,
                      recipientLocale,
                      'wallet_transfer_sender_label'
                    ),
                    value: `\`${senderTelegramId}\``,
                  },
                  {
                    label: tForLocale(
                      ctx.services!.translationService,
                      recipientLocale,
                      'wallet_available_balance'
                    ),
                    value: `${localizedNumberForLocale(result.toBalanceAfter, recipientLocale)} ${tForLocale(ctx.services!.translationService, recipientLocale, 'currency_toman')}`,
                  },
                ],
              },
            ],
          }),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text(
              tForLocale(ctx.services!.translationService, recipientLocale, 'menu_wallet'),
              'nav:wallet'
            ),
          }
        )
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
      buildUserEmptyState('⚠️', t(ctx, 'wallet_transfer_title'), t(ctx, errorKey)),
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Privacy-first Telegram phone verification conversation.
 * Verifies ownership (`contact.user_id === from.id`) and stores ONLY an HMAC-SHA256 hash.
 */
export async function verifyPhoneConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ctx.services) return;

  const returnAction = await conversation.external((outsideCtx) => {
    const action = outsideCtx?.session?.phoneVerifyReturnAction;
    if (outsideCtx?.session) {
      delete outsideCtx.session.phoneVerifyReturnAction;
    }
    return action;
  });

  const phoneKeyboard = new Keyboard()
    .requestContact(t(ctx, 'button_share_phone'))
    .row()
    .text(t(ctx, 'button_cancel_phone'))
    .resized()
    .oneTime();

  const reasonText =
    returnAction === 'trial'
      ? t(ctx, 'trial_phone_required')
      : returnAction === 'shop' || returnAction === 'custom_amount'
        ? t(ctx, 'purchase_phone_required')
        : undefined;

  const promptScreen = buildUserScreen({
    emoji: '📱',
    title: t(ctx, 'onboarding_phone_verify_title'),
    ...(reasonText ? { subtitle: reasonText } : {}),
    footer: t(ctx, 'onboarding_phone_verify_prompt'),
  });

  const trackPromptMessage = async (msg: { message_id?: number } | undefined) => {
    if (!msg || typeof msg.message_id !== 'number') return;
    const messageId = msg.message_id;
    await conversation.external((outsideCtx) => {
      if (outsideCtx?.session) {
        rememberUiMessage(outsideCtx.session, messageId, 'prompt');
      }
    });
  };

  const promptMsg = await ctx.reply(promptScreen, {
    parse_mode: 'Markdown',
    reply_markup: phoneKeyboard,
  });
  await trackPromptMessage(promptMsg);

  const ownerId = await conversationOwnerId(conversation);
  const cancelLabel = t(ctx, 'button_cancel_phone').trim();

  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;

    const text = input.message?.text?.trim();
    const isCancelText =
      text === '/cancel' || text === cancelLabel || text === t(input, 'button_cancel_phone').trim();
    const isCancelCallback = input.callbackQuery?.data === 'conversation:cancel';

    if (isCancelText || isCancelCallback) {
      if (isCancelCallback) {
        await input.answerCallbackQuery({ text: t(input, 'operation_cancelled') });
      } else if (input.api && typeof input.api.deleteMessage === 'function') {
        await deleteConsumedInputMessage(input);
      }
      const cancelMsg = await input.reply(t(input, 'operation_cancelled'), {
        reply_markup: { remove_keyboard: true },
      });
      await trackPromptMessage(cancelMsg);

      const cancelNavKeyboard = new InlineKeyboard();
      if (returnAction === 'shop' || returnAction === 'custom_amount') {
        cancelNavKeyboard.text(t(input, 'menu_back_shop'), 'nav:shop').row();
      }
      cancelNavKeyboard.text(t(input, 'menu_back_main'), 'nav:main');

      await replyInConversation(conversation, input, t(input, 'navigation_continue_hint'), {
        preferEdit: false,
        reply_markup: cancelNavKeyboard,
      });
      return;
    }

    const navData = input.callbackQuery?.data ?? '';
    if (
      (text && /^\/[a-z][a-z0-9_]*(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text)) ||
      /^(?:nav:|adm:)/u.test(navData)
    ) {
      const cleanupKbMsg = await input.reply(t(input, 'operation_cancelled'), {
        reply_markup: { remove_keyboard: true },
      });
      await trackPromptMessage(cleanupKbMsg);
    }

    await forwardConversationNavigation(conversation, input);

    if (input.callbackQuery) {
      await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
      continue;
    }

    const contact = input.message?.contact;
    if (!contact || !contact.phone_number) {
      if (input.api && typeof input.api.deleteMessage === 'function') {
        await deleteConsumedInputMessage(input);
      }
      const invalidMsg = await input.reply(t(input, 'onboarding_phone_invalid'), {
        parse_mode: 'Markdown',
        reply_markup: phoneKeyboard,
      });
      await trackPromptMessage(invalidMsg);
      continue;
    }

    const senderId = input.from?.id ?? ownerId ?? userId;
    if (input.api && typeof input.api.deleteMessage === 'function') {
      await deleteConsumedInputMessage(input);
    }

    // CRITICAL SECURITY CHECK: reject forwarded or third-party contacts.
    if (!senderId || contact.user_id !== senderId) {
      const notOwnerMsg = await input.reply(t(input, 'onboarding_phone_not_owner'), {
        parse_mode: 'Markdown',
        reply_markup: phoneKeyboard,
      });
      await trackPromptMessage(notOwnerMsg);
      continue;
    }

    const result = await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? ctx.services!;
      const verificationService =
        services.contactVerificationService ??
        new ContactVerificationService({
          translationService: services.translationService,
        });
      return verificationService.verifyAndBindPhone({
        telegramId: senderId,
        rawPhoneNumber: contact.phone_number,
      });
    });

    if (!result.ok) {
      const errorKey =
        result.reason === 'iran_only'
          ? 'onboarding_phone_iran_only'
          : result.reason === 'already_bound'
            ? 'onboarding_phone_already_bound'
            : 'onboarding_phone_invalid';
      const errMsg = await input.reply(t(input, errorKey), {
        parse_mode: 'Markdown',
        reply_markup: phoneKeyboard,
      });
      await trackPromptMessage(errMsg);
      continue;
    }

    const verifiedMsg = await input.reply(t(input, 'onboarding_phone_verified_success'), {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true },
    });
    await trackPromptMessage(verifiedMsg);

    const continueKeyboard = new InlineKeyboard();
    if (returnAction === 'trial') {
      continueKeyboard.text(t(input, 'trial_start_button'), 'trial:claim').row();
    } else if (returnAction === 'shop' || returnAction === 'custom_amount') {
      continueKeyboard.text(t(input, 'menu_back_shop'), 'nav:shop').row();
    }
    continueKeyboard.text(t(input, 'menu_back_main'), 'nav:main');

    await replyInConversation(conversation, input, t(input, 'navigation_continue_hint'), {
      preferEdit: false,
      reply_markup: continueKeyboard,
    });
    return;
  }
}
