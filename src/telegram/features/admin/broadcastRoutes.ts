import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import { backKeyboard } from '../../ui.js';
import { callbackData } from '../../callbackData.js';

const UUID_CAPTURE = '([0-9a-fA-F-]{36})';

export async function renderBroadcastStatus(ctx: MenuContext, jobId: string): Promise<void> {
  if (!ctx.services) return;
  const job = await ctx.services.broadcastService.getJob(jobId);
  if (!job) {
    await ctx.reply(t(ctx, 'admin_broadcast_job_missing'), {
      reply_markup: backKeyboard(ctx, 'admin'),
    });
    return;
  }
  const processed = job.sentCount + job.failedCount;
  const keyboard = new InlineKeyboard();
  if (job.status === 'queued' || job.status === 'running') {
    keyboard
      .text(
        t(ctx, 'admin_broadcast_cancel_button'),
        callbackData('admin', 'broadcast', 'cancel', job.id)
      )
      .row();
  }
  keyboard
    .text(
      t(ctx, 'admin_broadcast_refresh_button'),
      callbackData('admin', 'broadcast', 'status', job.id)
    )
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
  await ctx.reply(
    tm(ctx, 'admin_broadcast_status', {
      uuid: job.id,
      audience: t(ctx, `admin_broadcast_audience_${job.audience}`),
      status: t(ctx, `admin_broadcast_status_${job.status}`),
      processed_count: localizedNumber(processed, ctx),
      recipient_count: localizedNumber(job.recipientCount, ctx),
      sent_count: localizedNumber(job.sentCount, ctx),
      fail_count: localizedNumber(job.failedCount, ctx),
      created_at: localizedDate(job.createdAt, ctx),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export function registerAdminBroadcastRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(new RegExp(`^admin:broadcast:status:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderBroadcastStatus(ctx, ctx.match[1]!);
  });

  bot.callbackQuery(new RegExp(`^admin:broadcast:cancel:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const jobId = ctx.match[1]!;
    const requested = await ctx.services.broadcastService.requestCancel(jobId, ctx.from.id);
    await ctx.answerCallbackQuery({
      text: t(
        ctx,
        requested ? 'admin_broadcast_cancel_requested' : 'admin_broadcast_cancel_unavailable'
      ),
    });
    await renderBroadcastStatus(ctx, jobId);
  });
}
