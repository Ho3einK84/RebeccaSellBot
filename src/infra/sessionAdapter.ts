import type { StorageAdapter } from 'grammy';
import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { grammySessions } from './schema.js';
import { logger } from './logger.js';

interface L1CacheEntry<T> {
  readonly value: T;
  readonly rawJson: string;
  readonly expiresAt: number;
}

export class PostgresSessionAdapter<T> implements StorageAdapter<T> {
  /**
   * In-memory L1 cache to avoid redundant database round-trips for active users.
   */
  private readonly l1Cache = new Map<string, L1CacheEntry<T>>();

  /**
   * Snapshot loaded by the current update. grammY persists an accessed session
   * after middleware completes even when its JSON did not change. Remembering
   * the read snapshot lets us skip that no-op UPSERT.
   */
  private readonly readSnapshots = new Map<string, string | undefined>();

  private readonly ttlMs: number;
  private readonly maxCapacity: number;

  constructor(options: { ttlMs?: number; maxCapacity?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
    this.maxCapacity = options.maxCapacity ?? 5_000;
  }

  async read(key: string): Promise<T | undefined> {
    try {
      const now = Date.now();
      const cached = this.l1Cache.get(key);
      if (cached && now < cached.expiresAt) {
        // Move to most recently used
        this.l1Cache.delete(key);
        this.l1Cache.set(key, cached);
        this.rememberReadSnapshot(key, cached.rawJson);
        return JSON.parse(cached.rawJson) as T;
      }

      const db = getDb();
      const rows = await db
        .select()
        .from(grammySessions)
        .where(eq(grammySessions.key, key))
        .limit(1);
      if (rows.length === 0) {
        this.l1Cache.delete(key);
        this.rememberReadSnapshot(key, undefined);
        return undefined;
      }
      const value = rows[0].value;
      const parsed = JSON.parse(value) as T;
      this.setL1Cache(key, parsed, value);
      this.rememberReadSnapshot(key, value);
      return parsed;
    } catch (err) {
      logger.error({ err, key }, 'Failed to read session from DB');
      throw new Error('SESSION_READ_FAILED', { cause: err });
    }
  }

  async write(key: string, value: T): Promise<void> {
    try {
      const strVal = JSON.stringify(value);
      this.setL1Cache(key, value, strVal);
      const hadReadSnapshot = this.readSnapshots.has(key);
      const readSnapshot = this.readSnapshots.get(key);
      this.readSnapshots.delete(key);
      if (hadReadSnapshot && readSnapshot === strVal) return;

      const db = getDb();
      await db
        .insert(grammySessions)
        .values({ key, value: strVal })
        .onConflictDoUpdate({
          target: grammySessions.key,
          set: { value: strVal },
        });
    } catch (err) {
      logger.error({ err, key }, 'Failed to write session to DB');
      throw new Error('SESSION_WRITE_FAILED', { cause: err });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.l1Cache.delete(key);
      this.readSnapshots.delete(key);
      const db = getDb();
      await db.delete(grammySessions).where(eq(grammySessions.key, key));
    } catch (err) {
      logger.error({ err, key }, 'Failed to delete session from DB');
      throw new Error('SESSION_DELETE_FAILED', { cause: err });
    }
  }

  private setL1Cache(key: string, value: T, rawJson: string): void {
    if (this.ttlMs <= 0) return;
    this.l1Cache.set(key, {
      value,
      rawJson,
      expiresAt: Date.now() + this.ttlMs,
    });
    if (this.l1Cache.size > this.maxCapacity) {
      const oldest = this.l1Cache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.l1Cache.delete(oldest);
    }
  }

  private rememberReadSnapshot(key: string, value: string | undefined): void {
    this.readSnapshots.set(key, value);
    // Defensive bound for interrupted updates that never reach write/delete.
    if (this.readSnapshots.size <= 10_000) return;
    const oldest = this.readSnapshots.keys().next().value as string | undefined;
    if (oldest !== undefined) this.readSnapshots.delete(oldest);
  }
}
