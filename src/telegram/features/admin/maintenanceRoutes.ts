import { InlineKeyboard, type Bot } from 'grammy';
import { LastAdminRemovalError } from '../../../domain/services/AdminService.js';
import type {
  OrphanIssueFilter,
  OrphanQueueSummary,
  RemoteOrphanSnapshot,
} from '../../../domain/services/ConfigReconciliationService.js';
import type { LocalUserProfile } from '../../../domain/services/UserService.js';
import type { ConversationContext, MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, normalizeInputDigits, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  guardAdminCallbacks,
  renderScreen,
  type AdminScreenNotice,
  type UserScreenField,
  type UserScreenSection,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
  pushAdminNav,
} from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';
import { registerAdminInputHandler, startAdminInput } from '../../admin/adminInput.js';

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
  notice?: AdminScreenNotice;
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

export async function renderAdminRegistry(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
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
  keyboard.text(t(ctx, 'admin_add_admin_button'), 'admin:admins:add').row();
  keyboard
    .text(t(ctx, 'admin_cfg_back_settings'), 'adm:cfg')
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_menu_settings'),
    t(ctx, 'admin_registry_title')
  );
  const text = admins.length
    ? buildAdminScreen({
        emoji: '🛡️',
        title: t(ctx, 'admin_registry_title'),
        breadcrumb,
        notice,
        primary: {
          label: t(ctx, 'admin_registry_count_label'),
          value: localizedNumber(admins.length, ctx),
          inline: true,
          emphasizeValue: true,
        },
        sections: [
          {
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
                label,
                value: isCurrentAdmin
                  ? buildStatusBadge(ctx, 'active', t(ctx, 'admin_admin_you'))
                  : buildStatusBadge(ctx, 'active'),
              };
            }),
          },
        ],
      })
    : buildAdminEmptyState(
        '🛡️',
        t(ctx, 'admin_registry_empty_title'),
        t(ctx, 'admin_registry_empty_body'),
        { breadcrumb, notice }
      );
  await renderMaintenanceScreen(ctx, text, keyboard);
}

