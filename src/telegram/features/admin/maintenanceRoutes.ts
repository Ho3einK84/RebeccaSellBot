import { InlineKeyboard, type Bot } from 'grammy';
import { LastAdminRemovalError } from '../../../domain/services/AdminService.js';
import type {
  OrphanIssueFilter,
  OrphanQueueSummary,
  RemoteOrphanSnapshot,
} from '../../../domain/services/ConfigReconciliationService.js';
import type { LocalUserProfile } from '../../../domain/services/UserService.js';
import type { ConversationContext, MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import {
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  guardAdminCallbacks,
  renderScreen,
  type ScreenField,
  type ScreenSection,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';

const ORPHAN_PAGE_SIZE = 6;
const UUID_CAPTURE = '([0-9a-fA-F-]{36})';
const BYTES_PER_GB = 1024 ** 3;

export type OrphanIssue = {
  id: string;
  panelId?: string;
  kind: 'local_missing_remote' | 'remote_unbound';
  configUsername: string;
  localOwnerTelegramId: number | null;
  status?: string;
  firstSeenAt: Date;
};

type OrphanIssuePage = {
  issues: OrphanIssue[];
  page: number;
  totalPages: number;
  total: number;
};

type EnrichedOrphanIssue = {
  issue: OrphanIssue;
  ownerProfile: LocalUserProfile | null;
  suggestedOwner: LocalUserProfile | null;
};

export interface RenderOrphanIssuesOptions {
  filter?: OrphanIssueFilter;
  search?: string;
  banner?: string;
}

/** Extract a candidate Telegram ID embedded in a config username (e.g., h_6698253699_75) or panel note. */
export function extractCandidateTelegramId(
  configUsername: string,
  note?: string | null
): number | null {
  const sources = [configUsername, note ?? ''];
  for (const source of sources) {
    if (!source) continue;
    const match = /(?:^|[^0-9])([1-9]\d{5,14})(?:[^0-9]|$)/u.exec(source);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function formatUserDisplay(profile: LocalUserProfile | null, fallbackId?: number | null): string {
  if (profile) {
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    const handle = profile.username ? `@${escapeTelegramMarkdown(profile.username)}` : '';
    const nameAndHandle = [
      fullName ? escapeTelegramMarkdown(fullName) : '',
      handle ? (fullName ? `(${handle})` : handle) : '',
    ]
      .filter(Boolean)
      .join(' ');
    return nameAndHandle
      ? `${nameAndHandle} · \`${profile.telegramId}\``
      : `\`${profile.telegramId}\``;
  }
  if (fallbackId !== null && fallbackId !== undefined) {
    return `\`${fallbackId}\``;
  }
  return '—';
}

function formatUserShortBadge(
  profile: LocalUserProfile | null,
  fallbackId?: number | null
): string {
  if (profile?.firstName?.trim()) {
    return profile.firstName.trim().slice(0, 14);
  }
  if (profile?.username?.trim()) {
    return `@${profile.username.trim().slice(0, 13)}`;
  }
  if (fallbackId) {
    return String(fallbackId);
  }
  return '';
}

export function resolveOrphanAssignErrorKey(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'ORPHAN_TARGET_BANNED':
      return 'admin_orphan_assign_target_banned';
    case 'ORPHAN_REMOTE_DELETED':
      return 'admin_orphan_assign_remote_deleted';
    case 'ORPHAN_ALREADY_BOUND':
      return 'admin_orphan_assign_already_bound';
    default:
      return 'admin_orphan_assign_failed';
  }
}

export async function renderAdminRegistry(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const admins = await ctx.services.adminService.listAdmins();
  const adminProfiles = await Promise.all(
    admins.map(async (admin) => ({
      admin,
      profile: await ctx.services?.userService.findProfile(String(admin.telegramId)),
    }))
  );

  const keyboard = new InlineKeyboard();
  for (const { admin, profile } of adminProfiles) {
    const isCurrentAdmin = admin.telegramId === ctx.from?.id;
    const namePart = profile?.username
      ? `@${profile.username}`
      : profile?.firstName
        ? `${profile.firstName} (${admin.telegramId})`
        : String(admin.telegramId);

    const buttonLabel = `${isCurrentAdmin ? '⭐' : '🛡️'} ${namePart}${isCurrentAdmin ? ` · ${t(ctx, 'admin_admin_you')}` : ''}`;
    keyboard.text(buttonLabel, callbackData('admin', 'admins', 'view', admin.telegramId));
    if (!isCurrentAdmin) {
      keyboard.text(
        t(ctx, 'admin_remove_admin_button'),
        callbackData('admin', 'admins', 'remove', admin.telegramId)
      );
    }
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_add_admin_button'), 'admin:admins:add')
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  const text = admins.length
    ? buildScreen({
        emoji: '🛡️',
        title: t(ctx, 'admin_registry_title'),
        subtitle: t(ctx, 'admin_registry_subtitle'),
        primary: {
          emoji: '👥',
          label: t(ctx, 'admin_registry_count_label'),
          value: localizedNumber(admins.length, ctx),
        },
        sections: [
          {
            emoji: '👤',
            title: t(ctx, 'admin_registry_section'),
            fields: adminProfiles.map(({ admin, profile }) => {
              const isCurrentAdmin = admin.telegramId === ctx.from?.id;
              let label = String(admin.telegramId);
              if (profile?.username) {
                label = `@${escapeTelegramMarkdown(profile.username)} (${admin.telegramId})`;
              } else if (profile?.firstName) {
                label = `${escapeTelegramMarkdown(profile.firstName)} (${admin.telegramId})`;
              }
              return {
                emoji: isCurrentAdmin ? '⭐' : '🛡️',
                label,
                value: isCurrentAdmin
                  ? buildStatusBadge(ctx, 'active', t(ctx, 'admin_admin_you'))
                  : buildStatusBadge(ctx, 'active'),
              };
            }),
          },
        ],
      })
    : buildEmptyState(
        '🛡️',
        t(ctx, 'admin_registry_empty_title'),
        t(ctx, 'admin_registry_empty_body')
      );
  await renderMaintenanceScreen(ctx, text, keyboard);
}

export async function renderOrphanIssues(
  ctx: MenuContext,
  requestedPage?: number,
  options?: RenderOrphanIssuesOptions
): Promise<void> {
  if (!ctx.services) return;
  const savedView = ctx.session?.adminOrphanView;
  const filter: OrphanIssueFilter = options?.filter ?? savedView?.filter ?? 'all';
  const search =
    options && 'search' in options
      ? options.search?.trim() || undefined
      : savedView?.search?.trim() || undefined;
  const targetPage = requestedPage ?? savedView?.page ?? 1;

  const result = (await ctx.services.configReconciliationService.listIssues(
    targetPage,
    ORPHAN_PAGE_SIZE,
    { filter, search }
  )) as OrphanIssuePage;

  const rawSummary = await ctx.services.configReconciliationService
    .getQueueSummary?.()
    .catch(() => null);
  const summary: OrphanQueueSummary = rawSummary ?? {
    openTotal: filter === 'ignored' ? 0 : result.total,
    remoteUnbound: result.issues.filter((i) => i.kind === 'remote_unbound').length,
    localMissingRemote: result.issues.filter((i) => i.kind === 'local_missing_remote').length,
    ignored: filter === 'ignored' ? result.total : 0,
  };

  if (ctx.session) {
    ctx.session.adminOrphanView = {
      filter,
      page: result.page,
      ...(search ? { search } : {}),
    };
  }

  const enrichedIssues = await enrichOrphanIssuesPage(ctx, result.issues);

  await renderMaintenanceScreen(
    ctx,
    buildOrphanQueueScreen(ctx, result, enrichedIssues, summary, {
      filter,
      search,
      banner: options?.banner,
    }),
    buildOrphanQueueKeyboard(ctx, result, enrichedIssues, summary, { filter, search })
  );
}

async function enrichOrphanIssuesPage(
  ctx: MenuContext,
  issues: OrphanIssue[]
): Promise<EnrichedOrphanIssue[]> {
  return Promise.all(
    issues.map(async (issue) => {
      if (issue.kind === 'local_missing_remote' && issue.localOwnerTelegramId) {
        const ownerProfile =
          (await ctx.services?.userService
            ?.findProfile?.(String(issue.localOwnerTelegramId))
            .catch(() => null)) ?? null;
        return { issue, ownerProfile, suggestedOwner: null };
      }
      const candidateId = extractCandidateTelegramId(issue.configUsername);
      const suggestedOwner = candidateId
        ? ((await ctx.services?.userService
            ?.findProfile?.(String(candidateId))
            .catch(() => null)) ?? null)
        : null;
      return {
        issue,
        ownerProfile: null,
        suggestedOwner: suggestedOwner && !suggestedOwner.isBanned ? suggestedOwner : null,
      };
    })
  );
}

export function registerAdminMaintenanceRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);

  adminCallback('admin:admins:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderAdminRegistry(ctx);
  });
  adminCallback(/^admin:admins:noop:\d+$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
  });
  adminCallback(/^admin:admins:view:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const target = Number(ctx.match[1]);
    const admins = await ctx.services.adminService.listAdmins();
    const adminRecord = admins.find((a) => a.telegramId === target);
    if (!adminRecord) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_admin_not_found', { telegram_id: target }),
        show_alert: true,
      });
      await renderAdminRegistry(ctx);
      return;
    }
    await ctx.answerCallbackQuery();
    const profile = await ctx.services.userService.findProfile(String(target));
    const isCurrentAdmin = target === ctx.from?.id;

    const profileFields = [];
    if (profile?.username) {
      profileFields.push({
        emoji: '👤',
        label: t(ctx, 'admin_detail_username_label'),
        value: `@${escapeTelegramMarkdown(profile.username)}`,
      });
    }
    if (profile?.firstName) {
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      profileFields.push({
        emoji: '📝',
        label: t(ctx, 'admin_detail_name_label'),
        value: escapeTelegramMarkdown(fullName),
      });
    }
    profileFields.push({
      emoji: '📅',
      label: t(ctx, 'admin_detail_created_at_label'),
      value: localizedDate(adminRecord.createdAt, ctx),
    });
    if (adminRecord.addedBy) {
      profileFields.push({
        emoji: '🛡️',
        label: t(ctx, 'admin_detail_added_by_label'),
        value: `\`${adminRecord.addedBy}\``,
      });
    } else {
      profileFields.push({
        emoji: '⚙️',
        label: t(ctx, 'admin_detail_added_by_label'),
        value: t(ctx, 'admin_detail_added_by_system'),
      });
    }

    const keyboard = new InlineKeyboard();
    if (!isCurrentAdmin) {
      keyboard
        .text(
          t(ctx, 'admin_remove_admin_button'),
          callbackData('admin', 'admins', 'remove', target)
        )
        .row();
    }
    keyboard.text(t(ctx, 'admin_menu_back_to_admins'), 'admin:admins:open');

    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '🛡️',
        title: t(ctx, 'admin_detail_title'),
        subtitle: t(ctx, 'admin_detail_subtitle'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_registry_id_label'),
          value: `\`${target}\``,
        },
        sections: [
          {
            emoji: '📋',
            title: t(ctx, 'admin_detail_section_info'),
            fields: profileFields,
          },
        ],
      }),
      keyboard
    );
  });
  adminCallback('admin:admins:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAddAdminConversation');
  });
  adminCallback(/^admin:admins:remove:(\d+)$/u, async (ctx) => {
    const target = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    const profile = await ctx.services?.userService.findProfile(String(target));
    const targetDisplay = profile?.username
      ? `@${escapeTelegramMarkdown(profile.username)} (\`${target}\`)`
      : `\`${target}\``;

    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_remove_admin_title'),
        subtitle: t(ctx, 'admin_remove_admin_subtitle'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_registry_id_label'),
          value: targetDisplay,
        },
        footer: t(ctx, 'admin_remove_admin_consequence'),
      }),
      new InlineKeyboard()
        .text(
          t(ctx, 'admin_confirm_button'),
          callbackData('admin', 'admins', 'remove_confirm', target)
        )
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:admins:open')
    );
  });
  adminCallback(/^admin:admins:remove_confirm:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const target = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      const removed = await ctx.services.adminService.removeAdmin(target, ctx.from.id);
      await renderMaintenanceScreen(
        ctx,
        removed
          ? buildScreen({
              emoji: '✅',
              title: t(ctx, 'admin_admin_removed_title'),
              subtitle: t(ctx, 'admin_admin_removed_subtitle'),
              primary: {
                emoji: '👤',
                label: t(ctx, 'admin_registry_id_label'),
                value: `\`${target}\``,
              },
            })
          : buildEmptyState(
              '⚠️',
              t(ctx, 'admin_registry_title'),
              t(ctx, 'admin_admin_not_found', { telegram_id: target })
            ),
        new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admins'), 'admin:admins:open')
      );
    } catch (err) {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_registry_title'),
          t(
            ctx,
            err instanceof LastAdminRemovalError
              ? 'admin_last_admin_cannot_remove'
              : 'operation_failed'
          )
        ),
        new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admins'), 'admin:admins:open')
      );
    }
  });

  adminCallback(/^admin:orphans:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, Number(ctx.match[1]) || 1);
  });
  adminCallback('admin:orphans:open', async (ctx) => {
    delete ctx.session.adminOrphanView;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, 1, { filter: 'all', search: undefined });
  });
  adminCallback('admin:orphans:back', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx);
  });
  adminCallback(/^admin:orphans:tab:(all|remote|local|ignored)$/u, async (ctx) => {
    const filter = ctx.match[1] as OrphanIssueFilter;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, 1, { filter });
  });
  adminCallback('admin:orphans:search', async (ctx) => {
    ctx.session.orphanAssignIssueId = '__search__';
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAssignOrphanConversation');
  });
  adminCallback('admin:orphans:clear_search', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, 1, { search: undefined });
  });
  adminCallback(new RegExp(`^admin:orphan:view:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issue = (await ctx.services.configReconciliationService.getIssue(ctx.match[1]!)) as
      OrphanIssue | undefined;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    if (!issue || issue.status === 'resolved') {
      await renderOrphanIssues(ctx, undefined, {
        banner: t(ctx, 'admin_orphan_issue_missing'),
      });
      return;
    }
    await renderOrphanIssueDetail(ctx, issue);
  });
  adminCallback('admin:orphans:scan', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_scanning') });
    try {
      const result = await ctx.services.configReconciliationService.scan();
      const healthy = result.failedPanels.length === 0;
      const banner = t(ctx, healthy ? 'admin_orphan_scan_done' : 'admin_orphan_scan_partial', {
        local: localizedNumber(result.localMissingRemote, ctx),
        remote: localizedNumber(result.remoteUnbound, ctx),
        ignored: localizedNumber(result.remoteIgnored, ctx),
        failed: localizedNumber(result.failedPanels.length, ctx),
      });
      await renderOrphanIssues(ctx, 1, {
        filter:
          result.remoteUnbound > 0 && result.localMissingRemote === 0
            ? 'remote'
            : result.localMissingRemote > 0 && result.remoteUnbound === 0
              ? 'local'
              : 'all',
        banner,
      });
    } catch {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_scan_result_title'),
          t(ctx, 'admin_orphan_scan_failed')
        ),
        new InlineKeyboard()
          .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
          .row()
          .text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back')
      );
    }
  });
  adminCallback('admin:orphans:baseline', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '🧱',
        title: t(ctx, 'admin_orphan_baseline_title'),
        subtitle: t(ctx, 'admin_orphan_baseline_subtitle'),
        footer: t(ctx, 'admin_orphan_baseline_consequence'),
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_orphan_baseline_confirm_button'), 'admin:orphans:baseline_confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:orphans:back')
    );
  });
  adminCallback('admin:orphans:baseline_confirm', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_baseline_running') });
    try {
      const result = await ctx.services.configReconciliationService.establishRemoteBaseline(
        ctx.from.id
      );
      await renderMaintenanceScreen(
        ctx,
        buildScreen({
          emoji: '✅',
          title: t(ctx, 'admin_orphan_baseline_result_title'),
          primary: {
            emoji: '🧱',
            label: t(ctx, 'ui_status_active'),
            value: buildStatusBadge(ctx, 'healthy'),
          },
          sections: [
            {
              emoji: '🧩',
              title: t(ctx, 'admin_orphan_overview_section'),
              fields: [
                {
                  label: t(ctx, 'admin_orphan_remote_total_label'),
                  value: localizedNumber(result.remoteTotal, ctx),
                },
                {
                  label: t(ctx, 'admin_orphan_already_bound_label'),
                  value: localizedNumber(result.alreadyBound, ctx),
                },
                {
                  label: t(ctx, 'admin_orphan_manual_baseline_label'),
                  value: localizedNumber(result.ignoredUnbound, ctx),
                },
              ],
            },
          ],
        }),
        new InlineKeyboard().text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back')
      );
    } catch {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_baseline_title'),
          t(ctx, 'admin_orphan_baseline_failed')
        ),
        new InlineKeyboard().text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back')
      );
    }
  });
  adminCallback('admin:orphans:clean_local', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    const summary = await ctx.services?.configReconciliationService
      ?.getQueueSummary?.()
      .catch(() => null);
    const localCount = summary?.localMissingRemote ?? 0;
    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '🧹',
        title: t(ctx, 'admin_orphan_clean_local_title'),
        subtitle: t(ctx, 'admin_orphan_clean_local_subtitle'),
        primary: {
          emoji: '📉',
          label: t(ctx, 'admin_orphan_local_missing_label'),
          value: localizedNumber(localCount, ctx),
        },
        footer: t(ctx, 'admin_orphan_remove_consequence'),
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_orphan_clean_local_confirm_button'), 'admin:orphans:clean_local_ok')
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:orphans:back')
    );
  });
  adminCallback('admin:orphans:clean_local_ok', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const result = await ctx.services.configReconciliationService.removeAllLocalMissing(
      ctx.from.id
    );
    const banner = t(ctx, 'admin_orphan_clean_local_done', {
      count: localizedNumber(result.removed, ctx),
    });
    await renderOrphanIssues(ctx, 1, { filter: 'all', banner });
  });
  adminCallback(new RegExp(`^admin:orphan:assign:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    ctx.session.orphanAssignIssueId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAssignOrphanConversation');
  });
  adminCallback(new RegExp(`^admin:orphan:qa:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issueId = ctx.match[1]!;
    const issue = (await ctx.services.configReconciliationService.getIssue(issueId)) as
      OrphanIssue | undefined;
    if (!issue) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_orphan_issue_missing'),
        show_alert: true,
      });
      await renderOrphanIssues(ctx);
      return;
    }
    const candidateId = extractCandidateTelegramId(issue.configUsername);
    const target = candidateId
      ? await ctx.services.userService.findProfile(String(candidateId))
      : null;
    if (!target) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_user_not_found'),
        show_alert: true,
      });
      await renderOrphanIssueDetail(ctx, issue);
      return;
    }
    try {
      const assigned = await ctx.services.configReconciliationService.assignRemoteUnbound(
        issueId,
        target.telegramId,
        ctx.from.id
      );
      if (!assigned) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'admin_orphan_issue_missing'),
          show_alert: true,
        });
        await renderOrphanIssues(ctx);
        return;
      }
      await ctx.answerCallbackQuery({
        text: tm(ctx, 'admin_orphan_assigned', {
          username: assigned.configUsername,
          telegram_id: target.telegramId,
        }),
      });
      await renderMaintenanceScreen(
        ctx,
        buildOrphanAssignedScreen(ctx, assigned.configUsername, target),
        buildOrphanAssignedKeyboard(ctx, target.telegramId)
      );
    } catch (err) {
      await ctx.answerCallbackQuery({
        text: t(ctx, resolveOrphanAssignErrorKey(err)),
        show_alert: true,
      });
      await renderOrphanIssueDetail(ctx, issue);
    }
  });
  adminCallback(new RegExp(`^admin:orphan:remove:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issue = (await ctx.services.configReconciliationService.getIssue(ctx.match[1]!)) as
      OrphanIssue | undefined;
    if (!issue) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_orphan_issue_missing'),
        show_alert: true,
      });
      return;
    }
    const ownerProfile = issue.localOwnerTelegramId
      ? await ctx.services.userService
          .findProfile(String(issue.localOwnerTelegramId))
          .catch(() => null)
      : null;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_orphan_remove_title'),
        subtitle: t(ctx, 'admin_orphan_remove_subtitle'),
        primary: {
          emoji: '📉',
          label: t(ctx, 'admin_orphan_service_label'),
          value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
        },
        sections: issue.localOwnerTelegramId
          ? [
              {
                emoji: '👤',
                title: t(ctx, 'admin_orphan_overview_section'),
                fields: [
                  {
                    label: t(ctx, 'admin_orphan_owner_label'),
                    value: formatUserDisplay(ownerProfile, issue.localOwnerTelegramId),
                  },
                ],
              },
            ]
          : undefined,
        footer: t(ctx, 'admin_orphan_remove_consequence'),
      }),
      new InlineKeyboard()
        .text(
          t(ctx, 'admin_confirm_button'),
          callbackData('admin', 'orphan', 'remove_confirm', issue.id)
        )
        .row()
        .text(t(ctx, 'menu_cancel'), callbackData('admin', 'orphan', 'view', issue.id))
    );
  });
  adminCallback(new RegExp(`^admin:orphan:remove_confirm:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    try {
      const removed = await ctx.services.configReconciliationService.removeLocalMissing(
        ctx.match[1]!,
        ctx.from.id
      );
      const bannerKey = removed ? 'admin_orphan_removed' : 'admin_orphan_issue_missing';
      await ctx.answerCallbackQuery({ text: t(ctx, bannerKey) });
      await renderOrphanIssues(ctx, undefined, { banner: t(ctx, bannerKey) });
    } catch (err) {
      const errKey =
        err instanceof Error && err.message === 'ORPHAN_REMOTE_REAPPEARED'
          ? 'admin_orphan_remote_reappeared'
          : 'admin_orphan_remove_failed';
      await ctx.answerCallbackQuery({ text: t(ctx, errKey), show_alert: true });
      await renderOrphanIssues(ctx, undefined, { banner: t(ctx, errKey) });
    }
  });
  adminCallback(new RegExp(`^admin:orphan:ignore:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const ignored = await ctx.services.configReconciliationService.ignoreIssue(
      ctx.match[1]!,
      ctx.from.id
    );
    const msgKey = ignored ? 'admin_orphan_ignored' : 'admin_orphan_issue_missing';
    await ctx.answerCallbackQuery({ text: t(ctx, msgKey) });
    await renderOrphanIssues(ctx, undefined, { banner: t(ctx, msgKey) });
  });
  adminCallback(new RegExp(`^admin:orphan:reopen:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const reopened = await ctx.services.configReconciliationService.unignoreIssue(
      ctx.match[1]!,
      ctx.from.id
    );
    const msgKey = reopened ? 'admin_orphan_reopened' : 'admin_orphan_issue_missing';
    await ctx.answerCallbackQuery({ text: t(ctx, msgKey) });
    await renderOrphanIssues(ctx, undefined, { banner: t(ctx, msgKey) });
  });
}

export function buildOrphanAssignedScreen(
  ctx: ConversationContext,
  configUsername: string,
  target: LocalUserProfile
): string {
  return buildScreen({
    emoji: '✅',
    title: t(ctx, 'admin_orphan_detail_title'),
    primary: {
      emoji: '🧩',
      label: t(ctx, 'admin_orphan_service_label'),
      value: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_orphan_overview_section'),
        fields: [
          {
            label: t(ctx, 'admin_orphan_owner_label'),
            value: formatUserDisplay(target, target.telegramId),
          },
        ],
      },
    ],
    footer: t(ctx, 'admin_orphan_assigned', {
      username: escapeTelegramMarkdown(configUsername),
      telegram_id: target.telegramId,
    }),
  });
}

export function buildOrphanAssignedKeyboard(
  ctx: ConversationContext,
  targetTelegramId: number
): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'admin_orphan_view_owner_button'), `admin:user:view:${targetTelegramId}`)
    .row()
    .text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back');
}

function buildOrphanQueueScreen(
  ctx: MenuContext,
  result: OrphanIssuePage,
  enrichedIssues: EnrichedOrphanIssue[],
  summary: OrphanQueueSummary,
  options: { filter: OrphanIssueFilter; search?: string; banner?: string }
): string {
  const hasOpen = summary.openTotal > 0;
  const overviewFields: ScreenField[] = [
    {
      emoji: '🔗',
      label: t(ctx, 'admin_orphan_remote_unbound_label'),
      value: localizedNumber(summary.remoteUnbound, ctx),
    },
    {
      emoji: '📉',
      label: t(ctx, 'admin_orphan_local_missing_label'),
      value: localizedNumber(summary.localMissingRemote, ctx),
    },
    {
      emoji: '🙈',
      label: t(ctx, 'admin_orphan_ignored_label'),
      value: localizedNumber(summary.ignored, ctx),
    },
  ];
  if (options.search) {
    overviewFields.push({
      emoji: '🔍',
      label: t(ctx, 'admin_orphan_search_active_label'),
      value: `\`${sanitizeTelegramInlineCode(options.search)}\` (${localizedNumber(result.total, ctx)})`,
    });
  }

  const sections: ScreenSection[] = [
    {
      emoji: '📊',
      title: t(ctx, 'admin_orphan_overview_section'),
      fields: overviewFields,
    },
  ];

  if (enrichedIssues.length > 0) {
    sections.push({
      emoji: '📋',
      title: t(ctx, 'admin_orphan_queue_section'),
      fields: enrichedIssues.map(({ issue, ownerProfile, suggestedOwner }) => {
        const isLocal = issue.kind === 'local_missing_remote';
        const isIgnored = issue.status === 'ignored';
        const emoji = isIgnored ? '🙈' : isLocal ? '📉' : '🔗';
        let detail = t(ctx, isLocal ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote');
        if (isLocal && (ownerProfile || issue.localOwnerTelegramId)) {
          const shortOwner = formatUserShortBadge(ownerProfile, issue.localOwnerTelegramId);
          if (shortOwner) detail += ` · 👤 ${escapeTelegramMarkdown(shortOwner)}`;
        } else if (!isLocal && suggestedOwner) {
          const shortSuggested = formatUserShortBadge(suggestedOwner, suggestedOwner.telegramId);
          if (shortSuggested) detail += ` · 💡 ${escapeTelegramMarkdown(shortSuggested)}`;
        }
        return {
          emoji,
          label: '',
          value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\` · ${detail}`,
        };
      }),
    });
  }

  const footerParts: string[] = [];
  if (options.banner) {
    footerParts.push(options.banner);
  }
  if (enrichedIssues.length === 0) {
    const emptyMsg = options.search
      ? t(ctx, 'admin_orphan_search_empty_body', {
          search: escapeTelegramMarkdown(options.search),
        })
      : `${t(ctx, 'admin_orphan_queue_empty_title')} — ${t(ctx, 'admin_orphan_queue_empty_body')}`;
    footerParts.push(`✨ ${emptyMsg}`);
  } else if (result.totalPages > 1) {
    footerParts.push(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`
    );
  }

  return buildScreen({
    emoji: '🧩',
    title: t(ctx, 'admin_orphan_queue_title'),
    subtitle: t(ctx, 'admin_orphan_queue_subtitle'),
    primary: {
      emoji: hasOpen ? '⚠️' : '🟢',
      label: t(ctx, 'admin_orphan_queue_pending_label'),
      value: hasOpen
        ? `${buildStatusBadge(ctx, 'warning')} · ${localizedNumber(summary.openTotal, ctx)}`
        : buildStatusBadge(ctx, 'healthy', t(ctx, 'admin_orphan_status_synced')),
    },
    sections,
    footer: footerParts.length > 0 ? footerParts.join('\n\n') : undefined,
  });
}

function buildOrphanQueueKeyboard(
  ctx: MenuContext,
  result: OrphanIssuePage,
  enrichedIssues: EnrichedOrphanIssue[],
  summary: OrphanQueueSummary,
  options: { filter: OrphanIssueFilter; search?: string }
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const { filter, search } = options;

  const tabLabel = (
    tab: OrphanIssueFilter,
    icon: string,
    key: string,
    countVal: number
  ): string => {
    const activePrefix = filter === tab ? '• ' : '';
    return `${activePrefix}${icon} ${t(ctx, key)} (${localizedNumber(countVal, ctx)})`;
  };

  keyboard
    .text(
      tabLabel('remote', '🔗', 'admin_orphan_tab_remote', summary.remoteUnbound),
      'admin:orphans:tab:remote'
    )
    .text(
      tabLabel('local', '📉', 'admin_orphan_tab_local', summary.localMissingRemote),
      'admin:orphans:tab:local'
    )
    .row()
    .text(tabLabel('all', '📋', 'admin_orphan_tab_all', summary.openTotal), 'admin:orphans:tab:all')
    .text(
      tabLabel('ignored', '🙈', 'admin_orphan_tab_ignored', summary.ignored),
      'admin:orphans:tab:ignored'
    )
    .row();

  const itemButtons = enrichedIssues.map(({ issue, ownerProfile }) => {
    const isLocal = issue.kind === 'local_missing_remote';
    const isIgnored = issue.status === 'ignored';
    const icon = isIgnored ? '🙈' : isLocal ? '📉' : '🔗';
    const ownerShort = isLocal
      ? formatUserShortBadge(ownerProfile, issue.localOwnerTelegramId)
      : '';
    const text = ownerShort
      ? `${icon} ${issue.configUsername} · ${ownerShort}`
      : `${icon} ${issue.configUsername}`;
    return {
      text,
      data: callbackData('admin', 'orphan', 'view', issue.id),
      compact: !ownerShort && issue.configUsername.length <= 18,
    };
  });

  for (let i = 0; i < itemButtons.length; i += 1) {
    const current = itemButtons[i]!;
    const next = itemButtons[i + 1];
    if (current.compact && next?.compact) {
      keyboard.text(current.text, current.data).text(next.text, next.data).row();
      i += 1;
    } else {
      keyboard.text(current.text, current.data).row();
    }
  }

  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'pagination_previous'),
        callbackData('admin', 'orphans', 'page', result.page - 1)
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)}/${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'pagination_next'),
        callbackData('admin', 'orphans', 'page', result.page + 1)
      );
    }
    keyboard.row();
  }

  return appendOrphanQueueActions(ctx, keyboard, summary, filter, search);
}

function appendOrphanQueueActions(
  ctx: MenuContext,
  keyboard: InlineKeyboard,
  summary: OrphanQueueSummary,
  filter: OrphanIssueFilter,
  search?: string
): InlineKeyboard {
  const showCleanLocal = (filter === 'all' || filter === 'local') && summary.localMissingRemote > 0;
  const showBaseline = (filter === 'all' || filter === 'remote') && summary.remoteUnbound > 0;

  if (showCleanLocal && showBaseline) {
    keyboard
      .text(
        t(ctx, 'admin_orphan_clean_local_button', {
          count: localizedNumber(summary.localMissingRemote, ctx),
        }),
        'admin:orphans:clean_local'
      )
      .text(t(ctx, 'admin_orphan_baseline_button'), 'admin:orphans:baseline')
      .row();
  } else if (showCleanLocal) {
    keyboard
      .text(
        t(ctx, 'admin_orphan_clean_local_button', {
          count: localizedNumber(summary.localMissingRemote, ctx),
        }),
        'admin:orphans:clean_local'
      )
      .row();
  } else if (showBaseline) {
    keyboard.text(t(ctx, 'admin_orphan_baseline_button'), 'admin:orphans:baseline').row();
  }

  keyboard
    .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
    .text(t(ctx, 'admin_orphan_search_button'), 'admin:orphans:search')
    .row();

  if (search) {
    keyboard.text(t(ctx, 'admin_orphan_clear_search_button'), 'admin:orphans:clear_search').row();
  }

  return keyboard.text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
}

function formatRemoteSnapshotFields(
  ctx: MenuContext,
  snapshot: RemoteOrphanSnapshot | null
): ScreenField[] {
  if (!snapshot) return [];
  const fields: ScreenField[] = [];

  const statusType =
    snapshot.status === 'active'
      ? 'active'
      : snapshot.status === 'disabled' || snapshot.status === 'on_hold'
        ? 'inactive'
        : snapshot.status === 'expired'
          ? 'expired'
          : 'warning';
  const isRecentlyOnline =
    snapshot.onlineAt !== null &&
    Number.isFinite(Date.parse(snapshot.onlineAt)) &&
    Date.now() - Date.parse(snapshot.onlineAt) <= 5 * 60 * 1000;
  const onlineSuffix = isRecentlyOnline ? ` · ${t(ctx, 'admin_orphan_online_badge')}` : '';

  fields.push({
    emoji: '📡',
    label: t(ctx, 'admin_orphan_remote_status_label'),
    value: `${buildStatusBadge(ctx, statusType)}${onlineSuffix}`,
  });

  const usedGb = Number((Math.max(0, snapshot.usedTraffic) / BYTES_PER_GB).toFixed(2));
  const trafficDisplay =
    snapshot.dataLimit && snapshot.dataLimit > 0
      ? `${localizedNumber(usedGb, ctx)} / ${localizedNumber(Number((snapshot.dataLimit / BYTES_PER_GB).toFixed(1)), ctx)} GB`
      : `${localizedNumber(usedGb, ctx)} GB (${t(ctx, 'admin_orphan_unlimited_value')})`;

  fields.push({
    emoji: '📊',
    label: t(ctx, 'admin_orphan_traffic_label'),
    value: trafficDisplay,
  });

  const expiryDisplay =
    snapshot.expire && snapshot.expire > 0
      ? localizedDate(new Date(snapshot.expire * 1000), ctx)
      : t(ctx, 'admin_orphan_unlimited_value');

  fields.push({
    emoji: '⏳',
    label: t(ctx, 'admin_orphan_expiry_label'),
    value: expiryDisplay,
  });

  if (snapshot.note) {
    fields.push({
      emoji: '📝',
      label: t(ctx, 'admin_orphan_note_label'),
      value: escapeTelegramMarkdown(snapshot.note.slice(0, 120)),
    });
  }

  return fields;
}

async function renderOrphanIssueDetail(ctx: MenuContext, issue: OrphanIssue): Promise<void> {
  const localMissing = issue.kind === 'local_missing_remote';
  const isIgnored = issue.status === 'ignored';
  const panelId = issue.panelId ?? 'legacy';
  const panelSummary = ctx.services?.panelRegistry?.getPanel?.(panelId);
  const panelName = panelSummary?.name ?? panelId;

  const [ownerProfile, remoteSnapshot] = await Promise.all([
    localMissing && issue.localOwnerTelegramId
      ? (ctx.services?.userService
          ?.findProfile?.(String(issue.localOwnerTelegramId))
          .catch(() => null) ?? null)
      : Promise.resolve(null),
    !localMissing
      ? (ctx.services?.configReconciliationService
          ?.getRemoteServiceSnapshot?.(panelId, issue.configUsername)
          .catch(() => null) ?? null)
      : Promise.resolve(null),
  ]);

  const candidateId = !localMissing
    ? extractCandidateTelegramId(issue.configUsername, remoteSnapshot?.note)
    : null;
  const rawSuggestedOwner = candidateId
    ? await ctx.services?.userService?.findProfile?.(String(candidateId)).catch(() => null)
    : null;
  const suggestedOwner =
    rawSuggestedOwner && !rawSuggestedOwner.isBanned ? rawSuggestedOwner : null;

  const keyboard = new InlineKeyboard();
  if (!localMissing && suggestedOwner) {
    const shortName =
      formatUserShortBadge(suggestedOwner, suggestedOwner.telegramId) ||
      String(suggestedOwner.telegramId);
    keyboard
      .text(
        t(ctx, 'admin_orphan_quick_assign_button', { name: shortName }),
        callbackData('admin', 'orphan', 'qa', issue.id)
      )
      .row();
  }

  if (localMissing) {
    keyboard.text(
      t(ctx, 'admin_orphan_remove_local_button'),
      callbackData('admin', 'orphan', 'remove', issue.id)
    );
  } else {
    keyboard.text(
      t(ctx, 'admin_orphan_assign_button'),
      callbackData('admin', 'orphan', 'assign', issue.id)
    );
  }

  if (isIgnored) {
    keyboard.text(
      t(ctx, 'admin_orphan_reopen_button'),
      callbackData('admin', 'orphan', 'reopen', issue.id)
    );
  } else {
    keyboard.text(
      t(ctx, 'admin_orphan_ignore_button'),
      callbackData('admin', 'orphan', 'ignore', issue.id)
    );
  }
  keyboard.row();

  if (localMissing && issue.localOwnerTelegramId) {
    keyboard
      .text(
        t(ctx, 'admin_orphan_view_owner_button'),
        `admin:user:view:${issue.localOwnerTelegramId}`
      )
      .row();
  }

  keyboard.text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back');

  const detailFields: ScreenField[] = [
    {
      emoji: '⚠️',
      label: t(ctx, 'admin_orphan_kind_label'),
      value: buildStatusBadge(
        ctx,
        isIgnored ? 'inactive' : 'warning',
        t(ctx, localMissing ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote')
      ),
    },
    {
      emoji: '🖥️',
      label: t(ctx, 'admin_orphan_panel_label'),
      value: escapeTelegramMarkdown(panelName),
    },
  ];

  if (localMissing) {
    detailFields.push({
      emoji: '👤',
      label: t(ctx, 'admin_orphan_owner_label'),
      value: formatUserDisplay(ownerProfile, issue.localOwnerTelegramId),
    });
  } else {
    detailFields.push(...formatRemoteSnapshotFields(ctx, remoteSnapshot));
    if (suggestedOwner) {
      detailFields.push({
        emoji: '💡',
        label: t(ctx, 'admin_orphan_suggested_owner_label'),
        value: formatUserDisplay(suggestedOwner, suggestedOwner.telegramId),
      });
    }
  }

  detailFields.push({
    emoji: '📅',
    label: t(ctx, 'admin_orphan_first_seen_label'),
    value: localizedDate(issue.firstSeenAt, ctx),
  });

  await renderMaintenanceScreen(
    ctx,
    buildScreen({
      emoji: '🧩',
      title: t(ctx, 'admin_orphan_detail_title'),
      primary: {
        emoji: localMissing ? '📉' : '🔗',
        label: t(ctx, 'admin_orphan_service_label'),
        value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
      },
      sections: [
        {
          emoji: '🔎',
          title: t(ctx, 'admin_orphan_overview_section'),
          fields: detailFields,
        },
      ],
    }),
    keyboard
  );
}

async function renderMaintenanceScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
