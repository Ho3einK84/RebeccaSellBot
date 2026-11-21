import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t } from '../../locale.js';
import {
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  guardAdminCallbacks,
  isMessageEditUnavailableError,
  isMessageNotModifiedError,
  renderScreen,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { receiptDuplicatePolicy } from '../../../domain/services/FeatureSettings.js';
import { TopupVoidError } from '../../../domain/services/WalletContracts.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  sendReceiptApprovalNotification,
  sendReceiptRejectionNotification,
  sendReceiptVoidedNotification,
} from './adminNotifications.js';

const RECEIPT_PAGE_SIZE = 4;
const RECEIPT_ID_CAPTURE = '([a-zA-Z0-9_-]+)';

type PendingReceipt = {
  id: string;
  telegramId: number;
  amount: number;
  photoFileId?: string;
  mediaType?: 'photo' | 'document';
  status?: string;
  duplicateOfReceiptId?: string | null;
  voidedAt?: Date | null;
  voidedBy?: number | null;
  voidReason?: string | null;
  createdAt?: Date;
};

type ReceiptPage = {
  items: PendingReceipt[];
  total: number;
  page: number;
  totalPages: number;
};

export async function showReceiptQueue(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = (await ctx.services.walletService.listPendingTopupsPage(
    requestedPage,
    RECEIPT_PAGE_SIZE
  )) as ReceiptPage;

  if (result.items.length === 0) {
    await renderReceiptText(
      ctx,
      buildEmptyState(
        '📭',
        t(ctx, 'admin_receipt_queue_empty_title'),
        t(ctx, 'admin_receipt_queue_empty_body')
      ),
      new InlineKeyboard()
        .text(t(ctx, 'admin_receipt_void_button'), callbackData('rcpt', 'hist', 1))
        .row()
        .text(t(ctx, 'admin_sales_bank_cards_button'), callbackData('rcpt', 'cards'))
        .row()
        .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin')
    );
    return;
  }

  await renderReceiptText(
    ctx,
    buildReceiptQueueScreen(ctx, result),
    buildReceiptQueueKeyboard(ctx, result)
  );
}

export type ReceiptRejectReason =
  'unclear' | 'not_received' | 'duplicate' | 'amount_mismatch' | 'other';

const REJECT_REASON_CODES: Record<ReceiptRejectReason, string> = {
  unclear: 'u',
  not_received: 'n',
  duplicate: 'd',
  amount_mismatch: 'a',
  other: 'o',
};

const REJECT_CODE_TO_REASON: Record<string, ReceiptRejectReason> = {
  u: 'unclear',
  n: 'not_received',
  d: 'duplicate',
  a: 'amount_mismatch',
  o: 'other',
  unclear: 'unclear',
  not_received: 'not_received',
  duplicate: 'duplicate',
  amount_mismatch: 'amount_mismatch',
  other: 'other',
};

