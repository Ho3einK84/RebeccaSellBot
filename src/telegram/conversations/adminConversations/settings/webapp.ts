import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import {
  normalizeDomainInput,
  getServerPublicIp,
  checkDomainDns,
} from '../../../../domain/services/domainVerification.js';

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
    const port = activeCtx.services.webAppHostPort ?? activeCtx.services.webAppPort ?? 3002;
    const isRunning = activeCtx.services.isWebAppRunning
      ? activeCtx.services.isWebAppRunning()
      : Boolean(activeCtx.services.webAppUrl);

    const serverIp = (await conversation.external(() => getServerPublicIp())) || '';

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
              value: `\`${port}\` (Reverse Proxy Port)`,
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
          emoji: '⚡',
          title: t(activeCtx, 'admin_webapp_guide_title'),
          fields: [
            ...(serverIp
              ? [
                  {
                    label: t(activeCtx, 'admin_webapp_server_ip_label'),
                    value: `\`${serverIp}\``,
                  },
                ]
              : []),
            {
              label: t(activeCtx, 'admin_webapp_reverse_proxy_label'),
              value: t(activeCtx, 'admin_webapp_reverse_proxy_value'),
            },
            {
              label: 'Reverse Proxy',
              value: t(activeCtx, 'admin_webapp_guide_desc', {
                port,
                serverIp: serverIp || 'YOUR_SERVER_IP',
              }),
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
        const configuredCtx = await handleDomainConfigurationFlow(
          conversation,
          activeCtx,
          port,
          serverIp
        );
        if (configuredCtx) {
          activeCtx = configuredCtx;
        }
        continue;
      }

      let activationError: string | undefined;
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services?.enableWebApp) return;
        const res = await outsideCtx.services.enableWebApp(webAppUrl);
        if (!res.success) {
          activationError = res.error;
        }
      });
      if (activationError) {
        await activeCtx.reply(`❌ ${escapeTelegramMarkdown(activationError)}`);
      }
      continue;
    }

    if (input.data === 'webapp:edit:url') {
      const configuredCtx = await handleDomainConfigurationFlow(
        conversation,
        activeCtx,
        port,
        serverIp,
        true
      );
      if (configuredCtx) {
        activeCtx = configuredCtx;
      }
      continue;
    }
  }
}

async function handleDomainConfigurationFlow(
  conversation: MyConversation,
  initialCtx: ConversationContext,
  port: number,
  serverIp: string,
  isEdit = false
): Promise<ConversationContext | null> {
  let activeCtx = initialCtx;

  const promptKeyboard = new InlineKeyboard().text(
    t(activeCtx, 'menu_cancel'),
    'webapp:prompt:cancel'
  );
  await promptInConversation(
    conversation,
    activeCtx,
    t(activeCtx, 'admin_webapp_prompt_url', { port, serverIp: serverIp || 'YOUR_SERVER_IP' }),
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

  if (urlInput.type === 'cancel' || urlInput.type === 'back') return null;
  if (urlInput.type === 'callback' && urlInput.data === 'webapp:prompt:cancel') {
    return urlInput.ctx;
  }

  if (urlInput.type !== 'text') {
    return null;
  }

  activeCtx = urlInput.ctx;
  const rawInput = urlInput.value.trim();
  const normalized = normalizeDomainInput(rawInput);

  if (!normalized.valid) {
    await activeCtx.reply(t(activeCtx, 'admin_webapp_invalid_url'));
    return activeCtx;
  }

  // Pre-flight DNS check
  const dnsResult = await conversation.external(() =>
    checkDomainDns(normalized.hostname, serverIp)
  );

  if (dnsResult.resolved && !dnsResult.matchesServer && serverIp) {
    const dnsWarningKeyboard = new InlineKeyboard()
      .text(t(activeCtx, 'admin_webapp_dns_btn_proceed'), 'webapp:dns:proceed')
      .row()
      .text(t(activeCtx, 'admin_webapp_dns_btn_cancel'), 'webapp:dns:cancel');

    await promptInConversation(
      conversation,
      activeCtx,
      t(activeCtx, 'admin_webapp_dns_mismatch_warning', {
        domain: normalized.hostname,
        resolvedIp: dnsResult.ips.join(', ') || 'N/A',
        serverIp,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: dnsWarningKeyboard,
      }
    );

    const dnsChoice = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['webapp:dns:'],
      retryKeyboard: dnsWarningKeyboard,
    });

    if (dnsChoice.type === 'cancel' || dnsChoice.type === 'back') return null;
    if (dnsChoice.type === 'callback') {
      activeCtx = dnsChoice.ctx;
      if (dnsChoice.data === 'webapp:dns:cancel') {
        return activeCtx;
      }
    }
  }

  // Notify admin that verification probe & automated SSL activation is starting
  await activeCtx.reply(t(activeCtx, 'admin_webapp_activating_probe'));

  let activationRes:
    { success: boolean; error?: string; sslActive?: boolean; normalizedUrl?: string } | undefined;

  await conversation.external(async (outsideCtx) => {
    if (!outsideCtx.services?.enableWebApp) return;
    activationRes = await outsideCtx.services.enableWebApp(normalized.url);
  });

  if (!activationRes?.success) {
    await activeCtx.reply(
      `❌ ${escapeTelegramMarkdown(activationRes?.error || 'Activation failed')}`
    );
  } else if (isEdit) {
    await activeCtx.reply(t(activeCtx, 'admin_webapp_updated_success', { url: normalized.url }));
  } else if (activationRes.sslActive) {
    await activeCtx.reply(t(activeCtx, 'admin_webapp_enabled_success', { url: normalized.url }));
  } else {
    await activeCtx.reply(
      t(activeCtx, 'admin_webapp_enabled_pending_ssl', { url: normalized.url })
    );
  }

  return activeCtx;
}
