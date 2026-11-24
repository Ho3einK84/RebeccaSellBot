import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { downloadTelegramFile } from '../../../infra/telegramFiles.js';
import { localizedDate, localizedNumber, resolveContextLocale, t } from '../../locale.js';
import {
  DuplicateReceiptError,
  PendingTopupReceiptError,
  type AdminBalanceOperation,
} from '../../../domain/services/WalletService.js';
import {
  detectIranianBankName,
  normalizeCardNumber,
  type BankCardConfig,
} from '../../../domain/services/PaymentService.js';
import {
  nowpaymentsCashbackPercent,
  nowpaymentsMaxAmountToman,
  nowpaymentsMinAmountToman,
  uniqueTopupAmountEnabled,
} from '../../../domain/services/FeatureSettings.js';
import { AutomatedPaymentError } from '../../../domain/services/AutomatedPaymentService.js';
import type { ScheduledDeletionReason } from '../../../domain/services/ScheduledMessageDeletionService.js';
import {
  buildForAppOrderInvoiceScreen,
  buildForAppOrderKeyboard,
  buildNowPaymentsOrderInvoiceScreen,
  buildNowPaymentsOrderKeyboard,
} from '../../features/paymentOrderRoutes.js';
import {
  deleteOrderTelegramMessages,
  sendAdminNewReceiptNotification,
  sendBalanceAdjustmentNotification,
} from '../../features/admin/adminNotifications.js';
import { formatReceiptShortId } from '../../features/admin/receiptRoutes.js';
import {
  acceptConversationOwner,
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  buildUserEmptyState,
  buildUserScreen,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  handleConversationCancel,
  promptInConversation,
  rememberUiMessage,
  replyInAdminConversation,
  replyInConversation,
  sendArtifactInConversation,
  waitForAdminCallbackInput,
  waitForCallbackInput,
  type ReceiptMediaInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import {
  parseNonnegativeSafeInteger,
  parsePositiveSafeInteger,
  promptAndResolveAdminTargetUser,
  requireAdmin,
} from './shared.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';

export interface TopupReceiptMediaInput extends ReceiptMediaInput {
  fileUniqueId?: string;
}

export async function computeReceiptFileSha256(
  botToken: string | undefined,
  fileId: string,
  downloader: typeof downloadTelegramFile = downloadTelegramFile
): Promise<string | null> {
  if (!botToken?.trim() || !fileId.trim()) return null;
  try {
    const downloaded = await downloader(botToken, fileId, { timeoutMs: 5_000 });
    if (!downloaded.ok || !downloaded.buffer || downloaded.buffer.byteLength === 0) {
      return null;
    }
    return crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
  } catch (err) {
    logger.debug({ err, fileId }, 'Could not hash receipt media bytes; proceeding without SHA-256');
    return null;
  }
}

async function waitForTopupReceiptMedia(
  conversation: MyConversation
): Promise<TopupReceiptMediaInput | undefined> {
  const ownerId = await conversationOwnerId(conversation);
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input, 'home')) return undefined;
    await forwardConversationNavigation(conversation, input);
    if (input.callbackQuery) {
      await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
      continue;
    }
    const photos = input.message && 'photo' in input.message ? input.message.photo : undefined;
    if (photos && photos.length > 0) {
      await deleteConsumedInputMessage(input);
      const largest = photos[photos.length - 1]!;
      return {
        fileId: largest.file_id,
        fileUniqueId: largest.file_unique_id,
        type: 'photo',
      };
    }
    const document =
      input.message && 'document' in input.message ? input.message.document : undefined;
    if (document) {
      await deleteConsumedInputMessage(input);
      return {
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        type: 'document',
        mimeType: document.mime_type,
      };
    }
    await deleteConsumedInputMessage(input);
    await promptInConversation(conversation, input, t(input, 'photo_input_required'));
  }
}

export function formatCardNumberGrouped(rawCard: string): string {
  const digits = normalizeCardNumber(rawCard).replace(/\D/g, '');
  if (digits.length === 16) {
    return `\u200E${digits.slice(0, 4)} \u200E${digits.slice(4, 8)} \u200E${digits.slice(8, 12)} \u200E${digits.slice(12, 16)}`;
  }
  return rawCard;
}

export function buildTopupPresets(min: number, max: number): number[] {
  const defaultPresets = [50_000, 100_000, 200_000, 500_000];
  const candidates = defaultPresets.filter((v) => v >= min && v <= max);
  if (candidates.length > 0) {
    return candidates;
  }
  const base = Math.max(10_000, min);
  const fallback = [base, base * 2, base * 5, base * 10].filter((v) => v >= min && v <= max);
  const unique = Array.from(new Set(fallback)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [min];
}

function buildPaymentInfoCard(
  ctx: ConversationContext,
  cardNumber: string,
  cardHolder: string,
  amountToman?: number,
  options: {
    title?: string;
    subtitle?: string;
    footer?: string;
    bankName?: string;
    isUniqueAmount?: boolean;
  } = {}
): string {
  const uniqueHint =
    options.isUniqueAmount && amountToman !== undefined
      ? t(ctx, 'topup_unique_amount_hint', {
          amount: localizedNumber(amountToman, ctx),
          currency: t(ctx, 'currency_toman'),
        })
      : undefined;
  const combinedFooter =
    uniqueHint && options.footer
      ? `${uniqueHint}\n${options.footer}`
      : (uniqueHint ?? options.footer);

  return buildUserScreen({
    emoji: '💳',
    title: options.title ?? t(ctx, 'topup_title'),
    subtitle: options.subtitle ?? t(ctx, 'topup_subtitle'),
    ...(amountToman !== undefined
      ? {
          primary: {
            label: t(ctx, 'topup_selected_amount_label'),
            value: `${localizedNumber(amountToman, ctx)} ${t(ctx, 'currency_toman')}`,
            emphasizeValue: true,
          },
        }
      : {}),
    sections: [
      {
        emoji: '🏦',
        title: t(ctx, 'topup_payment_section'),
        fields: [
          {
            label: t(ctx, 'topup_card_number_label'),
            value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(cardNumber))}\``,
          },
          {
            label: t(ctx, 'topup_card_holder_label'),
            value: escapeTelegramMarkdown(cardHolder),
          },
          ...(options.bankName
            ? [
                {
                  label: t(ctx, 'topup_card_bank_label'),
                  value: escapeTelegramMarkdown(options.bankName),
                },
              ]
            : []),
        ],
      },
    ],
    footer: combinedFooter,
  });
}

