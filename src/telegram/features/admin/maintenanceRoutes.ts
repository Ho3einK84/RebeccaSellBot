import { InlineKeyboard, type Bot } from 'grammy';
import { LastAdminRemovalError } from '../../../domain/services/AdminService.js';
import type { MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t } from '../../locale.js';
import { buildEmptyState, buildScreen, buildStatusBadge, renderUiScreen } from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';

const ORPHAN_PAGE_SIZE = 6;
const UUID_CAPTURE = '([0-9a-fA-F-]{36})';

type OrphanIssue = {
  id: string;
  kind: 'local_missing_remote' | 'remote_unbound';
  configUsername: string;
  localOwnerTelegramId: number | null;
  firstSeenAt: Date;
};

type OrphanIssuePage = {
  issues: OrphanIssue[];
  page: number;
  totalPages: number;
  total: number;
};

export async function renderAdminRegistry(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const admins = await ctx.services.adminService.listAdmins();
  const keyboard = new InlineKeyboard();
  for (const admin of admins) {
    const isCurrentAdmin = admin.telegramId === ctx.from?.id;
    keyboard.text(
      `🛡️ ${String(admin.telegramId)}${isCurrentAdmin ? ` · ${t(ctx, 'admin_admin_you')}` : ''}`,
      callbackData('admin', 'admins', 'noop', admin.telegramId)
    );
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
    .text(t(ctx, 'menu_back'), 'nav:admin');

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
            fields: admins.map((admin) => ({
              emoji: admin.telegramId === ctx.from?.id ? '⭐' : '🛡️',
              label: String(admin.telegramId),
              value:
                admin.telegramId === ctx.from?.id
                  ? buildStatusBadge(ctx, 'active', t(ctx, 'admin_admin_you'))
                  : buildStatusBadge(ctx, 'active'),
            })),
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

export async function renderOrphanIssues(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = (await ctx.services.configReconciliationService.listIssues(
    requestedPage,
    ORPHAN_PAGE_SIZE
  )) as OrphanIssuePage;
  if (result.issues.length === 0) {
    await renderMaintenanceScreen(
      ctx,
      buildEmptyState(
        '✅',
        t(ctx, 'admin_orphan_queue_empty_title'),
        t(ctx, 'admin_orphan_queue_empty_body')
      ),
      buildOrphanQueueActions(ctx)
    );
    return;
  }

  await renderMaintenanceScreen(
    ctx,
    buildOrphanQueueScreen(ctx, result),
    buildOrphanQueueKeyboard(ctx, result)
  );
}

export function registerAdminMaintenanceRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery('admin:admins:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderAdminRegistry(ctx);
  });
  bot.callbackQuery(/^admin:admins:noop:\d+$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('admin:admins:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAddAdminConversation');
  });
  bot.callbackQuery(/^admin:admins:remove:(\d+)$/u, async (ctx) => {
    const target = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_remove_admin_title'),
        subtitle: t(ctx, 'admin_remove_admin_subtitle'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_registry_id_label'),
          value: String(target),
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
  bot.callbackQuery(/^admin:admins:remove_confirm:(\d+)$/u, async (ctx) => {
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
                value: String(target),
              },
            })
          : buildEmptyState(
              '⚠️',
              t(ctx, 'admin_registry_title'),
              t(ctx, 'admin_admin_not_found', { telegram_id: target })
            ),
        new InlineKeyboard().text(t(ctx, 'menu_back'), 'admin:admins:open')
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
        new InlineKeyboard().text(t(ctx, 'menu_back'), 'admin:admins:open')
      );
    }
  });

  bot.callbackQuery(/^admin:orphans:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, Number(ctx.match[1]) || 1);
  });
  bot.callbackQuery('admin:orphans:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderOrphanIssues(ctx, 1);
  });
  bot.callbackQuery(new RegExp(`^admin:orphan:view:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issue = (await ctx.services.configReconciliationService.getIssue(ctx.match[1]!)) as
      OrphanIssue | undefined;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    if (!issue) {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_queue_title'),
          t(ctx, 'admin_orphan_issue_missing')
        ),
        new InlineKeyboard().text(t(ctx, 'menu_back'), 'admin:orphans:open')
      );
      return;
    }
    await renderOrphanIssueDetail(ctx, issue);
  });
  bot.callbackQuery('admin:orphans:scan', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_scanning') });
    try {
      const result = await ctx.services.configReconciliationService.scan();
      const healthy = result.failedPanels.length === 0;
      await renderMaintenanceScreen(
        ctx,
        buildScreen({
          emoji: healthy ? '✅' : '⚠️',
          title: t(ctx, 'admin_orphan_scan_result_title'),
          primary: {
            emoji: healthy ? '🟢' : '⚠️',
            label: t(ctx, 'admin_orphan_queue_pending_label'),
            value: buildStatusBadge(ctx, healthy ? 'healthy' : 'warning'),
          },
          sections: [
            {
              emoji: '🧩',
              title: t(ctx, 'admin_orphan_queue_section'),
              fields: [
                {
                  label: t(ctx, 'admin_orphan_local_missing_label'),
                  value: localizedNumber(result.localMissingRemote, ctx),
                },
                {
                  label: t(ctx, 'admin_orphan_remote_unbound_label'),
                  value: localizedNumber(result.remoteUnbound, ctx),
                },
                {
                  label: t(ctx, 'admin_orphan_ignored_label'),
                  value: localizedNumber(result.remoteIgnored, ctx),
                },
                {
                  label: t(ctx, 'admin_orphan_failed_panels_label'),
                  value: localizedNumber(result.failedPanels.length, ctx),
                },
              ],
            },
          ],
          footer: t(ctx, healthy ? 'admin_orphan_scan_done' : 'admin_orphan_scan_partial', {
            local: localizedNumber(result.localMissingRemote, ctx),
            remote: localizedNumber(result.remoteUnbound, ctx),
            ignored: localizedNumber(result.remoteIgnored, ctx),
            failed: localizedNumber(result.failedPanels.length, ctx),
          }),
        }),
        buildOrphanQueueActions(ctx)
      );
    } catch {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_scan_result_title'),
          t(ctx, 'admin_orphan_scan_failed')
        ),
        buildOrphanQueueActions(ctx)
      );
    }
  });
  bot.callbackQuery('admin:orphans:baseline', async (ctx) => {
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
        .text(t(ctx, 'menu_cancel'), 'admin:orphans:open')
    );
  });
  bot.callbackQuery('admin:orphans:baseline_confirm', async (ctx) => {
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
              title: t(ctx, 'admin_orphan_queue_section'),
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
        buildOrphanQueueActions(ctx)
      );
    } catch {
      await renderMaintenanceScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_orphan_baseline_title'),
          t(ctx, 'admin_orphan_baseline_failed')
        ),
        buildOrphanQueueActions(ctx)
      );
    }
  });
  bot.callbackQuery(new RegExp(`^admin:orphan:assign:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    ctx.session.orphanAssignIssueId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAssignOrphanConversation');
  });
  bot.callbackQuery(new RegExp(`^admin:orphan:remove:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
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
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderMaintenanceScreen(
      ctx,
      buildScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_orphan_remove_title'),
        subtitle: t(ctx, 'admin_orphan_remove_subtitle'),
        primary: {
          emoji: '🧩',
          label: t(ctx, 'admin_orphan_service_label'),
          value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
        },
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
  bot.callbackQuery(
    new RegExp(`^admin:orphan:remove_confirm:${UUID_CAPTURE}$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const removed = await ctx.services.configReconciliationService.removeLocalMissing(
          ctx.match[1]!,
          ctx.from.id
        );
        await renderMaintenanceScreen(
          ctx,
          removed
            ? buildScreen({
                emoji: '✅',
                title: t(ctx, 'admin_orphan_remove_title'),
                primary: {
                  emoji: '✅',
                  label: t(ctx, 'ui_status_active'),
                  value: buildStatusBadge(ctx, 'active'),
                },
                footer: t(ctx, 'admin_orphan_removed'),
              })
            : buildEmptyState(
                '⚠️',
                t(ctx, 'admin_orphan_queue_title'),
                t(ctx, 'admin_orphan_issue_missing')
              ),
          buildOrphanQueueActions(ctx)
        );
      } catch (err) {
        await renderMaintenanceScreen(
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_orphan_remove_title'),
            t(
              ctx,
              err instanceof Error && err.message === 'ORPHAN_REMOTE_REAPPEARED'
                ? 'admin_orphan_remote_reappeared'
                : 'admin_orphan_remove_failed'
            )
          ),
          buildOrphanQueueActions(ctx)
        );
      }
    }
  );
  bot.callbackQuery(new RegExp(`^admin:orphan:ignore:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const ignored = await ctx.services.configReconciliationService.ignoreIssue(
      ctx.match[1]!,
      ctx.from.id
    );
    await ctx.answerCallbackQuery({
      text: t(ctx, ignored ? 'admin_orphan_ignored' : 'admin_orphan_issue_missing'),
    });
    await renderOrphanIssues(ctx, 1);
  });
}

function buildOrphanQueueScreen(ctx: MenuContext, result: OrphanIssuePage): string {
  return buildScreen({
    emoji: '🧩',
    title: t(ctx, 'admin_orphan_queue_title'),
    subtitle: t(ctx, 'admin_orphan_queue_subtitle'),
    primary: {
      emoji: '⚠️',
      label: t(ctx, 'admin_orphan_queue_pending_label'),
      value: `${buildStatusBadge(ctx, 'warning')} · ${localizedNumber(result.total, ctx)}`,
    },
    sections: [
      {
        emoji: '📋',
        title: t(ctx, 'admin_orphan_queue_section'),
        fields: result.issues.map((issue) => ({
          emoji: issue.kind === 'local_missing_remote' ? '📉' : '🔗',
          label: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
          value: `${t(ctx, issue.kind === 'local_missing_remote' ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote')} · ${localizedDate(issue.firstSeenAt, ctx)}`,
        })),
      },
    ],
  });
}

