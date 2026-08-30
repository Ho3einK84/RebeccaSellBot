import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t } from '../../locale.js';
import {
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  renderScreen,
  type StatusType,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

const UUID_CAPTURE = '([0-9a-fA-F-]{36})';

export function renderBroadcastProgressBar(
  processed: number,
  total: number,
  barLength = 10
): string {
  if (total <= 0) return `\`[${'░'.repeat(barLength)}]\` 0%`;
  const percent = Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
  const filled = Math.min(barLength, Math.max(0, Math.round((percent / 100) * barLength)));
  const empty = barLength - filled;
  return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` ${percent}%`;
}

export async function renderBroadcastStatus(
  ctx: MenuContext,
  jobId: string,
  notice?: string
): Promise<void> {
  if (!ctx.services) return;
  const job = await ctx.services.broadcastService.getJob(jobId);
  if (!job) {
    await renderBroadcastScreen(
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_broadcast_status_title'),
        t(ctx, 'admin_broadcast_job_missing')
      ),
      new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin')
    );
    return;
  }
  const processed = job.sentCount + job.failedCount;
  const remaining = Math.max(0, job.recipientCount - processed);
  const progressBar = renderBroadcastProgressBar(processed, job.recipientCount);

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
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
  await renderBroadcastScreen(
    ctx,
    buildScreen({
      emoji: '📣',
      title: t(ctx, 'admin_broadcast_status_title'),
      subtitle: t(ctx, 'admin_broadcast_status_subtitle'),
      primary: {
        emoji: '📡',
        label: t(ctx, 'admin_panel_status_label'),
        value: `${buildStatusBadge(
          ctx,
          broadcastStatusBadgeType(job.status),
          t(ctx, `admin_broadcast_status_${job.status}`)
        )} · ${progressBar}`,
      },
      sections: [
        {
          emoji: '🎯',
          title: t(ctx, 'admin_broadcast_audience_section'),
          fields: [
            {
              label: t(ctx, 'admin_broadcast_audience_label'),
              value: t(ctx, `admin_broadcast_audience_${job.audience}`),
            },
            { label: t(ctx, 'admin_broadcast_id_label'), value: escapeTelegramMarkdown(job.id) },
            {
              label: t(ctx, 'admin_broadcast_created_label'),
              value: localizedDate(job.createdAt, ctx),
            },
          ],
        },
        {
          emoji: '📈',
          title: t(ctx, 'admin_broadcast_status_title'),
          fields: [
            {
              label: t(ctx, 'admin_broadcast_progress_label'),
              value: progressBar,
            },
            {
              label: t(ctx, 'admin_broadcast_processed_label'),
              value: `${localizedNumber(processed, ctx)} / ${localizedNumber(job.recipientCount, ctx)}`,
            },
            {
              label: t(ctx, 'admin_broadcast_sent_label'),
              value: `${localizedNumber(job.sentCount, ctx)} 🟢`,
            },
            {
              label: t(ctx, 'admin_broadcast_failed_label'),
              value: `${localizedNumber(job.failedCount, ctx)} ⚠️`,
            },
            {
              label: t(ctx, 'admin_broadcast_remaining_label'),
              value: localizedNumber(remaining, ctx),
            },
          ],
        },
      ],
      footer: notice,
    }),
    keyboard
  );
}

export function registerAdminBroadcastRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(new RegExp(`^admin:broadcast:status:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderBroadcastStatus(ctx, ctx.match[1]!);
  });

  bot.callbackQuery(new RegExp(`^admin:broadcast:cancel:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const jobId = ctx.match[1]!;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const requested = await ctx.services.broadcastService.requestCancel(jobId, ctx.from.id);
    await renderBroadcastStatus(
      ctx,
      jobId,
      t(ctx, requested ? 'admin_broadcast_cancel_requested' : 'admin_broadcast_cancel_unavailable')
    );
  });
}

function broadcastStatusBadgeType(status: string): StatusType {
  switch (status) {
    case 'completed':
      return 'active';
    case 'cancelled':
      return 'inactive';
    case 'cancel_requested':
      return 'warning';
    case 'queued':
    case 'running':
      return 'pending';
    default:
      return 'error';
  }
}

async function renderBroadcastScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
