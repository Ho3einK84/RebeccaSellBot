import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MenuContext, MyConversation } from '../../types.js';
import { normalizeInputDigits, t } from '../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  cancelKeyboard,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminTextInput,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import {
  buildOrphanAssignedKeyboard,
  buildOrphanAssignedScreen,
  renderOrphanIssues,
  resolveOrphanAssignErrorKey,
  type OrphanIssue,
} from '../../features/admin/maintenanceRoutes.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';

export async function adminAddAdminConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const actorTelegramId = await requireAdmin(conversation, ctx);
  if (!actorTelegramId || !ctx.services) return;
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '➕',
      t(ctx, 'admin_registry_title'),
      t(ctx, 'admin_add_admin_prompt'),
      t(ctx, 'admin_registry_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
  );
  const input = await waitForAdminTextInput(conversation);
  if (input === undefined) return;

  let telegramId = parsePositiveSafeInteger(input);
  let resolvedUsername: string | undefined;

  if (!telegramId) {
    const profile = await conversation.external(async (outsideCtx) => {
      if (!outsideCtx.services) return null;
      return outsideCtx.services.userService.findProfile(input);
    });
    if (profile?.telegramId) {
      telegramId = profile.telegramId;
      resolvedUsername = profile.username ?? undefined;
    }
  }

  const returnKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_menu_back_to_admins'), 'admin:admins:open')
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');

  if (!telegramId) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_registry_title'), t(ctx, 'admin_invalid_telegram_id')),
      { parse_mode: 'Markdown', reply_markup: returnKeyboard }
    );
    return;
  }

  const added = await conversation.external(async (outsideCtx) => {
    if (!outsideCtx.services) return false;
    return outsideCtx.services.adminService.addAdmin(telegramId!, actorTelegramId);
  });

  const valueDisplay = resolvedUsername
    ? `@${escapeTelegramMarkdown(resolvedUsername)} (\`${telegramId}\`)`
    : `\`${telegramId}\``;

  await replyInAdminConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: added ? '✅' : 'ℹ️',
      title: t(ctx, 'admin_registry_title'),
      primary: {
        emoji: '👤',
        label: t(ctx, 'admin_registry_id_label'),
        value: valueDisplay,
      },
      footer: t(ctx, added ? 'admin_admin_added' : 'admin_admin_already_exists', {
        telegram_id: telegramId,
      }),
    }),
    { parse_mode: 'Markdown', reply_markup: returnKeyboard }
  );
}

export async function adminAssignOrphanConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const actorTelegramId = await requireAdmin(conversation, ctx);
  if (!actorTelegramId || !ctx.services) return;
  const issueId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.orphanAssignIssueId as string | undefined;
    outsideCtx.session.orphanAssignIssueId = undefined;
    return selected;
  });

  const backToListKeyboard = new InlineKeyboard().text(
    t(ctx, 'admin_orphan_back_to_list'),
    'admin:orphans:back'
  );

  if (!issueId) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_orphan_detail_title'),
        t(ctx, 'admin_orphan_issue_missing')
      ),
      { parse_mode: 'Markdown', reply_markup: backToListKeyboard }
    );
    return;
  }

  if (issueId === '__search__') {
    await promptInConversation(
      conversation,
      ctx,
      buildPromptScreen(
        '🔍',
        t(ctx, 'admin_orphan_search_title'),
        t(ctx, 'admin_orphan_search_prompt'),
        t(ctx, 'admin_orphan_queue_subtitle')
      ),
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
    );
    const rawSearch = await waitForAdminTextInput(conversation);
    if (rawSearch === undefined) return;
    const normalizedSearch = normalizeInputDigits(rawSearch).trim();
    await conversation.external(async (outsideCtx) => {
      await renderOrphanIssues(outsideCtx as MenuContext, 1, {
        search: normalizedSearch || undefined,
      });
    });
    return;
  }

  const issue = await conversation.external(
    (outsideCtx) =>
      outsideCtx.services?.configReconciliationService.getIssue(issueId) as
        Promise<OrphanIssue | undefined> | undefined
  );
  if (!issue || issue.status === 'resolved') {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_orphan_detail_title'),
        t(ctx, 'admin_orphan_issue_missing')
      ),
      { parse_mode: 'Markdown', reply_markup: backToListKeyboard }
    );
    return;
  }

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '👤',
      title: t(ctx, 'admin_orphan_detail_title'),
      subtitle: t(ctx, 'admin_orphan_queue_subtitle'),
      primary: {
        emoji: '🔗',
        label: t(ctx, 'admin_orphan_service_label'),
        value: `\`${sanitizeTelegramInlineCode(issue.configUsername)}\``,
      },
      footer: t(ctx, 'admin_orphan_assign_prompt'),
    }),
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
  );
  const rawQuery = await waitForAdminTextInput(conversation);
  if (rawQuery === undefined) return;
  const query = normalizeInputDigits(rawQuery).trim();

  const target = await conversation.external(async (outsideCtx) => {
    const userSvc = outsideCtx.services!.userService;
    const direct = await userSvc.findProfile(query);
    if (direct) return direct;
    if (typeof userSvc.searchProfiles === 'function') {
      const candidates = await userSvc.searchProfiles(query, 2);
      if (candidates.length === 1) return candidates[0] ?? null;
    }
    return null;
  });

  const retryKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_orphan_assign_button'), callbackData('admin', 'orphan', 'assign', issueId))
    .row()
    .text(t(ctx, 'menu_back'), callbackData('admin', 'orphan', 'view', issueId))
    .row()
    .text(t(ctx, 'admin_orphan_back_to_list'), 'admin:orphans:back');

  if (!target) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_orphan_detail_title'), t(ctx, 'admin_user_not_found')),
      { parse_mode: 'Markdown', reply_markup: retryKeyboard }
    );
    return;
  }

  try {
    const result = await conversation.external((outsideCtx) =>
      outsideCtx.services!.configReconciliationService.assignRemoteUnbound(
        issueId,
        target.telegramId,
        actorTelegramId
      )
    );
    await replyInAdminConversation(
      conversation,
      ctx,
      result
        ? buildOrphanAssignedScreen(ctx, result.configUsername, target)
        : buildEmptyState(
            '⚠️',
            t(ctx, 'admin_orphan_detail_title'),
            t(ctx, 'admin_orphan_issue_missing')
          ),
      {
        parse_mode: 'Markdown',
        reply_markup: result
          ? buildOrphanAssignedKeyboard(ctx, target.telegramId)
          : backToListKeyboard,
      }
    );
  } catch (err) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_orphan_detail_title'),
        t(ctx, resolveOrphanAssignErrorKey(err))
      ),
      { parse_mode: 'Markdown', reply_markup: retryKeyboard }
    );
  }
}
