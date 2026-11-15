import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getDb, initDatabase } from './db.js';
import { logger } from './logger.js';
import dotenv from 'dotenv';
import type { drizzle } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

dotenv.config();

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle'
);

export async function autoMigrate(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  logger.info('Auto-checking & running database migrations...');
  try {
    await migrate(dbInstance, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info('Database migrations applied successfully');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to run database migrations');
    throw err;
  }
}

export async function runMigrationsStandalone(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }
  logger.info('Running standalone database migrations script...');

  initDatabase(dbUrl);
  const db = getDb();

  try {
    await autoMigrate(db);
  } finally {
    await closeDatabase();
  }
}

// Run directly if invoked via CLI
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrationsStandalone().catch(() => process.exit(1));
}
