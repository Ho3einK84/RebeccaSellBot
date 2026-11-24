/** Durable purchase confirmation and checkout promo-resume routes. Renewal routes live with subscriptions. */

import { InlineKeyboard, type Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { PurchaseCheckoutUnavailableError } from '../../domain/services/PurchaseCheckoutService.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
} from '../../domain/services/CatalogDiscountService.js';
import { onHoldDefaultEnabled } from '../../domain/services/FeatureSettings.js';
import type { PackageOption } from '../../domain/services/PricingService.js';
import { clearPendingPromo, getPendingPromoPricing } from '../promoSelection.js';
import { purchaseFailureMessage } from '../purchaseFeedback.js';
import {
  formatSubscriptionLink,
  localizedPackageName,
  resolveContextLocale,
  t,
} from '../locale.js';
import {
  backKeyboard,
  buildUserEmptyState,
  buildUserScreen,
  rememberArtifactMessage,
  renderScreen,
} from '../ui.js';
import {
  buildInsufficientBalanceKeyboard,
  buildUnifiedInsufficientBalanceScreen,
} from '../checkoutRenderer.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import { logger } from '../../infra/logger.js';
import { recordCheckoutCompleted, recordCheckoutFailed } from '../checkoutLifecycle.js';
import {
  buildPurchaseCheckoutScreen,
  renderShopMenuText,
  shopMenu,
} from '../keyboards/mainMenu.js';
import { renderRenewalCheckoutForPackage } from './subscriptions/routes.js';
import { enforceForcedJoin } from '../middleware/forcedJoin.js';
import { callbackData } from '../callbackData.js';

async function renderResumedCheckout(ctx: MenuContext, services: BotServices): Promise<boolean> {
  const telegramId = ctx.from?.id;
  const context = ctx.session.promoCheckoutContext;
  if (!telegramId || !context) return false;

  if (context.kind === 'renew_config') {
    return renderRenewalCheckoutForPackage(ctx, context.configId, context.packageId);
  }

  const pkg = services.pricingService.getPackageById(context.packageId);
  if (!pkg || pkg.enabled === false) {
    delete ctx.session.promoCheckoutContext;
    return false;
  }

  const activeDiscounts = await safeListActiveDiscounts(services.catalogDiscountService);
  const liveDiscount = resolveBestCatalogDiscount(activeDiscounts, {
    packageId: pkg.id,
    categoryId: pkg.categoryId ?? null,
    originalPrice: pkg.price,
  });
  const effectivePkg: PackageOption =
    liveDiscount.discountAmount > 0 ? { ...pkg, price: liveDiscount.effectivePrice } : pkg;

  const pendingPromo = await getPendingPromoPricing(
    ctx,
    telegramId,
    effectivePkg.price,
    pkg.gbAmount
  );
  if (pendingPromo.messageKey) {
    await renderScreen(
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'purchase_review_title'), t(ctx, pendingPromo.messageKey)),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'shop') }
    );
    return true;
  }

  const displayedPrice = pendingPromo.quote?.finalAmount ?? effectivePkg.price;
  const bonusGb = pendingPromo.quote
    ? Math.max(0, pendingPromo.quote.finalGbAmount - pkg.gbAmount)
    : 0;
  const balance =
    typeof services.walletService.getAvailableBalance === 'function'
      ? await services.walletService.getAvailableBalance(telegramId)
      : await services.walletService.getBalance(telegramId);

  if (balance < displayedPrice) {
    ctx.session.pendingTopupIntent = {
      kind: 'new_config',
      packageId: pkg.id,
      deficitAmount: displayedPrice - balance,
      createdAt: Date.now(),
    };
    await renderScreen(
      ctx,
      buildUnifiedInsufficientBalanceScreen(ctx, {
        packagePrice: displayedPrice,
        balance,
        includePromoHint: true,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildInsufficientBalanceKeyboard(ctx, {
          backLabelKey: 'menu_back_shop',
          backCallback: 'nav:shop',
          promoCallback: 'shop:apply_promo',
        }),
      }
    );
    return true;
  }

  let checkout;
  try {
    checkout = await services.purchaseCheckoutService.create({
      telegramId,
      kind: 'new_config',
      pkg: effectivePkg,
      promoCode: pendingPromo.promoCode,
      ...(context.requestedUsername ? { requestedUsername: context.requestedUsername } : {}),
      quotedAmount: displayedPrice,
    });
  } catch {
    await renderScreen(
      ctx,
      buildUserEmptyState(
        '⚠️',
        t(ctx, 'purchase_review_title'),
        t(ctx, 'purchase_target_unavailable')
      ),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'shop') }
    );
    return true;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'buy_confirm_button'), `buy:confirm:${checkout.id}`)
    .row();
  if (pendingPromo.quote?.code) {
    confirmKeyboard
      .text(t(ctx, 'shop_change_promo_button'), `checkout:promo:${checkout.id}`)
      .text(t(ctx, 'shop_clear_promo_button'), `checkout:clear_promo:${checkout.id}`)
      .row();
  } else {
    confirmKeyboard.text(t(ctx, 'shop_apply_promo_button'), `checkout:promo:${checkout.id}`).row();
  }
  confirmKeyboard.text(t(ctx, 'menu_back_shop'), 'nav:shop');

  await renderScreen(
    ctx,
    buildPurchaseCheckoutScreen(
      ctx,
      pkg,
      displayedPrice,
      pendingPromo.quote?.code,
      balance,
      liveDiscount,
      { bonusGb, requestedUsername: context.requestedUsername }
    ),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );
  return true;
}

