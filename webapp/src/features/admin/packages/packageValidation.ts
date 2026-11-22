import type { NestedTranslationKey } from '@/shared/i18n/types.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';

export const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
export const MAX_PACKAGE_COUNT = 50;
export const MAX_PACKAGE_NAME_LENGTH = 120;
export const MAX_CATEGORY_NAME_LENGTH = 100;
export const MAX_CATEGORY_DESC_LENGTH = 240;
export const MAX_CATEGORY_ICON_LENGTH = 32;
export const MAX_GB_AMOUNT = 10_000;
export const MAX_DURATION_DAYS = 3_650;
export const WEB_MAX_DURATION_DAYS = 365;
export const MAX_PRICE_RULES = 100;
export const MAX_LOW_TRAFFIC_GB = 100_000;
export const MAX_REFUND_HOURS = 8_760;

export interface ValidationIssue {
  field: string;
  messageKey: NestedTranslationKey;
  params?: Record<string, string | number>;
}

export interface ValidationResult<T> {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: NestedTranslationKey[];
  parsed?: T;
}

export type OverrideTriState = 'default' | 'true' | 'false';

export interface PackageFormValues {
  id: string;
  name: string;
  gbAmount: string;
  durationDays: string;
  price: string;
  categoryId: string;
  panelId: string;
  serviceId: string;
  enabled: boolean;
  startOnFirstUse?: OverrideTriState;
  rolloverQuota?: OverrideTriState;
}

export interface ParsedPackageInput {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number;
  categoryId?: string;
  panelId?: string;
  serviceId?: number;
  enabled: boolean;
  startOnFirstUse?: boolean;
  rolloverQuota?: boolean;
}

export interface CategoryFormValues {
  name: string;
  icon: string;
  description: string;
  displayOrder: string;
  enabled: boolean;
}

export interface ParsedCategoryInput {
  name: string;
  icon?: string;
  description?: string;
  displayOrder: number;
  enabled: boolean;
}

export interface CustomSettingsFormValues {
  enabled: boolean;
  pricePerGb: string;
  pricePerDay: string;
  minGb: string;
  maxGb: string;
  defaultDays: string;
  panelId: string;
  serviceId: string;
}

export interface ParsedCustomSettingsInput {
  enabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  minGb: number;
  maxGb: number;
  defaultDays: number;
  panelId?: string;
  serviceId?: number;
}

export type TierPricingMode = 'pricePerGb' | 'discountPercent';

export interface VolumeTierFormValues {
  id: string;
  minGb: string;
  maxGb: string;
  mode: TierPricingMode;
  pricePerGb: string;
  discountPercent: string;
}

export interface ParsedVolumeTierInput {
  id: string;
  minGb: number;
  maxGb?: number;
  pricePerGb?: number;
  discountPercent?: number;
}

export interface PriceOverrideFormValues {
  id: string;
  minGb: string;
  maxGb: string;
  minDays: string;
  maxDays: string;
  price: string;
  pricePerGb: string;
  pricePerDay: string;
}

export interface ParsedPriceOverrideInput {
  id: string;
  minGb?: number;
  maxGb?: number;
  minDays?: number;
  maxDays?: number;
  price?: number;
  pricePerGb?: number;
  pricePerDay?: number;
}

export interface PoliciesFormValues {
  packageDisplayMode: 'specs' | 'name';
  lowTrafficThresholdGb: string;
  expiryWarningDays: string;
  refundWindowHours: string;
}

export interface ParsedPoliciesInput {
  packageDisplayMode: 'specs' | 'name';
  lowTrafficThresholdGb: number;
  expiryWarningDays: number;
  refundWindowHours: number;
}

export function normalizeNumericInput(raw: string): string {
  return normalizeInputDigits(raw)
    .trim()
    .replaceAll(',', '')
    .replaceAll('٬', '')
    .replaceAll(' ', '');
}

