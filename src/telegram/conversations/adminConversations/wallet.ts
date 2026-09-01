import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import {
  localizedDate,
  localizedNumber,
  localizedNumberForLocale,
  t,
  tForLocale,
} from '../../locale.js';
import {
  PendingTopupReceiptError,
  type AdminBalanceOperation,
} from '../../../domain/services/WalletService.js';
import {
  acceptConversationOwner,
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
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
  waitForReceiptMediaInput,
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

export function formatCardNumberGrouped(rawCard: string): string {
  const digits = rawCard.replace(/\D/g, '');
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
            value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(cardNumber))}\``,
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

async function promptReceiptPreview(
  conversation: MyConversation,
  ctx: ConversationContext,
  media: ReceiptMediaInput,
  caption: string,
  keyboard: InlineKeyboard
): Promise<void> {
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
    rememberUiMessage(outsideCtx.session, message.message_id, 'prompt');
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
  const minimum = ctx.services.translationService.getSettingNum('topup_min_amount', 10_000);
  const maximum = ctx.services.translationService.getSettingNum('topup_max_amount', 10_000_000);

  const presets = buildTopupPresets(minimum, maximum);
  const presetKeyboard = new InlineKeyboard();
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

  await promptInConversation(
    conversation,
    ctx,
    buildPaymentInfoCard(ctx, cardNumber, cardHolder, undefined, {
      footer: `ℹ️ ${t(ctx, 'topup_choose_amount_hint')}`,
    }),
    { parse_mode: 'Markdown', reply_markup: presetKeyboard }
  );

  let amountToman: number | undefined;

  const ownerId = await conversationOwnerId(conversation);
  while (amountToman === undefined) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleConversationCancel(conversation, input)) return;
    await forwardConversationNavigation(conversation, input);

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
      await deleteConsumedInputMessage(input);
      const parsed = parsePositiveSafeInteger(textInput);
      if (parsed !== undefined && parsed >= minimum && parsed <= maximum) {
        amountToman = parsed;
        break;
      }
    }

    if (!textInput) await deleteConsumedInputMessage(input);
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

    await promptReceiptPreview(
      conversation,
      ctx,
      mediaInput,
      buildPaymentInfoCard(ctx, cardNumber, cardHolder, amountToman, {
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
        .text(t(ctx, 'menu_back_main'), 'nav:main'),
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
          emoji: '💰',
          label: tForLocale(
            ctx.services.translationService,
            adminLocale,
            'admin_receipt_amount_label'
          ),
          value: `${localizedNumberForLocale(amount, adminLocale)} ${tForLocale(ctx.services.translationService, adminLocale, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '👤',
            title: tForLocale(
              ctx.services.translationService,
              adminLocale,
              'admin_receipt_user_section'
            ),
            fields: [
              {
                emoji: '🆔',
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_user_label'
                ),
                value: `\`${telegramId}\``,
              },
              {
                emoji: '🧾',
                label: tForLocale(
                  ctx.services.translationService,
                  adminLocale,
                  'admin_receipt_id_label'
                ),
                value: `\`#${receiptId}\``,
              },
              {
                emoji: '📅',
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
        footer: `⚡ ${tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_approve_hint')}`,
      });
      const receiptMenu = new InlineKeyboard()
        .text(
          tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_approve'),
          `receipt:quick_approve:${receiptId}`
        )
        .text(
          tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_reject'),
          `receipt:reject_prompt:${receiptId}`
        )
        .row()
        .text(
          tForLocale(ctx.services.translationService, adminLocale, 'admin_receipt_dismiss_button'),
          'ui:dismiss'
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
              value: `\`${telegramId}\``,
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
    const referenceId = `admin_bal_${operation}_${telegramId}_${Date.now()}`;
    const updated = await ctx.services.walletService.adjustBalanceAdmin({
      telegramId,
      operation,
      amount,
      adminId,
      description: `Admin dashboard ${source}`,
      referenceId,
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