function buildOrphanQueueKeyboard(ctx: MenuContext, result: OrphanIssuePage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const issue of result.issues) {
    keyboard
      .text(
        `${issue.kind === 'local_missing_remote' ? '📉' : '🔗'} ${issue.configUsername}`,
        callbackData('admin', 'orphan', 'view', issue.id)
      )
      .row();
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
  return appendOrphanQueueActions(ctx, keyboard);
}

function buildOrphanQueueActions(ctx: MenuContext): InlineKeyboard {
  return appendOrphanQueueActions(ctx, new InlineKeyboard());
}

function appendOrphanQueueActions(ctx: MenuContext, keyboard: InlineKeyboard): InlineKeyboard {
  return keyboard
    .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
    .row()
    .text(t(ctx, 'admin_orphan_baseline_button'), 'admin:orphans:baseline')
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
}

async function renderOrphanIssueDetail(ctx: MenuContext, issue: OrphanIssue): Promise<void> {
  const localMissing = issue.kind === 'local_missing_remote';
  const keyboard = new InlineKeyboard();
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
  keyboard
    .text(t(ctx, 'admin_orphan_ignore_button'), callbackData('admin', 'orphan', 'ignore', issue.id))
    .row()
    .text(t(ctx, 'menu_back'), 'admin:orphans:open');
  await renderMaintenanceScreen(
    ctx,
    buildScreen({
      emoji: '🧩',
      title: t(ctx, 'admin_orphan_detail_title'),
      primary: {
        emoji: '⚠️',
        label: t(ctx, 'admin_orphan_kind_label'),
        value: buildStatusBadge(
          ctx,
          'warning',
          t(ctx, localMissing ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote')
        ),
      },
      sections: [
        {
          emoji: '🔎',
          title: t(ctx, 'admin_orphan_queue_section'),
          fields: [
            {
              label: t(ctx, 'admin_orphan_service_label'),
              value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
            },
            {
              label: t(ctx, 'admin_orphan_owner_label'),
              value:
                issue.localOwnerTelegramId === null
                  ? '—'
                  : localizedNumber(issue.localOwnerTelegramId, ctx),
            },
            {
              label: t(ctx, 'admin_orphan_first_seen_label'),
              value: localizedDate(issue.firstSeenAt, ctx),
            },
          ],
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
  await renderUiScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
