import { InlineKeyboard, type Bot } from 'grammy';
import {
  RebeccaPanelInUseError,
  type RebeccaPanelSummary,
} from '../../../domain/services/RebeccaPanelRegistry.js';
import type { MenuContext } from '../../types.js';
import { localizedNumber, t } from '../../locale.js';
import { backKeyboard } from '../../ui.js';

const PANEL_ID_CAPTURE = '([a-z0-9_-]{3,40})';

export async function renderPanelRegistry(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const panels = ctx.services.panelRegistry.listPanels();
  const keyboard = new InlineKeyboard();
  for (const panel of panels) {
    keyboard
      .text(
        `${panel.isDefault ? '⭐ ' : ''}${panel.enabled ? '🟢' : '⚪️'} ${panel.name}`,
        `admin:panel:view:${panel.id}`
      )
      .row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_add_button'), 'admin:panel:add')
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
  await ctx.reply(
    t(ctx, panels.length ? 'admin_panels_title' : 'admin_panels_empty', {
      count: localizedNumber(panels.length, ctx),
    }),
    { reply_markup: keyboard }
  );
}

async function renderPanelDetail(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    await ctx.reply(t(ctx, 'admin_panel_not_found'), { reply_markup: backKeyboard(ctx, 'admin') });
    return;
  }
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_panel_test_button'), `admin:panel:test:${panel.id}`)
    .text(
      t(ctx, panel.enabled ? 'admin_panel_disable_button' : 'admin_panel_enable_button'),
      `admin:panel:toggle:${panel.id}:${panel.enabled ? 0 : 1}`
    )
    .row();
  if (!panel.isDefault && panel.enabled) {
    keyboard
      .text(t(ctx, 'admin_panel_make_default_button'), `admin:panel:default:${panel.id}`)
      .row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_edit_name_button'), `admin:panel:edit:${panel.id}:name`)
    .text(t(ctx, 'admin_panel_edit_url_button'), `admin:panel:edit:${panel.id}:url`)
    .row()
    .text(t(ctx, 'admin_panel_edit_key_button'), `admin:panel:edit:${panel.id}:api_key`)
    .text(t(ctx, 'admin_panel_add_service_button'), `admin:panel:edit:${panel.id}:add_service`)
    .row();

  const customTarget = ctx.services.pricingService.getCustomVolumeTarget();
  for (const service of panel.services) {
    const isCustomTarget =
      customTarget.panelId === panel.id && customTarget.serviceId === service.serviceId;
    keyboard
      .text(
        `${service.isDefault ? '⭐' : '🔹'} ${service.name} · ${service.serviceId}`,
        'admin:panel:noop'
      )
      .row();
    if (!service.isDefault) {
      keyboard.text(
        t(ctx, 'admin_panel_service_default_button'),
        `admin:panel:service:default:${panel.id}:${service.serviceId}`
      );
    }
    keyboard.text(
      t(
        ctx,
        isCustomTarget
          ? 'admin_panel_custom_target_selected_button'
          : 'admin_panel_custom_target_button'
      ),
      `admin:panel:service:custom:${panel.id}:${service.serviceId}`
    );
    if (!service.isDefault && panel.services.length > 1) {
      keyboard.text(
        t(ctx, 'admin_panel_service_delete_button'),
        `admin:panel:service:delete:${panel.id}:${service.serviceId}`
      );
    }
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_panel_delete_button'), `admin:panel:delete:${panel.id}`)
    .row()
    .text(t(ctx, 'menu_back'), 'admin:panels:open');

  await ctx.reply(panelDetailText(ctx, panel), { reply_markup: keyboard });
}

export function registerAdminPanelRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery('admin:panels:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx);
  });
  bot.callbackQuery('admin:panel:noop', async (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery('admin:panel:add', async (ctx) => {
    ctx.session.adminPanelAction = 'add';
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminPanelConversation');
  });
  bot.callbackQuery(new RegExp(`^admin:panel:view:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelDetail(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:edit:${PANEL_ID_CAPTURE}:(name|url|api_key|add_service)$`, 'u'),
    async (ctx) => {
      ctx.session.adminPanelId = ctx.match[1]!;
      await ctx.answerCallbackQuery();
      if (ctx.match[2] === 'api_key') {
        ctx.session.adminPanelAction = 'await_api_key';
        await ctx.reply(t(ctx, 'admin_panel_api_key_prompt'), {
          reply_markup: backKeyboard(ctx, 'admin'),
        });
        return;
      }
      ctx.session.adminPanelAction = ctx.match[2] as 'name' | 'url' | 'add_service';
      await ctx.conversation.enter('adminPanelConversation');
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:test:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const healthy = await ctx.services.panelRegistry.testConnection(ctx.match[1]!);
    await ctx.reply(t(ctx, healthy ? 'admin_panel_test_ok' : 'admin_panel_test_failed'), {
      reply_markup: backKeyboard(ctx, 'admin'),
    });
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:toggle:${PANEL_ID_CAPTURE}:([01])$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      try {
        await ctx.services.panelRegistry.setPanelEnabled(ctx.match[1]!, ctx.match[2] === '1');
        await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
        await renderPanelDetail(ctx, ctx.match[1]!);
      } catch {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'admin_panel_save_failed'),
          show_alert: true,
        });
      }
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:default:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    try {
      await ctx.services.panelRegistry.setDefaultPanel(ctx.match[1]!);
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
      await renderPanelDetail(ctx, ctx.match[1]!);
    } catch {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    }
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:service:(default|custom|delete):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      const action = ctx.match[1]!;
      const panelId = ctx.match[2]!;
      const serviceId = Number(ctx.match[3]);
      try {
        if (action === 'default') {
          await ctx.services.panelRegistry.setDefaultService(panelId, serviceId);
        } else if (action === 'custom') {
          // A stale callback must not persist a deleted, disabled or mismatched
          // panel/service pair into the custom-volume setting.
          await ctx.services.panelRegistry.resolveTarget(panelId, serviceId);
          await ctx.services.translationService.updateSettings({
            custom_volume_target_json: JSON.stringify({ panelId, serviceId }),
            custom_volume_panel_id: '',
            custom_volume_service_id: '',
          });
        } else {
          await ctx.services.panelRegistry.deleteService(panelId, serviceId);
        }
        await ctx.answerCallbackQuery({
          text: t(
            ctx,
            action === 'custom' ? 'admin_panel_custom_target_saved' : 'admin_panel_saved'
          ),
        });
        await renderPanelDetail(ctx, panelId);
      } catch {
        await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_in_use'), show_alert: true });
      }
    }
  );
  bot.callbackQuery(new RegExp(`^admin:panel:delete:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const panelId = ctx.match[1]!;
    if (ctx.services.panelRegistry.listPanels().length <= 1) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_last_delete'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx, 'admin_panel_delete_confirm'), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), `admin:panel:delete_confirm:${panelId}`)
        .row()
        .text(t(ctx, 'menu_cancel'), `admin:panel:view:${panelId}`),
    });
  });
  bot.callbackQuery(
    new RegExp(`^admin:panel:delete_confirm:${PANEL_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      try {
        await ctx.services.panelRegistry.deletePanel(ctx.match[1]!);
        await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_deleted') });
        await renderPanelRegistry(ctx);
      } catch (error) {
        await ctx.answerCallbackQuery({
          text: t(
            ctx,
            error instanceof RebeccaPanelInUseError
              ? 'admin_panel_in_use'
              : 'admin_panel_save_failed'
          ),
          show_alert: true,
        });
      }
    }
  );

  // API keys bypass Conversation replay persistence. The private-chat UI
  // middleware has already removed the user's secret-bearing message; only
  // the encrypted panel record survives this handler.
  bot.on('message:text', async (ctx, next) => {
    const action = ctx.session.adminPanelAction;
    if (action !== 'await_add_key' && action !== 'await_api_key') return next();
    if (!ctx.services?.isAdmin(ctx.from.id)) return;

    const apiKey = ctx.message.text.trim();
    if (apiKey === '/cancel') {
      clearPendingPanelSecret(ctx);
      await ctx.reply(t(ctx, 'operation_cancelled'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
      return;
    }
    if (!apiKey || apiKey.startsWith('/') || apiKey.length > 512 || /\s/u.test(apiKey)) {
      await ctx.reply(t(ctx, 'admin_setting_invalid'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
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
      await ctx.reply(t(ctx, 'admin_panel_saved'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
    } catch {
      // Retain only the non-secret draft/action for a corrected-key retry.
      await ctx.reply(t(ctx, 'admin_panel_save_failed'), {
        reply_markup: backKeyboard(ctx, 'admin'),
      });
    }
  });
}

function clearPendingPanelSecret(ctx: MenuContext): void {
  ctx.session.adminPanelAction = undefined;
  ctx.session.adminPanelId = undefined;
  ctx.session.adminPanelDraft = undefined;
}

function panelDetailText(ctx: MenuContext, panel: RebeccaPanelSummary): string {
  const defaultService = panel.services.find((service) => service.isDefault);
  return t(ctx, 'admin_panel_detail', {
    name: panel.name,
    status: t(ctx, panel.enabled ? 'admin_panel_status_enabled' : 'admin_panel_status_disabled'),
    default_status: panel.isDefault ? '⭐' : '—',
    url: panel.baseUrl ?? '—',
    credential: t(ctx, `admin_panel_credential_${panel.credentialMode}`),
    service: defaultService ? `${defaultService.name} (${defaultService.serviceId})` : '—',
  });
}
