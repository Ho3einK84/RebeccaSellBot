import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedDateTime, localizedNumber, t } from '../../../locale.js';
import { buildScreen, promptInConversation } from '../../../ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';

export async function adminBackupSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      return {
        enabled: ts.getSettingBool('backup_enabled', false),
        intervalHours: ts.getSettingNum('backup_interval_hours', 24),
        targetChatId: ts.getSetting('backup_target_chat_id', '').trim(),
        includeEnv: ts.getSettingBool('backup_include_env', true),
        lastRunRaw: ts.getSetting('backup_last_run_at', '').trim(),
        lastStatus: ts.getSetting('backup_last_status', '').trim(),
      };
    });
    if (!state) return;
    const { enabled, intervalHours, targetChatId, includeEnv, lastRunRaw, lastStatus } = state;

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');

    let formattedLastRun = '—';
    if (lastRunRaw) {
      const parsedDate = new Date(lastRunRaw);
      if (!Number.isNaN(parsedDate.getTime())) {
        formattedLastRun = localizedDateTime(parsedDate, activeCtx);
      }
    }

    let statusDisplay = '—';
    if (lastStatus === 'success') {
      statusDisplay = `✅ ${t(activeCtx, 'admin_setting_saved_title')}`;
    } else if (lastStatus.startsWith('error:')) {
      statusDisplay = `⚠️ ${escapeTelegramMarkdown(lastStatus.slice(6).trim())}`;
    } else if (lastStatus) {
      statusDisplay = escapeTelegramMarkdown(lastStatus);
    }

    const screenText = buildScreen({
      emoji: '💾',
      title: t(activeCtx, 'admin_backup_title'),
      subtitle: t(activeCtx, 'admin_backup_subtitle'),
      primary: {
        emoji: enabled ? '🟢' : '🔴',
        label: t(activeCtx, 'admin_setting_backup_enabled'),
        value: enabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '⏱️',
          title: t(activeCtx, 'admin_backup_title'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_backup_interval_hours'),
              value: `${localizedNumber(intervalHours, activeCtx)} ${t(activeCtx, 'hours_unit')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_backup_last_run'),
              value: formattedLastRun,
            },
            {
              label: t(activeCtx, 'admin_setting_backup_last_status'),
              value: statusDisplay,
            },
          ],
        },
        {
          emoji: '🎯',
          title: t(activeCtx, 'admin_setting_backup_target_chat_id'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_backup_target_chat_id'),
              value: targetChatId
                ? `\`${sanitizeTelegramInlineCode(targetChatId)}\``
                : t(activeCtx, 'admin_setting_not_configured'),
            },
            {
              label: t(activeCtx, 'admin_setting_backup_include_env'),
              value: includeEnv ? onBadge : offBadge,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(activeCtx, 'admin_setting_backup_enabled')}: ${enabled ? onBadge : offBadge}`,
        'backup:toggle:enabled'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_backup_interval_hours'),
        'backup:edit:backup_interval_hours'
      )
      .text(
        t(activeCtx, 'admin_setting_backup_target_chat_id'),
        'backup:edit:backup_target_chat_id'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_backup_include_env')}: ${includeEnv ? onBadge : offBadge}`,
        'backup:toggle:env'
      )
      .row()
      .text(t(activeCtx, 'admin_backup_send_now_button'), 'backup:action:send_now')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_admin'), 'nav:admin');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['backup:edit:', 'backup:toggle:', 'backup:action:'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') break;
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
          const outcome = await editSetting(conversation, activeCtx, missingTargetDef);
          if (outcome === 'cancel') return;
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

      if (refreshInput.type === 'cancel') return;
      if (refreshInput.type === 'callback') {
        activeCtx = refreshInput.ctx;
      }
      continue;
    }

    if (input.data.startsWith('backup:edit:')) {
      const key = input.data.slice('backup:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        const outcome = await editSetting(conversation, activeCtx, definition);
        if (outcome === 'cancel') return;
      }
    }
  }
}