export async function renderOrphanIssues(
  ctx: MenuContext,
  requestedPage?: number,
  options?: RenderOrphanIssuesOptions
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
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
  const resolvedNotice: AdminScreenNotice | undefined =
    options?.notice ?? (options?.banner ? { tone: 'info', text: options.banner } : undefined);

  await renderMaintenanceScreen(
    ctx,
    buildOrphanQueueScreen(ctx, result, enrichedIssues, summary, {
      filter,
      search,
      notice: resolvedNotice,
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

function registerMaintenanceInputHandlers(): void {
  registerAdminInputHandler('orp:search', async (ctx, rawText) => {
    const normalizedSearch = normalizeInputDigits(rawText).trim();
    if (ctx.session) {
      ctx.session.adminOrphanView = {
        filter: ctx.session.adminOrphanView?.filter ?? 'all',
        page: 1,
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
      };
    }
    return { status: 'done', redirectRoute: 'adm:orp:back' };
  });

  registerAdminInputHandler('orp:assign', async (ctx, rawText, state) => {
    if (!ctx.services || !ctx.from) return { status: 'done' };
    const issueId = String(state.payload?.issueId ?? '');
    const configUsername = String(state.payload?.configUsername ?? '');
    const query = normalizeInputDigits(rawText).trim();

    const userSvc = ctx.services.userService;
    let target = await userSvc.findProfile(query);
    if (!target && typeof userSvc.searchProfiles === 'function') {
      const candidates = await userSvc.searchProfiles(query, 2);
      if (candidates.length === 1) target = candidates[0] ?? null;
    }

    if (!target) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '👤',
          t(ctx, 'admin_orphan_detail_title'),
          t(ctx, 'admin_orphan_assign_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            currentLabel: t(ctx, 'admin_orphan_service_label'),
            currentValue: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
            error: t(ctx, 'admin_user_not_found'),
          }
        ),
      };
    }

    try {
      const assigned = await ctx.services.configReconciliationService.assignRemoteUnbound(
        issueId,
        target.telegramId,
        ctx.from.id
      );
      if (!assigned) {
        return {
          status: 'done',
          redirectRoute: 'adm:orp:back',
          notice: { tone: 'warning', text: t(ctx, 'admin_orphan_issue_missing') },
        };
      }
      delete ctx.session.adminInput;
      pushAdminNav(ctx.session, 'adm:orp:back');
      await renderMaintenanceScreen(
        ctx,
        buildOrphanAssignedScreen(ctx, assigned.configUsername, target),
        buildOrphanAssignedKeyboard(ctx, target.telegramId)
      );
      return { status: 'handled' };
    } catch (err) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '👤',
          t(ctx, 'admin_orphan_detail_title'),
          t(ctx, 'admin_orphan_assign_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            currentLabel: t(ctx, 'admin_orphan_service_label'),
            currentValue: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
            error: t(ctx, resolveOrphanAssignErrorKey(err)),
          }
        ),
      };
    }
  });

  registerAdminInputHandler('adm:add', async (ctx, rawText) => {
    if (!ctx.services || !ctx.from) return { status: 'done' };
    const normalized = normalizeInputDigits(rawText.trim());
    let telegramId = /^[1-9]\d*$/u.test(normalized) ? Number(normalized) : undefined;
    if (!telegramId || !Number.isSafeInteger(telegramId)) {
      const profile = await ctx.services.userService.findProfile(rawText.trim());
      telegramId = profile?.telegramId;
    }
    if (!telegramId) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '➕',
          t(ctx, 'admin_registry_title'),
          t(ctx, 'admin_add_admin_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_menu_settings')),
            error: t(ctx, 'admin_invalid_telegram_id'),
          }
        ),
      };
    }
    const added = await ctx.services.adminService.addAdmin(telegramId, ctx.from.id);
    return {
      status: 'done',
      redirectRoute: 'adm:cfg:adm',
      notice: {
        tone: added ? 'success' : 'info',
        text: t(ctx, added ? 'admin_admin_added' : 'admin_admin_already_exists', {
          telegram_id: telegramId,
        }),
      },
    };
  });
}

