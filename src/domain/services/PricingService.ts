import type { TranslationService } from './TranslationService.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
  type CatalogDiscountRule,
  type CatalogDiscountService,
} from './CatalogDiscountService.js';
import type { EffectiveUserGroupPolicy } from './UserGroupService.js';

export type GroupPricingPolicyInput = Pick<
  EffectiveUserGroupPolicy,
  'discountPercent' | 'customPricePerGb' | 'customPricePerDay' | 'allowCatalogDiscounts'
>;

export interface PackageOption {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number; // configured currency minor unit
  /** Whether the package is active for user purchase in the shop. Defaults to true. */
  enabled?: boolean;
  /** Creation target. Missing values preserve legacy packages via the runtime default target. */
  panelId?: string;
  serviceId?: number;
  /** Optional category ID reference. */
  categoryId?: string;
  /** Optional per-package override for Rebecca `on_hold` (start validity on first connection). */
  startOnFirstUse?: boolean;
  /** Optional per-package override for renewal traffic/time rollover. */
  rolloverQuota?: boolean;
}

export interface CustomPriceQuote {
  totalPrice: number;
  volumePrice: number;
  durationPrice: number;
  pricePerGb: number;
  pricePerDay: number;
  tierId?: string;
  overrideId?: string;
  originalPrice?: number;
  groupDiscountPercent?: number;
  groupDiscountAmount?: number;
}

export interface DiscountedPackageOption extends PackageOption {
  originalPrice: number;
  effectivePrice: number;
  discountAmount: number;
  groupDiscountPercent?: number;
  groupDiscountAmount?: number;
  catalogDiscountAmount?: number;
  activeDiscountId: string | null;
  activeDiscountTitle: string | null;
  discountExpiresAt: Date | null;
}

export interface DiscountedCustomPriceQuote extends CustomPriceQuote {
  originalPrice: number;
  effectivePrice: number;
  discountAmount: number;
  groupDiscountPercent?: number;
  groupDiscountAmount?: number;
  catalogDiscountAmount?: number;
  activeDiscountId: string | null;
  activeDiscountTitle: string | null;
  discountExpiresAt: Date | null;
}

/**
 * Apply an integer user-group discount percentage (0..90%) safely without float overflow.
 */
export function applyGroupDiscount(
  amount: number,
  discountPercent: number | null | undefined
): { finalAmount: number; discountAmount: number; discountPercent: number } {
  const safeAmount = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
  const pct =
    typeof discountPercent === 'number' && Number.isFinite(discountPercent)
      ? Math.max(0, Math.min(90, Math.trunc(discountPercent)))
      : 0;
  if (safeAmount === 0 || pct === 0) {
    return { finalAmount: safeAmount, discountAmount: 0, discountPercent: 0 };
  }
  const quotient = Math.floor(safeAmount / 100);
  const remainder = safeAmount % 100;
  const discountAmount = Math.min(safeAmount, quotient * pct + Math.floor((remainder * pct) / 100));
  return {
    finalAmount: Math.max(0, safeAmount - discountAmount),
    discountAmount,
    discountPercent: pct,
  };
}

/**
 * Format the remaining duration of a flash sale / catalog discount in `fa` or `en`.
 */
export function formatRemainingDiscountDuration(
  expiresAt: Date | null | undefined,
  locale: 'fa' | 'en' = 'fa',
  now = new Date()
): string {
  if (!expiresAt) {
    return locale === 'fa' ? 'محدود' : 'Limited time';
  }
  const diffMs = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return locale === 'fa' ? 'پایان یافته' : 'Ended';
  }

  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const numLocale = locale === 'fa' ? 'fa-IR' : 'en-US';

  if (days > 0) {
    const d = days.toLocaleString(numLocale);
    const h = hours.toLocaleString(numLocale);
    if (locale === 'fa') {
      return hours > 0 ? `${d} روز و ${h} ساعت` : `${d} روز`;
    }
    return hours > 0 ? `${d}d ${h}h` : `${d}d`;
  }

  if (hours > 0) {
    const h = hours.toLocaleString(numLocale);
    const m = minutes.toLocaleString(numLocale);
    if (locale === 'fa') {
      return minutes > 0 ? `${h} ساعت و ${m} دقیقه` : `${h} ساعت`;
    }
    return minutes > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  const m = minutes.toLocaleString(numLocale);
  return locale === 'fa' ? `${m} دقیقه` : `${m}m`;
}

