import type { ConversationContext, MyConversation } from '../../types.js';
import { t } from '../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
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
      });
      await replyInAdminConversation(
        conversation,
        ctx,
        buildPromptScreen(
          '🔐',
          t(ctx, 'admin_panel_api_key_title'),
          t(ctx, 'admin_panel_api_key_prompt'),
          t(ctx, 'admin_panel_api_key_subtitle')
        ),
        { parse_mode: 'Markdown' }
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
    await replyInAdminConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'admin_panel_saved_title'),
        subtitle: t(ctx, 'admin_panel_saved_subtitle'),
      }),
      { parse_mode: 'Markdown' }
    );
  } catch {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_save_failed_title'),
        t(ctx, 'admin_panel_save_failed_subtitle'),
        t(ctx, 'admin_panel_save_failed')
      ),
      { parse_mode: 'Markdown' }
    );
  } finally {
    // Cancellation, invalid input and failed edits must not leave a stale
    // action in the durable session. The API-key handoff is the sole state
    // intentionally retained after this conversation returns.
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
  const value = await askText(conversation, ctx, 'admin_panel_url_prompt', 500);
  if (!value) return undefined;
  try {
    return validateRebeccaBaseUrl(value);
  } catch {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_detail_title'),
        t(ctx, 'admin_rebecca_url_invalid')
      ),
      { parse_mode: 'Markdown' }
    );
    return undefined;
  }
}

async function askText(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  maxLength: number
): Promise<string | undefined> {
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '✍️',
      t(ctx, 'admin_panel_detail_title'),
      t(ctx, promptKey),
      t(ctx, 'admin_panel_registry_subtitle')
    ),
    { parse_mode: 'Markdown' }
  );
  const input = await waitForAdminTextInput(conversation);
  if (input === undefined) return undefined;
  const value = input.trim();
  if (!value || value.length > maxLength) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_panel_detail_title'), t(ctx, 'admin_setting_invalid')),
      { parse_mode: 'Markdown' }
    );
    return undefined;
  }
  return value;
}

async function askServiceId(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '🔢',
      t(ctx, 'admin_panel_detail_title'),
      t(ctx, 'admin_panel_service_id_prompt'),
      t(ctx, 'admin_panel_registry_subtitle')
    ),
    { parse_mode: 'Markdown' }
  );
  const input = await waitForAdminTextInput(conversation);
  if (input === undefined) return undefined;
  const value = parsePositiveSafeInteger(input);
  if (!value || value > MAX_SERVICE_ID) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_panel_detail_title'), t(ctx, 'admin_setting_invalid')),
      { parse_mode: 'Markdown' }
    );
    return undefined;
  }
  return value;
}
