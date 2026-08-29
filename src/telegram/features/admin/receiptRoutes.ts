import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import {
  localizedDate,
  localizedNumber,
  localizedNumberForLocale,
  resolveServiceLocale,
  t,
  tForLocale,
} from '../../locale.js';
import { buildEmptyState, buildScreen, buildStatusBadge, renderScreen } from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { logger } from '../../../infra/logger.js';

const RECEIPT_PAGE_SIZE = 4;
const RECEIPT_ID_CAPTURE = '([a-zA-Z0-9_-]+)';

type PendingReceipt = {
  id: string;
  telegramId: number;
  amount: number;
  photoFileId?: string;
  mediaType?: 'photo' | 'document';
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
      new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin')
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

export function registerReceiptAdminRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^receipt:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showReceiptQueue(ctx, Number(ctx.match[1]) || 1);
  });

  bot.callbackQuery(new RegExp(`^receipt:view:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await showReceiptReview(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  bot.callbackQuery(
    /^receipt:(approve|reject)_prompt:([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      await promptReceiptReview(ctx, ctx.match[1]!, ctx.match[2]!, Number(ctx.match[3]) || 1);
    }
  );

  bot.callbackQuery(
    /^(?:receipt:reject_confirm|rcpt:rej):([a-zA-Z0-9_-]+):(\d+):([a-z_]+)$/u,
    async (ctx) => {
      if (!ctx.services) return;
      const receiptId = ctx.match[1]!;
      const page = Number(ctx.match[2]) || 1;
      const reason = ctx.match[3]! as ReceiptRejectReason;
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

  bot.callbackQuery(
    /^receipt:(approve|reject)_confirm:([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      if (!ctx.services) return;
      const action = ctx.match[1]! as 'approve' | 'reject';
      const receiptId = ctx.match[2]!;
      const page = Number(ctx.match[3]) || 1;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

      if (action === 'approve') {
        const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
        if (result) {
          await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
          await renderReceiptResult(ctx, 'approve', page);
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

  bot.callbackQuery(/^receipt:batch_prompt:(\d+)$/u, async (ctx) => {
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

  bot.callbackQuery('receipt:batch_confirm', async (ctx) => {
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
  bot.callbackQuery(/^receipt-(approve|reject):([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    await promptReceiptReview(ctx, ctx.match[1]!, ctx.match[2]!);
  });
}

async function showReceiptReview(ctx: MenuContext, receiptId: string, page: number): Promise<void> {
  if (!ctx.services) return;
  const receipt = (await ctx.services.walletService.getPendingTopup(receiptId)) as
    PendingReceipt | undefined;
  if (!receipt) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true });
    await showReceiptQueue(ctx, page);
    return;
  }

  await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_approve'), `receipt:approve_prompt:${receipt.id}:${page}`)
    .text(t(ctx, 'admin_receipt_reject'), `receipt:reject_prompt:${receipt.id}:${page}`)
    .row()
    .text(t(ctx, 'menu_back'), `receipt:page:${page}`);
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
          `rcpt:rej:${receipt.id}:${page}:${reason}`
        )
        .row();
    }
    keyboard.text(t(ctx, 'menu_cancel'), `receipt:view:${receipt.id}:${page}`);

    const text = buildScreen({
      emoji: '⛔',
      title: t(ctx, 'admin_receipt_reject_title'),
      subtitle: t(ctx, 'admin_receipt_reject_select_reason'),
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

  const text = buildScreen({
    emoji: '✅',
    title: t(ctx, 'admin_receipt_approve_title'),
    subtitle: t(ctx, 'admin_receipt_review_subtitle'),
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
    .text(t(ctx, 'admin_confirm_button'), `receipt:approve_confirm:${receipt.id}:${page}`)
    .row()
    .text(t(ctx, 'menu_cancel'), `receipt:view:${receipt.id}:${page}`);
  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

function buildReceiptQueueScreen(ctx: MenuContext, result: ReceiptPage): string {
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
        fields: result.items.map((receipt) => ({
          emoji: '🧾',
          label: t(ctx, 'admin_receipt_id_label'),
          value: `\`#${receipt.id}\` · ${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')} · ${receipt.createdAt ? localizedDate(receipt.createdAt, ctx) : '—'}`,
        })),
      },
    ],
  });
}

