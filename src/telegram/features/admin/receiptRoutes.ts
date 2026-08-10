import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import {
  localizedDate,
  localizedNumber,
  localizedNumberForLocale,
  resolveServiceLocale,
  t,
  tForLocale,
  tm,
} from '../../locale.js';
import { logger } from '../../../infra/logger.js';

const RECEIPT_PAGE_SIZE = 4;

export async function showReceiptQueue(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.walletService.listPendingTopupsPage(
    requestedPage,
    RECEIPT_PAGE_SIZE
  );
  if (result.items.length === 0) {
    await ctx.reply(t(ctx, 'admin_no_pending_receipts'), {
      reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back'), 'nav:admin'),
    });
    return;
  }

  for (const receipt of result.items) {
    await ctx.replyWithPhoto(receipt.photoFileId, {
      caption: tm(ctx, 'admin_pending_receipt', {
        receipt_id: receipt.id,
        telegram_id: receipt.telegramId,
        amount: localizedNumber(receipt.amount, ctx),
        created_at: localizedDate(receipt.createdAt, ctx),
      }),
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_receipt_approve'), `receipt:approve_prompt:${receipt.id}`)
        .text(t(ctx, 'admin_receipt_reject'), `receipt:reject_prompt:${receipt.id}`),
    });
  }

  const navigation = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      navigation.text(t(ctx, 'pagination_previous'), `receipt:page:${result.page - 1}`);
    }
    navigation.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      `receipt:page:${result.page}`
    );
    if (result.page < result.totalPages) {
      navigation.text(t(ctx, 'pagination_next'), `receipt:page:${result.page + 1}`);
    }
    navigation.row();
  }
  navigation
    .text(t(ctx, 'admin_receipt_batch_button'), `receipt:batch_prompt:${result.page}`)
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
  await ctx.reply(
    t(ctx, 'admin_receipt_queue_complete', {
      count: localizedNumber(result.items.length, ctx),
      total: localizedNumber(result.total, ctx),
    }),
    { reply_markup: navigation }
  );
}

export function registerReceiptAdminRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^receipt:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showReceiptQueue(ctx, Number(ctx.match[1]) || 1);
  });

  bot.callbackQuery(/^receipt:(approve|reject)_prompt:([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const receiptId = ctx.match[2]!;
    if (action === 'approve') {
      const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
      if (!result) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'receipt_already_reviewed'),
          show_alert: true,
        });
        return;
      }
      await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
      await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_approved') });
      if (ctx.callbackQuery.message?.caption) {
        await ctx
          .editMessageCaption({
            caption: `${ctx.callbackQuery.message.caption}\n\n✅ *تأیید شد*`,
            parse_mode: 'Markdown',
          })
          .catch(() => null);
      }
    } else {
      const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id);
      if (!result) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'receipt_already_reviewed'),
          show_alert: true,
        });
        return;
      }
      await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId);
      await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_rejected') });
      if (ctx.callbackQuery.message?.caption) {
        await ctx
          .editMessageCaption({
            caption: `${ctx.callbackQuery.message.caption}\n\n❌ *رد شد*`,
            parse_mode: 'Markdown',
          })
          .catch(() => null);
      }
    }
  });

  bot.callbackQuery(/^receipt:(approve|reject)_confirm:([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const receiptId = ctx.match[2]!;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    if (action === 'approve') {
      const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
      if (result) await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
      else await ctx.reply(t(ctx, 'receipt_already_reviewed'));
    } else {
      const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id);
      if (result) await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId);
      else await ctx.reply(t(ctx, 'receipt_already_reviewed'));
    }
    await showReceiptQueue(ctx, 1);
  });

  bot.callbackQuery(/^receipt:batch_prompt:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const page = Number(ctx.match[1]) || 1;
    const result = await ctx.services.walletService.listPendingTopupsPage(page, RECEIPT_PAGE_SIZE);
    ctx.session.adminReceiptBatch = { ids: result.items.map((item) => item.id), page: result.page };
    await ctx.answerCallbackQuery();
    const totalAmount = result.items.reduce((sum, item) => sum + item.amount, 0);
    await ctx.reply(
      t(ctx, 'admin_receipt_batch_confirm', {
        count: localizedNumber(result.items.length, ctx),
        amount: localizedNumber(totalAmount, ctx),
      }),
      {
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_receipt_batch_confirm_button'), 'receipt:batch_confirm')
          .row()
          .text(t(ctx, 'menu_cancel'), `receipt:page:${result.page}`),
      }
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
    await ctx.reply(t(ctx, 'admin_receipt_batch_done', { count: localizedNumber(approved, ctx) }));
    await showReceiptQueue(ctx, batch.page);
  });

  // Convert buttons emitted before this refactor into confirmation screens.
  bot.callbackQuery(/^receipt-(approve|reject):([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const receiptId = ctx.match[2]!;
    const receipt = await ctx.services.walletService.getPendingTopup(receiptId);
    if (!receipt) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await ctx.reply(
      t(
        ctx,
        action === 'approve' ? 'admin_receipt_approve_confirm' : 'admin_receipt_reject_confirm',
        {
          receipt_id: receipt.id,
          telegram_id: receipt.telegramId,
          amount: localizedNumber(receipt.amount, ctx),
        }
      ),
      {
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), `receipt:${action}_confirm:${receipt.id}`)
          .row()
          .text(t(ctx, 'menu_cancel'), 'receipt:page:1'),
      }
    );
  });
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
      tForLocale(
        ctx.services.translationService,
        locale,
        approved ? 'receipt_approved' : 'receipt_rejected',
        amount === undefined ? undefined : { amount: localizedNumberForLocale(amount, locale) }
      )
    );
  } catch (err) {
    logger.warn({ err, telegramId, receiptId }, 'Failed to deliver receipt result to user');
  }
}
