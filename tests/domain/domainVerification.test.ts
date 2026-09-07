import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import {
  normalizeDomainInput,
  checkDomainDns,
  getServerPublicIp,
  verifyDomainSslAndReachability,
} from '../../src/domain/services/domainVerification.js';
import * as networkProbe from '../../src/infra/networkProbe.js';

describe('Domain Verification Service', () => {
  describe('normalizeDomainInput', () => {
    it('normalizes plain domain name to https URL and lowercase hostname', () => {
      const res = normalizeDomainInput('App.Example.com');
      expect(res).toEqual({
        valid: true,
        hostname: 'app.example.com',
        url: 'https://app.example.com',
      });
    });

    it('strips https protocol and trailing slashes', () => {
      const res = normalizeDomainInput('https://mini.vpn.net/');
      expect(res).toEqual({
        valid: true,
        hostname: 'mini.vpn.net',
        url: 'https://mini.vpn.net',
      });
    });

    it('upgrades http protocol to canonical https URL', () => {
      const res = normalizeDomainInput('http://dashboard.domain.ir');
      expect(res).toEqual({
        valid: true,
        hostname: 'dashboard.domain.ir',
        url: 'https://dashboard.domain.ir',
      });
    });

    it('strips subpaths, query parameters, and fragments', () => {
      const res = normalizeDomainInput('https://app.mybot.org/login?token=123#welcome');
      expect(res).toEqual({
        valid: true,
        hostname: 'app.mybot.org',
        url: 'https://app.mybot.org',
      });
    });

    it('strips explicit port numbers', () => {
      const res = normalizeDomainInput('https://app.mybot.org:3002');
      expect(res).toEqual({
        valid: true,
        hostname: 'app.mybot.org',
        url: 'https://app.mybot.org',
      });
    });

    it('supports localhost for development and testing', () => {
      const res = normalizeDomainInput('localhost');
      expect(res).toEqual({
        valid: true,
        hostname: 'localhost',
        url: 'https://localhost',
      });
    });

    it('rejects empty input or whitespace', () => {
      expect(normalizeDomainInput('').valid).toBe(false);
      expect(normalizeDomainInput('   ').valid).toBe(false);
    });

    it('rejects invalid hostname formats', () => {
      expect(normalizeDomainInput('invalid_domain_without_tld').valid).toBe(false);
      expect(normalizeDomainInput('-invalid.com').valid).toBe(false);
      expect(normalizeDomainInput('invalid..com').valid).toBe(false);
      expect(normalizeDomainInput('http://').valid).toBe(false);
      expect(normalizeDomainInput('a'.repeat(255) + '.com').valid).toBe(false);
    });
  });

  describe('checkDomainDns', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('resolves localhost without calling DNS', async () => {
      const res = await checkDomainDns('localhost', '127.0.0.1');
      expect(res).toEqual({
        resolved: true,
        ips: ['127.0.0.1'],
        matchesServer: true,
        serverIp: '127.0.0.1',
      });
    });

    it('matches when DNS A record points to server IP', async () => {
      vi.spyOn(dns, 'resolve4').mockResolvedValue(['91.107.154.218']);

      const res = await checkDomainDns('rs.netiva.ir', '91.107.154.218');
      expect(res.resolved).toBe(true);
      expect(res.ips).toEqual(['91.107.154.218']);
      expect(res.matchesServer).toBe(true);
    });

    it('reports mismatch when DNS A record points to different IP', async () => {
      vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.2.3.4']);

      const res = await checkDomainDns('rs.netiva.ir', '91.107.154.218');
      expect(res.resolved).toBe(true);
      expect(res.ips).toEqual(['1.2.3.4']);
      expect(res.matchesServer).toBe(false);
    });

    it('handles DNS resolution errors gracefully', async () => {
      vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));

      const res = await checkDomainDns('nonexistent.invalid', '91.107.154.218');
      expect(res.resolved).toBe(false);
      expect(res.ips).toEqual([]);
      expect(res.matchesServer).toBe(false);
    });
  });

  describe('getServerPublicIp & verifyDomainSslAndReachability', () => {
    beforeEach(() => {
      delete process.env.SERVER_PUBLIC_IP;
      delete process.env.HOST_IP;
    });

    it('prefers SERVER_PUBLIC_IP environment variable if set', async () => {
      process.env.SERVER_PUBLIC_IP = '198.51.100.22';
      const ip = await getServerPublicIp();
      expect(ip).toBe('198.51.100.22');
    });

    it('delegates reachability probe to network probe infrastructure', async () => {
      const spy = vi.spyOn(networkProbe, 'probeDomainHealth').mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'ok', component: 'webapp' },
      });

      const res = await verifyDomainSslAndReachability('https://app.test.com', 5000);
      expect(res.ok).toBe(true);
      expect(spy).toHaveBeenCalledWith('https://app.test.com', 5000);
    });
  });
});
