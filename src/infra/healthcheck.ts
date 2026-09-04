import http from 'node:http';
import { sql } from 'drizzle-orm';
import { logger } from './logger.js';
import { getDb } from './db.js';

type HealthState = 'starting' | 'ready' | 'stopping' | 'failed';

interface HealthSnapshot {
  state: HealthState;
  phase: string;
  startedAt: string;
  updatedAt: string;
  errorName?: string;
}

let server: http.Server | null = null;
let serverPort: number | null = null;
let snapshot: HealthSnapshot = createInitialSnapshot();

export type HttpFallbackHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => Promise<boolean>;

let fallbackHandler: HttpFallbackHandler | null = null;

export function registerHealthCheckFallbackHandler(handler: HttpFallbackHandler | null): void {
  fallbackHandler = handler;
}

export function getHealthCheckServer(): http.Server | null {
  return server;
}

export function isHealthCheckServerRunningOn(port: number): boolean {
  return Boolean(server?.listening && serverPort === port);
}

function createInitialSnapshot(): HealthSnapshot {
  const now = new Date().toISOString();
  return {
    state: 'starting',
    phase: 'boot',
    startedAt: now,
    updatedAt: now,
  };
}

function updateSnapshot(update: Partial<HealthSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

export function setHealthPhase(phase: string): void {
  updateSnapshot({ state: 'starting', phase, errorName: undefined });
}

export function markHealthReady(): void {
  updateSnapshot({ state: 'ready', phase: 'running', errorName: undefined });
}

export function markHealthStopping(): void {
  updateSnapshot({ state: 'stopping', phase: 'shutdown' });
}

export function markHealthFailed(error: unknown): void {
  updateSnapshot({
    state: 'failed',
    phase: 'startup_failed',
    errorName: error instanceof Error ? error.name : typeof error,
  });
}

export async function startHealthCheckServer(port: number): Promise<http.Server> {
  if (server) return server;
  snapshot = createInitialSnapshot();

  server = http.createServer((req, res) => {
    void handleHealthRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server?.off('listening', onListening);
      serverPort = null;
      reject(error);
    };
    const onListening = () => {
      server?.off('error', onError);
      serverPort = port;
      resolve();
    };
    server!.once('error', onError);
    server!.once('listening', onListening);
    server!.listen(port, '127.0.0.1');
  });
  logger.info({ port }, 'Health check HTTP server running (internal only)');
  server.on('error', (err) => {
    logger.error({ err, port }, 'Health check HTTP server failed');
  });

  return server;
}

async function handleHealthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0].replace(/\/+$/, '') || '/';
    const body = JSON.stringify({
      ...snapshot,
      uptime: process.uptime(),
    });

    if (
      pathname === '/health' ||
      pathname === '/healthz' ||
      pathname.endsWith('/health') ||
      pathname.endsWith('/healthz')
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (
      pathname === '/ready' ||
      pathname === '/readyz' ||
      pathname.endsWith('/ready') ||
      pathname.endsWith('/readyz')
    ) {
      const databaseReady = snapshot.state === 'ready' && (await probeDatabase());
      res.writeHead(databaseReady ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      res.end(body);
      return;
    }

    if (fallbackHandler) {
      const handled = await fallbackHandler(req, res);
      if (handled) return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...snapshot, database: 'unavailable' }));
  }
}

async function probeDatabase(): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('DB_HEALTH_TIMEOUT')), 2_000);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function stopHealthCheckServer(): Promise<void> {
  const activeServer = server;
  server = null;
  serverPort = null;
  fallbackHandler = null;
  if (!activeServer?.listening) return;
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => (error ? reject(error) : resolve()));
  });
}