export function parseIntStrict(raw: string): number | null {
  const normalized = normalizeNumericInput(raw);
  if (!normalized || !/^-?\d+$/u.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  if (!Number.isSafeInteger(num)) {
    return null;
  }
  return num;
}

export function parsePositiveIntInput(raw: string): number | null {
  const num = parseIntStrict(raw);
  if (num === null || num < 1) {
    return null;
  }
  return num;
}

export function parseNonNegativeIntInput(raw: string): number | null {
  const num = parseIntStrict(raw);
  if (num === null || num < 0) {
    return null;
  }
  return num;
}

export function parseNonNegativeDecimalInput(raw: string): number | null {
  const normalized = normalizeNumericInput(raw).replaceAll('٫', '.');
  if (!normalized || !/^\d+(?:\.\d+)?$/u.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num;
}

export function suggestPackageId(
  gbRaw: string,
  daysRaw: string,
  existingIds: ReadonlySet<string>
): string {
  const gb = parsePositiveIntInput(gbRaw);
  const days = parsePositiveIntInput(daysRaw);
  const base = gb && days ? `plan-${gb}gb-${days}d` : gb ? `plan-${gb}gb` : 'plan-custom';
  if (!existingIds.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function formatBilingualPackageName(
  rawName: string,
  locale: 'fa' | 'en'
): { primary: string; secondary: string | null } {
  const trimmed = rawName.trim();
  const pipeIndex = trimmed.indexOf('|');
  if (pipeIndex === -1) {
    return { primary: trimmed, secondary: null };
  }
  const first = trimmed.slice(0, pipeIndex).trim();
  const second = trimmed.slice(pipeIndex + 1).trim();
  if (!first || !second) {
    return { primary: first || second || trimmed, secondary: null };
  }
  return locale === 'en'
    ? { primary: second, secondary: first }
    : { primary: first, secondary: second };
}

export function computePackageUnitPrice(price: number, gbAmount: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(gbAmount) || gbAmount <= 0 || price < 0) {
    return 0;
  }
  return Math.round(price / gbAmount);
}

export function computeTierEffectivePricePerGb(
  tier: { pricePerGb?: number; discountPercent?: number },
  basePricePerGb: number
): number {
  const safeBase = Math.max(0, Number.isFinite(basePricePerGb) ? Math.floor(basePricePerGb) : 0);
  if (typeof tier.pricePerGb === 'number' && Number.isFinite(tier.pricePerGb)) {
    return Math.max(0, Math.floor(tier.pricePerGb));
  }
  if (typeof tier.discountPercent === 'number' && Number.isFinite(tier.discountPercent)) {
    return Math.max(0, Math.floor((safeBase * (100 - tier.discountPercent)) / 100));
  }
  return safeBase;
}

export function reorderItemsByDelta<T extends { id: string }>(
  items: readonly T[],
  id: string,
  direction: 'up' | 'down'
): T[] | null {
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) {
    return null;
  }
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= items.length) {
    return null;
  }
  const next = [...items];
  const current = next[idx];
  const target = next[targetIdx];
  if (!current || !target) {
    return null;
  }
  next[idx] = target;
  next[targetIdx] = current;
  return next;
}

export type PackageStatusFilter = 'all' | 'active' | 'inactive';

export interface PackageFilterCriteria {
  search: string;
  status: PackageStatusFilter;
  categoryId: string; // 'all' | 'uncategorized' | specific id
  panelId: string; // 'all' | 'default' | String(panelId)
}

export interface FilterablePackage {
  id: string;
  name: string;
  enabled: boolean;
  categoryId?: string;
  panelId?: string;
}

export function filterAdminPackages<T extends FilterablePackage>(
  packages: readonly T[],
  criteria: PackageFilterCriteria
): T[] {
  const query = criteria.search.trim().toLocaleLowerCase('en-US');

  return packages.filter((pkg) => {
    if (criteria.status === 'active' && !pkg.enabled) {
      return false;
    }
    if (criteria.status === 'inactive' && pkg.enabled) {
      return false;
    }
    if (criteria.categoryId === 'uncategorized' && pkg.categoryId) {
      return false;
    }
    if (
      criteria.categoryId !== 'all' &&
      criteria.categoryId !== 'uncategorized' &&
      pkg.categoryId !== criteria.categoryId
    ) {
      return false;
    }
    if (criteria.panelId === 'default' && pkg.panelId !== undefined) {
      return false;
    }
    if (
      criteria.panelId !== 'all' &&
      criteria.panelId !== 'default' &&
      pkg.panelId !== criteria.panelId
    ) {
      return false;
    }
    if (query) {
      const idMatch = pkg.id.toLocaleLowerCase('en-US').includes(query);
      const nameMatch = pkg.name.toLocaleLowerCase('en-US').includes(query);
      if (!idMatch && !nameMatch) {
        return false;
      }
    }
    return true;
  });
}

export interface PackagesKpiSummary {
  totalPackages: number;
  activePackages: number;
  inactivePackages: number;
  totalCategories: number;
  activeCategories: number;
  customEnabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  tiersCount: number;
  overridesCount: number;
}

export function computePackagesKpiSummary(params: {
  packages: readonly { enabled: boolean }[];
  categories: readonly { enabled: boolean }[];
  customVolume: { enabled: boolean; pricePerGb: number; pricePerDay: number };
  tiersCount: number;
  overridesCount: number;
}): PackagesKpiSummary {
  const activePackages = params.packages.filter((p) => p.enabled).length;
  const activeCategories = params.categories.filter((c) => c.enabled).length;
  return {
    totalPackages: params.packages.length,
    activePackages,
    inactivePackages: params.packages.length - activePackages,
    totalCategories: params.categories.length,
    activeCategories,
    customEnabled: params.customVolume.enabled,
    pricePerGb: params.customVolume.pricePerGb,
    pricePerDay: params.customVolume.pricePerDay,
    tiersCount: params.tiersCount,
    overridesCount: params.overridesCount,
  };
}

function validateTargetPair(
  panelRaw: string,
  serviceRaw: string
): { valid: boolean; panelId?: string; serviceId?: number } {
  const trimmedPanel = panelRaw.trim();
  const trimmedService = serviceRaw.trim();
  if (!trimmedPanel && !trimmedService) {
    return { valid: true };
  }
  if (!trimmedPanel || !trimmedService) {
    return { valid: false };
  }
  const serviceId = parsePositiveIntInput(trimmedService);
  if (serviceId === null) {
    return { valid: false };
  }
  return { valid: true, panelId: trimmedPanel, serviceId };
}

export function validatePackageForm(
  form: PackageFormValues,
  options: {
    mode: 'create' | 'edit' | 'clone';
    currentPackageId?: string;
    existingPackages: readonly { id: string; name: string }[];
  }
): ValidationResult<ParsedPackageInput> {
  const errors: ValidationIssue[] = [];

  if (options.mode !== 'edit' && options.existingPackages.length >= MAX_PACKAGE_COUNT) {
    errors.push({
      field: 'form',
      messageKey: 'admin.packages.validation.maxPackagesReached',
      params: { max: MAX_PACKAGE_COUNT },
    });
  }

  const trimmedId = form.id.trim();
  if (!trimmedId) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idRequired' });
  } else if (!PACKAGE_ID_PATTERN.test(trimmedId)) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idInvalid' });
  } else if (
    options.existingPackages.some(
      (pkg) =>
        pkg.id === trimmedId && (options.mode !== 'edit' || pkg.id !== options.currentPackageId)
    )
  ) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idDuplicate' });
  }

  const trimmedName = form.name.trim();
  if (!trimmedName) {
    errors.push({ field: 'name', messageKey: 'admin.packages.validation.nameRequired' });
  } else if (trimmedName.length > MAX_PACKAGE_NAME_LENGTH) {
    errors.push({
      field: 'name',
      messageKey: 'admin.packages.validation.nameTooLong',
      params: { max: MAX_PACKAGE_NAME_LENGTH },
    });
  } else {
    const normalizedName = trimmedName.toLocaleLowerCase('en-US');
    const duplicateName = options.existingPackages.some(
      (pkg) =>
        (options.mode !== 'edit' || pkg.id !== options.currentPackageId) &&
        pkg.name.trim().toLocaleLowerCase('en-US') === normalizedName
    );
    if (duplicateName) {
      errors.push({ field: 'name', messageKey: 'admin.packages.validation.nameDuplicate' });
    }
  }

  const gbAmount = parsePositiveIntInput(form.gbAmount);
  if (gbAmount === null || gbAmount > MAX_GB_AMOUNT) {
    errors.push({ field: 'gbAmount', messageKey: 'admin.packages.validation.gbInvalid' });
  }

  const durationDays = parsePositiveIntInput(form.durationDays);
  if (durationDays === null || durationDays > MAX_DURATION_DAYS) {
    errors.push({ field: 'durationDays', messageKey: 'admin.packages.validation.daysInvalid' });
  }

  const price = parsePositiveIntInput(form.price);
  if (price === null) {
    errors.push({ field: 'price', messageKey: 'admin.packages.validation.priceInvalid' });
  }

  const target = validateTargetPair(form.panelId, form.serviceId);
  if (!target.valid) {
    errors.push({ field: 'target', messageKey: 'admin.packages.validation.targetIncomplete' });
  }

  if (errors.length > 0 || gbAmount === null || durationDays === null || price === null) {
    return { valid: false, errors, warnings: [] };
  }

  const categoryId = form.categoryId.trim() || undefined;
  const startOnFirstUse =
    form.startOnFirstUse === 'true' ? true : form.startOnFirstUse === 'false' ? false : undefined;
  const rolloverQuota =
    form.rolloverQuota === 'true' ? true : form.rolloverQuota === 'false' ? false : undefined;
  return {
    valid: true,
    errors: [],
    warnings: [],
    parsed: {
      id: trimmedId,
      name: trimmedName,
      gbAmount,
      durationDays,
      price,
      categoryId,
      panelId: target.panelId,
      serviceId: target.serviceId,
      enabled: form.enabled,
      ...(startOnFirstUse !== undefined ? { startOnFirstUse } : {}),
      ...(rolloverQuota !== undefined ? { rolloverQuota } : {}),
    },
  };
}