function buildAdminWalletPrompt(
  ctx: ConversationContext,
  body: string,
  options: { emoji?: string; title?: string; subtitle?: string } = {}
): string {
  return buildScreen({
    emoji: options.emoji ?? '💳',
    title: options.title ?? t(ctx, 'admin_user_wallet_section'),
    subtitle: options.subtitle,
    footer: body,
  });
}

async function promptReceiptPreview(
  conversation: MyConversation,
  ctx: ConversationContext,
  media: ReceiptMediaInput,
  caption: string,
  keyboard: InlineKeyboard
): Promise<number | undefined> {
  const options = {
    caption,
    parse_mode: 'Markdown' as const,
    reply_markup: keyboard,
  };
  const message =
    media.type === 'document'
      ? await ctx.replyWithDocument(media.fileId, options)
      : await ctx.replyWithPhoto(media.fileId, options);

  await conversation.external((outsideCtx) => {
    const targetSession =
      outsideCtx?.session ?? (ctx as { session?: Parameters<typeof rememberUiMessage>[0] }).session;
    if (targetSession) {
      rememberUiMessage(targetSession, message.message_id, 'prompt');
    }
  });
  return message.message_id;
}

async function schedulePaymentMessageDeletion(
  conversation: MyConversation,
  ctx: ConversationContext,
  chatId: number | undefined,
  messageId: number | undefined,
  reason: ScheduledDeletionReason
): Promise<void> {
  if (!chatId || !messageId) return;
  await conversation.external(async (outsideCtx) => {
    const targetServices = outsideCtx?.services ?? ctx.services;
    const scheduler = targetServices?.scheduledMessageDeletionService;
    if (!scheduler || !targetServices?.translationService) return;
    await scheduler
      .scheduleIfEnabled(targetServices.translationService, {
        chatId,
        messageId,
        reason,
      })
      .catch(() => {});
  });
}

