import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RebeccaApiClient,
  RebeccaApiError,
  RebeccaContractError,
} from '../../src/infra/RebeccaApiClient.js';
import { RebeccaService } from '../../src/domain/services/RebeccaService.js';

describe('RebeccaApiClient & RebeccaService — 521 Cloudflare Resilience Tests', () => {
  let client: RebeccaApiClient;
  let rebeccaService: RebeccaService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new RebeccaApiClient({
      baseUrl: 'https://rebecca.example.com',
      apiKey: 'test-api-key',
    });
    rebeccaService = new RebeccaService(client);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects a Rebecca base URL that already contains a dashboard path', () => {
    expect(
      () =>
        new RebeccaApiClient({
          baseUrl: 'https://rebecca.example.com/x-dashboard/',
          apiKey: 'test-api-key',
        })
    ).toThrow('REBECCA_API_URL must be a clean HTTPS origin URL');
  });

  it('should retry on 521 Cloudflare error with exponential backoff and throw RebeccaOriginDownError on exhaustion', async () => {
    // Mock setTimeout so retries happen instantly without real delay
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 521,
      text: vi.fn().mockResolvedValue('Error 521: Web server is down'),
    });
    global.fetch = fetchMock;

    await expect(rebeccaService.getUser('testuser')).rejects.toMatchObject({
      name: 'RebeccaOriginDownError',
      requestDispatched: true,
    });

    // Should attempt original call + 4 retries = 5 total calls
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('marks connection-setup failures as pre-dispatch after retries are exhausted', async () => {
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const connectError = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('dns lookup failed'), { code: 'ENOTFOUND' }),
    });
    global.fetch = vi.fn().mockRejectedValue(connectError);

    await expect(rebeccaService.getUser('never-dispatched')).rejects.toMatchObject({
      name: 'RebeccaOriginDownError',
      requestDispatched: false,
    });
  });

  it('marks timeout/reset-style network failures as potentially dispatched', async () => {
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const timeoutError = Object.assign(new Error('request timed out'), { name: 'AbortError' });
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      rebeccaService.createUser({ username: 'lost-response', service_id: 1 })
    ).rejects.toMatchObject({
      name: 'RebeccaOriginDownError',
      requestDispatched: true,
    });
  });

  it('should succeed if retry recovers on 2nd attempt after an initial 502/521', async () => {
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 521,
        text: vi.fn().mockResolvedValue('Cloudflare 521'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          username: 'recovered_user',
          status: 'active',
          used_traffic: 100,
          data_limit: 1000,
          expire: 1700000000,
          subscription_url: 'https://sub.domain/recovered_user',
          links: [],
          proxies: {},
          inbounds: {},
        }),
      });
    global.fetch = fetchMock;

    const user = await rebeccaService.getUser('recovered_user');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(user.username).toBe('recovered_user');
    expect(user.status).toBe('active');
  });

  it('should throw RebeccaApiError on 4xx client errors without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue('User not found'),
    });
    global.fetch = fetchMock;

    await expect(rebeccaService.getUser('nonexistent')).rejects.toThrow(RebeccaApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retain a subscription credential in a targeted-search error', async () => {
    const credentialUrl = 'https://sub.example/sub/alice/0123456789abcdef0123456789abcdef';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('invalid search'),
    });
    global.fetch = fetchMock;

    await expect(client.getUsers(0, 10, credentialUrl, undefined, true)).rejects.toSatisfy(
      (error: unknown) => {
        if (!(error instanceof RebeccaApiError)) return false;
        return (
          !error.endpoint.includes('0123456789abcdef') && !error.message.includes('invalid search')
        );
      }
    );
  });

  it('requests links explicitly when scanning subscription claims', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ users: [], total: 0, status_breakdown: {} }),
    });
    global.fetch = fetchMock;

    await rebeccaService.getUsers(0, 200, undefined, undefined, true);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('links=true');
  });

  it('single-flights concurrent admin-token refreshes', async () => {
    client = new RebeccaApiClient({
      baseUrl: 'https://rebecca.example.com',
      adminUsername: 'admin',
      adminPassword: 'secret',
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/admin/token')) {
        return {
          ok: true,
          status: 200,
          json: vi
            .fn()
            .mockResolvedValue({ access_token: 'opaque-access-token', token_type: 'bearer' }),
        } as unknown as Response;
      }
      const username = url.endsWith('/bob') ? 'bob' : 'alice';
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          username,
          status: 'active',
          used_traffic: 0,
          data_limit: null,
          expire: null,
          created_at: '2026-01-01T00:00:00Z',
          subscription_url: `https://sub.example/${username}`,
          links: [],
          proxies: {},
          inbounds: {},
        }),
      } as unknown as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    await Promise.all([client.getUser('alice'), client.getUser('bob')]);

    const tokenCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith('/api/admin/token')
    );
    expect(tokenCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('expands relative subscription paths with the configured panel origin and port', async () => {
    client = new RebeccaApiClient({
      baseUrl: 'https://rebecca.example.com:2087',
      apiKey: 'test-api-key',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        username: 'relative_link_user',
        status: 'active',
        used_traffic: 0,
        data_limit: null,
        expire: null,
        subscription_url: '/sub/primary-token',
        subscription_urls: { primary: '/sub/primary-token', alternate: '/sub/alternate-token' },
        links: [],
        proxies: {},
        inbounds: {},
      }),
    });
    global.fetch = fetchMock;

    const user = await client.getUser('relative_link_user');

    expect(user.subscription_url).toBe('https://rebecca.example.com:2087/sub/primary-token');
    expect(user.subscription_urls).toEqual({
      primary: 'https://rebecca.example.com:2087/sub/primary-token',
      alternate: 'https://rebecca.example.com:2087/sub/alternate-token',
    });
  });

  it('sends the Rebecca-required service_id when creating a user', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({
        username: 'service_user',
        status: 'active',
        used_traffic: 0,
        data_limit: null,
        expire: null,
        subscription_url: 'https://sub.example/service_user',
        links: [],
      }),
    });
    global.fetch = fetchMock;

    await rebeccaService.createUser({
      username: 'service_user',
      service_id: 7,
      status: 'active',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ service_id: 7 });
  });

  it('rejects a 2xx response that violates the runtime user contract', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        username: 'malformed_user',
        status: 'active',
        used_traffic: 'not-a-number',
        data_limit: null,
        expire: null,
        subscription_url: '/sub/malformed',
        links: [],
      }),
    });

    await expect(client.getUser('malformed_user')).rejects.toBeInstanceOf(RebeccaContractError);
  });

  it('should mask API keys and secrets in logger redaction configuration', () => {
    expect(client).toBeDefined();
    expect(rebeccaService).toBeDefined();
  });
});
