import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';

export async function adminWebAppSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = activeCtx.services?.translationService;
    if (!ts || !activeCtx.services) return;

    const enabled =
      ts.getSettingBool('webapp_enabled', false) && Boolean(activeCtx.services.webAppUrl);
    const webAppUrl = activeCtx.services.webAppUrl || ts.getSetting('webapp_url', '').trim();
    const port = activeCtx.services.webAppPort ?? 3002;
    const isRunning = activeCtx.services.isWebAppRunning
      ? activeCtx.services.isWebAppRunning()
      : Boolean(activeCtx.services.webAppUrl);

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '🌐',
      title: t(activeCtx, 'admin_webapp_title'),
      subtitle: t(activeCtx, 'admin_webapp_subtitle'),
      primary: {
        emoji: enabled ? '🟢' : '🔴',
        label: t(activeCtx, 'admin_webapp_status_label'),
        value: enabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '🔌',
          title: t(activeCtx, 'admin_webapp_status_label'),
          fields: [
            {
              label: t(activeCtx, 'admin_webapp_url_label'),
              value: webAppUrl
                ? `\`${escapeTelegramMarkdown(webAppUrl)}\``
                : t(activeCtx, 'admin_setting_not_configured'),
            },
            {
              label: t(activeCtx, 'admin_webapp_port_label'),
              value: `\`${port}\` (Fastify HTTP)`,
            },
            {
              label: t(activeCtx, 'admin_webapp_delivery_label'),
              value: isRunning ? '🟢 Running' : '⚪ Stopped',
            },
          ],
        },
        {
          emoji: '⚠️',
          title: t(activeCtx, 'admin_webapp_beta_notice_title'),
          fields: [
            {
              label: 'Status',
              value: t(activeCtx, 'admin_webapp_beta_notice'),
            },
          ],
        },
        {
          emoji: '📋',
          title: t(activeCtx, 'admin_webapp_guide_title'),
          fields: [
            {
              label: 'Reverse Proxy',
              value: t(activeCtx, 'admin_webapp_guide_desc', { port }),
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        enabled
          ? t(activeCtx, 'admin_webapp_toggle_disable')
          : t(activeCtx, 'admin_webapp_toggle_enable'),
        'webapp:toggle:enabled'
      )
      .row()
      .text(t(activeCtx, 'admin_webapp_edit_url'), 'webapp:edit:url')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_admin'), 'nav:admin');

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
      callbackPrefixes: ['webapp:toggle:', 'webapp:edit:'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'webapp:toggle:enabled') {
      if (enabled) {
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.disableWebApp?.();
        });
        await activeCtx.reply(t(activeCtx, 'admin_webapp_disabled_success'));
        continue;
      }

      if (!webAppUrl) {
        const promptKeyboard = new InlineKeyboard().text(
          t(activeCtx, 'admin_action_cancel'),
          'webapp:prompt:cancel'
        );
        await promptInConversation(
          conversation,
          activeCtx,
          t(activeCtx, 'admin_webapp_prompt_url', { port }),
          {
            parse_mode: 'Markdown',
            reply_markup: promptKeyboard,
          }
        );

        const urlInput = await waitForSettingsInput(conversation, {
          allowText: true,
          callbackPrefixes: ['webapp:prompt:'],
          retryKeyboard: promptKeyboard,
        });

        if (urlInput.type === 'cancel' || urlInput.type === 'back') break;
        if (urlInput.type === 'callback' && urlInput.data === 'webapp:prompt:cancel') {
          activeCtx = urlInput.ctx;
          continue;
        }

        if (urlInput.type === 'text') {
          activeCtx = urlInput.ctx;
          const candidateUrl = urlInput.value.trim();
          if (!candidateUrl.startsWith('https://')) {
            await activeCtx.reply(t(activeCtx, 'admin_webapp_invalid_url'));
            continue;
          }
          try {
            new URL(candidateUrl);
          } catch {
            await activeCtx.reply(t(activeCtx, 'admin_webapp_invalid_url'));
            continue;
          }

          let activationError: string | undefined;
          await conversation.external(async (outsideCtx) => {
            if (!outsideCtx.services?.enableWebApp) return;
            const res = await outsideCtx.services.enableWebApp(candidateUrl);
            if (!res.success) {
              activationError = res.error;
            }
          });

          if (activationError) {
            await activeCtx.reply(`❌ ${escapeTelegramMarkdown(activationError)}`);
          } else {
            await activeCtx.reply(t(activeCtx, 'admin_webapp_enabled_success'));
          }
        }
        continue;
      }

      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services?.enableWebApp) return;
        await outsideCtx.services.enableWebApp(webAppUrl);
      });
      continue;
    }

    if (input.data === 'webapp:edit:url') {
      const promptKeyboard = new InlineKeyboard().text(
        t(activeCtx, 'admin_action_cancel'),
        'webapp:prompt:cancel'
      );
      await promptInConversation(
        conversation,
        activeCtx,
        t(activeCtx, 'admin_webapp_prompt_url', { port }),
        {
          parse_mode: 'Markdown',
          reply_markup: promptKeyboard,
        }
      );

      const urlInput = await waitForSettingsInput(conversation, {
        allowText: true,
        callbackPrefixes: ['webapp:prompt:'],
        retryKeyboard: promptKeyboard,
      });

      if (urlInput.type === 'cancel' || urlInput.type === 'back') break;
      if (urlInput.type === 'callback' && urlInput.data === 'webapp:prompt:cancel') {
        activeCtx = urlInput.ctx;
        continue;
      }

      if (urlInput.type === 'text') {
        activeCtx = urlInput.ctx;
        const candidateUrl = urlInput.value.trim();
        if (!candidateUrl.startsWith('https://')) {
          await activeCtx.reply(t(activeCtx, 'admin_webapp_invalid_url'));
          continue;
        }
        try {
          new URL(candidateUrl);
        } catch {
          await activeCtx.reply(t(activeCtx, 'admin_webapp_invalid_url'));
          continue;
        }

        let activationError: string | undefined;
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services?.enableWebApp) return;
          const res = await outsideCtx.services.enableWebApp(candidateUrl);
          if (!res.success) {
            activationError = res.error;
          }
        });

        if (activationError) {
          await activeCtx.reply(`❌ ${escapeTelegramMarkdown(activationError)}`);
        } else {
          await activeCtx.reply(t(activeCtx, 'admin_webapp_updated_success'));
        }
      }
      continue;
    }
  }
}
