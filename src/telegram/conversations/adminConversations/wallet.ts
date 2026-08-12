import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, localizedNumberForLocale, t, tForLocale } from '../../locale.js';
import {
  PendingTopupReceiptError,
  type AdminBalanceOperation,
} from '../../../domain/services/WalletService.js';
import {
  acceptConversationOwner,
  buildEmptyState,
  buildScreen,
  conversationOwnerId,
  handleConversationCancel,
  promptInConversation,
  replyInAdminConversation,
  replyInConversation,
  sendArtifactInConversation,
  waitForAdminCallbackInput,
  waitForCallbackInput,
  waitForReceiptMediaInput,
  type ReceiptMediaInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import { parseNonnegativeSafeInteger, parsePositiveSafeInteger, requireAdmin } from './shared.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

function buildPaymentInfoCard(
  ctx: ConversationContext,
  cardNumber: string,
  cardHolder: string,
  amountToman?: number,
  options: { title?: string; subtitle?: string; footer?: string } = {}
): string {
  return buildScreen({
    emoji: '💳',
    title: options.title ?? t(ctx, 'topup_title'),
    subtitle: options.subtitle ?? t(ctx, 'topup_subtitle'),
    ...(amountToman !== undefined
      ? {
          primary: {
            emoji: '💰',
            label: t(ctx, 'topup_selected_amount_label'),
            value: `${localizedNumber(amountToman, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        }
      : {}),
    sections: [
      {
        emoji: '🏦',
        title: t(ctx, 'topup_payment_section'),
        fields: [
          {
            emoji: '💳',
            label: t(ctx, 'topup_card_number_label'),
            value: `\`${escapeTelegramMarkdown(cardNumber)}\``,
          },
          {
            emoji: '👤',
            label: t(ctx, 'topup_card_holder_label'),
            value: escapeTelegramMarkdown(cardHolder),
          },
        ],
      },
    ],
    footer: options.footer,
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

export async function topupConversation(conversation: MyConversation, ctx: ConversationContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  trackFunnelEvent('topup_enter');

  // Check if user already has a pending receipt
  const pendingReceipt = await ctx.services.walletService.getPendingReceiptForUser?.(telegramId);
  if (pendingReceipt) {
    await replyInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '⏳',
        title: t(ctx, 'topup_pending_title'),
        subtitle: t(ctx, 'topup_pending_subtitle'),
        primary: {
          emoji: '💰',
          label: t(ctx, 'topup_selected_amount_label'),
          value: `${localizedNumber(pendingReceipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
        },
      }),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const cardNumber = ctx.services.translationService.getSetting('card_number', '—');
  const cardHolder = ctx.services.translationService.getSetting('card_holder', '—');

  const presetKeyboard = new InlineKeyboard()
    .text(`${localizedNumber(50_000, ctx)} ${t(ctx, 'currency_toman')}`, 'amount:50000')
    .text(`${localizedNumber(100_000, ctx)} ${t(ctx, 'currency_toman')}`, 'amount:100000')
    .row()
    .text(`${localizedNumber(200_000, ctx)} ${t(ctx, 'currency_toman')}`, 'amount:200000')
    .text(`${localizedNumber(500_000, ctx)} ${t(ctx, 'currency_toman')}`, 'amount:500000')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildPaymentInfoCard(ctx, cardNumber, cardHolder, undefined, {
      footer: `ℹ️ ${t(ctx, 'topup_choose_amount_hint')}`,
    }),
    { parse_mode: 'Markdown', reply_markup: presetKeyboard }
  );

  const minimum = ctx.services.translationService.getSettingNum('topup_min_amount', 10_000);
  const maximum = ctx.services.translationService.getSettingNum('topup_max_amount', 50_000_000);
  let amountToman: number | undefined;

  const ownerId = await conversationOwnerId(conversation);
  while (amountToman === undefined) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input)) return;

    const callbackData = input.callbackQuery?.data;
    if (callbackData && callbackData.startsWith('amount:')) {
      await input.answerCallbackQuery();
      const val = Number(callbackData.slice('amount:'.length));
      if (Number.isSafeInteger(val) && val >= minimum && val <= maximum) {
        amountToman = val;
        break;
      }
    }

    const textInput = input.message && 'text' in input.message ? input.message.text : undefined;
    if (textInput) {
      const parsed = parsePositiveSafeInteger(textInput);
      if (parsed !== undefined && parsed >= minimum && parsed <= maximum) {
        amountToman = parsed;
        break;
      }
    }

    await promptInConversation(
      conversation,
      ctx,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, undefined, {
        footer: `⚠️ ${t(ctx, 'topup_amount_invalid_range', {
          min: localizedNumber(minimum, ctx),
          max: localizedNumber(maximum, ctx),
        })}`,
      }),
      { parse_mode: 'Markdown', reply_markup: presetKeyboard }
    );
  }

  let mediaInput: ReceiptMediaInput | undefined;
  while (!mediaInput) {
    await promptInConversation(
      conversation,
      ctx,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, amountToman, {
        title: t(ctx, 'topup_receipt_title'),
        subtitle: t(ctx, 'topup_receipt_subtitle'),
        footer: t(ctx, 'topup_photo_prompt'),
      }),
      { parse_mode: 'Markdown' }
    );
    mediaInput = await waitForReceiptMediaInput(conversation);
    if (mediaInput === undefined) return;

    await promptInConversation(
      conversation,
      ctx,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, amountToman, {
        title: t(ctx, 'topup_review_title'),
        subtitle: t(ctx, 'topup_review_subtitle'),
        footer: `⚠️ ${t(ctx, 'topup_review_consequence')}`,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'topup_confirm_button'), 'topup:confirm')
          .row()
          .text(t(ctx, 'topup_change_receipt_button'), 'topup:change_receipt')
          .row()
          .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
      }
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

  try {
    const receiptId = await ctx.services.walletService.submitTopupReceipt(
      telegramId,
      amountToman,
      photoFileId,
      mediaType
    );
    trackFunnelEvent('receipt_submit');

    // Real-time admin notification: forward the receipt immediately so admins
    // can act without opening the pending-receipts section. The section remains
    // available for later browsing/management.
    await notifyAdminsOfReceipt(ctx, receiptId, telegramId, amountToman, photoFileId, mediaType);

    await sendArtifactInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'topup_success_title'),
        subtitle: t(ctx, 'topup_success_subtitle'),
        primary: {
          emoji: '🆔',
          label: t(ctx, 'topup_receipt_id_label'),
          value: `\`${receiptId}\``,
        },
      }),
      { parse_mode: 'Markdown' }
    );
    await replyInConversation(conversation, ctx, t(ctx, 'navigation_continue_hint'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'menu_wallet'), 'nav:wallet')
        .row()
        .text(t(ctx, 'menu_back'), 'nav:main'),
    });
  } catch (err) {
    if (err instanceof PendingTopupReceiptError) {
      await replyInConversation(
        conversation,
        ctx,
        buildEmptyState('⏳', t(ctx, 'topup_pending_title'), t(ctx, 'topup_pending_subtitle')),
        { parse_mode: 'Markdown' }
      );
      return;
    }
    logger.error({ err, telegramId }, 'Topup receipt submission failed');
    await replyInConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'topup_receipt_title'), t(ctx, 'topup_failed')),
      { parse_mode: 'Markdown' }
    );
  }
}

