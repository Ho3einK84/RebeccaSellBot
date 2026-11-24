import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { localizedDateTime, localizedNumber, resolveContextLocale, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  guardAdminCallbacks,
  renderScreen,
  renderSleekProgressBar,
  type AdminScreenNotice,
  type StatusType,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
} from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';

const UUID_CAPTURE = '([0-9a-fA-F-]{36})';
const JOBS_PAGE_SIZE = 5;

export function renderBroadcastProgressBar(
  processed: number,
  total: number,
  barLength = 8,
  locale: 'fa' | 'en' = 'fa'
): string {
  if (total <= 0) {
    return `${'⬜️'.repeat(barLength)} · ${locale === 'fa' ? '۰٪' : '0%'}`;
  }
  return renderSleekProgressBar(processed, total, { barLength, locale });
}

export async function renderBroadcastJobsList(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.broadcastService.listRecentJobs(requestedPage, JOBS_PAGE_SIZE);
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_nav_messaging'),
    t(ctx, 'admin_msg_jobs_title')
  );

  if (result.items.length === 0) {
    const kb = new InlineKeyboard().text(t(ctx, 'admin_menu_broadcast'), 'adm:msg:bcast').row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:msg',
      backLabel: t(ctx, 'admin_msg_back_hub'),
      showHome: true,
    });
    await renderBroadcastScreen(
      ctx,
      buildAdminEmptyState('📣', t(ctx, 'admin_msg_jobs_title'), t(ctx, 'admin_msg_jobs_empty'), {
        breadcrumb,
        notice,
      }),
      kb
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const job of result.items) {
    const processed = job.sentCount + job.failedCount;
    const statusIcon =
      job.status === 'completed'
        ? '🟢'
        : job.status === 'running' || job.status === 'queued'
          ? '⏳'
          : job.status === 'cancel_requested'
            ? '⚠️'
            : '⚪️';
    const label = `${statusIcon} ${localizedNumber(processed, ctx)}/${localizedNumber(job.recipientCount, ctx)} · ${localizedDateTime(new Date(job.createdAt), ctx)}`;
    kb.text(label, callbackData('adm', 'msg', 'st', job.id)).row();
  }

  appendAdminPagination(kb, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:msg:jobs:${p}`,
  });

  kb.text(t(ctx, 'admin_menu_broadcast'), 'adm:msg:bcast').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:msg',
    backLabel: t(ctx, 'admin_msg_back_hub'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '📋',
    title: t(ctx, 'admin_msg_jobs_title'),
    breadcrumb,
    notice,
    primary: {
      label: t(ctx, 'admin_msg_active_jobs_label'),
      value: localizedNumber(result.activeCount, ctx),
      inline: true,
      emphasizeValue: true,
    },
    sections: result.items.map((job) => {
      const processed = job.sentCount + job.failedCount;
      return {
        title: `${buildStatusBadge(ctx, broadcastStatusBadgeType(job.status), t(ctx, `admin_broadcast_status_${job.status}`))} · ${localizedDateTime(new Date(job.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'admin_broadcast_audience_label'),
            value: t(ctx, `admin_broadcast_audience_${job.audience}`),
          },
          {
            label: t(ctx, 'admin_broadcast_processed_label'),
            value: `${localizedNumber(processed, ctx)} / ${localizedNumber(job.recipientCount, ctx)}`,
          },
        ],
      };
    }),
  });

  await renderBroadcastScreen(ctx, text, kb);
}

