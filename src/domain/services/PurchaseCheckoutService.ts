import crypto from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { purchaseCheckouts, purchaseIntents } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import type { PackageOption } from './PricingService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';

const CHECKOUT_TTL_MS = 15 * 60 * 1000;
export const PROCESSING_CHECKOUT_MIN_AGE_MS = 5 * 60 * 1000;

export class PurchaseCheckoutUnavailableError extends Error {
  constructor(readonly reason: 'missing' | 'expired' | 'consumed' | 'owner_mismatch') {
    super(`PURCHASE_CHECKOUT_${reason.toUpperCase()}`);
    this.name = 'PurchaseCheckoutUnavailableError';
  }
}

export type PurchaseCheckout = typeof purchaseCheckouts.$inferSelect;

export class PurchaseCheckoutService {
  constructor(private readonly panels: RebeccaPanelRegistry) {}

  async create(input: {
    telegramId: number;
    kind: 'new_config' | 'renew_config';
    pkg: PackageOption;
    configId?: string;
    panelId?: string;
    serviceId?: number;
    promoCode?: string;
    quotedAmount?: number;
  }): Promise<PurchaseCheckout> {
    const quotedAmount = input.quotedAmount ?? input.pkg.price;
    assertCheckoutInput(input, quotedAmount);
    const requestedPanelId = input.panelId ?? input.pkg.panelId;
    const requestedServiceId = input.serviceId ?? input.pkg.serviceId;
    const target = await this.panels.resolveTarget(requestedPanelId, requestedServiceId);
    const id = `co_${crypto.randomBytes(8).toString('base64url')}`;
    const [checkout] = await getDb()
      .insert(purchaseCheckouts)
      .values({
        id,
        telegramId: input.telegramId,
        kind: input.kind,
        configId: input.configId ?? null,
        packageId: input.pkg.id,
        packageName: input.pkg.name,
        panelId: target.panelId,
        serviceId: target.serviceId,
        amount: input.pkg.price,
        quotedAmount,
        gbAmount: input.pkg.gbAmount,
        durationDays: input.pkg.durationDays,
        promoCode: input.promoCode ?? null,
        expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
      })
      .returning();
    if (!checkout) throw new Error('PURCHASE_CHECKOUT_CREATE_FAILED');
    return checkout;
  }

