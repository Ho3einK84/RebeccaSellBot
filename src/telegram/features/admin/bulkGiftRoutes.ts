import { InlineKeyboard } from 'grammy';
import {
  BULK_GIFT_TARGET_STATUSES,
  MAX_BULK_GIFT_DAYS,
  MAX_BULK_GIFT_GB,
  MAX_BULK_GIFT_MESSAGE_LENGTH,
  parseBulkGiftStatusesJson,
  type BulkGiftTargetStatus,
} from '../../../domain/services/BulkGiftService.js';
import { callbackData } from '../../callbackData.js';
import {
  localizedDateTime,
  localizedNumber,
  normalizeInputDigits,
  resolveContextLocale,
  t,
} from '../../locale.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import type { MenuContext, SessionData } from '../../types.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  renderSleekProgressBar,
  type AdminScreenNotice,
  type StatusType,
} from '../../ui.js';
import { registerAdminInputHandler, startAdminInput } from '../../admin/adminInput.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';

const UUID_CAPTURE = '([0-9a-fA-F-]{36})';
const JOBS_PAGE_SIZE = 5;

type BulkGiftDraft = NonNullable<SessionData['bulkGiftDraft']>;

function ensureGiftDraft(ctx: MenuContext): BulkGiftDraft {
  if (!ctx.session.bulkGiftDraft) {
    ctx.session.bulkGiftDraft = {
      giftGb: 0,
      giftDays: 0,
      statuses: ['active'],
      panelId: null,
      serviceId: null,
      notifyMessage: null,
    };
  }
  return ctx.session.bulkGiftDraft;
}

