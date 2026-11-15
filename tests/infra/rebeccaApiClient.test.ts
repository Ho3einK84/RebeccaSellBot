import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RebeccaApiClient,
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
} from '../../src/infra/RebeccaApiClient.js';
import { trafficLimitSchema } from '../../src/infra/RebeccaApiSchemas.js';

function makeJwtWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function makeUserDetail(overrides: Record<string, unknown> = {}) {
  return {
    username: 'sub_1',
    proxies: {},
    expire: null,
    data_limit: 10 * 1024 ** 3,
    data_limit_reset_strategy: 'no_reset',
    inbounds: {},
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    created_at: '2026-01-01T00:00:00Z',
    links: [],
    subscription_url: '/sub/token-1',
    subscription_urls: {},
    ...overrides,
  };
}

function captureOutcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
}

describe('RebeccaApiClient — auth, retries, timeouts, stream cancellation, and circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects a baseUrl containing dashboard or api subpaths at construction time', () => {
    expect(
      () => new RebeccaApiClient({ baseUrl: 'https://panel.example.com/dashboard', apiKey: 'k' })
    ).toThrow();
  });

  it('retries 5xx/521 errors with fake-timer exponential backoff and throws RebeccaOriginDownError when exhausted', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancelSpy = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return {
          ok: false,
          status: 521,
          body: { cancel: cancelSpy },
          text: async () => 'Origin down',
        } as unknown as Response;
      })
    );

    const client = new RebeccaApiClient({
      baseUrl: 'https://panel.example.com',
      apiKey: 'test-key',
    });
    const settled = captureOutcome(client.getUser('sub_1'));
    await vi.runAllTimersAsync();
    const outcome = await settled;

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(RebeccaOriginDownError);
    const err = outcome.ok === false ? (outcome.error as RebeccaOriginDownError) : null;
    expect(err?.lastStatus).toBe(521);
    expect(err?.attempts).toBe(3);
    expect(err?.requestDispatched).toBe(true);
    expect(calls).toBe(3);
    expect(cancelSpy).toHaveBeenCalledTimes(3);
  });

  it('distinguishes pre-dispatch connection failures from potentially dispatched reset/timeout failures', async () => {
    vi.useFakeTimers();
    const clientA = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    const refusedErr = new TypeError('fetch failed', {
      cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw refusedErr;
      })
    );
    const settledA = captureOutcome(
      clientA.createUser({ username: 'u1', data_limit: 0, expire: null })
    );
    await vi.runAllTimersAsync();
    const outA = await settledA;
    expect(outA.ok).toBe(false);
    expect(outA.ok === false && (outA.error as RebeccaOriginDownError).requestDispatched).toBe(
      false
    );

    const clientB = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    const resetErr = new TypeError('fetch failed', {
      cause: Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw resetErr;
      })
    );
    const settledB = captureOutcome(
      clientB.createUser({ username: 'u2', data_limit: 0, expire: null })
    );
    await vi.runAllTimersAsync();
    const outB = await settledB;
    expect(outB.ok).toBe(false);
    expect(outB.ok === false && (outB.error as RebeccaOriginDownError).requestDispatched).toBe(
      true
    );
  });

  it('treats /api/admin/token failures as pre-dispatch even on HTTP 500, while mutating endpoint 5xx is indeterminate', async () => {
    vi.useFakeTimers();
    const client = new RebeccaApiClient({
      baseUrl: 'https://panel.example.com',
      adminUsername: 'admin',
      adminPassword: 'pw',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('auth failed', { status: 500 }))
    );
    const settledAuth = captureOutcome(
      client.createUser({ username: 'u1', data_limit: 0, expire: null })
    );
    await vi.runAllTimersAsync();
    const authOut = await settledAuth;
    expect(authOut.ok).toBe(false);
    expect(
      authOut.ok === false && (authOut.error as RebeccaOriginDownError).requestDispatched
    ).toBe(false);

    const okClient = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway fail', { status: 502 }))
    );
    const settledMut = captureOutcome(
      okClient.createUser({ username: 'u2', data_limit: 0, expire: null })
    );
    await vi.runAllTimersAsync();
    const mutOut = await settledMut;
    expect(mutOut.ok).toBe(false);
    expect(mutOut.ok === false && (mutOut.error as RebeccaOriginDownError).requestDispatched).toBe(
      true
    );
  });

  it('recovers when retry succeeds after initial 502 and sends required service_id and normalized expire: 0 -> null', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.service_id).toBe(7);
        return new Response(JSON.stringify(makeUserDetail({ username: 'created_u' })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.expire).toBeNull();
        return new Response(
          JSON.stringify(makeUserDetail({ username: 'created_u', expire: null })),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      });

    vi.stubGlobal('fetch', fetchMock);
    const client = new RebeccaApiClient({
      baseUrl: 'https://panel.example.com',
      apiKey: 'k',
    });

    const createPromise = client.createUser({
      username: 'created_u',
      data_limit: 100,
      expire: null,
      service_id: 7,
    });
    await vi.runAllTimersAsync();
    const created = await createPromise;
    expect(created.username).toBe('created_u');
    expect(created.subscription_url).toBe('https://panel.example.com/sub/token-1');

    const updated = await client.updateUser('created_u', { expire: 0 });
    expect(updated.expire).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('handles JWT auth single-flighting, treats exp=0 as 24h fallback, and separates 401 refresh from 5xx retries', async () => {
    vi.useFakeTimers();
    const nonExpiringJwt = makeJwtWithExp(0);
    const refreshedJwt = makeJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    let tokenCalls = 0;
    let userCalls = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin/token')) {
        tokenCalls++;
        const tok = tokenCalls === 1 ? nonExpiringJwt : refreshedJwt;
        return new Response(JSON.stringify({ access_token: tok, token_type: 'bearer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      userCalls++;
      if (userCalls <= 2) {
        return new Response(JSON.stringify(makeUserDetail({ username: `u_${userCalls}` })), {
          status: 200,
        });
      }
      // Next call hits 503 -> retry -> 401 -> token refresh -> 200
      if (userCalls === 3) return new Response('unavailable', { status: 503 });
      if (userCalls === 4) return new Response('expired', { status: 401 });
      return new Response(JSON.stringify(makeUserDetail({ username: 'recovered' })), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const client = new RebeccaApiClient({
      baseUrl: 'https://panel.example.com',
      adminUsername: 'admin',
      adminPassword: 'secret',
    });

    const [a, b] = await Promise.all([client.getUser('u_1'), client.getUser('u_2')]);
    expect(a.username).toBe('u_1');
    expect(b.username).toBe('u_2');
    expect(tokenCalls).toBe(1);

    const recoverPromise = client.getUser('recovered');
    await vi.runAllTimersAsync();
    const recovered = await recoverPromise;
    expect(recovered.username).toBe('recovered');
    expect(tokenCalls).toBe(2);
  });

  it('bounds retries when a 401 refresh is followed by repeated 503 errors (no infinite loop)', async () => {
    vi.useFakeTimers();
    let tokenCalls = 0;
    let apiCalls = 0;
    const validJwt = makeJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/admin/token')) {
          tokenCalls++;
          return new Response(JSON.stringify({ access_token: validJwt, token_type: 'bearer' }), {
            status: 200,
          });
        }
        apiCalls++;
        if (apiCalls === 1) return new Response('stale', { status: 401 });
        return new Response('down', { status: 503 });
      }) as unknown as typeof fetch
    );

    const client = new RebeccaApiClient({
      baseUrl: 'https://panel.example.com',
      adminUsername: 'admin',
      adminPassword: 'secret',
    });

    const settled = captureOutcome(client.getUser('u_x'));
    await vi.runAllTimersAsync();
    const out = await settled;
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toBeInstanceOf(RebeccaOriginDownError);
    expect(out.ok === false && (out.error as RebeccaOriginDownError).requestDispatched).toBe(true);
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(4);
  });

  it('bounds hung response body reads under REQUEST_TIMEOUT_MS and retries on body abort', async () => {
    vi.useFakeTimers();
    let calls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        const signal = init?.signal;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: { cancel: vi.fn(async () => {}) },
            json: () =>
              new Promise<unknown>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                  const err = new Error('The operation was aborted');
                  err.name = 'AbortError';
                  reject(err);
                });
              }),
          } as unknown as Response);
        }
        return Promise.resolve(
          new Response(JSON.stringify(makeUserDetail({ username: 'sub_ok' })), { status: 200 })
        );
      }) as unknown as typeof fetch
    );

    const client = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    const p = client.getUser('sub_ok');
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;
    expect(res.username).toBe('sub_ok');
    expect(calls).toBe(2);
  });

  it('does not retry non-401 4xx errors, strips subscription links from targeted-search errors, and passes links=true on getUsers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('search=')) {
        return new Response('missing?sub=secret-token', { status: 404 });
      }
      expect(url).toContain('links=true');
      return new Response(
        JSON.stringify({
          users: [
            {
              username: 'u1',
              status: 'active',
              used_traffic: 0,
              data_limit: null,
              expire: null,
              subscription_url: '/sub/u1',
              subscription_urls: { vless: '/sub/u1' },
              links: ['vless://abc'],
            },
          ],
          total: 1,
          status_breakdown: { active: 1 },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const client = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    const out404 = await captureOutcome(client.getUsers(0, 100, 'secret-token'));
    expect(out404.ok).toBe(false);
    expect(out404.ok === false && out404.error).toBeInstanceOf(RebeccaApiError);
    const apiErr = out404.ok === false ? (out404.error as RebeccaApiError) : null;
    expect(apiErr?.status).toBe(404);
    expect(apiErr?.message).not.toContain('secret-token');
    expect(apiErr?.endpoint).not.toContain('secret-token');

    const list = await client.getUsers(0, 50, undefined, undefined, true);
    expect(list.users).toHaveLength(1);
    expect(list.users[0]?.subscription_urls).toEqual({
      vless: 'https://panel.example.com/sub/u1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws RebeccaContractError on invalid 2xx payload shape and normalizes trafficLimitSchema', async () => {
    expect(trafficLimitSchema.parse(0)).toBeNull();
    expect(trafficLimitSchema.parse(undefined)).toBeNull();
    expect(trafficLimitSchema.parse(1024)).toBe(1024);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })
      ) as unknown as typeof fetch
    );
    const client = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });
    await expect(client.getUser('sub_1')).rejects.toBeInstanceOf(RebeccaContractError);
  });

  it('trips circuit breaker after threshold failures, fast-fails during cooldown, and recovers in HALF_OPEN', async () => {
    vi.useFakeTimers();
    let networkCalls = 0;
    let shouldRecover = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        networkCalls++;
        if (!shouldRecover) {
          return new Response('down', { status: 503 });
        }
        return new Response(JSON.stringify(makeUserDetail({ username: 'healed' })), {
          status: 200,
        });
      }) as unknown as typeof fetch
    );

    const client = new RebeccaApiClient({ baseUrl: 'https://panel.example.com', apiKey: 'k' });

    for (let i = 0; i < 2; i++) {
      const settled = captureOutcome(client.getUser('u'));
      await vi.runAllTimersAsync();
      const out = await settled;
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.error).toBeInstanceOf(RebeccaOriginDownError);
    }
    expect(client.isCircuitOpen()).toBe(true);
    const callsAtOpen = networkCalls;

    await expect(client.getUser('u')).rejects.toBeInstanceOf(RebeccaOriginDownError);
    expect(networkCalls).toBe(callsAtOpen);

    shouldRecover = true;
    await vi.advanceTimersByTimeAsync(15_001);
    const healed = await client.getUser('healed');
    expect(healed.username).toBe('healed');
    expect(client.isCircuitOpen()).toBe(false);
  });
});
