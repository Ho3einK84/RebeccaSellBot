import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainRegistryService } from '../../src/domain/services/DomainRegistryService.js';
import {
  checkDomainDns,
  getServerPublicIp,
  normalizeDomainInput,
  verifyDomainSslAndReachability,
} from '../../src/domain/services/domainVerification.js';
import * as networkProbe from '../../src/infra/networkProbe.js';

describe('CustomDomains', () => {
  describe('DomainRegistryService', () => {
    let tempDir: string;
    let service: DomainRegistryService;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsbot-registry-test-'));
      service = new DomainRegistryService(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates registry directory when it does not exist', () => {
      const customDir = path.join(tempDir, 'sub', 'registry');
      const customService = new DomainRegistryService(customDir);
      expect(fs.existsSync(customDir)).toBe(true);
      expect(customService.getAll()).toEqual([]);
    });

    it('registers and retrieves instance records case-insensitively', () => {
      const ok = service.register({
        instance: 'shop2',
        domain: 'Shop2.Example.Com',
        url: 'https://shop2.example.com',
        target: 'http://shop2_bot:3002',
        hostPort: 3003,
      });

      expect(ok).toBe(true);
      const records = service.getAll();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        instance: 'shop2',
        domain: 'shop2.example.com',
        target: 'http://shop2_bot:3002',
        hostPort: 3003,
      });
      expect(records[0]?.updatedAt).toBeDefined();
      expect(fs.existsSync(path.join(tempDir, 'shop2.json'))).toBe(true);
      expect(service.findByDomain('  SHOP2.EXAMPLE.COM ')?.instance).toBe('shop2');
      expect(service.isDomainAllowed('shop2.example.com')).toBe(true);
      expect(service.isDomainAllowed('other.example.com')).toBe(false);
    });

    it('unregisters existing and nonexistent valid instances safely', () => {
      service.register({
        instance: 'shop3',
        domain: 'shop3.example.com',
        url: 'https://shop3.example.com',
        target: 'http://shop3_bot:3002',
      });
      expect(service.findByDomain('shop3.example.com')).not.toBeNull();

      service.unregister('shop3');
      expect(service.findByDomain('shop3.example.com')).toBeNull();
      expect(fs.existsSync(path.join(tempDir, 'shop3.json'))).toBe(false);
      expect(() => service.unregister('non_existent')).not.toThrow();
    });

    it('handles corrupt JSON and non-JSON files gracefully', () => {
      fs.writeFileSync(path.join(tempDir, 'corrupt.json'), 'INVALID_JSON{{{', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'not_json.txt'), 'hello', 'utf8');

      service.register({
        instance: 'valid',
        domain: 'valid.example.com',
        url: 'https://valid.example.com',
        target: 'http://valid_bot:3002',
      });

      const records = service.getAll();
      expect(records).toHaveLength(1);
      expect(records[0]?.instance).toBe('valid');
    });

    it('rejects path-traversal or unsafe instance names on register and unregister', () => {
      for (const bad of [
        '../escape',
        '../../etc/passwd',
        'nested/name',
        'bad\\name',
        '.hidden',
        'a..b',
        '',
      ]) {
        expect(() =>
          service.register({
            instance: bad,
            domain: 'evil.example.com',
            url: 'https://evil.example.com',
            target: 'http://bot:3002',
          })
        ).toThrow('INVALID_REGISTRY_INSTANCE');
        expect(() => service.unregister(bad)).toThrow('INVALID_REGISTRY_INSTANCE');
      }
    });

    it('cleans up temporary UUID file and returns false when rename fails', () => {
      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('EXDEV');
      });

      const ok = service.register({
        instance: 'broken_shop',
        domain: 'broken.example.com',
        url: 'https://broken.example.com',
        target: 'http://bot:3002',
      });

      expect(ok).toBe(false);
      expect(fs.readdirSync(tempDir)).toEqual([]);
      renameSpy.mockRestore();
    });
  });

  describe('normalizeDomainInput', () => {
    it('normalizes bare domains, http/https schemes, paths, ports, trailing dots, and localhost', () => {
      expect(normalizeDomainInput('App.Example.com')).toEqual({
        valid: true,
        hostname: 'app.example.com',
        url: 'https://app.example.com',
      });
      expect(normalizeDomainInput('https://mini.vpn.net/')).toEqual({
        valid: true,
        hostname: 'mini.vpn.net',
        url: 'https://mini.vpn.net',
      });
      expect(normalizeDomainInput('http://dashboard.domain.ir')).toEqual({
        valid: true,
        hostname: 'dashboard.domain.ir',
        url: 'https://dashboard.domain.ir',
      });
      expect(normalizeDomainInput('https://app.mybot.org/login?token=123#welcome')).toEqual({
        valid: true,
        hostname: 'app.mybot.org',
        url: 'https://app.mybot.org',
      });
      expect(normalizeDomainInput('https://app.mybot.org:3002')).toEqual({
        valid: true,
        hostname: 'app.mybot.org',
        url: 'https://app.mybot.org',
      });
      expect(normalizeDomainInput('app.mybot.org.')).toEqual({
        valid: true,
        hostname: 'app.mybot.org',
        url: 'https://app.mybot.org',
      });
      expect(normalizeDomainInput('localhost')).toEqual({
        valid: true,
        hostname: 'localhost',
        url: 'https://localhost',
      });
    });

    it('rejects empty inputs, embedded credentials, unsupported schemes, and invalid hostnames', () => {
      expect(normalizeDomainInput('').valid).toBe(false);
      expect(normalizeDomainInput('   ').valid).toBe(false);
      expect(normalizeDomainInput('https://user:pass@evil.example.com').valid).toBe(false);
      expect(normalizeDomainInput('ftp://files.example.com').valid).toBe(false);
      expect(normalizeDomainInput('javascript:alert(1)').valid).toBe(false);
      expect(normalizeDomainInput('invalid_domain_without_tld').valid).toBe(false);
      expect(normalizeDomainInput('-invalid.com').valid).toBe(false);
      expect(normalizeDomainInput('invalid..com').valid).toBe(false);
      expect(normalizeDomainInput('http://').valid).toBe(false);
      expect(normalizeDomainInput(`${'a'.repeat(255)}.com`).valid).toBe(false);
    });
  });

  describe('checkDomainDns', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('resolves localhost without calling DNS', async () => {
      await expect(checkDomainDns('localhost', '127.0.0.1')).resolves.toEqual({
        resolved: true,
        ips: ['127.0.0.1'],
        matchesServer: true,
        serverIp: '127.0.0.1',
      });
    });

    it('detects matching and mismatched server A records and DNS lookup failures', async () => {
      vi.spyOn(dns, 'resolve4').mockResolvedValueOnce(['91.107.154.218']);
      await expect(checkDomainDns('rs.netiva.ir', '91.107.154.218')).resolves.toMatchObject({
        resolved: true,
        ips: ['91.107.154.218'],
        matchesServer: true,
      });

      vi.spyOn(dns, 'resolve4').mockResolvedValueOnce(['1.2.3.4']);
      await expect(checkDomainDns('rs.netiva.ir', '91.107.154.218')).resolves.toMatchObject({
        resolved: true,
        ips: ['1.2.3.4'],
        matchesServer: false,
      });

      vi.spyOn(dns, 'resolve4').mockRejectedValueOnce(new Error('ENOTFOUND'));
      await expect(checkDomainDns('nonexistent.invalid', '91.107.154.218')).resolves.toMatchObject({
        resolved: false,
        ips: [],
        matchesServer: false,
      });
    });
  });

  describe('getServerPublicIp & verifyDomainSslAndReachability', () => {
    beforeEach(() => {
      delete process.env.SERVER_PUBLIC_IP;
      delete process.env.HOST_IP;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('reads SERVER_PUBLIC_IP and returns early when first reachability probe succeeds', async () => {
      process.env.SERVER_PUBLIC_IP = '198.51.100.22';
      await expect(getServerPublicIp()).resolves.toBe('198.51.100.22');

      const spy = vi.spyOn(networkProbe, 'probeDomainHealth').mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'ok', component: 'webapp' },
      });
      await expect(
        verifyDomainSslAndReachability('https://app.test.com', 5000)
      ).resolves.toMatchObject({ ok: true });
      expect(spy).toHaveBeenCalledWith('https://app.test.com', 5000);
    });

    it('respects timeoutMs budget when retrying after ACME probe failure', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const spy = vi
        .spyOn(networkProbe, 'probeDomainHealth')
        .mockImplementationOnce(async () => {
          vi.advanceTimersByTime(1100);
          return { ok: false, error: 'TLS_PENDING' };
        })
        .mockImplementationOnce(async (_url, timeout) => {
          expect(timeout).toBeLessThanOrEqual(900);
          return { ok: true, status: 200 };
        });

      const promise = verifyDomainSslAndReachability('https://app.test.com', 2000);
      await vi.advanceTimersByTimeAsync(1000);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
