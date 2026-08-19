/** Compose Telegram route modules in precedence-sensitive order. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { backKeyboard, buildEmptyState, buildScreen, renderScreen } from '../ui.js';
import { t } from '../locale.js';
import { mainMenu } from '../keyboards/mainMenu.js';
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

  // Plain text that was not consumed by a conversation, secret-input route, or
  // subscription-link handler remains visible and gets an explicit home state.
  bot.on('message:text', async (ctx) => {
    await renderScreen(
      ctx,
      buildScreen({
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
    await renderScreen(
      ctx,
      buildEmptyState('⌛️', t(ctx, 'button_expired'), t(ctx, 'button_expired_help')),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
    );
  });
}
