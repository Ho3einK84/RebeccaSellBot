import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, t } from '../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { promptAndResolveAdminTargetUser, requireAdmin } from './shared.js';
import { callbackData } from '../../callbackData.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

type BroadcastAudience =
  'all' | 'active_subscription' | 'no_subscription' | 'no_purchase_30d' | 'no_active_subscription';

const MAX_PREVIEW_CHARACTERS = 1_200;

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
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '📣',
      t(ctx, 'admin_broadcast_title'),
      t(ctx, 'admin_broadcast_audience_prompt'),
      t(ctx, 'admin_broadcast_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: audienceKeyboard }
  );
  const audienceChoice = await waitForAdminCallbackInput(conversation, ['broadcast:audience:']);
  if (!audienceChoice) return;
  const audience = audienceChoice.slice('broadcast:audience:'.length) as BroadcastAudience;
  const recipientCount = await ctx.services.broadcastService.countAudience(audience);
  if (recipientCount === 0) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '📭',
        t(ctx, 'admin_broadcast_title'),
        t(ctx, 'admin_broadcast_empty_audience')
      ),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const audienceLabel = t(ctx, `admin_broadcast_audience_${audience}`);
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✍️',
      title: t(ctx, 'admin_broadcast_compose_title'),
      subtitle: t(ctx, 'admin_broadcast_compose_subtitle'),
      primary: {
        emoji: '👥',
        label: t(ctx, 'admin_broadcast_recipient_count_label'),
        value: localizedNumber(recipientCount, ctx),
      },
      sections: [
        {
          emoji: '🎯',
          title: t(ctx, 'admin_broadcast_audience_section'),
          fields: [{ label: t(ctx, 'admin_broadcast_audience_label'), value: audienceLabel }],
        },
      ],
      footer: t(ctx, 'admin_broadcast_prompt_for_audience', {
        audience: audienceLabel,
        recipient_count: localizedNumber(recipientCount, ctx),
      }),
    }),
    { parse_mode: 'Markdown' }
  );
  const broadcastText = await waitForAdminTextInput(conversation);
  if (broadcastText === undefined) return;
  if ([...broadcastText].length > 4_096) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_broadcast_compose_title'),
        t(ctx, 'admin_broadcast_too_long')
      ),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const preview = markdownSafePreview(broadcastText);
  let testSentNotice: string | undefined;
  while (true) {
    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '📣',
        title: t(ctx, 'admin_broadcast_preview_title'),
        subtitle: t(ctx, 'admin_broadcast_preview_subtitle'),
        primary: {
          emoji: '👥',
          label: t(ctx, 'admin_broadcast_recipient_count_label'),
          value: localizedNumber(recipientCount, ctx),
        },
        sections: [
          {
            emoji: '🎯',
            title: t(ctx, 'admin_broadcast_audience_section'),
            fields: [{ label: t(ctx, 'admin_broadcast_audience_label'), value: audienceLabel }],
          },
          {
            emoji: '💬',
            title: t(ctx, 'admin_broadcast_message_section'),
            fields: [{ label: '—', value: preview.text }],
          },
        ],
        footer:
          testSentNotice ??
          (preview.truncated ? t(ctx, 'admin_message_preview_truncated') : undefined),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_broadcast_confirm_button'), 'broadcast:confirm')
          .text(t(ctx, 'admin_broadcast_test_button'), 'broadcast:test')
          .row()
          .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
      }
    );
    const action = await waitForAdminCallbackInput(conversation, [
      'broadcast:confirm',
      'broadcast:test',
    ]);
    if (action === undefined) return;
    if (action === 'broadcast:test') {
      try {
        await ctx.api.sendMessage(adminId, broadcastText);
        testSentNotice = t(ctx, 'admin_broadcast_test_sent');
      } catch (err) {
        logger.warn({ err, adminId }, 'Failed to deliver test broadcast to admin');
      }
      continue;
    }
    if (action === 'broadcast:confirm') {
      break;
    }
  }

  const job = await ctx.services.broadcastService.createJob({
    actorTelegramId: adminId,
    audience,
    message: broadcastText,
  });
  await replyInAdminConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✅',
      title: t(ctx, 'admin_broadcast_queued_title'),
      subtitle: t(ctx, 'admin_broadcast_queued_subtitle'),
      primary: {
        emoji: '👥',
        label: t(ctx, 'admin_broadcast_recipient_count_label'),
        value: localizedNumber(job.recipientCount, ctx),
      },
      sections: [
        {
          emoji: '📣',
          title: t(ctx, 'admin_broadcast_audience_section'),
          fields: [
            { label: t(ctx, 'admin_broadcast_audience_label'), value: audienceLabel },
            { label: t(ctx, 'admin_broadcast_id_label'), value: escapeTelegramMarkdown(job.id) },
          ],
        },
      ],
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(
          t(ctx, 'admin_broadcast_status_button'),
          callbackData('admin', 'broadcast', 'status', job.id)
        )
        .text(
          t(ctx, 'admin_broadcast_cancel_button'),
          callbackData('admin', 'broadcast', 'cancel', job.id)
        )
        .row()
        .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
    }
  );
}