export interface VolumePricingTier {
  id: string;
  minGb: number;
  maxGb?: number;
  pricePerGb?: number;
  discountPercent?: number;
}

export interface CustomPriceOverride {
  id: string;
  minGb?: number;
  maxGb?: number;
  minDays?: number;
  maxDays?: number;
  /** An explicit package-like total; it overrides all component pricing. */
  price?: number;
  pricePerGb?: number;
  pricePerDay?: number;
}

export const FALLBACK_PACKAGES: readonly PackageOption[] = [
  {
    id: 'pkg_10gb_30d',
    name: '10 GB - 30 Days',
    gbAmount: 10,
    durationDays: 30,
    price: 50_000,
    enabled: true,
  },
  {
    id: 'pkg_30gb_30d',
    name: '30 GB - 30 Days',
    gbAmount: 30,
    durationDays: 30,
    price: 120_000,
    enabled: true,
  },
  {
    id: 'pkg_50gb_30d',
    name: '50 GB - 30 Days',
    gbAmount: 50,
    durationDays: 30,
    price: 180_000,
    enabled: true,
  },
  {
    id: 'pkg_100gb_60d',
    name: '100 GB - 60 Days',
    gbAmount: 100,
    durationDays: 60,
    price: 320_000,
    enabled: true,
  },
];

export const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
export const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/iu;
export const MAX_PACKAGE_COUNT = 50;
export const MAX_PACKAGE_NAME_LENGTH = 120;
export const MAX_CATEGORY_ID_LENGTH = 64;
export const MAX_SERVICE_ID = 2_147_483_647;
export const MAX_GB_AMOUNT = 10_000;
export const MAX_DURATION_DAYS = 3_650;
export const MAX_WEB_CUSTOM_DAYS = 365;
export const MAX_PRICE_RULES = 100;
export const MAX_PRICE = Number.MAX_SAFE_INTEGER;

/**
 * Generates a unique URL/slug-safe package ID matching `PACKAGE_ID_PATTERN`.
 */