function buildReceiptQueueKeyboard(ctx: MenuContext, result: ReceiptPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const receipt of result.items) {
    keyboard
      .text(
        t(ctx, 'admin_receipt_queue_item_label', {
          receipt_id: receipt.id,
          amount: localizedNumber(receipt.amount, ctx),
        }),
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
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
}

function buildReceiptReviewScreen(ctx: MenuContext, receipt: PendingReceipt): string {
  return buildScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_receipt_review_title'),
    subtitle: t(ctx, 'admin_receipt_review_subtitle'),
    primary: {
      emoji: '⏳',
      label: t(ctx, 'admin_receipt_queue_pending_label'),
      value: buildStatusBadge(ctx, 'pending'),
    },
    sections: [
      {
        emoji: '💳',
        title: t(ctx, 'admin_receipt_queue_section'),
        fields: [
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\``,
          },
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: String(receipt.telegramId),
          },
          {
            label: t(ctx, 'admin_receipt_amount_label'),
            value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_receipt_created_label'),
            value: receipt.createdAt ? localizedDate(receipt.createdAt, ctx) : '—',
          },
        ],
      },
    ],
  });
}

async function renderReceiptResult(
  ctx: MenuContext,
  action: 'approve' | 'reject',
  page: number,
  reason?: ReceiptRejectReason
): Promise<void> {
  const reasonLabelKey = reason ? `admin_receipt_reject_reason_${reason}` : undefined;
  const reasonLabel = reasonLabelKey ? t(ctx, reasonLabelKey) : undefined;

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
    new InlineKeyboard().text(t(ctx, 'menu_back'), `receipt:page:${page}`)
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
    new InlineKeyboard().text(t(ctx, 'menu_back'), `receipt:page:${page}`)
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
  try {
    const locale =
      (await ctx.services.userService.getLocale(telegramId)) ??
      resolveServiceLocale(ctx.services.translationService);
    const reasonDetailKey = reason ? `receipt_result_rejected_reason_${reason}` : undefined;
    const reasonDetail = reasonDetailKey
      ? tForLocale(ctx.services.translationService, locale, reasonDetailKey)
      : undefined;

    await ctx.api.sendMessage(
      telegramId,
      buildScreen({
        emoji: approved ? '✅' : '⚠️',
        title: tForLocale(
          ctx.services.translationService,
          locale,
          approved ? 'receipt_result_approved_title' : 'receipt_result_rejected_title'
        ),
        subtitle: tForLocale(
          ctx.services.translationService,
          locale,
          approved ? 'receipt_result_approved_subtitle' : 'receipt_result_rejected_subtitle'
        ),
        ...(approved && amount !== undefined
          ? {
              primary: {
                emoji: '💰',
                label: tForLocale(
                  ctx.services.translationService,
                  locale,
                  'receipt_result_amount_label'
                ),
                value: `${localizedNumberForLocale(amount, locale)} ${tForLocale(ctx.services.translationService, locale, 'currency_toman')}`,
              },
            }
          : !approved && reasonDetail
            ? {
                primary: {
                  emoji: '⚠️',
                  label: tForLocale(
                    ctx.services.translationService,
                    locale,
                    'receipt_result_rejected_reason_label'
                  ),
                  value: reasonDetail,
                },
              }
            : {}),
        footer: tForLocale(ctx.services.translationService, locale, 'receipt_result_next_hint'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          tForLocale(ctx.services.translationService, locale, 'menu_wallet'),
          'nav:wallet'
        ),
      }
    );
  } catch (err) {
    logger.warn({ err, telegramId, receiptId }, 'Failed to deliver receipt result to user');
  }
}

async function renderReceiptCaptionOrText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  if (isPhotoCallback(ctx)) {
    await ctx.editMessageCaption({
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    return;
  }
  await renderReceiptText(ctx, text, keyboard);
}

async function renderReceiptText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  if (ctx.callbackQuery?.message && !isPhotoCallback(ctx)) {
    await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    return;
  }
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isPhotoCallback(ctx: MenuContext): boolean {
  const message = ctx.callbackQuery?.message;
  return Boolean(message && 'photo' in message);
}
