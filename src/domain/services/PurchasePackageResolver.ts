import type { PackageOption, PricingService } from './PricingService.js';
import type { TranslationService } from './TranslationService.js';
import { customVolumeEnabled } from './FeatureSettings.js';

export interface ResolvePurchasePackageParams {
  packageId?: string | null;
  custom?: {
    gb?: number;
    days?: number;
  } | null;
  pricingService: PricingService;
  translationService?: TranslationService;
}

export type ResolvePurchasePackageResult =
  | {
      success: true;
      pkg: PackageOption;
      target: { panelId?: string; serviceId?: number };
      quotedAmount: number;
    }
  | {
      success: false;
      status: 400 | 404 | 500;
      code: string;
      error: string;
    };

/**
 * Single source of truth for resolving and validating purchase packages for checkout.
 * Enforces the exact same guards and server-side pricing whether requested via
 * custom volume parameters or via a custom package ID (e.g. custom_10gb_30d).
 */
export function resolvePurchasePackage(
  params: ResolvePurchasePackageParams
): ResolvePurchasePackageResult {
  const { packageId, custom, pricingService, translationService } = params;

  if (!pricingService) {
    return {
      success: false,
      status: 500,
      code: 'PRICING_UNAVAILABLE',
      error: 'Pricing service unavailable',
    };
  }

  // Detect custom package either by custom object or by ID pattern /^custom_(\d+)gb_(\d+)d$/i
  const customIdMatch =
    typeof packageId === 'string' ? /^custom_(\d+)gb_(\d+)d$/i.exec(packageId.trim()) : null;

  const isCustom = (custom !== undefined && custom !== null) || customIdMatch !== null;

  if (isCustom) {
    // Guard 1: Feature flag check
    if (translationService && !customVolumeEnabled(translationService)) {
      return {
        success: false,
        status: 400,
        code: 'CUSTOM_VOLUME_DISABLED',
        error: 'Custom volume is disabled',
      };
    }

    const minGb =
      typeof translationService?.getSettingNum === 'function'
        ? translationService.getSettingNum('custom_min_gb', 5)
        : 5;
    const maxGb =
      typeof translationService?.getSettingNum === 'function'
        ? translationService.getSettingNum('custom_max_gb', 500)
        : 500;
    const defaultDays =
      typeof translationService?.getSettingNum === 'function'
        ? translationService.getSettingNum('custom_default_days', 30)
        : 30;

    let gb: number;
    let days: number;

    if (customIdMatch) {
      gb = Number(customIdMatch[1]);
      days = Number(customIdMatch[2]);
    } else {
      gb = custom!.gb as number;
      days = (custom!.days ?? defaultDays) as number;
    }

    // Guards 2 & 3: GB bounds and duration bounds (1 to 365 days)
    if (
      typeof gb !== 'number' ||
      !Number.isSafeInteger(gb) ||
      gb < minGb ||
      gb > maxGb ||
      typeof days !== 'number' ||
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > 365
    ) {
      return {
        success: false,
        status: 400,
        code: 'INVALID_CUSTOM_BOUNDS',
        error: 'Volume or duration out of bounds',
      };
    }

    let quote;
    try {
      quote = pricingService.getCustomPriceQuote(gb, days);
    } catch {
      return {
        success: false,
        status: 400,
        code: 'INVALID_CUSTOM_BOUNDS',
        error: 'Volume or duration out of bounds',
      };
    }

    const target =
      typeof pricingService.getCustomVolumeTarget === 'function'
        ? pricingService.getCustomVolumeTarget()
        : {};

    const pkg: PackageOption = {
      id: `custom_${gb}gb_${days}d`,
      name: `${gb} GB (${days} days)`,
      gbAmount: gb,
      durationDays: days,
      price: quote.totalPrice,
      ...target,
    };

    return {
      success: true,
      pkg,
      target,
      quotedAmount: quote.totalPrice,
    };
  }

  // Static package path
  if (!packageId || typeof packageId !== 'string') {
    return {
      success: false,
      status: 400,
      code: 'INVALID_REQUEST',
      error: 'Invalid package ID',
    };
  }

  const resolvedPkg = pricingService.getPackageById(packageId);
  if (!resolvedPkg || resolvedPkg.enabled === false) {
    return {
      success: false,
      status: 404,
      code: 'PACKAGE_NOT_FOUND',
      error: 'Package not found or disabled',
    };
  }

  const target =
    resolvedPkg.panelId !== undefined || resolvedPkg.serviceId !== undefined
      ? { panelId: resolvedPkg.panelId, serviceId: resolvedPkg.serviceId }
      : {};

  return {
    success: true,
    pkg: resolvedPkg,
    target,
    quotedAmount: resolvedPkg.price,
  };
}