export function registerReceiptAdminRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);

  adminCallback(/^receipt:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showReceiptQueue(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback(new RegExp(`^receipt:view:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await showReceiptReview(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(/^rcpt:hist:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showApprovedReceiptHistory(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:va:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await showApprovedReceiptDetail(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:vp:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await promptReceiptVoid(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:vc:${RECEIPT_ID_CAPTURE}:(\\d+):([01])$`, 'u'), async (ctx) => {
    await executeReceiptVoid(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1, ctx.match[3] === '1');
  });

  adminCallback('rcpt:cards', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showBankCardsSummary(ctx);
  });

  adminCallback(/^(?:receipt:quick_approve|rcpt:qa):([a-zA-Z0-9_-]+)(?::(\d+))?$/u, async (ctx) => {
    if (!ctx.services) return;
    const receiptId = ctx.match[1]!;
    const page = Number(ctx.match[2]) || 1;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

    const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
    if (result) {
      await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
      await renderReceiptResult(ctx, 'approve', page, undefined, receiptId);
    } else {
      await renderReceiptAlreadyReviewed(ctx, page);
    }
  });

  adminCallback(
    /^(?:receipt:(approve|reject)_prompt|rcpt:(ap|rp)):([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      const action = ctx.match[1] ?? (ctx.match[2] === 'ap' ? 'approve' : 'reject');
      await promptReceiptReview(ctx, action, ctx.match[3]!, Number(ctx.match[4]) || 1);
    }
  );

  adminCallback(
    /^(?:receipt:reject_confirm|rcpt:rej):([a-zA-Z0-9_-]+):(\d+):([a-z_]+)$/u,
    async (ctx) => {
      if (!ctx.services) return;
      const receiptId = ctx.match[1]!;
      const page = Number(ctx.match[2]) || 1;
      const reason = REJECT_CODE_TO_REASON[ctx.match[3]!] ?? 'other';
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

      const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id);
      if (result) {
        await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId, reason);
        await renderReceiptResult(ctx, 'reject', page, reason);
      } else {
        await renderReceiptAlreadyReviewed(ctx, page);
      }
    }
  );

  adminCallback(
    /^(?:receipt:(approve|reject)_confirm|rcpt:(ac|rc)):([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      if (!ctx.services) return;
      const action = (ctx.match[1] ?? (ctx.match[2] === 'ac' ? 'approve' : 'reject')) as
        'approve' | 'reject';
      const receiptId = ctx.match[3]!;
      const page = Number(ctx.match[4]) || 1;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

      if (action === 'approve') {
        const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
        if (result) {
          await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
          await renderReceiptResult(ctx, 'approve', page, undefined, receiptId);
        } else {
          await renderReceiptAlreadyReviewed(ctx, page);
        }
        return;
      }

      const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id);
      if (result) {
        await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId, 'other');
        await renderReceiptResult(ctx, 'reject', page, 'other');
      } else {
        await renderReceiptAlreadyReviewed(ctx, page);
      }
    }
  );

  adminCallback(/^receipt:batch_prompt:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const page = Number(ctx.match[1]) || 1;
    const result = (await ctx.services.walletService.listPendingTopupsPage(
      page,
      RECEIPT_PAGE_SIZE
    )) as ReceiptPage;
    ctx.session.adminReceiptBatch = { ids: result.items.map((item) => item.id), page: result.page };
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    const totalAmount = result.items.reduce((sum, item) => sum + item.amount, 0);
    await renderReceiptText(
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_receipt_batch_title'),
        subtitle: t(ctx, 'admin_receipt_batch_subtitle'),
        primary: {
          emoji: '💰',
          label: t(ctx, 'admin_receipt_batch_total_label'),
          value: `${localizedNumber(totalAmount, ctx)} ${t(ctx, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '🧾',
            title: t(ctx, 'admin_receipt_queue_section'),
            fields: [
              {
                label: t(ctx, 'admin_receipt_batch_count_label'),
                value: localizedNumber(result.items.length, ctx),
              },
            ],
          },
        ],
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_receipt_batch_confirm_button'), 'receipt:batch_confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), `receipt:page:${result.page}`)
    );
  });

  adminCallback('receipt:batch_confirm', async (ctx) => {
    if (!ctx.services) return;
    const batch = ctx.session.adminReceiptBatch;
    delete ctx.session.adminReceiptBatch;
    if (!batch || batch.ids.length === 0) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'button_action_failed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    let approved = 0;
    for (const receiptId of batch.ids) {
      const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
      if (!result) continue;
      approved += 1;
      await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
    }
    await renderReceiptText(
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_receipt_batch_result_title'),
        subtitle: t(ctx, 'admin_receipt_batch_result_subtitle', {
          count: localizedNumber(approved, ctx),
        }),
        primary: {
          emoji: '🧾',
          label: t(ctx, 'admin_receipt_batch_count_label'),
          value: localizedNumber(approved, ctx),
        },
      }),
      new InlineKeyboard().text(t(ctx, 'menu_back'), `receipt:page:${batch.page}`)
    );
  });

  // Convert buttons emitted before the confirmation refactor into review screens.
  adminCallback(/^receipt-(approve|reject):([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    await promptReceiptReview(ctx, ctx.match[1]!, ctx.match[2]!);
  });
}

async function showReceiptReview(ctx: MenuContext, receiptId: string, page: number): Promise<void> {
  if (!ctx.services) return;
  const receipt = (await ctx.services.walletService.getPendingTopup(receiptId)) as
    PendingReceipt | undefined;
  if (!receipt) {
    const existing =
      typeof ctx.services.walletService.getTopupById === 'function'
        ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
        : undefined;
    if (existing && (existing.status === 'approved' || existing.status === 'voided')) {
      await showApprovedReceiptDetail(ctx, receiptId, page);
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true });
    await showReceiptQueue(ctx, page);
    return;
  }

  await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_approve'), callbackData('rcpt', 'qa', receipt.id, page))
    .text(t(ctx, 'admin_receipt_reject'), callbackData('rcpt', 'rp', receipt.id, page))
    .row()
    .text(t(ctx, 'menu_back'), callbackData('receipt', 'page', page));
  const text = buildReceiptReviewScreen(ctx, receipt);

  if (receipt.photoFileId) {
    if (receipt.mediaType === 'document') {
      await ctx.replyWithDocument(receipt.photoFileId, {
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } else {
      await ctx.replyWithPhoto(receipt.photoFileId, {
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
    return;
  }
  await renderReceiptText(ctx, text, keyboard);
}

async function showApprovedReceiptHistory(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  if (typeof ctx.services.walletService.listTopupsPage !== 'function') {
    await showReceiptQueue(ctx, 1);
    return;
  }
  const result = await ctx.services.walletService.listTopupsPage({
    page: requestedPage,
    pageSize: RECEIPT_PAGE_SIZE,
    status: 'approved',
  });

  if (result.items.length === 0) {
    await renderReceiptText(
      ctx,
      buildEmptyState(
        '📭',
        t(ctx, 'admin_receipt_void_title'),
        t(ctx, 'admin_receipt_queue_empty_body')
      ),
      new InlineKeyboard()
        .text(t(ctx, 'admin_receipt_queue_title'), 'receipt:page:1')
        .row()
        .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin')
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const receipt of result.items) {
    const shortId = formatReceiptShortId(receipt.id);
    keyboard
      .text(
        t(ctx, 'admin_receipt_queue_item_label', {
          amount: localizedNumber(receipt.amount, ctx),
          telegram_id: receipt.telegramId,
          short_id: shortId,
        }),
        callbackData('rcpt', 'va', receipt.id, result.page)
      )
      .row();
  }
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(t(ctx, 'pagination_previous'), callbackData('rcpt', 'hist', result.page - 1));
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(t(ctx, 'pagination_next'), callbackData('rcpt', 'hist', result.page + 1));
    }
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_receipt_queue_title'), 'receipt:page:1')
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  await renderReceiptText(
    ctx,
    buildScreen({
      emoji: '🧾',
      title: t(ctx, 'admin_receipt_void_title'),
      subtitle: t(ctx, 'admin_receipt_queue_subtitle'),
      primary: {
        emoji: '✅',
        label: t(ctx, 'admin_user_receipt_status_approved'),
        value: localizedNumber(result.total, ctx),
      },
      sections: [
        {
          emoji: '📋',
          title: t(ctx, 'admin_receipt_queue_section'),
          fields: result.items.map((receipt) => {
            const shortId = formatReceiptShortId(receipt.id);
            const duplicateSuffix = receipt.duplicateOfReceiptId
              ? `\n${formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)}`
              : '';
            return {
              emoji: '💳',
              label: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
              value: `${t(ctx, 'admin_receipt_user_label')}: \`${receipt.telegramId}\` (${t(ctx, 'admin_receipt_id_label')}: \`${shortId}\`)${duplicateSuffix}`,
            };
          }),
        },
      ],
    }),
    keyboard
  );
}

