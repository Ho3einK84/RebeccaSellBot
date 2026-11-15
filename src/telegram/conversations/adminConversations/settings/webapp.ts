import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t } from '../../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
} from '../../../ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import {
  checkDomainDns,
  getServerPublicIp,
  normalizeDomainInput,
  verifyDomainSslAndReachability,
} from '../../../../domain/services/domainVerification.js';

export interface WebAppSettingsViewState {
  enabled: boolean;
  webAppUrl: string;
  port: number;
  isRunning: boolean;
  serverIp: string;
}

/** Build the Web Mini App settings overview screen cleanly in both Persian and English. */
export function buildWebAppSettingsScreen(
  ctx: ConversationContext,
  state: WebAppSettingsViewState
): string {
  const { enabled, webAppUrl, port, isRunning, serverIp } = state;
  const onBadge = t(ctx, 'admin_overview_active');
  const offBadge = t(ctx, 'admin_overview_inactive');
  const formattedServerIp = `\`${sanitizeTelegramInlineCode(serverIp || 'SERVER_IP')}\``;

  const footerParts: string[] = [];
  if (!webAppUrl || !enabled) {
    footerParts.push(`⚡ ${t(ctx, 'admin_webapp_guide_desc', { serverIp: formattedServerIp })}`);
  }
  footerParts.push(`ℹ️ ${t(ctx, 'admin_home_hint')}`);

  return buildScreen({
    emoji: '🌐',
    title: t(ctx, 'admin_webapp_title'),
    subtitle: t(ctx, 'admin_webapp_subtitle'),
    primary: {
      emoji: enabled ? '🟢' : '🔴',
      label: t(ctx, 'admin_webapp_status_label'),
      value: enabled ? onBadge : offBadge,
    },
    sections: [
      {
        emoji: '🔌',
        title: t(ctx, 'admin_webapp_connection_title'),
        fields: [
          {
            label: t(ctx, 'admin_webapp_url_label'),
            value: webAppUrl
              ? `\`${sanitizeTelegramInlineCode(webAppUrl)}\``
              : t(ctx, 'admin_setting_not_configured'),
          },
          {
            label: t(ctx, 'admin_webapp_port_label'),
            value: `\`${sanitizeTelegramInlineCode(String(port))}\``,
          },
          {
            label: t(ctx, 'admin_webapp_server_state_label'),
            value: isRunning
              ? t(ctx, 'admin_webapp_server_running')
              : t(ctx, 'admin_webapp_server_stopped'),
          },
          ...(serverIp
            ? [
                {
                  label: t(ctx, 'admin_webapp_server_ip_label'),
                  value: `\`${sanitizeTelegramInlineCode(serverIp)}\``,
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_webapp_reverse_proxy_label'),
            value: t(ctx, 'admin_webapp_reverse_proxy_value'),
          },
        ],
      },
      {
        emoji: '✨',
        title: t(ctx, 'admin_webapp_capabilities_title'),
        fields: [
          {
            label: t(ctx, 'admin_webapp_capabilities_user_label'),
            value: t(ctx, 'admin_webapp_capabilities_user_value'),
          },
          {
            label: t(ctx, 'admin_webapp_capabilities_admin_label'),
            value: t(ctx, 'admin_webapp_capabilities_admin_value'),
          },
        ],
      },
    ],
    footer: footerParts.join('\n\n'),
  });
}

/** Build the Web Mini App settings keyboard with live preview & DNS diagnostics when available. */
export function buildWebAppSettingsKeyboard(
  ctx: ConversationContext,
  state: Pick<WebAppSettingsViewState, 'enabled' | 'webAppUrl'>
): InlineKeyboard {
  const { enabled, webAppUrl } = state;
  const keyboard = new InlineKeyboard();

  if (enabled && webAppUrl) {
    keyboard.webApp(t(ctx, 'admin_webapp_preview_button'), webAppUrl).row();
  }

  keyboard
    .text(
      enabled ? t(ctx, 'admin_webapp_toggle_disable') : t(ctx, 'admin_webapp_toggle_enable'),
      'webapp:toggle:enabled'
    )
    .row()
    .text(
      webAppUrl ? t(ctx, 'admin_webapp_change_url') : t(ctx, 'admin_webapp_edit_url'),
      'webapp:edit:url'
    );

  if (webAppUrl) {
    keyboard.row().text(t(ctx, 'admin_webapp_verify_dns_button'), 'webapp:check:dns');
  }

  keyboard.row().text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
  return keyboard;
}

export async function adminWebAppSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const ts = services?.translationService;
      if (!ts || !services) return undefined;
      return {
        enabled: ts.getSettingBool('webapp_enabled', false) && Boolean(services.webAppUrl),
        webAppUrl: services.webAppUrl || ts.getSetting('webapp_url', '').trim(),
        port: services.webAppHostPort ?? services.webAppPort ?? 3002,
        isRunning: services.isWebAppRunning
          ? services.isWebAppRunning()
          : Boolean(services.webAppUrl),
      };
    });
    if (!state) return;

    const serverIp = (await conversation.external(() => getServerPublicIp())) || '';
    const viewState: WebAppSettingsViewState = { ...state, serverIp };
    const screenText = buildWebAppSettingsScreen(activeCtx, viewState);
    const keyboard = buildWebAppSettingsKeyboard(activeCtx, viewState);

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['webapp:toggle:', 'webapp:edit:', 'webapp:check:'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'webapp:toggle:enabled') {
      if (state.enabled) {
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.disableWebApp?.();
        });
        await replyInAdminConversation(
          conversation,
          activeCtx,
          buildScreen({
            emoji: '🔴',
            title: t(activeCtx, 'admin_webapp_success_title'),
            footer: `✅ ${t(activeCtx, 'admin_webapp_disabled_success')}`,
          }),
          { parse_mode: 'Markdown', reply_markup: undefined }
        );
        continue;
      }

      if (!state.webAppUrl) {
        const configuredCtx = await handleDomainConfigurationFlow(
          conversation,
          activeCtx,
          state.port,
          serverIp
        );
        if (configuredCtx) {
          activeCtx = configuredCtx;
        }
        continue;
      }

      let activationRes:
        | { success: boolean; error?: string; sslActive?: boolean; normalizedUrl?: string }
        | undefined;
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services?.enableWebApp) return;
        activationRes = await outsideCtx.services.enableWebApp(state.webAppUrl);
      });
      if (activationRes && !activationRes.success) {
        await replyInAdminConversation(
          conversation,
          activeCtx,
          buildEmptyState(
            '❌',
            t(activeCtx, 'admin_webapp_error_title'),
            escapeTelegramMarkdown(activationRes.error || 'Activation failed')
          ),
          { parse_mode: 'Markdown', reply_markup: undefined }
        );
      } else if (activationRes?.success) {
        const safeUrl = sanitizeTelegramInlineCode(activationRes.normalizedUrl || state.webAppUrl);
        await replyInAdminConversation(
          conversation,
          activeCtx,
          buildScreen({
            emoji: '🟢',
            title: t(activeCtx, 'admin_webapp_success_title'),
            footer: activationRes.sslActive
              ? t(activeCtx, 'admin_webapp_enabled_success', { url: safeUrl })
              : t(activeCtx, 'admin_webapp_enabled_pending_ssl', { url: safeUrl }),
          }),
          { parse_mode: 'Markdown', reply_markup: undefined }
        );
      }
      continue;
    }

    if (input.data === 'webapp:edit:url') {
      const configuredCtx = await handleDomainConfigurationFlow(
        conversation,
        activeCtx,
        state.port,
        serverIp,
        true
      );
      if (configuredCtx) {
        activeCtx = configuredCtx;
      }
      continue;
    }

    if (input.data === 'webapp:check:dns' && state.webAppUrl) {
      await handleDomainDiagnosticsFlow(conversation, activeCtx, state.webAppUrl, serverIp);
    }
  }
}

