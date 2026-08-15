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
});
