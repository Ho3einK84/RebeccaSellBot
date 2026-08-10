import type { StorageAdapter } from 'grammy';
import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { grammySessions } from './schema.js';
import { logger } from './logger.js';

export class PostgresSessionAdapter<T> implements StorageAdapter<T> {
  async read(key: string): Promise<T | undefined> {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(grammySessions)
        .where(eq(grammySessions.key, key))
        .limit(1);
      if (rows.length === 0) return undefined;
      return JSON.parse(rows[0].value) as T;
    } catch (err) {
      logger.error({ err, key }, 'Failed to read session from DB');
      throw new Error('SESSION_READ_FAILED', { cause: err });
    }
  }

  async write(key: string, value: T): Promise<void> {
    try {
      const db = getDb();
      const strVal = JSON.stringify(value);
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
      const db = getDb();
      await db.delete(grammySessions).where(eq(grammySessions.key, key));
    } catch (err) {
      logger.error({ err, key }, 'Failed to delete session from DB');
      throw new Error('SESSION_DELETE_FAILED', { cause: err });
    }
  }
}