async function showApprovedReceiptDetail(
  ctx: MenuContext,
  receiptId: string,
  page: number
): Promise<void> {
  if (!ctx.services) return;
  const receipt =
    typeof ctx.services.walletService.getTopupById === 'function'
      ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
      : undefined;
  if (!receipt) {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_receipt_void_not_approved'),
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
  const shortId = formatReceiptShortId(receipt.id);
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  const isVoided = receipt.status === 'voided';
  const isApproved = receipt.status === 'approved';

  const statusText = isVoided
    ? t(ctx, 'admin_user_receipt_status_voided')
    : isApproved
      ? t(ctx, 'admin_user_receipt_status_approved')
      : receipt.status === 'rejected'
        ? t(ctx, 'admin_user_receipt_status_rejected')
        : t(ctx, 'admin_user_receipt_status_pending');

  const keyboard = new InlineKeyboard();
  if (isApproved) {
    keyboard
      .text(t(ctx, 'admin_receipt_void_button'), callbackData('rcpt', 'vp', receipt.id, page))
      .row();
  }
  keyboard
    .text(t(ctx, 'menu_back'), callbackData('rcpt', 'hist', page))
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  const text = buildScreen({
    emoji: isVoided ? '🚫' : '🧾',
    title: isVoided ? t(ctx, 'admin_receipt_void_title') : t(ctx, 'admin_receipt_review_title'),
    subtitle: duplicateBanner ?? statusText,
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            emoji: '🆔',
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            emoji: '🧾',
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
          {
            emoji: '📅',
            label: t(ctx, 'admin_receipt_created_label'),
            value: receipt.createdAt ? localizedDate(receipt.createdAt, ctx) : '—',
          },
        ],
      },
    ],
  });

  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