export async function renderBroadcastStatus(
  ctx: MenuContext,
  jobId: string,
  notice?: string | AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  const resolvedNotice: AdminScreenNotice | undefined =
    typeof notice === 'string' ? { tone: 'info', text: notice } : notice;
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_nav_messaging'),
    t(ctx, 'admin_broadcast_status_title')
  );

  const job = await ctx.services.broadcastService.getJob(jobId);
  if (!job) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:msg:jobs:1',
      backLabel: t(ctx, 'admin_msg_jobs_button'),
      showHome: true,
    });
    await renderBroadcastScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_broadcast_status_title'),
        t(ctx, 'admin_broadcast_job_missing'),
        { breadcrumb }
      ),
      kb
    );
    return;
  }

  const processed = job.sentCount + job.failedCount;
  const remaining = Math.max(0, job.recipientCount - processed);
  const locale = resolveContextLocale(ctx);
  const progressBar = renderBroadcastProgressBar(processed, job.recipientCount, 8, locale);
  const isActive = job.status === 'queued' || job.status === 'running';
  const isTerminal = job.status === 'completed' || job.status === 'cancelled';

  const keyboard = new InlineKeyboard();
  if (!isTerminal) {
    keyboard.text(
      t(ctx, 'admin_broadcast_refresh_button'),
      callbackData('adm', 'msg', 'st', job.id)
    );
    if (isActive) {
      keyboard.text(
        t(ctx, 'admin_broadcast_cancel_button'),
        callbackData('adm', 'msg', 'cn', job.id)
      );
    }
    keyboard.row();
  }
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:msg:jobs:1',
    backLabel: t(ctx, 'admin_msg_jobs_button'),
    showHome: true,
  });

  const jobGroupName = job.groupId
    ? ((await ctx.services.userGroupService?.getGroupById(job.groupId).catch(() => null))?.name ??
      job.groupId)
    : null;

  await renderBroadcastScreen(
    ctx,
    buildAdminScreen({
      emoji: '📣',
      title: t(ctx, 'admin_broadcast_status_title'),
      breadcrumb,
      notice: resolvedNotice,
      primary: {
        label: t(ctx, 'admin_broadcast_status_label'),
        value: buildStatusBadge(
          ctx,
          broadcastStatusBadgeType(job.status),
          t(ctx, `admin_broadcast_status_${job.status}`)
        ),
        inline: true,
      },
      sections: [
        {
          title: t(ctx, 'admin_broadcast_details_section'),
          fields: [
            {
              label: t(ctx, 'admin_broadcast_audience_label'),
              value: t(ctx, `admin_broadcast_audience_${job.audience}`),
            },
            ...(jobGroupName
              ? [
                  {
                    label: t(ctx, 'admin_user_group_label'),
                    value: escapeTelegramMarkdown(jobGroupName),
                  },
                ]
              : []),
            { label: t(ctx, 'admin_broadcast_id_label'), value: `\`${job.id}\`` },
            {
              label: t(ctx, 'admin_broadcast_created_label'),
              value: localizedDateTime(new Date(job.createdAt), ctx),
            },
          ],
        },
        {
          title: t(ctx, 'admin_broadcast_delivery_stats_section'),
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
    }),
    keyboard
  );
}

async function promptBroadcastCancel(ctx: MenuContext, jobId: string): Promise<void> {
  if (!ctx.services) return;
  const job = await ctx.services.broadcastService.getJob(jobId);
  if (!job || (job.status !== 'queued' && job.status !== 'running')) {
    await renderBroadcastStatus(ctx, jobId, {
      tone: 'warning',
      text: t(ctx, 'admin_broadcast_cancel_unavailable'),
    });
    return;
  }

  const text = buildAdminScreen({
    emoji: '⏹',
    title: t(ctx, 'admin_broadcast_cancel_confirm_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_messaging'),
      t(ctx, 'admin_broadcast_cancel_confirm_title')
    ),
    primary: {
      label: t(ctx, 'admin_broadcast_audience_label'),
      value: t(ctx, `admin_broadcast_audience_${job.audience}`),
      inline: true,
    },
    footer: `⚠️ ${t(ctx, 'admin_broadcast_cancel_confirm_body')}`,
  });

  await renderBroadcastScreen(
    ctx,
    text,
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: callbackData('adm', 'msg', 'cok', job.id),
      cancelCallback: callbackData('adm', 'msg', 'st', job.id),
      confirmLabel: t(ctx, 'admin_broadcast_cancel_confirm_button'),
    })
  );
}

export function registerAdminBroadcastRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);

  // Unified `adm:msg:*` routes
  registerAdminRoute(/^adm:msg:jobs:(\d+)$/u, async (ctx, match, notice) => {
    await renderBroadcastJobsList(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(
    new RegExp(`^adm:msg:st:${UUID_CAPTURE}$`, 'u'),
    async (ctx, match, notice) => {
      await renderBroadcastStatus(ctx, match![1]!, notice);
    }
  );

  registerAdminRoute(new RegExp(`^adm:msg:cn:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    await promptBroadcastCancel(ctx, match![1]!);
  });

  registerAdminRoute(new RegExp(`^adm:msg:cok:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    if (!ctx.services || !ctx.from) return;
    const jobId = match![1]!;
    const requested = await ctx.services.broadcastService.requestCancel(jobId, ctx.from.id);
    await renderBroadcastStatus(ctx, jobId, {
      tone: requested ? 'success' : 'warning',
      text: t(
        ctx,
        requested ? 'admin_broadcast_cancel_requested' : 'admin_broadcast_cancel_unavailable'
      ),
    });
  });

  registerAdminRoute('adm:msg:bcast', async (ctx) => {
    await ctx.conversation.enter('adminBroadcastConversation');
  });

  registerAdminRoute('adm:msg:dm', async (ctx) => {
    await ctx.conversation.enter('adminDirectMessageConversation');
  });

  // Backward-compatible legacy callbacks
  adminCallback(new RegExp(`^admin:broadcast:status:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderBroadcastStatus(ctx, ctx.match[1]!);
  });

  adminCallback(new RegExp(`^admin:broadcast:cancel:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptBroadcastCancel(ctx, ctx.match[1]!);
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
