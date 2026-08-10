import { PromoValidationError, type PromoQuote } from '../domain/services/PromoService.js';
import type { MenuContext } from './types.js';

export interface PendingPromoPricing {
  promoCode?: string;
  quote?: PromoQuote;
  messageKey?: string;
}

/**
 * Refresh the selected promo immediately before a purchase UI is shown. The
 * resulting amount is display-only; WalletService reserves and recalculates
 * the code inside its own transaction before charging anything.
 */
export async function getPendingPromoPricing(
  ctx: MenuContext,
  telegramId: number,
  baseAmount: number,
  baseGbAmount: number
): Promise<PendingPromoPricing> {
  const pending = ctx.session.pendingPromo;
  if (!pending || !ctx.services) return {};

  try {
    const quote = await ctx.services.promoService.quoteForPurchase(
      telegramId,
      pending.code,
      baseAmount,
      baseGbAmount
    );
    return { promoCode: quote.code, quote };
  } catch (err) {
    // A stale, exhausted, or changed code must not silently affect another
    // purchase. Clear it locally; the wallet saga remains authoritative.
    delete ctx.session.pendingPromo;
    if (err instanceof PromoValidationError) return { messageKey: err.messageKey };
    return { messageKey: 'promo_redeem_failed' };
  }
}

export function clearPendingPromo(ctx: MenuContext): void {
  delete ctx.session.pendingPromo;
}
