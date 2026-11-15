import http from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCachedPublicIpForTesting,
  fetchServerPublicIp,
  probeDomainHealth,
} from '../../src/infra/networkProbe.js';
import * as dbModule from '../../src/infra/db.js';
import {
  getHealthCheckServer,
  isHealthCheckServerRunningOn,
  markHealthFailed,
  markHealthReady,
  markHealthStopping,
  registerHealthCheckFallbackHandler,
  setHealthPhase,
  startHealthCheckServer,
  stopHealthCheckServer,
} from '../../src/infra/healthcheck.js';
import { downloadTelegramFile } from '../../src/infra/telegramFiles.js';
import {
  activateDynamicWebApp,
  createRebeccaWebhookRequestHandler,
  resolveStartupWebAppState,
} from '../../src/index.js';

describe('networkProbe — IP discovery, TTL cache expiry, and domain health probes', () => {
  beforeEach(() => {
    clearCachedPublicIpForTesting();
  });

  afterEach(() => {
    clearCachedPublicIpForTesting();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns SERVER_PUBLIC_IP or HOST_IP without calling remote services', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('SERVER_PUBLIC_IP', '203.0.113.10');
    expect(await fetchServerPublicIp()).toBe('203.0.113.10');

    vi.stubEnv('SERVER_PUBLIC_IP', undefined as unknown as string);
    vi.stubEnv('HOST_IP', '198.51.100.20');
    expect(await fetchServerPublicIp()).toBe('198.51.100.20');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates IPv4 strictly, cancels non-OK streams, expires TTL cache cleanly, and returns null on stale miss', async () => {
    vi.useFakeTimers();
    const cancelSpy = vi.fn(async () => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        body: { cancel: cancelSpy },
      } as unknown as Response)
      .mockResolvedValueOnce(new Response('01.02.03.04', { status: 200 }))
      .mockResolvedValueOnce(new Response('203.0.113.77\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchServerPublicIp()).toBe('203.0.113.77');
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    expect(await fetchServerPublicIp()).toBe('203.0.113.77');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 }))
    );
    expect(await fetchServerPublicIp()).toBeNull();
  });

  it('probes domain /api/health endpoint accurately for healthy, error status, and network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'ok', component: 'webapp' }), { status: 200 })
      )
    );
    expect(await probeDomainHealth('https://app.example.com', 1000)).toEqual({
      ok: true,
      status: 200,
      data: { status: 'ok', component: 'webapp' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 502 }))
    );
    expect((await probeDomainHealth('https://app.example.com', 1000)).ok).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    const failed = await probeDomainHealth('https://app.example.com', 1000);
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('ECONNREFUSED');
  });
});

describe('healthcheck — live HTTP lifecycle, ephemeral port resolution, and listen-error cleanup', () => {
  afterEach(async () => {
    registerHealthCheckFallbackHandler(null);
    await stopHealthCheckServer();
    vi.restoreAllMocks();
  });

  it('binds ephemeral port 0, serves /healthz and /readyz DB-aware transitions, and invokes fallback handler', async () => {
    await startHealthCheckServer(0);
    const server = getHealthCheckServer();
    expect(server).not.toBeNull();
    const boundPort = (server!.address() as { port: number }).port;
    expect(boundPort).toBeGreaterThan(0);
    expect(isHealthCheckServerRunningOn(boundPort)).toBe(true);

    setHealthPhase('database_migrations');
    const preReady = await fetch(`http://127.0.0.1:${boundPort}/readyz`);
    expect(preReady.status).toBe(503);
    expect((await preReady.json()) as Record<string, unknown>).toMatchObject({
      phase: 'database_migrations',
    });

    // When ready state is reached but database pool is down -> still 503
    markHealthReady();
    expect((await fetch(`http://127.0.0.1:${boundPort}/readyz`)).status).toBe(503);

    // When database responds to SELECT 1 -> 200
    vi.spyOn(dbModule, 'getDb').mockReturnValue({
      execute: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
    } as never);
    expect((await fetch(`http://127.0.0.1:${boundPort}/readyz`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${boundPort}/healthz`)).status).toBe(200);

    markHealthStopping();
    expect((await fetch(`http://127.0.0.1:${boundPort}/readyz`)).status).toBe(503);

    markHealthFailed(new Error('boot failure'));
    expect((await fetch(`http://127.0.0.1:${boundPort}/readyz`)).status).toBe(503);

    registerHealthCheckFallbackHandler(async (req, res) => {
      if (req.url === '/custom') {
        res.writeHead(202, { 'Content-Type': 'text/plain' });
        res.end('accepted');
        return true;
      }
      return false;
    });
    const customRes = await fetch(`http://127.0.0.1:${boundPort}/custom`);
    expect(customRes.status).toBe(202);
    expect(await customRes.text()).toBe('accepted');
    expect((await fetch(`http://127.0.0.1:${boundPort}/missing`)).status).toBe(404);
  });

  it('does not cache broken server state when listen fails with EADDRINUSE', async () => {
    const blocker = http.createServer((_req, res) => res.end('busy'));
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const busyPort = (blocker.address() as { port: number }).port;

    try {
      await expect(startHealthCheckServer(busyPort, '127.0.0.1')).rejects.toThrow();
      expect(getHealthCheckServer()).toBeNull();
      expect(isHealthCheckServerRunningOn(busyPort)).toBe(false);

      await startHealthCheckServer(0, '127.0.0.1');
      expect(getHealthCheckServer()).not.toBeNull();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe('telegramFiles — download validation, MIME sniffing, path safety, and byte ceilings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads valid PNG receipt and sniffs safe image content-type over application/octet-stream', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(pngBytes, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          })
        )
    );

    const res = await downloadTelegramFile('bot-token', 'file-id-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.contentType).toBe('image/png');
      expect(res.buffer.equals(pngBytes)).toBe(true);
    }
  });

  it('rejects empty inputs, path traversal, oversized bodies, and neutralizes SVG/HTML XSS payloads', async () => {
    expect(await downloadTelegramFile('', 'id')).toEqual({
      ok: false,
      error: 'Could not load receipt photo from Telegram',
    });

    // 1. Traversal in file_path fails closed
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, result: { file_path: '../etc/passwd' } }), {
            status: 200,
          })
      )
    );
    expect(await downloadTelegramFile('bot-token', 'bad-path')).toEqual({
      ok: false,
      error: 'Could not load receipt photo from Telegram',
    });

    // 2. Oversized Content-Length header cancels stream and returns error
    const cancelSpy = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/big.jpg' } }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Length': '50000' }),
          body: { cancel: cancelSpy },
        } as unknown as Response)
    );
    expect(await downloadTelegramFile('bot-token', 'big-id', { maxBytes: 1024 })).toEqual({
      ok: false,
      error: 'Failed to download receipt from Telegram',
    });
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    // 3. SVG XSS content-type is neutralized to application/octet-stream (never image/svg+xml)
    const svgPayload = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/evil.svg' } }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(svgPayload, {
            status: 200,
            headers: { 'Content-Type': 'image/svg+xml' },
          })
        )
    );
    const svgRes = await downloadTelegramFile('bot-token', 'svg-id');
    expect(svgRes.ok).toBe(true);
    if (svgRes.ok) {
      expect(svgRes.contentType).toBe('application/octet-stream');
    }
  });
});

