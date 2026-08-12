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
import { buildEmptyState, buildScreen, buildStatusBadge } from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import { logger } from '../../../infra/logger.js';

const RECEIPT_PAGE_SIZE = 4;
const RECEIPT_ID_CAPTURE = '([a-zA-Z0-9_-]+)';

type PendingReceipt = {
  id: string;
  telegramId: number;
  amount: number;
  photoFileId?: string;
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
      new InlineKeyboard().text(t(ctx, 'menu_back'), 'nav:admin')
    );
    return;
  }

  await renderReceiptText(
    ctx,
    buildReceiptQueueScreen(ctx, result),
    buildReceiptQueueKeyboard(ctx, result)
  );
}

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
        await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId);
        await renderReceiptResult(ctx, 'reject', page);
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
    await ctx.replyWithPhoto(receipt.photoFileId, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
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
  const text = buildScreen({
    emoji: normalizedAction === 'approve' ? '✅' : '⛔',
    title: t(
      ctx,
      normalizedAction === 'approve' ? 'admin_receipt_approve_title' : 'admin_receipt_reject_title'
    ),
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
            value: escapeTelegramMarkdown(receipt.id),
          },
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: localizedNumber(receipt.telegramId, ctx),
          },
        ],
      },
    ],
    footer: t(
      ctx,
      normalizedAction === 'approve'
        ? 'admin_receipt_approve_consequence'
        : 'admin_receipt_reject_consequence'
    ),
  });
  const keyboard = new InlineKeyboard()
    .text(
      t(ctx, 'admin_confirm_button'),
      `receipt:${normalizedAction}_confirm:${receipt.id}:${page}`
    )
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
          label: `#${escapeTelegramMarkdown(receipt.id)}`,
          value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')} · ${receipt.createdAt ? localizedDate(receipt.createdAt, ctx) : '—'}`,
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
    .text(t(ctx, 'menu_back'), 'nav:admin');
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
            value: escapeTelegramMarkdown(receipt.id),
          },
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: localizedNumber(receipt.telegramId, ctx),
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
  page: number
): Promise<void> {
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
  receiptId: string
): Promise<void> {
  if (!ctx.services) return;
  try {
    const locale =
      (await ctx.services.userService.getLocale(telegramId)) ??
      resolveServiceLocale(ctx.services.translationService);
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
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    return;
  }
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isPhotoCallback(ctx: MenuContext): boolean {
  const message = ctx.callbackQuery?.message;
  return Boolean(message && 'photo' in message);
}
