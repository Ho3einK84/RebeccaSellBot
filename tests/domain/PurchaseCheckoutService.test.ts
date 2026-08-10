import { describe, expect, it, vi } from 'vitest';
import { PurchaseCheckoutService } from '../../src/domain/services/PurchaseCheckoutService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';

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