  async claim(
    checkoutId: string,
    telegramId: number,
    allowAdminOverride = false
  ): Promise<PurchaseCheckout> {
    let now = new Date();
    const claimed = await this.claimPending(checkoutId, telegramId, now, allowAdminOverride);
    if (claimed) return claimed;

    let [existing] = await getDb()
      .select()
      .from(purchaseCheckouts)
      .where(eq(purchaseCheckouts.id, checkoutId))
      .limit(1);
    if (!existing) throw new PurchaseCheckoutUnavailableError('missing');
    if (existing.telegramId !== telegramId && !allowAdminOverride) {
      throw new PurchaseCheckoutUnavailableError('owner_mismatch');
    }

    if (existing.status === 'processing' && isProcessingCheckoutStale(existing, now)) {
      await this.reconcileProcessingCheckout(existing.id, now);
      [existing] = await getDb()
        .select()
        .from(purchaseCheckouts)
        .where(eq(purchaseCheckouts.id, checkoutId))
        .limit(1);
      if (!existing) throw new PurchaseCheckoutUnavailableError('missing');
      now = new Date();
      if (existing.status === 'pending') {
        const reclaimed = await this.claimPending(checkoutId, telegramId, now, allowAdminOverride);
        if (reclaimed) return reclaimed;
      }
    }

    if (existing.status === 'pending' && existing.expiresAt <= now) {
      await getDb()
        .update(purchaseCheckouts)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(purchaseCheckouts.id, checkoutId),
            eq(purchaseCheckouts.status, 'pending'),
            lt(purchaseCheckouts.expiresAt, now)
          )
        );
      throw new PurchaseCheckoutUnavailableError('expired');
    }
    if (existing.status === 'expired') throw new PurchaseCheckoutUnavailableError('expired');
    throw new PurchaseCheckoutUnavailableError('consumed');
  }

  /**
   * Recover checkout rows left in `processing` by a process crash. A checkout
   * is never blindly re-opened: its durable purchase_intent is authoritative.
   * Only a stale checkout with no intent can become pending again.
   */
  async reconcileStaleProcessing(limit = 100): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - PROCESSING_CHECKOUT_MIN_AGE_MS);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 500)) : 100;
    const stale = await getDb()
      .select({ id: purchaseCheckouts.id })
      .from(purchaseCheckouts)
      .where(
        and(
          eq(purchaseCheckouts.status, 'processing'),
          or(isNull(purchaseCheckouts.claimedAt), lt(purchaseCheckouts.claimedAt, cutoff))
        )
      )
      .limit(safeLimit);

    let recovered = 0;
    for (const checkout of stale) {
      if (await this.reconcileProcessingCheckout(checkout.id, now)) recovered += 1;
    }
    return recovered;
  }

  private async claimPending(
    checkoutId: string,
    telegramId: number,
    now: Date,
    allowAdminOverride = false
  ): Promise<PurchaseCheckout | undefined> {
    const [claimed] = await getDb()
      .update(purchaseCheckouts)
      .set({ status: 'processing', claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(purchaseCheckouts.id, checkoutId),
          allowAdminOverride ? sql`1=1` : eq(purchaseCheckouts.telegramId, telegramId),
          eq(purchaseCheckouts.status, 'pending'),
          sql`${purchaseCheckouts.expiresAt} > ${now}`
        )
      )
      .returning();
    return claimed;
  }

  private async reconcileProcessingCheckout(checkoutId: string, now: Date): Promise<boolean> {
    return getDb().transaction(async (tx) => {
      const [checkout] = await tx
        .select()
        .from(purchaseCheckouts)
        .where(eq(purchaseCheckouts.id, checkoutId))
        .for('update')
        .limit(1);
      if (
        !checkout ||
        checkout.status !== 'processing' ||
        !isProcessingCheckoutStale(checkout, now)
      ) {
        return false;
      }

      const [intent] = await tx
        .select({ status: purchaseIntents.status })
        .from(purchaseIntents)
        .where(eq(purchaseIntents.checkoutId, checkoutId))
        .limit(1);

      let status: 'pending' | 'completed' | 'failed' | 'expired' | undefined;
      let claimedAt: Date | null | undefined;
      if (!intent) {
        status = checkout.expiresAt > now ? 'pending' : 'expired';
        if (status === 'pending') claimedAt = null;
      } else if (intent.status === 'completed' || intent.status === 'refunded') {
        status = 'completed';
      } else if (intent.status === 'failed') {
        status = 'failed';
      }

      // Pending/reconciliation_required purchase intents may already have
      // touched the panel. Leave their checkout consumed until the purchase
      // reconciler proves a terminal outcome.
      if (!status) return false;

      const [updated] = await tx
        .update(purchaseCheckouts)
        .set({
          status,
          ...(claimedAt !== undefined ? { claimedAt } : {}),
          updatedAt: now,
        })
        .where(
          and(eq(purchaseCheckouts.id, checkoutId), eq(purchaseCheckouts.status, 'processing'))
        )
        .returning({ id: purchaseCheckouts.id });
      if (!updated) return false;

      logger.info({ checkoutId, status }, 'Recovered stale purchase checkout');
      return true;
    });
  }

  async complete(checkoutId: string): Promise<void> {
    await getDb()
      .update(purchaseCheckouts)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(purchaseCheckouts.id, checkoutId), eq(purchaseCheckouts.status, 'processing')));
  }

  async fail(checkoutId: string): Promise<void> {
    await getDb()
      .update(purchaseCheckouts)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(purchaseCheckouts.id, checkoutId), eq(purchaseCheckouts.status, 'processing')));
  }
}

function isProcessingCheckoutStale(checkout: PurchaseCheckout, now: Date): boolean {
  if (!checkout.claimedAt) return true;
  return checkout.claimedAt.getTime() <= now.getTime() - PROCESSING_CHECKOUT_MIN_AGE_MS;
}

function assertCheckoutInput(
  input: Parameters<PurchaseCheckoutService['create']>[0],
  quotedAmount: number
): void {
  const pkg = input.pkg;
  if (
    !Number.isSafeInteger(pkg.price) ||
    pkg.price < 0 ||
    !Number.isSafeInteger(quotedAmount) ||
    quotedAmount < 0 ||
    quotedAmount > pkg.price ||
    !Number.isSafeInteger(pkg.gbAmount) ||
    pkg.gbAmount <= 0 ||
    !Number.isSafeInteger(pkg.durationDays) ||
    pkg.durationDays <= 0 ||
    !pkg.id ||
    !pkg.name.trim()
  ) {
    throw new Error('PURCHASE_CHECKOUT_INPUT_INVALID');
  }
  if (input.kind === 'renew_config' && !input.configId) {
    throw new Error('PURCHASE_CHECKOUT_CONFIG_REQUIRED');
  }
  if (
    (input.panelId !== undefined && pkg.panelId !== undefined && input.panelId !== pkg.panelId) ||
    (input.serviceId !== undefined &&
      pkg.serviceId !== undefined &&
      input.serviceId !== pkg.serviceId)
  ) {
    throw new Error('PURCHASE_CHECKOUT_TARGET_MISMATCH');
  }
  const panelId = input.panelId ?? pkg.panelId;
  const serviceId = input.serviceId ?? pkg.serviceId;
  if ((panelId === undefined) !== (serviceId === undefined)) {
    throw new Error('PURCHASE_CHECKOUT_TARGET_INCOMPLETE');
  }
}
