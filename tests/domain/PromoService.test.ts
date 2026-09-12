import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { PromoService } from '../../src/domain/services/PromoService.js';
import type { PromoValidationError } from '../../src/domain/services/PromoService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

function databaseWithSelectResults(selectResults: unknown[][]) {
  const queued = [...selectResults];
  return {
    select: vi.fn(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue(queued.shift() ?? []),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      return query;
    }),
  };
}

describe('PromoService purchase quotes and reservations', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calculates percentage, fixed-credit, and gift-GB quotes from server-side base values', async () => {
    const service = new PromoService();

    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
      ]) as never
    );
    await expect(service.quoteForPurchase(10, 'SAVE25', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 60_000,
      finalGbAmount: 10,
    });

    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
      ]) as never
    );
    await expect(service.quoteForPurchase(10, 'BIG', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 0,
      finalGbAmount: 10,
    });

    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
      ]) as never
    );
    await expect(service.quoteForPurchase(10, 'EXTRA5', 80_000, 10)).resolves.toMatchObject({
      finalAmount: 80_000,
      finalGbAmount: 15,
    });
  });

  it('does not let a wallet-credit code masquerade as a purchase discount', async () => {
    const service = new PromoService();
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
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
      ]) as never
    );

    await expect(service.quoteForPurchase(10, 'CREDIT', 80_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_not_purchase_code',
    } satisfies Partial<PromoValidationError>);
  });

  it('enforces minimum purchase values and per-user caps before displaying a quote', async () => {
    const service = new PromoService();
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
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
      ]) as never
    );
    await expect(service.quoteForPurchase(10, 'MIN100', 99_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_minimum_purchase_not_met',
    } satisfies Partial<PromoValidationError>);

    getDbMock.mockReturnValue(
      databaseWithSelectResults([
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
      ]) as never
    );
    await expect(service.quoteForPurchase(10, 'ONE-EACH', 100_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_user_max_uses_reached',
    } satisfies Partial<PromoValidationError>);
  });

  it('reserves one user redemption before atomically consuming code capacity', async () => {
    const selectResults: unknown[][] = [
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
    ];
    const tx = databaseWithSelectResults(selectResults);
    const redemptionReturning = vi.fn().mockResolvedValue([{ code: 'SAFE10' }]);
    const promoReturning = vi.fn().mockResolvedValue([{ type: 'discount_fixed', value: 10_000 }]);
    const insert = vi.fn(() => {
      const onConflictDoNothing = vi.fn(() => ({ returning: redemptionReturning }));
      return { values: vi.fn(() => ({ onConflictDoNothing })) };
    });
    const update = vi.fn(() => {
      const where = vi.fn(() => ({ returning: promoReturning }));
      return { set: vi.fn(() => ({ where })) };
    });
    const transaction = { ...tx, insert, update };
    const service = new PromoService();

    await expect(
      service.reserveForPurchase(transaction as never, {
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

    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    // The guarded code-cap update takes the row lock before the per-user
    // redemption count/insert, closing the concurrent per-user-cap race.
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it('updates only an existing code activation state', async () => {
    const returning = vi.fn().mockResolvedValue([{ code: 'PAUSED' }]);
    const where = vi.fn(() => ({ returning }));
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where })) }));
    getDbMock.mockReturnValue({ update } as never);

    await expect(new PromoService().setPromoActive('paused', false)).resolves.toBe(true);
    expect(update).toHaveBeenCalledOnce();

    returning.mockResolvedValueOnce([]);
    await expect(new PromoService().setPromoActive('paused', true)).resolves.toBe(false);
  });

  it('caps percentage discount at maxDiscountAmount when specified', async () => {
    const service = new PromoService();
    // 50% discount on 200,000 would be 100,000, but capped at 30,000 -> finalAmount 170,000
    getDbMock.mockReturnValue(
      databaseWithSelectResults([
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
      ]) as never
    );

    const quote = await service.quoteForPurchase(10, 'HALF50', 200_000, 20);
    expect(quote.finalAmount).toBe(170_000);
    expect(quote.discountAmount).toBe(30_000);
  });

  it('enforces firstPurchaseOnly rule against completed purchase intents', async () => {
    const service = new PromoService();
    // User 10 has already completed 1 purchase
    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
        [{ value: 1 }], // count of completed purchases > 0
      ]) as never
    );

    await expect(service.quoteForPurchase(10, 'WELCOME', 100_000, 10)).rejects.toMatchObject({
      messageKey: 'promo_first_purchase_only',
    } satisfies Partial<PromoValidationError>);

    // New user with 0 completed purchases is accepted
    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
        [{ value: 0 }], // 0 completed purchases
        [{ value: 0 }], // 0 redemptions of this code
      ]) as never
    );

    await expect(service.quoteForPurchase(20, 'WELCOME', 100_000, 10)).resolves.toMatchObject({
      finalAmount: 80_000,
    });
  });

  it('normalizes Persian and Arabic digits in entered promo codes', async () => {
    const service = new PromoService();
    getDbMock.mockReturnValueOnce(
      databaseWithSelectResults([
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
      ]) as never
    );

    // Code typed with Persian digits: OFF۵۰ -> OFF50
    const quote = await service.quoteForPurchase(10, 'OFF۵۰', 100_000, 10);
    expect(quote.code).toBe('OFF50');
    expect(quote.finalAmount).toBe(50_000);
  });

  it('creates bulk promo codes with prefix normalization and transaction safety', async () => {
    const service = new PromoService();
    const insertedValues: unknown[] = [];
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((val) => {
          insertedValues.push(val);
          return Promise.resolve();
        }),
      })),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(tx)),
    } as never);

    const codes = await service.createBulkPromoCodes({
      count: 3,
      prefix: 'VIP۱۴۰۳',
      type: 'discount_percent',
      value: 20,
      maxUses: 5,
      maxDiscountAmount: 50_000,
      firstPurchaseOnly: true,
    });

    expect(codes).toHaveLength(3);
    expect(codes[0]).toMatch(/^VIP1403-[A-F0-9]{8}$/);
    expect(insertedValues).toHaveLength(3);
    expect(insertedValues[0]).toMatchObject({
      type: 'discount_percent',
      value: 20,
      maxUses: 5,
      maxDiscountAmount: 50_000,
      firstPurchaseOnly: true,
      active: true,
    });
  });

  it('lists redemptions with pagination and joins', async () => {
    const service = new PromoService();
    const fakeRows = [
      {
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
      },
    ];

    const countQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ value: 1 }]),
    };
    const selectQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue(fakeRows),
    };

    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValueOnce(countQuery).mockReturnValueOnce(selectQuery),
    } as never);

    const result = await service.listRedemptions('save۲۰', 1, 5);
    expect(result.code).toBe('SAVE20');
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'red_1',
      code: 'SAVE20',
      telegramId: 12345,
      username: 'alice',
      purchaseAmount: 80_000,
    });
  });
});