export function validateCategoryForm(
  form: CategoryFormValues
): ValidationResult<ParsedCategoryInput> {
  const errors: ValidationIssue[] = [];

  const name = form.name.trim();
  if (!name) {
    errors.push({ field: 'name', messageKey: 'admin.packages.validation.categoryNameRequired' });
  } else if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    errors.push({ field: 'name', messageKey: 'admin.packages.validation.categoryNameTooLong' });
  }

  const icon = form.icon.trim();
  if (icon.length > MAX_CATEGORY_ICON_LENGTH) {
    errors.push({ field: 'icon', messageKey: 'admin.packages.validation.categoryIconTooLong' });
  }

  const description = form.description.trim();
  if (description.length > MAX_CATEGORY_DESC_LENGTH) {
    errors.push({
      field: 'description',
      messageKey: 'admin.packages.validation.categoryDescTooLong',
    });
  }

  const displayOrder = parseNonNegativeIntInput(form.displayOrder);
  if (displayOrder === null) {
    errors.push({
      field: 'displayOrder',
      messageKey: 'admin.packages.validation.categoryOrderInvalid',
    });
  }

  if (errors.length > 0 || displayOrder === null) {
    return { valid: false, errors, warnings: [] };
  }

  return {
    valid: true,
    errors: [],
    warnings: [],
    parsed: {
      name,
      icon: icon || undefined,
      description: description || undefined,
      displayOrder,
      enabled: form.enabled,
    },
  };
}

