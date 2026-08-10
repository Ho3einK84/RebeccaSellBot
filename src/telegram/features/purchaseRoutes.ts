/** Durable purchase confirmation route. Renewal routes live with subscriptions. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { PurchaseCheckoutUnavailableError } from '../../domain/services/PurchaseCheckoutService.js';
import { clearPendingPromo } from '../promoSelection.js';
import { purchaseFailureMessage } from '../purchaseFeedback.js';
import { formatSubscriptionLink, localizedNumber, resolveContextLocale, t, tm } from '../locale.js';
import { backKeyboard, rememberArtifactMessage } from '../ui.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';

export function registerPurchaseRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery(/^buy:confirm:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    const telegramId = ctx.from.id;
    const chatId = ctx.chat?.id;
    if (!chatId) return;

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

    if ((await services.walletService.getBalance(telegramId)) < checkout.quotedAmount) {
      await services.purchaseCheckoutService.fail(checkout.id);
      await ctx.answerCallbackQuery({ text: t(ctx, 'insufficient_balance'), show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const progressMessage = await ctx.reply(
      checkout.promoCode
        ? t(ctx, 'purchase_issuing_with_promo', {
            package_name: checkout.packageName,
            promo_code: checkout.promoCode,
            amount: localizedNumber(checkout.quotedAmount, ctx),
          })
        : t(ctx, 'purchase_issuing', { package_name: checkout.packageName })
    );

    try {
      const configName = await services.configService.generateConfigName(
        telegramId,
        checkout.panelId
      );
      const result = await services.walletService.executePurchaseSaga({
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
      await services.purchaseCheckoutService.complete(checkout.id);
      if (checkout.promoCode) clearPendingPromo(ctx);
      trackFunnelEvent('purchase_confirm');

      const createdMsg = await ctx.api.editMessageText(
        chatId,
        progressMessage.message_id,
        tm(ctx, 'config_created', {
          sub_url: formatSubscriptionLink(result.subUrl, t(ctx, 'subscription_link_unavailable')),
        }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
      if (typeof createdMsg === 'object' && createdMsg && 'message_id' in createdMsg) {
        rememberArtifactMessage(ctx.session, createdMsg.message_id);
      }
    } catch (error) {
      trackFunnelEvent('purchase_failed');
      await services.purchaseCheckoutService.fail(checkout.id);
      await ctx.api.editMessageText(
        chatId,
        progressMessage.message_id,
        purchaseFailureMessage(services.translationService, error, resolveContextLocale(ctx)),
        { reply_markup: backKeyboard(ctx, 'main') }
      );
    }
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
