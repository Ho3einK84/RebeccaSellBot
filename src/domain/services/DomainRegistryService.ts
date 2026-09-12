import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../infra/logger.js';

export interface DomainRegistryRecord {
  instance: string;
  domain: string;
  url: string;
  target: string;
  hostPort?: number;
  updatedAt: string;
}

export class DomainRegistryService {
  private readonly registryDir: string;

  constructor(registryDir = '/app/data/registry') {
    this.registryDir = registryDir;
    this.ensureDirectory();
  }

  public getRegistryDir(): string {
    return this.registryDir;
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.registryDir)) {
        fs.mkdirSync(this.registryDir, { recursive: true });
      }
    } catch (err) {
      logger.warn({ err, dir: this.registryDir }, 'Could not create domain registry directory');
    }
  }

  public register(record: Omit<DomainRegistryRecord, 'updatedAt'>): void {
    this.ensureDirectory();
    const normalizedDomain = record.domain.toLowerCase().trim();
    const filePath = path.join(this.registryDir, `${record.instance}.json`);
    const fullRecord: DomainRegistryRecord = {
      ...record,
      domain: normalizedDomain,
      updatedAt: new Date().toISOString(),
    };

    try {
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(fullRecord, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
      logger.info(
        { instance: fullRecord.instance, domain: fullRecord.domain, target: fullRecord.target },
        'Registered domain in multi-instance registry'
      );
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to write domain registry file');
    }
  }

  public unregister(instance: string): void {
    const filePath = path.join(this.registryDir, `${instance}.json`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info({ instance }, 'Unregistered domain from multi-instance registry');
      }
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to delete domain registry file');
    }
  }

  public getAll(): DomainRegistryRecord[] {
    this.ensureDirectory();
    try {
      if (!fs.existsSync(this.registryDir)) {
        return [];
      }
      const files = fs.readdirSync(this.registryDir);
      const records: DomainRegistryRecord[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = fs.readFileSync(path.join(this.registryDir, file), 'utf8');
          const data = JSON.parse(content) as DomainRegistryRecord;
          if (data && data.instance && data.domain && data.target) {
            records.push({
              instance: data.instance,
              domain: data.domain.toLowerCase().trim(),
              url: data.url,
              target: data.target,
              hostPort: data.hostPort,
              updatedAt: data.updatedAt,
            });
          }
        } catch {
          // Ignore corrupt or incomplete JSON files
        }
      }
      return records;
    } catch (err) {
      logger.warn({ err, dir: this.registryDir }, 'Could not read domain registry directory');
      return [];
    }
  }

  public findByDomain(domain: string): DomainRegistryRecord | null {
    const normalized = domain.toLowerCase().trim();
    const all = this.getAll();
    return all.find((r) => r.domain === normalized) ?? null;
  }

  public isDomainAllowed(domain: string): boolean {
    return this.findByDomain(domain) !== null;
  }
}
