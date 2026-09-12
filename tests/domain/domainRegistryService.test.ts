import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainRegistryService } from '../../src/domain/services/DomainRegistryService.js';

describe('DomainRegistryService', () => {
  let tempDir: string;
  let service: DomainRegistryService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsbot-registry-test-'));
    service = new DomainRegistryService(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates registry directory if it does not exist', () => {
    const customDir = path.join(tempDir, 'sub', 'registry');
    const customService = new DomainRegistryService(customDir);
    expect(fs.existsSync(customDir)).toBe(true);
    expect(customService.getAll()).toEqual([]);
  });

  it('registers and retrieves instance records', () => {
    service.register({
      instance: 'shop2',
      domain: 'Shop2.Example.Com',
      url: 'https://shop2.example.com',
      target: 'http://shop2_bot:3002',
      hostPort: 3003,
    });

    const records = service.getAll();
    expect(records).toHaveLength(1);
    expect(records[0]?.instance).toBe('shop2');
    expect(records[0]?.domain).toBe('shop2.example.com');
    expect(records[0]?.target).toBe('http://shop2_bot:3002');
    expect(records[0]?.hostPort).toBe(3003);
    expect(records[0]?.updatedAt).toBeDefined();

    // Verify file content on disk
    const diskFile = path.join(tempDir, 'shop2.json');
    expect(fs.existsSync(diskFile)).toBe(true);
  });

  it('finds records by domain case-insensitively', () => {
    service.register({
      instance: 'main',
      domain: 'rs.netiva.ir',
      url: 'https://rs.netiva.ir',
      target: 'http://main_bot:3002',
      hostPort: 3002,
    });
    service.register({
      instance: 'shop2',
      domain: 'shop2.netiva.ir',
      url: 'https://shop2.netiva.ir',
      target: 'http://shop2_bot:3002',
      hostPort: 3003,
    });

    const foundShop2 = service.findByDomain('SHOP2.NETIVA.IR');
    expect(foundShop2).not.toBeNull();
    expect(foundShop2?.instance).toBe('shop2');

    const foundMain = service.findByDomain('  rs.netiva.ir  ');
    expect(foundMain).not.toBeNull();
    expect(foundMain?.instance).toBe('main');

    const notFound = service.findByDomain('other.netiva.ir');
    expect(notFound).toBeNull();
    expect(service.isDomainAllowed('other.netiva.ir')).toBe(false);
    expect(service.isDomainAllowed('shop2.netiva.ir')).toBe(true);
  });

  it('unregisters an instance and removes its file', () => {
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

    // Unregistering a non-existent instance does not throw
    expect(() => service.unregister('non_existent')).not.toThrow();
  });

  it('handles corrupt JSON files gracefully', () => {
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
});
