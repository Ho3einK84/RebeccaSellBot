import { PromoValidationError } from '../domain/services/PromoService.js';
import {
  InventoryUnavailableError,
  type InventoryUnavailableReason,
} from '../domain/services/InventoryService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import type { SupportedLocale, TranslationService } from '../domain/services/TranslationService.js';

export function inventoryUnavailableMessageKey(reason: InventoryUnavailableReason): string {
  switch (reason) {
    case 'panel_disabled':
    case 'service_disabled':
      return 'purchase_inventory_service_paused';
    case 'panel_capacity_full':
    case 'service_capacity_full':
      return 'purchase_inventory_capacity_full';
    case 'panel_daily_limit_reached':
    case 'service_daily_limit_reached':
    case 'custom_volume_daily_limit_reached':
      return 'purchase_inventory_daily_limit';
    case 'trial_daily_limit_reached':
      return 'trial_daily_limit_reached';
    case 'trial_out_of_stock':
      return 'trial_out_of_stock';
    case 'package_user_limit_reached':
      return 'purchase_inventory_user_limit';
    case 'panel_out_of_stock':
    case 'service_out_of_stock':
    case 'package_out_of_stock':
    case 'custom_volume_out_of_stock':
      return 'purchase_inventory_out_of_stock';
  }
}

/**
 * Convert domain errors into safe, localized user feedback. API error bodies
 * can contain panel details and must never be echoed into Telegram chats.
 */
export function purchaseFailureMessage(
  translationService: TranslationService,
  err: unknown,
  locale: SupportedLocale = 'fa'
): string {
  if (err instanceof InventoryUnavailableError) {
    return translationService.get(inventoryUnavailableMessageKey(err.reason), locale);
  }
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
    return translationService.get('purchase_failed_panel_down', locale);
  }
  return translationService.get('purchase_failed', locale);
}
