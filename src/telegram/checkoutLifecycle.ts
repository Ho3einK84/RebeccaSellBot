import type { PurchaseCheckoutService } from '../domain/services/PurchaseCheckoutService.js';
import { logger } from '../infra/logger.js';

/**
 * Checkout status is UI bookkeeping after the wallet saga has committed. A
 * transient status-write failure must never turn a successful purchase into a
 * user-visible financial failure.
 */
export async function recordCheckoutCompleted(
  service: PurchaseCheckoutService,
  checkoutId: string
): Promise<void> {
  try {
    await service.complete(checkoutId);
  } catch (err) {
    logger.error({ err, checkoutId }, 'Could not record completed purchase checkout');
  }
}

/** Preserve the original operation error even when checkout cleanup also fails. */
export async function recordCheckoutFailed(
  service: PurchaseCheckoutService,
  checkoutId: string
): Promise<void> {
  try {
    await service.fail(checkoutId);
  } catch (err) {
    logger.error({ err, checkoutId }, 'Could not record failed purchase checkout');
  }
}
