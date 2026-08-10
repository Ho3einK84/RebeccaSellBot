/** Middleware, session and conversation composition for the Telegram bot. */

import { session, type Bot } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { PostgresSessionAdapter } from '../infra/sessionAdapter.js';
import type { BotServices, ConversationContext, MenuContext } from './types.js';
import {
  autoRenewCustomConversation,
  buyConfigConversation,
  customAmountConversation,
  promoConversation,
  transferConfigConversation,
  renewConfigConversation,
} from './conversations/userConversations.js';
import {
  topupConversation,
  adminSetBalanceConversation,
  adminCreatePromoConversation,
  adminEditPromoConversation,
  adminSearchPromoConversation,
  adminBroadcastConversation,
  adminSearchUserConversation,
  adminEditSettingsConversation,
  adminEditTextsConversation,
  adminDirectMessageConversation,
  adminAddAdminConversation,
  adminAssignOrphanConversation,
  adminPanelConversation,
} from './conversations/adminConversations.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { registerAdminAlertHook } from '../domain/services/RebeccaService.js';
import { logger } from '../infra/logger.js';
import { observedContextLocale, resolveServiceLocale, t, tmForLocale } from './locale.js';
import { cleanChatUiMiddleware, uiMessageTrackingTransformer } from './ui.js';
import { safeFormattingTransformer } from './rendering.js';

