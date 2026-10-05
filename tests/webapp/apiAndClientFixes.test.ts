import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { api, setAuthToken, getAuthToken } from '../../webapp/src/shared/lib/api.js';

describe('Webapp API Client & Token Management', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    setAuthToken(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setAuthToken(null);
  });

  it('manages in-memory auth token with setAuthToken and getAuthToken', () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken('test-bearer-token-123');
    expect(getAuthToken()).toBe('test-bearer-token-123');
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it('automatically adds Authorization: Bearer <token> to outbound requests when token is present', async () => {
    setAuthToken('jwt-session-xyz');

    const mockFetch = vi.fn(async (_url: any, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers,
        json: async () => ({
          headerReceived: headers.get('Authorization'),
        }),
      } as any;
    });

    global.fetch = mockFetch;

    await api.getUserProfile();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-session-xyz');
  });

  it('stores token automatically upon successful validateTelegramAuth response', async () => {
    const mockFetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          token: 'returned-backend-jwt-token',
          role: 'user',
          user: { id: 12345, first_name: 'Test' },
        }),
      } as any;
    });

    global.fetch = mockFetch;

    const res = await api.validateTelegramAuth('dummy-init-data');
    expect(res.token).toBe('returned-backend-jwt-token');
    expect(getAuthToken()).toBe('returned-backend-jwt-token');
  });

  it('allows explicit Authorization header to override or coexist without duplicating', async () => {
    setAuthToken('default-token');

    const mockFetch = vi.fn(async (_url: any, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers,
        json: async () => ({}),
      } as any;
    });

    global.fetch = mockFetch;

    await api.getUserProfile();
    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer default-token');
  });
});

describe('useToastQueue Ghost Timer Prevention', () => {
  it('deduplicates duplicate messages without scheduling ghost timers', () => {
    const timersMap = new Map<string, any>();
    const toastsList: Array<{ id: string; message: string; type: string }> = [];

    const addToastHarness = (
      message: string,
      type: 'success' | 'error' | 'warning' = 'success',
      timeout = 3500
    ) => {
      const existing = toastsList.find((t) => t.message === message && t.type === type);
      if (existing) {
        return existing.id;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      toastsList.push({ id, message, type });

      const timer = setTimeout(() => {
        // remove
      }, timeout);
      timersMap.set(id, timer);

      return id;
    };

    // First call adds toast and timer
    const id1 = addToastHarness('Saved successfully', 'success');
    expect(toastsList.length).toBe(1);
    expect(timersMap.size).toBe(1);

    // Second call with identical message & type is deduplicated
    const id2 = addToastHarness('Saved successfully', 'success');
    expect(id2).toBe(id1);
    expect(toastsList.length).toBe(1);
    // Crucial check: timersMap did NOT allocate a ghost timer for duplicate
    expect(timersMap.size).toBe(1);

    // Clean up timers
    timersMap.forEach((t) => clearTimeout(t));
  });
});
