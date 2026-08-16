import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configLockKey, withConfigLock } from '../../src/domain/services/ConfigLock.js';
import { getPool } from '../../src/infra/db.js';

vi.mock('../../src/infra/db.js', () => ({
  getPool: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('ConfigLock — Canonical per-config PostgreSQL advisory locking', () => {
  const getPoolMock = vi.mocked(getPool);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('configLockKey', () => {
    it('generates a deterministic 64-bit BigInt key', () => {
      const key1 = configLockKey('panel_1', 'user_alpha');
      const key2 = configLockKey('panel_1', 'user_alpha');
      expect(typeof key1).toBe('bigint');
      expect(key1).toBe(key2);
    });

    it('is case-insensitive for config usernames', () => {
      const keyLower = configLockKey('panel_1', 'alice_vpn');
      const keyUpper = configLockKey('panel_1', 'ALICE_VPN');
      const keyMixed = configLockKey('panel_1', 'Alice_Vpn');
      expect(keyLower).toBe(keyUpper);
      expect(keyLower).toBe(keyMixed);
    });

    it('differentiates distinct panels and distinct usernames', () => {
      const keyPanelA = configLockKey('panel_a', 'user_1');
      const keyPanelB = configLockKey('panel_b', 'user_1');
      const keyUser2 = configLockKey('panel_a', 'user_2');

      expect(keyPanelA).not.toBe(keyPanelB);
      expect(keyPanelA).not.toBe(keyUser2);
    });
  });

  describe('withConfigLock', () => {
    it('executes the callback and releases the advisory lock on success', async () => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue(client),
      } as never);

      let executed = false;
      const result = await withConfigLock('panel_1', 'alice', async () => {
        executed = true;
        return 42;
      });

      expect(result).toBe(42);
      expect(executed).toBe(true);
      expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        expect.any(Array)
      );
      expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
        expect.any(Array)
      );
      expect(client.release).toHaveBeenCalledWith(undefined);
    });

    it('fails fast with CONFIG_MUTATION_BUSY when lock cannot be acquired', async () => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue(client),
      } as never);

      await expect(
        withConfigLock('panel_1', 'alice', async () => {
          return 'should_not_run';
        })
      ).rejects.toThrow('CONFIG_MUTATION_BUSY');

      expect(client.release).toHaveBeenCalled();
    });

    it('always releases the lock even if the callback throws', async () => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue(client),
      } as never);

      await expect(
        withConfigLock('panel_1', 'alice', async () => {
          throw new Error('OPERATION_FAILED');
        })
      ).rejects.toThrow('OPERATION_FAILED');

      expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
        expect.any(Array)
      );
      expect(client.release).toHaveBeenCalledWith(undefined);
    });

    it('discards the connection if unlock query fails', async () => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sql.includes('pg_advisory_unlock')) throw new Error('DB_DISCONNECTED');
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      getPoolMock.mockReturnValue({
        connect: vi.fn().mockResolvedValue(client),
      } as never);

      await withConfigLock('panel_1', 'alice', async () => 'ok');
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