export async function topupConversation(conversation: MyConversation, ctx: ConversationContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  await conversation.external(() => {
    trackFunnelEvent('topup_enter');
  });

  // Check if user already has a pending receipt
  const pendingReceipt = await conversation.external((outsideCtx) =>
    (outsideCtx?.services ?? ctx.services)!.walletService.getPendingReceiptForUser?.(telegramId)
  );
  if (pendingReceipt) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '⏳',
        title: t(ctx, 'topup_pending_title'),
        subtitle: t(ctx, 'topup_pending_subtitle'),
        primary: {
          label: t(ctx, 'topup_selected_amount_label'),
          value: `${localizedNumber(pendingReceipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          emphasizeValue: true,
        },
      }),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const manualFallback = await conversation.external((outsideCtx) => {
    const fallback = outsideCtx?.session?.manualFallbackOrder;
    if (!fallback) return undefined;
    delete outsideCtx.session.manualFallbackOrder;
    const isFresh = Date.now() - fallback.createdAt <= 30 * 60 * 1000;
    return isFresh ? fallback : undefined;
  });

  const initialState = await conversation.external(async (outsideCtx) => {
    const targetServices = (outsideCtx?.services ?? ctx.services)!;
    const ts = targetServices.translationService;
    const ps = targetServices.paymentService;
    const aps = targetServices.automatedPaymentService;
    const locale = resolveContextLocale(outsideCtx?.services ? outsideCtx : ctx);
    const minimum = ts.getSettingNum('topup_min_amount', 10_000);
    const maximum = ts.getSettingNum('topup_max_amount', 10_000_000);
    const uniqueEnabled = uniqueTopupAmountEnabled(ts);

    const forappAutoEnabled = Boolean(aps?.isForAppEnabled?.());
    const nowpaymentsAutoEnabled = Boolean(aps?.isNowPaymentsEnabled?.());
    const npMin = nowpaymentsMinAmountToman(ts);
    const npMax = nowpaymentsMaxAmountToman(ts);
    const npCashback = nowpaymentsCashbackPercent(ts);
    let npUsdRate = 0;
    if (nowpaymentsAutoEnabled && typeof aps?.resolveUsdToTomanRate === 'function') {
      const resolved = await aps.resolveUsdToTomanRate().catch(() => null);
      npUsdRate = resolved?.rateToman ?? 0;
    }

    const hasCardSelection =
      typeof ps?.selectCardForTopupWithDailyCaps === 'function' ||
      typeof ps?.selectCardForTopup === 'function';

    if (hasCardSelection) {
      const selectedCard: BankCardConfig | null =
        typeof ps.selectCardForTopupWithDailyCaps === 'function'
          ? await ps.selectCardForTopupWithDailyCaps()
          : ps.selectCardForTopup();

      if (!selectedCard) {
        const activeCards =
          typeof ps.getActiveBankCards === 'function' ? ps.getActiveBankCards() : [];
        return {
          status: activeCards.length > 0 ? ('all_capped' as const) : ('no_card' as const),
          cardId: undefined as string | undefined,
          cardNumber: '',
          cardHolder: '',
          bankName: undefined as string | undefined,
          minimum,
          maximum,
          uniqueEnabled,
          hasCardSelection: true,
          forappAutoEnabled,
          nowpaymentsAutoEnabled,
          npMin,
          npMax,
          npCashback,
          npUsdRate,
        };
      }

      const resolvedBank =
        selectedCard.bankName || detectIranianBankName(selectedCard.cardNumber, locale);
      return {
        status: 'ok' as const,
        cardId: selectedCard.id,
        cardNumber: selectedCard.cardNumber,
        cardHolder: selectedCard.cardHolder || ts.getSetting('card_holder', '—'),
        bankName: resolvedBank,
        minimum,
        maximum,
        uniqueEnabled,
        hasCardSelection: true,
        forappAutoEnabled,
        nowpaymentsAutoEnabled,
        npMin,
        npMax,
        npCashback,
        npUsdRate,
      };
    }

    const fallbackNumber = ts.getSetting('card_number', '—');
    const resolvedBank = detectIranianBankName(fallbackNumber, locale);
    return {
      status: 'ok' as const,
      cardId: undefined as string | undefined,
      cardNumber: fallbackNumber,
      cardHolder: ts.getSetting('card_holder', '—'),
      bankName: resolvedBank,
      minimum,
      maximum,
      uniqueEnabled,
      hasCardSelection: false,
      forappAutoEnabled,
      nowpaymentsAutoEnabled,
      npMin,
      npMax,
      npCashback,
      npUsdRate,
    };
  });

  const pendingTopupDeficit = await conversation.external((outsideCtx) => {
    const intent = outsideCtx?.session?.pendingTopupIntent;
    if (!intent) return undefined;
    const isFresh = Date.now() - intent.createdAt <= 30 * 60 * 1000;
    if (!isFresh) {
      delete outsideCtx.session.pendingTopupIntent;
      return undefined;
    }
    return Number.isSafeInteger(intent.deficitAmount) && intent.deficitAmount > 0
      ? intent.deficitAmount
      : undefined;
  });

  let selectedMethod: 'card' | 'nowpayments' = 'card';
  if (!manualFallback && initialState.nowpaymentsAutoEnabled) {
    if (initialState.status === 'ok') {
      const cardLabel = initialState.forappAutoEnabled
        ? t(ctx, 'payment_method_forapp_auto')
        : t(ctx, 'payment_method_card_to_card');
      const npLabel =
        initialState.npCashback > 0
          ? `${t(ctx, 'payment_method_nowpayments')} (+${localizedNumber(initialState.npCashback, ctx)}%)`
          : t(ctx, 'payment_method_nowpayments');
      const methodKb = new InlineKeyboard()
        .text(cardLabel, 'topup:method:card')
        .row()
        .text(npLabel, 'topup:method:nowpayments')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

      await promptInConversation(
        conversation,
        ctx,
        buildUserScreen({
          emoji: '💳',
          title: t(ctx, 'topup_choose_method_title'),
          subtitle: t(ctx, 'topup_choose_method_subtitle'),
          footer: t(ctx, 'topup_choose_method_footer'),
        }),
        { parse_mode: 'Markdown', reply_markup: methodKb }
      );

      const methodPick = await waitForCallbackInput(conversation, [
        'topup:method:card',
        'topup:method:nowpayments',
      ]);
      if (methodPick === undefined) return;
      selectedMethod = methodPick === 'topup:method:nowpayments' ? 'nowpayments' : 'card';
    } else {
      selectedMethod = 'nowpayments';
    }
  }

  // ── NOWPayments Crypto Invoice Path ────────────────────────────────────────
  if (!manualFallback && selectedMethod === 'nowpayments') {
    const npMin = initialState.npMin;
    const npMax = initialState.npMax;
    const npPresets = buildTopupPresets(npMin, npMax);
    const npKeyboard = new InlineKeyboard();
    if (
      pendingTopupDeficit !== undefined &&
      pendingTopupDeficit >= npMin &&
      pendingTopupDeficit <= npMax
    ) {
      npKeyboard
        .text(
          t(ctx, 'topup_exact_deficit_button', {
            amount: localizedNumber(pendingTopupDeficit, ctx),
          }),
          `amount:${pendingTopupDeficit}`
        )
        .row();
    }
    for (let i = 0; i < npPresets.length; i += 2) {
      npKeyboard.text(
        `${localizedNumber(npPresets[i]!, ctx)} ${t(ctx, 'currency_toman')}`,
        `amount:${npPresets[i]}`
      );
      if (npPresets[i + 1] !== undefined) {
        npKeyboard.text(
          `${localizedNumber(npPresets[i + 1]!, ctx)} ${t(ctx, 'currency_toman')}`,
          `amount:${npPresets[i + 1]}`
        );
      }
      npKeyboard.row();
    }
    npKeyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');

    const baseNpFooter = [
      t(ctx, 'nowpayments_amount_prompt_hint', {
        min: localizedNumber(npMin, ctx),
        max: localizedNumber(npMax, ctx),
        rate: localizedNumber(initialState.npUsdRate, ctx),
      }),
      ...(initialState.npCashback > 0
        ? [
            t(ctx, 'nowpayments_cashback_promo_hint', {
              percent: localizedNumber(initialState.npCashback, ctx),
            }),
          ]
        : []),
    ].join('\n');

    await promptInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '🪙',
        title: t(ctx, 'nowpayments_amount_prompt_title'),
        subtitle: t(ctx, 'nowpayments_amount_prompt_subtitle'),
        footer: baseNpFooter,
      }),
      { parse_mode: 'Markdown', reply_markup: npKeyboard }
    );

    const ownerId = await conversationOwnerId(conversation);
    for (;;) {
      const input = await conversation.wait();
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);

      let candidateAmount: number | undefined;
      if (input.callbackQuery) {
        const callbackData = input.callbackQuery.data ?? '';
        if (callbackData.startsWith('amount:')) {
          await input.answerCallbackQuery();
          const val = Number(callbackData.slice('amount:'.length));
          if (Number.isSafeInteger(val) && val >= npMin && val <= npMax) {
            candidateAmount = val;
          }
        } else {
          await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
          continue;
        }
      } else {
        const textInput = input.message && 'text' in input.message ? input.message.text : undefined;
        await deleteConsumedInputMessage(input);
        if (textInput) {
          const parsed = parsePositiveSafeInteger(textInput);
          if (parsed !== undefined && parsed >= npMin && parsed <= npMax) {
            candidateAmount = parsed;
          }
        }
      }

      if (candidateAmount === undefined) {
        await promptInConversation(
          conversation,
          ctx,
          buildUserScreen({
            emoji: '🪙',
            title: t(ctx, 'nowpayments_amount_prompt_title'),
            subtitle: t(ctx, 'nowpayments_amount_prompt_subtitle'),
            footer: `⚠️ ${t(ctx, 'topup_amount_invalid_range', {
              min: localizedNumber(npMin, ctx),
              max: localizedNumber(npMax, ctx),
            })}`,
          }),
          { parse_mode: 'Markdown', reply_markup: npKeyboard }
        );
        continue;
      }

      const created = await conversation.external(async (outsideCtx) => {
        const aps = (outsideCtx?.services ?? ctx.services)?.automatedPaymentService;
        if (!aps) return { ok: false as const, code: 'UNAVAILABLE' };
        try {
          const order = await aps.createNowPaymentsOrder({
            telegramId,
            amountToman: candidateAmount,
          });
          return { ok: true as const, order };
        } catch (err) {
          const code = err instanceof AutomatedPaymentError ? err.code : 'ORDER_CREATE_FAILED';
          logger.warn(
            { err, telegramId, amount: candidateAmount },
            'NOWPayments invoice creation failed'
          );
          return { ok: false as const, code };
        }
      });

      if (!created.ok) {
        const errMsg =
          created.code === 'AMOUNT_TOO_SMALL_USD'
            ? t(ctx, 'nowpayments_amount_too_small_usd')
            : t(ctx, 'auto_pay_order_create_failed');
        await promptInConversation(
          conversation,
          ctx,
          buildUserScreen({
            emoji: '⚠️',
            title: t(ctx, 'nowpayments_amount_prompt_title'),
            footer: errMsg,
          }),
          { parse_mode: 'Markdown', reply_markup: npKeyboard }
        );
        continue;
      }

      const sentNpInvoice = await sendArtifactInConversation(
        conversation,
        ctx,
        buildNowPaymentsOrderInvoiceScreen(ctx, created.order, initialState.npCashback),
        {
          parse_mode: 'Markdown',
          reply_markup: buildNowPaymentsOrderKeyboard(
            ctx,
            created.order.id,
            created.order.paymentUrl
          ),
        }
      );
      if (sentNpInvoice?.message_id) {
        await conversation.external(async (outsideCtx) => {
          const targetServices = outsideCtx?.services ?? ctx.services;
          const aps = targetServices?.automatedPaymentService;
          await aps
            ?.attachTelegramMessageId?.(created.order.id, sentNpInvoice.message_id)
            .catch(() => {});
        });
        await schedulePaymentMessageDeletion(
          conversation,
          ctx,
          ctx.chat?.id ?? telegramId,
          sentNpInvoice.message_id,
          'nowpayments_invoice'
        );
      }
      return;
    }
  }

  // ── Card-to-Card Paths (Manual or ForApp Automated) ────────────────────────
  if (
    !manualFallback &&
    (initialState.status === 'no_card' || initialState.status === 'all_capped')
  ) {
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState(
        '💳',
        t(
          ctx,
          initialState.status === 'all_capped'
            ? 'topup_cards_daily_cap_reached_title'
            : 'topup_no_card_title'
        ),
        t(
          ctx,
          initialState.status === 'all_capped'
            ? 'topup_cards_daily_cap_reached_body'
            : 'topup_no_card_body'
        )
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back_main'), 'nav:main'),
      }
    );
    return;
  }

  let selectedCardId = manualFallback ? manualFallback.cardId : initialState.cardId;
  let cardNumber = manualFallback ? manualFallback.cardNumber : initialState.cardNumber;
  let cardHolder = manualFallback ? manualFallback.cardHolder : initialState.cardHolder;
  let bankName = manualFallback ? manualFallback.bankName : initialState.bankName;
  const { minimum, maximum, uniqueEnabled, hasCardSelection, forappAutoEnabled } = initialState;

  let amountToman: number | undefined = manualFallback?.amount;
  let payableAmount: number | undefined = manualFallback?.amount;
  let isUniqueAmount = Boolean(manualFallback);

  if (!manualFallback) {
    const presets = buildTopupPresets(minimum, maximum);
    const presetKeyboard = new InlineKeyboard();
    if (
      pendingTopupDeficit !== undefined &&
      pendingTopupDeficit >= minimum &&
      pendingTopupDeficit <= maximum
    ) {
      presetKeyboard
        .text(
          t(ctx, 'topup_exact_deficit_button', {
            amount: localizedNumber(pendingTopupDeficit, ctx),
          }),
          `amount:${pendingTopupDeficit}`
        )
        .row();
    }
    for (let i = 0; i < presets.length; i += 2) {
      presetKeyboard.text(
        `${localizedNumber(presets[i]!, ctx)} ${t(ctx, 'currency_toman')}`,
        `amount:${presets[i]}`
      );
      if (presets[i + 1] !== undefined) {
        presetKeyboard.text(
          `${localizedNumber(presets[i + 1]!, ctx)} ${t(ctx, 'currency_toman')}`,
          `amount:${presets[i + 1]}`
        );
      }
      presetKeyboard.row();
    }
    presetKeyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');

    const buildStepOneAmountPrompt = (footerText: string): string =>
      forappAutoEnabled
        ? buildUserScreen({
            emoji: '⚡',
            title: t(ctx, 'payment_method_forapp_auto'),
            subtitle: t(ctx, 'topup_subtitle'),
            footer: footerText,
          })
        : buildPaymentInfoCard(ctx, cardNumber, cardHolder, undefined, {
            bankName,
            footer: footerText,
          });

    const step1Msg = await promptInConversation(
      conversation,
      ctx,
      buildStepOneAmountPrompt(
        forappAutoEnabled ? t(ctx, 'forapp_choose_amount_hint') : t(ctx, 'topup_choose_amount_hint')
      ),
      { parse_mode: 'Markdown', reply_markup: presetKeyboard }
    );
    if (!forappAutoEnabled) {
      await schedulePaymentMessageDeletion(
        conversation,
        ctx,
        ctx.chat?.id ?? telegramId,
        step1Msg?.message_id,
        'payment_card'
      );
    }

    const ownerId = await conversationOwnerId(conversation);
    while (amountToman === undefined) {
      const input = await conversation.wait();
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);

      let candidateAmount: number | undefined;
      if (input.callbackQuery) {
        const callbackData = input.callbackQuery.data ?? '';
        if (callbackData.startsWith('amount:')) {
          await input.answerCallbackQuery();
          const val = Number(callbackData.slice('amount:'.length));
          if (Number.isSafeInteger(val) && val >= minimum && val <= maximum) {
            candidateAmount = val;
          }
        } else {
          await input.answerCallbackQuery({ text: t(input, 'button_action_failed') });
          continue;
        }
      } else {
        const textInput = input.message && 'text' in input.message ? input.message.text : undefined;
        if (textInput) {
          await deleteConsumedInputMessage(input);
          const parsed = parsePositiveSafeInteger(textInput);
          if (parsed !== undefined && parsed >= minimum && parsed <= maximum) {
            candidateAmount = parsed;
          }
        } else {
          await deleteConsumedInputMessage(input);
        }
      }

      if (candidateAmount !== undefined) {
        if (forappAutoEnabled) {
          const createdForApp = await conversation.external(async (outsideCtx) => {
            const targetServices = (outsideCtx?.services ?? ctx.services)!;
            const aps = targetServices.automatedPaymentService;
            const locale = resolveContextLocale(outsideCtx?.services ? outsideCtx : ctx);
            if (!aps) return { ok: false as const, code: 'UNAVAILABLE' };
            try {
              const previousPending = await aps
                .getActivePendingOrderForUser?.(telegramId)
                .catch(() => null);
              const order = await aps.createForAppOrder({
                telegramId,
                requestedAmount: candidateAmount,
                locale,
              });
              if (
                previousPending &&
                previousPending.provider === 'forapp_card' &&
                previousPending.id !== order.id
              ) {
                const botApi = targetServices.botApi ?? outsideCtx?.api;
                if (botApi) {
                  await deleteOrderTelegramMessages(
                    botApi,
                    telegramId,
                    previousPending.metadata,
                    [],
                    targetServices.scheduledMessageDeletionService
                  );
                }
              }
              return { ok: true as const, order };
            } catch (err) {
              const code = err instanceof AutomatedPaymentError ? err.code : 'ORDER_CREATE_FAILED';
              logger.warn(
                { err, telegramId, amount: candidateAmount },
                'ForApp order creation failed'
              );
              return { ok: false as const, code };
            }
          });

          if (!createdForApp.ok) {
            const retryFooter =
              createdForApp.code === 'ALL_CARDS_CAP_REACHED'
                ? t(ctx, 'topup_amount_exceeds_card_cap')
                : t(ctx, 'auto_pay_order_create_failed');
            const retryForAppMsg = await promptInConversation(
              conversation,
              ctx,
              buildStepOneAmountPrompt(retryFooter),
              {
                parse_mode: 'Markdown',
                reply_markup: presetKeyboard,
              }
            );
            if (!forappAutoEnabled) {
              await schedulePaymentMessageDeletion(
                conversation,
                ctx,
                ctx.chat?.id ?? telegramId,
                retryForAppMsg?.message_id,
                'payment_card'
              );
            }
            continue;
          }

          const sentForAppInvoice = await sendArtifactInConversation(
            conversation,
            ctx,
            buildForAppOrderInvoiceScreen(ctx, createdForApp.order),
            {
              parse_mode: 'Markdown',
              reply_markup: buildForAppOrderKeyboard(ctx, createdForApp.order.id),
            }
          );
          if (sentForAppInvoice?.message_id) {
            await conversation.external(async (outsideCtx) => {
              const aps = (outsideCtx?.services ?? ctx.services)?.automatedPaymentService;
              await aps
                ?.attachTelegramMessageId?.(createdForApp.order.id, sentForAppInvoice.message_id)
                .catch(() => {});
            });
            await schedulePaymentMessageDeletion(
              conversation,
              ctx,
              ctx.chat?.id ?? telegramId,
              sentForAppInvoice.message_id,
              'forapp_invoice'
            );
          }
          return;
        }

        const resolvedAllocation = await conversation.external(async (outsideCtx) => {
          const targetServices = (outsideCtx?.services ?? ctx.services)!;
          const ps = targetServices.paymentService;
          const ts = targetServices.translationService;
          const locale = resolveContextLocale(outsideCtx?.services ? outsideCtx : ctx);

          let nextCardId = selectedCardId;
          let nextCardNumber = cardNumber;
          let nextCardHolder = cardHolder;
          let nextBankName = bankName;

          if (hasCardSelection && ps) {
            const usageMap =
              typeof ps.getTodayCardUsageMap === 'function'
                ? await ps.getTodayCardUsageMap()
                : undefined;
            const activeCards =
              typeof ps.getActiveBankCards === 'function' ? ps.getActiveBankCards() : [];
            const currentCard = nextCardId
              ? activeCards.find((card) => card.id === nextCardId)
              : undefined;
            const currentFits =
              currentCard && typeof ps.canCardAcceptAmount === 'function'
                ? ps.canCardAcceptAmount(currentCard, candidateAmount, usageMap)
                : false;

            if (!currentFits) {
              const replacement =
                typeof ps.selectCardForTopup === 'function'
                  ? ps.selectCardForTopup({
                      amountToman: candidateAmount,
                      ...(usageMap ? { dailyUsageByCardId: usageMap } : {}),
                    })
                  : null;
              if (!replacement) {
                return { status: 'cap_exceeded' as const };
              }
              nextCardId = replacement.id;
              nextCardNumber = replacement.cardNumber;
              nextCardHolder = replacement.cardHolder || ts.getSetting('card_holder', '—');
              nextBankName =
                replacement.bankName || detectIranianBankName(replacement.cardNumber, locale);
            }
          }

          let finalAmount = candidateAmount;
          let uniqueFlag = false;
          if (uniqueEnabled && typeof ps?.allocateUniquePayableAmount === 'function') {
            try {
              const alloc = await ps.allocateUniquePayableAmount(candidateAmount);
              if (alloc.payableAmount > 0) {
                finalAmount = alloc.payableAmount;
                uniqueFlag = alloc.offset !== 0;
              }
            } catch (err) {
              logger.warn(
                { err },
                'Unique payable amount allocation failed; using requested amount'
              );
            }
          }

          return {
            status: 'ok' as const,
            cardId: nextCardId,
            cardNumber: nextCardNumber,
            cardHolder: nextCardHolder,
            bankName: nextBankName,
            payableAmount: finalAmount,
            isUniqueAmount: uniqueFlag,
          };
        });

        if (resolvedAllocation.status === 'cap_exceeded') {
          const capRetryMsg = await promptInConversation(
            conversation,
            ctx,
            buildPaymentInfoCard(ctx, cardNumber, cardHolder, undefined, {
              bankName,
              footer: t(ctx, 'topup_amount_exceeds_card_cap'),
            }),
            { parse_mode: 'Markdown', reply_markup: presetKeyboard }
          );
          await schedulePaymentMessageDeletion(
            conversation,
            ctx,
            ctx.chat?.id ?? telegramId,
            capRetryMsg?.message_id,
            'payment_card'
          );
          continue;
        }

        selectedCardId = resolvedAllocation.cardId;
        cardNumber = resolvedAllocation.cardNumber;
        cardHolder = resolvedAllocation.cardHolder;
        bankName = resolvedAllocation.bankName;
        amountToman = candidateAmount;
        payableAmount = resolvedAllocation.payableAmount;
        isUniqueAmount = resolvedAllocation.isUniqueAmount;
        break;
      }

      const rangeRetryMsg = await promptInConversation(
        conversation,
        ctx,
        buildStepOneAmountPrompt(
          `⚠️ ${t(ctx, 'topup_amount_invalid_range', {
            min: localizedNumber(minimum, ctx),
            max: localizedNumber(maximum, ctx),
          })}`
        ),
        { parse_mode: 'Markdown', reply_markup: presetKeyboard }
      );
      if (!forappAutoEnabled) {
        await schedulePaymentMessageDeletion(
          conversation,
          ctx,
          ctx.chat?.id ?? telegramId,
          rangeRetryMsg?.message_id,
          'payment_card'
        );
      }
    }
  }

  const finalAmountToman = payableAmount ?? amountToman!;

  let mediaInput: TopupReceiptMediaInput | undefined;
  while (!mediaInput) {
    const step2Msg = await promptInConversation(
      conversation,
      ctx,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, finalAmountToman, {
        bankName,
        isUniqueAmount,
        title: t(ctx, 'topup_receipt_title'),
        subtitle: t(ctx, 'topup_receipt_subtitle'),
        footer: t(ctx, 'topup_photo_prompt'),
      }),
      { parse_mode: 'Markdown' }
    );
    await schedulePaymentMessageDeletion(
      conversation,
      ctx,
      ctx.chat?.id ?? telegramId,
      step2Msg?.message_id,
      'payment_card'
    );
    mediaInput = await waitForTopupReceiptMedia(conversation);
    if (mediaInput === undefined) return;

    const previewMsgId = await promptReceiptPreview(
      conversation,
      ctx,
      mediaInput,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, finalAmountToman, {
        bankName,
        isUniqueAmount,
        title: t(ctx, 'topup_review_title'),
        subtitle: t(ctx, 'topup_review_subtitle'),
        footer: `⚠️ ${t(ctx, 'topup_review_consequence')}`,
      }),
      new InlineKeyboard()
        .text(t(ctx, 'topup_confirm_button'), 'topup:confirm')
        .row()
        .text(t(ctx, 'topup_change_receipt_button'), 'topup:change_receipt')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel')
    );
    await schedulePaymentMessageDeletion(
      conversation,
      ctx,
      ctx.chat?.id ?? telegramId,
      previewMsgId,
      'payment_card'
    );

    const selection = await waitForCallbackInput(conversation, [
      'topup:confirm',
      'topup:change_receipt',
    ]);
    if (selection === undefined) return;
    if (selection === 'topup:change_receipt') {
      mediaInput = undefined;
      continue;
    }
  }

  const photoFileId = mediaInput.fileId;
  const mediaType = mediaInput.type;
  const fileUniqueId = mediaInput.fileUniqueId ?? null;
  const normalizedSubmittedCardNumber =
    cardNumber && cardNumber !== '—' ? normalizeCardNumber(cardNumber) || null : null;

  try {
    const submission = await conversation.external(
      async (
        outsideCtx
      ): Promise<
        | { status: 'ok'; receiptId: string }
        | { status: 'duplicate_blocked' }
        | { status: 'pending' }
      > => {
        const targetCtx = outsideCtx?.services ? outsideCtx : ctx;
        const ws = targetCtx.services!.walletService;
        const ps = targetCtx.services!.paymentService;
        let id: string;
        let duplicateOfReceiptId: string | null = null;

        try {
          if (typeof ws.submitTopupReceiptDetailed === 'function') {
            const fileSha256 = await computeReceiptFileSha256(targetCtx.api?.token, photoFileId);
            const submitted = await ws.submitTopupReceiptDetailed({
              telegramId,
              amount: finalAmountToman,
              photoFileId,
              mediaType,
              fileUniqueId,
              fileSha256,
              cardId: selectedCardId ?? null,
              cardNumber: normalizedSubmittedCardNumber,
            });
            id = submitted.receiptId;
            duplicateOfReceiptId = submitted.duplicateOfReceiptId;
          } else {
            id = await ws.submitTopupReceipt(telegramId, finalAmountToman, photoFileId, mediaType);
          }
        } catch (submitErr) {
          if (
            submitErr instanceof DuplicateReceiptError ||
            (submitErr instanceof Error &&
              ((submitErr as { code?: string }).code === 'DUPLICATE_RECEIPT' ||
                submitErr.name === 'DuplicateReceiptError' ||
                submitErr.message.startsWith('DUPLICATE_RECEIPT')))
          ) {
            return { status: 'duplicate_blocked' };
          }
          if (
            submitErr instanceof PendingTopupReceiptError ||
            (submitErr instanceof Error &&
              (submitErr.name === 'PendingTopupReceiptError' ||
                submitErr.message === 'PENDING_TOPUP_RECEIPT_EXISTS'))
          ) {
            return { status: 'pending' };
          }
          throw submitErr;
        }

        if (selectedCardId && typeof ps?.recordCardDailyUsage === 'function') {
          ps.recordCardDailyUsage(selectedCardId, finalAmountToman);
        }
        await targetCtx.services?.automatedPaymentService
          ?.cancelPendingForAppOrdersForUser?.(telegramId)
          .catch(() => {});

        const cardSummary =
          selectedCardId || normalizedSubmittedCardNumber
            ? (ps?.resolveCardDisplayLabel?.(
                { cardId: selectedCardId ?? null, cardNumber: normalizedSubmittedCardNumber },
                resolveContextLocale(targetCtx)
              ) ?? null)
            : null;

        trackFunnelEvent('receipt_submit');
        await notifyAdminsOfReceipt(
          targetCtx,
          id,
          telegramId,
          finalAmountToman,
          photoFileId,
          mediaType,
          duplicateOfReceiptId,
          cardSummary
        );
        return { status: 'ok', receiptId: id };
      }
    );

    if (submission.status === 'duplicate_blocked') {
      await replyInConversation(
        conversation,
        ctx,
        buildUserEmptyState('🚫', t(ctx, 'topup_receipt_title'), t(ctx, 'topup_duplicate_blocked')),
        { parse_mode: 'Markdown', preferEdit: false }
      );
      return;
    }

    if (submission.status === 'pending') {
      await replyInConversation(
        conversation,
        ctx,
        buildUserEmptyState('⏳', t(ctx, 'topup_pending_title'), t(ctx, 'topup_pending_subtitle')),
        { parse_mode: 'Markdown', preferEdit: false }
      );
      return;
    }

    const receiptId = submission.receiptId;

    await sendArtifactInConversation(
      conversation,
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'topup_success_title'),
        subtitle: t(ctx, 'topup_success_subtitle'),
        primary: {
          label: t(ctx, 'topup_receipt_id_label'),
          value: `\`${receiptId}\``,
          inline: true,
        },
      }),
      { parse_mode: 'Markdown' }
    );
    await replyInConversation(conversation, ctx, t(ctx, 'navigation_continue_hint'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'receipt_approved_shop_button'), 'nav:shop')
        .text(t(ctx, 'menu_wallet'), 'nav:wallet')
        .row()
        .text(t(ctx, 'menu_back_main'), 'nav:main'),
    });
  } catch (err) {
    if (
      err instanceof DuplicateReceiptError ||
      (err instanceof Error &&
        ((err as { code?: string }).code === 'DUPLICATE_RECEIPT' ||
          err.name === 'DuplicateReceiptError' ||
          err.message.startsWith('DUPLICATE_RECEIPT')))
    ) {
      await replyInConversation(
        conversation,
        ctx,
        buildUserEmptyState('🚫', t(ctx, 'topup_receipt_title'), t(ctx, 'topup_duplicate_blocked')),
        { parse_mode: 'Markdown', preferEdit: false }
      );
      return;
    }
    if (err instanceof PendingTopupReceiptError) {
      await replyInConversation(
        conversation,
        ctx,
        buildUserEmptyState('⏳', t(ctx, 'topup_pending_title'), t(ctx, 'topup_pending_subtitle')),
        { parse_mode: 'Markdown', preferEdit: false }
      );
      return;
    }
    logger.error({ err, telegramId }, 'Topup receipt submission failed');
    await replyInConversation(
      conversation,
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'topup_receipt_title'), t(ctx, 'topup_failed')),
      { parse_mode: 'Markdown', preferEdit: false }
    );
  }
}