export function registerPurchaseRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery(/^buy:confirm:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    const telegramId = ctx.from.id;

    if (await enforceForcedJoin(ctx, 'purchase', { kind: 'shop' })) {
      return;
    }

    let checkout;
    try {
      checkout = await services.purchaseCheckoutService.claim(ctx.match[1]!, telegramId);
    } catch (error) {
      await ctx.answerCallbackQuery({
        text: t(
          ctx,
          error instanceof PurchaseCheckoutUnavailableError
            ? 'purchase_confirmation_expired'
            : 'button_action_failed'
        ),
        show_alert: true,
      });
      return;
    }

    const availableBalance = await services.walletService.getAvailableBalance(telegramId);
    if (availableBalance < checkout.quotedAmount) {
      await recordCheckoutFailed(services.purchaseCheckoutService, checkout.id);
      ctx.session.pendingTopupIntent = {
        kind: 'new_config',
        packageId: checkout.packageId,
        deficitAmount: checkout.quotedAmount - availableBalance,
        createdAt: Date.now(),
      };
      await ctx.answerCallbackQuery({ text: t(ctx, 'insufficient_balance'), show_alert: true });
      await renderScreen(
        ctx,
        buildUnifiedInsufficientBalanceScreen(ctx, {
          packagePrice: checkout.quotedAmount,
          balance: availableBalance,
          includePromoHint: false,
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: buildInsufficientBalanceKeyboard(ctx, {
            backLabelKey: 'menu_back_shop',
            backCallback: 'shop:open',
          }),
        }
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    await renderScreen(
      ctx,
      buildUserScreen({
        emoji: '⏳',
        title: t(ctx, 'purchase_issuing_title'),
        subtitle: t(ctx, 'purchase_issuing_subtitle'),
        primary: {
          label: t(ctx, 'purchase_issuing_package_label'),
          value: escapeTelegramMarkdown(
            localizedPackageName(ctx, checkout.packageId, checkout.packageName)
          ),
          inline: true,
        },
        ...(checkout.promoCode
          ? {
              sections: [
                {
                  emoji: '🎟️',
                  title: t(ctx, 'checkout_promo_section'),
                  fields: [
                    {
                      label: t(ctx, 'shop_promo_section'),
                      value: `\`${sanitizeTelegramInlineCode(checkout.promoCode)}\``,
                    },
                  ],
                },
              ],
            }
          : {}),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          t(ctx, 'operation_in_progress'),
          'purchase:pending'
        ),
      }
    );

    const resolvedPkg =
      typeof services.pricingService?.getPackageById === 'function'
        ? services.pricingService.getPackageById(checkout.packageId)
        : undefined;

    let result: Awaited<ReturnType<BotServices['walletService']['executePurchaseSaga']>>;
    try {
      const configName = checkout.requestedUsername
        ? await services.configService.resolveCustomConfigName(
            checkout.requestedUsername,
            checkout.panelId
          )
        : await services.configService.generateConfigName(telegramId, checkout.panelId);
      result = await services.walletService.executePurchaseSaga({
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
        ...(resolvedPkg?.startOnFirstUse !== undefined
          ? { startOnFirstUse: resolvedPkg.startOnFirstUse }
          : {}),
      });
    } catch (error) {
      trackFunnelEvent('purchase_failed');
      await recordCheckoutFailed(services.purchaseCheckoutService, checkout.id);
      if (checkout.promoCode) clearPendingPromo(ctx);
      await renderScreen(
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'purchase_failed_title'),
          purchaseFailureMessage(services.translationService, error, resolveContextLocale(ctx))
        ),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'shop') }
      );
      return;
    }

    await recordCheckoutCompleted(services.purchaseCheckoutService, checkout.id);
    if (checkout.promoCode) clearPendingPromo(ctx);
    delete ctx.session.promoCheckoutContext;
    delete ctx.session.pendingTopupIntent;
    trackFunnelEvent('purchase_confirm');

    const defaultOnHold =
      typeof services.translationService?.getSetting === 'function'
        ? onHoldDefaultEnabled(services.translationService)
        : false;
    const isOnHold = resolvedPkg?.startOnFirstUse ?? defaultOnHold;

    const successText = buildUserScreen({
      emoji: '🎉',
      title: t(ctx, 'purchase_success_title'),
      subtitle: t(ctx, 'purchase_success_subtitle'),
      primary: {
        emoji: '🔗',
        label: t(ctx, 'purchase_success_link_label'),
        value: formatSubscriptionLink(result.subUrl, t(ctx, 'subscription_link_unavailable')),
      },
      sections: [
        {
          bullet: '',
          fields: [
            {
              label: t(ctx, 'purchase_success_service_label'),
              value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
            },
            {
              label: t(ctx, 'purchase_success_package_label'),
              value: escapeTelegramMarkdown(
                localizedPackageName(ctx, checkout.packageId, checkout.packageName)
              ),
            },
          ],
        },
      ],
      ...(isOnHold ? { footer: t(ctx, 'purchase_success_on_hold_note') } : {}),
    });
    try {
      await renderScreen(ctx, successText, { parse_mode: 'Markdown', role: 'artifact' });
    } catch (err) {
      logger.warn(
        { errorName: err instanceof Error ? err.name : typeof err, checkoutId: checkout.id },
        'Purchase succeeded but its confirmation message could not be edited'
      );
      const artifact = await ctx.reply(successText, { parse_mode: 'Markdown' });
      rememberArtifactMessage(ctx.session, artifact.message_id);
    }

    let createdConfigId: string | undefined;
    if (typeof services.configService?.getOwnedConfigByUsername === 'function') {
      try {
        const owned = await services.configService.getOwnedConfigByUsername(
          telegramId,
          result.configUsername,
          checkout.panelId
        );
        createdConfigId = owned?.id;
      } catch {
        createdConfigId = undefined;
      }
    }

    const navKeyboard = new InlineKeyboard();
    if (createdConfigId) {
      navKeyboard
        .text(t(ctx, 'subscription_qr_button'), callbackData('config', 'qr', createdConfigId))
        .text(t(ctx, 'subscription_view_detail'), callbackData('config', 'view', createdConfigId))
        .row();
    }
    navKeyboard
      .text(t(ctx, 'menu_my_configs'), 'subs:page:1')
      .row()
      .text(t(ctx, 'menu_back_main'), 'nav:main');

    await ctx.reply(t(ctx, 'navigation_continue_hint'), {
      reply_markup: navKeyboard,
    });
  });

  bot.callbackQuery('purchase:pending', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
  });

  bot.callbackQuery('shop:apply_promo', async (ctx) => {
    ctx.session.promoReturnDestination = 'shop';
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('promoConversation');
  });

  bot.callbackQuery(/^checkout:promo:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    ctx.session.promoReturnDestination = 'shop';
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('promoConversation');
  });

  bot.callbackQuery(/^checkout:clear_promo:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    clearPendingPromo(ctx);
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
    if (await renderResumedCheckout(ctx, services)) {
      return;
    }
    await renderScreen(ctx, await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  bot.callbackQuery('checkout:resume', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (await renderResumedCheckout(ctx, services)) {
      return;
    }
    await renderScreen(ctx, await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  // Buttons emitted by pre-upgrade deployments carried package indexes or
  // usernames and cannot prove a frozen price/panel target. Expire them rather
  // than executing a financially ambiguous legacy callback.
  bot.callbackQuery(
    /^(?:renew_low:|renew_pkg:|renew_confirm_pkg:|renew_custom:|buy:confirm:\d)/u,
    async (ctx) => {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'purchase_confirmation_expired'),
        show_alert: true,
      });
    }
  );
}
