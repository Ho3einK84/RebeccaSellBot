import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { t } from '../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  cancelKeyboard,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminTextInput,
} from '../../ui.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';
import { sanitizeTelegramInlineCode } from '../../rendering.js';

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
    ? `@${resolvedUsername} (\`${telegramId}\`)`
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
  const issueId = await conversation.external(
    (outsideCtx) => outsideCtx.session.orphanAssignIssueId as string | undefined
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
      { parse_mode: 'Markdown' }
    );
    return;
  }
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '👤',
      t(ctx, 'admin_orphan_detail_title'),
      t(ctx, 'admin_orphan_assign_prompt'),
      t(ctx, 'admin_orphan_queue_subtitle')
    ),
    { parse_mode: 'Markdown' }
  );
  const query = await waitForAdminTextInput(conversation);
  if (query === undefined) return;
  const target = await ctx.services.userService.findProfile(query);
  if (!target) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_orphan_detail_title'), t(ctx, 'admin_user_not_found')),
      { parse_mode: 'Markdown' }
    );
    return;
  }
  try {
    const result = await ctx.services.configReconciliationService.assignRemoteUnbound(
      issueId,
      target.telegramId,
      actorTelegramId
    );
    await conversation.external((outsideCtx) => {
      outsideCtx.session.orphanAssignIssueId = undefined;
    });
    await replyInAdminConversation(
      conversation,
      ctx,
      result
        ? buildScreen({
            emoji: '✅',
            title: t(ctx, 'admin_orphan_detail_title'),
            primary: {
              emoji: '🧩',
              label: t(ctx, 'admin_orphan_service_label'),
              value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
            },
            sections: [
              {
                emoji: '👤',
                title: t(ctx, 'admin_registry_section'),
                fields: [
                  {
                    label: t(ctx, 'admin_orphan_owner_label'),
                    value: `\`${target.telegramId}\``,
                  },
                ],
              },
            ],
            footer: t(ctx, 'admin_orphan_assigned', {
              username: result.configUsername,
              telegram_id: target.telegramId,
            }),
          })
        : buildEmptyState(
            '⚠️',
            t(ctx, 'admin_orphan_detail_title'),
            t(ctx, 'admin_orphan_issue_missing')
          ),
      { parse_mode: 'Markdown' }
    );
  } catch {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_orphan_detail_title'),
        t(ctx, 'admin_orphan_assign_failed')
      ),
      { parse_mode: 'Markdown' }
    );
  }
}
