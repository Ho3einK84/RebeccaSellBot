import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  clearCachedPublicIpForTesting,
  fetchServerPublicIp,
  probeDomainHealth,
} from '../../src/infra/networkProbe.js';

describe('Network Probe Infrastructure', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearCachedPublicIpForTesting();
    process.env = { ...originalEnv };
    delete process.env.SERVER_PUBLIC_IP;
    delete process.env.HOST_IP;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('fetchServerPublicIp', () => {
    it('returns env var SERVER_PUBLIC_IP when defined', async () => {
      process.env.SERVER_PUBLIC_IP = '1.2.3.4';
      const ip = await fetchServerPublicIp();
      expect(ip).toBe('1.2.3.4');
    });

    it('returns env var HOST_IP when defined and SERVER_PUBLIC_IP is absent', async () => {
      process.env.HOST_IP = '5.6.7.8';
      const ip = await fetchServerPublicIp();
      expect(ip).toBe('5.6.7.8');
    });

    it('fetches from public IP provider and validates IPv4 format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('91.107.154.218\n'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const ip = await fetchServerPublicIp();
      expect(ip).toBe('91.107.154.218');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('returns null if provider fails and no cached IP exists', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const ip = await fetchServerPublicIp();
      expect(ip).toBeNull();
    });
  });

  describe('probeDomainHealth', () => {
    it('returns ok: true when /api/health responds with status ok and component webapp', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok', component: 'webapp' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await probeDomainHealth('https://rs.netiva.ir', 2000);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://rs.netiva.ir/api/health',
        expect.objectContaining({
          signal: expect.anything(),
        })
      );
    });

    it('returns ok: false when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await probeDomainHealth('https://rs.netiva.ir', 2000);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(502);
      expect(res.error).toBe('HTTP 502 Bad Gateway');
    });

    it('returns ok: false on network timeout or connection error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const res = await probeDomainHealth('https://rs.netiva.ir', 2000);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Connection refused');
    });
  });
});