async function promptReceiptVoid(ctx: MenuContext, receiptId: string, page: number): Promise<void> {
  if (!ctx.services) return;
  const receipt =
    typeof ctx.services.walletService.getTopupById === 'function'
      ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
      : undefined;

  if (!receipt) {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_receipt_void_not_approved'),
      show_alert: true,
    });
    return;
  }
  if (receipt.status === 'voided') {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_receipt_void_already_voided'),
      show_alert: true,
    });
    return;
  }
  if (receipt.status !== 'approved') {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_receipt_void_not_approved'),
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
  const shortId = formatReceiptShortId(receipt.id);
  const currency = t(ctx, 'currency_toman');
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  const confirmPrompt = t(ctx, 'admin_receipt_void_confirm_prompt', {
    short_id: shortId,
    amount: localizedNumber(receipt.amount, ctx),
    currency,
    telegram_id: String(receipt.telegramId),
  });

  const text = buildScreen({
    emoji: '🚫',
    title: t(ctx, 'admin_receipt_void_title'),
    subtitle: duplicateBanner ? `${duplicateBanner}\n${confirmPrompt}` : confirmPrompt,
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${currency}`,
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            emoji: '🆔',
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            emoji: '🧾',
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
        ],
      },
    ],
  });

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_void_only_button'), callbackData('rcpt', 'vc', receipt.id, page, 0))
    .row()
    .text(
      t(ctx, 'admin_receipt_void_and_disable_button'),
      callbackData('rcpt', 'vc', receipt.id, page, 1)
    )
    .row()
    .text(t(ctx, 'menu_cancel'), callbackData('rcpt', 'hist', page));

  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

async function executeReceiptVoid(
  ctx: MenuContext,
  receiptId: string,
  page: number,
  disablePurchasedConfigs: boolean
): Promise<void> {
  if (!ctx.services || !ctx.from) return;
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_queue_title'), `receipt:page:${page}`)
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  try {
    const result = await ctx.services.walletService.voidApprovedTopup({
      receiptId,
      adminId: ctx.from.id,
      disablePurchasedConfigs,
      disableConfig: (username, panelId) =>
        ctx.services!.configService.disableConfig(username, panelId),
    });

    if (result.alreadyVoided) {
      await renderReceiptCaptionOrText(
        ctx,
        buildEmptyState(
          'ℹ️',
          t(ctx, 'admin_receipt_void_title'),
          t(ctx, 'admin_receipt_void_already_voided')
        ),
        keyboard
      );
      return;
    }

    const shortId = formatReceiptShortId(result.receiptId);
    const currency = t(ctx, 'currency_toman');
    await sendReceiptVoidedNotification(ctx.api, ctx.services, {
      telegramId: result.telegramId,
      receiptId: result.receiptId,
      amount: result.originalAmount,
      deductedAmount: result.deductedAmount,
      disabledConfigsCount: result.disabledConfigs.length,
      shortId,
    });

    const subtitle =
      result.disabledConfigs.length > 0
        ? t(ctx, 'admin_receipt_void_success_with_disabled', {
            short_id: shortId,
            amount: localizedNumber(result.deductedAmount, ctx),
            currency,
            count: localizedNumber(result.disabledConfigs.length, ctx),
          })
        : t(ctx, 'admin_receipt_void_success', {
            short_id: shortId,
            amount: localizedNumber(result.deductedAmount, ctx),
            currency,
          });

    await renderReceiptCaptionOrText(
      ctx,
      buildScreen({
        emoji: '🚫',
        title: t(ctx, 'admin_user_audit_action_receipt_voided'),
        subtitle,
        primary: {
          emoji: '💳',
          label: t(ctx, 'tx_type_topup_void'),
          value: t(ctx, 'admin_user_receipt_status_voided'),
        },
        sections: [
          {
            emoji: '🧾',
            title: t(ctx, 'admin_receipt_user_section'),
            fields: [
              {
                emoji: '🆔',
                label: t(ctx, 'admin_receipt_user_label'),
                value: `\`${result.telegramId}\``,
              },
              {
                emoji: '💰',
                label: t(ctx, 'admin_receipt_amount_label'),
                value: `${localizedNumber(result.deductedAmount, ctx)} ${currency}`,
              },
            ],
          },
        ],
      }),
      keyboard
    );
  } catch (err) {
    if (
      err instanceof TopupVoidError ||
      (err instanceof Error &&
        ((err as { code?: string }).code === 'TOPUP_VOID_NOT_APPROVED' ||
          (err as { code?: string }).code === 'TOPUP_VOID_NOT_FOUND'))
    ) {
      await renderReceiptCaptionOrText(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_receipt_void_title'),
          t(ctx, 'admin_receipt_void_not_approved')
        ),
        keyboard
      );
      return;
    }
    throw err;
  }
}

