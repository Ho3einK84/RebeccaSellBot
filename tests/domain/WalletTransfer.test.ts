import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletService } from '../../src/domain/services/WalletService.js';
import { getDb } from '../../src/infra/db.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type FakeDbState = {
  readonly insertValues: Array<Record<string, unknown>>;
  readonly setCalls: Array<Record<string, unknown>>;
  readonly updateCalls: Array<unknown>;
  readonly returningResults: unknown[][];
  readonly selectResults: unknown[][];
  readonly transaction: ReturnType<typeof vi.fn>;
};

function createDbMock(
  options: {
    returningResults?: unknown[][];
    selectResults?: unknown[][];
  } = {}
): { db: unknown; state: FakeDbState } {
  const state: FakeDbState = {
    insertValues: [],
    setCalls: [],
    updateCalls: [],
    returningResults: [...(options.returningResults ?? [])],
    selectResults: [...(options.selectResults ?? [])],
    transaction: vi.fn(),
  };

  const db = {
    select: vi.fn(() => {
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        for: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve(state.selectResults.shift() ?? [])),
      };
      return query;
    }),
    insert: vi.fn(() => {
      const query = {
        values: vi.fn((values: Record<string, unknown>) => {
          state.insertValues.push(values);
          return query;
        }),
        onConflictDoNothing: vi.fn(() => query),
        returning: vi.fn(() => Promise.resolve(state.returningResults.shift() ?? [])),
      };
      return query;
    }),
    update: vi.fn((table: unknown) => {
      state.updateCalls.push(table);
      const query = {
        set: vi.fn((values: Record<string, unknown>) => {
          state.setCalls.push(values);
          return query;
        }),
        where: vi.fn(() => query),
        returning: vi.fn(() =>
          Promise.resolve(
            state.returningResults.shift() ?? [
              { id: 'mock_row', telegramId: 1001, balance: 50_000 },
            ]
          )
        ),
      };
      return query;
    }),
    transaction: state.transaction,
  };
  state.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) =>
    callback(db)
  );

  return { db, state };
}

describe('WalletService.transferBalance', () => {
  let walletService: WalletService;

  beforeEach(() => {
    vi.clearAllMocks();
    walletService = new WalletService(
      {
        getService: vi.fn(),
        getDefaultPanelId: vi.fn(),
      } as unknown as RebeccaPanelRegistry,
      {} as TranslationService,
      {} as ReferralService,
      {} as PromoService
    );
  });

  it('successfully transfers balance between two valid users', async () => {
    const sender = {
      telegramId: 100,
      balance: 50_000,
      reservedBalance: 0,
      isBanned: false,
    };
    const recipient = {
      telegramId: 200,
      balance: 10_000,
      reservedBalance: 0,
      isBanned: false,
    };

    const { db, state } = createDbMock({
      selectResults: [[sender], [recipient]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await walletService.transferBalance({
      fromTelegramId: 100,
      toTelegramId: 200,
      amount: 20_000,
      description: 'Gift',
    });

    expect(result.success).toBe(true);
    expect(result.fromTelegramId).toBe(100);
    expect(result.toTelegramId).toBe(200);
    expect(result.amount).toBe(20_000);
    expect(result.fromBalanceAfter).toBe(30_000);
    expect(result.toBalanceAfter).toBe(30_000);

    // Verify balance updates
    expect(state.setCalls).toContainEqual(expect.objectContaining({ balance: 30_000 }));

    // Verify wallet transactions: one debit, one credit
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        telegramId: 100,
        amount: -20_000,
        balanceAfter: 30_000,
        type: 'transfer_sent',
        description: 'Transfer to 200: Gift',
      })
    );
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        telegramId: 200,
        amount: 20_000,
        balanceAfter: 30_000,
        type: 'transfer_received',
        description: 'Transfer from 100: Gift',
      })
    );

    // Verify audit log
    expect(state.insertValues).toContainEqual(
      expect.objectContaining({
        actorTelegramId: 100,
        action: 'wallet_transfer',
        targetTelegramId: 200,
      })
    );
  });

  it('rejects self-transfer', async () => {
    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 100,
        amount: 5_000,
      })
    ).rejects.toThrow('TRANSFER_TO_SELF');
  });

  it('rejects invalid transfer amounts', async () => {
    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 0,
      })
    ).rejects.toThrow('INVALID_TRANSFER_AMOUNT');

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: -1000,
      })
    ).rejects.toThrow('INVALID_TRANSFER_AMOUNT');

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 1.5,
      })
    ).rejects.toThrow('INVALID_TRANSFER_AMOUNT');
  });

  it('rejects transfer when sender has insufficient available balance', async () => {
    const sender = {
      telegramId: 100,
      balance: 15_000,
      reservedBalance: 10_000, // available is only 5,000
      isBanned: false,
    };
    const recipient = {
      telegramId: 200,
      balance: 0,
      reservedBalance: 0,
      isBanned: false,
    };

    const { db } = createDbMock({
      selectResults: [[sender], [recipient]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 10_000,
      })
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it('rejects transfer when sender is banned', async () => {
    const sender = {
      telegramId: 100,
      balance: 50_000,
      reservedBalance: 0,
      isBanned: true,
    };
    const recipient = {
      telegramId: 200,
      balance: 0,
      reservedBalance: 0,
      isBanned: false,
    };

    const { db } = createDbMock({
      selectResults: [[sender], [recipient]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 5_000,
      })
    ).rejects.toThrow('SENDER_BANNED');
  });

  it('rejects transfer when recipient is banned', async () => {
    const sender = {
      telegramId: 100,
      balance: 50_000,
      reservedBalance: 0,
      isBanned: false,
    };
    const recipient = {
      telegramId: 200,
      balance: 0,
      reservedBalance: 0,
      isBanned: true,
    };

    const { db } = createDbMock({
      selectResults: [[sender], [recipient]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 5_000,
      })
    ).rejects.toThrow('TRANSFER_TARGET_BANNED');
  });

  it('rejects transfer when recipient is not found', async () => {
    const sender = {
      telegramId: 100,
      balance: 50_000,
      reservedBalance: 0,
      isBanned: false,
    };

    const { db } = createDbMock({
      selectResults: [[sender], []],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 5_000,
      })
    ).rejects.toThrow('TRANSFER_TARGET_NOT_FOUND');
  });

  it('enforces idempotency when referenceId is supplied', async () => {
    const sender = {
      telegramId: 100,
      balance: 50_000,
      reservedBalance: 0,
      isBanned: false,
    };
    const recipient = {
      telegramId: 200,
      balance: 0,
      reservedBalance: 0,
      isBanned: false,
    };
    const existingTx = { id: 'tx_existing' };

    const { db } = createDbMock({
      selectResults: [[sender], [recipient], [existingTx]],
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      walletService.transferBalance({
        fromTelegramId: 100,
        toTelegramId: 200,
        amount: 5_000,
        referenceId: 'ref_123',
      })
    ).rejects.toThrow('TRANSFER_ALREADY_PROCESSED');
  });
});
