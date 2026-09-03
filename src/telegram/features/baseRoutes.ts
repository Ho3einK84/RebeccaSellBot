/** Basic navigation, locale and command routes. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import {
  mainMenu,
  renderHomeDashboard,
  renderShopMenuText,
  shopMenu,
  renderWalletDashboard,
  renderWalletStatementScreen,
  walletMenu,
} from '../keyboards/mainMenu.js';
import { adminMenu, renderAdminHome, renderSalesMenu } from '../keyboards/adminMenu.js';
import { showPromoCenter } from '../promoAdminUi.js';
import { languageKeyboard } from '../keyboards/language.js';
import { logger } from '../../infra/logger.js';
import { acquireUserActionCooldown } from '../middleware/actionCooldown.js';
import { formatSubscriptionLink, resolveServiceLocale, t } from '../locale.js';
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  forgetUiMessage,
  rememberArtifactMessage,
  renderScreen,
  safelyDeleteMessage,
} from '../ui.js';

export function registerBaseRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  // Menus (register submenus before registering the tree)
  mainMenu.register(adminMenu);
  bot.use(mainMenu);

  // /start — with referral detection
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const payload = ctx.match;
    const referralCode = payload?.startsWith('ref_') ? payload : undefined;
    const isFirstVisit = !(await services.userService.exists(telegramId));
    const defaultLocale =
      typeof services.translationService?.getDefaultLocale === 'function'
        ? services.translationService.getDefaultLocale()
        : resolveServiceLocale(services.translationService);

    const user = await services.walletService.getOrCreateUser(
      telegramId,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? null,
      ctx.from?.last_name ?? null,
      referralCode,
      defaultLocale,
      referralCode ? 'telegram_referral_start' : 'telegram_start'
    );

    ctx.userLocale = isFirstVisit ? defaultLocale : user.locale === 'en' ? 'en' : 'fa';

    if (isFirstVisit) {
      const languageSelectionEnabled = services.translationService.getSettingBool(
        'language_selection_enabled',
        true
      );
      if (languageSelectionEnabled) {
        await renderScreen(ctx, t(ctx, 'onboarding_welcome'), {
          parse_mode: 'Markdown',
          reply_markup: languageKeyboard(ctx, 'main'),
        });
        return;
      }
    }

    const dashboardText = await renderHomeDashboard(ctx);
    await renderScreen(ctx, dashboardText, {
      parse_mode: 'Markdown',
      reply_markup: mainMenu,
    });
  });

  // /admin — explicit admin menu command
  bot.command('admin', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !services.isAdmin(telegramId)) {
      await renderScreen(
        ctx,
        buildEmptyState('🔒', t(ctx, 'admin_menu_title'), t(ctx, 'admin_access_denied')),
        { parse_mode: 'Markdown', reply_markup: mainMenu }
      );
      return;
    }
    await renderScreen(ctx, await renderAdminHome(ctx), {
      parse_mode: 'Markdown',
      reply_markup: adminMenu,
    });
  });

  bot.callbackQuery(/^locale:(fa|en)$/u, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const locale = ctx.match[1] === 'en' ? 'en' : 'fa';
    await ctx.answerCallbackQuery();
    try {
      // A user can open the picker before /start; create the local profile
      // first so the explicit preference is durable in that case as well.
      await services.walletService.getOrCreateUser(
        telegramId,
        ctx.from.username ?? null,
        ctx.from.first_name ?? null,
        ctx.from.last_name ?? null,
        undefined,
        locale
      );
      await services.userService.updateLocale(telegramId, locale);
      services.walletService.invalidateUserCache(telegramId);
      ctx.userLocale = locale;
      const dashboardText = await renderHomeDashboard(ctx);
      await renderScreen(ctx, dashboardText, {
        parse_mode: 'Markdown',
        reply_markup: mainMenu,
      });
    } catch (err) {
      logger.error(
        { err, telegramId, locale },
        'Failed to save selected Telegram language preference'
      );
      await renderScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'language_selection_title'), t(ctx, 'language_update_failed')),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx) }
      );
    }
  });

  bot.callbackQuery(/^nav:(home|main|admin|admin:sales|wallet|shop)$/u, async (ctx) => {
    const requested = ctx.match[1];
    const telegramId = ctx.from.id;
    const showAdmin = requested === 'admin' || requested === 'admin:sales';
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    delete ctx.session.adminQuickTopup;
    await ctx.answerCallbackQuery();
    if (showAdmin && !services.isAdmin(telegramId)) {
      await renderScreen(
        ctx,
        buildEmptyState('🔒', t(ctx, 'admin_menu_title'), t(ctx, 'admin_access_denied')),
        { parse_mode: 'Markdown', reply_markup: mainMenu }
      );
      return;
    }
    if (requested === 'admin:sales') {
      await renderSalesMenu(ctx);
    } else if (showAdmin) {
      await renderScreen(ctx, await renderAdminHome(ctx), {
        parse_mode: 'Markdown',
        reply_markup: adminMenu,
      });
    } else if (requested === 'wallet') {
      await renderScreen(ctx, await renderWalletDashboard(ctx), {
        parse_mode: 'Markdown',
        reply_markup: walletMenu,
      });
    } else if (requested === 'shop') {
      await renderScreen(ctx, await renderShopMenuText(ctx), {
        parse_mode: 'Markdown',
        reply_markup: shopMenu,
      });
    } else {
      const dashboardText = await renderHomeDashboard(ctx);
      await renderScreen(ctx, dashboardText, {
        parse_mode: 'Markdown',
        reply_markup: mainMenu,
      });
    }
  });

  bot.callbackQuery('admin:sales:packages', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminManagePackagesConversation');
  });

  bot.callbackQuery('admin:sales:custom_volume', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminCustomVolumeConversation');
  });

  bot.callbackQuery('admin:sales:trial', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminTrialSettingsConversation');
  });

  bot.callbackQuery('admin:sales:promo', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoCenter(ctx);
  });

  bot.callbackQuery('admin:sales:referral', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminReferralSettingsConversation');
  });

  bot.callbackQuery('admin:sales:payment', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminPaymentSettingsConversation');
  });

  bot.callbackQuery('admin:sales:lucky_wheel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminLuckyWheelSettingsConversation');
  });

  // Free Trial Claim Handler
  bot.callbackQuery('trial:claim', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    if (!acquireUserActionCooldown(telegramId, 'trial-claim', 5_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

    let result;
    try {
      const target = await services.panelRegistry.resolveTarget();
      const configName = await services.configService.generateConfigName(
        telegramId,
        target.panelId
      );
      result = await services.trialService.claimTrial(
        telegramId,
        configName,
        target.panelId,
        target.serviceId
      );
    } catch {
      result = { success: false, messageKey: 'trial_creation_failed' };
    }

    if (!result.success) {
      await renderScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'trial_preview_heading'), t(ctx, result.messageKey)),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
      return;
    }

    const trialMessage = await ctx.reply(
      buildScreen({
        emoji: '🎉',
        title: t(ctx, 'trial_preview_heading'),
        subtitle: t(ctx, 'trial_success'),
        sections: [
          {
            emoji: '🔗',
            title: t(ctx, 'subscription_link_label'),
            fields: [
              {
                label: t(ctx, 'subscription_link_label'),
                value: result.subUrl
                  ? formatSubscriptionLink(result.subUrl, t(ctx, 'subscription_link_unavailable'))
                  : t(ctx, 'subscription_link_unavailable'),
              },
            ],
          },
        ],
        footer: t(ctx, 'trial_terms'),
      }),
      { parse_mode: 'Markdown' }
    );
    rememberArtifactMessage(ctx.session, trialMessage.message_id);
    await ctx.reply(t(ctx, 'navigation_continue_hint'), {
      reply_markup: backKeyboard(ctx, 'main'),
    });
  });

  // Wallet transaction statement pagination
  bot.callbackQuery(/^wallet:history:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderWalletStatementScreen(ctx, Number(ctx.match[1]) || 1);
  });

  // Direct top-up CTA from insufficient balance screen
  bot.callbackQuery('topup:direct', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('topupConversation');
  });

  // Return from an ephemeral checkout or insufficient-balance screen to the
  // live shop keyboard without discarding an active promo selection.
  bot.callbackQuery('shop:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderScreen(ctx, await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  // Clear pending promo code from shop
  bot.callbackQuery('shop:clear_promo', async (ctx) => {
    delete ctx.session.pendingPromo;
    await ctx.answerCallbackQuery({ text: t(ctx, 'promo_no_longer_usable') });
    await renderScreen(ctx, await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  // Dismiss / delete temporary popover message (e.g. QR photo)
  bot.callbackQuery('ui:dismiss', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery.message) {
      const messageId = ctx.callbackQuery.message.message_id;
      await safelyDeleteMessage(ctx, messageId);
      forgetUiMessage(ctx.session, messageId);
    }
  });

  bot.callbackQuery('ui:noop', async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // Fallback for a stale Cancel button after a conversation has already ended.
  bot.callbackQuery('conversation:cancel', async (ctx) => {
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    delete ctx.session.adminQuickTopup;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
    await renderScreen(
      ctx,
      buildEmptyState('↩️', t(ctx, 'operation_cancelled'), t(ctx, 'operation_cancelled')),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx) }
    );
  });
}