export function validateCustomSettingsForm(
  form: CustomSettingsFormValues
): ValidationResult<ParsedCustomSettingsInput> {
  const errors: ValidationIssue[] = [];
  const warnings: NestedTranslationKey[] = [];

  const pricePerGb = parseNonNegativeIntInput(form.pricePerGb);
  if (pricePerGb === null) {
    errors.push({
      field: 'pricePerGb',
      messageKey: 'admin.packages.validation.nonNegativeIntInvalid',
    });
  } else if (pricePerGb === 0) {
    warnings.push('admin.packages.custom.zeroPriceWarning');
  }

  const pricePerDay = parseNonNegativeIntInput(form.pricePerDay);
  if (pricePerDay === null) {
    errors.push({
      field: 'pricePerDay',
      messageKey: 'admin.packages.validation.nonNegativeIntInvalid',
    });
  }

  const minGb = parsePositiveIntInput(form.minGb);
  const maxGb = parsePositiveIntInput(form.maxGb);
  if (minGb === null || maxGb === null || minGb > maxGb || maxGb > MAX_GB_AMOUNT) {
    errors.push({ field: 'minGb', messageKey: 'admin.packages.validation.minMaxGbInvalid' });
  }

  const defaultDays = parsePositiveIntInput(form.defaultDays);
  if (defaultDays === null || defaultDays > MAX_DURATION_DAYS) {
    errors.push({
      field: 'defaultDays',
      messageKey: 'admin.packages.validation.defaultDaysInvalid',
    });
  } else if (defaultDays > WEB_MAX_DURATION_DAYS) {
    warnings.push('admin.packages.custom.webDaysWarning');
  }

  const target = validateTargetPair(form.panelId, form.serviceId);
  if (!target.valid) {
    errors.push({ field: 'target', messageKey: 'admin.packages.validation.targetIncomplete' });
  }

  if (
    errors.length > 0 ||
    pricePerGb === null ||
    pricePerDay === null ||
    minGb === null ||
    maxGb === null ||
    defaultDays === null
  ) {
    return { valid: false, errors, warnings };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    parsed: {
      enabled: form.enabled,
      pricePerGb,
      pricePerDay,
      minGb,
      maxGb,
      defaultDays,
      panelId: target.panelId,
      serviceId: target.serviceId,
    },
  };
}