async function handleDomainDiagnosticsFlow(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  webAppUrl: string,
  serverIp: string
): Promise<void> {
  const normalized = normalizeDomainInput(webAppUrl);
  if (!normalized.valid) {
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildEmptyState(
        '❌',
        t(activeCtx, 'admin_webapp_invalid_url_title'),
        t(activeCtx, 'admin_webapp_invalid_url')
      ),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
    return;
  }

  await replyInAdminConversation(
    conversation,
    activeCtx,
    buildScreen({
      emoji: '🔍',
      title: t(activeCtx, 'admin_webapp_dns_check_title'),
      footer: t(activeCtx, 'admin_webapp_checking_probe'),
    }),
    { parse_mode: 'Markdown', reply_markup: undefined }
  );

  const [dnsResult, sslProbe] = await conversation.external(() =>
    Promise.all([
      checkDomainDns(normalized.hostname, serverIp),
      verifyDomainSslAndReachability(normalized.url, 6000),
    ])
  );

  const dnsStatusValue = !dnsResult.resolved
    ? t(activeCtx, 'admin_webapp_dns_unresolved')
    : dnsResult.matchesServer || !serverIp
      ? t(activeCtx, 'admin_webapp_dns_match_ok')
      : t(activeCtx, 'admin_webapp_dns_match_mismatch');

  const sslStatusValue = sslProbe.ok
    ? t(activeCtx, 'admin_webapp_ssl_reachable')
    : t(activeCtx, 'admin_webapp_ssl_unreachable');

  const fields = [
    {
      label: t(activeCtx, 'admin_webapp_url_label'),
      value: `\`${sanitizeTelegramInlineCode(normalized.url)}\``,
    },
    {
      label: t(activeCtx, 'admin_webapp_dns_status_label'),
      value: dnsStatusValue,
    },
    ...(dnsResult.ips.length > 0
      ? [
          {
            label: t(activeCtx, 'admin_webapp_dns_ips_label'),
            value: `\`${sanitizeTelegramInlineCode(dnsResult.ips.join(', '))}\``,
          },
        ]
      : []),
    ...(serverIp
      ? [
          {
            label: t(activeCtx, 'admin_webapp_server_ip_label'),
            value: `\`${sanitizeTelegramInlineCode(serverIp)}\``,
          },
        ]
      : []),
    {
      label: t(activeCtx, 'admin_webapp_ssl_status_label'),
      value: sslStatusValue,
    },
    ...(!sslProbe.ok && sslProbe.error
      ? [
          {
            label: t(activeCtx, 'admin_webapp_ssl_error_note'),
            value: escapeTelegramMarkdown(sslProbe.error),
          },
        ]
      : []),
  ];

  await replyInAdminConversation(
    conversation,
    activeCtx,
    buildScreen({
      emoji: sslProbe.ok ? '✅' : '⚠️',
      title: t(activeCtx, 'admin_webapp_dns_check_title'),
      sections: [
        {
          emoji: '🌐',
          title: t(activeCtx, 'admin_webapp_connection_title'),
          fields,
        },
      ],
    }),
    { parse_mode: 'Markdown', reply_markup: undefined }
  );
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
  const safeServerIp = sanitizeTelegramInlineCode(serverIp || 'SERVER_IP');

  await promptInConversation(
    conversation,
    activeCtx,
    buildPromptScreen(
      '🌐',
      t(activeCtx, 'admin_webapp_prompt_title'),
      t(activeCtx, 'admin_webapp_prompt_url', { port, serverIp: safeServerIp }),
      t(activeCtx, 'admin_webapp_prompt_subtitle')
    ),
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
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildEmptyState(
        '❌',
        t(activeCtx, 'admin_webapp_invalid_url_title'),
        t(activeCtx, 'admin_webapp_invalid_url')
      ),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
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
      buildScreen({
        emoji: '⚠️',
        title: t(activeCtx, 'admin_webapp_dns_warning_title'),
        footer: t(activeCtx, 'admin_webapp_dns_mismatch_warning', {
          domain: sanitizeTelegramInlineCode(normalized.hostname),
          resolvedIp: sanitizeTelegramInlineCode(dnsResult.ips.join(', ') || 'N/A'),
          serverIp: sanitizeTelegramInlineCode(serverIp),
        }),
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
  await replyInAdminConversation(
    conversation,
    activeCtx,
    buildScreen({
      emoji: '⏳',
      title: t(activeCtx, 'admin_webapp_title'),
      footer: t(activeCtx, 'admin_webapp_activating_probe'),
    }),
    { parse_mode: 'Markdown', reply_markup: undefined }
  );

  let activationRes:
    { success: boolean; error?: string; sslActive?: boolean; normalizedUrl?: string } | undefined;

  await conversation.external(async (outsideCtx) => {
    if (!outsideCtx.services?.enableWebApp) return;
    activationRes = await outsideCtx.services.enableWebApp(normalized.url);
  });

  const safeUrl = sanitizeTelegramInlineCode(normalized.url);

  if (!activationRes?.success) {
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildEmptyState(
        '❌',
        t(activeCtx, 'admin_webapp_error_title'),
        escapeTelegramMarkdown(activationRes?.error || 'Activation failed')
      ),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
  } else if (isEdit && activationRes.sslActive) {
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildScreen({
        emoji: '✅',
        title: t(activeCtx, 'admin_webapp_success_title'),
        footer: t(activeCtx, 'admin_webapp_updated_success', { url: safeUrl }),
      }),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
  } else if (activationRes.sslActive) {
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildScreen({
        emoji: '✅',
        title: t(activeCtx, 'admin_webapp_success_title'),
        footer: t(activeCtx, 'admin_webapp_enabled_success', { url: safeUrl }),
      }),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
  } else {
    await replyInAdminConversation(
      conversation,
      activeCtx,
      buildScreen({
        emoji: '✅',
        title: t(activeCtx, 'admin_webapp_success_title'),
        footer: t(activeCtx, 'admin_webapp_enabled_pending_ssl', { url: safeUrl }),
      }),
      { parse_mode: 'Markdown', reply_markup: undefined }
    );
  }

  return activeCtx;
}
