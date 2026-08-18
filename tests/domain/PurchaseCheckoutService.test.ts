import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseCheckoutService } from '../../src/domain/services/PurchaseCheckoutService.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

const PACKAGE = {
  id: 'pkg_safe',
  name: 'Safe package',
  gbAmount: 10,
  durationDays: 30,
  price: 50_000,
  panelId: 'rp_primary',
  serviceId: 10,
};

function checkoutService() {
  const resolveTarget = vi.fn();
  return {
    service: new PurchaseCheckoutService({ resolveTarget } as unknown as RebeccaPanelRegistry),
    resolveTarget,
  };
}

describe('PurchaseCheckoutService input boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects a quote above the package price before touching a panel or database', async () => {
    const { service, resolveTarget } = checkoutService();

    await expect(
      service.create({
        telegramId: 1,
        kind: 'new_config',
        pkg: PACKAGE,
        quotedAmount: PACKAGE.price + 1,
      })
    ).rejects.toThrow('PURCHASE_CHECKOUT_INPUT_INVALID');
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('rejects incomplete and conflicting panel/service targets', async () => {
    const { service, resolveTarget } = checkoutService();

    await expect(
      service.create({
        telegramId: 1,
        kind: 'new_config',
        pkg: { ...PACKAGE, panelId: undefined, serviceId: undefined },
        panelId: 'rp_primary',
      })
    ).rejects.toThrow('PURCHASE_CHECKOUT_TARGET_INCOMPLETE');
    await expect(
      service.create({
        telegramId: 1,
        kind: 'new_config',
        pkg: PACKAGE,
        panelId: 'rp_other',
        serviceId: 10,
      })
    ).rejects.toThrow('PURCHASE_CHECKOUT_TARGET_MISMATCH');
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('requires a stable local config ID for renewal consent', async () => {
    const { service, resolveTarget } = checkoutService();

    await expect(
      service.create({ telegramId: 1, kind: 'renew_config', pkg: PACKAGE })
    ).rejects.toThrow('PURCHASE_CHECKOUT_CONFIG_REQUIRED');
    expect(resolveTarget).not.toHaveBeenCalled();
  });
});

describe('PurchaseCheckoutService stale processing recovery', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('re-opens a stale checkout only when no purchase intent exists', async () => {
    const now = Date.now();
    const checkout = {
      id: 'co_stale',
      telegramId: 1,
      kind: 'new_config',
      configId: null,
      packageId: 'pkg_safe',
      packageName: 'Safe package',
      panelId: 'rp_primary',
      serviceId: 10,
      amount: 50_000,
      quotedAmount: 50_000,
      gbAmount: 10,
      durationDays: 30,
      promoCode: null,
      status: 'processing',
      expiresAt: new Date(now + 5 * 60 * 1000),
      claimedAt: new Date(now - 10 * 60 * 1000),
      createdAt: new Date(now - 11 * 60 * 1000),
      updatedAt: new Date(now - 10 * 60 * 1000),
    };
    const setCalls: unknown[] = [];
    const results = [[{ id: checkout.id }], [checkout], []];
    const db = mockDb(results, setCalls);
    getDbMock.mockReturnValue(db as never);

    const { service } = checkoutService();
    await expect(service.reconcileStaleProcessing()).resolves.toBe(1);

    expect(setCalls).toContainEqual(
      expect.objectContaining({ status: 'pending', claimedAt: null })
    );
  });

  it('keeps a stale checkout consumed while its purchase intent is non-terminal', async () => {
    const now = Date.now();
    const checkout = {
      id: 'co_pending_intent',
      telegramId: 1,
      kind: 'new_config',
      configId: null,
      packageId: 'pkg_safe',
      packageName: 'Safe package',
      panelId: 'rp_primary',
      serviceId: 10,
      amount: 50_000,
      quotedAmount: 50_000,
      gbAmount: 10,
      durationDays: 30,
      promoCode: null,
      status: 'processing',
      expiresAt: new Date(now - 60_000),
      claimedAt: new Date(now - 10 * 60 * 1000),
      createdAt: new Date(now - 11 * 60 * 1000),
      updatedAt: new Date(now - 10 * 60 * 1000),
    };
    const setCalls: unknown[] = [];
    const results = [[{ id: checkout.id }], [checkout], [{ status: 'reconciliation_required' }]];
    const db = mockDb(results, setCalls);
    getDbMock.mockReturnValue(db as never);

    const { service } = checkoutService();
    await expect(service.reconcileStaleProcessing()).resolves.toBe(0);
    expect(setCalls).toHaveLength(0);
  });
});

function mockDb(selectResults: unknown[][], setCalls: unknown[]) {
  const queued = [...selectResults];
  const select = vi.fn(() => {
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      for: vi.fn(() => query),
      limit: vi.fn().mockImplementation(() => Promise.resolve(queued.shift() ?? [])),
    };
    return query;
  });
  const update = vi.fn(() => {
    const query = {
      set: vi.fn((value: unknown) => {
        setCalls.push(value);
        return query;
      }),
      where: vi.fn(() => query),
      returning: vi.fn().mockResolvedValue([{ id: 'co_stale' }]),
    };
    return query;
  });
  const db = {
    select,
    update,
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  };
  return db;
}
