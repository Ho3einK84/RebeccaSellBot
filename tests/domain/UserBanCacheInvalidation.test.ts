import { describe, expect, it, vi } from 'vitest';
import { UserService } from '../../src/domain/services/UserService.js';
import { getDb } from '../../src/infra/db.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('UserBanCacheInvalidation', () => {
  it('triggers registered invalidation hooks immediately on setBanned', async () => {
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ telegramId: 123456789, isBanned: true }])),
          })),
        })),
      })),
    };
    const mockDb = {
      transaction: vi.fn(async (cb) => cb(tx)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as any);

    const userService = new UserService();
    const hook = vi.fn();
    userService.registerInvalidationHook(hook);

    await userService.setBanned(123456789, true);

    expect(hook).toHaveBeenCalledWith(123456789);
  });
});
