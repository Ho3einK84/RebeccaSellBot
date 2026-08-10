import { InlineKeyboard, type Bot } from 'grammy';
import { LastAdminRemovalError } from '../../../domain/services/AdminService.js';
import type { MenuContext } from '../../types.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import { backKeyboard } from '../../ui.js';
import { callbackData } from '../../callbackData.js';

const ORPHAN_PAGE_SIZE = 6;
const UUID_CAPTURE = '([0-9a-fA-F-]{36})';

export async function renderAdminRegistry(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const admins = await ctx.services.adminService.listAdmins();
  const keyboard = new InlineKeyboard();
  for (const admin of admins) {
    const label = `${admin.telegramId}${admin.telegramId === ctx.from?.id ? ` · ${t(ctx, 'admin_admin_you')}` : ''}`;
    keyboard.text(`👤 ${label}`, callbackData('admin', 'admins', 'noop', admin.telegramId));
    if (admin.telegramId !== ctx.from?.id) {
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
  await ctx.reply(tm(ctx, 'admin_admins_title', { count: localizedNumber(admins.length, ctx) }), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

export async function renderOrphanIssues(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.configReconciliationService.listIssues(
    requestedPage,
    ORPHAN_PAGE_SIZE
  );
  if (result.issues.length === 0) {
    await ctx.reply(t(ctx, 'admin_orphan_none'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
        .row()
        .text(t(ctx, 'admin_orphan_baseline_button'), 'admin:orphans:baseline')
        .row()
        .text(t(ctx, 'menu_back'), 'nav:admin'),
    });
    return;
  }

  for (const issue of result.issues) {
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
      .text(
        t(ctx, 'admin_orphan_ignore_button'),
        callbackData('admin', 'orphan', 'ignore', issue.id)
      )
      .row();
    await ctx.reply(
      tm(ctx, 'admin_orphan_card', {
        kind: t(ctx, localMissing ? 'admin_orphan_kind_local' : 'admin_orphan_kind_remote'),
        username: issue.configUsername,
        owner: issue.localOwnerTelegramId ? String(issue.localOwnerTelegramId) : '—',
        first_seen: localizedDate(issue.firstSeenAt, ctx),
      }),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }

  const navigation = new InlineKeyboard();
  if (result.page > 1) {
    navigation.text(
      t(ctx, 'pagination_previous'),
      callbackData('admin', 'orphans', 'page', result.page - 1)
    );
  }
  navigation.text(
    `${localizedNumber(result.page, ctx)}/${localizedNumber(result.totalPages, ctx)}`,
    callbackData('admin', 'orphans', 'page', result.page)
  );
  if (result.page < result.totalPages) {
    navigation.text(
      t(ctx, 'pagination_next'),
      callbackData('admin', 'orphans', 'page', result.page + 1)
    );
  }
  navigation
    .row()
    .text(t(ctx, 'admin_orphan_scan_button'), 'admin:orphans:scan')
    .row()
    .text(t(ctx, 'admin_orphan_baseline_button'), 'admin:orphans:baseline')
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
  await ctx.reply(t(ctx, 'admin_orphan_summary', { total: localizedNumber(result.total, ctx) }), {
    reply_markup: navigation,
  });
}

export function registerAdminMaintenanceRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery('admin:admins:open', async (ctx) => {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx, 'admin_remove_admin_confirm', { telegram_id: target }), {
      reply_markup: new InlineKeyboard()
        .text(
          t(ctx, 'admin_confirm_button'),
          callbackData('admin', 'admins', 'remove_confirm', target)
        )
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:admins:open'),
    });
  });
  bot.callbackQuery(/^admin:admins:remove_confirm:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const target = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    try {
      const removed = await ctx.services.adminService.removeAdmin(target, ctx.from.id);
      await ctx.reply(
        t(ctx, removed ? 'admin_admin_removed' : 'admin_admin_not_found', { telegram_id: target }),
        { reply_markup: backKeyboard(ctx, 'admin') }
      );
    } catch (err) {
      await ctx.reply(
        t(
          ctx,
          err instanceof LastAdminRemovalError
            ? 'admin_last_admin_cannot_remove'
            : 'operation_failed'
        ),
        { reply_markup: backKeyboard(ctx, 'admin') }
      );
    }
  });

  bot.callbackQuery(/^admin:orphans:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, Number(ctx.match[1]) || 1);
  });
  bot.callbackQuery('admin:orphans:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrphanIssues(ctx, 1);
  });
  bot.callbackQuery('admin:orphans:scan', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_scanning') });
    try {
      const result = await ctx.services.configReconciliationService.scan();
      await ctx.reply(
        t(
          ctx,
          result.failedPanels.length ? 'admin_orphan_scan_partial' : 'admin_orphan_scan_done',
          {
            local: localizedNumber(result.localMissingRemote, ctx),
            remote: localizedNumber(result.remoteUnbound, ctx),
            ignored: localizedNumber(result.remoteIgnored, ctx),
            failed: localizedNumber(result.failedPanels.length, ctx),
          }
        )
      );
      await renderOrphanIssues(ctx, 1);
    } catch {
      await ctx.reply(t(ctx, 'admin_orphan_scan_failed'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
    }
  });
  bot.callbackQuery('admin:orphans:baseline', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx, 'admin_orphan_baseline_confirm'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_orphan_baseline_confirm_button'), 'admin:orphans:baseline_confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:orphans:open'),
    });
  });
  bot.callbackQuery('admin:orphans:baseline_confirm', async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_orphan_baseline_running') });
    try {
      const result = await ctx.services.configReconciliationService.establishRemoteBaseline(
        ctx.from.id
      );
      await ctx.reply(
        t(ctx, 'admin_orphan_baseline_done', {
          remote: localizedNumber(result.remoteTotal, ctx),
          bound: localizedNumber(result.alreadyBound, ctx),
          ignored: localizedNumber(result.ignoredUnbound, ctx),
        })
      );
      await renderOrphanIssues(ctx, 1);
    } catch {
      await ctx.reply(t(ctx, 'admin_orphan_baseline_failed'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
    }
  });
  bot.callbackQuery(new RegExp(`^admin:orphan:assign:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    ctx.session.orphanAssignIssueId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminAssignOrphanConversation');
  });
  bot.callbackQuery(new RegExp(`^admin:orphan:remove:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const issue = await ctx.services.configReconciliationService.getIssue(ctx.match[1]!);
    if (!issue) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_orphan_issue_missing'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx, 'admin_orphan_remove_confirm', { username: issue.configUsername }), {
      reply_markup: new InlineKeyboard()
        .text(
          t(ctx, 'admin_confirm_button'),
          callbackData('admin', 'orphan', 'remove_confirm', issue.id)
        )
        .row()
        .text(t(ctx, 'menu_cancel'), 'admin:orphans:open'),
    });
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
        await ctx.reply(t(ctx, removed ? 'admin_orphan_removed' : 'admin_orphan_issue_missing'));
      } catch (err) {
        await ctx.reply(
          t(
            ctx,
            err instanceof Error && err.message === 'ORPHAN_REMOTE_REAPPEARED'
              ? 'admin_orphan_remote_reappeared'
              : 'admin_orphan_remove_failed'
          )
        );
      }
      await renderOrphanIssues(ctx, 1);
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
