import { and, count, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import type * as schema from '../../infra/schema.js';
import { codeRedemptions, promoCodes, users, walletTransactions } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';

const PROMO_TYPES = ['discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb'] as const;
const PURCHASE_PROMO_TYPES = ['discount_percent', 'discount_fixed', 'gift_gb'] as const;
const MAX_DATABASE_INTEGER = 2_147_483_647;

export type PromoType = (typeof PROMO_TYPES)[number];
export type PurchasePromoType = (typeof PURCHASE_PROMO_TYPES)[number];
export type PromoCodeRecord = typeof promoCodes.$inferSelect;
type DbTransaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

export interface RedeemResult {
  success: boolean;
  messageKey: string;
  code?: string;
  codeType?: PromoType;
  value?: number;
}

/** A non-authoritative display quote. The saga must reserve the code again. */
export interface PromoQuote {
  code: string;
  type: PurchasePromoType;
  value: number;
  finalAmount: number;
  finalGbAmount: number;
}

/** Result of an atomic, transaction-bound purchase promo reservation. */
export interface ReservedPurchasePromo extends PromoQuote {
  intentId: string;
}

export class PromoValidationError extends Error {
  constructor(public readonly messageKey: string) {
    super(messageKey);
    this.name = 'PromoValidationError';
  }
}

export class PromoService {
  async listCodes(
    page = 1,
    pageSize = 8,
    query?: string
  ): Promise<{
    items: PromoCodeRecord[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const safePage = clampInteger(page, 1, MAX_DATABASE_INTEGER);
    const safePageSize = clampInteger(pageSize, 1, 20);
    const normalizedQuery = query?.trim().slice(0, 128);
    const condition = normalizedQuery
      ? ilike(promoCodes.code, `%${escapeLikePattern(normalizedQuery)}%`)
      : undefined;
    const db = getDb();
    const [[totalRow], items] = await Promise.all([
      db.select({ value: count() }).from(promoCodes).where(condition),
      db
        .select()
        .from(promoCodes)
        .where(condition)
        .orderBy(desc(promoCodes.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
    ]);
    const total = Number(totalRow?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const resolvedPage = Math.min(safePage, totalPages);
    if (resolvedPage !== safePage) return this.listCodes(resolvedPage, safePageSize, query);
    return { items, total, page: resolvedPage, totalPages };
  }

  async listRecentCodes(limit = 10) {
    const safeLimit = clampInteger(limit, 1, 100);
    return getDb().select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(safeLimit);
  }

  /** Read one code for the inline admin detail screen. */
  async getPromoCode(rawCode: string) {
    const code = normalizeCode(rawCode);
    const [promo] = await getDb()
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);
    return promo;
  }

  async getPromoCodeById(id: string) {
    const [promo] = await getDb()
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.id, assertUuid(id)))
      .limit(1);
    return promo;
  }

  async createPromoCode(params: {
    code: string;
    type: PromoType;
    value: number;
    maxUses?: number;
    maxUsesPerUser?: number;
    minPurchaseAmount?: number;
    expiresAt?: Date | null;
  }): Promise<void> {
    const db = getDb();
    const cleanCode = normalizeCode(params.code);
    const value = validatePromoValue(params.type, params.value);
    const maxUses = clampInteger(params.maxUses ?? 1, 1, MAX_DATABASE_INTEGER);
    const maxUsesPerUser = clampInteger(params.maxUsesPerUser ?? 1, 1, MAX_DATABASE_INTEGER);
    const minPurchaseAmount = validateMinimumPurchaseAmount(params.minPurchaseAmount ?? 0);

    if (params.expiresAt && Number.isNaN(params.expiresAt.getTime())) {
      throw new Error('PROMO_EXPIRY_INVALID');
    }

    const [existing] = await db
      .select({ currentUses: promoCodes.currentUses, type: promoCodes.type })
      .from(promoCodes)
      .where(eq(promoCodes.code, cleanCode))
      .limit(1);

    // Changing the meaning of a code after someone has redeemed it corrupts
    // its audit trail. Admins may still deactivate it by setting max uses or
    // expiry through a future explicit lifecycle action.
    if (existing && existing.currentUses > 0 && existing.type !== params.type) {
      throw new Error('PROMO_CODE_TYPE_IMMUTABLE_AFTER_REDEMPTION');
    }
    if (existing && maxUses < existing.currentUses) {
      throw new Error('PROMO_MAX_USES_BELOW_CURRENT_USAGE');
    }

    await db
      .insert(promoCodes)
      .values({
        code: cleanCode,
        type: params.type,
        value,
        maxUses,
        maxUsesPerUser,
        currentUses: 0,
        minPurchaseAmount,
        expiresAt: params.expiresAt ?? null,
        active: true,
      })
      .onConflictDoUpdate({
        target: promoCodes.code,
        set: {
          type: params.type,
          value,
          maxUses,
          maxUsesPerUser,
          minPurchaseAmount,
          expiresAt: params.expiresAt ?? null,
          active: true,
        },
      });

    logger.info({ code: cleanCode, type: params.type, value }, 'Promo code created or updated');
  }

  /** Activate or deactivate an existing code without changing its audit trail. */
  async setPromoActive(rawCode: string, active: boolean): Promise<boolean> {
    const code = normalizeCode(rawCode);
    const [updated] = await getDb()
      .update(promoCodes)
      .set({ active })
      .where(eq(promoCodes.code, code))
      .returning({ code: promoCodes.code });
    if (updated) {
      logger.info({ code, active }, 'Promo code activation state updated');
    }
    return updated !== undefined;
  }

  async setPromoActiveById(id: string, active: boolean): Promise<boolean> {
    const [updated] = await getDb()
      .update(promoCodes)
      .set({ active })
      .where(eq(promoCodes.id, assertUuid(id)))
      .returning({ code: promoCodes.code });
    if (updated) logger.info({ code: updated.code, active }, 'Promo code activation state updated');
    return updated !== undefined;
  }

  /** Delete only unused codes; redemption history is financial evidence. */
  async deletePromoCode(rawCode: string): Promise<boolean> {
    const code = normalizeCode(rawCode);
    const [deleted] = await getDb()
      .delete(promoCodes)
      .where(and(eq(promoCodes.code, code), eq(promoCodes.currentUses, 0)))
      .returning({ code: promoCodes.code });
    return deleted !== undefined;
  }

  async deletePromoCodeById(id: string): Promise<boolean> {
    const [deleted] = await getDb()
      .delete(promoCodes)
      .where(and(eq(promoCodes.id, assertUuid(id)), eq(promoCodes.currentUses, 0)))
      .returning({ code: promoCodes.code });
    return deleted !== undefined;
  }

  /**
   * Validate a promo for selecting it in a Telegram session. This does not
   * consume capacity: capacity is consumed only by reserveForPurchase inside
   * the wallet saga transaction.
   */
  async validateForSelection(
    telegramId: number,
    rawCode: string
  ): Promise<{
    code: string;
    type: PromoType;
    value: number;
  }> {
    const code = normalizeCode(rawCode);
    const promo = await this.getSelectablePromo(getDb(), telegramId, code);
    return { code, type: promo.type, value: promo.value };
  }

  /**
   * Produce a display quote without reserving a redemption. Callers must pass
   * the raw code and base package values to the purchase saga; this quote is
   * intentionally never authoritative for the charged amount.
   */
  async quoteForPurchase(
    telegramId: number,
    rawCode: string,
    baseAmount: number,
    baseGbAmount: number
  ): Promise<PromoQuote> {
    const code = normalizeCode(rawCode);
    const promo = await this.getSelectablePromo(getDb(), telegramId, code);
    if (promo.type === 'gift_credit') {
      throw new PromoValidationError('promo_not_purchase_code');
    }
    assertMinimumPurchaseAmount(baseAmount, promo.minPurchaseAmount);
    return applyPurchasePromo(code, promo.type, promo.value, baseAmount, baseGbAmount);
  }

  /**
   * Redeem an entered code. Gift credit is an immediate, auditable wallet
   * credit; all other codes are merely selected for the user's next purchase.
   */
  async redeemCode(telegramId: number, rawCode: string): Promise<RedeemResult> {
    let selection: { code: string; type: PromoType; value: number };
    try {
      selection = await this.validateForSelection(telegramId, rawCode);
    } catch (err) {
      if (err instanceof PromoValidationError) {
        return { success: false, messageKey: err.messageKey };
      }
      logger.error({ err, telegramId }, 'Failed to validate promo code');
      return { success: false, messageKey: 'promo_redeem_failed' };
    }

    if (selection.type !== 'gift_credit') {
      return {
        success: true,
        messageKey: 'promo_valid',
        code: selection.code,
        codeType: selection.type,
        value: selection.value,
      };
    }

    try {
      await this.redeemGiftCredit(telegramId, selection.code);
      return {
        success: true,
        messageKey: 'promo_gift_credit_success',
        code: selection.code,
        codeType: selection.type,
        value: selection.value,
      };
    } catch (err) {
      if (err instanceof PromoValidationError) {
        return { success: false, messageKey: err.messageKey };
      }
      logger.error({ err, code: selection.code, telegramId }, 'Failed to redeem gift credit promo');
      return { success: false, messageKey: 'promo_redeem_failed' };
    }
  }

  /**
   * Atomically reserve a non-credit promo while the caller creates its pending
   * financial intent. `baseAmount` and `baseGbAmount` are server-side package
   * values. The returned values, not a Telegram/UI quote, are authoritative.
   *
   * The referenced purchase intent must already be inserted in the same DB
   * transaction (it may use provisional base values and be updated afterward).
   */
  async reserveForPurchase(
    tx: DbTransaction,
    params: {
      telegramId: number;
      intentId: string;
      rawCode: string;
      baseAmount: number;
      baseGbAmount: number;
    }
  ): Promise<ReservedPurchasePromo> {
    const code = normalizeCode(params.rawCode);
    const baseAmount = validateBaseAmount(params.baseAmount);
    const baseGbAmount = validateBaseGbAmount(params.baseGbAmount);
    const promo = await this.getSelectablePromo(tx, params.telegramId, code);

    if (promo.type === 'gift_credit') {
      throw new PromoValidationError('promo_not_purchase_code');
    }
    assertMinimumPurchaseAmount(baseAmount, promo.minPurchaseAmount);

    // This guarded update locks the code row. The per-user count is taken
    // only after the lock, making a concurrent same-code redemption observe
    // the prior committed use before it can insert its own reservation.
    const [consumed] = await tx
      .update(promoCodes)
      .set({ currentUses: sql`${promoCodes.currentUses} + 1` })
      .where(availablePromoWhere(code))
      .returning({
        type: promoCodes.type,
        value: promoCodes.value,
        maxUsesPerUser: promoCodes.maxUsesPerUser,
        minPurchaseAmount: promoCodes.minPurchaseAmount,
      });
    if (!consumed) {
      throw await this.getUnavailablePromoError(tx, code);
    }

    const type = parsePurchasePromoType(consumed.type);
    if (!type) {
      // A concurrent administrative mutation cannot turn a purchase
      // reservation into a credit redemption; rollback the whole transaction.
      throw new PromoValidationError('promo_not_purchase_code');
    }
    assertMinimumPurchaseAmount(baseAmount, consumed.minPurchaseAmount);
    await this.assertUserUsageAvailable(tx, code, params.telegramId, consumed.maxUsesPerUser);

    await tx.insert(codeRedemptions).values({
      id: redemptionId(),
      code,
      telegramId: params.telegramId,
      purchaseIntentId: params.intentId,
      status: 'pending',
    });

    return {
      ...applyPurchasePromo(code, type, consumed.value, baseAmount, baseGbAmount),
      intentId: params.intentId,
    };
  }

  /** Mark a successfully committed purchase promo as completed in its ledger. */
  async finalizeReservedPurchasePromo(tx: DbTransaction, intentId: string): Promise<boolean> {
    const [finalized] = await tx
      .update(codeRedemptions)
      .set({ status: 'completed' })
      .where(
        and(eq(codeRedemptions.purchaseIntentId, intentId), eq(codeRedemptions.status, 'pending'))
      )
      .returning({ code: codeRedemptions.code });
    return finalized !== undefined;
  }

  /**
   * Release a promo after a confirmed failed purchase. Unknown remote outcomes
   * must remain pending for reconciliation, so callers should use this only
   * after they know the Rebecca operation did not take effect.
   */
  async releaseReservedPurchasePromo(intentId: string): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await this.releaseReservedPurchasePromoInTransaction(tx, intentId);
    });
  }

  /**
   * Transaction-bound form used by the financial saga and reconciler. Keeping
   * promo release beside the intent transition prevents a confirmed failed
   * purchase from burning a use or freeing it before its funds are released.
   */
  async releaseReservedPurchasePromoInTransaction(
    tx: DbTransaction,
    intentId: string
  ): Promise<boolean> {
    const [released] = await tx
      .delete(codeRedemptions)
      .where(
        and(eq(codeRedemptions.purchaseIntentId, intentId), eq(codeRedemptions.status, 'pending'))
      )
      .returning({ code: codeRedemptions.code });
    if (!released) return false;

    await tx
      .update(promoCodes)
      .set({
        currentUses: sql`GREATEST(${promoCodes.currentUses} - 1, 0)`,
      })
      .where(eq(promoCodes.code, released.code));
    return true;
  }

  async getReservedPromoForIntent(
    intentId: string
  ): Promise<{ code: string; status: string } | undefined> {
    const [reservation] = await getDb()
      .select({ code: codeRedemptions.code, status: codeRedemptions.status })
      .from(codeRedemptions)
      .where(eq(codeRedemptions.purchaseIntentId, intentId))
      .limit(1);
    return reservation;
  }

  private async redeemGiftCredit(telegramId: number, code: string): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [promo] = await tx
        .select({ type: promoCodes.type, value: promoCodes.value })
        .from(promoCodes)
        .where(eq(promoCodes.code, code))
        .limit(1);
      if (!promo) throw new PromoValidationError('promo_invalid');
      if (promo.type !== 'gift_credit') throw new PromoValidationError('promo_not_purchase_code');

      // The code-row update obtains the same lock as purchase reservations,
      // serializing global and per-user capacity checks.
      const [consumed] = await tx
        .update(promoCodes)
        .set({ currentUses: sql`${promoCodes.currentUses} + 1` })
        .where(and(availablePromoWhere(code), eq(promoCodes.type, 'gift_credit')))
        .returning({ value: promoCodes.value, maxUsesPerUser: promoCodes.maxUsesPerUser });
      if (!consumed) throw await this.getUnavailablePromoError(tx, code);
      await this.assertUserUsageAvailable(tx, code, telegramId, consumed.maxUsesPerUser);
      const creditAmount = safePromoValue('gift_credit', consumed.value);

      const id = redemptionId();
      await tx.insert(codeRedemptions).values({
        id,
        code,
        telegramId,
        status: 'completed',
      });

      const [updatedUser] = await tx
        .update(users)
        .set({
          balance: sql`${users.balance} + ${creditAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.telegramId, telegramId))
        .returning({ balance: users.balance });
      if (!updatedUser) throw new Error('USER_NOT_FOUND');

      await tx.insert(walletTransactions).values({
        id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        telegramId,
        amount: creditAmount,
        balanceAfter: updatedUser.balance,
        type: 'promo',
        referenceId: `promo_${code}_${telegramId}_${id}`,
        description: `Redeemed gift credit promo code: ${code}`,
      });
    });
  }

  private async getSelectablePromo(
    db: Pick<DbTransaction, 'select'> | ReturnType<typeof getDb>,
    telegramId: number,
    code: string
  ): Promise<{ type: PromoType; value: number; minPurchaseAmount: number }> {
    const [promo] = await db
      .select({
        type: promoCodes.type,
        value: promoCodes.value,
        active: promoCodes.active,
        expiresAt: promoCodes.expiresAt,
        currentUses: promoCodes.currentUses,
        maxUses: promoCodes.maxUses,
        maxUsesPerUser: promoCodes.maxUsesPerUser,
        minPurchaseAmount: promoCodes.minPurchaseAmount,
      })
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);
    if (!promo) throw new PromoValidationError('promo_invalid');
    if (!promo.active) throw new PromoValidationError('promo_inactive');
    if (promo.expiresAt && promo.expiresAt <= new Date()) {
      throw new PromoValidationError('promo_expired');
    }
    if (promo.currentUses >= promo.maxUses) {
      throw new PromoValidationError('promo_max_uses_reached');
    }

    const [redemptionCount] = await db
      .select({ value: sql<number>`COUNT(*)` })
      .from(codeRedemptions)
      .where(and(eq(codeRedemptions.code, code), eq(codeRedemptions.telegramId, telegramId)))
      .limit(1);
    if (Number(redemptionCount?.value ?? 0) >= normalizeMaxUsesPerUser(promo.maxUsesPerUser)) {
      throw new PromoValidationError('promo_user_max_uses_reached');
    }

    const type = parsePromoType(promo.type);
    if (!type) throw new PromoValidationError('promo_invalid');
    return {
      type,
      value: safePromoValue(type, promo.value),
      minPurchaseAmount: validateMinimumPurchaseAmount(promo.minPurchaseAmount ?? 0),
    };
  }

  private async assertUserUsageAvailable(
    db: Pick<DbTransaction, 'select'> | ReturnType<typeof getDb>,
    code: string,
    telegramId: number,
    maxUsesPerUser: number | undefined
  ): Promise<void> {
    const [redemptionCount] = await db
      .select({ value: sql<number>`COUNT(*)` })
      .from(codeRedemptions)
      .where(and(eq(codeRedemptions.code, code), eq(codeRedemptions.telegramId, telegramId)))
      .limit(1);
    if (Number(redemptionCount?.value ?? 0) >= normalizeMaxUsesPerUser(maxUsesPerUser)) {
      throw new PromoValidationError('promo_user_max_uses_reached');
    }
  }

  private async getUnavailablePromoError(
    db: Pick<DbTransaction, 'select'> | ReturnType<typeof getDb>,
    code: string
  ): Promise<PromoValidationError> {
    const [promo] = await db
      .select({
        active: promoCodes.active,
        expiresAt: promoCodes.expiresAt,
        currentUses: promoCodes.currentUses,
        maxUses: promoCodes.maxUses,
      })
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);
    if (!promo) return new PromoValidationError('promo_invalid');
    if (!promo.active) return new PromoValidationError('promo_inactive');
    if (promo.expiresAt && promo.expiresAt <= new Date()) {
      return new PromoValidationError('promo_expired');
    }
    return new PromoValidationError('promo_max_uses_reached');
  }
}

function normalizeCode(rawCode: string): string {
  const code = rawCode.trim().toUpperCase();
  if (!code || code.length > 128 || !/^[A-Z0-9_-]+$/.test(code)) {
    throw new PromoValidationError('promo_invalid');
  }
  return code;
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error('PROMO_ID_INVALID');
  }
  return value.toLowerCase();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function parsePromoType(type: string): PromoType | undefined {
  return PROMO_TYPES.find((candidate) => candidate === type);
}

function parsePurchasePromoType(type: string): PurchasePromoType | undefined {
  return PURCHASE_PROMO_TYPES.find((candidate) => candidate === type);
}

function validatePromoValue(type: PromoType, rawValue: number): number {
  const value = clampInteger(rawValue, 1, MAX_DATABASE_INTEGER);
  if (type === 'discount_percent' && value > 100) {
    throw new Error('PROMO_PERCENT_MUST_BE_BETWEEN_1_AND_100');
  }
  return value;
}

function validateBaseAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('PROMO_BASE_AMOUNT_INVALID');
  }
  return value;
}

function validateBaseGbAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DATABASE_INTEGER) {
    throw new Error('PROMO_BASE_GB_INVALID');
  }
  return value;
}

function validateMinimumPurchaseAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('PROMO_MINIMUM_PURCHASE_AMOUNT_INVALID');
  }
  return value;
}

function normalizeMaxUsesPerUser(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function assertMinimumPurchaseAmount(baseAmount: number, minimumPurchaseAmount: number): void {
  if (baseAmount < minimumPurchaseAmount) {
    throw new PromoValidationError('promo_minimum_purchase_not_met');
  }
}

function redemptionId(): string {
  return `cr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('PROMO_VALUE_INVALID');
  }
  return value;
}

