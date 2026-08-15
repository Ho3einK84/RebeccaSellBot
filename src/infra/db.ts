import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { logger } from './logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function initDatabase(connectionString: string) {
  if (db && pool) return { db, pool };

  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  db = drizzle(pool, { schema });
  return { db, pool };
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase first.');
  return db;
}

export function getPool() {
  if (!pool) throw new Error('Database pool not initialized. Call initDatabase first.');
  return pool;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