export async function adminDirectMessageConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  const adminId = await requireAdmin(conversation, ctx);
  if (!adminId || !ctx.services) return;
  const preselectedTelegramId = await conversation.external((outsideCtx) => {
    const selected = outsideCtx.session.adminDirectMessageTargetTelegramId;
    delete outsideCtx.session.adminDirectMessageTargetTelegramId;
    return selected;
  });

  const user = await promptAndResolveAdminTargetUser(conversation, ctx, {
    titleKey: 'admin_direct_title',
    subtitleKey: 'admin_direct_subtitle',
    initialTelegramId: preselectedTelegramId,
  });

  if (!user) return;

  const telegramId = user.telegramId;
  const displayName =
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    (user.username ? `@${user.username}` : String(user.telegramId));

  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✍️',
      title: t(ctx, 'admin_direct_compose_title'),
      subtitle: t(ctx, 'admin_direct_subtitle'),
      primary: {
        emoji: '👤',
        label: t(ctx, 'admin_direct_recipient_label'),
        value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
      },
      footer: t(ctx, 'admin_direct_message_prompt'),
    }),
    { parse_mode: 'Markdown' }
  );
  const directMessage = await waitForAdminTextInput(conversation);
  if (directMessage === undefined) return;
  const preview = markdownSafePreview(directMessage);
  await promptInConversation(
    conversation,
    ctx,
    buildScreen({
      emoji: '✉️',
      title: t(ctx, 'admin_direct_preview_title'),
      subtitle: t(ctx, 'admin_direct_subtitle'),
      primary: {
        emoji: '👤',
        label: t(ctx, 'admin_direct_recipient_label'),
        value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
      },
      sections: [
        {
          emoji: '💬',
          title: t(ctx, 'admin_direct_message_section'),
          fields: [{ label: '—', value: preview.text }],
        },
      ],
      footer: preview.truncated ? t(ctx, 'admin_message_preview_truncated') : undefined,
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_direct_confirm_button'), 'direct-confirm')
        .row()
        .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
    }
  );
  if (!(await waitForAdminCallbackInput(conversation, ['direct-confirm']))) return;
  try {
    // Operator-authored broadcasts and direct messages intentionally retain their
    // exact plaintext; wrapping or forcing a parse mode would change their meaning.
    await ctx.api.sendMessage(telegramId, directMessage);
    await ctx.services.userService.recordAdminAction({
      actorTelegramId: adminId,
      action: 'direct_message_sent',
      entityType: 'telegram_user',
      entityId: String(telegramId),
      targetTelegramId: telegramId,
      metadata: { messageLength: directMessage.length },
    });
    await replyInAdminConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_direct_sent_title'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_direct_recipient_label'),
          value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
        },
        footer: t(ctx, 'admin_direct_sent'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_user_open_profile_button'), `admin:user:view:${telegramId}`)
          .row()
          .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
      }
    );
  } catch (err) {
    logger.warn({ err, telegramId }, 'Direct admin message failed');
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_direct_title'), t(ctx, 'admin_direct_failed')),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
      }
    );
  }
}

function markdownSafePreview(message: string): { text: string; truncated: boolean } {
  const characters = [...message];
  const truncated = characters.length > MAX_PREVIEW_CHARACTERS;
  const visible = truncated ? `${characters.slice(0, MAX_PREVIEW_CHARACTERS).join('')}…` : message;
  return { text: escapeTelegramMarkdown(visible), truncated };
}
