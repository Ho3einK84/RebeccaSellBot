import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env.DATABASE_URL;
const mocks = vi.hoisted(() => ({
  autoMigrate: vi.fn(),
  closeDatabase: vi.fn(),
  getDb: vi.fn(),
  initDatabase: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../../src/infra/db.js', () => ({
  closeDatabase: mocks.closeDatabase,
  getDb: mocks.getDb,
  initDatabase: mocks.initDatabase,
}));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: mocks.autoMigrate }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo },
}));

async function loadMigrationModule(databaseUrl: string | undefined) {
  vi.resetModules();
  if (databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = databaseUrl;
  }
  return import('../../src/infra/migrate.js');
}

afterEach(() => {
  vi.clearAllMocks();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('runMigrationsStandalone', () => {
  it('fails closed when DATABASE_URL is missing', async () => {
    const { runMigrationsStandalone } = await loadMigrationModule(undefined);

    await expect(runMigrationsStandalone()).rejects.toThrow(
      'DATABASE_URL is required to run database migrations'
    );
    expect(mocks.initDatabase).not.toHaveBeenCalled();
  });

  it('initializes, migrates, and closes the explicitly configured database', async () => {
    const db = {};
    mocks.getDb.mockReturnValue(db);
    const { runMigrationsStandalone } = await loadMigrationModule(
      'postgres://user:password@localhost:5432/rsbot_test'
    );

    await expect(runMigrationsStandalone()).resolves.toBeUndefined();

    expect(mocks.initDatabase).toHaveBeenCalledWith(
      'postgres://user:password@localhost:5432/rsbot_test'
    );
    expect(mocks.autoMigrate).toHaveBeenCalledWith(db, { migrationsFolder: './drizzle' });
    expect(mocks.closeDatabase).toHaveBeenCalledOnce();
  });

  it('closes the database when migration fails', async () => {
    mocks.getDb.mockReturnValue({});
    mocks.autoMigrate.mockRejectedValueOnce(new Error('migration failed'));
    const { runMigrationsStandalone } = await loadMigrationModule(
      'postgres://user:password@localhost:5432/rsbot_test'
    );

    await expect(runMigrationsStandalone()).rejects.toThrow('migration failed');
    expect(mocks.closeDatabase).toHaveBeenCalledOnce();
  });
});
