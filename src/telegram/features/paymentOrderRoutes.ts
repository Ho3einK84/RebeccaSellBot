/**
 * Stateless user-facing callback routes & invoice screen builders for automated
 * wallet payment orders (ForApp card-to-card & NOWPayments crypto).
 */
import { InlineKeyboard, type Bot } from 'grammy';
import type { BotServices, ConversationContext, MenuContext } from '../types.js';
import {
  formatPaymentOrderShortId,
  type AutomatedPaymentService,
} from '../../domain/services/AutomatedPaymentService.js';
import { normalizeCardNumber } from '../../domain/services/PaymentService.js';
import { localizedDateTime, localizedNumber, t } from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  buildUserEmptyState,
  buildUserScreen,
  forgetUiMessage,
  rememberArtifactMessage,
  renderScreen,
  safelyDeleteMessage,
} from '../ui.js';
import { sendAdminAutomatedTopupReport } from './admin/adminNotifications.js';

function formatCardGrouped(rawCard: string): string {
  const digits = normalizeCardNumber(rawCard).replace(/\D/g, '');
  if (digits.length === 16) {
    return `\u200E${digits.slice(0, 4)} \u200E${digits.slice(4, 8)} \u200E${digits.slice(8, 12)} \u200E${digits.slice(12, 16)}`;
  }
  return rawCard;
}

type OrderLike = Awaited<ReturnType<AutomatedPaymentService['createForAppOrder']>>;

