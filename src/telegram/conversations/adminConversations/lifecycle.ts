import type { ConversationContext, MyConversation } from '../../types.js';
import { t } from '../../locale.js';
import { promptInConversation, replyInConversation, waitForTextInput } from '../../ui.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';

export async function adminAddAdminConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  const actorTelegramId = await requireAdmin(conversation, ctx);
  if (!actorTelegramId || !ctx.services) return;
  await promptInConversation(conversation, ctx, t(ctx, 'admin_add_admin_prompt'));
  const input = await waitForTextInput(conversation);
  if (input === undefined) return;
  const telegramId = parsePositiveSafeInteger(input);
  if (!telegramId) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_invalid_telegram_id'));
    return;
  }
  const added = await ctx.services.adminService.addAdmin(telegramId, actorTelegramId);
  await replyInConversation(
    conversation,
    ctx,
    t(ctx, added ? 'admin_admin_added' : 'admin_admin_already_exists', { telegram_id: telegramId })
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
    await replyInConversation(conversation, ctx, t(ctx, 'admin_orphan_issue_missing'));
    return;
  }
  await promptInConversation(conversation, ctx, t(ctx, 'admin_orphan_assign_prompt'));
  const query = await waitForTextInput(conversation);
  if (query === undefined) return;
  const target = await ctx.services.userService.findProfile(query);
  if (!target) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_user_not_found'));
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
    await replyInConversation(
      conversation,
      ctx,
      result
        ? t(ctx, 'admin_orphan_assigned', {
            username: result.configUsername,
            telegram_id: target.telegramId,
          })
        : t(ctx, 'admin_orphan_issue_missing')
    );
  } catch {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_orphan_assign_failed'));
  }
}
