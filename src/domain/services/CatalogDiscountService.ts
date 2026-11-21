import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  CATALOG_DISCOUNT_SCOPES,
  CATALOG_DISCOUNT_TYPES,
  catalogDiscounts,
  type CatalogDiscountRow,
  type CatalogDiscountScope,
  type CatalogDiscountType,
} from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';

export { CATALOG_DISCOUNT_SCOPES, CATALOG_DISCOUNT_TYPES };
export type { CatalogDiscountRow, CatalogDiscountScope, CatalogDiscountType };

export interface CatalogDiscountRule {
  id: string;
  title: string;
  scope: CatalogDiscountScope | string;
  targetId: string | null;
  discountType: CatalogDiscountType | string;
  value: number;
  maxDiscountAmount: number | null;
  startsAt: Date;
  expiresAt: Date | null;
  active: boolean;
}

export interface CatalogDiscountTarget {
  packageId?: string;
  categoryId?: string | null;
  originalPrice: number;
}

export interface ResolvedCatalogDiscount {
  originalPrice: number;
  effectivePrice: number;
  discountAmount: number;
  activeDiscountId: string | null;
  activeDiscountTitle: string | null;
  discountExpiresAt: Date | null;
}

export interface CreateCatalogDiscountInput {
  id?: string;
  title: string;
  scope: CatalogDiscountScope;
  targetId?: string | null;
  discountType: CatalogDiscountType;
  value: number;
  maxDiscountAmount?: number | null;
  startsAt?: Date;
  expiresAt?: Date | null;
  active?: boolean;
}