export function buildForAppOrderInvoiceScreen(ctx: ConversationContext, order: OrderLike): string {
  const currency = t(ctx, 'currency_toman');
  const rialUnit = t(ctx, 'currency_rial');
  const shortId = formatPaymentOrderShortId(order.id);
  const payableRial = order.payableAmountRial ?? order.payableAmount * 10;

  const fields: Array<{ label: string; value: string }> = [
    {
      label: t(ctx, 'topup_card_number_label'),
      value: `\`${sanitizeTelegramInlineCode(formatCardGrouped(order.cardNumber ?? '—'))}\``,
    },
    {
      label: t(ctx, 'topup_card_holder_label'),
      value: escapeTelegramMarkdown(order.cardHolder || '—'),
    },
  ];
  if (order.bankName) {
    fields.push({
      label: t(ctx, 'topup_card_bank_label'),
      value: escapeTelegramMarkdown(order.bankName),
    });
  }
  fields.push(
    {
      label: t(ctx, 'forapp_exact_rial_label'),
      value: `\`${localizedNumber(payableRial, ctx)}\` ${rialUnit}`,
    },
    {
      label: t(ctx, 'auto_pay_expires_at_label'),
      value: localizedDateTime(new Date(order.expiresAt), ctx),
    },
    {
      label: t(ctx, 'auto_pay_order_id_label'),
      value: `\`#${shortId}\``,
    }
  );

  return buildUserScreen({
    emoji: '⚡',
    title: t(ctx, 'forapp_invoice_title'),
    subtitle: t(ctx, 'forapp_invoice_subtitle'),
    primary: {
      label: t(ctx, 'auto_pay_exact_amount_label'),
      value: `${localizedNumber(order.payableAmount, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections: [
      {
        emoji: '🏦',
        title: t(ctx, 'topup_payment_section'),
        fields,
      },
    ],
    footer: t(ctx, 'forapp_invoice_footer'),
  });
}

export function buildForAppOrderKeyboard(
  ctx: ConversationContext,
  orderId: string
): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'auto_pay_check_status_button'), `porder:check:${orderId}`)
    .row()
    .text(t(ctx, 'forapp_manual_fallback_button'), `porder:manual:${orderId}`)
    .row()
    .text(t(ctx, 'auto_pay_cancel_order_button'), `porder:cancel:${orderId}`);
}

export function buildNowPaymentsOrderInvoiceScreen(
  ctx: ConversationContext,
  order: OrderLike,
  cashbackPercent = 0
): string {
  const currency = t(ctx, 'currency_toman');
  const shortId = formatPaymentOrderShortId(order.id);

  const fields: Array<{ label: string; value: string }> = [
    {
      label: t(ctx, 'nowpayments_usd_amount_label'),
      value: `\`$${sanitizeTelegramInlineCode(order.fiatAmountUsd ?? '0.00')} USD\``,
    },
  ];
  if (order.exchangeRateTomanPerUsd) {
    fields.push({
      label: t(ctx, 'nowpayments_rate_label'),
      value: `${localizedNumber(order.exchangeRateTomanPerUsd, ctx)} ${currency}`,
    });
  }
  if (cashbackPercent > 0) {
    fields.push({
      label: t(ctx, 'auto_pay_cashback_label'),
      value: `${localizedNumber(cashbackPercent, ctx)}%`,
    });
  }
  fields.push(
    {
      label: t(ctx, 'auto_pay_expires_at_label'),
      value: localizedDateTime(new Date(order.expiresAt), ctx),
    },
    {
      label: t(ctx, 'auto_pay_order_id_label'),
      value: `\`#${shortId}\``,
    }
  );

  return buildUserScreen({
    emoji: '🪙',
    title: t(ctx, 'nowpayments_invoice_title'),
    subtitle: t(ctx, 'nowpayments_invoice_subtitle'),
    primary: {
      label: t(ctx, 'topup_selected_amount_label'),
      value: `${localizedNumber(order.payableAmount, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections: [
      {
        emoji: '🪙',
        title: t(ctx, 'payment_method_nowpayments'),
        fields,
      },
    ],
    footer: t(ctx, 'nowpayments_invoice_footer'),
  });
}

export function buildNowPaymentsOrderKeyboard(
  ctx: ConversationContext,
  orderId: string,
  paymentUrl: string | null | undefined
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (paymentUrl) {
    kb.url(t(ctx, 'nowpayments_pay_button'), paymentUrl).row();
  }
  kb.text(t(ctx, 'auto_pay_check_status_button'), `porder:check:${orderId}`).row();
  kb.text(t(ctx, 'auto_pay_cancel_order_button'), `porder:cancel:${orderId}`);
  return kb;
}

export function registerPaymentOrderRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery(/^porder:check:([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    const telegramId = ctx.from?.id;
    const orderId = ctx.match[1];
    if (!telegramId || !orderId || !services.automatedPaymentService) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'auto_pay_order_not_found'), show_alert: true });
      return;
    }

    const result = await services.automatedPaymentService.checkOrderStatusForUser({
      orderId,
      telegramId,
    });
    if (!result) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'auto_pay_order_not_found'), show_alert: true });
      return;
    }

    const { order, newlyCompleted, balanceAfter } = result;

    if (order.status === 'completed') {
      await ctx.answerCallbackQuery({ text: t(ctx, 'auto_pay_credited_title') });
      // Preserve completed invoice artifact text; remove stale pending action buttons.
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const currency = t(ctx, 'currency_toman');
      const credited = order.creditedAmount ?? order.payableAmount;
      const fields: Array<{ label: string; value: string }> = [
        {
          label: t(ctx, 'auto_pay_order_id_label'),
          value: `\`#${formatPaymentOrderShortId(order.id)}\``,
        },
      ];
      if (order.cashbackAmount > 0) {
        fields.push({
          label: t(ctx, 'auto_pay_cashback_label'),
          value: `+${localizedNumber(order.cashbackAmount, ctx)} ${currency}`,
        });
      }
      if (balanceAfter !== undefined) {
        fields.push({
          label: t(ctx, 'wallet_available_balance'),
          value: `${localizedNumber(balanceAfter, ctx)} ${currency}`,
        });
      }

      const msg = await ctx.reply(
        buildUserScreen({
          emoji: '✅',
          title: t(ctx, 'auto_pay_credited_title'),
          subtitle: t(ctx, 'auto_pay_credited_subtitle'),
          primary: {
            label: t(ctx, 'receipt_result_amount_label'),
            value: `+${localizedNumber(credited, ctx)} ${currency}`,
            emphasizeValue: true,
          },
          sections: [{ fields }],
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'receipt_approved_shop_button'), 'nav:shop')
            .text(t(ctx, 'menu_wallet'), 'nav:wallet'),
        }
      );
      if (ctx.session) {
        rememberArtifactMessage(ctx.session, msg.message_id);
      }

      if (newlyCompleted && services.botApi) {
        await sendAdminAutomatedTopupReport(services.botApi, services, {
          telegramId,
          amount: credited,
          cashbackAmount: order.cashbackAmount,
          provider: order.provider === 'nowpayments' ? 'nowpayments' : 'forapp_card',
          orderId: order.id,
          bank: order.bankName,
          payCurrency: order.payCurrency,
        });
      }
      return;
    }

    const statusKey =
      order.status === 'confirming'
        ? 'auto_pay_status_confirming'
        : order.status === 'partially_paid'
          ? 'nowpayments_partially_paid_title'
          : order.status === 'expired'
            ? 'auto_pay_status_expired'
            : order.status === 'cancelled'
              ? 'auto_pay_status_cancelled'
              : order.status === 'failed'
                ? 'auto_pay_status_failed'
                : 'auto_pay_status_pending';

    if (order.status === 'expired' || order.status === 'cancelled' || order.status === 'failed') {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    }

    await ctx.answerCallbackQuery({ text: t(ctx, statusKey), show_alert: true });
  });

  bot.callbackQuery(/^porder:cancel:([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    const telegramId = ctx.from?.id;
    const orderId = ctx.match[1];
    if (!telegramId || !orderId || !services.automatedPaymentService) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_pay_cancel_unavailable'),
        show_alert: true,
      });
      return;
    }

    const callbackMsgId = ctx.callbackQuery?.message?.message_id;
    const cancelled = await services.automatedPaymentService.cancelOrderForUser(
      orderId,
      telegramId
    );
    if (!cancelled) {
      const existing = await services.automatedPaymentService.getOrderByIdForUser(
        orderId,
        telegramId
      );
      if (existing && existing.status === 'completed') {
        // Completed transactions must NEVER be deleted — only remove stale buttons.
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await ctx.answerCallbackQuery({
          text: t(ctx, 'auto_pay_cancel_unavailable'),
          show_alert: true,
        });
        return;
      }
      if (
        existing &&
        (existing.status === 'cancelled' ||
          existing.status === 'expired' ||
          existing.status === 'failed')
      ) {
        if (callbackMsgId !== undefined) {
          if (ctx.session) forgetUiMessage(ctx.session, callbackMsgId);
          await safelyDeleteMessage(ctx, callbackMsgId);
        }
        await ctx.answerCallbackQuery({
          text: t(
            ctx,
            existing.status === 'expired'
              ? 'auto_pay_status_expired'
              : existing.status === 'failed'
                ? 'auto_pay_status_failed'
                : 'auto_pay_status_cancelled'
          ),
        });
        await renderScreen(
          ctx,
          buildUserEmptyState(
            '↩️',
            t(
              ctx,
              existing.status === 'expired'
                ? 'auto_pay_status_expired'
                : 'auto_pay_status_cancelled'
            ),
            ''
          ),
          {
            parse_mode: 'Markdown',
            preferEdit: false,
            reply_markup: new InlineKeyboard()
              .text(t(ctx, 'menu_wallet'), 'nav:wallet')
              .text(t(ctx, 'menu_back_main'), 'nav:main'),
          }
        );
        return;
      }

      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_pay_cancel_unavailable'),
        show_alert: true,
      });
      return;
    }

    // Remove the unpaid cancelled invoice message so stale card/buttons do not linger in chat.
    if (callbackMsgId !== undefined) {
      if (ctx.session) forgetUiMessage(ctx.session, callbackMsgId);
      await safelyDeleteMessage(ctx, callbackMsgId);
    }

    await ctx.answerCallbackQuery({ text: t(ctx, 'auto_pay_status_cancelled') });
    await renderScreen(ctx, buildUserEmptyState('↩️', t(ctx, 'auto_pay_status_cancelled'), ''), {
      parse_mode: 'Markdown',
      preferEdit: false,
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'menu_wallet'), 'nav:wallet')
        .text(t(ctx, 'menu_back_main'), 'nav:main'),
    });
  });

  bot.callbackQuery(/^porder:manual:([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    const telegramId = ctx.from?.id;
    const orderId = ctx.match[1];
    if (!telegramId || !orderId || !services.automatedPaymentService) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_pay_cancel_unavailable'),
        show_alert: true,
      });
      return;
    }

    const order = await services.automatedPaymentService.getOrderByIdForUser(orderId, telegramId);
    if (!order || order.provider !== 'forapp_card' || order.status !== 'pending') {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_pay_cancel_unavailable'),
        show_alert: true,
      });
      return;
    }

    const callbackMsgId = ctx.callbackQuery?.message?.message_id;
    if (callbackMsgId !== undefined) {
      if (ctx.session) forgetUiMessage(ctx.session, callbackMsgId);
      await safelyDeleteMessage(ctx, callbackMsgId);
    }

    ctx.session.manualFallbackOrder = {
      orderId: order.id,
      amount: order.payableAmount,
      cardId: order.cardId ?? undefined,
      cardNumber: order.cardNumber ?? '',
      cardHolder: order.cardHolder ?? '',
      bankName: order.bankName ?? undefined,
      createdAt: Date.now(),
    };
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('topupConversation');
  });
}