async function notifyAdminsOfReceipt(
  ctx: ConversationContext,
  receiptId: string,
  telegramId: number,
  amount: number,
  photoFileId: string,
  mediaType: 'photo' | 'document' = 'photo',
  duplicateOfReceiptId: string | null = null,
  cardSummary: string | null = null
): Promise<void> {
  if (!ctx.services) return;
  await sendAdminNewReceiptNotification(ctx.api, ctx.services, {
    receiptId,
    telegramId,
    amount,
    photoFileId,
    mediaType,
    duplicateOfReceiptId,
    cardSummary,
    shortIdFormatter: formatReceiptShortId,
  });
}

// ── Admin: set user wallet balance ────────────────────────────────────────────

export async function adminSetBalanceConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;
  const preselectedTargetId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.adminBalanceTargetTelegramId;
    delete outsideCtx.session.adminBalanceTargetTelegramId;
    return selected;
  });

  const user = await promptAndResolveAdminTargetUser(conversation, ctx, {
    titleKey: 'admin_menu_manual_topup',
    subtitleKey: 'admin_target_telegram_id_prompt',
    initialTelegramId: preselectedTargetId,
  });

  if (!user) return;

  const targetId = user.telegramId;
  const currentBalance = await conversation.external(async (outsideCtx) => {
    if (!outsideCtx.services) return 0;
    return outsideCtx.services.walletService.getBalance(targetId);
  });

  const displayName =
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    (user.username ? `@${user.username}` : String(user.telegramId));

  const operationKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_balance_add'), 'balance-op:add')
    .text(t(ctx, 'admin_balance_deduct'), 'balance-op:deduct')
    .row()
    .text(t(ctx, 'admin_balance_set'), 'balance-op:set')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '💳',
      title: t(ctx, 'admin_user_wallet_section'),
      subtitle: t(ctx, 'admin_balance_operation_prompt'),
      primary: {
        emoji: '💰',
        label: t(ctx, 'admin_user_balance_label'),
        value: `${localizedNumber(currentBalance, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '👤',
          title: t(ctx, 'admin_user_identity_section'),
          fields: [
            { emoji: '🆔', label: t(ctx, 'admin_user_id_label'), value: `\`${targetId}\`` },
            {
              emoji: '🏷️',
              label: t(ctx, 'admin_user_name_label'),
              value: escapeTelegramMarkdown(displayName),
            },
          ],
        },
      ],
    }),
    { parse_mode: 'Markdown', reply_markup: operationKeyboard }
  );

  const operationInput = await waitForAdminCallbackInput(conversation, ['balance-op:']);
  if (!operationInput) return;
  const operationValue = operationInput.slice('balance-op:'.length);
  if (!['add', 'deduct', 'set'].includes(operationValue)) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_user_wallet_section'), t(ctx, 'operation_failed')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const operation = operationValue as AdminBalanceOperation;
  await applyAdminBalanceOperation(conversation, ctx, targetId, adminId, operation, 'manual panel');
}

