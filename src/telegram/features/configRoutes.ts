/** Configuration management and subscription-link claim routes. */

import { InlineKeyboard, type Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { acquireUserActionCooldown } from '../middleware/actionCooldown.js';
import { logger } from '../../infra/logger.js';
import { observedContextLocale, t, tm } from '../locale.js';
import { backKeyboard } from '../ui.js';
import { callbackData } from '../callbackData.js';
import { buildSubscriptionActionKeyboard } from './subscriptions/routes.js';

export function registerConfigRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery(/^config_(toggle|revoke):(.+)$/, async (ctx) => {
    const telegramId = ctx.from.id;
    const action = ctx.match[1]!;
    const configUsername = ctx.match[2]!;
    const localConfig = await services.configService.getOwnedConfigByUsername(
      telegramId,
      configUsername
    );
    if (!localConfig) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
      return;
    }
    if (action === 'revoke') {
      await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
      await ctx.reply(
        t(ctx, 'subscription_revoke_confirm', { username: localConfig.configUsername }),
        {
          reply_markup: new InlineKeyboard()
            .text(
              t(ctx, 'admin_confirm_button'),
              callbackData('config', 'revoke_confirm', localConfig.id)
            )
            .row()
            .text(t(ctx, 'menu_cancel'), callbackData('config', 'view', localConfig.id)),
        }
      );
      return;
    }
    if (!acquireUserActionCooldown(telegramId, `config-${action}`, 1_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: false });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      const remote = await services.panelRegistry
        .getService(localConfig.panelId)
        .getUser(configUsername);
      if (remote.status === 'disabled') {
        await services.configService.enableConfig(configUsername, localConfig.panelId);
        await ctx.reply(t(ctx, 'subscription_enabled'), { reply_markup: backKeyboard(ctx) });
      } else {
        await services.configService.disableConfig(configUsername, localConfig.panelId);
        await ctx.reply(t(ctx, 'subscription_disabled'), { reply_markup: backKeyboard(ctx) });
      }
    } catch (err) {
      logger.warn({ err, telegramId, configUsername, action }, 'Config management action failed');
      await ctx.reply(t(ctx, 'config_action_failed'), { reply_markup: backKeyboard(ctx) });
    }
  });

  bot.callbackQuery(/^config_delete(_confirm|_cancel)?:(.+)$/, async (ctx) => {
    const telegramId = ctx.from.id;
    const step = (ctx.match[1] ?? 'prompt') as 'prompt' | '_confirm' | '_cancel';
    const configUsername = ctx.match[2]!;

    const isAdmin = services.isAdmin(telegramId);
    const localConfig = isAdmin
      ? await services.configService.getConfigByUsername(configUsername)
      : await services.configService.getOwnedConfigByUsername(telegramId, configUsername);
    if (!localConfig) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
      return;
    }

    if (step === '_cancel' || step === 'prompt') {
      await ctx.answerCallbackQuery();
      if (step === '_cancel') return;
      // First tap only shows a warning; deletion requires an explicit confirm.
      const confirmMenu = new InlineKeyboard()
        .text(t(ctx, 'config_delete_confirm_button'), `config_delete_confirm:${configUsername}`)
        .text(t(ctx, 'config_delete_cancel_button'), `config_delete_cancel:${configUsername}`)
        .row()
        .text(t(ctx, 'menu_back'), 'nav:main');
      await ctx.reply(tm(ctx, 'config_delete_warning', { username: configUsername }), {
        parse_mode: 'Markdown',
        reply_markup: confirmMenu,
      });
      return;
    }

    // Confirmed deletion.
    if (!acquireUserActionCooldown(telegramId, `config-delete:${configUsername}`, 1_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: false });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      const removed = await services.configService.deleteConfigCompletely(
        configUsername,
        localConfig.panelId
      );
      await ctx.reply(
        removed
          ? tm(ctx, 'config_deleted', { username: configUsername })
          : tm(ctx, 'config_delete_not_found', { username: configUsername }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx) }
      );
    } catch (err) {
      logger.warn({ err, telegramId, configUsername }, 'Config permanent delete failed');
      await ctx.reply(t(ctx, 'config_action_failed'), { reply_markup: backKeyboard(ctx) });
    }
  });

  // Smart sub-link detection on plain text
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    const subUrl = services.configService.extractSubUrl(text);

    if (subUrl && ctx.from?.id) {
      try {
        // A link can be the user's first interaction (without /start). Ensure
        // the local FK owner exists before ConfigService attempts its atomic
        // permanent binding.
        await services.walletService.getOrCreateUser(
          ctx.from.id,
          ctx.from.username,
          ctx.from.first_name,
          ctx.from.last_name,
          undefined,
          observedContextLocale(ctx)
        );
        const res = await services.configService.claimSubLink(ctx.from.id, subUrl);
        const msg = t(ctx, res.messageKey);

        if (res.success && res.username) {
          const owned = await services.configService.getOwnedConfigByUsername(
            ctx.from.id,
            res.username,
            res.panelId
          );
          const managementMenu = owned
            ? buildSubscriptionActionKeyboard(ctx, owned.id, owned.panelStatus ?? 'active')
                .row()
                .text(t(ctx, 'menu_back'), 'nav:main')
            : backKeyboard(ctx, 'main');
          await ctx.reply(msg, { reply_markup: managementMenu });
        } else {
          await ctx.reply(msg, { reply_markup: backKeyboard(ctx, 'main') });
        }
      } catch (err) {
        logger.warn(
          { telegramId: ctx.from.id, errorName: err instanceof Error ? err.name : typeof err },
          'Subscription link claim handler failed'
        );
        await ctx.reply(t(ctx, 'claim_handler_failed'), {
          reply_markup: backKeyboard(ctx, 'main'),
        });
      }
      return;
    }

    return next();
  });
}
