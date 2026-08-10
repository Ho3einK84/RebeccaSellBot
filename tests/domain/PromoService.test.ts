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
});
