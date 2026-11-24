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
  stripLeadingEmoji,
} from '../ui.js';
import { t, tForLocale } from '../locale.js';
import { mainMenu, renderHomeDashboard } from '../keyboards/mainMenu.js';
import { registerPromoAdminRoutes } from './admin/promoRoutes.js';
import { registerAdminUserRoutes } from './admin/userRoutes.js';
import { registerReceiptAdminRoutes } from './admin/receiptRoutes.js';
import { registerAdminMaintenanceRoutes } from './admin/maintenanceRoutes.js';
import { registerAdminBroadcastRoutes } from './admin/broadcastRoutes.js';
import { registerAdminBulkGiftRoutes } from './admin/bulkGiftRoutes.js';
import { registerAdminPanelRoutes } from './admin/panelRoutes.js';
import { attachAdminRouter } from '../admin/adminRouter.js';
import { registerAdminHomeRoutes, renderAdminHomeScreen } from '../admin/adminHome.js';
import { registerAdminQuickCommands } from '../admin/adminCommands.js';
import { registerAdminSalesRoutes } from '../admin/adminSalesRoutes.js';
import { registerAdminSettingsRoutes } from '../admin/adminSettingsRoutes.js';
import { registerAdminForcedJoinRoutes } from '../admin/adminForcedJoinRoutes.js';
import { registerAdminPaymentGatewayRoutes } from '../admin/adminPaymentGatewayRoutes.js';
import { registerAdminTextsRoutes } from '../admin/adminTextsRoutes.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';
import { registerBaseRoutes } from './baseRoutes.js';
import { registerPurchaseRoutes } from './purchaseRoutes.js';
import { registerPaymentOrderRoutes } from './paymentOrderRoutes.js';
import { registerConfigRoutes } from './configRoutes.js';
import { registerLuckyWheelRoutes } from './luckyWheelRoutes.js';
import { ContactVerificationService } from '../../domain/services/ContactVerificationService.js';

export function registerCoreRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  registerAdminHomeRoutes();
  registerAdminSalesRoutes();
  registerAdminSettingsRoutes();
  registerAdminForcedJoinRoutes();
  registerAdminBulkGiftRoutes();
  registerAdminPaymentGatewayRoutes();
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
  registerPaymentOrderRoutes(bot, services);
  registerConfigRoutes(bot, services);
  registerLuckyWheelRoutes(bot, services);

  // Handles contacts shared natively via Telegram Mini App `WebApp.requestContact()`
  // outside `verifyPhoneConversation`. Verifies strict ownership (`contact.user_id === from.id`)
  // and persists only the keyed HMAC-SHA256 hash via ContactVerificationService.
  bot.on('message:contact', async (ctx) => {
    const telegramId = ctx.from?.id;
    const contact = ctx.message?.contact;
    if (!telegramId || !contact?.phone_number) return;

    if (contact.user_id !== telegramId) {
      await ctx.reply(
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'onboarding_phone_verify_title'),
          t(ctx, 'onboarding_phone_not_owner')
        ),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      await services.walletService.getOrCreateUser(
        telegramId,
        ctx.from.username ?? null,
        ctx.from.first_name ?? null,
        ctx.from.last_name ?? null,
        undefined,
        ctx.userLocale
      );
      const phoneService =
        services.contactVerificationService ??
        new ContactVerificationService({
          translationService: services.translationService,
        });
      const result = await phoneService.verifyAndBindPhone({
        telegramId,
        rawPhoneNumber: contact.phone_number,
        settings: services.translationService,
      });

      if (result.ok) {
        services.walletService.invalidateUserCache?.(telegramId);
        await ctx.reply(
          buildUserScreen({
            emoji: '✅',
            title: t(ctx, 'onboarding_phone_verify_title'),
            footer: stripLeadingEmoji(t(ctx, 'onboarding_phone_verified_success')),
          }),
          { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
        );
        return;
      }

      const reasonKey =
        result.reason === 'iran_only'
          ? 'onboarding_phone_iran_only'
          : result.reason === 'already_bound'
            ? 'onboarding_phone_already_bound'
            : 'onboarding_phone_invalid';
      await ctx.reply(
        buildUserEmptyState('⚠️', t(ctx, 'onboarding_phone_verify_title'), t(ctx, reasonKey)),
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
    } catch {
      await ctx.reply(
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'onboarding_phone_verify_title'),
          t(ctx, 'operation_failed')
        ),
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
    }
  });

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
