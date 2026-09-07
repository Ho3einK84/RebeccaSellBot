import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import type { Config } from '../../infra/config.js';
import type { BotServices } from '../../telegram/types.js';
import { logger } from '../../infra/logger.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';

export interface WebAppServerHandle {
  server: FastifyInstance;
  close: () => Promise<void>;
}

export async function createWebAppServer(
  config: Config,
  services: BotServices
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // Logging is handled via central pino logger without credential leakage
    trustProxy: true,
  });

  const sessionSecret =
    config.ADMIN_SESSION_SECRET ||
    crypto.createHmac('sha256', config.BOT_TOKEN).update('WebAppSessionSecret').digest('hex');

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: sessionSecret,
  });

  await app.register(fastifyJwt, {
    secret: sessionSecret,
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Health check endpoint on webapp port
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', component: 'webapp' });
  });

  // REST API Routes
  registerAuthRoutes(app, {
    botToken: config.BOT_TOKEN,
    adminService: services.adminService,
    userService: services.userService,
    translationService: services.translationService,
  });

  registerAdminRoutes(app, {
    walletService: services.walletService,
    userService: services.userService,
    panelRegistry: services.panelRegistry,
  });

  // Static files & SPA fallback
  const staticRoot = path.resolve(process.cwd(), 'dist/webapp');
  if (fs.existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
      allowedPath: (pathname) => {
        // Prevent accidental leaking of server artifacts
        return !pathname.startsWith('/server') && !pathname.endsWith('.ts');
      },
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  } else {
    // If static files have not been built yet (e.g. testing)
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply
          .code(200)
          .type('text/html')
          .send('<!DOCTYPE html><html><body>WebApp building...</body></html>');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

export async function startWebAppServer(
  config: Config,
  services: BotServices
): Promise<WebAppServerHandle> {
  const server = await createWebAppServer(config, services);

  await server.listen({
    port: config.WEBAPP_PORT,
    host: config.WEBAPP_HOST,
  });

  logger.info(
    { host: config.WEBAPP_HOST, port: config.WEBAPP_PORT, url: config.WEBAPP_URL },
    'Telegram Mini App Fastify server running'
  );

  let isClosing = false;
  const close = async (): Promise<void> => {
    if (isClosing) return;
    isClosing = true;
    logger.info('Closing Telegram Mini App Fastify server...');
    await server.close();
    logger.info('Telegram Mini App Fastify server closed gracefully');
  };

  return { server, close };
}
