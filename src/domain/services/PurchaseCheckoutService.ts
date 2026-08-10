import crypto from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { purchaseCheckouts } from '../../infra/schema.js';
import type { PackageOption } from './PricingService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';

const CHECKOUT_TTL_MS = 15 * 60 * 1000;

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

  async claim(checkoutId: string, telegramId: number): Promise<PurchaseCheckout> {
    const now = new Date();
    const [claimed] = await getDb()
      .update(purchaseCheckouts)
      .set({ status: 'processing', claimedAt: now, updatedAt: now })
      .where(
        sql`${purchaseCheckouts.id} = ${checkoutId}
          AND ${purchaseCheckouts.telegramId} = ${telegramId}
          AND ${purchaseCheckouts.status} = 'pending'
          AND ${purchaseCheckouts.expiresAt} > ${now}`
      )
      .returning();
    if (claimed) return claimed;

    const [existing] = await getDb()
      .select()
      .from(purchaseCheckouts)
      .where(eq(purchaseCheckouts.id, checkoutId))
      .limit(1);
    if (!existing) throw new PurchaseCheckoutUnavailableError('missing');
    if (existing.telegramId !== telegramId) {
      throw new PurchaseCheckoutUnavailableError('owner_mismatch');
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
    throw new PurchaseCheckoutUnavailableError('consumed');
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
