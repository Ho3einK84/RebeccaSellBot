import { InlineKeyboard, type Bot } from 'grammy';
import {
  RebeccaPanelInUseError,
  type RebeccaPanelSummary,
} from '../../../domain/services/RebeccaPanelRegistry.js';
import type { MenuContext } from '../../types.js';
import { callbackData } from '../../callbackData.js';
import { localizedNumber, t } from '../../locale.js';
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  deleteConsumedInputMessage,
  renderScreen,
} from '../../ui.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

const PANEL_ID_CAPTURE = '([a-z0-9_-]{3,40})';
const PANEL_PAGE_SIZE = 7;
const PANEL_SERVICE_PAGE_SIZE = 4;
type PanelEditAction = 'name' | 'url' | 'api_key' | 'add_service';
type PanelServiceAction = 'default' | 'custom';
const COMPACT_PANEL_EDIT_ACTIONS: Record<string, PanelEditAction> = {
  n: 'name',
  u: 'url',
  k: 'api_key',
  s: 'add_service',
};

export function panelCallback(...parts: Array<string | number>): string {
  return callbackData('a', 'p', ...parts);
}

export async function renderPanelRegistry(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const panels = ctx.services.panelRegistry.listPanels();
  const totalPages = Math.max(1, Math.ceil(panels.length / PANEL_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  const pagePanels = panels.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE);
  const keyboard = new InlineKeyboard();
  for (const panel of pagePanels) {
    keyboard
      .text(
        `${panel.isDefault ? '⭐ ' : ''}${panel.enabled ? '🟢' : '⚪️'} ${panel.name}`,
        panelCallback('v', panel.id)
      )
      .row();
  }
  if (totalPages > 1) {
    if (page > 1) keyboard.text(t(ctx, 'pagination_previous'), panelCallback('page', page - 1));
    keyboard.text(`${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`, 'ui:noop');
    if (page < totalPages)
      keyboard.text(t(ctx, 'pagination_next'), panelCallback('page', page + 1));
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_add_button'), panelCallback('add'))
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
  await renderPanelScreen(
    ctx,
    panels.length
      ? buildScreen({
          emoji: '🖥️',
          title: t(ctx, 'admin_panel_registry_title'),
          subtitle: t(ctx, 'admin_panel_registry_subtitle'),
          primary: {
            emoji: '🖥️',
            label: t(ctx, 'admin_panel_registry_total_label'),
            value: localizedNumber(panels.length, ctx),
          },
          footer:
            totalPages > 1
              ? `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`
              : undefined,
        })
      : buildEmptyState(
          '🖥️',
          t(ctx, 'admin_panel_registry_empty_title'),
          t(ctx, 'admin_panel_registry_empty_subtitle')
        ),
    keyboard,
    'Markdown'
  );
}

async function renderPanelDetail(
  ctx: MenuContext,
  panelId: string,
  requestedServicePage = 1
): Promise<void> {
  if (!ctx.services) return;
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    await renderPanelScreen(
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_panel_detail_title'), t(ctx, 'admin_panel_not_found')),
      backKeyboard(ctx, 'admin'),
      'Markdown'
    );
    return;
  }
  const keyboard = buildPanelDetailKeyboard(ctx, panel, requestedServicePage);

  await renderPanelScreen(
    ctx,
    panelDetailText(ctx, panel, requestedServicePage),
    keyboard,
    'Markdown'
  );
}

export function buildPanelDetailKeyboard(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  requestedServicePage = 1
): InlineKeyboard {
  if (!ctx.services) throw new Error('BOT_SERVICES_UNAVAILABLE');
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_panel_test_button'), panelCallback('t', panel.id))
    .text(
      t(ctx, panel.enabled ? 'admin_panel_disable_button' : 'admin_panel_enable_button'),
      panelCallback('g', panel.id, panel.enabled ? 0 : 1)
    )
    .row();
  if (!panel.isDefault && panel.enabled) {
    keyboard.text(t(ctx, 'admin_panel_make_default_button'), panelCallback('d', panel.id)).row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_edit_name_button'), panelCallback('e', panel.id, 'n'))
    .text(t(ctx, 'admin_panel_edit_url_button'), panelCallback('e', panel.id, 'u'))
    .row()
    .text(t(ctx, 'admin_panel_edit_key_button'), panelCallback('e', panel.id, 'k'))
    .text(t(ctx, 'admin_panel_add_service_button'), panelCallback('e', panel.id, 's'))
    .row();

  const customTarget = ctx.services.pricingService.getCustomVolumeTarget();
  const servicePages = Math.max(1, Math.ceil(panel.services.length / PANEL_SERVICE_PAGE_SIZE));
  const servicePage = Math.min(Math.max(1, Math.trunc(requestedServicePage)), servicePages);
  const visibleServices = panel.services.slice(
    (servicePage - 1) * PANEL_SERVICE_PAGE_SIZE,
    servicePage * PANEL_SERVICE_PAGE_SIZE
  );
  for (const service of visibleServices) {
    const isCustomTarget =
      customTarget.panelId === panel.id && customTarget.serviceId === service.serviceId;
    keyboard
      .text(`${service.isDefault ? '⭐' : '🔹'} ${service.name} · ${service.serviceId}`, 'ui:noop')
      .row();
    if (!service.isDefault) {
      keyboard.text(
        t(ctx, 'admin_panel_service_default_button'),
        panelCallback('s', 'd', panel.id, service.serviceId)
      );
    }
    keyboard.text(
      t(
        ctx,
        isCustomTarget
          ? 'admin_panel_custom_target_selected_button'
          : 'admin_panel_custom_target_button'
      ),
      panelCallback('s', 'c', panel.id, service.serviceId)
    );
    if (!service.isDefault && panel.services.length > 1) {
      keyboard.text(
        t(ctx, 'admin_panel_service_delete_button'),
        panelCallback('s', 'x', panel.id, service.serviceId)
      );
    }
    keyboard.row();
  }
  if (servicePages > 1) {
    if (servicePage > 1) {
      keyboard.text(t(ctx, 'pagination_previous'), panelCallback('v', panel.id, servicePage - 1));
    }
    keyboard.text(
      `${localizedNumber(servicePage, ctx)} / ${localizedNumber(servicePages, ctx)}`,
      'ui:noop'
    );
    if (servicePage < servicePages) {
      keyboard.text(t(ctx, 'pagination_next'), panelCallback('v', panel.id, servicePage + 1));
    }
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_delete_button'), panelCallback('x', panel.id))
    .row()
    .text(t(ctx, 'menu_back'), 'admin:panels:open');

  return keyboard;
}

export function registerAdminPanelRoutes(bot: Bot<MenuContext>): void {
  // Compact callbacks keep the longest valid panel/service action below Telegram's
  // 64-byte callback-data limit. The older admin:* routes remain below for
  // compatibility with buttons that were already sent.
  bot.callbackQuery('a:p:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx);
  });
  bot.callbackQuery('a:p:n', async (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery(/^a:p:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx, Number(ctx.match[1]) || 1);
  });
  bot.callbackQuery('a:p:add', startPanelAdd);
  bot.callbackQuery(new RegExp(`^a:p:v:${PANEL_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelDetail(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });
  bot.callbackQuery(new RegExp(`^a:p:e:${PANEL_ID_CAPTURE}:([nuks])$`, 'u'), async (ctx) => {
    await beginPanelEdit(ctx, ctx.match[1]!, COMPACT_PANEL_EDIT_ACTIONS[ctx.match[2]!]!);
  });
  bot.callbackQuery(new RegExp(`^a:p:t:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await testPanelConnection(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(new RegExp(`^a:p:g:${PANEL_ID_CAPTURE}:([01])$`, 'u'), async (ctx) => {
    await setPanelEnabled(ctx, ctx.match[1]!, ctx.match[2] === '1');
  });
  bot.callbackQuery(new RegExp(`^a:p:d:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await setDefaultPanel(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(new RegExp(`^a:p:s:([dcx]):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const panelId = ctx.match[2]!;
    const serviceId = Number(ctx.match[3]);
    if (action === 'x') {
      await promptPanelServiceDeletion(ctx, panelId, serviceId, true);
      return;
    }
    await updatePanelService(ctx, action === 'd' ? 'default' : 'custom', panelId, serviceId);
  });
  bot.callbackQuery(new RegExp(`^a:p:s:xc:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await deletePanelService(ctx, ctx.match[1]!, Number(ctx.match[2]));
  });
  bot.callbackQuery(new RegExp(`^a:p:x:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await promptPanelDeletion(ctx, ctx.match[1]!, true);
  });
  bot.callbackQuery(new RegExp(`^a:p:xc:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await deletePanel(ctx, ctx.match[1]!);
  });

  bot.callbackQuery('admin:panels:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx);
  });
  bot.callbackQuery('admin:panel:noop', async (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery('admin:panel:add', startPanelAdd);
  bot.callbackQuery(
    new RegExp(`^admin:panel:view:${PANEL_ID_CAPTURE}(?::(\\d+))?$`, 'u'),
    async (ctx) => {
      await ctx.answerCallbackQuery();
      await renderPanelDetail(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
    }
  );
  bot.callbackQuery(
    new RegExp(`^admin:panel:edit:${PANEL_ID_CAPTURE}:(name|url|api_key|add_service)$`, 'u'),
    async (ctx) => {
      await beginPanelEdit(ctx, ctx.match[1]!, ctx.match[2]! as PanelEditAction);
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:test:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await testPanelConnection(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:toggle:${PANEL_ID_CAPTURE}:([01])$`, 'u'),
    async (ctx) => {
      await setPanelEnabled(ctx, ctx.match[1]!, ctx.match[2] === '1');
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:default:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await setDefaultPanel(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:service:(default|custom|delete):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      const action = ctx.match[1]! as PanelServiceAction | 'delete';
      const panelId = ctx.match[2]!;
      const serviceId = Number(ctx.match[3]);
      if (action === 'delete') {
        await promptPanelServiceDeletion(ctx, panelId, serviceId, false);
        return;
      }
      await updatePanelService(ctx, action, panelId, serviceId);
    }
  );
  bot.callbackQuery(
    new RegExp(`^admin:panel:service:delete_confirm:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx) => {
      await deletePanelService(ctx, ctx.match[1]!, Number(ctx.match[2]));
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:delete:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await promptPanelDeletion(ctx, ctx.match[1]!, false);
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:delete_confirm:${PANEL_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      await deletePanel(ctx, ctx.match[1]!);
    }
  );

  // API keys bypass Conversation replay persistence. This one-shot handler
  // explicitly removes the consumed secret message; ordinary user text is never
  // deleted globally by the UI middleware.
  bot.on('message:text', async (ctx, next) => {
    const action = ctx.session.adminPanelAction;
    if (action !== 'await_add_key' && action !== 'await_api_key') return next();
    if (!ctx.services?.isAdmin(ctx.from.id)) return;

    const apiKey = ctx.message.text.trim();
    await deleteConsumedInputMessage(ctx);
    if (apiKey === '/cancel') {
      clearPendingPanelSecret(ctx);
      await renderPanelScreen(
        ctx,
        buildEmptyState('↩️', t(ctx, 'admin_panel_api_key_title'), t(ctx, 'operation_cancelled')),
        backKeyboard(ctx, 'admin'),
        'Markdown'
      );
      return;
    }
    if (!apiKey || apiKey.startsWith('/') || apiKey.length > 512 || /\s/u.test(apiKey)) {
      await renderPanelScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'admin_panel_api_key_title'), t(ctx, 'admin_setting_invalid')),
        backKeyboard(ctx, 'admin'),
        'Markdown'
      );
      return;
    }

    try {
      if (action === 'await_add_key') {
        const draft = ctx.session.adminPanelDraft;
        if (!draft) throw new Error('PANEL_DRAFT_MISSING');
        await ctx.services.panelRegistry.createPanel({ ...draft, apiKey });
      } else {
        const panelId = ctx.session.adminPanelId;
        if (!panelId) throw new Error('PANEL_NOT_FOUND');
        await ctx.services.panelRegistry.updatePanel(panelId, { apiKey });
      }
      clearPendingPanelSecret(ctx);
      await renderPanelScreen(
        ctx,
        buildScreen({
          emoji: '✅',
          title: t(ctx, 'admin_panel_saved_title'),
          subtitle: t(ctx, 'admin_panel_saved_subtitle'),
          primary: {
            emoji: '🔐',
            label: t(ctx, 'admin_panel_credential_label'),
            value: buildStatusBadge(ctx, 'active'),
          },
        }),
        backKeyboard(ctx, 'admin'),
        'Markdown'
      );
    } catch {
      // Retain only the non-secret draft/action for a corrected-key retry.
      await renderPanelScreen(
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_panel_save_failed_title'),
          t(ctx, 'admin_panel_save_failed_subtitle'),
          t(ctx, 'admin_panel_save_failed')
        ),
        backKeyboard(ctx, 'admin'),
        'Markdown'
      );
    }
  });
}

async function startPanelAdd(ctx: MenuContext): Promise<void> {
  ctx.session.adminPanelAction = 'add';
  ctx.session.adminPanelId = undefined;
  ctx.session.adminPanelDraft = undefined;
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('adminPanelConversation');
}

async function beginPanelEdit(
  ctx: MenuContext,
  panelId: string,
  action: PanelEditAction
): Promise<void> {
  ctx.session.adminPanelId = panelId;
  await ctx.answerCallbackQuery();
  if (action === 'api_key') {
    ctx.session.adminPanelAction = 'await_api_key';
    await renderPanelScreen(
      ctx,
      buildScreen({
        emoji: '🔐',
        title: t(ctx, 'admin_panel_api_key_title'),
        subtitle: t(ctx, 'admin_panel_api_key_subtitle'),
        footer: t(ctx, 'admin_panel_api_key_prompt'),
      }),
      backKeyboard(ctx, 'admin'),
      'Markdown'
    );
    return;
  }
  ctx.session.adminPanelAction = action;
  await ctx.conversation.enter('adminPanelConversation');
}

async function testPanelConnection(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
  try {
    const healthy = await ctx.services.panelRegistry.testConnection(panelId);
    await renderPanelScreen(
      ctx,
      buildScreen({
        emoji: healthy ? '✅' : '⚠️',
        title: t(ctx, 'admin_panel_test_title'),
        subtitle: t(ctx, 'admin_panel_test_subtitle'),
        primary: {
          emoji: healthy ? '🩺' : '⚠️',
          label: t(ctx, 'admin_panel_status_label'),
          value: buildStatusBadge(ctx, healthy ? 'healthy' : 'error'),
        },
        footer: t(ctx, healthy ? 'admin_panel_test_ok' : 'admin_panel_test_failed'),
      }),
      new InlineKeyboard().text(t(ctx, 'menu_back'), panelCallback('v', panelId)),
      'Markdown'
    );
  } catch {
    await renderPanelScreen(
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_panel_test_title'), t(ctx, 'admin_panel_test_failed')),
      new InlineKeyboard().text(t(ctx, 'menu_back'), panelCallback('v', panelId)),
      'Markdown'
    );
  }
}

async function setPanelEnabled(ctx: MenuContext, panelId: string, enabled: boolean): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.setPanelEnabled(panelId, enabled);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
    await renderPanelDetail(ctx, panelId);
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
  }
}

async function setDefaultPanel(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.setDefaultPanel(panelId);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
    await renderPanelDetail(ctx, panelId);
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
  }
}

async function updatePanelService(
  ctx: MenuContext,
  action: PanelServiceAction,
  panelId: string,
  serviceId: number
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  try {
    if (action === 'default') {
      await ctx.services.panelRegistry.setDefaultService(panelId, serviceId);
    } else {
      // A stale callback must not persist a deleted, disabled or mismatched
      // panel/service pair into the custom-volume setting.
      await ctx.services.panelRegistry.resolveTarget(panelId, serviceId);
      await ctx.services.translationService.updateSettings({
        custom_volume_target_json: JSON.stringify({ panelId, serviceId }),
        custom_volume_panel_id: '',
        custom_volume_service_id: '',
      });
    }
    await ctx.answerCallbackQuery({
      text: t(ctx, action === 'custom' ? 'admin_panel_custom_target_saved' : 'admin_panel_saved'),
    });
    await renderPanelDetail(ctx, panelId);
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_in_use'), show_alert: true });
  }
}

async function promptPanelServiceDeletion(
  ctx: MenuContext,
  panelId: string,
  serviceId: number,
  compactCallbacks: boolean
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  const service = panel?.services.find((item) => item.serviceId === serviceId);
  if (!service) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_not_found'), show_alert: true });
    return;
  }
  const confirm = compactCallbacks
    ? panelCallback('s', 'xc', panelId, serviceId)
    : `admin:panel:service:delete_confirm:${panelId}:${serviceId}`;
  const cancel = compactCallbacks ? panelCallback('v', panelId) : `admin:panel:view:${panelId}`;
  await ctx.answerCallbackQuery();
  await renderPanelScreen(
    ctx,
    buildScreen({
      emoji: '⚠️',
      title: t(ctx, 'admin_panel_service_delete_title'),
      subtitle: t(ctx, 'admin_panel_service_delete_subtitle'),
      primary: {
        emoji: '📦',
        label: t(ctx, 'admin_panel_services_section'),
        value: escapeTelegramMarkdown(service.name),
      },
      footer: t(ctx, 'admin_panel_service_delete_consequence'),
    }),
    new InlineKeyboard()
      .text(t(ctx, 'admin_confirm_button'), confirm)
      .row()
      .text(t(ctx, 'menu_cancel'), cancel),
    'Markdown'
  );
}

async function deletePanelService(
  ctx: MenuContext,
  panelId: string,
  serviceId: number
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  try {
    await ctx.services.panelRegistry.deleteService(panelId, serviceId);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
    await renderPanelDetail(ctx, panelId);
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_in_use'), show_alert: true });
  }
}

async function promptPanelDeletion(
  ctx: MenuContext,
  panelId: string,
  compactCallbacks: boolean
): Promise<void> {
  if (!ctx.services) return;
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_not_found'), show_alert: true });
    return;
  }
  if (ctx.services.panelRegistry.listPanels().length <= 1) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_last_delete'), show_alert: true });
    return;
  }
  const confirm = compactCallbacks
    ? panelCallback('xc', panelId)
    : `admin:panel:delete_confirm:${panelId}`;
  const cancel = compactCallbacks ? panelCallback('v', panelId) : `admin:panel:view:${panelId}`;
  await ctx.answerCallbackQuery();
  await renderPanelScreen(
    ctx,
    buildScreen({
      emoji: '⚠️',
      title: t(ctx, 'admin_panel_delete_title'),
      subtitle: t(ctx, 'admin_panel_delete_subtitle'),
      primary: {
        emoji: '🖥️',
        label: t(ctx, 'admin_panel_name_label'),
        value: escapeTelegramMarkdown(panel.name),
      },
      footer: t(ctx, 'admin_panel_delete_consequence'),
    }),
    new InlineKeyboard()
      .text(t(ctx, 'admin_confirm_button'), confirm)
      .row()
      .text(t(ctx, 'menu_cancel'), cancel),
    'Markdown'
  );
}

async function deletePanel(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.deletePanel(panelId);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_deleted') });
    await renderPanelRegistry(ctx);
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: t(
        ctx,
        error instanceof RebeccaPanelInUseError ? 'admin_panel_in_use' : 'admin_panel_save_failed'
      ),
      show_alert: true,
    });
  }
}

function isValidServiceId(serviceId: number): boolean {
  return Number.isSafeInteger(serviceId) && serviceId > 0 && serviceId <= 2_147_483_647;
}

function clearPendingPanelSecret(ctx: MenuContext): void {
  ctx.session.adminPanelAction = undefined;
  ctx.session.adminPanelId = undefined;
  ctx.session.adminPanelDraft = undefined;
}

function panelDetailText(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  requestedServicePage = 1
): string {
  const defaultService = panel.services.find((service) => service.isDefault);
  const servicePages = Math.max(1, Math.ceil(panel.services.length / PANEL_SERVICE_PAGE_SIZE));
  const servicePage = Math.min(Math.max(1, Math.trunc(requestedServicePage)), servicePages);
  const visibleServices = panel.services.slice(
    (servicePage - 1) * PANEL_SERVICE_PAGE_SIZE,
    servicePage * PANEL_SERVICE_PAGE_SIZE
  );
  return buildScreen({
    emoji: '🖥️',
    title: t(ctx, 'admin_panel_detail_title'),
    subtitle: escapeTelegramMarkdown(panel.name),
    primary: {
      emoji: panel.enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_panel_status_label'),
      value: buildStatusBadge(
        ctx,
        panel.enabled ? 'active' : 'inactive',
        t(ctx, panel.enabled ? 'admin_panel_status_enabled' : 'admin_panel_status_disabled')
      ),
    },
    sections: [
      {
        emoji: '🔌',
        title: t(ctx, 'admin_panel_connection_section'),
        fields: [
          {
            emoji: '🏷️',
            label: t(ctx, 'admin_panel_name_label'),
            value: escapeTelegramMarkdown(panel.name),
          },
          {
            emoji: '⭐',
            label: t(ctx, 'admin_panel_default_label'),
            value: panel.isDefault ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
          },
          {
            emoji: '🌐',
            label: t(ctx, 'admin_panel_endpoint_label'),
            value: panel.baseUrl ? escapeTelegramMarkdown(panel.baseUrl) : '—',
          },
          {
            emoji: '🔐',
            label: t(ctx, 'admin_panel_credential_label'),
            value: t(ctx, `admin_panel_credential_${panel.credentialMode}`),
          },
          {
            emoji: '🎯',
            label: t(ctx, 'admin_panel_default_service_label'),
            value: defaultService
              ? `${escapeTelegramMarkdown(defaultService.name)} · ${localizedNumber(defaultService.serviceId, ctx)}`
              : '—',
          },
        ],
      },
      {
        emoji: '📦',
        title: t(ctx, 'admin_panel_services_section'),
        fields: panel.services.length
          ? visibleServices.map((service) => ({
              emoji: service.isDefault ? '⭐' : '🔹',
              label: escapeTelegramMarkdown(service.name),
              value: `${t(ctx, 'admin_panel_service_id_label')}: ${localizedNumber(service.serviceId, ctx)}`,
            }))
          : [
              {
                emoji: '📭',
                label: t(ctx, 'admin_panel_services_section'),
                value: t(ctx, 'admin_panel_no_services_label'),
              },
            ],
      },
    ],
    footer:
      servicePages > 1
        ? `${localizedNumber(servicePage, ctx)} / ${localizedNumber(servicePages, ctx)}`
        : undefined,
  });
}

async function renderPanelScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'Markdown'
): Promise<void> {
  await renderScreen(ctx, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: keyboard,
  });
}