async function showBankCardsSummary(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const paymentService = ctx.services.paymentService;
  const configuredCards =
    typeof paymentService?.getConfiguredBankCards === 'function'
      ? paymentService.getConfiguredBankCards()
      : [];

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_sales_bank_cards_add_button'), 'nav:admin:sales')
    .row()
    .text(t(ctx, 'admin_receipt_queue_title'), 'receipt:page:1')
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  if (configuredCards.length === 0) {
    await renderReceiptText(
      ctx,
      buildEmptyState(
        '💳',
        t(ctx, 'admin_sales_bank_cards_title'),
        t(ctx, 'admin_sales_bank_cards_empty')
      ),
      keyboard
    );
    return;
  }

  await renderReceiptText(
    ctx,
    buildScreen({
      emoji: '💳',
      title: t(ctx, 'admin_sales_bank_cards_title'),
      subtitle: t(ctx, 'admin_sales_bank_cards_subtitle'),
      primary: {
        emoji: '🏦',
        label: t(ctx, 'admin_setting_bank_cards_json'),
        value: localizedNumber(configuredCards.length, ctx),
      },
      sections: configuredCards.map((card) => ({
        emoji: card.enabled ? '🟢' : '⚪️',
        title: `\`${sanitizeTelegramInlineCode(card.id)}\``,
        fields: [
          {
            label: t(ctx, 'topup_card_number_label'),
            value: `\`${sanitizeTelegramInlineCode(card.cardNumber)}\``,
          },
          {
            label: t(ctx, 'topup_card_holder_label'),
            value: escapeTelegramMarkdown(card.cardHolder || '—'),
          },
          ...(card.bankName
            ? [
                {
                  label: t(ctx, 'topup_card_bank_label'),
                  value: escapeTelegramMarkdown(card.bankName),
                },
              ]
            : []),
        ],
      })),
    }),
    keyboard
  );
}

async function promptReceiptReview(
  ctx: MenuContext,
  action: 'approve' | 'reject' | string,
  receiptId: string,
  page = 1
): Promise<void> {
  if (!ctx.services) return;
  const receipt = (await ctx.services.walletService.getPendingTopup(receiptId)) as
    PendingReceipt | undefined;
  if (!receipt) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true });
    return;
  }

  const normalizedAction = action === 'approve' ? 'approve' : 'reject';
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });

  if (normalizedAction === 'reject') {
    const reasons: ReceiptRejectReason[] = [
      'unclear',
      'not_received',
      'duplicate',
      'amount_mismatch',
      'other',
    ];

    const keyboard = new InlineKeyboard();
    for (const reason of reasons) {
      keyboard
        .text(
          t(ctx, `admin_receipt_reject_reason_${reason}`),
          callbackData('rcpt', 'rej', receipt.id, page, REJECT_REASON_CODES[reason])
        )
        .row();
    }
    keyboard.text(t(ctx, 'menu_cancel'), callbackData('receipt', 'view', receipt.id, page));

    const rejectSubtitle = t(ctx, 'admin_receipt_reject_select_reason');
    const text = buildScreen({
      emoji: '⛔',
      title: t(ctx, 'admin_receipt_reject_title'),
      subtitle: duplicateBanner ? `${duplicateBanner}\n${rejectSubtitle}` : rejectSubtitle,
      primary: {
        emoji: '💰',
        label: t(ctx, 'admin_receipt_amount_label'),
        value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
      },
      sections: [
        {
          emoji: '👤',
          title: t(ctx, 'admin_receipt_review_title'),
          fields: [
            {
              label: t(ctx, 'admin_receipt_id_label'),
              value: `\`${receipt.id}\``,
            },
            {
              label: t(ctx, 'admin_receipt_user_label'),
              value: String(receipt.telegramId),
            },
          ],
        },
      ],
      footer: t(ctx, 'admin_receipt_reject_consequence'),
    });

    await renderReceiptCaptionOrText(ctx, text, keyboard);
    return;
  }

  const approveSubtitle = t(ctx, 'admin_receipt_review_subtitle');
  const text = buildScreen({
    emoji: '✅',
    title: t(ctx, 'admin_receipt_approve_title'),
    subtitle: duplicateBanner ? `${duplicateBanner}\n${approveSubtitle}` : approveSubtitle,
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_receipt_review_title'),
        fields: [
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\``,
          },
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: String(receipt.telegramId),
          },
        ],
      },
    ],
    footer: t(ctx, 'admin_receipt_approve_consequence'),
  });
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_confirm_button'), callbackData('rcpt', 'ac', receipt.id, page))
    .row()
    .text(t(ctx, 'menu_cancel'), callbackData('receipt', 'view', receipt.id, page));
  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