export function validateVolumeTierForm(
  form: VolumeTierFormValues,
  options: {
    mode: 'create' | 'edit';
    currentTierId?: string;
    existingTiers: readonly { id: string }[];
  }
): ValidationResult<ParsedVolumeTierInput> {
  const errors: ValidationIssue[] = [];

  if (options.mode === 'create' && options.existingTiers.length >= MAX_PRICE_RULES) {
    errors.push({
      field: 'form',
      messageKey: 'admin.packages.validation.maxRulesReached',
      params: { max: MAX_PRICE_RULES },
    });
  }

  const id = form.id.trim();
  if (!id) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idRequired' });
  } else if (!PACKAGE_ID_PATTERN.test(id)) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idInvalid' });
  } else if (
    options.existingTiers.some(
      (tier) => tier.id === id && (options.mode !== 'edit' || tier.id !== options.currentTierId)
    )
  ) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idDuplicate' });
  }

  const minGb = parsePositiveIntInput(form.minGb);
  if (minGb === null || minGb > MAX_GB_AMOUNT) {
    errors.push({ field: 'minGb', messageKey: 'admin.packages.validation.tierMinGbInvalid' });
  }

  let maxGb: number | undefined;
  if (form.maxGb.trim()) {
    const parsedMax = parsePositiveIntInput(form.maxGb);
    if (parsedMax === null || parsedMax > MAX_GB_AMOUNT || (minGb !== null && parsedMax < minGb)) {
      errors.push({ field: 'maxGb', messageKey: 'admin.packages.validation.tierMaxGbInvalid' });
    } else {
      maxGb = parsedMax;
    }
  }

  let pricePerGb: number | undefined;
  let discountPercent: number | undefined;
  if (form.mode === 'pricePerGb') {
    const parsedRate = parseNonNegativeIntInput(form.pricePerGb);
    if (parsedRate === null) {
      errors.push({
        field: 'pricePerGb',
        messageKey: 'admin.packages.validation.nonNegativeIntInvalid',
      });
    } else {
      pricePerGb = parsedRate;
    }
  } else if (form.mode === 'discountPercent') {
    const parsedDiscount = parseNonNegativeIntInput(form.discountPercent);
    if (parsedDiscount === null || parsedDiscount > 100) {
      errors.push({
        field: 'discountPercent',
        messageKey: 'admin.packages.validation.tierDiscountInvalid',
      });
    } else {
      discountPercent = parsedDiscount;
    }
  } else {
    errors.push({ field: 'mode', messageKey: 'admin.packages.validation.tierModeRequired' });
  }

  if (
    errors.length > 0 ||
    minGb === null ||
    (pricePerGb === undefined && discountPercent === undefined)
  ) {
    return { valid: false, errors, warnings: [] };
  }

  return {
    valid: true,
    errors: [],
    warnings: [],
    parsed: {
      id,
      minGb,
      maxGb,
      pricePerGb,
      discountPercent,
    },
  };
}

