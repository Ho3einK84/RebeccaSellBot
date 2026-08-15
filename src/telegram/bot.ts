/** Telegram bot assembly and lifecycle. */

import { Bot } from 'grammy';
import type { Config } from '../infra/config.js';
import { logger } from '../infra/logger.js';
import type { BotServices, MenuContext } from './types.js';
import { configureBotRuntime } from './botRuntime.js';
import { registerCoreRoutes } from './features/coreRoutes.js';
import { t } from './locale.js';
import { backKeyboard, buildEmptyState } from './ui.js';

export { conversationContextMiddleware } from './botRuntime.js';

export function setupBot(config: Config, services: BotServices): Bot<MenuContext> {
  const bot = new Bot<MenuContext>(config.BOT_TOKEN);

  configureBotRuntime(bot, services);
  registerCoreRoutes(bot, services);

  // Global error handler — log and notify user without crashing.
  bot.catch(async (err) => {
    logger.error(
      {
        errorName: err.error instanceof Error ? err.error.name : typeof err.error,
        updateId: err.ctx?.update.update_id,
        updateKinds: err.ctx?.update
          ? Object.keys(err.ctx.update).filter((key) => key !== 'update_id')
          : [],
      },
      'Unhandled bot error'
    );
    if (err.ctx.callbackQuery) {
      await err.ctx
        .answerCallbackQuery({ text: t(err.ctx, 'button_action_failed'), show_alert: true })
        .catch(() => undefined);
    } else if (err.ctx.chat?.type === 'private') {
      await err.ctx
        .reply(
          buildEmptyState('⚠️', t(err.ctx, 'operation_failed'), t(err.ctx, 'operation_failed')),
          { parse_mode: 'Markdown', reply_markup: backKeyboard(err.ctx, 'main') }
        )
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
