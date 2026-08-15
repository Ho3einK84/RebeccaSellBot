import { PromoValidationError } from '../domain/services/PromoService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';

/**
 * Convert domain errors into safe, localized user feedback. API error bodies
 * can contain panel details and must never be echoed into Telegram chats.
 */
export function purchaseFailureMessage(
  translationService: TranslationService,
  err: unknown,
  locale: SupportedLocale = 'fa'
): string {
  if (err instanceof PromoValidationError) {
    return translationService.get(err.messageKey, locale);
  }
  if (err instanceof PurchaseOutcomePendingError) {
    return translationService.get('purchase_outcome_pending', locale);
  }
  if (err instanceof PurchaseInProgressError) {
    return translationService.get('purchase_in_progress', locale);
  }
  if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
    return translationService.get('insufficient_balance', locale);
  }
  if (err instanceof RebeccaOriginDownError) {
    return translationService.get('purchase_failed', locale);
  }
  return translationService.get('purchase_failed', locale);
}
