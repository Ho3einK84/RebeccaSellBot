import { beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
const selectQuery = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: limitMock,
};
const conflictUpdateMock = vi.fn().mockResolvedValue(undefined);
const insertQuery = {
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: conflictUpdateMock,
};
const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
const dbMock = {
  select: vi.fn(() => selectQuery),
  insert: vi.fn(() => insertQuery),
  delete: vi.fn(() => ({ where: deleteWhereMock })),
};

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(() => dbMock),
}));

import { PostgresSessionAdapter } from '../../src/infra/sessionAdapter.js';

describe('PostgresSessionAdapter write elision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the UPSERT when grammY writes back an unchanged session', async () => {
    const adapter = new PostgresSessionAdapter<{ page?: number }>();
    limitMock.mockResolvedValueOnce([{ key: '1:1', value: '{"page":2}' }]);

    const session = await adapter.read('1:1');
    await adapter.write('1:1', session!);

    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('persists a session when its serialized value changed', async () => {
    const adapter = new PostgresSessionAdapter<{ page?: number }>();
    limitMock.mockResolvedValueOnce([{ key: '1:1', value: '{"page":2}' }]);

    const session = await adapter.read('1:1');
    session!.page = 3;
    await adapter.write('1:1', session!);

    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(insertQuery.values).toHaveBeenCalledWith({ key: '1:1', value: '{"page":3}' });
    expect(conflictUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('serves repeated reads from in-memory L1 cache without querying database', async () => {
    const adapter = new PostgresSessionAdapter<{ count?: number }>();
    limitMock.mockResolvedValueOnce([{ key: 'user:10', value: '{"count":42}' }]);

    const firstRead = await adapter.read('user:10');
    expect(firstRead).toEqual({ count: 42 });
    expect(dbMock.select).toHaveBeenCalledTimes(1);

    const secondRead = await adapter.read('user:10');
    expect(secondRead).toEqual({ count: 42 });
    // select should not have been called a second time
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('invalidates L1 cache on delete', async () => {
    const adapter = new PostgresSessionAdapter<{ count?: number }>();
    limitMock.mockResolvedValueOnce([{ key: 'user:11', value: '{"count":1}' }]);

    await adapter.read('user:11');
    expect(dbMock.select).toHaveBeenCalledTimes(1);

    await adapter.delete('user:11');
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);

    limitMock.mockResolvedValueOnce([{ key: 'user:11', value: '{"count":2}' }]);
    const thirdRead = await adapter.read('user:11');
    expect(thirdRead).toEqual({ count: 2 });
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });
});