function giftStatusBadgeType(status: string): StatusType {
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

function formatGiftRewardSummary(ctx: MenuContext, giftGb: number, giftDays: number): string {
  const parts: string[] = [];
  if (giftGb > 0) parts.push(`+${localizedNumber(giftGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`);
  if (giftDays > 0) parts.push(`+${localizedNumber(giftDays, ctx)} ${t(ctx, 'days_unit')}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function formatTargetStatuses(ctx: MenuContext, statuses: readonly BulkGiftTargetStatus[]): string {
  return statuses
    .map((s) =>
      s === 'active'
        ? t(ctx, 'admin_gift_status_filter_active')
        : s === 'on_hold'
          ? t(ctx, 'admin_gift_status_filter_on_hold')
          : t(ctx, 'admin_gift_status_filter_limited')
    )
    .join('، ');
}

function formatPanelFilterLabel(
  ctx: MenuContext,
  panelId: string | null,
  serviceId: number | null
): string {
  if (!panelId) return t(ctx, 'admin_gift_filter_all_panels');
  const panel = ctx.services?.panelRegistry?.getPanel?.(panelId);
  const panelName = panel?.name ?? panelId;
  if (serviceId === null) return escapeTelegramMarkdown(panelName);
  const svc = panel?.services?.find((s) => s.serviceId === serviceId);
  const svcLabel = svc ? `${svc.name} (#${serviceId})` : `#${serviceId}`;
  return `${escapeTelegramMarkdown(panelName)} · ${escapeTelegramMarkdown(svcLabel)}`;
}

export async function renderBulkGiftHubScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const recent = await ctx.services.bulkGiftService
    ?.listRecentJobs(1, 3)
    .catch(() => ({ items: [], total: 0, page: 1, totalPages: 1, activeCount: 0 }));
  const activeCount = recent?.activeCount ?? 0;
  const totalJobs = recent?.total ?? 0;

  const text = buildAdminScreen({
    emoji: '🎁',
    title: t(ctx, 'admin_gift_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_messaging'),
      t(ctx, 'admin_gift_title')
    ),
    subtitle: t(ctx, 'admin_gift_subtitle'),
    notice,
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_gift_active_jobs_label'),
            value:
              activeCount > 0
                ? buildStatusBadge(ctx, 'pending', localizedNumber(activeCount, ctx))
                : localizedNumber(0, ctx),
          },
          {
            label: t(ctx, 'admin_gift_total_jobs_label'),
            value: localizedNumber(totalJobs, ctx),
          },
        ],
      },
    ],
  });

  const jobsBtnLabel =
    activeCount > 0
      ? `${t(ctx, 'admin_gift_jobs_button')} (${localizedNumber(activeCount, ctx)})`
      : t(ctx, 'admin_gift_jobs_button');

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_gift_new_button'), 'adm:gift:new')
    .row()
    .text(jobsBtnLabel, 'adm:gift:jobs:1')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:msg',
    backLabel: t(ctx, 'admin_msg_back_hub'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderBulkGiftBuilderScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.bulkGiftService) return;
  markAdminContext(ctx);
  const draft = ensureGiftDraft(ctx);

  const preview = await ctx.services.bulkGiftService
    .previewTargets({
      targetStatuses: draft.statuses,
      panelId: draft.panelId,
      serviceId: draft.serviceId,
    })
    .catch(() => ({ configCount: 0, userCount: 0 }));

  const text = buildAdminScreen({
    emoji: '🎁',
    title: t(ctx, 'admin_gift_builder_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_nav_messaging'),
      t(ctx, 'admin_gift_title'),
      t(ctx, 'admin_gift_builder_title')
    ),
    notice,
    primary: {
      emoji: '🎯',
      label: t(ctx, 'admin_gift_preview_label'),
      value: t(ctx, 'admin_gift_preview_value', {
        configs: localizedNumber(preview.configCount, ctx),
        users: localizedNumber(preview.userCount, ctx),
      }),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_gift_reward_label'),
            value: formatGiftRewardSummary(ctx, draft.giftGb, draft.giftDays),
          },
          {
            label: t(ctx, 'admin_gift_statuses_label'),
            value: formatTargetStatuses(ctx, draft.statuses),
          },
          {
            label: t(ctx, 'admin_gift_panel_filter_label'),
            value: formatPanelFilterLabel(ctx, draft.panelId, draft.serviceId),
          },
          {
            label: t(ctx, 'admin_gift_notify_label'),
            value: draft.notifyMessage
              ? escapeTelegramMarkdown(
                  draft.notifyMessage.length > 80
                    ? `${draft.notifyMessage.slice(0, 80)}…`
                    : draft.notifyMessage
                )
              : t(ctx, 'admin_gift_notify_none'),
          },
        ],
      },
    ],
    footer: t(ctx, 'admin_gift_builder_hint'),
  });

  const hasStatus = (s: BulkGiftTargetStatus) => draft.statuses.includes(s);
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_gift_set_gb_button'), 'adm:gift:ed:gb')
    .text(t(ctx, 'admin_gift_set_days_button'), 'adm:gift:ed:days')
    .row()
    .text(
      `${hasStatus('active') ? '✅ ' : '⬜ '}${t(ctx, 'admin_gift_status_filter_active')}`,
      'adm:gift:stgl:active'
    )
    .text(
      `${hasStatus('on_hold') ? '✅ ' : '⬜ '}${t(ctx, 'admin_gift_status_filter_on_hold')}`,
      'adm:gift:stgl:on_hold'
    )
    .text(
      `${hasStatus('limited') ? '✅ ' : '⬜ '}${t(ctx, 'admin_gift_status_filter_limited')}`,
      'adm:gift:stgl:limited'
    )
    .row()
    .text(t(ctx, 'admin_gift_filter_button'), 'adm:gift:flt')
    .text(t(ctx, 'admin_gift_notify_button'), 'adm:gift:ed:msg')
    .row()
    .text(t(ctx, 'admin_gift_review_button'), 'adm:gift:confirm')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:msg:gift',
    backLabel: t(ctx, 'admin_gift_back_hub'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderBulkGiftJobsList(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.bulkGiftService) return;
  markAdminContext(ctx);
  const result = await ctx.services.bulkGiftService.listRecentJobs(requestedPage, JOBS_PAGE_SIZE);
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_nav_messaging'),
    t(ctx, 'admin_gift_jobs_title')
  );

  if (result.items.length === 0) {
    const kb = new InlineKeyboard().text(t(ctx, 'admin_gift_new_button'), 'adm:gift:new').row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:msg:gift',
      backLabel: t(ctx, 'admin_gift_back_hub'),
      showHome: true,
    });
    await renderScreen(
      ctx,
      buildAdminEmptyState('🎁', t(ctx, 'admin_gift_jobs_title'), t(ctx, 'admin_gift_jobs_empty'), {
        breadcrumb,
        notice,
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const job of result.items) {
    const processed = job.appliedCount + job.failedCount + job.skippedCount;
    const statusIcon =
      job.status === 'completed'
        ? '🟢'
        : job.status === 'running' || job.status === 'queued'
          ? '⏳'
          : job.status === 'cancel_requested'
            ? '⚠️'
            : '⚪️';
    const label = `${statusIcon} ${formatGiftRewardSummary(ctx, job.giftGb, job.giftDays)} · ${localizedNumber(processed, ctx)}/${localizedNumber(job.totalCount, ctx)}`;
    kb.text(label.slice(0, 60), callbackData('adm', 'gift', 'st', job.id)).row();
  }

  appendAdminPagination(kb, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:gift:jobs:${p}`,
  });

  kb.text(t(ctx, 'admin_gift_new_button'), 'adm:gift:new').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:msg:gift',
    backLabel: t(ctx, 'admin_gift_back_hub'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '📋',
    title: t(ctx, 'admin_gift_jobs_title'),
    breadcrumb,
    notice,
    primary: {
      label: t(ctx, 'admin_gift_active_jobs_label'),
      value: localizedNumber(result.activeCount, ctx),
      inline: true,
    },
    sections: result.items.map((job) => {
      const processed = job.appliedCount + job.failedCount + job.skippedCount;
      return {
        title: `${buildStatusBadge(ctx, giftStatusBadgeType(job.status), t(ctx, `admin_broadcast_status_${job.status}`))} · ${localizedDateTime(new Date(job.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'admin_gift_reward_label'),
            value: formatGiftRewardSummary(ctx, job.giftGb, job.giftDays),
          },
          {
            label: t(ctx, 'admin_broadcast_processed_label'),
            value: `${localizedNumber(processed, ctx)} / ${localizedNumber(job.totalCount, ctx)}`,
          },
        ],
      };
    }),
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderBulkGiftJobStatus(
  ctx: MenuContext,
  jobId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.bulkGiftService) return;
  markAdminContext(ctx);
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_nav_messaging'),
    t(ctx, 'admin_gift_title'),
    t(ctx, 'admin_gift_status_title')
  );

  const job = await ctx.services.bulkGiftService.getJob(jobId);
  if (!job) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:gift:jobs:1',
      backLabel: t(ctx, 'admin_gift_jobs_button'),
      showHome: true,
    });
    await renderScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_gift_status_title'),
        t(ctx, 'admin_gift_job_missing'),
        {
          breadcrumb,
        }
      ),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return;
  }

  const processed = job.appliedCount + job.failedCount + job.skippedCount;
  const remaining = Math.max(0, job.totalCount - processed);
  const locale = resolveContextLocale(ctx);
  const progressBar =
    job.totalCount > 0
      ? renderSleekProgressBar(processed, job.totalCount, { barLength: 8, locale })
      : `${'⬜️'.repeat(8)} · ${locale === 'fa' ? '۰٪' : '0%'}`;
  const isActive = job.status === 'queued' || job.status === 'running';
  const isTerminal = job.status === 'completed' || job.status === 'cancelled';

  const kb = new InlineKeyboard();
  if (!isTerminal) {
    kb.text(t(ctx, 'admin_broadcast_refresh_button'), callbackData('adm', 'gift', 'st', job.id));
    if (isActive) {
      kb.text(t(ctx, 'admin_gift_cancel_button'), callbackData('adm', 'gift', 'cn', job.id));
    }
    kb.row();
  }
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:gift:jobs:1',
    backLabel: t(ctx, 'admin_gift_jobs_button'),
    showHome: true,
  });

  const statuses = parseBulkGiftStatusesJson(job.targetStatuses);

  const text = buildAdminScreen({
    emoji: '🎁',
    title: t(ctx, 'admin_gift_status_title'),
    breadcrumb,
    notice,
    primary: {
      label: t(ctx, 'admin_gift_status_label'),
      value: buildStatusBadge(
        ctx,
        giftStatusBadgeType(job.status),
        t(ctx, `admin_broadcast_status_${job.status}`)
      ),
      inline: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_broadcast_details_section'),
        fields: [
          {
            label: t(ctx, 'admin_gift_reward_label'),
            value: formatGiftRewardSummary(ctx, job.giftGb, job.giftDays),
          },
          {
            label: t(ctx, 'admin_gift_statuses_label'),
            value: formatTargetStatuses(ctx, statuses),
          },
          {
            label: t(ctx, 'admin_gift_panel_filter_label'),
            value: formatPanelFilterLabel(ctx, job.panelId, job.serviceId),
          },
          {
            label: t(ctx, 'admin_broadcast_created_label'),
            value: localizedDateTime(new Date(job.createdAt), ctx),
          },
        ],
      },
      {
        title: t(ctx, 'admin_gift_progress_section'),
        fields: [
          { label: t(ctx, 'admin_broadcast_progress_label'), value: progressBar },
          {
            label: t(ctx, 'admin_broadcast_processed_label'),
            value: `${localizedNumber(processed, ctx)} / ${localizedNumber(job.totalCount, ctx)}`,
          },
          {
            label: t(ctx, 'admin_gift_applied_label'),
            value: `${localizedNumber(job.appliedCount, ctx)} 🟢`,
          },
          {
            label: t(ctx, 'admin_gift_skipped_label'),
            value: `${localizedNumber(job.skippedCount, ctx)} ⏭️`,
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
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export function registerAdminBulkGiftRoutes(): void {
  registerAdminRoute('adm:msg:gift', async (ctx, _match, notice) => {
    await renderBulkGiftHubScreen(ctx, notice);
  });

  registerAdminRoute('adm:gift:new', async (ctx, _match, notice) => {
    await renderBulkGiftBuilderScreen(ctx, notice);
  });

  registerAdminRoute(/^adm:gift:stgl:(active|on_hold|limited)$/u, async (ctx, match) => {
    const status = match![1] as BulkGiftTargetStatus;
    const draft = ensureGiftDraft(ctx);
    if (draft.statuses.includes(status)) {
      if (draft.statuses.length <= 1) {
        await renderBulkGiftBuilderScreen(ctx, {
          tone: 'warning',
          text: t(ctx, 'admin_gift_status_min_one'),
        });
        return;
      }
      draft.statuses = draft.statuses.filter((s) => s !== status);
    } else {
      draft.statuses = BULK_GIFT_TARGET_STATUSES.filter(
        (s) => s === status || draft.statuses.includes(s)
      );
    }
    await renderBulkGiftBuilderScreen(ctx);
  });

  registerAdminRoute('adm:gift:ed:gb', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'gift:draft:gb',
      returnRoute: 'adm:gift:new',
      promptText: buildAdminPromptScreen({
        emoji: '📦',
        title: t(ctx, 'admin_gift_set_gb_button'),
        body: t(ctx, 'admin_gift_prompt_gb', { max: localizedNumber(MAX_BULK_GIFT_GB, ctx) }),
      }),
    });
  });

  registerAdminInputHandler('gift:draft:gb', async (ctx, rawText) => {
    const normalized = normalizeInputDigits(rawText).trim();
    if (!/^\d+$/u.test(normalized)) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '📦',
          title: t(ctx, 'admin_gift_set_gb_button'),
          body: t(ctx, 'admin_gift_prompt_gb', { max: localizedNumber(MAX_BULK_GIFT_GB, ctx) }),
          error: t(ctx, 'admin_gift_invalid_number'),
        }),
      };
    }
    const gb = Number(normalized);
    if (!Number.isSafeInteger(gb) || gb < 0 || gb > MAX_BULK_GIFT_GB) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '📦',
          title: t(ctx, 'admin_gift_set_gb_button'),
          body: t(ctx, 'admin_gift_prompt_gb', { max: localizedNumber(MAX_BULK_GIFT_GB, ctx) }),
          error: t(ctx, 'admin_gift_invalid_number'),
        }),
      };
    }
    ensureGiftDraft(ctx).giftGb = gb;
    return { status: 'done', redirectRoute: 'adm:gift:new' };
  });

  registerAdminRoute('adm:gift:ed:days', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'gift:draft:days',
      returnRoute: 'adm:gift:new',
      promptText: buildAdminPromptScreen({
        emoji: '⏳',
        title: t(ctx, 'admin_gift_set_days_button'),
        body: t(ctx, 'admin_gift_prompt_days', { max: localizedNumber(MAX_BULK_GIFT_DAYS, ctx) }),
      }),
    });
  });

  registerAdminInputHandler('gift:draft:days', async (ctx, rawText) => {
    const normalized = normalizeInputDigits(rawText).trim();
    if (!/^\d+$/u.test(normalized)) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⏳',
          title: t(ctx, 'admin_gift_set_days_button'),
          body: t(ctx, 'admin_gift_prompt_days', { max: localizedNumber(MAX_BULK_GIFT_DAYS, ctx) }),
          error: t(ctx, 'admin_gift_invalid_number'),
        }),
      };
    }
    const days = Number(normalized);
    if (!Number.isSafeInteger(days) || days < 0 || days > MAX_BULK_GIFT_DAYS) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⏳',
          title: t(ctx, 'admin_gift_set_days_button'),
          body: t(ctx, 'admin_gift_prompt_days', { max: localizedNumber(MAX_BULK_GIFT_DAYS, ctx) }),
          error: t(ctx, 'admin_gift_invalid_number'),
        }),
      };
    }
    ensureGiftDraft(ctx).giftDays = days;
    return { status: 'done', redirectRoute: 'adm:gift:new' };
  });

  registerAdminRoute('adm:gift:ed:msg', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'gift:draft:msg',
      returnRoute: 'adm:gift:new',
      promptText: buildAdminPromptScreen({
        emoji: '💬',
        title: t(ctx, 'admin_gift_notify_button'),
        body: t(ctx, 'admin_gift_prompt_message'),
      }),
    });
  });

  registerAdminInputHandler('gift:draft:msg', async (ctx, rawText) => {
    const trimmed = rawText.trim();
    if (trimmed === '-') {
      ensureGiftDraft(ctx).notifyMessage = null;
      return { status: 'done', redirectRoute: 'adm:gift:new' };
    }
    if ([...trimmed].length > MAX_BULK_GIFT_MESSAGE_LENGTH) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '💬',
          title: t(ctx, 'admin_gift_notify_button'),
          body: t(ctx, 'admin_gift_prompt_message'),
          error: t(ctx, 'admin_direct_too_long'),
        }),
      };
    }
    ensureGiftDraft(ctx).notifyMessage = trimmed || null;
    return { status: 'done', redirectRoute: 'adm:gift:new' };
  });

  registerAdminRoute('adm:gift:flt', async (ctx) => {
    const draft = ensureGiftDraft(ctx);
    const panels = ctx.services?.panelRegistry?.listPanels?.() ?? [];
    const kb = new InlineKeyboard()
      .text(
        `${draft.panelId === null ? '✅ ' : ''}${t(ctx, 'admin_gift_filter_all_panels')}`,
        'adm:gift:fp:all'
      )
      .row();
    for (const panel of panels) {
      kb.text(
        `${draft.panelId === panel.id ? '✅ ' : ''}🖥️ ${panel.name}`.slice(0, 60),
        callbackData('adm', 'gift', 'fp', panel.id)
      ).row();
    }
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:gift:new',
      backLabel: t(ctx, 'menu_back'),
      showHome: true,
    });
    const text = buildAdminScreen({
      emoji: '🖥️',
      title: t(ctx, 'admin_gift_filter_title'),
      subtitle: t(ctx, 'admin_gift_filter_subtitle'),
    });
    await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  });

  registerAdminRoute(/^adm:gift:fp:(.+)$/u, async (ctx, match) => {
    const chosen = match![1]!;
    const draft = ensureGiftDraft(ctx);
    if (chosen === 'all') {
      draft.panelId = null;
      draft.serviceId = null;
      await renderBulkGiftBuilderScreen(ctx);
      return;
    }
    const panel = ctx.services?.panelRegistry?.getPanel?.(chosen);
    if (!panel) {
      await renderBulkGiftBuilderScreen(ctx);
      return;
    }
    draft.panelId = panel.id;
    draft.serviceId = null;

    if (!panel.services || panel.services.length === 0) {
      await renderBulkGiftBuilderScreen(ctx);
      return;
    }

    const kb = new InlineKeyboard()
      .text(`✅ ${t(ctx, 'admin_gift_filter_all_services')}`, 'adm:gift:fs:all')
      .row();
    for (const svc of panel.services) {
      kb.text(
        `📦 ${svc.name} (#${svc.serviceId})`.slice(0, 60),
        callbackData('adm', 'gift', 'fs', svc.serviceId)
      ).row();
    }
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:gift:new',
      backLabel: t(ctx, 'menu_back'),
      showHome: true,
    });

    const text = buildAdminScreen({
      emoji: '📦',
      title: escapeTelegramMarkdown(panel.name),
      subtitle: t(ctx, 'admin_gift_filter_service_subtitle'),
    });
    await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  });

  registerAdminRoute(/^adm:gift:fs:(all|\d+)$/u, async (ctx, match) => {
    const val = match![1]!;
    const draft = ensureGiftDraft(ctx);
    draft.serviceId = val === 'all' ? null : Number(val);
    await renderBulkGiftBuilderScreen(ctx);
  });

  registerAdminRoute('adm:gift:confirm', async (ctx) => {
    if (!ctx.services?.bulkGiftService) return;
    const draft = ensureGiftDraft(ctx);
    if (draft.giftGb <= 0 && draft.giftDays <= 0) {
      await renderBulkGiftBuilderScreen(ctx, {
        tone: 'error',
        text: t(ctx, 'admin_gift_amount_required'),
      });
      return;
    }

    const preview = await ctx.services.bulkGiftService.previewTargets({
      targetStatuses: draft.statuses,
      panelId: draft.panelId,
      serviceId: draft.serviceId,
    });

    if (preview.configCount === 0) {
      await renderBulkGiftBuilderScreen(ctx, {
        tone: 'warning',
        text: t(ctx, 'admin_gift_empty_audience'),
      });
      return;
    }

    const text = buildAdminScreen({
      emoji: '🚀',
      title: t(ctx, 'admin_gift_confirm_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_gift_title'), t(ctx, 'admin_gift_confirm_title')),
      primary: {
        emoji: '🎯',
        label: t(ctx, 'admin_gift_preview_label'),
        value: t(ctx, 'admin_gift_preview_value', {
          configs: localizedNumber(preview.configCount, ctx),
          users: localizedNumber(preview.userCount, ctx),
        }),
        inline: true,
      },
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'admin_gift_reward_label'),
              value: formatGiftRewardSummary(ctx, draft.giftGb, draft.giftDays),
            },
            {
              label: t(ctx, 'admin_gift_statuses_label'),
              value: formatTargetStatuses(ctx, draft.statuses),
            },
            {
              label: t(ctx, 'admin_gift_panel_filter_label'),
              value: formatPanelFilterLabel(ctx, draft.panelId, draft.serviceId),
            },
          ],
        },
      ],
      footer: t(ctx, 'admin_gift_confirm_footer'),
    });

    await renderScreen(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: buildAdminConfirmKeyboard(ctx, {
        confirmCallback: 'adm:gift:run',
        cancelCallback: 'adm:gift:new',
        confirmLabel: t(ctx, 'admin_gift_launch_button'),
      }),
    });
  });

  registerAdminRoute('adm:gift:run', async (ctx) => {
    if (!ctx.services?.bulkGiftService || !ctx.from) return;
    const draft = ensureGiftDraft(ctx);
    if (draft.giftGb <= 0 && draft.giftDays <= 0) {
      await renderBulkGiftBuilderScreen(ctx, {
        tone: 'error',
        text: t(ctx, 'admin_gift_amount_required'),
      });
      return;
    }

    const job = await ctx.services.bulkGiftService.createJob({
      actorTelegramId: ctx.from.id,
      giftGb: draft.giftGb,
      giftDays: draft.giftDays,
      targetStatuses: draft.statuses,
      panelId: draft.panelId,
      serviceId: draft.serviceId,
      notifyMessage: draft.notifyMessage,
    });
    delete ctx.session.bulkGiftDraft;

    await renderBulkGiftJobStatus(ctx, job.id, {
      tone: 'success',
      text: t(ctx, 'admin_gift_queued_notice'),
    });
  });

  registerAdminRoute(/^adm:gift:jobs:(\d+)$/u, async (ctx, match, notice) => {
    await renderBulkGiftJobsList(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(
    new RegExp(`^adm:gift:st:${UUID_CAPTURE}$`, 'u'),
    async (ctx, match, notice) => {
      await renderBulkGiftJobStatus(ctx, match![1]!, notice);
    }
  );

  registerAdminRoute(new RegExp(`^adm:gift:cn:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    if (!ctx.services?.bulkGiftService) return;
    const jobId = match![1]!;
    const job = await ctx.services.bulkGiftService.getJob(jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) {
      await renderBulkGiftJobStatus(ctx, jobId, {
        tone: 'warning',
        text: t(ctx, 'admin_gift_cancel_unavailable'),
      });
      return;
    }

    const text = buildAdminScreen({
      emoji: '⏹',
      title: t(ctx, 'admin_gift_cancel_confirm_title'),
      footer: `⚠️ ${t(ctx, 'admin_gift_cancel_confirm_body')}`,
    });
    await renderScreen(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: buildAdminConfirmKeyboard(ctx, {
        confirmCallback: callbackData('adm', 'gift', 'cok', job.id),
        cancelCallback: callbackData('adm', 'gift', 'st', job.id),
        confirmLabel: t(ctx, 'admin_gift_cancel_confirm_button'),
      }),
    });
  });

  registerAdminRoute(new RegExp(`^adm:gift:cok:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    if (!ctx.services?.bulkGiftService || !ctx.from) return;
    const jobId = match![1]!;
    const requested = await ctx.services.bulkGiftService.requestCancel(jobId, ctx.from.id);
    await renderBulkGiftJobStatus(ctx, jobId, {
      tone: requested ? 'success' : 'warning',
      text: t(ctx, requested ? 'admin_gift_cancel_requested' : 'admin_gift_cancel_unavailable'),
    });
  });
}