// ── Admin: Search and view/manage user ────────────────────────────────────────

export async function adminSearchUserConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;

  const u = await promptAndResolveAdminTargetUser(conversation, ctx, {
    titleKey: 'admin_user_search_button',
    subtitleKey: 'admin_search_subtitle',
  });
  if (!u) return;

  const displayName =
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || t(ctx, 'admin_name_unset');

  await replyInAdminConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '👤',
      title: t(ctx, 'admin_user_profile_title'),
      subtitle: `\`${u.telegramId}\``,
      primary: {
        emoji: u.isBanned ? '⚠️' : '💰',
        label: t(ctx, 'admin_user_status_label'),
        value: `${u.isBanned ? buildStatusBadge(ctx, 'inactive', t(ctx, 'admin_banned')) : buildStatusBadge(ctx, 'active', t(ctx, 'admin_active'))} · ${localizedNumber(u.balance, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '👤',
          title: t(ctx, 'admin_user_identity_section'),
          fields: [
            { emoji: '🆔', label: t(ctx, 'admin_user_id_label'), value: `\`${u.telegramId}\`` },
            {
              emoji: '🔗',
              label: t(ctx, 'admin_user_username_label'),
              value: u.username
                ? `@${escapeTelegramMarkdown(u.username)}`
                : t(ctx, 'admin_username_unset'),
            },
            {
              emoji: '🏷️',
              label: t(ctx, 'admin_user_name_label'),
              value: escapeTelegramMarkdown(displayName),
            },
            {
              emoji: '📅',
              label: t(ctx, 'admin_user_joined_label'),
              value: localizedDate(u.createdAt, ctx),
            },
          ],
        },
        {
          emoji: '💳',
          title: t(ctx, 'admin_user_wallet_section'),
          fields: [
            {
              emoji: '💰',
              label: t(ctx, 'admin_user_balance_label'),
              value: `${localizedNumber(u.balance, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              emoji: '💳',
              label: t(ctx, 'admin_user_total_spend_label'),
              value: `${localizedNumber(u.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              emoji: '📦',
              label: t(ctx, 'admin_user_active_services_label'),
              value: localizedNumber(u.activeSubscriptionCount, ctx),
            },
            {
              emoji: '🧾',
              label: t(ctx, 'admin_user_transactions_label'),
              value: localizedNumber(u.transactionCount, ctx),
            },
          ],
        },
      ],
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_user_open_profile_button'), `admin:user:view:${u.telegramId}`)
        .text(t(ctx, 'admin_user_balance_button'), `admin:user:balance:${u.telegramId}`)
        .row()
        .text(t(ctx, 'admin_user_message_button'), `admin:user:message:${u.telegramId}`)
        .text(t(ctx, 'admin_user_subscriptions_button'), `admin:user:subscriptions:${u.telegramId}`)
        .row()
        .text(t(ctx, 'admin_user_audit_button'), `admin:user:reports:${u.telegramId}`)
        .text(t(ctx, 'admin_search_again'), 'admin:users:search')
        .row()
        .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
    }
  );
}

