import { logger } from '../../infra/logger.js';

export type FunnelEvent =
  | 'shop_enter'
  | 'checkout_start'
  | 'purchase_confirm'
  | 'purchase_failed'
  | 'topup_enter'
  | 'receipt_submit'
  | 'service_first_view';

/**
 * Record a privacy-safe, lightweight internal funnel event.
 * Absolutely no PII, user identifiers, transaction IDs or financial amounts are accepted or logged.
 */
export function trackFunnelEvent(event: FunnelEvent): void {
  logger.info({ funnelEvent: event }, `Funnel Event: ${event}`);
}