export function configureBotRuntime(bot: Bot<MenuContext>, services: BotServices): void {
  // API-level rate throttler (respects Telegram flood limits)
  const throttler = apiThrottler();
  bot.api.config.use(throttler);
  bot.api.config.use(safeFormattingTransformer());
  bot.api.config.use(uiMessageTrackingTransformer());

  // Register admin alert hook — RebeccaService fires this on origin-down
  registerAdminAlertHook(async (alert) => {
    for (const adminId of services.adminIds) {
      try {
        const locale =
          (await services.userService.getLocale(adminId)) ??
          resolveServiceLocale(services.translationService);
        await bot.api.sendMessage(
          adminId,
          tmForLocale(services.translationService, locale, 'admin_panel_outage', {
            panel: alert.panelName ?? alert.panelId ?? '—',
            endpoint: alert.endpoint,
            attempts: alert.attempts,
          }),
          {
            parse_mode: 'Markdown',
          }
        );
      } catch (err) {
        logger.warn({ err, adminId }, 'Failed to send admin alert');
      }
    }
  });

  // Inject services into context
  bot.use(async (ctx, next) => {
    ctx.services = services;
    return next();
  });

  // Financial and administrative flows are private-chat only. Group updates
  // never create sessions or expose account details to other participants.
  bot.use(async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private') return next();
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'private_chat_only'), show_alert: true });
    }
  });

  // Follow Telegram's app locale until a user makes an explicit choice in the
  // language picker. Background jobs use this persisted preference later.
  bot.use(async (ctx, next) => {
    const observedLocale = observedContextLocale(ctx);
    if (ctx.from?.id && ctx.chat?.type === 'private') {
      try {
        const user = await services.walletService.getOrCreateUser(
          ctx.from.id,
          ctx.from.username,
          ctx.from.first_name,
          ctx.from.last_name,
          undefined,
          observedLocale,
          'telegram_interaction'
        );
        ctx.userLocale = user.locale === 'en' ? 'en' : 'fa';
      } catch (err) {
        logger.debug(
          { telegramId: ctx.from.id, errorName: err instanceof Error ? err.name : typeof err },
          'Could not update Telegram user activity'
        );
      }
    }
    if (ctx.from?.id && !ctx.userLocale) {
      try {
        ctx.userLocale =
          (await services.userService.getLocale(ctx.from.id)) ??
          observedLocale ??
          resolveServiceLocale(services.translationService);
      } catch (err) {
        logger.debug(
          { telegramId: ctx.from.id, errorName: err instanceof Error ? err.name : typeof err },
          'Could not load saved Telegram locale'
        );
        ctx.userLocale = observedLocale ?? resolveServiceLocale(services.translationService);
      }
    }
    return next();
  });

  // Menu callback data is user-controlled input. Enforce Telegram-side admin
  // authorization in middleware as well as at the /admin entry point.
  bot.use(async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    if (
      data &&
      (data.includes('admin-menu') ||
        data.startsWith('admin:') ||
        data.startsWith('admin_') ||
        data.startsWith('receipt:') ||
        data.startsWith('receipt-') ||
        data.startsWith('promo:')) &&
      !services.isAdmin(ctx.from?.id ?? 0)
    ) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'access_denied'), show_alert: true });
      logger.warn({ telegramId: ctx.from?.id }, 'Unauthorized admin callback rejected');
      return;
    }
    return next();
  });

  // Postgres session storage
  bot.use(
    session({
      initial: () => ({}),
      storage: new PostgresSessionAdapter(),
      getSessionKey: (ctx) => (ctx.chat && ctx.from ? `${ctx.chat.id}:${ctx.from.id}` : undefined),
    })
  );

  // Keep private chats focused on the current screen. This runs after session
  // hydration so the list of replaceable bot messages survives restarts.
  bot.use(cleanChatUiMiddleware());

  // Ban check — silently drop updates from banned users
  bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();
    try {
      if (await services.userService.isBanned(telegramId)) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery();
        return;
      }
    } catch (err) {
      logger.warn(
        { errorName: err instanceof Error ? err.name : typeof err, telegramId },
        'Ban lookup failed; update rejected safely'
      );
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      } else {
        await ctx.reply(t(ctx, 'operation_failed'));
      }
      return;
    }
    return next();
  });

  // Conversation plugin
  // Conversation contexts are created from scratch by the plugin and do not
  // inherit properties installed by the outer middleware tree. Reinject the
  // service container and durable locale so conversation-backed menu buttons
  // can execute and reply in the selected language.
  bot.use(
    conversations<MenuContext, ConversationContext>({
      plugins: [conversationContextMiddleware(services)],
    })
  );
  bot.use(createConversation(buyConfigConversation, 'buyConfigConversation'));
  bot.use(createConversation(customAmountConversation, 'customAmountConversation'));
  bot.use(createConversation(renewConfigConversation, 'renewConfigConversation'));
  bot.use(createConversation(autoRenewCustomConversation, 'autoRenewCustomConversation'));
  bot.use(createConversation(promoConversation, 'promoConversation'));
  bot.use(createConversation(transferConfigConversation, 'transferConfigConversation'));
  bot.use(createConversation(topupConversation, 'topupConversation'));
  bot.use(createConversation(adminSetBalanceConversation, 'adminSetBalanceConversation'));
  bot.use(createConversation(adminCreatePromoConversation, 'adminCreatePromoConversation'));
  bot.use(createConversation(adminEditPromoConversation, 'adminEditPromoConversation'));
  bot.use(createConversation(adminSearchPromoConversation, 'adminSearchPromoConversation'));
  bot.use(createConversation(adminBroadcastConversation, 'adminBroadcastConversation'));
  bot.use(createConversation(adminSearchUserConversation, 'adminSearchUserConversation'));
  bot.use(createConversation(adminEditSettingsConversation, 'adminEditSettingsConversation'));
  bot.use(createConversation(adminEditTextsConversation, 'adminEditTextsConversation'));
  bot.use(createConversation(adminDirectMessageConversation, 'adminDirectMessageConversation'));
  bot.use(createConversation(adminAddAdminConversation, 'adminAddAdminConversation'));
  bot.use(createConversation(adminAssignOrphanConversation, 'adminAssignOrphanConversation'));
  bot.use(createConversation(adminPanelConversation, 'adminPanelConversation'));

  // Conversations must see replies before the light plain-text limiter; a
  // global limiter before this point left admin conversations waiting forever.
  // Callbacks stay responsive and each mutating action has its own guard.
  bot.use(rateLimitMiddleware());
}

export function conversationContextMiddleware(services: BotServices) {
  return async (ctx: ConversationContext, next: () => Promise<void>): Promise<void> => {
    ctx.services = services;
    const observedLocale = observedContextLocale(ctx);
    if (ctx.from?.id) {
      try {
        ctx.userLocale =
          (await services.userService.getLocale(ctx.from.id)) ??
          observedLocale ??
          resolveServiceLocale(services.translationService);
      } catch {
        ctx.userLocale = observedLocale ?? resolveServiceLocale(services.translationService);
      }
    } else {
      ctx.userLocale = observedLocale ?? resolveServiceLocale(services.translationService);
    }
    await next();
  };
}