// ── Admin: Dynamic setting editor ─────────────────────────────────────────────

async function applyAdminBalanceOperation(
  conversation: MyConversation,
  ctx: ConversationContext,
  telegramId: number,
  adminId: number,
  operation: AdminBalanceOperation,
  source: string
): Promise<void> {
  if (!ctx.services) return;
  const isSet = operation === 'set';
  let amount: number | undefined;
  while (amount === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminWalletPrompt(
        ctx,
        isSet
          ? t(ctx, 'admin_new_balance_prompt')
          : t(ctx, 'admin_balance_amount_prompt', {
              operation: t(ctx, `admin_balance_${operation}`),
            }),
        { title: t(ctx, 'admin_user_wallet_section') }
      ),
      { parse_mode: 'Markdown' }
    );
    const amountInput = await waitForAdminTextInput(conversation);
    if (amountInput === undefined) return;
    amount = isSet
      ? parseNonnegativeSafeInteger(amountInput)
      : parsePositiveSafeInteger(amountInput);
    if (amount === undefined) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'admin_user_wallet_section'), t(ctx, 'admin_invalid_balance')),
        { parse_mode: 'Markdown' }
      );
    }
  }

  const currentBalance = await conversation.external((outsideCtx) =>
    (outsideCtx?.services ?? ctx.services)!.walletService.getBalance(telegramId)
  );
  const projectedBalance =
    operation === 'add'
      ? currentBalance + amount
      : operation === 'deduct'
        ? Math.max(0, currentBalance - amount)
        : amount;
  const confirmationKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_balance_confirm_button'), 'balance-confirm')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '⚠️',
      title: t(ctx, 'admin_user_wallet_section'),
      subtitle: t(ctx, 'admin_balance_confirm', {
        telegram_id: telegramId,
        operation: t(ctx, `admin_balance_${operation}`),
        amount: localizedNumber(amount, ctx),
        current_balance: localizedNumber(currentBalance, ctx),
      }),
      primary: {
        emoji: operation === 'deduct' ? '➖' : operation === 'set' ? '⚖️' : '➕',
        label: t(ctx, `admin_balance_${operation}`),
        value: `${localizedNumber(amount, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '👤',
          title: t(ctx, 'admin_user_identity_section'),
          fields: [
            {
              emoji: '🆔',
              label: t(ctx, 'admin_user_id_label'),
              value: `\`${telegramId}\``,
            },
            {
              emoji: '💰',
              label: t(ctx, 'admin_user_balance_label'),
              value: `${localizedNumber(currentBalance, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              emoji: '✨',
              label: t(ctx, 'admin_user_balance_projected_label'),
              value: `${localizedNumber(projectedBalance, ctx)} ${t(ctx, 'currency_toman')}`,
            },
          ],
        },
      ],
    }),
    { parse_mode: 'Markdown', reply_markup: confirmationKeyboard }
  );
  if (!(await waitForAdminCallbackInput(conversation, ['balance-confirm']))) return;

  try {
    const timestamp = await conversation.now();
    const referenceId = `admin_bal_${operation}_${telegramId}_${timestamp}`;
    const updated = await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? ctx.services)!.walletService.adjustBalanceAdmin({
        telegramId,
        operation,
        amount,
        adminId,
        description: `Admin dashboard ${source}`,
        referenceId,
      })
    );
    await replyInAdminConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_user_wallet_section'),
        subtitle: t(ctx, 'admin_balance_updated', {
          telegram_id: telegramId,
          balance: localizedNumber(updated, ctx),
        }),
        primary: {
          emoji: '💰',
          label: t(ctx, 'admin_user_balance_label'),
          value: `${localizedNumber(updated, ctx)} ${t(ctx, 'currency_toman')}`,
        },
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_user_open_profile_button'), `adm:usr:v:${telegramId}`)
          .row()
          .text(t(ctx, 'admin_menu_back_to_admin'), 'adm:home'),
      }
    );
    await conversation.external(async (outsideCtx) => {
      const targetCtx = outsideCtx?.services ? outsideCtx : ctx;
      if (targetCtx.services) {
        await sendBalanceAdjustmentNotification(targetCtx.api, targetCtx.services, {
          telegramId,
          newBalance: updated,
        });
      }
    });
  } catch (err) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_user_wallet_section'),
        err instanceof Error && err.message === 'ADMIN_BALANCE_BELOW_RESERVED'
          ? t(ctx, 'admin_balance_below_reserved')
          : t(ctx, 'admin_balance_update_failed')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}
