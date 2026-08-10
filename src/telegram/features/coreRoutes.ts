/** Compose Telegram route modules in precedence-sensitive order. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { backKeyboard } from '../ui.js';
import { t } from '../locale.js';
import { registerPromoAdminRoutes } from './admin/promoRoutes.js';
import { registerAdminUserRoutes } from './admin/userRoutes.js';
import { registerReceiptAdminRoutes } from './admin/receiptRoutes.js';
import { registerAdminMaintenanceRoutes } from './admin/maintenanceRoutes.js';
import { registerAdminBroadcastRoutes } from './admin/broadcastRoutes.js';
import { registerAdminPanelRoutes } from './admin/panelRoutes.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';
import { registerBaseRoutes } from './baseRoutes.js';
import { registerPurchaseRoutes } from './purchaseRoutes.js';
import { registerConfigRoutes } from './configRoutes.js';

export function registerCoreRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  registerBaseRoutes(bot, services);

  registerPromoAdminRoutes(bot);
  registerAdminUserRoutes(bot);
  registerReceiptAdminRoutes(bot);
  registerAdminMaintenanceRoutes(bot);
  registerAdminBroadcastRoutes(bot);
  registerAdminPanelRoutes(bot);
  registerSubscriptionRoutes(bot);

  registerPurchaseRoutes(bot, services);
  registerConfigRoutes(bot, services);

  // Final callback safety net. Every button must stop Telegram's loading
  // spinner, including callbacks from messages created by older deployments.
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_expired'), show_alert: true });
    await ctx.reply(t(ctx, 'button_expired_help'), { reply_markup: backKeyboard(ctx, 'main') });
  });
}
