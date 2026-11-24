import {
  applyGroupDiscount,
  type GroupPricingPolicyInput,
  type PackageOption,
  type PricingService,
} from './PricingService.js';
import { resolveBestCatalogDiscount, type CatalogDiscountRule } from './CatalogDiscountService.js';
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
  userPolicy?: Partial<GroupPricingPolicyInput> | null;
  activeDiscounts?: readonly CatalogDiscountRule[];
  now?: Date;
}

export type ResolvePurchasePackageResult =
  | {
      success: true;
      pkg: PackageOption;
      target: { panelId?: string; serviceId?: number };
      quotedAmount: number;
      originalPrice?: number;
      discountAmount?: number;
      groupDiscountPercent?: number;
      groupDiscountAmount?: number;
      catalogDiscountAmount?: number;
      activeDiscountId?: string | null;
      activeDiscountTitle?: string | null;
      discountExpiresAt?: Date | null;
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
  const { packageId, custom, pricingService, translationService, userPolicy, activeDiscounts } =
    params;
  const now = params.now ?? new Date();

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

    let finalPrice: number;
    let originalPrice: number;
    let discountAmount: number;
    let groupDiscountPercent: number;
    let groupDiscountAmount: number;
    let catalogDiscountAmount = 0;
    let activeDiscountId: string | null = null;
    let activeDiscountTitle: string | null = null;
    let discountExpiresAt: Date | null = null;

    try {
      if (typeof pricingService.resolveCustomPriceWithDiscount === 'function') {
        const discounted = pricingService.resolveCustomPriceWithDiscount(
          gb,
          days,
          activeDiscounts ?? [],
          now,
          userPolicy
        );
        finalPrice = discounted.effectivePrice;
        originalPrice = discounted.originalPrice;
        discountAmount = discounted.discountAmount;
        groupDiscountPercent = discounted.groupDiscountPercent ?? 0;
        groupDiscountAmount = discounted.groupDiscountAmount ?? 0;
        catalogDiscountAmount = discounted.catalogDiscountAmount ?? 0;
        activeDiscountId = discounted.activeDiscountId;
        activeDiscountTitle = discounted.activeDiscountTitle;
        discountExpiresAt = discounted.discountExpiresAt;
      } else {
        const quote = pricingService.getCustomPriceQuote(gb, days, userPolicy);
        const subtotalAfterGroup = quote.totalPrice;
        originalPrice = quote.originalPrice ?? subtotalAfterGroup;
        groupDiscountPercent = quote.groupDiscountPercent ?? 0;
        groupDiscountAmount = quote.groupDiscountAmount ?? 0;
        const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
        if (allowCatalog && activeDiscounts && activeDiscounts.length > 0) {
          const catDisc = resolveBestCatalogDiscount(
            activeDiscounts,
            {
              packageId: `custom_${gb}gb_${days}d`,
              categoryId: null,
              originalPrice: subtotalAfterGroup,
            },
            now
          );
          finalPrice = catDisc.effectivePrice;
          catalogDiscountAmount = catDisc.discountAmount;
          activeDiscountId = catDisc.activeDiscountId;
          activeDiscountTitle = catDisc.activeDiscountTitle;
          discountExpiresAt = catDisc.discountExpiresAt;
        } else {
          finalPrice = subtotalAfterGroup;
        }
        discountAmount = Math.max(0, originalPrice - finalPrice);
      }
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
      price: finalPrice,
      ...target,
    };

    return {
      success: true,
      pkg,
      target,
      quotedAmount: finalPrice,
      originalPrice,
      discountAmount,
      groupDiscountPercent,
      groupDiscountAmount,
      catalogDiscountAmount,
      activeDiscountId,
      activeDiscountTitle,
      discountExpiresAt,
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

  let effectivePrice: number;
  let originalPrice = resolvedPkg.price;
  let discountAmount: number;
  let groupDiscountPercent: number;
  let groupDiscountAmount: number;
  let catalogDiscountAmount = 0;
  let activeDiscountId: string | null = null;
  let activeDiscountTitle: string | null = null;
  let discountExpiresAt: Date | null = null;

  if (typeof pricingService.resolvePackagePrice === 'function') {
    const priced = pricingService.resolvePackagePrice(
      resolvedPkg,
      activeDiscounts ?? [],
      now,
      userPolicy
    );
    effectivePrice = priced.effectivePrice;
    originalPrice = priced.originalPrice;
    discountAmount = priced.discountAmount;
    groupDiscountPercent = priced.groupDiscountPercent ?? 0;
    groupDiscountAmount = priced.groupDiscountAmount ?? 0;
    catalogDiscountAmount = priced.catalogDiscountAmount ?? 0;
    activeDiscountId = priced.activeDiscountId;
    activeDiscountTitle = priced.activeDiscountTitle;
    discountExpiresAt = priced.discountExpiresAt;
  } else {
    const groupDisc = applyGroupDiscount(resolvedPkg.price, userPolicy?.discountPercent);
    groupDiscountPercent = groupDisc.discountPercent;
    groupDiscountAmount = groupDisc.discountAmount;
    const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
    if (allowCatalog && activeDiscounts && activeDiscounts.length > 0) {
      const catDisc = resolveBestCatalogDiscount(
        activeDiscounts,
        {
          packageId: resolvedPkg.id,
          categoryId: resolvedPkg.categoryId ?? null,
          originalPrice: groupDisc.finalAmount,
        },
        now
      );
      effectivePrice = catDisc.effectivePrice;
      catalogDiscountAmount = catDisc.discountAmount;
      activeDiscountId = catDisc.activeDiscountId;
      activeDiscountTitle = catDisc.activeDiscountTitle;
      discountExpiresAt = catDisc.discountExpiresAt;
    } else {
      effectivePrice = groupDisc.finalAmount;
    }
    discountAmount = Math.max(0, resolvedPkg.price - effectivePrice);
  }

  const target =
    resolvedPkg.panelId !== undefined || resolvedPkg.serviceId !== undefined
      ? { panelId: resolvedPkg.panelId, serviceId: resolvedPkg.serviceId }
      : {};

  return {
    success: true,
    pkg:
      effectivePrice === resolvedPkg.price
        ? resolvedPkg
        : { ...resolvedPkg, price: effectivePrice },
    target,
    quotedAmount: effectivePrice,
    originalPrice,
    discountAmount,
    groupDiscountPercent,
    groupDiscountAmount,
    catalogDiscountAmount,
    activeDiscountId,
    activeDiscountTitle,
    discountExpiresAt,
  };
}