export function registerAdminMaintenanceRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);
  registerMaintenanceInputHandlers();

  // Unified `adm:orp:*` routes
  registerAdminRoute(/^adm:orp:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderOrphanIssues(ctx, Number(match?.[1]) || 1, { notice });
  });
  registerAdminRoute('adm:orp:open', async (ctx) => {
    delete ctx.session.adminOrphanView;
    await renderOrphanIssues(ctx, 1, { filter: 'all', search: undefined });
  });
  registerAdminRoute('adm:orp:back', async (ctx, _m, notice) => {
    await renderOrphanIssues(ctx, undefined, { notice });
  });
  registerAdminRoute(new RegExp(`^adm:orp:v:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    if (!ctx.services) return;
    const issue = (await ctx.services.configReconciliationService.getIssue(match![1]!)) as
      OrphanIssue | undefined;
    if (!issue || issue.status === 'resolved') {
      await renderOrphanIssues(ctx, undefined, {
        notice: { tone: 'warning', text: t(ctx, 'admin_orphan_issue_missing') },
      });
      return;
    }
    await renderOrphanIssueDetail(ctx, issue);
  });

  // Admin Registry callbacks
  adminCallback('admin:admins:open', async (ctx) => {
    await ctx.answerCallbackQuery();
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

    const profileFields: UserScreenField[] = [];
    if (profile?.username) {
      profileFields.push({
        label: t(ctx, 'admin_detail_username_label'),
        value: `@${escapeTelegramMarkdown(profile.username)}`,
      });
    }
    if (profile?.firstName) {
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      profileFields.push({
        label: t(ctx, 'admin_detail_name_label'),
        value: escapeTelegramMarkdown(fullName),
      });
    }
    profileFields.push({
      label: t(ctx, 'admin_detail_created_at_label'),
      value: localizedDate(adminRecord.createdAt, ctx),
    });
    profileFields.push({
      label: t(ctx, 'admin_detail_added_by_label'),
      value: adminRecord.addedBy
        ? `\`${adminRecord.addedBy}\``
        : t(ctx, 'admin_detail_added_by_system'),
    });

    pushAdminNav(ctx.session, 'adm:cfg:adm');
    const keyboard = new InlineKeyboard();
    keyboard.text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${target}`);
    if (!isCurrentAdmin) {
      keyboard.text(
        t(ctx, 'admin_remove_admin_button'),
        callbackData('admin', 'admins', 'remove', target)
      );
    }
    keyboard.row();
    appendAdminFooterNav(keyboard, ctx, {
      backCallback: 'admin:admins:open',
      backLabel: t(ctx, 'admin_menu_back_to_admins'),
      showHome: true,
    });

    await renderMaintenanceScreen(
      ctx,
      buildAdminScreen({
        emoji: '🛡️',
        title: t(ctx, 'admin_detail_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_menu_settings'),
          t(ctx, 'admin_registry_title')
        ),
        primary: {
          label: t(ctx, 'admin_registry_id_label'),
          value: `\`${target}\``,
          inline: true,
        },
        sections: [
          {
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
    await startAdminInput(ctx, {
      kind: 'adm:add',
      returnRoute: 'adm:cfg:adm',
      promptText: buildAdminPromptScreen(
        '➕',
        t(ctx, 'admin_registry_title'),
        t(ctx, 'admin_add_admin_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_menu_settings')),
        }
      ),
    });
  });

  adminCallback(/^admin:admins:remove:(\d+)$/u, async (ctx) => {
    const target = Number(ctx.match[1]);
    if (target === ctx.from?.id) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    const admins = (await ctx.services?.adminService.listAdmins()) ?? [];
    if (admins.length <= 1) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_last_admin_cannot_remove'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    const profile = await ctx.services?.userService.findProfile(String(target));
    const targetDisplay = profile?.username
      ? `@${escapeTelegramMarkdown(profile.username)} (\`${target}\`)`
      : `\`${target}\``;

    await renderMaintenanceScreen(
      ctx,
      buildAdminScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_remove_admin_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_menu_settings'),
          t(ctx, 'admin_registry_title')
        ),
        subtitle: t(ctx, 'admin_remove_admin_subtitle'),
        primary: {
          label: t(ctx, 'admin_registry_id_label'),
          value: targetDisplay,
          inline: true,
        },
        footer: t(ctx, 'admin_remove_admin_consequence'),
      }),
      buildAdminConfirmKeyboard(ctx, {
        confirmCallback: callbackData('admin', 'admins', 'remove_confirm', target),
        cancelCallback: callbackData('admin', 'admins', 'view', target),
      })
    );
  });

  adminCallback(/^admin:admins:remove_confirm:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const target = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      const removed = await ctx.services.adminService.removeAdmin(target, ctx.from.id);
      await renderAdminRegistry(ctx, {
        tone: removed ? 'success' : 'warning',
        text: removed
          ? t(ctx, 'admin_admin_removed_title')
          : t(ctx, 'admin_admin_not_found', { telegram_id: target }),
      });
    } catch (err) {
      await renderAdminRegistry(ctx, {
        tone: 'error',
        text: t(
          ctx,
          err instanceof LastAdminRemovalError
            ? 'admin_last_admin_cannot_remove'
            : 'operation_failed'
        ),
      });
    }
  });

  // Orphan Reconciliation routes
  adminCallback(/^admin:orphans:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, Number(ctx.match[1]) || 1);
  });
  adminCallback('admin:orphans:open', async (ctx) => {
    delete ctx.session.adminOrphanView;
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, 1, { filter: 'all', search: undefined });
  });
  adminCallback('admin:orphans:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx);
  });
  adminCallback(/^admin:orphans:tab:(all|remote|local|ignored)$/u, async (ctx) => {
    const filter = ctx.match[1] as OrphanIssueFilter;
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, 1, { filter });
  });
  adminCallback('admin:orphans:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAdminInput(ctx, {
      kind: 'orp:search',
      returnRoute: 'adm:orp:back',
      promptText: buildAdminPromptScreen(
        '🔍',
        t(ctx, 'admin_orphan_search_title'),
        t(ctx, 'admin_orphan_search_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_nav_panels'),
            t(ctx, 'admin_orphan_queue_title')
          ),
        }
      ),
    });
  });
  adminCallback('admin:orphans:clear_search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, 1, { search: undefined });
  });
  adminCallback(new RegExp(`^admin:orphan:view:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issue = (await ctx.services.configReconciliationService.getIssue(ctx.match[1]!)) as
      OrphanIssue | undefined;
    await ctx.answerCallbackQuery();
    if (!issue || issue.status === 'resolved') {
      await renderOrphanIssues(ctx, undefined, {
        notice: { tone: 'warning', text: t(ctx, 'admin_orphan_issue_missing') },
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
      // Clear stale search filter so newly discovered issues are immediately visible.
      await renderOrphanIssues(ctx, 1, {
        filter:
          result.remoteUnbound > 0 && result.localMissingRemote === 0
            ? 'remote'
            : result.localMissingRemote > 0 && result.remoteUnbound === 0
              ? 'local'
              : 'all',
        search: undefined,
        notice: { tone: healthy ? 'success' : 'warning', text: banner },
      });
    } catch {
      const kb = new InlineKeyboard()
        .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
        .row();
      appendAdminFooterNav(kb, ctx, {
        backCallback: 'admin:orphans:back',
        backLabel: t(ctx, 'admin_orphan_back_to_list'),
        showHome: true,
      });
      await renderMaintenanceScreen(
        ctx,
        buildAdminEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_scan_result_title'),
          t(ctx, 'admin_orphan_scan_failed')
        ),
        kb
      );
    }
  });
  adminCallback('admin:orphans:baseline', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderMaintenanceScreen(
      ctx,
      buildAdminScreen({
        emoji: '🧱',
        title: t(ctx, 'admin_orphan_baseline_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_nav_panels'),
          t(ctx, 'admin_orphan_queue_title')
        ),
        subtitle: t(ctx, 'admin_orphan_baseline_subtitle'),
        footer: t(ctx, 'admin_orphan_baseline_consequence'),
      }),
      buildAdminConfirmKeyboard(ctx, {
        confirmCallback: 'admin:orphans:baseline_confirm',
        cancelCallback: 'admin:orphans:back',
        confirmLabel: t(ctx, 'admin_orphan_baseline_confirm_button'),
      })
    );
  });
  adminCallback('admin:orphans:baseline_confirm', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_baseline_running') });
    try {
      const result = await ctx.services.configReconciliationService.establishRemoteBaseline(
        ctx.from.id
      );
      const kb = new InlineKeyboard();
      appendAdminFooterNav(kb, ctx, {
        backCallback: 'admin:orphans:back',
        backLabel: t(ctx, 'admin_orphan_back_to_list'),
        showHome: true,
      });
      await renderMaintenanceScreen(
        ctx,
        buildAdminScreen({
          emoji: '✅',
          title: t(ctx, 'admin_orphan_baseline_result_title'),
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          primary: {
            label: t(ctx, 'admin_orphan_baseline_status_label'),
            value: buildStatusBadge(ctx, 'healthy', t(ctx, 'admin_orphan_status_synced')),
            inline: true,
          },
          sections: [
            {
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
        kb
      );
    } catch {
      await renderMaintenanceScreen(
        ctx,
        buildAdminEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_baseline_title'),
          t(ctx, 'admin_orphan_baseline_failed')
        ),
        new InlineKeyboard().text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back')
      );
    }
  });
  adminCallback('admin:orphans:clean_local', async (ctx) => {
    const summary = await ctx.services?.configReconciliationService
      ?.getQueueSummary?.()
      .catch(() => null);
    const localCount = summary?.localMissingRemote ?? 0;
    if (localCount === 0) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_orphan_clean_local_empty'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderMaintenanceScreen(
      ctx,
      buildAdminScreen({
        emoji: '🧹',
        title: t(ctx, 'admin_orphan_clean_local_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_nav_panels'),
          t(ctx, 'admin_orphan_queue_title')
        ),
        subtitle: t(ctx, 'admin_orphan_clean_local_subtitle'),
        primary: {
          label: t(ctx, 'admin_orphan_local_missing_label'),
          value: localizedNumber(localCount, ctx),
          inline: true,
          emphasizeValue: true,
        },
        footer: t(ctx, 'admin_orphan_remove_consequence'),
      }),
      buildAdminConfirmKeyboard(ctx, {
        confirmCallback: 'admin:orphans:clean_local_ok',
        cancelCallback: 'admin:orphans:back',
        confirmLabel: t(ctx, 'admin_orphan_clean_local_confirm_button'),
      })
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
    await renderOrphanIssues(ctx, 1, {
      filter: 'all',
      search: undefined,
      notice: { tone: 'success', text: banner },
    });
  });
  adminCallback(new RegExp(`^admin:orphan:assign:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    const issueId = ctx.match[1]!;
    const issue = (await ctx.services?.configReconciliationService.getIssue(issueId)) as
      OrphanIssue | undefined;
    await ctx.answerCallbackQuery();
    if (!issue || issue.status === 'resolved') {
      await renderOrphanIssues(ctx, undefined, {
        notice: { tone: 'warning', text: t(ctx, 'admin_orphan_issue_missing') },
      });
      return;
    }
    await startAdminInput(ctx, {
      kind: 'orp:assign',
      payload: { issueId, configUsername: issue.configUsername },
      returnRoute: `adm:orp:v:${issueId}`,
      promptText: buildAdminPromptScreen(
        '👤',
        t(ctx, 'admin_orphan_detail_title'),
        t(ctx, 'admin_orphan_assign_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_nav_panels'),
            t(ctx, 'admin_orphan_queue_title')
          ),
          currentLabel: t(ctx, 'admin_orphan_service_label'),
          currentValue: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
        }
      ),
    });
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
    // Resolve candidate ID from BOTH configUsername and remote panel note (fixes note-matched Quick Assign bug!).
    let candidateId = extractCandidateTelegramId(issue.configUsername);
    if (!candidateId) {
      const remoteSnapshot = await ctx.services.configReconciliationService
        ?.getRemoteServiceSnapshot?.(issue.panelId ?? 'legacy', issue.configUsername)
        .catch(() => null);
      candidateId = extractCandidateTelegramId(issue.configUsername, remoteSnapshot?.note);
    }
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
      const plainToast = t(ctx, 'admin_orphan_assigned', {
        username: assigned.configUsername,
        telegram_id: target.telegramId,
      }).replace(/`/gu, '');
      await ctx.answerCallbackQuery({ text: plainToast });
      pushAdminNav(ctx.session, 'adm:orp:back');
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
    await ctx.answerCallbackQuery();
    await renderMaintenanceScreen(
      ctx,
      buildAdminScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_orphan_remove_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_nav_panels'),
          t(ctx, 'admin_orphan_queue_title')
        ),
        subtitle: t(ctx, 'admin_orphan_remove_subtitle'),
        primary: {
          label: t(ctx, 'admin_orphan_service_label'),
          value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
          inline: true,
        },
        sections: issue.localOwnerTelegramId
          ? [
              {
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
      buildAdminConfirmKeyboard(ctx, {
        confirmCallback: callbackData('admin', 'orphan', 'remove_confirm', issue.id),
        cancelCallback: callbackData('admin', 'orphan', 'view', issue.id),
      })
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
      await renderOrphanIssues(ctx, undefined, {
        notice: { tone: removed ? 'success' : 'warning', text: t(ctx, bannerKey) },
      });
    } catch (err) {
      const errKey =
        err instanceof Error && err.message === 'ORPHAN_REMOTE_REAPPEARED'
          ? 'admin_orphan_remote_reappeared'
          : 'admin_orphan_remove_failed';
      await ctx.answerCallbackQuery({ text: t(ctx, errKey), show_alert: true });
      await renderOrphanIssues(ctx, undefined, {
        notice: { tone: 'error', text: t(ctx, errKey) },
      });
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
    await renderOrphanIssues(ctx, undefined, {
      notice: { tone: ignored ? 'success' : 'warning', text: t(ctx, msgKey) },
    });
  });
  adminCallback(new RegExp(`^admin:orphan:reopen:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const reopened = await ctx.services.configReconciliationService.unignoreIssue(
      ctx.match[1]!,
      ctx.from.id
    );
    const msgKey = reopened ? 'admin_orphan_reopened' : 'admin_orphan_issue_missing';
    await ctx.answerCallbackQuery({ text: t(ctx, msgKey) });
    await renderOrphanIssues(ctx, undefined, {
      notice: { tone: reopened ? 'success' : 'warning', text: t(ctx, msgKey) },
    });
  });
}

