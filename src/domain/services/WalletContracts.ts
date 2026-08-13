/** Public wallet and purchase contracts/errors. */

export interface PurchaseSagaParams {
  telegramId: number;
  /** Base package price in configured minor units. Promotion settlement derives the final amount in-tx. */
  amount: number;
  type: 'new_config' | 'renew_config';
  configUsername: string;
  /** Base package traffic amount. Promotion settlement may derive the final GB in-tx. */
  gbAmount: number;
  durationDays: number;
  /** Optional promotion identifier. Pricing is never trusted from the UI. */
  promoCode?: string;
  /** Explicit immutable target selected by the checkout or owning config. */
  panelId?: string;
  serviceId?: number;
  /** Durable Telegram confirmation ID; unique at the database boundary. */
  checkoutId?: string;
  /** Maximum amount the user explicitly confirmed; authoritative pricing may only be lower. */
  maxAmount?: number;
}

export class PendingTopupReceiptError extends Error {
  constructor(public readonly receiptId?: string) {
    super('PENDING_TOPUP_RECEIPT_EXISTS');
    this.name = 'PendingTopupReceiptError';
  }
}

export interface PurchaseSagaResult {
  success: boolean;
  configUsername: string;
  subUrl?: string;
}

/** A database-enforced re-entry guard caught a duplicate user action. */
export class PurchaseInProgressError extends Error {
  readonly code = 'PURCHASE_IN_PROGRESS';

  constructor(readonly intentId?: string) {
    super('A financial transaction is already in progress for this wallet.');
    this.name = 'PurchaseInProgressError';
  }
}

/**
 * The remote request may have reached Rebecca, but its response/compensation
 * was indeterminate. The balance is unchanged but its reservation is retained
 * until the five-minute reconciliation sweep can prove the outcome.
 */
export class PurchaseOutcomePendingError extends Error {
  readonly code = 'PURCHASE_OUTCOME_PENDING';

  constructor(
    readonly intentId: string,
    options?: ErrorOptions
  ) {
    super(
      'Transaction outcome is being verified. Wallet funds remain reserved until confirmation.',
      options
    );
    this.name = 'PurchaseOutcomePendingError';
  }
}

export interface DashboardStats {
  totalUsers: number;
  totalSales: number;
  dailyRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  totalReferralBonus: number;
  totalCashback: number;
  activeSubscriptions: number;
  inactiveSubscriptions: number;
  pendingReceipts: number;
}

export const ADMIN_BALANCE_OPERATIONS = ['add', 'deduct', 'set'] as const;
export type AdminBalanceOperation = (typeof ADMIN_BALANCE_OPERATIONS)[number];

export type AdminBalanceAdjustment = {
  telegramId: number;
  operation: AdminBalanceOperation;
  amount: number;
  adminId: number;
  description: string;
  /** Optional stable operation key used to make button-driven adjustments idempotent. */
  referenceId?: string;
};