function parseOptionalBoundedInt(
  raw: string,
  min: number,
  max: number
): { valid: boolean; value?: number } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, value: undefined };
  }
  const num = parseIntStrict(trimmed);
  if (num === null || num < min || num > max) {
    return { valid: false };
  }
  return { valid: true, value: num };
}

export function validatePriceOverrideForm(
  form: PriceOverrideFormValues,
  options: {
    mode: 'create' | 'edit';
    currentOverrideId?: string;
    existingOverrides: readonly { id: string }[];
  }
): ValidationResult<ParsedPriceOverrideInput> {
  const errors: ValidationIssue[] = [];

  if (options.mode === 'create' && options.existingOverrides.length >= MAX_PRICE_RULES) {
    errors.push({
      field: 'form',
      messageKey: 'admin.packages.validation.maxRulesReached',
      params: { max: MAX_PRICE_RULES },
    });
  }

  const id = form.id.trim();
  if (!id) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idRequired' });
  } else if (!PACKAGE_ID_PATTERN.test(id)) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idInvalid' });
  } else if (
    options.existingOverrides.some(
      (rule) => rule.id === id && (options.mode !== 'edit' || rule.id !== options.currentOverrideId)
    )
  ) {
    errors.push({ field: 'id', messageKey: 'admin.packages.validation.idDuplicate' });
  }

  const minGb = parseOptionalBoundedInt(form.minGb, 1, MAX_GB_AMOUNT);
  const maxGb = parseOptionalBoundedInt(form.maxGb, 1, MAX_GB_AMOUNT);
  if (
    !minGb.valid ||
    !maxGb.valid ||
    (minGb.value !== undefined && maxGb.value !== undefined && minGb.value > maxGb.value)
  ) {
    errors.push({
      field: 'gbRange',
      messageKey: 'admin.packages.validation.overrideGbRangeInvalid',
    });
  }

  const minDays = parseOptionalBoundedInt(form.minDays, 1, MAX_DURATION_DAYS);
  const maxDays = parseOptionalBoundedInt(form.maxDays, 1, MAX_DURATION_DAYS);
  if (
    !minDays.valid ||
    !maxDays.valid ||
    (minDays.value !== undefined && maxDays.value !== undefined && minDays.value > maxDays.value)
  ) {
    errors.push({
      field: 'daysRange',
      messageKey: 'admin.packages.validation.overrideDaysRangeInvalid',
    });
  }

  const fixedPrice = parseOptionalBoundedInt(form.price, 0, Number.MAX_SAFE_INTEGER);
  const pricePerGb = parseOptionalBoundedInt(form.pricePerGb, 0, Number.MAX_SAFE_INTEGER);
  const pricePerDay = parseOptionalBoundedInt(form.pricePerDay, 0, Number.MAX_SAFE_INTEGER);
  if (!fixedPrice.valid || !pricePerGb.valid || !pricePerDay.valid) {
    errors.push({ field: 'pricing', messageKey: 'admin.packages.validation.overrideRateInvalid' });
  } else if (
    fixedPrice.value === undefined &&
    pricePerGb.value === undefined &&
    pricePerDay.value === undefined
  ) {
    errors.push({
      field: 'pricing',
      messageKey: 'admin.packages.validation.overridePricingRequired',
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings: [] };
  }

  return {
    valid: true,
    errors: [],
    warnings: [],
    parsed: {
      id,
      minGb: minGb.value,
      maxGb: maxGb.value,
      minDays: minDays.value,
      maxDays: maxDays.value,
      price: fixedPrice.value,
      pricePerGb: pricePerGb.value,
      pricePerDay: pricePerDay.value,
    },
  };
}

