/** Pure validation/error-classification helpers used by WalletService. */

import type { RebeccaUserDetail } from './RebeccaService.js';
import { RebeccaApiError, RebeccaContractError, RebeccaOriginDownError } from './RebeccaService.js';
import {
  ADMIN_BALANCE_OPERATIONS,
  type AdminBalanceAdjustment,
  type PurchaseSagaParams,
} from './WalletContracts.js';

export class PurchaseIntentAlreadySettledError extends Error {
  constructor(readonly status: string | undefined) {
    super(`Purchase intent is no longer pending (status: ${status ?? 'unknown'}).`);
    this.name = 'PurchaseIntentAlreadySettledError';
  }
}

/** A successful HTTP response that did not prove the requested panel state. */
export class PanelPurchaseVerificationError extends Error {
  constructor() {
    super('VPN Panel response did not confirm the requested active quota and expiration.');
    this.name = 'PanelPurchaseVerificationError';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const target = (err as { cause?: object }).cause ?? err;
  return (
    typeof target === 'object' &&
    target !== null &&
    'code' in target &&
    (target as { code?: unknown }).code === '23505'
  );
}

export function validatePurchaseSagaParams(params: PurchaseSagaParams): void {
  if (!Number.isSafeInteger(params.telegramId) || params.telegramId <= 0) {
    throw new Error('INVALID_TELEGRAM_ID');
  }
  if (!Number.isSafeInteger(params.amount) || params.amount < 0) {
    throw new Error('INVALID_PURCHASE_AMOUNT');
  }

  if (!Number.isSafeInteger(params.gbAmount) || params.gbAmount < 1 || params.gbAmount > 10_000) {
    throw new Error('INVALID_GB_AMOUNT');
  }
  if (
    !Number.isSafeInteger(params.durationDays) ||
    params.durationDays < 1 ||
    params.durationDays > 3_650
  ) {
    throw new Error('INVALID_DURATION_DAYS');
  }
  if (!params.configUsername.trim()) throw new Error('INVALID_CONFIG_USERNAME');
  if (params.promoCode !== undefined && !params.promoCode.trim()) {
    throw new Error('INVALID_PROMO_CODE');
  }
  if (params.panelId !== undefined && !/^[a-z0-9][a-z0-9_-]{1,39}$/iu.test(params.panelId)) {
    throw new Error('INVALID_PANEL_ID');
  }
  if (
    params.serviceId !== undefined &&
    (!Number.isSafeInteger(params.serviceId) ||
      params.serviceId <= 0 ||
      params.serviceId > 2_147_483_647)
  ) {
    throw new Error('INVALID_SERVICE_ID');
  }
  if (params.checkoutId !== undefined && !/^co_[A-Za-z0-9_-]{8,32}$/u.test(params.checkoutId)) {
    throw new Error('INVALID_CHECKOUT_ID');
  }
  if (
    params.maxAmount !== undefined &&
    (!Number.isSafeInteger(params.maxAmount) || params.maxAmount < 0)
  ) {
    throw new Error('INVALID_MAX_PURCHASE_AMOUNT');
  }
}

export function assertPositiveSafeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
}

export function assertAdminBalanceAdjustment(params: AdminBalanceAdjustment): void {
  if (!Number.isSafeInteger(params.telegramId) || params.telegramId <= 0) {
    throw new Error('INVALID_TELEGRAM_ID');
  }
  if (!Number.isSafeInteger(params.adminId) || params.adminId <= 0) {
    throw new Error('INVALID_ADMIN_ID');
  }
  if (!ADMIN_BALANCE_OPERATIONS.includes(params.operation)) {
    throw new Error('INVALID_ADMIN_BALANCE_OPERATION');
  }
  const requiresPositiveAmount = params.operation === 'add' || params.operation === 'deduct';
  if (
    !Number.isSafeInteger(params.amount) ||
    params.amount < 0 ||
    (requiresPositiveAmount && params.amount === 0)
  ) {
    throw new Error('INVALID_ADMIN_BALANCE_AMOUNT');
  }
  if (!params.description.trim() || params.description.length > 500) {
    throw new Error('INVALID_ADMIN_BALANCE_DESCRIPTION');
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sanitizeRegistrationSource(value: string): string {
  const source = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/u.test(source) ? source : 'telegram';
}

/**
 * A purchase is not financially final merely because Rebecca returned 2xx.
 * The API response must prove the active status and the exact requested quota
 * and expiry (within a minute of the timestamp captured immediately before
 * the request). This prevents a partial panel write from charging the wallet.
 */
export function assertPanelPurchaseApplied(
  result: RebeccaUserDetail,
  expectedDataLimit: number,
  expectedExpire: number
): void {
  if (
    result.status !== 'active' ||
    result.data_limit !== expectedDataLimit ||
    result.expire === null ||
    result.expire === undefined ||
    Math.abs(result.expire - expectedExpire) > 60
  ) {
    throw new PanelPurchaseVerificationError();
  }
}

/** A dispatched mutation without a definitive outcome must be reconciled. */
export function isRemoteOutcomeIndeterminate(err: unknown): boolean {
  if (err instanceof PanelPurchaseVerificationError) return true;
  if (err instanceof RebeccaOriginDownError) return err.requestDispatched;
  if (err instanceof RebeccaContractError) return true;
  if (err instanceof RebeccaApiError) return err.status >= 500 || err.status === 409;
  return false;
}
