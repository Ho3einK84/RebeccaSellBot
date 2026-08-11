/** Basic navigation, locale and command routes. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import {
  mainMenu,
  renderHomeDashboard,
  renderShopMenuText,
  shopMenu,
  renderWalletDashboard,
  walletMenu,
} from '../keyboards/mainMenu.js';
import { adminMenu, renderAdminHome } from '../keyboards/adminMenu.js';
import { languageKeyboard } from '../keyboards/language.js';
import { logger } from '../../infra/logger.js';
import { formatSubscriptionLink, observedContextLocale, t } from '../locale.js';
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  rememberArtifactMessage,
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

    await services.walletService.getOrCreateUser(
      telegramId,
      ctx.from?.username,
      ctx.from?.first_name,
      ctx.from?.last_name,
      referralCode,
      observedContextLocale(ctx),
      referralCode ? 'telegram_referral_start' : 'telegram_start'
    );

    if (isFirstVisit) {
      await ctx.reply(t(ctx, 'onboarding_welcome'), {
        parse_mode: 'Markdown',
        reply_markup: languageKeyboard(ctx, 'main'),
      });
      return;
    }

    const dashboardText = await renderHomeDashboard(ctx);
    await ctx.reply(dashboardText, {
      parse_mode: 'Markdown',
      reply_markup: mainMenu,
    });
  });

  // /admin — explicit admin menu command
  bot.command('admin', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !services.isAdmin(telegramId)) {
      await ctx.reply(
        buildEmptyState('🔒', t(ctx, 'admin_menu_title'), t(ctx, 'admin_access_denied')),
        { parse_mode: 'Markdown', reply_markup: mainMenu }
      );
      return;
    }
    await ctx.reply(renderAdminHome(ctx), { parse_mode: 'Markdown', reply_markup: adminMenu });
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
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
        undefined,
        locale
      );
      await services.userService.updateLocale(telegramId, locale);
      ctx.userLocale = locale;
      const dashboardText = await renderHomeDashboard(ctx);
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(dashboardText, {
          parse_mode: 'Markdown',
          reply_markup: mainMenu,
        });
      } else {
        await ctx.reply(dashboardText, { parse_mode: 'Markdown', reply_markup: mainMenu });
      }
    } catch (err) {
      logger.error(
        { err, telegramId, locale },
        'Failed to save selected Telegram language preference'
      );
      await renderBaseScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'language_selection_title'), t(ctx, 'language_update_failed')),
        backKeyboard(ctx),
        'Markdown'
      );
    }
  });

  bot.callbackQuery(/^nav:(home|main|admin|wallet|shop)$/u, async (ctx) => {
    const requested = ctx.match[1];
    const telegramId = ctx.from.id;
    const showAdmin = requested === 'admin';
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    await ctx.answerCallbackQuery();
    if (showAdmin && !services.isAdmin(telegramId)) {
      await renderBaseScreen(
        ctx,
        buildEmptyState('🔒', t(ctx, 'admin_menu_title'), t(ctx, 'admin_access_denied')),
        mainMenu,
        'Markdown'
      );
      return;
    }
    if (showAdmin) {
      await renderBaseScreen(ctx, renderAdminHome(ctx), adminMenu, 'Markdown');
    } else if (requested === 'wallet') {
      await renderBaseScreen(ctx, await renderWalletDashboard(ctx), walletMenu, 'Markdown');
    } else if (requested === 'shop') {
      await renderBaseScreen(ctx, await renderShopMenuText(ctx), shopMenu, 'Markdown');
    } else {
      const dashboardText = await renderHomeDashboard(ctx);
      await renderBaseScreen(ctx, dashboardText, mainMenu, 'Markdown');
    }
  });

  // Free Trial Claim Handler
  bot.callbackQuery('trial:claim', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
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
      await renderBaseScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'trial_preview_heading'), t(ctx, result.messageKey)),
        backKeyboard(ctx, 'main'),
        'Markdown'
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
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
    );
    rememberArtifactMessage(ctx.session, trialMessage.message_id);
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
    await ctx.editMessageText(await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  // Clear pending promo code from shop
  bot.callbackQuery('shop:clear_promo', async (ctx) => {
    delete ctx.session.pendingPromo;
    await ctx.answerCallbackQuery({ text: t(ctx, 'promo_no_longer_usable') });
    await renderBaseScreen(ctx, await renderShopMenuText(ctx), shopMenu, 'Markdown');
  });

  // Dismiss / delete temporary popover message (e.g. QR photo)
  bot.callbackQuery('ui:dismiss', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery.message) {
      await safelyDeleteMessage(ctx, ctx.callbackQuery.message.message_id);
    }
  });

  // Fallback for a stale Cancel button after a conversation has already ended.
  bot.callbackQuery('conversation:cancel', async (ctx) => {
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
    await renderBaseScreen(
      ctx,
      buildEmptyState('↩️', t(ctx, 'operation_cancelled'), t(ctx, 'operation_cancelled')),
      backKeyboard(ctx),
      'Markdown'
    );
  });
}

type ScreenReplyMarkup = NonNullable<Parameters<MenuContext['editMessageText']>[1]>['reply_markup'];

async function renderBaseScreen(
  ctx: MenuContext,
  text: string,
  replyMarkup: ScreenReplyMarkup,
  parseMode?: 'Markdown'
): Promise<void> {
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      ...(parseMode ? { parse_mode: parseMode } : {}),
      reply_markup: replyMarkup,
    });
    return;
  }
  await ctx.reply(text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: replyMarkup,
  });
}