export function validatePoliciesForm(
  form: PoliciesFormValues
): ValidationResult<ParsedPoliciesInput> {
  const errors: ValidationIssue[] = [];

  const lowTrafficThresholdGb = parseNonNegativeDecimalInput(form.lowTrafficThresholdGb);
  if (lowTrafficThresholdGb === null || lowTrafficThresholdGb > MAX_LOW_TRAFFIC_GB) {
    errors.push({
      field: 'lowTrafficThresholdGb',
      messageKey: 'admin.packages.validation.lowTrafficInvalid',
    });
  }

  const expiryWarningDays = parseNonNegativeIntInput(form.expiryWarningDays);
  if (expiryWarningDays === null || expiryWarningDays > MAX_DURATION_DAYS) {
    errors.push({
      field: 'expiryWarningDays',
      messageKey: 'admin.packages.validation.expiryDaysInvalid',
    });
  }

  const refundWindowHours = parseNonNegativeIntInput(form.refundWindowHours);
  if (refundWindowHours === null || refundWindowHours > MAX_REFUND_HOURS) {
    errors.push({
      field: 'refundWindowHours',
      messageKey: 'admin.packages.validation.refundHoursInvalid',
    });
  }

  if (
    errors.length > 0 ||
    lowTrafficThresholdGb === null ||
    expiryWarningDays === null ||
    refundWindowHours === null
  ) {
    return { valid: false, errors, warnings: [] };
  }

  return {
    valid: true,
    errors: [],
    warnings: [],
    parsed: {
      packageDisplayMode: form.packageDisplayMode === 'name' ? 'name' : 'specs',
      lowTrafficThresholdGb,
      expiryWarningDays,
      refundWindowHours,
    },
  };
}

export function validateQuoteSimulatorForm(
  gbRaw: string,
  daysRaw: string
): ValidationResult<{ gbAmount: number; durationDays: number }> {
  const errors: ValidationIssue[] = [];
  const warnings: NestedTranslationKey[] = [];
  const gbAmount = parsePositiveIntInput(gbRaw);
  if (gbAmount === null || gbAmount > MAX_GB_AMOUNT) {
    errors.push({ field: 'gbAmount', messageKey: 'admin.packages.validation.quoteGbInvalid' });
  }
  const durationDays = parsePositiveIntInput(daysRaw);
  if (durationDays === null || durationDays > MAX_DURATION_DAYS) {
    errors.push({
      field: 'durationDays',
      messageKey: 'admin.packages.validation.quoteDaysInvalid',
    });
  } else if (durationDays > WEB_MAX_DURATION_DAYS) {
    warnings.push('admin.packages.simulator.warningExceedsWebLimit');
  }

  if (errors.length > 0 || gbAmount === null || durationDays === null) {
    return { valid: false, errors, warnings };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    parsed: { gbAmount, durationDays },
  };
}