async function notifyAdminsOfReceipt(
  ctx: ConversationContext,
  receiptId: string,
  telegramId: number,
  amount: number,
  photoFileId: string,
  mediaType: 'photo' | 'document' = 'photo'
): Promise<void> {
  if (!ctx.services) return;
  const createdAt = new Date();
  for (const adminId of ctx.services.adminIds) {
    try {
      const adminLocale =
        (await ctx.services.userService.getLocale(adminId)) ??
        ctx.services.translationService.resolveLocale();
      const caption = buildScreen({
        emoji: '🧾',
        title: tForLocale(
          ctx.services.translationService,
          adminLocale,
          'admin_receipt_review_title'
        ),
        subtitle: tForLocale(
          ctx.services.translationService,
          adminLocale,
          'admin_receipt_review_subtitle'
        ),
        primary: {
          emoji: '⏳',
          label: tForLocale(
            ctx.services.translationService,
            adminLocale,
            'admin_receipt_queue_pending_label'
          ),
          value: tForLocale(ctx.services.translationService, adminLocale, 'ui_status_pending'),
        },
        sections: [
          {
            emoji: '💳',
            title: tForLocale(
              ctx.services.translationService,
              adminLocale,
              'admin_receipt_queue_section'
            ),
            fields: [
              {
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_id_label'
                ),
                value: escapeTelegramMarkdown(receiptId),
              },
              {
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_user_label'
                ),
                value: localizedNumberForLocale(telegramId, adminLocale),
              },
              {
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_amount_label'
                ),
                value: `${localizedNumberForLocale(amount, adminLocale)} ${tForLocale(ctx.services.translationService, adminLocale, 'currency_toman')}`,
              },
              {
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_created_label'
                ),
                value: createdAt.toLocaleDateString(adminLocale === 'fa' ? 'fa-IR' : 'en-US'),
              },
            ],
          },
        ],
      });
      const receiptMenu = new InlineKeyboard()
        .text(
          tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_approve'),
          `receipt:approve_prompt:${receiptId}`
        )
        .text(
          tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_reject'),
          `receipt:reject_prompt:${receiptId}`
        );
      if (mediaType === 'document') {
        await ctx.api.sendDocument(adminId, photoFileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: receiptMenu,
        });
      } else {
        await ctx.api.sendPhoto(adminId, photoFileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: receiptMenu,
        });
      }
    } catch (err) {
      logger.warn({ err, adminId, receiptId }, 'Failed to notify admin of new receipt');
    }
  }
}