export function formatReceiptShortId(receiptId: string): string {
  const match = receiptId.match(/_([a-zA-Z0-9]{4,8})$/u);
  if (match) return match[1]!;
  return receiptId.length > 8 ? receiptId.slice(-6) : receiptId;
}

function formatReceiptDuplicateWarning(ctx: MenuContext, duplicateOfReceiptId: string): string {
  return t(ctx, 'admin_receipt_duplicate_warning', {
    short_id: formatReceiptShortId(duplicateOfReceiptId),
  });
}

function buildReceiptQueueScreen(ctx: MenuContext, result: ReceiptPage): string {
  const duplicatePolicy = ctx.services?.translationService
    ? receiptDuplicatePolicy(ctx.services.translationService)
    : 'warn';
  const policyLabel = t(
    ctx,
    duplicatePolicy === 'block'
      ? 'admin_receipt_duplicate_policy_block'
      : 'admin_receipt_duplicate_policy_warn'
  );

  return buildScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_receipt_queue_title'),
    subtitle: t(ctx, 'admin_receipt_queue_subtitle'),
    primary: {
      emoji: '⏳',
      label: t(ctx, 'admin_receipt_queue_pending_label'),
      value: `${buildStatusBadge(ctx, 'pending')} · ${localizedNumber(result.total, ctx)}`,
    },
    sections: [
      {
        emoji: '📋',
        title: t(ctx, 'admin_receipt_queue_section'),
        fields: result.items.map((receipt) => {
          const shortId = formatReceiptShortId(receipt.id);
          const duplicateSuffix = receipt.duplicateOfReceiptId
            ? `\n${formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)}`
            : '';
          return {
            emoji: receipt.duplicateOfReceiptId ? '⚠️' : '💳',
            label: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
            value: `${t(ctx, 'admin_receipt_user_label')}: \`${receipt.telegramId}\` (${t(ctx, 'admin_receipt_id_label')}: \`${shortId}\`)${duplicateSuffix}`,
          };
        }),
      },
    ],
    footer: `${t(ctx, 'admin_setting_receipt_duplicate_policy')}: ${policyLabel}`,
  });
}

function buildReceiptQueueKeyboard(ctx: MenuContext, result: ReceiptPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const receipt of result.items) {
    const shortId = formatReceiptShortId(receipt.id);
    const label = t(ctx, 'admin_receipt_queue_item_label', {
      amount: localizedNumber(receipt.amount, ctx),
      telegram_id: receipt.telegramId,
      short_id: shortId,
    });
    keyboard
      .text(
        receipt.duplicateOfReceiptId ? `⚠️ ${label}` : label,
        callbackData('receipt', 'view', receipt.id, result.page)
      )
      .row();
  }
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(t(ctx, 'pagination_previous'), `receipt:page:${result.page - 1}`);
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(t(ctx, 'pagination_next'), `receipt:page:${result.page + 1}`);
    }
    keyboard.row();
  }
  return keyboard
    .text(t(ctx, 'admin_receipt_batch_button'), `receipt:batch_prompt:${result.page}`)
    .row()
    .text(t(ctx, 'admin_receipt_void_button'), callbackData('rcpt', 'hist', 1))
    .text(t(ctx, 'admin_sales_bank_cards_button'), callbackData('rcpt', 'cards'))
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
}