export const MAX_DISCOUNT_TITLE_LENGTH = 120;
const SCOPE_SPECIFICITY: Record<CatalogDiscountScope, number> = {
  all: 1,
  category: 2,
  package: 3,
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scopeSpecificity(
  discount: CatalogDiscountRule,
  target: CatalogDiscountTarget
): number | null {
  if (discount.scope === 'all') return SCOPE_SPECIFICITY.all;
  if (discount.scope === 'category') {
    if (
      typeof target.categoryId === 'string' &&
      target.categoryId.trim().length > 0 &&
      discount.targetId === target.categoryId
    ) {
      return SCOPE_SPECIFICITY.category;
    }
    return null;
  }
  if (discount.scope === 'package') {
    if (
      typeof target.packageId === 'string' &&
      target.packageId.trim().length > 0 &&
      discount.targetId === target.packageId
    ) {
      return SCOPE_SPECIFICITY.package;
    }
    return null;
  }
  return null;
}

function computeSavings(discount: CatalogDiscountRule, originalPrice: number): number {
  if (originalPrice <= 0 || !Number.isFinite(discount.value) || discount.value <= 0) {
    return 0;
  }

  let savings: number;
  if (discount.discountType === 'percent') {
    const clampedPercent = Math.max(0, Math.min(100, discount.value));
    savings = Math.floor((originalPrice * clampedPercent) / 100);
  } else if (discount.discountType === 'fixed') {
    savings = Math.floor(discount.value);
  } else {
    return 0;
  }

  if (
    discount.maxDiscountAmount !== null &&
    discount.maxDiscountAmount !== undefined &&
    Number.isFinite(discount.maxDiscountAmount) &&
    discount.maxDiscountAmount > 0
  ) {
    savings = Math.min(savings, Math.floor(discount.maxDiscountAmount));
  }

  return Math.max(0, Math.min(originalPrice, savings));
}

function compareCandidates(
  left: {
    discount: CatalogDiscountRule;
    savings: number;
    specificity: number;
    expiresAt: Date | null;
  },
  right: {
    discount: CatalogDiscountRule;
    savings: number;
    specificity: number;
    expiresAt: Date | null;
  }
): number {
  // 1. Highest savings wins.
  if (left.savings !== right.savings) return right.savings - left.savings;
  // 2. Most specific scope ('package' > 'category' > 'all') wins.
  if (left.specificity !== right.specificity) return right.specificity - left.specificity;
  // 3. Earliest expiration wins (bounded flash sale beats open-ended discount).
  const leftExp = left.expiresAt ? left.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  const rightExp = right.expiresAt ? right.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  if (leftExp !== rightExp) return leftExp - rightExp;
  // 4. Deterministic fallback by ID.
  return left.discount.id.localeCompare(right.discount.id);
}

/**
 * Pure discount resolver selecting the single best active catalog discount
 * for a given package/category/price at `now`.
 */
export function resolveBestCatalogDiscount(
  discounts: readonly CatalogDiscountRule[],
  target: CatalogDiscountTarget,
  now = new Date()
): ResolvedCatalogDiscount {
  const originalPrice =
    Number.isFinite(target.originalPrice) && target.originalPrice > 0
      ? Math.floor(target.originalPrice)
      : 0;

  const noDiscount: ResolvedCatalogDiscount = {
    originalPrice,
    effectivePrice: originalPrice,
    discountAmount: 0,
    activeDiscountId: null,
    activeDiscountTitle: null,
    discountExpiresAt: null,
  };

  if (originalPrice <= 0 || discounts.length === 0) {
    return noDiscount;
  }

  const nowMs = now.getTime();
  const candidates: Array<{
    discount: CatalogDiscountRule;
    savings: number;
    specificity: number;
    expiresAt: Date | null;
  }> = [];

  for (const discount of discounts) {
    if (discount.active !== true) continue;

    const startsAt = toValidDate(discount.startsAt);
    if (!startsAt || startsAt.getTime() > nowMs) continue;

    let expiresAt: Date | null = null;
    if (discount.expiresAt !== null && discount.expiresAt !== undefined) {
      expiresAt = toValidDate(discount.expiresAt);
      if (!expiresAt || expiresAt.getTime() <= nowMs) continue;
    }

    const specificity = scopeSpecificity(discount, target);
    if (specificity === null) continue;

    const savings = computeSavings(discount, originalPrice);
    if (savings <= 0) continue;

    candidates.push({ discount, savings, specificity, expiresAt });
  }

  if (candidates.length === 0) return noDiscount;

  candidates.sort(compareCandidates);
  const best = candidates[0]!;

  return {
    originalPrice,
    effectivePrice: Math.max(0, originalPrice - best.savings),
    discountAmount: best.savings,
    activeDiscountId: best.discount.id,
    activeDiscountTitle: best.discount.title,
    discountExpiresAt: best.expiresAt,
  };
}

export class CatalogDiscountService {
  async listDiscounts(): Promise<CatalogDiscountRow[]> {
    const db = getDb();
    return db.select().from(catalogDiscounts).orderBy(desc(catalogDiscounts.createdAt));
  }

  async listActiveDiscounts(now = new Date()): Promise<CatalogDiscountRow[]> {
    const db = getDb();
    return db
      .select()
      .from(catalogDiscounts)
      .where(
        and(
          eq(catalogDiscounts.active, true),
          lte(catalogDiscounts.startsAt, now),
          or(isNull(catalogDiscounts.expiresAt), gt(catalogDiscounts.expiresAt, now))
        )
      )
      .orderBy(desc(catalogDiscounts.createdAt));
  }

  async getDiscountById(id: string): Promise<CatalogDiscountRow | null> {
    const trimmed = id?.trim();
    if (!trimmed) return null;
    const db = getDb();
    const [row] = await db
      .select()
      .from(catalogDiscounts)
      .where(eq(catalogDiscounts.id, trimmed))
      .limit(1);
    return row ?? null;
  }

  async createDiscount(input: CreateCatalogDiscountInput): Promise<CatalogDiscountRow> {
    const title = input.title?.trim() ?? '';
    if (!title || title.length > MAX_DISCOUNT_TITLE_LENGTH) {
      throw new Error('INVALID_DISCOUNT_TITLE');
    }

    if (!CATALOG_DISCOUNT_SCOPES.includes(input.scope)) {
      throw new Error('INVALID_DISCOUNT_SCOPE');
    }

    let targetId: string | null = null;
    if (input.scope !== 'all') {
      const trimmedTarget = input.targetId?.trim() ?? '';
      if (!trimmedTarget || trimmedTarget.length > 64) {
        throw new Error('INVALID_DISCOUNT_TARGET');
      }
      targetId = trimmedTarget;
    }

    if (!CATALOG_DISCOUNT_TYPES.includes(input.discountType)) {
      throw new Error('INVALID_DISCOUNT_TYPE');
    }

    if (
      typeof input.value !== 'number' ||
      !Number.isSafeInteger(input.value) ||
      input.value <= 0 ||
      (input.discountType === 'percent' && input.value > 100)
    ) {
      throw new Error('INVALID_DISCOUNT_VALUE');
    }

    let maxDiscountAmount: number | null = null;
    if (input.maxDiscountAmount !== undefined && input.maxDiscountAmount !== null) {
      if (
        typeof input.maxDiscountAmount !== 'number' ||
        !Number.isSafeInteger(input.maxDiscountAmount) ||
        input.maxDiscountAmount < 0
      ) {
        throw new Error('INVALID_DISCOUNT_MAX_CAP');
      }
      maxDiscountAmount = input.maxDiscountAmount > 0 ? input.maxDiscountAmount : null;
    }

    const startsAt = toValidDate(input.startsAt ?? new Date());
    if (!startsAt) {
      throw new Error('INVALID_DISCOUNT_WINDOW');
    }

    let expiresAt: Date | null = null;
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      expiresAt = toValidDate(input.expiresAt);
      if (!expiresAt || expiresAt.getTime() <= startsAt.getTime()) {
        throw new Error('INVALID_DISCOUNT_WINDOW');
      }
    }

    const id = input.id?.trim() || `disc_${crypto.randomBytes(6).toString('hex')}`;
    const db = getDb();
    const [created] = await db
      .insert(catalogDiscounts)
      .values({
        id,
        title,
        scope: input.scope,
        targetId,
        discountType: input.discountType,
        value: input.value,
        maxDiscountAmount,
        startsAt,
        expiresAt,
        active: input.active ?? true,
      })
      .returning();

    if (!created) {
      throw new Error('CATALOG_DISCOUNT_CREATE_FAILED');
    }

    logger.info(
      { discountId: created.id, scope: created.scope, discountType: created.discountType },
      'Catalog discount created'
    );
    return created;
  }

  async toggleDiscount(id: string, active?: boolean): Promise<CatalogDiscountRow | null> {
    const trimmed = id?.trim();
    if (!trimmed) return null;

    let nextActive = active;
    if (nextActive === undefined) {
      const existing = await this.getDiscountById(trimmed);
      if (!existing) return null;
      nextActive = !existing.active;
    }

    const db = getDb();
    const [updated] = await db
      .update(catalogDiscounts)
      .set({ active: nextActive })
      .where(eq(catalogDiscounts.id, trimmed))
      .returning();

    if (updated) {
      logger.info({ discountId: updated.id, active: updated.active }, 'Catalog discount toggled');
    }
    return updated ?? null;
  }

  async deleteDiscount(id: string): Promise<boolean> {
    const trimmed = id?.trim();
    if (!trimmed) return false;
    const db = getDb();
    const [deleted] = await db
      .delete(catalogDiscounts)
      .where(eq(catalogDiscounts.id, trimmed))
      .returning({ id: catalogDiscounts.id });

    if (deleted) {
      logger.info({ discountId: deleted.id }, 'Catalog discount deleted');
    }
    return Boolean(deleted);
  }
}

/**
 * Safely read currently active discounts without failing storefront rendering
 * when a test or degraded environment has not initialized the database.
 */
export async function safeListActiveDiscounts(
  service?: Pick<CatalogDiscountService, 'listActiveDiscounts'>,
  now = new Date()
): Promise<CatalogDiscountRow[]> {
  try {
    const resolved = service ?? new CatalogDiscountService();
    return await resolved.listActiveDiscounts(now);
  } catch (err) {
    logger.debug(
      { errorName: err instanceof Error ? err.name : typeof err },
      'Could not load active catalog discounts; continuing without discounts'
    );
    return [];
  }
}
