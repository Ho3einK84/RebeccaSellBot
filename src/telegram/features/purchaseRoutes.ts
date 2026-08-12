/** Durable purchase confirmation route. Renewal routes live with subscriptions. */

import { InlineKeyboard, type Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { PurchaseCheckoutUnavailableError } from '../../domain/services/PurchaseCheckoutService.js';
import { clearPendingPromo } from '../promoSelection.js';
import { purchaseFailureMessage } from '../purchaseFeedback.js';
import { formatSubscriptionLink, resolveContextLocale, t } from '../locale.js';
import { backKeyboard, buildEmptyState, buildScreen, rememberArtifactMessage } from '../ui.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';
import { escapeTelegramMarkdown } from '../rendering.js';

export function registerPurchaseRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery(/^buy:confirm:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    const telegramId = ctx.from.id;

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
      await ctx.editMessageText(
        buildEmptyState('⚠️', t(ctx, 'insufficient_balance_title'), t(ctx, 'insufficient_balance')),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'direct_topup_button'), 'topup:direct')
            .row()
            .text(t(ctx, 'menu_back'), 'shop:open'),
        }
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    await ctx.editMessageText(
      buildScreen({
        emoji: '⏳',
        title: t(ctx, 'purchase_issuing_title'),
        subtitle: t(ctx, 'purchase_issuing_subtitle'),
        primary: {
          emoji: '📦',
          label: t(ctx, 'purchase_issuing_package_label'),
          value: escapeTelegramMarkdown(checkout.packageName),
        },
        ...(checkout.promoCode
          ? {
              sections: [
                {
                  emoji: '🎟️',
                  title: t(ctx, 'checkout_promo_section'),
                  fields: [
                    {
                      emoji: '🎟️',
                      label: t(ctx, 'shop_promo_section'),
                      value: `\`${escapeTelegramMarkdown(checkout.promoCode)}\``,
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

      await ctx.editMessageText(
        buildScreen({
          emoji: '🎉',
          title: t(ctx, 'purchase_success_title'),
          subtitle: t(ctx, 'purchase_success_subtitle'),
          primary: {
            emoji: '🔗',
            label: t(ctx, 'purchase_success_link_label'),
            value: formatSubscriptionLink(result.subUrl, t(ctx, 'subscription_link_unavailable')),
          },
        }),
        { parse_mode: 'Markdown' }
      );
      if (ctx.callbackQuery?.message) {
        rememberArtifactMessage(ctx.session, ctx.callbackQuery.message.message_id);
      }
      await ctx.reply(t(ctx, 'navigation_continue_hint'), {
        reply_markup: backKeyboard(ctx, 'main'),
      });
    } catch (error) {
      trackFunnelEvent('purchase_failed');
      await services.purchaseCheckoutService.fail(checkout.id);
      await ctx.editMessageText(
        buildEmptyState(
          '⚠️',
          t(ctx, 'purchase_failed_title'),
          purchaseFailureMessage(services.translationService, error, resolveContextLocale(ctx))
        ),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
    }
  });

  bot.callbackQuery('purchase:pending', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
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