function buildReceiptReviewScreen(ctx: MenuContext, receipt: PendingReceipt): string {
  const shortId = formatReceiptShortId(receipt.id);
  const baseSubtitle = t(ctx, 'admin_receipt_review_subtitle');
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;

  return buildScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_receipt_review_title'),
    subtitle: duplicateBanner ? `${duplicateBanner}\n${baseSubtitle}` : baseSubtitle,
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            emoji: '🆔',
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            emoji: '🧾',
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
          {
            emoji: '📅',
            label: t(ctx, 'admin_receipt_created_label'),
            value: receipt.createdAt ? localizedDate(receipt.createdAt, ctx) : '—',
          },
        ],
      },
    ],
    footer: `⚡ ${t(ctx, 'admin_receipt_approve_hint')}`,
  });
}

async function renderReceiptResult(
  ctx: MenuContext,
  action: 'approve' | 'reject',
  page: number,
  reason?: ReceiptRejectReason,
  approvedReceiptId?: string
): Promise<void> {
  const reasonLabelKey = reason ? `admin_receipt_reject_reason_${reason}` : undefined;
  const reasonLabel = reasonLabelKey ? t(ctx, reasonLabelKey) : undefined;

  const keyboard = new InlineKeyboard();
  if (action === 'approve' && approvedReceiptId) {
    keyboard
      .text(
        t(ctx, 'admin_receipt_void_button'),
        callbackData('rcpt', 'vp', approvedReceiptId, page)
      )
      .row();
  }
  keyboard
    .text(t(ctx, 'admin_receipt_queue_title'), `receipt:page:${page}`)
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  await renderReceiptCaptionOrText(
    ctx,
    buildScreen({
      emoji: action === 'approve' ? '✅' : '⛔',
      title: t(
        ctx,
        action === 'approve'
          ? 'admin_receipt_result_approved_title'
          : 'admin_receipt_result_rejected_title'
      ),
      subtitle: t(ctx, 'admin_receipt_result_subtitle'),
      primary: {
        emoji: action === 'approve' ? '✅' : '⚪️',
        label: t(ctx, 'admin_receipt_queue_pending_label'),
        value: buildStatusBadge(ctx, action === 'approve' ? 'active' : 'inactive'),
      },
      ...(action === 'reject' && reasonLabel
        ? {
            sections: [
              {
                emoji: '📋',
                title: t(ctx, 'admin_receipt_reject_reason_label'),
                fields: [
                  {
                    label: t(ctx, 'admin_receipt_reject_reason_label'),
                    value: reasonLabel,
                  },
                ],
              },
            ],
          }
        : {}),
    }),
    keyboard
  );
}

async function renderReceiptAlreadyReviewed(ctx: MenuContext, page: number): Promise<void> {
  await renderReceiptCaptionOrText(
    ctx,
    buildEmptyState(
      '⚠️',
      t(ctx, 'admin_receipt_already_reviewed_title'),
      t(ctx, 'receipt_already_reviewed')
    ),
    new InlineKeyboard()
      .text(t(ctx, 'admin_receipt_queue_title'), `receipt:page:${page}`)
      .row()
      .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin')
  );
}

async function notifyReceiptResult(
  ctx: MenuContext,
  telegramId: number,
  approved: boolean,
  amount: number | undefined,
  receiptId: string,
  reason?: ReceiptRejectReason
): Promise<void> {
  if (!ctx.services) return;
  if (approved && amount !== undefined) {
    await sendReceiptApprovalNotification(ctx.api, ctx.services, {
      telegramId,
      amount,
      receiptId,
    });
  } else {
    await sendReceiptRejectionNotification(ctx.api, ctx.services, {
      telegramId,
      receiptId,
      reason,
    });
  }
}

async function renderReceiptCaptionOrText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  if (isMediaCallback(ctx)) {
    try {
      await ctx.editMessageCaption({
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    } catch (error) {
      if (isMessageNotModifiedError(error)) return;
      if (!isMessageEditUnavailableError(error)) throw error;
    }
  }
  await renderReceiptText(ctx, text, keyboard);
}

async function renderReceiptText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isMediaCallback(ctx: MenuContext): boolean {
  const message = ctx.callbackQuery?.message;
  return Boolean(message && ('photo' in message || 'document' in message));
}