describe('src/index.ts exported HTTP webhook & dynamic WebApp helpers', () => {
  it('createRebeccaWebhookRequestHandler enforces exact path, POST method, 1 MiB byte cap, and 400 vs 500 split', async () => {
    const handleWebhook = vi.fn(async () => ({ statusCode: 200, ok: true }));
    const handler = createRebeccaWebhookRequestHandler({ handleWebhook }, '/api/rebecca-webhook/');

    const server = http.createServer((req, res) => {
      void handler(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end('not handled');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      expect(
        (await fetch(`http://127.0.0.1:${port}/evil/api/rebecca-webhook`, { method: 'POST' }))
          .status
      ).toBe(404);
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/rebecca-webhook`, { method: 'GET' })).status
      ).toBe(405);

      const badJson = await fetch(`http://127.0.0.1:${port}/api/rebecca-webhook`, {
        method: 'POST',
        body: '{bad json',
      });
      expect(badJson.status).toBe(400);

      handleWebhook.mockRejectedValueOnce(new Error('database crashed'));
      const svcErr = await fetch(`http://127.0.0.1:${port}/api/rebecca-webhook`, {
        method: 'POST',
        body: JSON.stringify({ event: 'user_updated' }),
      });
      expect(svcErr.status).toBe(500);
      expect(await svcErr.json()).toEqual({ error: 'Internal Server Error' });

      const hugePayload = 'ی'.repeat(600_000);
      const res413 = await new Promise<number>((resolve) => {
        const fakeReq = Object.assign(Readable.from([Buffer.from(hugePayload, 'utf8')]), {
          url: '/api/rebecca-webhook',
          method: 'POST',
          headers: {},
        }) as unknown as http.IncomingMessage;
        let status = 0;
        const fakeRes = {
          headersSent: false,
          writeHead: (code: number) => {
            status = code;
          },
          end: () => resolve(status),
        } as unknown as http.ServerResponse;
        void handler(fakeReq, fakeRes);
      });
      expect(res413).toBe(413);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resolveStartupWebAppState registers mesh when WEBAPP_URL is set via env even if DB toggle is false', () => {
    expect(resolveStartupWebAppState('https://env.example.com ', false, '')).toEqual({
      webAppUrl: 'https://env.example.com',
      shouldRegisterMesh: true,
    });
    expect(resolveStartupWebAppState(undefined, true, 'https://db.example.com')).toEqual({
      webAppUrl: 'https://db.example.com',
      shouldRegisterMesh: true,
    });
    expect(resolveStartupWebAppState(undefined, false, 'https://db.example.com')).toEqual({
      webAppUrl: undefined,
      shouldRegisterMesh: false,
    });
  });

  it('activateDynamicWebApp rolls back server handle, runtime URL, and mesh registration on persistence failure', async () => {
    const closeMock = vi.fn(async () => {});
    const unregisterDomain = vi.fn();
    let runtimeUrl: string | undefined;
    let activeHandle: { close: () => Promise<void> } | null = null;

    await expect(
      activateDynamicWebApp('https://new.example.com', {
        startServer: async () => ({ close: closeMock }),
        persistEnabledState: async () => {
          throw new Error('DB write failed');
        },
        registerDomain: vi.fn(),
        unregisterDomain,
        getRuntimeUrl: () => runtimeUrl,
        setRuntimeUrl: (url) => {
          runtimeUrl = url;
        },
        getExistingHandle: () => activeHandle,
        setHandle: (handle) => {
          activeHandle = handle;
        },
        probeSsl: async () => ({ ok: true }),
      })
    ).rejects.toThrow('DB write failed');

    expect(unregisterDomain).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(runtimeUrl).toBeUndefined();
    expect(activeHandle).toBeNull();
  });
});
