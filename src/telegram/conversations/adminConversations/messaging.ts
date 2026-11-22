import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  dismissKeyboard,
  promptInConversation,
  rememberUiMessage,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
  type AdminScreenNotice,
} from '../../ui.js';
import { promptAndResolveAdminTargetUser, requireAdmin } from './shared.js';
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

  let audience: BroadcastAudience;
  let recipientCount: number;
  let audienceLabel: string;
  let audienceError: string | undefined;

  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminPromptScreen({
        emoji: '📣',
        title: t(ctx, 'admin_broadcast_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_nav_messaging'), t(ctx, 'admin_broadcast_title')),
        subtitle: t(ctx, 'admin_broadcast_subtitle'),
        body: t(ctx, 'admin_broadcast_audience_prompt'),
        error: audienceError,
      }),
      { parse_mode: 'Markdown', reply_markup: audienceKeyboard }
    );

    const audienceChoice = await waitForAdminCallbackInput(conversation, ['broadcast:audience:']);
    if (!audienceChoice) return;

    audience = audienceChoice.slice('broadcast:audience:'.length) as BroadcastAudience;
    recipientCount = await conversation.external((outsideCtx) =>
      outsideCtx.services!.broadcastService.countAudience(audience)
    );
    audienceLabel = t(ctx, `admin_broadcast_audience_${audience}`);

    if (recipientCount === 0) {
      audienceError = t(ctx, 'admin_broadcast_empty_audience');
      continue;
    }
    break;
  }

  let broadcastText: string | undefined;
  let validationError: string | undefined;

  while (true) {
    const existingDraft = broadcastText ? markdownSafePreview(broadcastText) : undefined;
    await promptInConversation(
      conversation,
      ctx,
      buildAdminScreen({
        emoji: '✍️',
        title: t(ctx, 'admin_broadcast_compose_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_nav_messaging'), t(ctx, 'admin_broadcast_title')),
        subtitle: t(ctx, 'admin_broadcast_compose_subtitle'),
        notice: validationError ? { tone: 'error', text: validationError } : undefined,
        primary: {
          emoji: '🎯',
          label: t(ctx, 'admin_broadcast_audience_label'),
          value: `${audienceLabel} · ${localizedNumber(recipientCount, ctx)} ${t(ctx, 'admin_broadcast_users_unit')}`,
          inline: true,
        },
        sections: existingDraft
          ? [
              {
                emoji: '💬',
                title: t(ctx, 'admin_text_current_label'),
                bullet: '',
                fields: [{ value: existingDraft.text }],
              },
            ]
          : undefined,
        footer: t(ctx, 'admin_broadcast_prompt_for_audience'),
      }),
      { parse_mode: 'Markdown' }
    );

    broadcastText = await waitForAdminTextInput(conversation);
    if (broadcastText === undefined) return;

    if ([...broadcastText].length > 4_096) {
      validationError = t(ctx, 'admin_broadcast_too_long');
      continue;
    }
    validationError = undefined;

    const preview = markdownSafePreview(broadcastText);
    let testNotice: AdminScreenNotice | undefined;
    let shouldEdit = false;

    while (true) {
      await promptInConversation(
        conversation,
        ctx,
        buildAdminScreen({
          emoji: '📣',
          title: t(ctx, 'admin_broadcast_preview_title'),
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_nav_messaging'),
            t(ctx, 'admin_broadcast_title')
          ),
          subtitle: t(ctx, 'admin_broadcast_preview_subtitle'),
          notice: testNotice,
          primary: {
            emoji: '🎯',
            label: t(ctx, 'admin_broadcast_audience_label'),
            value: `${audienceLabel} · ${localizedNumber(recipientCount, ctx)} ${t(ctx, 'admin_broadcast_users_unit')}`,
            inline: true,
          },
          sections: [
            {
              emoji: '💬',
              title: t(ctx, 'admin_broadcast_message_section'),
              bullet: '',
              fields: [{ value: preview.text }],
            },
          ],
          footer: preview.truncated ? t(ctx, 'admin_message_preview_truncated') : undefined,
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'admin_broadcast_confirm_button'), 'broadcast:confirm')
            .row()
            .text(t(ctx, 'admin_broadcast_test_button'), 'broadcast:test')
            .text(t(ctx, 'admin_broadcast_edit_button'), 'broadcast:edit')
            .row()
            .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
        }
      );

      const action = await waitForAdminCallbackInput(conversation, [
        'broadcast:confirm',
        'broadcast:test',
        'broadcast:edit',
      ]);

      if (action === undefined) return;

      if (action === 'broadcast:test') {
        try {
          const messageToSend = broadcastText;
          await conversation.external(async (outsideCtx) => {
            const api = outsideCtx?.api ?? ctx.api;
            const sent = await api.sendMessage(adminId, messageToSend, {
              reply_markup: dismissKeyboard(outsideCtx ?? ctx),
            });
            if (outsideCtx?.session && sent?.message_id !== undefined) {
              rememberUiMessage(outsideCtx.session, sent.message_id, 'artifact');
            }
          });
          testNotice = { tone: 'success', text: t(ctx, 'admin_broadcast_test_sent') };
        } catch (err) {
          logger.warn({ err, adminId }, 'Failed to deliver test broadcast to admin');
          testNotice = { tone: 'error', text: t(ctx, 'operation_failed') };
        }
        continue;
      }

      if (action === 'broadcast:edit') {
        shouldEdit = true;
        break;
      }

      if (action === 'broadcast:confirm') {
        break;
      }
    }

    if (shouldEdit) {
      continue;
    }
    break;
  }

  const job = await conversation.external((outsideCtx) =>
    outsideCtx.services!.broadcastService.createJob({
      actorTelegramId: adminId,
      audience,
      message: broadcastText,
    })
  );

  await replyInAdminConversation(
    conversation,
    ctx,
    buildAdminScreen({
      emoji: '✅',
      title: t(ctx, 'admin_broadcast_queued_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_nav_messaging'), t(ctx, 'admin_broadcast_title')),
      subtitle: t(ctx, 'admin_broadcast_queued_subtitle'),
      primary: {
        emoji: '🎯',
        label: t(ctx, 'admin_broadcast_audience_label'),
        value: `${audienceLabel} · ${localizedNumber(job.recipientCount, ctx)} ${t(ctx, 'admin_broadcast_users_unit')}`,
        inline: true,
      },
      sections: [
        {
          emoji: '📋',
          title: t(ctx, 'admin_broadcast_details_section'),
          fields: [{ label: t(ctx, 'admin_broadcast_id_label'), value: `\`${job.id}\`` }],
        },
      ],
    }),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_broadcast_status_button'), `adm:msg:st:${job.id}`)
        .text(t(ctx, 'admin_broadcast_cancel_button'), `adm:msg:cn:${job.id}`)
        .row()
        .text(t(ctx, 'admin_msg_jobs_button'), 'adm:msg:jobs:1')
        .row()
        .text(t(ctx, 'admin_msg_back_hub'), 'adm:msg')
        .text(t(ctx, 'admin_nav_root_short'), 'adm:home'),
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

  let directMessage: string | undefined;
  let validationError: string | undefined;

  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminScreen({
        emoji: '✍️',
        title: t(ctx, 'admin_direct_compose_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_nav_messaging'), t(ctx, 'admin_direct_title')),
        subtitle: t(ctx, 'admin_direct_subtitle'),
        notice: validationError ? { tone: 'error', text: validationError } : undefined,
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_direct_recipient_label'),
          value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
          inline: true,
        },
        footer: t(ctx, 'admin_direct_message_prompt'),
      }),
      { parse_mode: 'Markdown' }
    );
    directMessage = await waitForAdminTextInput(conversation);
    if (directMessage === undefined) return;
    if ([...directMessage].length > 4_096) {
      validationError = t(ctx, 'admin_direct_too_long');
      continue;
    }
    validationError = undefined;

    const preview = markdownSafePreview(directMessage);
    await promptInConversation(
      conversation,
      ctx,
      buildAdminScreen({
        emoji: '✉️',
        title: t(ctx, 'admin_direct_preview_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_nav_messaging'), t(ctx, 'admin_direct_title')),
        subtitle: t(ctx, 'admin_direct_subtitle'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_direct_recipient_label'),
          value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
          inline: true,
        },
        sections: [
          {
            emoji: '💬',
            title: t(ctx, 'admin_direct_message_section'),
            bullet: '',
            fields: [{ value: preview.text }],
          },
        ],
        footer: preview.truncated ? t(ctx, 'admin_message_preview_truncated') : undefined,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_direct_confirm_button'), 'direct-confirm')
          .row()
          .text(t(ctx, 'admin_direct_edit_button'), 'direct-edit')
          .row()
          .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
      }
    );
    const choice = await waitForAdminCallbackInput(conversation, ['direct-confirm', 'direct-edit']);
    if (!choice) return;
    if (choice === 'direct-edit') continue;
    break;
  }

  try {
    // Operator-authored broadcasts and direct messages intentionally retain their
    // exact plaintext; wrapping or forcing a parse mode would change their meaning.
    await conversation.external(async (outsideCtx) => {
      await ctx.api.sendMessage(telegramId, directMessage);
      await outsideCtx.services!.userService.recordAdminAction({
        actorTelegramId: adminId,
        action: 'direct_message_sent',
        entityType: 'telegram_user',
        entityId: String(telegramId),
        targetTelegramId: telegramId,
        metadata: { messageLength: directMessage.length },
      });
    });
    await replyInAdminConversation(
      conversation,
      ctx,
      buildAdminScreen({
        emoji: '✅',
        title: t(ctx, 'admin_direct_sent_title'),
        primary: {
          emoji: '👤',
          label: t(ctx, 'admin_direct_recipient_label'),
          value: `${escapeTelegramMarkdown(displayName)} (\`${telegramId}\`)`,
          inline: true,
        },
        footer: t(ctx, 'admin_direct_sent'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_user_open_profile_button'), `adm:usr:v:${telegramId}`)
          .row()
          .text(t(ctx, 'admin_msg_back_hub'), 'adm:msg')
          .text(t(ctx, 'admin_nav_root_short'), 'adm:home'),
      }
    );
  } catch (err) {
    logger.warn({ err, telegramId }, 'Direct admin message failed');
    await replyInAdminConversation(
      conversation,
      ctx,
      buildAdminEmptyState('⚠️', t(ctx, 'admin_direct_title'), t(ctx, 'admin_direct_failed')),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_user_open_profile_button'), `adm:usr:v:${telegramId}`)
          .row()
          .text(t(ctx, 'admin_msg_back_hub'), 'adm:msg')
          .text(t(ctx, 'admin_nav_root_short'), 'adm:home'),
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
