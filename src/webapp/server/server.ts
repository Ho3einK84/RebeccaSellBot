import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import type { Config } from '../../infra/config.js';
import type { BotServices } from '../../telegram/types.js';
import { DomainRegistryService } from '../../domain/services/DomainRegistryService.js';
import { logger } from '../../infra/logger.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerUserRoutes } from './routes/userRoutes.js';

export interface WebAppServerHandle {
  server: FastifyInstance;
  close: () => Promise<void>;
}

/**
 * Resolves trusted proxy configuration constrained to the actual proxy hop
 * behind Caddy (loopback and RFC1918 private subnets).
 */
export function resolveTrustProxy(config: Config): boolean | string | string[] {
  const explicit = (config as unknown as Record<string, unknown>).TRUST_PROXY;
  if (explicit !== undefined) {
    if (explicit === true || explicit === 'true') return true;
    if (explicit === false || explicit === 'false') return false;
    if (typeof explicit === 'string') {
      const parts = explicit
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return parts.length === 1 ? parts[0] : parts;
    }
  }
  return ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
}

/**
 * Build a CORS allowlist from the configured public origins.
 * Fail-closed: returns an empty array when no public origins are configured.
 */
export function resolveCorsAllowlist(config: Config): string[] {
  const origins = new Set<string>();
  for (const raw of [config.WEBAPP_URL, config.WEBHOOK_URL]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // ignore unparseable URLs; validation lives in config schema
    }
  }
  return [...origins];
}

/**
 * Resolve CORS options for Fastify.
 * Fail-closed:
 *  - empty allowlist => CORS disabled (origin: false, credentials: false)
 *  - configured allowlist => matching origins allowed with credentials: true
 *  - wildcard (*) => strictly opt-in and WITHOUT credentials
 */
export function resolveCorsOptions(config: Config): {
  origin: string[] | string | boolean;
  credentials: boolean;
} {
  const allowlist = resolveCorsAllowlist(config);
  const allowWildcard =
    (config as unknown as Record<string, unknown>).CORS_ALLOW_ALL === true ||
    (config as unknown as Record<string, unknown>).CORS_ALLOW_ALL === 'true';

  if (allowWildcard) {
    return {
      origin: '*',
      credentials: false,
    };
  }

  if (allowlist.length > 0) {
    return {
      origin: allowlist,
      credentials: true,
    };
  }

  return {
    origin: false,
    credentials: false,
  };
}

/**
 * Extracts verified client identity for rate limiting (authenticated telegramId or fallback IP).
 */
export function extractClientIdentity(req: FastifyRequest): string {
  if (req.userSession?.telegramId) {
    return `user:${req.userSession.telegramId}`;
  }
  const token =
    req.cookies?.session ||
    (req.headers?.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined);

  if (token && req.server.jwt) {
    try {
      const decoded = req.server.jwt.decode(token) as { telegramId?: number } | null;
      if (decoded && Number.isSafeInteger(decoded.telegramId)) {
        return `user:${decoded.telegramId}`;
      }
    } catch {
      // Fallback to IP on unparseable token
    }
  }

  const clientIp = req.ip || req.raw.socket.remoteAddress || '127.0.0.1';
  return `ip:${clientIp}`;
}

/**
 * Pre-route, per-identity rate limit key generator.
 */
export function resolveRateLimitKey(req: FastifyRequest): string {
  const route = req.routeOptions?.url ?? req.raw.url?.split('?')[0] ?? 'unknown';
  const identity = extractClientIdentity(req);
  return `${route}:${identity}`;
}

