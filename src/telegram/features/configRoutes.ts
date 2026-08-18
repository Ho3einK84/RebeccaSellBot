/** Configuration management and subscription-link claim routes. */

import { InlineKeyboard, type Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { acquireUserActionCooldown } from '../middleware/actionCooldown.js';
import { logger } from '../../infra/logger.js';
import { observedContextLocale, t, tm } from '../locale.js';
import { backKeyboard, buildEmptyState, buildScreen, renderUiScreen } from '../ui.js';
import { callbackData } from '../callbackData.js';
import { buildSubscriptionActionKeyboard, showSubscriptionDetail } from './subscriptions/routes.js';
import { sanitizeTelegramInlineCode } from '../rendering.js';

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
      await renderConfigScreen(
        ctx,
        buildScreen({
          emoji: '🔑',
          title: t(ctx, 'subscription_revoke_title'),
          subtitle: t(ctx, 'subscription_revoke_subtitle'),
          primary: {
            emoji: '📱',
            label: t(ctx, 'subscription_connection_section'),
            value: `\`${sanitizeTelegramInlineCode(localConfig.configUsername)}\``,
          },
          footer: t(ctx, 'subscription_revoke_consequence'),
        }),
        new InlineKeyboard()
          .text(
            t(ctx, 'admin_confirm_button'),
            callbackData('config', 'revoke_confirm', localConfig.id)
          )
          .row()
          .text(t(ctx, 'menu_cancel'), callbackData('config', 'view', localConfig.id))
      );
      return;
    }
    // The legacy toggle did not encode the intended state. Refresh the modern
    // detail view rather than risking an inverse mutation from an old button.
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showSubscriptionDetail(ctx, localConfig.id, false);
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
      if (step === '_cancel') {
        await renderConfigScreen(
          ctx,
          buildEmptyState('↩️', t(ctx, 'config_delete_button'), t(ctx, 'operation_cancelled')),
          backKeyboard(ctx, 'main')
        );
        return;
      }
      // First tap only shows a warning; deletion requires an explicit confirm.
      const confirmMenu = new InlineKeyboard()
        .text(t(ctx, 'config_delete_confirm_button'), `config_delete_confirm:${configUsername}`)
        .text(t(ctx, 'config_delete_cancel_button'), `config_delete_cancel:${configUsername}`)
        .row()
        .text(t(ctx, 'menu_back'), 'nav:main');
      await renderConfigScreen(
        ctx,
        buildScreen({
          emoji: '⚠️',
          title: t(ctx, 'config_delete_button'),
          primary: {
            emoji: '📱',
            label: t(ctx, 'subscription_connection_section'),
            value: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
          },
          footer: tm(ctx, 'config_delete_warning', { username: configUsername }),
        }),
        confirmMenu
      );
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
      await renderConfigScreen(
        ctx,
        removed
          ? buildScreen({
              emoji: '✅',
              title: t(ctx, 'config_delete_button'),
              primary: {
                emoji: '📱',
                label: t(ctx, 'subscription_connection_section'),
                value: `\`${sanitizeTelegramInlineCode(configUsername)}\``,
              },
              footer: tm(ctx, 'config_deleted', { username: configUsername }),
            })
          : buildEmptyState(
              '⚠️',
              t(ctx, 'config_delete_button'),
              tm(ctx, 'config_delete_not_found', { username: configUsername })
            ),
        backKeyboard(ctx)
      );
    } catch (err) {
      logger.warn({ err, telegramId, configUsername }, 'Config permanent delete failed');
      await renderConfigScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'config_delete_button'), t(ctx, 'config_action_failed')),
        backKeyboard(ctx)
      );
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
          ctx.from.username ?? null,
          ctx.from.first_name ?? null,
          ctx.from.last_name ?? null,
          undefined,
          observedContextLocale(ctx)
        );
        const res = await services.configService.claimSubLink(ctx.from.id, subUrl);

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
          await ctx.reply(
            buildScreen({
              emoji: '✅',
              title: t(ctx, 'subscription_list_title'),
              primary: {
                emoji: '📱',
                label: t(ctx, 'subscription_connection_section'),
                value: `\`${sanitizeTelegramInlineCode(res.username)}\``,
              },
              footer: t(ctx, res.messageKey),
            }),
            { parse_mode: 'Markdown', reply_markup: managementMenu }
          );
        } else {
          await ctx.reply(
            buildEmptyState('⚠️', t(ctx, 'subscription_list_title'), t(ctx, res.messageKey)),
            { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
          );
        }
      } catch (err) {
        logger.warn(
          { telegramId: ctx.from.id, errorName: err instanceof Error ? err.name : typeof err },
          'Subscription link claim handler failed'
        );
        await ctx.reply(
          buildEmptyState('⚠️', t(ctx, 'subscription_list_title'), t(ctx, 'claim_handler_failed')),
          { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
        );
      }
      return;
    }

    return next();
  });
}

async function renderConfigScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderUiScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
