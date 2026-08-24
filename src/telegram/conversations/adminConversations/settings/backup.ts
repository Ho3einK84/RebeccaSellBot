import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';

export async function adminBackupSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const enabled = ts.getSettingBool('backup_enabled', false);
    const intervalHours = ts.getSettingNum('backup_interval_hours', 24);
    const targetChatId = ts.getSetting('backup_target_chat_id', '').trim();
    const includeEnv = ts.getSettingBool('backup_include_env', true);
    const lastRunRaw = ts.getSetting('backup_last_run_at', '').trim();
    const lastStatus = ts.getSetting('backup_last_status', '').trim();

    const onBadge = t(ctx, 'admin_overview_active');
    const offBadge = t(ctx, 'admin_overview_inactive');

    let formattedLastRun = '—';
    if (lastRunRaw) {
      const parsedDate = new Date(lastRunRaw);
      if (!Number.isNaN(parsedDate.getTime())) {
        formattedLastRun = parsedDate.toLocaleString(ctx.userLocale === 'en' ? 'en-US' : 'fa-IR', {
          timeZone: 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }

    let statusDisplay = '—';
    if (lastStatus === 'success') {
      statusDisplay = `✅ ${t(ctx, 'admin_setting_saved_title')}`;
    } else if (lastStatus.startsWith('error:')) {
      statusDisplay = `⚠️ ${escapeTelegramMarkdown(lastStatus.slice(6).trim())}`;
    } else if (lastStatus) {
      statusDisplay = escapeTelegramMarkdown(lastStatus);
    }

    const screenText = buildScreen({
      emoji: '💾',
      title: t(ctx, 'admin_backup_title'),
      subtitle: t(ctx, 'admin_backup_subtitle'),
      primary: {
        emoji: enabled ? '🟢' : '🔴',
        label: t(ctx, 'admin_setting_backup_enabled'),
        value: enabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '⏱️',
          title: t(ctx, 'admin_backup_title'),
          fields: [
            {
              label: t(ctx, 'admin_setting_backup_interval_hours'),
              value: `${localizedNumber(intervalHours, ctx)} ${t(ctx, 'hours_unit')}`,
            },
            {
              label: t(ctx, 'admin_setting_backup_last_run'),
              value: formattedLastRun,
            },
            {
              label: t(ctx, 'admin_setting_backup_last_status'),
              value: statusDisplay,
            },
          ],
        },
        {
          emoji: '🎯',
          title: t(ctx, 'admin_setting_backup_target_chat_id'),
          fields: [
            {
              label: t(ctx, 'admin_setting_backup_target_chat_id'),
              value: targetChatId
                ? `\`${escapeTelegramMarkdown(targetChatId)}\``
                : t(ctx, 'admin_setting_not_configured'),
            },
            {
              label: t(ctx, 'admin_setting_backup_include_env'),
              value: includeEnv ? onBadge : offBadge,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(ctx, 'admin_setting_backup_enabled')}: ${enabled ? onBadge : offBadge}`,
        'backup:toggle:enabled'
      )
      .row()
      .text(t(ctx, 'admin_setting_backup_interval_hours'), 'backup:edit:backup_interval_hours')
      .text(t(ctx, 'admin_setting_backup_target_chat_id'), 'backup:edit:backup_target_chat_id')
      .row()
      .text(
        `${t(ctx, 'admin_setting_backup_include_env')}: ${includeEnv ? onBadge : offBadge}`,
        'backup:toggle:env'
      )
      .row()
      .text(t(ctx, 'admin_backup_send_now_button'), 'backup:action:send_now')
      .row()
      .text(t(ctx, 'admin_menu_back_to_admin'), 'backup:back');

    let renderedInPlace = false;
    const messageId = activeCtx.callbackQuery?.message?.message_id;
    const chatId = activeCtx.chat?.id;
    if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
      try {
        await activeCtx.api.editMessageText(chatId, messageId, screenText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        renderedInPlace = true;
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          renderedInPlace = true;
        }
      }
    }

    if (!renderedInPlace) {
      await promptInConversation(conversation, activeCtx, screenText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['backup:edit:', 'backup:toggle:', 'backup:action:'],
      backCallbacks: ['backup:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'backup:toggle:enabled') {
      const nextVal = (!enabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('backup_enabled', nextVal);
      });
      continue;
    }

    if (input.data === 'backup:toggle:env') {
      const nextVal = (!includeEnv).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('backup_include_env', nextVal);
      });
      continue;
    }

    if (input.data === 'backup:action:send_now') {
      if (!targetChatId) {
        const missingTargetDef = getSettingDefinition('backup_target_chat_id');
        if (missingTargetDef) {
          await editSetting(conversation, activeCtx, missingTargetDef);
        }
        continue;
      }

      await promptInConversation(
        conversation,
        activeCtx,
        `⏳ ${t(activeCtx, 'admin_backup_send_in_progress')}`,
        { parse_mode: 'Markdown' }
      );

      let sendResult: { success: boolean; error?: string } = { success: false };
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services || !outsideCtx.api) return;
        sendResult = await outsideCtx.services.backupService.sendBackupToChat(
          outsideCtx.api,
          targetChatId,
          {
            label: 'manual_backup',
            locale: outsideCtx.userLocale ?? 'fa',
          }
        );
      });

      const outcomeText = sendResult.success
        ? t(activeCtx, 'admin_backup_send_success')
        : t(activeCtx, 'admin_backup_send_failed', {
            error: escapeTelegramMarkdown(sendResult.error ?? 'Unknown error'),
          });

      const returnKeyboard = new InlineKeyboard().text(
        t(activeCtx, 'admin_settings_return_category'),
        'backup:refresh'
      );

      await promptInConversation(conversation, activeCtx, outcomeText, {
        parse_mode: 'Markdown',
        reply_markup: returnKeyboard,
      });

      const refreshInput = await waitForSettingsInput(conversation, {
        backCallbacks: ['backup:refresh'],
        retryKeyboard: returnKeyboard,
      });

      if (refreshInput.type === 'callback') {
        activeCtx = refreshInput.ctx;
      }
      continue;
    }

    if (input.data.startsWith('backup:edit:')) {
      const key = input.data.slice('backup:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        await editSetting(conversation, activeCtx, definition);
      }
    }
  }
}
