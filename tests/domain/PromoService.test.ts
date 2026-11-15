import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { PromoService, type PromoValidationError } from '../../src/domain/services/PromoService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('PromoService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates percentage (capped), fixed-credit, gift-GB quotes and normalizes Persian/Arabic digits', async () => {
    const service = new PromoService();

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_percent',
              value: 25,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 2,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'SAVE25', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 60_000,
      finalGbAmount: 10,
    });

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_percent',
              value: 50,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 10,
              maxUsesPerUser: 1,
              minPurchaseAmount: 0,
              maxDiscountAmount: 30_000,
              firstPurchaseOnly: false,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'HALF50', 200_000, 20)).resolves.toMatchObject({
      finalAmount: 170_000,
      discountAmount: 30_000,
    });

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_fixed',
              value: 100_000,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 2,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'BIG', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 0,
      finalGbAmount: 10,
    });

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'gift_gb',
              value: 5,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 2,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'EXTRA5', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 80_000,
      finalGbAmount: 15,
    });

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_fixed',
              value: 50_000,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 10,
              maxUsesPerUser: 1,
              minPurchaseAmount: 0,
              firstPurchaseOnly: false,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'OFF۵۰', 100_000, 10)).resolves.toMatchObject({
      code: 'OFF50',
      finalAmount: 50_000,
    });
  });

  it('rejects gift_credit codes, minimum purchase misses, per-user caps, and non-first-purchase attempts', async () => {
    const service = new PromoService();

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'gift_credit',
              value: 10_000,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 1,
            },
          ],
          [],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'CREDIT', 80_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_not_purchase_code',
    } satisfies Partial<PromoValidationError>);

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_percent',
              value: 10,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 10,
              maxUsesPerUser: 2,
              minPurchaseAmount: 100_000,
            },
          ],
          [{ value: 0 }],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'MIN100', 99_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_minimum_purchase_not_met',
    } satisfies Partial<PromoValidationError>);

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_percent',
              value: 10,
              active: true,
              expiresAt: null,
              currentUses: 1,
              maxUses: 10,
              maxUsesPerUser: 1,
              minPurchaseAmount: 0,
            },
          ],
          [{ value: 1 }],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'ONE-EACH', 100_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_user_max_uses_reached',
    } satisfies Partial<PromoValidationError>);

    getDbMock.mockReturnValueOnce(
      createMockDb({
        selectResults: [
          [
            {
              type: 'discount_percent',
              value: 20,
              active: true,
              expiresAt: null,
              currentUses: 0,
              maxUses: 10,
              maxUsesPerUser: 1,
              minPurchaseAmount: 0,
              firstPurchaseOnly: true,
            },
          ],
          [{ value: 1 }],
        ],
      }).db as never
    );
    await expect(service.quoteForPurchase(10, 'WELCOME', 100_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_first_purchase_only',
    } satisfies Partial<PromoValidationError>);
  });

  it('reserves purchase promo atomically locking code cap before inserting per-user redemption', async () => {
    const order: string[] = [];
    const mock = createMockDb({
      selectResults: [
        [
          {
            type: 'discount_fixed',
            value: 10_000,
            active: true,
            expiresAt: null,
            currentUses: 0,
            maxUses: 1,
          },
        ],
        [],
      ],
      returningResults: [[{ type: 'discount_fixed', value: 10_000 }], [{ code: 'SAFE10' }]],
    });
    const origUpdate = mock.db.update as ReturnType<typeof vi.fn>;
    const origInsert = mock.db.insert as ReturnType<typeof vi.fn>;
    mock.db.update = vi.fn((t) => {
      order.push('update');
      return origUpdate(t);
    });
    mock.db.insert = vi.fn((t) => {
      order.push('insert');
      return origInsert(t);
    });

    const service = new PromoService();
    await expect(
      service.reserveForPurchase(mock.db as never, {
        telegramId: 10,
        intentId: 'pi_1',
        rawCode: 'safe10',
        baseAmount: 80_000,
        baseGbAmount: 10,
      })
    ).resolves.toMatchObject({
      code: 'SAFE10',
      finalAmount: 70_000,
      finalGbAmount: 10,
      intentId: 'pi_1',
    });
    expect(order).toEqual(['update', 'insert']);
  });

  it('toggles promo active state and creates bulk promo codes within DB column bounds', async () => {
    const toggleDb = createMockDb({ returningResults: [[{ code: 'PAUSED' }], []] });
    getDbMock.mockReturnValue(toggleDb.db as never);
    const service = new PromoService();
    await expect(service.setPromoActive('paused', false)).resolves.toBe(true);
    await expect(service.setPromoActive('paused', true)).resolves.toBe(false);

    const bulkDb = createMockDb({ selectHandler: () => [] });
    getDbMock.mockReturnValue(bulkDb.db as never);
    const codes = await service.createBulkPromoCodes({
      count: 3,
      prefix: 'VIP۱۴۰۳_' + 'A'.repeat(150),
      type: 'discount_percent',
      value: 20,
      maxUses: 5,
      maxDiscountAmount: 50_000,
      firstPurchaseOnly: true,
    });

    expect(codes).toHaveLength(3);
    expect(codes[0]!.length).toBeLessThanOrEqual(128);
    expect(codes[0]).toMatch(/^VIP1403_A+-[A-F0-9]{8}$/);
    expect(bulkDb.state.insertCalls).toHaveLength(3);
  });

  it('throws PROMO_BULK_GENERATION_COLLISION when every random attempt collides in DB', async () => {
    const collisionDb = createMockDb({
      selectHandler: () => [{ code: 'TAKEN' }],
    });
    getDbMock.mockReturnValue(collisionDb.db as never);

    await expect(
      new PromoService().createBulkPromoCodes({
        count: 1,
        prefix: 'DUP',
        type: 'discount_fixed',
        value: 10_000,
      })
    ).rejects.toThrow('PROMO_BULK_GENERATION_COLLISION');
    expect(collisionDb.state.insertCalls).toHaveLength(0);
  });

  it('re-fetches redemptions at resolvedPage when requested page exceeds totalPages', async () => {
    const fakeRow = {
      id: 'red_1',
      code: 'SAVE20',
      telegramId: 12345,
      status: 'completed',
      redeemedAt: new Date('2026-01-01'),
      purchaseIntentId: 'pi_1',
      username: 'alice',
      firstName: 'Alice',
      purchaseAmount: 80_000,
      purchaseType: 'purchase',
    };

    const mock = createMockDb({
      selectResults: [
        [{ value: 1 }], // page 5 count -> total=1, totalPages=1 -> clamps & recurses to page 1
        [],
        [{ value: 1 }], // page 1 count
        [fakeRow],
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    const result = await new PromoService().listRedemptions('save۲۰', 5, 5);
    expect(result.code).toBe('SAVE20');
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'red_1',
      username: 'alice',
      purchaseAmount: 80_000,
    });
  });
});
