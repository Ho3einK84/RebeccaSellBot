import { InlineKeyboard } from 'grammy';
import {
  FORCED_JOIN_SCOPES,
  ForcedJoinError,
  MAX_FORCED_JOIN_CHANNELS,
  normalizeForcedJoinChannelId,
  normalizeForcedJoinInviteLink,
  normalizeForcedJoinTitle,
  type ForcedJoinAccessTestResult,
  type ForcedJoinScope,
} from '../../domain/services/ForcedJoinService.js';
import { localizedNumber, t } from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import type { MenuContext } from '../types.js';
import {
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  type AdminScreenNotice,
} from '../ui.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from './adminInput.js';
import { appendAdminFooterNav, buildAdminConfirmKeyboard, markAdminContext } from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';

interface ForcedJoinDraft {
  kind: 'fj_add';
  channelId?: string;
  title?: string;
  inviteLink?: string;
  lastTest?: ForcedJoinAccessTestResult;
}

function getScopeLabel(ctx: MenuContext, scope: ForcedJoinScope): string {
  switch (scope) {
    case 'all':
      return t(ctx, 'admin_fj_scope_all');
    case 'trial_only':
      return t(ctx, 'admin_fj_scope_trial_only');
    case 'purchase_and_trial':
      return t(ctx, 'admin_fj_scope_purchase_and_trial');
    case 'off':
    default:
      return t(ctx, 'admin_fj_scope_off');
  }
}

function formatAccessTestNotice(
  ctx: MenuContext,
  res: ForcedJoinAccessTestResult
): AdminScreenNotice {
  if (res.ok) {
    return {
      tone: 'success',
      text: t(ctx, 'admin_fj_test_ok'),
    };
  }
  return {
    tone: 'warning',
    text: t(ctx, 'admin_fj_test_failed', {
      reason: res.errorMessage ?? res.errorCode ?? 'error',
    }),
  };
}

