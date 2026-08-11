/** Basic navigation, locale and command routes. */

import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import {
  mainMenu,
  renderHomeDashboard,
  renderShopMenuText,
  shopMenu,
} from '../keyboards/mainMenu.js';
import { adminMenu, renderAdminHome } from '../keyboards/adminMenu.js';
import { languageKeyboard } from '../keyboards/language.js';
import { logger } from '../../infra/logger.js';
import { formatSubscriptionLink, observedContextLocale, t, tm } from '../locale.js';
import { backKeyboard } from '../ui.js';

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
      await ctx.reply(t(ctx, 'admin_access_denied'));
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
      await ctx.reply(t(ctx, 'language_update_failed'), { reply_markup: backKeyboard(ctx) });
    }
  });

  bot.callbackQuery(/^nav:(home|main|admin)$/u, async (ctx) => {
    const requested = ctx.match[1];
    const telegramId = ctx.from.id;
    const showAdmin = requested === 'admin';
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    await ctx.answerCallbackQuery();
    if (showAdmin && !services.isAdmin(telegramId)) {
      await ctx.reply(t(ctx, 'admin_access_denied'), { reply_markup: mainMenu });
      return;
    }
    if (showAdmin) {
      await ctx.reply(renderAdminHome(ctx), { parse_mode: 'Markdown', reply_markup: adminMenu });
    } else {
      const dashboardText = await renderHomeDashboard(ctx);
      await ctx.reply(dashboardText, {
        parse_mode: 'Markdown',
        reply_markup: mainMenu,
      });
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

    const msg = t(ctx, result.messageKey);
    if (!result.success) {
      await ctx.reply(msg, { reply_markup: backKeyboard(ctx, 'main') });
      return;
    }

    if (result.subUrl) {
      await ctx.reply(
        `${msg}\n\n${tm(ctx, 'trial_subscription_url', {
          sub_url: formatSubscriptionLink(result.subUrl, t(ctx, 'subscription_link_unavailable')),
        })}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
    } else {
      await ctx.reply(msg, { reply_markup: backKeyboard(ctx, 'main') });
    }
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
    await ctx.reply(await renderShopMenuText(ctx), {
      parse_mode: 'Markdown',
      reply_markup: shopMenu,
    });
  });

  // Fallback for a stale Cancel button after a conversation has already ended.
  bot.callbackQuery('conversation:cancel', async (ctx) => {
    ctx.session.adminPanelAction = undefined;
    ctx.session.adminPanelId = undefined;
    ctx.session.adminPanelDraft = undefined;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_cancelled') });
    await ctx.reply(t(ctx, 'operation_cancelled'), { reply_markup: backKeyboard(ctx) });
  });
}
