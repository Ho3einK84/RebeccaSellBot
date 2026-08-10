import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, t } from '../../locale.js';
import {
  promptInConversation,
  replyInConversation,
  waitForCallbackInput,
  waitForTextInput,
} from '../../ui.js';
import { requireAdmin } from './shared.js';
import { callbackData } from '../../callbackData.js';

export async function adminBroadcastConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;

  const audienceKeyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_broadcast_audience_all'), 'broadcast:audience:all')
    .text(t(ctx, 'admin_broadcast_audience_active'), 'broadcast:audience:active_subscription')
    .row()
    .text(t(ctx, 'admin_broadcast_audience_none'), 'broadcast:audience:no_subscription')
    .text(t(ctx, 'admin_broadcast_audience_30d'), 'broadcast:audience:no_purchase_30d')
    .row()
    .text(t(ctx, 'admin_broadcast_audience_inactive'), 'broadcast:audience:no_active_subscription')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(conversation, ctx, t(ctx, 'admin_broadcast_audience_prompt'), {
    reply_markup: audienceKeyboard,
  });
  const audienceChoice = await waitForCallbackInput(conversation, ['broadcast:audience:']);
  if (!audienceChoice) return;
  const audience = audienceChoice.slice('broadcast:audience:'.length) as
    | 'all'
    | 'active_subscription'
    | 'no_subscription'
    | 'no_purchase_30d'
    | 'no_active_subscription';
  const recipientCount = await ctx.services.broadcastService.countAudience(audience);
  if (recipientCount === 0) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_broadcast_empty_audience'));
    return;
  }

  await promptInConversation(
    conversation,
    ctx,
    t(ctx, 'admin_broadcast_prompt_for_audience', {
      audience: t(ctx, `admin_broadcast_audience_${audience}`),
      recipient_count: localizedNumber(recipientCount, ctx),
    })
  );
  const broadcastText = await waitForTextInput(conversation);
  if (broadcastText === undefined) return;
  if ([...broadcastText].length > 4_096) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_broadcast_too_long'));
    return;
  }

  await promptInConversation(
    conversation,
    ctx,
    t(ctx, 'admin_broadcast_preview', {
      audience: t(ctx, `admin_broadcast_audience_${audience}`),
      recipient_count: localizedNumber(recipientCount, ctx),
      message: broadcastText,
    }),
    {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_broadcast_confirm_button'), 'broadcast:confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
    }
  );
  if ((await waitForCallbackInput(conversation, ['broadcast:confirm'])) === undefined) return;

  const job = await ctx.services.broadcastService.createJob({
    actorTelegramId: adminId,
    audience,
    message: broadcastText,
  });
  await replyInConversation(
    conversation,
    ctx,
    t(ctx, 'admin_broadcast_queued', {
      recipient_count: localizedNumber(job.recipientCount, ctx),
    }),
    {
      reply_markup: new InlineKeyboard()
        .text(
          t(ctx, 'admin_broadcast_status_button'),
          callbackData('admin', 'broadcast', 'status', job.id)
        )
        .text(
          t(ctx, 'admin_broadcast_cancel_button'),
          callbackData('admin', 'broadcast', 'cancel', job.id)
        ),
    }
  );
}

export async function adminDirectMessageConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;
  let telegramId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.adminDirectMessageTargetTelegramId;
    delete outsideCtx.session.adminDirectMessageTargetTelegramId;
    return selected;
  });
  while (telegramId === undefined) {
    await promptInConversation(conversation, ctx, t(ctx, 'admin_direct_telegram_id_prompt'));
    const idInput = await waitForTextInput(conversation);
    if (idInput === undefined) return;
    const parsed = Number(idInput.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) telegramId = parsed;
    else await promptInConversation(conversation, ctx, t(ctx, 'admin_direct_invalid_telegram_id'));
  }
  if (!(await ctx.services.userService.exists(telegramId))) {
    await replyInConversation(conversation, ctx, t(ctx, 'admin_direct_user_not_found'));
    return;
  }
  await promptInConversation(conversation, ctx, t(ctx, 'admin_direct_message_prompt'));
  const directMessage = await waitForTextInput(conversation);
  if (directMessage === undefined) return;
  await promptInConversation(
    conversation,
    ctx,
    t(ctx, 'admin_direct_preview', { telegram_id: telegramId, message: directMessage }),
    {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_direct_confirm_button'), 'direct-confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
    }
  );
  if (!(await waitForCallbackInput(conversation, ['direct-confirm']))) return;
  try {
    await ctx.api.sendMessage(telegramId, directMessage);
    await ctx.services.userService.recordAdminAction({
      actorTelegramId: adminId,
      action: 'direct_message_sent',
      entityType: 'telegram_user',
      entityId: String(telegramId),
      targetTelegramId: telegramId,
      metadata: { messageLength: directMessage.length },
    });
    await replyInConversation(conversation, ctx, t(ctx, 'admin_direct_sent'));
  } catch (err) {
    logger.warn({ err, telegramId }, 'Direct admin message failed');
    await replyInConversation(conversation, ctx, t(ctx, 'admin_direct_failed'));
  }
}