export async function renderForcedJoinHubScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const service = ctx.services.forcedJoinService;
  const scope = service?.getScope() ?? 'off';
  const channels = service?.listChannels() ?? [];
  const activeCount = channels.filter((c) => c.enabled).length;

  const text = buildAdminScreen({
    emoji: '📢',
    title: t(ctx, 'admin_fj_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_fj_title')
    ),
    subtitle: t(ctx, 'admin_fj_subtitle'),
    notice,
    primary: {
      emoji: scope === 'off' ? '⚪️' : '🟢',
      label: t(ctx, 'admin_fj_scope_label'),
      value: getScopeLabel(ctx, scope),
      inline: true,
    },
    sections: [
      {
        emoji: '📋',
        title: t(ctx, 'admin_fj_channels_section'),
        fields:
          channels.length > 0
            ? channels.map((ch) => ({
                emoji: ch.enabled ? '🟢' : '⚪️',
                label: escapeTelegramMarkdown(ch.title),
                value: `\`${sanitizeTelegramInlineCode(ch.channelId)}\``,
              }))
            : [{ value: t(ctx, 'admin_fj_empty') }],
      },
      {
        fields: [
          {
            label: t(ctx, 'admin_fj_active_count_label'),
            value: `${localizedNumber(activeCount, ctx)} / ${localizedNumber(channels.length, ctx)}`,
          },
        ],
      },
    ],
    footer:
      scope !== 'off' && activeCount === 0
        ? t(ctx, 'admin_fj_no_active_channels_warning')
        : t(ctx, 'admin_fj_fail_safe_hint'),
  });

  const kb = new InlineKeyboard();
  // Scope selector (2x2 grid)
  kb.text(`${scope === 'off' ? '✅ ' : ''}${t(ctx, 'admin_fj_scope_off')}`, 'adm:fj:sc:off')
    .text(`${scope === 'all' ? '✅ ' : ''}${t(ctx, 'admin_fj_scope_all')}`, 'adm:fj:sc:all')
    .row()
    .text(
      `${scope === 'trial_only' ? '✅ ' : ''}${t(ctx, 'admin_fj_scope_trial_only')}`,
      'adm:fj:sc:trial_only'
    )
    .text(
      `${scope === 'purchase_and_trial' ? '✅ ' : ''}${t(ctx, 'admin_fj_scope_purchase_and_trial')}`,
      'adm:fj:sc:purchase_and_trial'
    )
    .row();

  for (const ch of channels) {
    const icon = ch.enabled ? '🟢' : '⚪️';
    kb.text(`${icon} ${ch.title} (${ch.channelId})`.slice(0, 60), `adm:fj:v:${ch.id}`).row();
  }

  kb.text(t(ctx, 'admin_fj_add_button'), 'adm:fj:add').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderForcedJoinChannelDetailScreen(
  ctx: MenuContext,
  channelIdKey: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.forcedJoinService) return;
  markAdminContext(ctx);
  const ch = ctx.services.forcedJoinService.listChannels().find((c) => c.id === channelIdKey);
  if (!ch) {
    await renderForcedJoinHubScreen(ctx, {
      tone: 'warning',
      text: t(ctx, 'admin_fj_not_found'),
    });
    return;
  }

  const text = buildAdminScreen({
    emoji: '📢',
    title: escapeTelegramMarkdown(ch.title),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_fj_title'),
      ch.channelId
    ),
    notice,
    primary: {
      emoji: ch.enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_panel_status_label'),
      value: buildStatusBadge(ctx, ch.enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_fj_channel_id_label'),
            value: `\`${sanitizeTelegramInlineCode(ch.channelId)}\``,
          },
          {
            label: t(ctx, 'admin_fj_channel_title_label'),
            value: escapeTelegramMarkdown(ch.title),
          },
          {
            label: t(ctx, 'admin_fj_invite_link_label'),
            value: `\`${sanitizeTelegramInlineCode(ch.inviteLink)}\``,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_fj_test_button'), `adm:fj:tst:${ch.id}`)
    .text(
      ch.enabled ? t(ctx, 'admin_fj_disable_button') : t(ctx, 'admin_fj_enable_button'),
      `adm:fj:tg:${ch.id}`
    )
    .row()
    .text(t(ctx, 'admin_fj_edit_title_button'), `adm:fj:ed:t:${ch.id}`)
    .text(t(ctx, 'admin_fj_edit_link_button'), `adm:fj:ed:l:${ch.id}`)
    .row()
    .text(t(ctx, 'admin_fj_delete_button'), `adm:fj:del:${ch.id}`)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:fj',
    backLabel: t(ctx, 'admin_fj_back_hub'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function renderForcedJoinAddDraftScreen(
  ctx: MenuContext,
  draft: ForcedJoinDraft,
  notice?: AdminScreenNotice
): Promise<void> {
  const canSave = Boolean(draft.channelId && draft.title && draft.inviteLink);
  const testResult = draft.lastTest;
  const testStatusText = testResult
    ? testResult.ok
      ? t(ctx, 'admin_fj_test_status_ok')
      : t(ctx, 'admin_fj_test_status_warn', {
          reason: testResult.errorMessage ?? testResult.errorCode ?? 'error',
        })
    : '—';

  const text = buildAdminScreen({
    emoji: '➕',
    title: t(ctx, 'admin_fj_add_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_fj_title'), t(ctx, 'admin_fj_add_title')),
    notice,
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_fj_channel_id_label'),
            value: draft.channelId ? `\`${sanitizeTelegramInlineCode(draft.channelId)}\`` : '—',
          },
          {
            label: t(ctx, 'admin_fj_channel_title_label'),
            value: draft.title ? escapeTelegramMarkdown(draft.title) : '—',
          },
          {
            label: t(ctx, 'admin_fj_invite_link_label'),
            value: draft.inviteLink ? `\`${sanitizeTelegramInlineCode(draft.inviteLink)}\`` : '—',
          },
          {
            label: t(ctx, 'admin_fj_access_check_label'),
            value: escapeTelegramMarkdown(testStatusText),
          },
        ],
      },
    ],
    footer: canSave
      ? t(ctx, 'admin_fj_draft_ready_hint')
      : t(ctx, 'admin_fj_draft_incomplete_hint'),
  });

  const kb = new InlineKeyboard();
  if (draft.channelId) {
    kb.text(t(ctx, 'admin_fj_test_button'), 'adm:fj:dr:tst').row();
  }
  kb.text(t(ctx, 'admin_fj_edit_title_button'), 'adm:fj:dr:t')
    .text(t(ctx, 'admin_fj_edit_link_button'), 'adm:fj:dr:l')
    .row();
  if (canSave) {
    kb.text(t(ctx, 'admin_fj_save_channel_button'), 'adm:fj:dr:save').row();
  }
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:fj',
    backLabel: t(ctx, 'admin_fj_back_hub'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export function registerAdminForcedJoinRoutes(): void {
  registerAdminRoute('adm:cfg:fj', async (ctx, _match, notice) => {
    await renderForcedJoinHubScreen(ctx, notice);
  });

  registerAdminRoute(/^adm:fj:sc:(off|all|trial_only|purchase_and_trial)$/u, async (ctx, match) => {
    const service = ctx.services?.forcedJoinService;
    const scope = match?.[1] as ForcedJoinScope | undefined;
    if (!service || !scope || !FORCED_JOIN_SCOPES.includes(scope)) return;
    await service.setScope(scope);
    if (ctx.from?.id) {
      await ctx.services?.userService?.recordAdminAction?.({
        actorTelegramId: ctx.from.id,
        action: 'forced_join_scope_updated',
        entityType: 'forced_join',
        entityId: 'scope',
        metadata: { scope },
      });
    }
    await renderForcedJoinHubScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:fj:v:([a-zA-Z0-9_]+)$/u, async (ctx, match, notice) => {
    await renderForcedJoinChannelDetailScreen(ctx, match![1]!, notice);
  });

  registerAdminRoute(/^adm:fj:tg:([a-zA-Z0-9_]+)$/u, async (ctx, match) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return;
    const id = match![1]!;
    try {
      await service.toggleChannel(id);
      await renderForcedJoinChannelDetailScreen(ctx, id, {
        tone: 'success',
        text: t(ctx, 'admin_setting_saved_title'),
      });
    } catch {
      await renderForcedJoinHubScreen(ctx, {
        tone: 'warning',
        text: t(ctx, 'admin_fj_not_found'),
      });
    }
  });

  registerAdminRoute(/^adm:fj:tst:([a-zA-Z0-9_]+)$/u, async (ctx, match) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return;
    const id = match![1]!;
    const ch = service.listChannels().find((c) => c.id === id);
    if (!ch) {
      await renderForcedJoinHubScreen(ctx, { tone: 'warning', text: t(ctx, 'admin_fj_not_found') });
      return;
    }
    const result = await service.testChannelAccess(ch.channelId);
    await renderForcedJoinChannelDetailScreen(ctx, id, formatAccessTestNotice(ctx, result));
  });

  registerAdminRoute(/^adm:fj:del:([a-zA-Z0-9_]+)$/u, async (ctx, match) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return;
    const id = match![1]!;
    const ch = service.listChannels().find((c) => c.id === id);
    if (!ch) {
      await renderForcedJoinHubScreen(ctx, { tone: 'warning', text: t(ctx, 'admin_fj_not_found') });
      return;
    }
    const text = buildAdminScreen({
      emoji: '🗑️',
      title: t(ctx, 'admin_fj_delete_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_fj_title'), t(ctx, 'admin_fj_delete_title')),
      footer: t(ctx, 'admin_fj_delete_confirm', { name: escapeTelegramMarkdown(ch.title) }),
    });
    await renderScreen(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: buildAdminConfirmKeyboard(ctx, {
        confirmCallback: `adm:fj:dok:${ch.id}`,
        cancelCallback: `adm:fj:v:${ch.id}`,
        confirmLabel: t(ctx, 'admin_fj_delete_button'),
      }),
    });
  });

  registerAdminRoute(/^adm:fj:dok:([a-zA-Z0-9_]+)$/u, async (ctx, match) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return;
    const deleted = await service.deleteChannel(match![1]!);
    await renderForcedJoinHubScreen(ctx, {
      tone: deleted ? 'success' : 'warning',
      text: t(ctx, deleted ? 'admin_fj_deleted' : 'admin_fj_not_found'),
    });
  });

  registerAdminRoute(/^adm:fj:ed:(t|l):([a-zA-Z0-9_]+)$/u, async (ctx, match) => {
    const field = match![1]!;
    const id = match![2]!;
    await startAdminInput(ctx, {
      kind: 'fj:edit:field',
      payload: { field, id },
      returnRoute: `adm:fj:v:${id}`,
      promptText: buildAdminPromptScreen({
        emoji: field === 't' ? '🏷️' : '🔗',
        title:
          field === 't'
            ? t(ctx, 'admin_fj_edit_title_button')
            : t(ctx, 'admin_fj_edit_link_button'),
        body:
          field === 't' ? t(ctx, 'admin_fj_prompt_title') : t(ctx, 'admin_fj_prompt_invite_link'),
      }),
    });
  });

  registerAdminInputHandler('fj:edit:field', async (ctx, rawText, state) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return { status: 'done', redirectRoute: 'adm:cfg:fj' };
    const field = String(state.payload?.field ?? 't');
    const id = String(state.payload?.id ?? '');

    if (field === 't') {
      const title = normalizeForcedJoinTitle(rawText);
      if (!title) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '🏷️',
            title: t(ctx, 'admin_fj_edit_title_button'),
            body: t(ctx, 'admin_fj_prompt_title'),
            error: t(ctx, 'admin_fj_invalid_title'),
          }),
        };
      }
      await service.updateChannel(id, { title });
    } else {
      const ch = service.listChannels().find((c) => c.id === id);
      const inviteLink = normalizeForcedJoinInviteLink(rawText, ch?.channelId);
      if (!inviteLink) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '🔗',
            title: t(ctx, 'admin_fj_edit_link_button'),
            body: t(ctx, 'admin_fj_prompt_invite_link'),
            error: t(ctx, 'admin_fj_invalid_link'),
          }),
        };
      }
      await service.updateChannel(id, { inviteLink });
    }

    return {
      status: 'done',
      redirectRoute: `adm:fj:v:${id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // ── Add Channel Draft Flow ─────────────────────────────────────────────────

  registerAdminRoute('adm:fj:add', async (ctx) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return;
    if (service.listChannels().length >= MAX_FORCED_JOIN_CHANNELS) {
      await renderForcedJoinHubScreen(ctx, {
        tone: 'warning',
        text: t(ctx, 'admin_fj_limit_reached', {
          count: localizedNumber(MAX_FORCED_JOIN_CHANNELS, ctx),
        }),
      });
      return;
    }
    if (ctx.session) {
      ctx.session.adminDraft = { kind: 'fj_add' } satisfies ForcedJoinDraft;
    }
    await startAdminInput(ctx, {
      kind: 'fj:add:channel',
      returnRoute: 'adm:cfg:fj',
      promptText: buildAdminPromptScreen({
        emoji: '📢',
        title: t(ctx, 'admin_fj_add_title'),
        body: t(ctx, 'admin_fj_prompt_channel_id'),
      }),
    });
  });

  registerAdminInputHandler('fj:add:channel', async (ctx, rawText) => {
    const service = ctx.services?.forcedJoinService;
    if (!service) return { status: 'done', redirectRoute: 'adm:cfg:fj' };

    const channelId = normalizeForcedJoinChannelId(rawText);
    if (!channelId) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '📢',
          title: t(ctx, 'admin_fj_add_title'),
          body: t(ctx, 'admin_fj_prompt_channel_id'),
          error: t(ctx, 'admin_fj_invalid_channel_id'),
        }),
      };
    }

    const exists = service
      .listChannels()
      .some((c) => c.channelId.toLowerCase() === channelId.toLowerCase());
    if (exists) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '📢',
          title: t(ctx, 'admin_fj_add_title'),
          body: t(ctx, 'admin_fj_prompt_channel_id'),
          error: t(ctx, 'admin_fj_duplicate_channel'),
        }),
      };
    }

    const testResult = await service.testChannelAccess(channelId);
    const detectedTitle = testResult.chatTitle
      ? (normalizeForcedJoinTitle(testResult.chatTitle) ?? undefined)
      : undefined;
    const detectedLink =
      normalizeForcedJoinInviteLink(testResult.inviteLink, channelId) ?? undefined;

    const draft: ForcedJoinDraft = {
      kind: 'fj_add',
      channelId,
      ...(detectedTitle ? { title: detectedTitle } : {}),
      ...(detectedLink ? { inviteLink: detectedLink } : {}),
      lastTest: testResult,
    };
    if (ctx.session) {
      ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    }
    await renderForcedJoinAddDraftScreen(ctx, draft, formatAccessTestNotice(ctx, testResult));
    return { status: 'handled' };
  });

  registerAdminRoute('adm:fj:dr:tst', async (ctx) => {
    const service = ctx.services?.forcedJoinService;
    const draft = ctx.session?.adminDraft as ForcedJoinDraft | undefined;
    if (!service || !draft?.channelId) {
      await renderForcedJoinHubScreen(ctx);
      return;
    }
    const result = await service.testChannelAccess(draft.channelId);
    draft.lastTest = result;
    if (!draft.title && result.chatTitle) {
      draft.title = normalizeForcedJoinTitle(result.chatTitle) ?? undefined;
    }
    if (!draft.inviteLink && result.inviteLink) {
      draft.inviteLink =
        normalizeForcedJoinInviteLink(result.inviteLink, draft.channelId) ?? undefined;
    }
    await renderForcedJoinAddDraftScreen(ctx, draft, formatAccessTestNotice(ctx, result));
  });

  registerAdminRoute('adm:fj:dr:t', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'fj:add:draft_field',
      payload: { field: 'title' },
      returnRoute: 'adm:fj:dr:view',
      promptText: buildAdminPromptScreen({
        emoji: '🏷️',
        title: t(ctx, 'admin_fj_channel_title_label'),
        body: t(ctx, 'admin_fj_prompt_title'),
      }),
      keyboard: adminInputCancelKeyboard(ctx),
    });
  });

  registerAdminRoute('adm:fj:dr:l', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'fj:add:draft_field',
      payload: { field: 'link' },
      returnRoute: 'adm:fj:dr:view',
      promptText: buildAdminPromptScreen({
        emoji: '🔗',
        title: t(ctx, 'admin_fj_invite_link_label'),
        body: t(ctx, 'admin_fj_prompt_invite_link'),
      }),
      keyboard: adminInputCancelKeyboard(ctx),
    });
  });

  registerAdminRoute('adm:fj:dr:view', async (ctx, _match, notice) => {
    const draft = ctx.session?.adminDraft as ForcedJoinDraft | undefined;
    if (!draft || draft.kind !== 'fj_add') {
      await renderForcedJoinHubScreen(ctx, notice);
      return;
    }
    await renderForcedJoinAddDraftScreen(ctx, draft, notice);
  });

  registerAdminInputHandler('fj:add:draft_field', async (ctx, rawText, state) => {
    const draft = ctx.session?.adminDraft as ForcedJoinDraft | undefined;
    if (!draft || draft.kind !== 'fj_add') {
      return { status: 'done', redirectRoute: 'adm:cfg:fj' };
    }
    const field = String(state.payload?.field ?? 'title');
    if (field === 'title') {
      const title = normalizeForcedJoinTitle(rawText);
      if (!title) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '🏷️',
            title: t(ctx, 'admin_fj_channel_title_label'),
            body: t(ctx, 'admin_fj_prompt_title'),
            error: t(ctx, 'admin_fj_invalid_title'),
          }),
        };
      }
      draft.title = title;
    } else {
      const link = normalizeForcedJoinInviteLink(rawText, draft.channelId);
      if (!link) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '🔗',
            title: t(ctx, 'admin_fj_invite_link_label'),
            body: t(ctx, 'admin_fj_prompt_invite_link'),
            error: t(ctx, 'admin_fj_invalid_link'),
          }),
        };
      }
      draft.inviteLink = link;
    }
    return { status: 'done', redirectRoute: 'adm:fj:dr:view' };
  });

  registerAdminRoute('adm:fj:dr:save', async (ctx) => {
    const service = ctx.services?.forcedJoinService;
    const draft = ctx.session?.adminDraft as ForcedJoinDraft | undefined;
    if (!service || !draft?.channelId || !draft.title || !draft.inviteLink) {
      await renderForcedJoinHubScreen(ctx);
      return;
    }
    try {
      const created = await service.addChannel({
        channelId: draft.channelId,
        title: draft.title,
        inviteLink: draft.inviteLink,
        enabled: true,
      });
      if (ctx.session) delete ctx.session.adminDraft;
      await renderForcedJoinChannelDetailScreen(ctx, created.id, {
        tone: 'success',
        text: t(ctx, 'admin_fj_added_success'),
      });
    } catch (err) {
      const msgKey =
        err instanceof ForcedJoinError && err.code === 'DUPLICATE_CHANNEL'
          ? 'admin_fj_duplicate_channel'
          : 'operation_failed';
      await renderForcedJoinAddDraftScreen(ctx, draft, {
        tone: 'error',
        text: t(ctx, msgKey),
      });
    }
  });
}
