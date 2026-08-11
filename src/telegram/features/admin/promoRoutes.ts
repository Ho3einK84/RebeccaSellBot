import type { Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { t } from '../../locale.js';
import { buildScreen } from '../../ui.js';
import {
  promoCenterKeyboard,
  promoDeleteConfirmKeyboard,
  promoDetailView,
  renderPromoScreen,
  showPromoCenter,
} from '../../promoAdminUi.js';

const UUID_CAPTURE = '([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})';

export function registerPromoAdminRoutes(bot: Bot<MenuContext>): void {
  async function renderDetail(ctx: MenuContext, id: string): Promise<void> {
    const view = await promoDetailView(ctx, id);
    if (!view) {
      await ctx.reply(t(ctx, 'admin_promo_not_found'), { reply_markup: promoCenterKeyboard(ctx) });
      return;
    }
    await renderPromoScreen(ctx, view.text, view.keyboard, 'Markdown');
  }

  bot.callbackQuery('promo:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoCenter(ctx, 1);
  });

  bot.callbackQuery(/^promo:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoCenter(ctx, Number(ctx.match[1]) || 1);
  });

  bot.callbackQuery('promo:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminCreatePromoConversation');
  });

  bot.callbackQuery('promo:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminSearchPromoConversation');
  });

  bot.callbackQuery(new RegExp(`^promo:open:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderDetail(ctx, ctx.match[1]!);
  });

  bot.callbackQuery(new RegExp(`^promo:edit:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    ctx.session.adminPromoEditId = ctx.match[1]!;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminEditPromoConversation');
  });

  bot.callbackQuery(new RegExp(`^promo:toggle:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const id = ctx.match[1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_not_found'), show_alert: true });
      return;
    }
    const updated = await ctx.services.promoService.setPromoActiveById(id, !promo.active);
    await ctx.answerCallbackQuery({
      text: t(ctx, updated ? 'admin_promo_toggled' : 'operation_failed', {
        code: promo.code,
        active: t(ctx, promo.active ? 'admin_promo_inactive' : 'admin_promo_active'),
      }),
    });
    if (updated) await renderDetail(ctx, id);
  });

  bot.callbackQuery(new RegExp(`^promo:delete:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const id = ctx.match[1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_not_found'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderPromoScreen(
      ctx,
      buildScreen({
        emoji: '🗑️',
        title: t(ctx, 'admin_promo_delete_title'),
        subtitle: t(ctx, 'admin_promo_delete_subtitle'),
        primary: {
          emoji: '🎟️',
          label: t(ctx, 'checkout_promo_section'),
          value: `\`${promo.code}\``,
        },
        footer: `⚠️ ${t(ctx, 'admin_promo_delete_consequence')}`,
      }),
      promoDeleteConfirmKeyboard(ctx, id),
      'Markdown'
    );
  });

  bot.callbackQuery(new RegExp(`^promo:delete_confirm:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const id = ctx.match[1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    const deleted = promo ? await ctx.services.promoService.deletePromoCodeById(id) : false;
    await ctx.answerCallbackQuery({
      text: t(ctx, deleted ? 'admin_promo_deleted' : 'admin_promo_delete_failed', {
        code: promo?.code ?? '—',
      }),
      show_alert: !deleted,
    });
    if (deleted) await showPromoCenter(ctx, 1);
  });

  // Old session-token buttons and future unknown promo actions fail visibly.
  bot.callbackQuery(/^promo:/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_stale_button'), show_alert: true });
    await showPromoCenter(ctx, 1);
  });
}
