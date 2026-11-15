import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoistedMocks = vi.hoisted(() => ({
  migrate: vi.fn(),
  endPool: vi.fn(),
  poolQuery: vi.fn(),
  dbSelectResult: vi.fn(),
  dbInsertExecute: vi.fn(),
  dbDeleteExecute: vi.fn(),
  drizzleFactory: vi.fn(),
}));

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: hoistedMocks.migrate,
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: hoistedMocks.drizzleFactory,
}));

vi.mock('pg', () => {
  class MockPool {
    query = hoistedMocks.poolQuery;
    end = hoistedMocks.endPool;
    on = vi.fn();
    connect = vi.fn();
  }
  return {
    default: { Pool: MockPool },
    Pool: MockPool,
  };
});

describe('db & migrate — pool lifecycle, cwd-independent migrations, and safe error logging', () => {
  beforeEach(() => {
    vi.resetModules();
    hoistedMocks.migrate.mockReset().mockResolvedValue(undefined);
    hoistedMocks.endPool.mockReset().mockResolvedValue(undefined);
    hoistedMocks.drizzleFactory.mockReset().mockImplementation((pool) => ({ __pool: pool }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enforces initDatabase prerequisite, reuses initialized singleton, and closes cleanly', async () => {
    const dbMod = await import('../../src/infra/db.js');
    expect(() => dbMod.getDb()).toThrow(/not initialized/i);
    expect(() => dbMod.getPool()).toThrow(/not initialized/i);

    const first = dbMod.initDatabase('postgres://u:p@localhost:5432/db');
    const second = dbMod.initDatabase('postgres://u:p@localhost:5432/other');
    expect(second.db).toBe(first.db);
    expect(second.pool).toBe(first.pool);
    expect(dbMod.getDb()).toBe(first.db);
    expect(dbMod.getPool()).toBe(first.pool);

    await dbMod.closeDatabase();
    expect(hoistedMocks.endPool).toHaveBeenCalledTimes(1);
    expect(() => dbMod.getDb()).toThrow(/not initialized/i);
  });

  it('autoMigrate resolves migrations relative to module regardless of process.cwd() and passes real Error on failure', async () => {
    const prevCwd = process.cwd();
    const { logger } = await import('../../src/infra/logger.js');
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const { autoMigrate } = await import('../../src/infra/migrate.js');

    process.chdir('/tmp');
    try {
      await autoMigrate({} as never);
      expect(hoistedMocks.migrate).toHaveBeenCalledTimes(1);
      const passedFolder = (hoistedMocks.migrate.mock.calls[0]![1] as { migrationsFolder: string })
        .migrationsFolder;
      expect(passedFolder).toBe(path.resolve(prevCwd, 'drizzle'));

      const boom = new Error('relation already exists');
      hoistedMocks.migrate.mockRejectedValueOnce(boom);
      await expect(autoMigrate({} as never)).rejects.toThrow('relation already exists');
      expect(errSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: boom }),
        expect.stringContaining('migration')
      );
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('runMigrationsStandalone fails closed without DATABASE_URL and always closes database', async () => {
    vi.stubEnv('DATABASE_URL', undefined as unknown as string);
    const { runMigrationsStandalone } = await import('../../src/infra/migrate.js');
    await expect(runMigrationsStandalone()).rejects.toThrow('DATABASE_URL');

    vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/db');
    await runMigrationsStandalone();
    expect(hoistedMocks.migrate).toHaveBeenCalledTimes(1);
    expect(hoistedMocks.endPool).toHaveBeenCalledTimes(1);

    hoistedMocks.migrate.mockRejectedValueOnce(new Error('migration failure'));
    await expect(runMigrationsStandalone()).rejects.toThrow('migration failure');
    expect(hoistedMocks.endPool).toHaveBeenCalledTimes(2);
  });
});

describe('PostgresSessionAdapter — write elision, L1 LRU promotion/eviction, and invalidation', () => {
  beforeEach(() => {
    vi.resetModules();
    hoistedMocks.dbSelectResult.mockReset().mockResolvedValue([]);
    hoistedMocks.dbInsertExecute.mockReset().mockResolvedValue(undefined);
    hoistedMocks.dbDeleteExecute.mockReset().mockResolvedValue(undefined);
    const fakeDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => hoistedMocks.dbSelectResult()),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => hoistedMocks.dbInsertExecute()),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => hoistedMocks.dbDeleteExecute()),
      })),
    };
    hoistedMocks.drizzleFactory.mockReturnValue(fakeDb);
  });

  it('skips UPSERT when unchanged, persists mutations, serves L1 cache hits, and invalidates on delete', async () => {
    const dbMod = await import('../../src/infra/db.js');
    dbMod.initDatabase('postgres://u:p@localhost:5432/db');
    const { PostgresSessionAdapter } = await import('../../src/infra/sessionAdapter.js');

    const adapter = new PostgresSessionAdapter<{ step: string }>();
    hoistedMocks.dbSelectResult.mockResolvedValueOnce([
      { value: JSON.stringify({ step: 'home' }) },
    ]);

    expect(await adapter.read('k1')).toEqual({ step: 'home' });
    expect(hoistedMocks.dbSelectResult).toHaveBeenCalledTimes(1);

    await adapter.write('k1', { step: 'home' });
    expect(hoistedMocks.dbInsertExecute).not.toHaveBeenCalled();

    await adapter.write('k1', { step: 'checkout' });
    expect(hoistedMocks.dbInsertExecute).toHaveBeenCalledTimes(1);

    expect(await adapter.read('k1')).toEqual({ step: 'checkout' });
    expect(hoistedMocks.dbSelectResult).toHaveBeenCalledTimes(1);

    await adapter.delete('k1');
    expect(hoistedMocks.dbDeleteExecute).toHaveBeenCalledTimes(1);
    hoistedMocks.dbSelectResult.mockResolvedValueOnce([]);
    expect(await adapter.read('k1')).toBeUndefined();
    expect(hoistedMocks.dbSelectResult).toHaveBeenCalledTimes(2);
    await dbMod.closeDatabase();
  });

  it('evicts the least-recently-used entry (LRU recency promotion on read) and handles maxCapacity <= 0 safely', async () => {
    const dbMod = await import('../../src/infra/db.js');
    dbMod.initDatabase('postgres://u:p@localhost:5432/db');
    const { PostgresSessionAdapter } = await import('../../src/infra/sessionAdapter.js');

    const lruAdapter = new PostgresSessionAdapter<{ v: number }>({ maxCapacity: 2 });
    await lruAdapter.write('a', { v: 1 });
    await lruAdapter.write('b', { v: 2 });
    expect(await lruAdapter.read('a')).toEqual({ v: 1 });
    await lruAdapter.write('c', { v: 3 });

    expect(hoistedMocks.dbSelectResult).not.toHaveBeenCalled();
    expect(await lruAdapter.read('a')).toEqual({ v: 1 });
    expect(hoistedMocks.dbSelectResult).not.toHaveBeenCalled();

    hoistedMocks.dbSelectResult.mockResolvedValueOnce([{ value: JSON.stringify({ v: 2 }) }]);
    expect(await lruAdapter.read('b')).toEqual({ v: 2 });
    expect(hoistedMocks.dbSelectResult).toHaveBeenCalledTimes(1);

    const uncached = new PostgresSessionAdapter<{ v: number }>({ maxCapacity: 0 });
    await uncached.write('x', { v: 10 });
    hoistedMocks.dbSelectResult.mockResolvedValueOnce([{ value: JSON.stringify({ v: 10 }) }]);
    expect(await uncached.read('x')).toEqual({ v: 10 });
    expect(hoistedMocks.dbSelectResult).toHaveBeenCalledTimes(2);
    await dbMod.closeDatabase();
  });
});