// ── Admin: set user wallet balance ────────────────────────────────────────────

export async function adminSetBalanceConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;
  let targetId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.adminBalanceTargetTelegramId;
    delete outsideCtx.session.adminBalanceTargetTelegramId;
    return selected;
  });
  while (targetId === undefined) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminWalletPrompt(ctx, t(ctx, 'admin_target_telegram_id_prompt'), {
        emoji: '👤',
        title: t(ctx, 'admin_user_profile_title'),
      }),
      { parse_mode: 'Markdown' }
    );
    const userInput = await waitForAdminTextInput(conversation);
    if (userInput === undefined) return;
    targetId = parsePositiveSafeInteger(userInput);
    if (targetId === undefined) {
      await promptInConversation(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_user_profile_title'),
          t(ctx, 'admin_invalid_telegram_id')
        ),
        { parse_mode: 'Markdown' }
      );
    }
  }
  if (!(await ctx.services.userService.exists(targetId))) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('📭', t(ctx, 'admin_user_profile_title'), t(ctx, 'admin_user_not_found')),
      { parse_mode: 'Markdown' }
    );
    return;
  }

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
    buildAdminWalletPrompt(ctx, t(ctx, 'admin_balance_operation_prompt'), {
      emoji: '💳',
      title: t(ctx, 'admin_user_wallet_section'),
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

  await promptInConversation(
    conversation,
    ctx,
    buildAdminWalletPrompt(ctx, t(ctx, 'admin_search_prompt'), {
      emoji: '🔎',
      title: t(ctx, 'admin_users_list_title'),
      subtitle: t(ctx, 'admin_users_list_subtitle'),
    }),
    { parse_mode: 'Markdown' }
  );
  const searchInput = await waitForAdminTextInput(conversation);
  if (searchInput === undefined) return;
  const query = searchInput.trim().replace(/^@/, '');

  const u = await ctx.services.userService.findProfile(query);
  if (!u) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('📭', t(ctx, 'admin_users_list_title'), t(ctx, 'admin_user_not_found')),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await replyInAdminConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✅',
      title: t(ctx, 'admin_user_profile_title'),
      subtitle: t(ctx, 'admin_user_search_found', { telegram_id: u.telegramId }),
      primary: {
        emoji: '🆔',
        label: t(ctx, 'admin_user_id_label'),
        value: `\`${localizedNumber(u.telegramId, ctx)}\``,
      },
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_user_open_profile_button'), `admin:user:view:${u.telegramId}`)
        .row()
        .text(t(ctx, 'menu_back'), 'admin:users:page:1'),
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

  const currentBalance = await ctx.services.walletService.getBalance(telegramId);
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
        emoji: operation === 'deduct' ? '➖' : '➕',
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
              value: `\`${localizedNumber(telegramId, ctx)}\``,
            },
            {
              emoji: '💰',
              label: t(ctx, 'admin_user_balance_label'),
              value: `${localizedNumber(currentBalance, ctx)} ${t(ctx, 'currency_toman')}`,
            },
          ],
        },
      ],
    }),
    { parse_mode: 'Markdown', reply_markup: confirmationKeyboard }
  );
  if (!(await waitForAdminCallbackInput(conversation, ['balance-confirm']))) return;

  try {
    const updated = await ctx.services.walletService.adjustBalanceAdmin({
      telegramId,
      operation,
      amount,
      adminId,
      description: `Admin dashboard ${source}`,
    });
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
      { parse_mode: 'Markdown' }
    );
    try {
      const locale =
        (await ctx.services.userService.getLocale(telegramId)) ??
        ctx.services.translationService.resolveLocale();
      await ctx.api.sendMessage(
        telegramId,
        buildScreen({
          emoji: '💳',
          title: tForLocale(ctx.services.translationService, locale, 'wallet_dashboard_title'),
          subtitle: tForLocale(
            ctx.services.translationService,
            locale,
            'balance_adjusted_notification',
            {
              balance: localizedNumberForLocale(updated, locale),
            }
          ),
          primary: {
            emoji: '💰',
            label: tForLocale(ctx.services.translationService, locale, 'wallet_available_balance'),
            value: `${localizedNumberForLocale(updated, locale)} ${tForLocale(
              ctx.services.translationService,
              locale,
              'currency_toman'
            )}`,
          },
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            tForLocale(ctx.services.translationService, locale, 'menu_wallet'),
            'nav:wallet'
          ),
        }
      );
    } catch (notifyErr) {
      logger.warn({ notifyErr, telegramId }, 'Could not notify user about admin wallet adjustment');
    }
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
