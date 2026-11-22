import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  cancelKeyboard,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminTextInput,
} from '../../ui.js';
import { parsePositiveSafeInteger, requireAdmin } from './shared.js';
import { validateRebeccaBaseUrl } from '../../../infra/rebeccaBaseUrl.js';

const MAX_SERVICE_ID = 2_147_483_647;

/** Add or safely edit a Rebecca panel without ever rendering stored secrets. */
export async function adminPanelConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const state = await conversation.external((outsideCtx) => ({
    action: outsideCtx.session.adminPanelAction,
    panelId: outsideCtx.session.adminPanelId,
  }));
  if (!state.action) return;

  const panelReturnKb = state.panelId
    ? new InlineKeyboard()
        .text(t(ctx, 'admin_panel_back_detail'), `a:p:v:${state.panelId}`)
        .text(t(ctx, 'admin_nav_root_short'), 'adm:home')
    : new InlineKeyboard()
        .text(t(ctx, 'admin_panel_back_list'), 'adm:pnl:p:1')
        .text(t(ctx, 'admin_nav_root_short'), 'adm:home');

  try {
    if (state.action === 'add') {
      const name = await askText(conversation, ctx, 'admin_panel_name_prompt', 80);
      if (!name) return;
      const baseUrl = await askPanelUrl(conversation, ctx);
      if (!baseUrl) return;
      const serviceId = await askServiceId(conversation, ctx);
      if (!serviceId) return;
      const serviceName = await askText(conversation, ctx, 'admin_panel_service_name_prompt', 80);
      if (!serviceName) return;
      // Secrets must not enter grammY Conversation replay state. Persist only
      // this non-secret draft, then let a one-shot regular message handler
      // encrypt the next API-key update immediately.
      await conversation.external((outsideCtx) => {
        outsideCtx.session.adminPanelDraft = {
          name,
          baseUrl,
          serviceId,
          serviceName,
        };
        outsideCtx.session.adminPanelAction = 'await_add_key';
        outsideCtx.session.adminPanelActionAt = Date.now();
      });
      await replyInAdminConversation(
        conversation,
        ctx,
        buildAdminPromptScreen(
          '🔐',
          t(ctx, 'admin_panel_api_key_title'),
          t(ctx, 'admin_panel_api_key_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          }
        ),
        { parse_mode: 'Markdown', reply_markup: panelReturnKb }
      );
      return;
    } else {
      if (!state.panelId) return;
      if (state.action === 'name') {
        const name = await askText(conversation, ctx, 'admin_panel_name_prompt', 80);
        if (!name) return;
        await conversation.external((outsideCtx) =>
          outsideCtx.services!.panelRegistry.updatePanel(state.panelId!, { name })
        );
      } else if (state.action === 'url') {
        const baseUrl = await askPanelUrl(conversation, ctx);
        if (!baseUrl) return;
        await conversation.external((outsideCtx) =>
          outsideCtx.services!.panelRegistry.updatePanel(state.panelId!, { baseUrl })
        );
      } else if (state.action === 'add_service') {
        const serviceId = await askServiceId(conversation, ctx);
        if (!serviceId) return;
        const name = await askText(conversation, ctx, 'admin_panel_service_name_prompt', 80);
        if (!name) return;
        await conversation.external((outsideCtx) =>
          outsideCtx.services!.panelRegistry.addService(state.panelId!, serviceId, name)
        );
      }
    }
    await conversation.external((outsideCtx) => {
      outsideCtx.session.adminPanelAction = undefined;
      outsideCtx.session.adminPanelId = undefined;
      outsideCtx.session.adminPanelDraft = undefined;
    });
    const successKb = state.panelId
      ? new InlineKeyboard()
          .text(t(ctx, 'admin_panel_test_button'), `a:p:t:${state.panelId}`)
          .text(t(ctx, 'admin_panel_back_detail'), `a:p:v:${state.panelId}`)
          .row()
          .text(t(ctx, 'admin_panel_back_list'), 'adm:pnl:p:1')
      : panelReturnKb;

    await replyInAdminConversation(
      conversation,
      ctx,
      buildAdminScreen({
        emoji: '✅',
        title: t(ctx, 'admin_panel_saved_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        subtitle: t(ctx, 'admin_panel_saved_subtitle'),
      }),
      { parse_mode: 'Markdown', reply_markup: successKb }
    );
  } catch {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_save_failed_title'),
        t(ctx, 'admin_panel_save_failed_subtitle'),
        { actionHint: t(ctx, 'admin_panel_save_failed') }
      ),
      { parse_mode: 'Markdown', reply_markup: panelReturnKb }
    );
  } finally {
    await conversation.external((outsideCtx) => {
      if (
        outsideCtx.session.adminPanelAction !== 'await_add_key' &&
        outsideCtx.session.adminPanelAction !== 'await_api_key'
      ) {
        outsideCtx.session.adminPanelAction = undefined;
        outsideCtx.session.adminPanelId = undefined;
        outsideCtx.session.adminPanelDraft = undefined;
      }
    });
  }
}

async function askPanelUrl(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<string | undefined> {
  let error: string | undefined;
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminPromptScreen(
        '🌐',
        t(ctx, 'admin_panel_detail_title'),
        t(ctx, 'admin_panel_url_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          error,
        }
      ),
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    try {
      return validateRebeccaBaseUrl(input.trim());
    } catch {
      error = t(ctx, 'admin_rebecca_url_invalid');
    }
  }
}

async function askText(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  maxLength: number
): Promise<string | undefined> {
  let error: string | undefined;
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminPromptScreen('✍️', t(ctx, 'admin_panel_detail_title'), t(ctx, promptKey), {
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        error,
      }),
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const value = input.trim();
    if (value && value.length <= maxLength) return value;
    error = t(ctx, 'admin_setting_invalid');
  }
}

async function askServiceId(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  let error: string | undefined;
  for (;;) {
    await promptInConversation(
      conversation,
      ctx,
      buildAdminPromptScreen(
        '🔢',
        t(ctx, 'admin_panel_detail_title'),
        t(ctx, 'admin_panel_service_id_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          error,
        }
      ),
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard(ctx) }
    );
    const input = await waitForAdminTextInput(conversation);
    if (input === undefined) return undefined;
    const value = parsePositiveSafeInteger(input);
    if (value && value <= MAX_SERVICE_ID) return value;
    error = t(ctx, 'admin_setting_invalid');
  }
}
