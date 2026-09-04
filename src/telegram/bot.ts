import http from 'node:http';
import { Bot, webhookCallback } from 'grammy';
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

export interface WebhookServerHandle {
  server: http.Server;
  close: () => Promise<void>;
}

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

export async function clearWebhook(bot: Bot<MenuContext>): Promise<void> {
  logger.info('Ensuring any existing Telegram webhook is removed...');
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  logger.info('Telegram webhook successfully cleared');
}

export async function registerWebhook(bot: Bot<MenuContext>, config: Config): Promise<void> {
  if (!config.WEBHOOK_URL) {
    throw new Error('WEBHOOK_URL is required to register webhook');
  }
  if (!config.WEBHOOK_SECRET_TOKEN) {
    throw new Error('WEBHOOK_SECRET_TOKEN is required to register webhook');
  }

  logger.info(
    { url: config.WEBHOOK_URL, path: config.WEBHOOK_PATH },
    'Registering Telegram webhook...'
  );
  await bot.api.setWebhook(config.WEBHOOK_URL, {
    secret_token: config.WEBHOOK_SECRET_TOKEN,
    drop_pending_updates: false,
  });
  logger.info({ url: config.WEBHOOK_URL }, 'Telegram webhook registered successfully');
}

export function createWebhookHandler(
  bot: Bot<MenuContext>,
  config: Config
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const callback = webhookCallback(bot, 'http', {
    secretToken: config.WEBHOOK_SECRET_TOKEN,
  });
  const targetPath = config.WEBHOOK_PATH;

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const rawUrl = req.url ?? '/';
      const pathname = rawUrl.split('?')[0];

      if (
        req.method === 'GET' &&
        (pathname === '/health' ||
          pathname === '/healthz' ||
          pathname === '/ready' ||
          pathname === '/readyz')
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', mode: 'webhook' }));
        return;
      }

      if (pathname !== targetPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      await callback(req, res);
    } catch (err) {
      logger.error({ err }, 'Unhandled error in webhook request handler');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  };
}

export async function startWebhookServer(
  bot: Bot<MenuContext>,
  config: Config
): Promise<WebhookServerHandle> {
  const handler = createWebhookHandler(bot, config);
  const server = http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.WEBHOOK_PORT, config.WEBHOOK_HOST);
  });

  logger.info(
    { host: config.WEBHOOK_HOST, port: config.WEBHOOK_PORT, path: config.WEBHOOK_PATH },
    'Telegram webhook HTTP server running'
  );

  server.on('error', (err) => {
    logger.error({ err }, 'Telegram webhook HTTP server runtime error');
  });

  let isClosing = false;
  const close = async (): Promise<void> => {
    if (isClosing) return;
    isClosing = true;
    if (!server.listening) return;

    logger.info('Closing Telegram webhook HTTP server...');
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.warn('Webhook server close timed out; destroying active sockets');
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        resolve();
      }, 5_000);

      server.close((err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('Telegram webhook HTTP server closed gracefully');
  };

  return { server, close };
}

export async function startBot(bot: Bot<MenuContext>): Promise<void> {
  await clearWebhook(bot).catch((err) => {
    logger.warn({ err }, 'Could not remove existing Telegram webhook before starting long polling');
  });
  logger.info('Starting Telegram bot long-polling...');
  return bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'Bot started successfully');
    },
  });
}