export async function createWebAppServer(
  config: Config,
  services: BotServices
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // Logging is handled via central pino logger without credential leakage
    trustProxy: resolveTrustProxy(config),
  });

  const sessionSecret =
    config.ADMIN_SESSION_SECRET ||
    crypto.createHmac('sha256', config.BOT_TOKEN).update('WebAppSessionSecret').digest('hex');

  await app.register(fastifyCors, resolveCorsOptions(config));

  await app.register(fastifyCookie, {
    secret: sessionSecret,
  });

  await app.register(fastifyJwt, {
    secret: sessionSecret,
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: resolveRateLimitKey,
  });

  const domainRegistry =
    services.domainRegistryService ?? new DomainRegistryService(config.REGISTRY_DIR);

  // Multi-instance mesh reverse proxy dispatcher
  // When Caddy's catch-all reverse proxies traffic to this primary container,
  // transparently stream and dispatch requests intended for peer instances.
  app.addHook('onRequest', async (req, reply) => {
    // Caddy TLS verification endpoint is always handled locally
    if (req.raw.url?.startsWith('/api/caddy-check')) {
      return;
    }

    const hostHeader = req.headers.host;
    if (!hostHeader) return;
    const incomingHost = hostHeader.split(':')[0].trim().toLowerCase();

    // Check if the request is destined for this local instance
    const localWebAppUrl =
      services.translationService?.getSetting('webapp_url') || config.WEBAPP_URL;
    let localDomain: string | undefined;
    if (localWebAppUrl) {
      try {
        localDomain = new URL(localWebAppUrl).hostname.toLowerCase();
      } catch {
        // ignore invalid URL format
      }
    }

    let localWebhookDomain: string | undefined;
    if (config.WEBHOOK_URL) {
      try {
        localWebhookDomain = new URL(config.WEBHOOK_URL).hostname.toLowerCase();
      } catch {
        // ignore invalid URL format
      }
    }

    const isLocal =
      incomingHost === 'localhost' ||
      incomingHost === '127.0.0.1' ||
      incomingHost === '0.0.0.0' ||
      (localDomain && incomingHost === localDomain) ||
      (localWebhookDomain && incomingHost === localWebhookDomain);

    if (isLocal) {
      return;
    }

    // Check if the domain belongs to a peer instance in the shared registry
    const peerRecord = domainRegistry.findByDomain(incomingHost);
    if (!peerRecord) {
      return;
    }

    // Never proxy to ourselves
    if (peerRecord.instance === config.INSTANCE_NAME) {
      return;
    }

    // Guard against circular proxy loops
    const currentHops = Number(req.headers['x-rsbot-proxy-hops'] || 0);
    if (currentHops >= 3) {
      return reply.code(508).send({ error: 'Loop detected across instance reverse proxies' });
    }

    reply.hijack();

    let targetUrl: URL;
    try {
      targetUrl = new URL(peerRecord.target);
    } catch {
      reply.raw.writeHead(502, { 'content-type': 'application/json' });
      reply.raw.end(JSON.stringify({ error: `Invalid peer target URL: ${peerRecord.target}` }));
      return;
    }

    const proxyReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: req.raw.url,
        method: req.raw.method,
        headers: {
          ...req.raw.headers,
          host: hostHeader,
          'x-forwarded-host': hostHeader,
          'x-forwarded-for': req.ip || req.raw.socket.remoteAddress || '',
          'x-forwarded-proto': 'https',
          'x-rsbot-proxy-hops': String(currentHops + 1),
        },
      },
      (proxyRes) => {
        reply.raw.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(reply.raw);
      }
    );

    proxyReq.on('error', (err) => {
      logger.warn(
        { err: err.message, target: peerRecord.target, host: incomingHost },
        'Multi-instance mesh proxy request failed'
      );
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            error: `Target instance '${peerRecord.instance}' is temporarily unreachable`,
            details: err.message,
          })
        );
      }
    });

    req.raw.pipe(proxyReq);
  });

  // Health check endpoint on webapp port
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', component: 'webapp' });
  });

  // Caddy On-Demand TLS verification endpoint
  // Caddy calls: GET /api/caddy-check?domain=...
  // Returns HTTP 200 if the domain is authorized to obtain an SSL certificate, or 403 otherwise.
  app.get('/api/caddy-check', async (req, reply) => {
    const domainQuery = (req.query as { domain?: string })?.domain?.toLowerCase().trim();
    if (!domainQuery) {
      return reply.code(400).send({ error: 'Missing domain parameter' });
    }

    const configuredWebAppUrl =
      services.translationService?.getSetting('webapp_url') || config.WEBAPP_URL;

    let allowedHost: string | undefined;
    if (configuredWebAppUrl) {
      try {
        allowedHost = new URL(configuredWebAppUrl).hostname.toLowerCase();
      } catch {
        // invalid URL format ignored
      }
    }

    let webhookHost: string | undefined;
    if (config.WEBHOOK_URL) {
      try {
        webhookHost = new URL(config.WEBHOOK_URL).hostname.toLowerCase();
      } catch {
        // invalid URL format ignored
      }
    }

    if (
      (allowedHost && domainQuery === allowedHost) ||
      (webhookHost && domainQuery === webhookHost)
    ) {
      return reply.code(200).send({ allowed: true, domain: domainQuery });
    }

    // Check shared multi-instance registry for peer bot domains
    const registeredPeer = domainRegistry.findByDomain(domainQuery);
    if (registeredPeer) {
      return reply.code(200).send({
        allowed: true,
        domain: domainQuery,
        instance: registeredPeer.instance,
      });
    }

    return reply.code(403).send({ allowed: false, domain: domainQuery });
  });

  // REST API Routes
  registerAuthRoutes(app, {
    botToken: config.BOT_TOKEN,
    botUsername: services.botUsername,
    adminService: services.adminService,
    userService: services.userService,
    translationService: services.translationService,
    // `secure: true` cookies are rejected by browsers over plain HTTP, which
    // broke session login on local dev. Only require Secure in production.
    secureCookies: config.NODE_ENV === 'production',
  });

  registerAdminRoutes(app, {
    walletService: services.walletService,
    userService: services.userService,
    configService: services.configService,
    pricingService: services.pricingService,
    panelRegistry: services.panelRegistry,
    botToken: config.BOT_TOKEN,
    adminService: services.adminService,
    adminIds: services.adminIds,
    botApi: services.botApi,
    translationService: services.translationService,
  });

  registerUserRoutes(app, {
    userService: services.userService,
    walletService: services.walletService,
    configService: services.configService,
    pricingService: services.pricingService,
    translationService: services.translationService,
    botUsername: services.botUsername,
    purchaseCheckoutService: services.purchaseCheckoutService,
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