function availablePromoWhere(code: string) {
  return and(
    eq(promoCodes.code, code),
    eq(promoCodes.active, true),
    lt(promoCodes.currentUses, promoCodes.maxUses),
    or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, new Date()))
  );
}

function applyPurchasePromo(
  code: string,
  type: PurchasePromoType,
  value: number,
  baseAmount: number,
  baseGbAmount: number
): PromoQuote {
  const validBaseAmount = validateBaseAmount(baseAmount);
  const validBaseGbAmount = validateBaseGbAmount(baseGbAmount);
  const validValue = safePromoValue(type, value);

  switch (type) {
    case 'discount_percent':
      return {
        code,
        type,
        value: validValue,
        finalAmount: Math.floor((validBaseAmount * (100 - validValue)) / 100),
        finalGbAmount: validBaseGbAmount,
      };
    case 'discount_fixed':
      return {
        code,
        type,
        value: validValue,
        finalAmount: Math.max(0, validBaseAmount - validValue),
        finalGbAmount: validBaseGbAmount,
      };
    case 'gift_gb': {
      const finalGbAmount = validBaseGbAmount + validValue;
      if (!Number.isSafeInteger(finalGbAmount) || finalGbAmount > MAX_DATABASE_INTEGER) {
        throw new PromoValidationError('promo_invalid');
      }
      return { code, type, value: validValue, finalAmount: validBaseAmount, finalGbAmount };
    }
  }
}

function safePromoValue(type: PromoType, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DATABASE_INTEGER) {
    throw new PromoValidationError('promo_invalid');
  }
  if (type === 'discount_percent' && value > 100) {
    throw new PromoValidationError('promo_invalid');
  }
  return value;
}