export function generatePackageId(name: string, packages: readonly PackageOption[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 32) || 'package';
  const base = `pkg_${slug}`;
  const ids = new Set(packages.map((pkg) => pkg.id));
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const candidate = `${base.slice(0, 50 - String(suffix).length)}_${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new Error('PACKAGE_ID_SPACE_EXHAUSTED');
}

/**
 * Checks whether a package name duplicates another package case-insensitively.
 */
export function hasDuplicatePackageName(
  packages: readonly PackageOption[],
  name: string,
  ignoredIndex = -1
): boolean {
  const normalized = name.trim().toLocaleLowerCase('en-US');
  return packages.some(
    (pkg, index) =>
      index !== ignoredIndex && pkg.name.trim().toLocaleLowerCase('en-US') === normalized
  );
}

export class PricingService {
  constructor(private readonly translationService: TranslationService) {}

  getPackages(
    panelId?: string,
    serviceId?: number,
    includeDisabled = false,
    categoryId?: string | null
  ): PackageOption[] {
    const customJson = this.translationService.getSetting('packages_json');
    const packages = parsePackageOptionsJson(customJson);
    const basePackages = packages ?? FALLBACK_PACKAGES.map((pkg) => ({ ...pkg }));
    let filtered = filterPackagesForPanel(basePackages, panelId, serviceId);
    if (!includeDisabled) {
      filtered = filtered.filter((pkg) => pkg.enabled !== false);
    }
    if (categoryId === null) {
      filtered = filtered.filter((pkg) => !pkg.categoryId);
    } else if (typeof categoryId === 'string' && categoryId.length > 0) {
      filtered = filtered.filter((pkg) => pkg.categoryId === categoryId);
    }
    return filtered;
  }

  getPackageById(id: string | null | undefined): PackageOption | undefined {
    if (!id) return undefined;
    const staticPkg = this.getPackages(undefined, undefined, true).find((pkg) => pkg.id === id);
    if (staticPkg) return staticPkg;

    const customMatch = /^custom_(\d+)gb_(\d+)d$/i.exec(id);
    if (customMatch) {
      const gbAmount = Number(customMatch[1]);
      const durationDays = Number(customMatch[2]);
      try {
        const quote = this.getCustomPriceQuote(gbAmount, durationDays);
        return {
          id,
          name: `${gbAmount} GB`,
          gbAmount,
          durationDays,
          price: quote.totalPrice,
        };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Produce the server-side custom pricing quote. Tiers and overrides are
   * validated JSON settings so pricing policy can change without a deploy.
   * When a user-group policy supplies custom GB/day rates, those rates apply
   * directly before applying the group's `discountPercent`.
   */
  getCustomPriceQuote(
    gbAmount: number,
    durationDays: number,
    userPolicy?: Partial<GroupPricingPolicyInput> | null
  ): CustomPriceQuote {
    assertAmountRange(gbAmount, 1, MAX_GB_AMOUNT, 'INVALID_CUSTOM_GB_AMOUNT');
    assertAmountRange(durationDays, 1, MAX_DURATION_DAYS, 'INVALID_CUSTOM_DURATION_DAYS');

    const basePerGb = nonNegativeSetting(
      this.translationService.getSettingNum('price_per_gb', 5000)
    );
    const basePerDay = nonNegativeSetting(
      this.translationService.getSettingNum('price_per_day', 0)
    );

    const hasGroupCustomRate =
      (userPolicy?.customPricePerGb !== null && userPolicy?.customPricePerGb !== undefined) ||
      (userPolicy?.customPricePerDay !== null && userPolicy?.customPricePerDay !== undefined);

    let subtotal: number;
    let volumePrice: number;
    let durationPrice: number;
    let pricePerGb: number;
    let pricePerDay: number;
    let tierId: string | undefined;
    let overrideId: string | undefined;

    if (hasGroupCustomRate) {
      pricePerGb =
        userPolicy?.customPricePerGb !== null && userPolicy?.customPricePerGb !== undefined
          ? nonNegativeSetting(userPolicy.customPricePerGb)
          : basePerGb;
      pricePerDay =
        userPolicy?.customPricePerDay !== null && userPolicy?.customPricePerDay !== undefined
          ? nonNegativeSetting(userPolicy.customPricePerDay)
          : basePerDay;
      volumePrice = checkedMultiply(gbAmount, pricePerGb);
      durationPrice = checkedMultiply(durationDays, pricePerDay);
      subtotal = checkedAdd(volumePrice, durationPrice);
    } else {
      const tiers = parseVolumePricingTiersJson(
        this.translationService.getSetting('volume_pricing_tiers_json')
      );
      const overrides = parseCustomPriceOverridesJson(
        this.translationService.getSetting('custom_price_overrides_json')
      );
      const tier = tiers?.find((candidate) => matchesVolumeTier(candidate, gbAmount));
      pricePerGb = tier ? tierPricePerGb(tier, basePerGb) : basePerGb;
      pricePerDay = basePerDay;
      const override = overrides?.find((candidate) =>
        matchesOverride(candidate, gbAmount, durationDays)
      );
      tierId = tier?.id;
      overrideId = override?.id;

      if (override?.price !== undefined) {
        volumePrice = 0;
        durationPrice = 0;
        subtotal = override.price;
      } else {
        if (override?.pricePerGb !== undefined) pricePerGb = override.pricePerGb;
        if (override?.pricePerDay !== undefined) pricePerDay = override.pricePerDay;
        volumePrice = checkedMultiply(gbAmount, pricePerGb);
        durationPrice = checkedMultiply(durationDays, pricePerDay);
        subtotal = checkedAdd(volumePrice, durationPrice);
      }
    }

    const groupDisc = applyGroupDiscount(subtotal, userPolicy?.discountPercent);
    return {
      totalPrice: groupDisc.finalAmount,
      volumePrice,
      durationPrice,
      pricePerGb,
      pricePerDay,
      ...(tierId ? { tierId } : {}),
      ...(overrideId ? { overrideId } : {}),
      ...(groupDisc.discountAmount > 0
        ? {
            originalPrice: subtotal,
            groupDiscountPercent: groupDisc.discountPercent,
            groupDiscountAmount: groupDisc.discountAmount,
          }
        : {}),
    };
  }

  /** Backward-compatible total-price API for existing bot entry points. */
  calculateCustomPrice(
    gbAmount: number,
    durationDays = 30,
    userPolicy?: Partial<GroupPricingPolicyInput> | null
  ): number {
    return this.getCustomPriceQuote(gbAmount, durationDays, userPolicy).totalPrice;
  }

  /**
   * Resolve group-policy and catalog-discount-aware pricing for a single package.
   * Respects `userPolicy.allowCatalogDiscounts` to prevent double-discounting.
   */
  resolvePackagePrice(
    pkg: PackageOption,
    activeDiscounts: readonly CatalogDiscountRule[] = [],
    now = new Date(),
    userPolicy?: Partial<GroupPricingPolicyInput> | null
  ): DiscountedPackageOption {
    const groupDisc = applyGroupDiscount(pkg.price, userPolicy?.discountPercent);
    const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
    const resolved = allowCatalog
      ? resolveBestCatalogDiscount(
          activeDiscounts,
          {
            packageId: pkg.id,
            categoryId: pkg.categoryId ?? null,
            originalPrice: groupDisc.finalAmount,
          },
          now
        )
      : {
          originalPrice: groupDisc.finalAmount,
          effectivePrice: groupDisc.finalAmount,
          discountAmount: 0,
          activeDiscountId: null,
          activeDiscountTitle: null,
          discountExpiresAt: null,
        };

    const totalDiscountAmount = Math.max(0, pkg.price - resolved.effectivePrice);

    return {
      ...pkg,
      originalPrice: pkg.price,
      effectivePrice: resolved.effectivePrice,
      discountAmount: totalDiscountAmount,
      ...(groupDisc.discountAmount > 0
        ? {
            groupDiscountPercent: groupDisc.discountPercent,
            groupDiscountAmount: groupDisc.discountAmount,
          }
        : {}),
      ...(resolved.discountAmount > 0 ? { catalogDiscountAmount: resolved.discountAmount } : {}),
      activeDiscountId: resolved.activeDiscountId,
      activeDiscountTitle: resolved.activeDiscountTitle,
      discountExpiresAt: resolved.discountExpiresAt,
    };
  }

  /**
   * Resolve group-policy and catalog-discount-aware pricing for custom volume.
   * Respects `userPolicy.allowCatalogDiscounts` to prevent double-discounting.
   */
  resolveCustomPriceWithDiscount(
    gbAmount: number,
    durationDays: number,
    activeDiscounts: readonly CatalogDiscountRule[] = [],
    now = new Date(),
    userPolicy?: Partial<GroupPricingPolicyInput> | null
  ): DiscountedCustomPriceQuote {
    const base = this.getCustomPriceQuote(gbAmount, durationDays, userPolicy);
    const preGroupSubtotal = base.originalPrice ?? base.totalPrice;
    const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
    const resolved = allowCatalog
      ? resolveBestCatalogDiscount(
          activeDiscounts,
          {
            packageId: `custom_${gbAmount}gb_${durationDays}d`,
            categoryId: null,
            originalPrice: base.totalPrice,
          },
          now
        )
      : {
          originalPrice: base.totalPrice,
          effectivePrice: base.totalPrice,
          discountAmount: 0,
          activeDiscountId: null,
          activeDiscountTitle: null,
          discountExpiresAt: null,
        };

    const totalDiscountAmount = Math.max(0, preGroupSubtotal - resolved.effectivePrice);

    return {
      ...base,
      totalPrice: resolved.effectivePrice,
      originalPrice: preGroupSubtotal,
      effectivePrice: resolved.effectivePrice,
      discountAmount: totalDiscountAmount,
      ...(base.groupDiscountAmount
        ? {
            groupDiscountPercent: base.groupDiscountPercent,
            groupDiscountAmount: base.groupDiscountAmount,
          }
        : {}),
      ...(resolved.discountAmount > 0 ? { catalogDiscountAmount: resolved.discountAmount } : {}),
      activeDiscountId: resolved.activeDiscountId,
      activeDiscountTitle: resolved.activeDiscountTitle,
      discountExpiresAt: resolved.discountExpiresAt,
    };
  }

  /**
   * Async helper fetching active catalog discounts and resolving effective package prices.
   */
  async getPackagesWithDiscounts(
    catalogDiscountService?: Pick<CatalogDiscountService, 'listActiveDiscounts'>,
    options?: {
      panelId?: string;
      serviceId?: number;
      includeDisabled?: boolean;
      categoryId?: string | null;
      now?: Date;
      userPolicy?: Partial<GroupPricingPolicyInput> | null;
    }
  ): Promise<DiscountedPackageOption[]> {
    const now = options?.now ?? new Date();
    const packages = this.getPackages(
      options?.panelId,
      options?.serviceId,
      options?.includeDisabled ?? false,
      options?.categoryId
    );
    const allowCatalog = options?.userPolicy?.allowCatalogDiscounts ?? true;
    const activeDiscounts = allowCatalog
      ? await safeListActiveDiscounts(catalogDiscountService, now)
      : [];
    return packages.map((pkg) =>
      this.resolvePackagePrice(pkg, activeDiscounts, now, options?.userPolicy)
    );
  }

  /**
   * Async helper fetching active catalog discounts and quoting custom volume with best discount.
   */
  async quoteWithCatalogDiscount(
    gbAmount: number,
    durationDays: number,
    catalogDiscountService?: Pick<CatalogDiscountService, 'listActiveDiscounts'>,
    now = new Date(),
    userPolicy?: Partial<GroupPricingPolicyInput> | null
  ): Promise<DiscountedCustomPriceQuote> {
    const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
    const activeDiscounts = allowCatalog
      ? await safeListActiveDiscounts(catalogDiscountService, now)
      : [];
    return this.resolveCustomPriceWithDiscount(
      gbAmount,
      durationDays,
      activeDiscounts,
      now,
      userPolicy
    );
  }

  getCustomVolumeTarget(): { panelId?: string; serviceId?: number } {
    const configured = parseRebeccaTarget(
      this.translationService.getSetting('custom_volume_target_json')
    );
    if (configured) return configured;

    // One-time compatibility with pre-multi-panel settings. A partial pair is
    // ignored, never silently redirected to a panel's default service.
    return (
      parseRebeccaTarget(
        JSON.stringify({
          panelId: this.translationService.getSetting('custom_volume_panel_id').trim(),
          serviceId: Number(this.translationService.getSetting('custom_volume_service_id')),
        })
      ) ?? {}
    );
  }
}

function parseRebeccaTarget(raw: string): { panelId: string; serviceId: number } | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return undefined;
    const panelId = typeof value.panelId === 'string' ? value.panelId.trim() : '';
    const serviceId = value.serviceId;
    if (
      !/^[a-z0-9][a-z0-9_-]{1,39}$/iu.test(panelId) ||
      !positiveSafeInteger(serviceId, 2_147_483_647)
    ) {
      return undefined;
    }
    return { panelId, serviceId };
  } catch {
    return undefined;
  }
}

/** Validate `packages_json` before persisting or consuming it. */
export function parsePackageOptionsJson(rawJson: string): PackageOption[] | undefined {
  if (!rawJson) return undefined;
  try {
    return parsePackages(JSON.parse(rawJson));
  } catch {
    return undefined;
  }
}

/**
 * `volume_pricing_tiers_json` example:
 * `[ {"id":"bulk_50","minGb":50,"discountPercent":10} ]`.
 */
export function parseVolumePricingTiersJson(rawJson: string): VolumePricingTier[] | undefined {
  if (!rawJson) return undefined;
  try {
    const value: unknown = JSON.parse(rawJson);
    if (!Array.isArray(value) || value.length > MAX_PRICE_RULES) return undefined;
    const seenIds = new Set<string>();
    const tiers: VolumePricingTier[] = [];
    for (const item of value) {
      const tier = parseVolumeTier(item);
      if (!tier || seenIds.has(tier.id)) return undefined;
      seenIds.add(tier.id);
      tiers.push(tier);
    }
    return tiers.sort((a, b) => b.minGb - a.minGb);
  } catch {
    return undefined;
  }
}

/**
 * `custom_price_overrides_json` accepts explicit totals or component rates,
 * with optional GB/day ranges. The first matching rule wins.
 */
export function parseCustomPriceOverridesJson(rawJson: string): CustomPriceOverride[] | undefined {
  if (!rawJson) return undefined;
  try {
    const value: unknown = JSON.parse(rawJson);
    if (!Array.isArray(value) || value.length > MAX_PRICE_RULES) return undefined;
    const seenIds = new Set<string>();
    const overrides: CustomPriceOverride[] = [];
    for (const item of value) {
      const override = parsePriceOverride(item);
      if (!override || seenIds.has(override.id)) return undefined;
      seenIds.add(override.id);
      overrides.push(override);
    }
    return overrides;
  } catch {
    return undefined;
  }
}

function parsePackages(value: unknown): PackageOption[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACKAGE_COUNT) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const packages: PackageOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const panelId =
      typeof item.panelId === 'string' && item.panelId.trim() ? item.panelId.trim() : undefined;
    const serviceId = typeof item.serviceId === 'number' ? item.serviceId : undefined;
    const categoryId =
      typeof item.categoryId === 'string' && item.categoryId.trim().length > 0
        ? item.categoryId.trim()
        : undefined;
    if (
      !PACKAGE_ID_PATTERN.test(id) ||
      !name ||
      name.length > MAX_PACKAGE_NAME_LENGTH ||
      !positiveSafeInteger(item.gbAmount, MAX_GB_AMOUNT) ||
      !positiveSafeInteger(item.durationDays, MAX_DURATION_DAYS) ||
      !positiveSafeInteger(item.price, MAX_PRICE) ||
      (item.enabled !== undefined && typeof item.enabled !== 'boolean') ||
      (item.startOnFirstUse !== undefined && typeof item.startOnFirstUse !== 'boolean') ||
      (item.rolloverQuota !== undefined && typeof item.rolloverQuota !== 'boolean') ||
      seenIds.has(id) ||
      (panelId !== undefined && !PANEL_ID_PATTERN.test(panelId)) ||
      (serviceId !== undefined && !positiveSafeInteger(serviceId, MAX_SERVICE_ID)) ||
      (panelId === undefined) !== (serviceId === undefined) ||
      (categoryId !== undefined && categoryId.length > MAX_CATEGORY_ID_LENGTH)
    ) {
      return undefined;
    }
    seenIds.add(id);
    packages.push({
      id,
      name,
      gbAmount: item.gbAmount,
      durationDays: item.durationDays,
      price: item.price,
      ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
      ...(panelId === undefined ? {} : { panelId }),
      ...(serviceId === undefined ? {} : { serviceId }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(item.startOnFirstUse !== undefined ? { startOnFirstUse: item.startOnFirstUse } : {}),
      ...(item.rolloverQuota !== undefined ? { rolloverQuota: item.rolloverQuota } : {}),
    });
  }
  return packages;
}

function filterPackagesForPanel(
  packages: PackageOption[],
  panelId?: string,
  serviceId?: number
): PackageOption[] {
  if (!panelId) return packages;
  return packages.filter(
    (pkg) =>
      pkg.panelId === undefined ||
      (pkg.panelId === panelId && (serviceId === undefined || pkg.serviceId === serviceId))
  );
}

function parseVolumeTier(value: unknown): VolumePricingTier | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const id = value.id.trim();
  const minGb = value.minGb;
  const maxGb = value.maxGb;
  const pricePerGb = value.pricePerGb;
  const discountPercent = value.discountPercent;
  if (
    !PACKAGE_ID_PATTERN.test(id) ||
    !positiveSafeInteger(minGb, MAX_GB_AMOUNT) ||
    (maxGb !== undefined && (!positiveSafeInteger(maxGb, MAX_GB_AMOUNT) || maxGb < minGb)) ||
    (pricePerGb !== undefined && !nonNegativeSafeInteger(pricePerGb)) ||
    (discountPercent !== undefined && !integerInRange(discountPercent, 0, 100)) ||
    (pricePerGb === undefined && discountPercent === undefined) ||
    (pricePerGb !== undefined && discountPercent !== undefined)
  ) {
    return undefined;
  }
  return {
    id,
    minGb,
    ...(maxGb === undefined ? {} : { maxGb }),
    ...(pricePerGb === undefined ? {} : { pricePerGb }),
    ...(discountPercent === undefined ? {} : { discountPercent }),
  };
}

function parsePriceOverride(value: unknown): CustomPriceOverride | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const id = value.id.trim();
  const numericFields = [
    'minGb',
    'maxGb',
    'minDays',
    'maxDays',
    'price',
    'pricePerGb',
    'pricePerDay',
  ] as const;
  if (
    !PACKAGE_ID_PATTERN.test(id) ||
    numericFields.some(
      (field) => value[field] !== undefined && !nonNegativeSafeInteger(value[field])
    )
  ) {
    return undefined;
  }
  const minGb = value.minGb as number | undefined;
  const maxGb = value.maxGb as number | undefined;
  const minDays = value.minDays as number | undefined;
  const maxDays = value.maxDays as number | undefined;
  if (
    (minGb !== undefined && minGb < 1) ||
    (maxGb !== undefined && maxGb < 1) ||
    (minDays !== undefined && minDays < 1) ||
    (maxDays !== undefined && maxDays < 1) ||
    (minGb !== undefined && maxGb !== undefined && minGb > maxGb) ||
    (minDays !== undefined && maxDays !== undefined && minDays > maxDays) ||
    (value.price === undefined && value.pricePerGb === undefined && value.pricePerDay === undefined)
  ) {
    return undefined;
  }
  return { id, ...pickOptionalNumericFields(value, numericFields) };
}

function pickOptionalNumericFields(
  value: Record<string, unknown>,
  fields: readonly (keyof Omit<CustomPriceOverride, 'id'>)[]
): Omit<CustomPriceOverride, 'id'> {
  return Object.fromEntries(
    fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]])
  ) as Omit<CustomPriceOverride, 'id'>;
}

function matchesVolumeTier(tier: VolumePricingTier, gbAmount: number): boolean {
  return gbAmount >= tier.minGb && (tier.maxGb === undefined || gbAmount <= tier.maxGb);
}

function matchesOverride(
  override: CustomPriceOverride,
  gbAmount: number,
  durationDays: number
): boolean {
  return (
    (override.minGb === undefined || gbAmount >= override.minGb) &&
    (override.maxGb === undefined || gbAmount <= override.maxGb) &&
    (override.minDays === undefined || durationDays >= override.minDays) &&
    (override.maxDays === undefined || durationDays <= override.maxDays)
  );
}

function tierPricePerGb(tier: VolumePricingTier, basePerGb: number): number {
  if (tier.pricePerGb !== undefined) return tier.pricePerGb;
  return Math.floor((basePerGb * (100 - (tier.discountPercent ?? 0))) / 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveSafeInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE
  );
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function nonNegativeSetting(value: number): number {
  return nonNegativeSafeInteger(value) ? value : 0;
}

function assertAmountRange(value: number, minimum: number, maximum: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(code);
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('CUSTOM_PRICE_OVERFLOW');
  return result;
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('CUSTOM_PRICE_OVERFLOW');
  return result;
}
