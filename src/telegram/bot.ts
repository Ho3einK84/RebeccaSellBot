/** Telegram bot assembly and lifecycle. */

import { Bot } from 'grammy';
import type { Config } from '../infra/config.js';
import { logger } from '../infra/logger.js';
import type { BotServices, MenuContext } from './types.js';
import { configureBotRuntime } from './botRuntime.js';
import { registerCoreRoutes } from './features/coreRoutes.js';
import { t } from './locale.js';
import { backKeyboard, buildEmptyState } from './ui.js';
import { extractBotErrorDiagnostics } from './telegramLogging.js';
import { RebeccaOriginDownError } from '../domain/services/RebeccaService.js';

export { conversationContextMiddleware } from './botRuntime.js';

export function setupBot(config: Config, services: BotServices): Bot<MenuContext> {
  const bot = new Bot<MenuContext>(config.BOT_TOKEN);

  configureBotRuntime(bot, services);
  registerCoreRoutes(bot, services);

  // Global error handler — log and notify user without crashing.
  bot.catch(async (err) => {
    logger.error(extractBotErrorDiagnostics(err), 'Unhandled bot error');
    const isOriginDown =
      err.error instanceof RebeccaOriginDownError ||
      (err.error instanceof Error &&
        (err.error.name === 'RebeccaOriginDownError' ||
          (err.error.cause instanceof Error && err.error.cause.name === 'RebeccaOriginDownError')));
    const alertMessage = isOriginDown
      ? t(err.ctx, 'panel_origin_down_user_notice')
      : t(err.ctx, 'button_action_failed');
    const replyMessage = isOriginDown
      ? t(err.ctx, 'panel_origin_down_user_notice')
      : t(err.ctx, 'operation_failed');

    if (err.ctx.callbackQuery) {
      await err.ctx
        .answerCallbackQuery({ text: alertMessage, show_alert: true })
        .catch(() => undefined);
    } else if (err.ctx.chat?.type === 'private') {
      await err.ctx
        .reply(buildEmptyState('⚠️', replyMessage, replyMessage), {
          parse_mode: 'Markdown',
          reply_markup: backKeyboard(err.ctx, 'main'),
        })
        .catch(() => undefined);
    }
  });

  return bot;
}

export async function initializeBot(bot: Bot<MenuContext>): Promise<void> {
  logger.info('Validating Telegram bot token and connectivity...');
  await bot.init();
  const botInfo = bot.botInfo;
  logger.info({ username: botInfo.username }, 'Telegram bot initialization succeeded');
}

export function startBot(bot: Bot<MenuContext>): Promise<void> {
  logger.info('Starting Telegram bot long-polling...');
  return bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'Bot started successfully');
    },
  });
}