export function buildOrphanAssignedScreen(
  ctx: ConversationContext,
  configUsername: string,
  target: LocalUserProfile
): string {
  return buildAdminScreen({
    emoji: '✅',
    title: t(ctx, 'admin_orphan_detail_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
    primary: {
      label: t(ctx, 'admin_orphan_service_label'),
      value: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_orphan_owner_label'),
            value: formatUserDisplay(target, target.telegramId),
          },
        ],
      },
    ],
    footer: t(ctx, 'admin_orphan_assigned', {
      username: sanitizeTelegramInlineCode(configUsername),
      telegram_id: target.telegramId,
    }),
  });
}

export function buildOrphanAssignedKeyboard(
  ctx: ConversationContext,
  targetTelegramId: number
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_orphan_view_owner_button'), `admin:user:view:${targetTelegramId}`)
    .row();
  return appendAdminFooterNav(kb, ctx, {
    backCallback: 'admin:orphans:back',
    backLabel: t(ctx, 'admin_orphan_back_to_list'),
    showHome: true,
  });
}

function buildOrphanQueueScreen(
  ctx: MenuContext,
  result: OrphanIssuePage,
  enrichedIssues: EnrichedOrphanIssue[],
  summary: OrphanQueueSummary,
  options: { filter: OrphanIssueFilter; search?: string; notice?: AdminScreenNotice }
): string {
  const hasOpen = summary.openTotal > 0;
  const overviewFields: UserScreenField[] = [
    {
      label: t(ctx, 'admin_orphan_remote_unbound_label'),
      value: localizedNumber(summary.remoteUnbound, ctx),
    },
    {
      label: t(ctx, 'admin_orphan_local_missing_label'),
      value: localizedNumber(summary.localMissingRemote, ctx),
    },
    {
      label: t(ctx, 'admin_orphan_ignored_label'),
      value: localizedNumber(summary.ignored, ctx),
    },
  ];
  if (options.search) {
    overviewFields.push({
      label: t(ctx, 'admin_orphan_search_active_label'),
      value: `\`${sanitizeTelegramInlineCode(options.search)}\` (${localizedNumber(result.total, ctx)})`,
    });
  }

  const sections: UserScreenSection[] = [
    {
      title: t(ctx, 'admin_orphan_overview_section'),
      fields: overviewFields,
    },
  ];

  if (enrichedIssues.length > 0) {
    sections.push({
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
          value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\` · ${detail}`,
        };
      }),
    });
  }

  const footerParts: string[] = [];
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

  return buildAdminScreen({
    emoji: '🧩',
    title: t(ctx, 'admin_orphan_queue_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_panels'),
      t(ctx, 'admin_orphan_queue_title')
    ),
    notice: options.notice,
    primary: {
      label: t(ctx, 'admin_orphan_queue_pending_label'),
      value: hasOpen
        ? `${buildStatusBadge(ctx, 'warning')} · ${localizedNumber(summary.openTotal, ctx)}`
        : buildStatusBadge(ctx, 'healthy', t(ctx, 'admin_orphan_status_synced')),
      inline: true,
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

  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => callbackData('admin', 'orphans', 'page', p),
  });

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

  return appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:pnl:p:1',
    backLabel: t(ctx, 'admin_panel_back_list'),
    showHome: true,
  });
}

