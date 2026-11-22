/** Compose Telegram route modules in precedence-sensitive order. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import {
  backKeyboard,
  buildUserEmptyState,
  buildUserScreen,
  deleteConsumedInputMessage,
  rememberUiMessage,
  renderScreen,
} from '../ui.js';
import { t, tForLocale } from '../locale.js';
import { mainMenu, renderHomeDashboard } from '../keyboards/mainMenu.js';
import { registerPromoAdminRoutes } from './admin/promoRoutes.js';
import { registerAdminUserRoutes } from './admin/userRoutes.js';
import { registerReceiptAdminRoutes } from './admin/receiptRoutes.js';
import { registerAdminMaintenanceRoutes } from './admin/maintenanceRoutes.js';
import { registerAdminBroadcastRoutes } from './admin/broadcastRoutes.js';
import { registerAdminPanelRoutes } from './admin/panelRoutes.js';
import { attachAdminRouter } from '../admin/adminRouter.js';
import { registerAdminHomeRoutes, renderAdminHomeScreen } from '../admin/adminHome.js';
import { registerAdminQuickCommands } from '../admin/adminCommands.js';
import { registerAdminSalesRoutes } from '../admin/adminSalesRoutes.js';
import { registerAdminSettingsRoutes } from '../admin/adminSettingsRoutes.js';
import { registerAdminTextsRoutes } from '../admin/adminTextsRoutes.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';
import { registerBaseRoutes } from './baseRoutes.js';
import { registerPurchaseRoutes } from './purchaseRoutes.js';
import { registerConfigRoutes } from './configRoutes.js';
import { registerLuckyWheelRoutes } from './luckyWheelRoutes.js';

export function registerCoreRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  registerAdminHomeRoutes();
  registerAdminSalesRoutes();
  registerAdminSettingsRoutes();
  registerAdminTextsRoutes();
  registerBaseRoutes(bot, services);
  registerAdminQuickCommands(bot, services);
  attachAdminRouter(bot);

  registerPromoAdminRoutes(bot);
  registerAdminUserRoutes(bot);
  registerReceiptAdminRoutes(bot);
  registerAdminMaintenanceRoutes(bot);
  registerAdminBroadcastRoutes(bot);
  registerAdminPanelRoutes(bot);
  registerSubscriptionRoutes(bot);

  registerPurchaseRoutes(bot, services);
  registerConfigRoutes(bot, services);
  registerLuckyWheelRoutes(bot, services);

  // Plain text that was not consumed by a conversation, secret-input route, or
  // subscription-link handler remains visible and gets an explicit home state.
  bot.on('message:text', async (ctx) => {
    const trimmed = ctx.message.text.trim();
    const faCancel = tForLocale(services.translationService, 'fa', 'button_cancel_phone').trim();
    const enCancel = tForLocale(services.translationService, 'en', 'button_cancel_phone').trim();
    if (trimmed === faCancel || trimmed === enCancel) {
      await deleteConsumedInputMessage(ctx);
      const removedMsg = await ctx.reply(t(ctx, 'operation_cancelled'), {
        reply_markup: { remove_keyboard: true },
      });
      if (ctx.session) {
        rememberUiMessage(ctx.session, removedMsg.message_id, 'prompt');
      }
      await renderScreen(ctx, await renderHomeDashboard(ctx), {
        parse_mode: 'Markdown',
        reply_markup: mainMenu,
      });
      return;
    }

    if (
      ctx.from?.id &&
      services.isAdmin(ctx.from.id) &&
      ctx.session?.adminLastContext === 'admin'
    ) {
      await renderAdminHomeScreen(ctx, {
        tone: 'info',
        text: t(ctx, 'unexpected_text_hint'),
      });
      return;
    }

    await renderScreen(
      ctx,
      buildUserScreen({
        emoji: '🏠',
        title: t(ctx, 'home_title'),
        subtitle: t(ctx, 'home_subtitle'),
        footer: t(ctx, 'unexpected_text_hint'),
      }),
      { parse_mode: 'Markdown', reply_markup: mainMenu }
    );
  });

  // Final callback safety net. Every button must stop Telegram's loading
  // spinner, including callbacks from messages created by older deployments.
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_expired'), show_alert: true });
    const inAdmin = Boolean(
      ctx.from?.id && services.isAdmin(ctx.from.id) && ctx.session?.adminLastContext === 'admin'
    );
    await renderScreen(
      ctx,
      buildUserEmptyState('⌛️', t(ctx, 'button_expired'), t(ctx, 'button_expired_help')),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, inAdmin ? 'admin' : 'main') }
    );
  });
}
