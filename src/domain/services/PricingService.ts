import type { TranslationService } from './TranslationService.js';

export interface PackageOption {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number; // configured currency minor unit
  /** Creation target. Missing values preserve legacy packages via the runtime default target. */
  panelId?: string;
  serviceId?: number;
}

export interface CustomPriceQuote {
  totalPrice: number;
  volumePrice: number;
  durationPrice: number;
  pricePerGb: number;
  pricePerDay: number;
  tierId?: string;
  overrideId?: string;
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

const FALLBACK_PACKAGES: readonly PackageOption[] = [
  { id: 'pkg_10gb_30d', name: '10 GB - 30 Days', gbAmount: 10, durationDays: 30, price: 50_000 },
  {
    id: 'pkg_30gb_30d',
    name: '30 GB - 30 Days',
    gbAmount: 30,
    durationDays: 30,
    price: 120_000,
  },
  {
    id: 'pkg_50gb_30d',
    name: '50 GB - 30 Days',
    gbAmount: 50,
    durationDays: 30,
    price: 180_000,
  },
  {
    id: 'pkg_100gb_60d',
    name: '100 GB - 60 Days',
    gbAmount: 100,
    durationDays: 60,
    price: 320_000,
  },
];

const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MAX_PACKAGE_COUNT = 50;
const MAX_GB_AMOUNT = 10_000;
const MAX_DURATION_DAYS = 3_650;
const MAX_PRICE_RULES = 100;
const MAX_PRICE = Number.MAX_SAFE_INTEGER;

export class PricingService {
  constructor(private readonly translationService: TranslationService) {}

  getPackages(panelId?: string, serviceId?: number): PackageOption[] {
    const customJson = this.translationService.getSetting('packages_json');
    const packages = parsePackageOptionsJson(customJson);
    if (packages) return filterPackagesForPanel(packages, panelId, serviceId);

    return filterPackagesForPanel(
      FALLBACK_PACKAGES.map((pkg) => ({ ...pkg })),
      panelId,
      serviceId
    );
  }

  getPackageById(id: string | null | undefined): PackageOption | undefined {
    if (!id) return undefined;
    const staticPkg = this.getPackages().find((pkg) => pkg.id === id);
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
   */
  getCustomPriceQuote(gbAmount: number, durationDays: number): CustomPriceQuote {
    assertAmountRange(gbAmount, 1, MAX_GB_AMOUNT, 'INVALID_CUSTOM_GB_AMOUNT');
    assertAmountRange(durationDays, 1, MAX_DURATION_DAYS, 'INVALID_CUSTOM_DURATION_DAYS');

    const basePerGb = nonNegativeSetting(
      this.translationService.getSettingNum('price_per_gb', 5000)
    );
    const basePerDay = nonNegativeSetting(
      this.translationService.getSettingNum('price_per_day', 0)
    );
    const tiers = parseVolumePricingTiersJson(
      this.translationService.getSetting('volume_pricing_tiers_json')
    );
    const overrides = parseCustomPriceOverridesJson(
      this.translationService.getSetting('custom_price_overrides_json')
    );
    const tier = tiers?.find((candidate) => matchesVolumeTier(candidate, gbAmount));
    let pricePerGb = tier ? tierPricePerGb(tier, basePerGb) : basePerGb;
    let pricePerDay = basePerDay;
    const override = overrides?.find((candidate) =>
      matchesOverride(candidate, gbAmount, durationDays)
    );

    if (override?.price !== undefined) {
      return {
        totalPrice: override.price,
        volumePrice: 0,
        durationPrice: 0,
        pricePerGb,
        pricePerDay,
        ...(tier ? { tierId: tier.id } : {}),
        overrideId: override.id,
      };
    }
    if (override?.pricePerGb !== undefined) pricePerGb = override.pricePerGb;
    if (override?.pricePerDay !== undefined) pricePerDay = override.pricePerDay;

    const volumePrice = checkedMultiply(gbAmount, pricePerGb);
    const durationPrice = checkedMultiply(durationDays, pricePerDay);
    return {
      totalPrice: checkedAdd(volumePrice, durationPrice),
      volumePrice,
      durationPrice,
      pricePerGb,
      pricePerDay,
      ...(tier ? { tierId: tier.id } : {}),
      ...(override ? { overrideId: override.id } : {}),
    };
  }

  /** Backward-compatible total-price API for existing bot entry points. */
  calculateCustomPrice(gbAmount: number, durationDays = 30): number {
    return this.getCustomPriceQuote(gbAmount, durationDays).totalPrice;
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
    const tiers = value.map(parseVolumeTier);
    if (tiers.some((tier) => !tier)) return undefined;
    return (tiers as VolumePricingTier[]).sort((a, b) => b.minGb - a.minGb);
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
    const overrides = value.map(parsePriceOverride);
    return overrides.some((override) => !override)
      ? undefined
      : (overrides as CustomPriceOverride[]);
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
    const panelId = typeof item.panelId === 'string' ? item.panelId.trim() : undefined;
    const serviceId = item.serviceId;
    if (
      !PACKAGE_ID_PATTERN.test(id) ||
      !name ||
      name.length > 120 ||
      !positiveSafeInteger(item.gbAmount, MAX_GB_AMOUNT) ||
      !positiveSafeInteger(item.durationDays, MAX_DURATION_DAYS) ||
      !positiveSafeInteger(item.price, MAX_PRICE) ||
      seenIds.has(id) ||
      (panelId !== undefined && !/^[a-z0-9][a-z0-9_-]{1,39}$/iu.test(panelId)) ||
      (serviceId !== undefined && !positiveSafeInteger(serviceId, 2_147_483_647)) ||
      (panelId === undefined) !== (serviceId === undefined)
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
      ...(panelId === undefined ? {} : { panelId }),
      ...(serviceId === undefined ? {} : { serviceId }),
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