function formatRemoteSnapshotFields(
  ctx: MenuContext,
  snapshot: RemoteOrphanSnapshot | null
): UserScreenField[] {
  if (!snapshot) return [];
  const fields: UserScreenField[] = [];

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
    label: t(ctx, 'admin_orphan_remote_status_label'),
    value: `${buildStatusBadge(ctx, statusType)}${onlineSuffix}`,
  });

  const gbUnit = t(ctx, 'traffic_unit_gb');
  const usedGb = Number((Math.max(0, snapshot.usedTraffic) / BYTES_PER_GB).toFixed(2));
  const trafficDisplay =
    snapshot.dataLimit && snapshot.dataLimit > 0
      ? `${localizedNumber(usedGb, ctx)} / ${localizedNumber(Number((snapshot.dataLimit / BYTES_PER_GB).toFixed(1)), ctx)} ${gbUnit}`
      : `${localizedNumber(usedGb, ctx)} ${gbUnit} (${t(ctx, 'admin_orphan_unlimited_value')})`;

  fields.push({
    label: t(ctx, 'admin_orphan_traffic_label'),
    value: trafficDisplay,
  });

  const expiryDisplay =
    snapshot.expire && snapshot.expire > 0
      ? localizedDate(new Date(snapshot.expire * 1000), ctx)
      : t(ctx, 'admin_orphan_unlimited_value');

  fields.push({
    label: t(ctx, 'admin_orphan_expiry_label'),
    value: expiryDisplay,
  });

  if (snapshot.note) {
    fields.push({
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

  pushAdminNav(ctx.session, `adm:orp:v:${issue.id}`);

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
      .row()
      .text(t(ctx, 'admin_orphan_view_candidate_button'), `adm:usr:v:${suggestedOwner.telegramId}`)
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

  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'admin:orphans:back',
    backLabel: t(ctx, 'admin_orphan_back_to_list'),
    showHome: true,
  });

  const detailFields: UserScreenField[] = [
    {
      label: t(ctx, 'admin_orphan_kind_label'),
      value: buildStatusBadge(
        ctx,
        isIgnored ? 'inactive' : 'warning',
        t(ctx, localMissing ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote')
      ),
    },
    {
      label: t(ctx, 'admin_orphan_panel_label'),
      value: escapeTelegramMarkdown(panelName),
    },
  ];

  if (localMissing) {
    detailFields.push({
      label: t(ctx, 'admin_orphan_owner_label'),
      value: formatUserDisplay(ownerProfile, issue.localOwnerTelegramId),
    });
  } else {
    detailFields.push(...formatRemoteSnapshotFields(ctx, remoteSnapshot));
    if (suggestedOwner) {
      detailFields.push({
        label: t(ctx, 'admin_orphan_suggested_owner_label'),
        value: formatUserDisplay(suggestedOwner, suggestedOwner.telegramId),
      });
    }
  }

  detailFields.push({
    label: t(ctx, 'admin_orphan_first_seen_label'),
    value: localizedDate(issue.firstSeenAt, ctx),
  });

  await renderMaintenanceScreen(
    ctx,
    buildAdminScreen({
      emoji: '🧩',
      title: t(ctx, 'admin_orphan_detail_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_nav_panels'),
        t(ctx, 'admin_orphan_queue_title')
      ),
      primary: {
        label: t(ctx, 'admin_orphan_service_label'),
        value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
        inline: true,
      },
      sections: [
        {
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
