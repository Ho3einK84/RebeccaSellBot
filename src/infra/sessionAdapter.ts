import type { StorageAdapter } from 'grammy';
import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { grammySessions } from './schema.js';
import { logger } from './logger.js';

export class PostgresSessionAdapter<T> implements StorageAdapter<T> {
  /**
   * Snapshot loaded by the current update. grammY persists an accessed session
   * after middleware completes even when its JSON did not change. Remembering
   * the read snapshot lets us skip that no-op UPSERT without caching session
   * reads across updates (which would be unsafe with multiple bot replicas).
   */
  private readonly readSnapshots = new Map<string, string | undefined>();

  async read(key: string): Promise<T | undefined> {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(grammySessions)
        .where(eq(grammySessions.key, key))
        .limit(1);
      if (rows.length === 0) {
        this.rememberReadSnapshot(key, undefined);
        return undefined;
      }
      const value = rows[0].value;
      this.rememberReadSnapshot(key, value);
      return JSON.parse(value) as T;
    } catch (err) {
      logger.error({ err, key }, 'Failed to read session from DB');
      throw new Error('SESSION_READ_FAILED', { cause: err });
    }
  }

  async write(key: string, value: T): Promise<void> {
    try {
      const db = getDb();
      const strVal = JSON.stringify(value);
      const hadReadSnapshot = this.readSnapshots.has(key);
      const readSnapshot = this.readSnapshots.get(key);
      this.readSnapshots.delete(key);
      if (hadReadSnapshot && readSnapshot === strVal) return;

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
      this.readSnapshots.delete(key);
      const db = getDb();
      await db.delete(grammySessions).where(eq(grammySessions.key, key));
    } catch (err) {
      logger.error({ err, key }, 'Failed to delete session from DB');
      throw new Error('SESSION_DELETE_FAILED', { cause: err });
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
