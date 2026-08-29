import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { WalletService } from '../../src/domain/services/WalletService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

describe('WalletService.listTransactionsForUser', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('queries paginated wallet transactions for user', async () => {
    const mockRows = [
      {
        id: 'tx_1',
        telegramId: 100,
        amount: 50000,
        balanceAfter: 50000,
        type: 'topup',
        description: 'Topup receipt approved',
        createdAt: new Date('2026-08-28T12:00:00Z'),
      },
    ];

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ count: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockReturnValueOnce({
                  offset: vi.fn().mockResolvedValueOnce(mockRows),
                }),
              }),
            }),
          }),
        }),
    };
    getDbMock.mockReturnValue(db as any);

    const service = new WalletService(
      {} as unknown as TranslationService,
      {} as any,
      {} as any,
      {} as any
    );
    const result = await service.listTransactionsForUser(100, 1, 5);

    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
    expect(result.transactions).toEqual(mockRows);
  });
});
