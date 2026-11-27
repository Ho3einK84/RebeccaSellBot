/** Public wallet and purchase contracts/errors. */

export const PARTIAL_RENEWAL_REVIEW_MESSAGE =
  'Traffic reset applied but renewal update outcome is unresolved; manual review required';

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
  /** Optional package identifier (`pkg_...` or `custom_...`) for inventory & per-user limit enforcement. */
  packageId?: string;
  /** Explicit immutable target selected by the checkout or owning config. */
  panelId?: string;
  serviceId?: number;
  /** Durable Telegram confirmation ID; unique at the database boundary. */
  checkoutId?: string;
  /** Maximum amount the user explicitly confirmed; authoritative pricing may only be lower. */
  maxAmount?: number;
  /** Optional flag allowing an administrator to pay for another user's renewal without transferring ownership. */
  allowAdminOverride?: boolean;
  /** Optional per-purchase override for Rebecca `on_hold` (start validity on first connection). */
  startOnFirstUse?: boolean;
  /** Optional per-purchase override for renewal remaining quota/time rollover. */
  rolloverQuota?: boolean;
}

export class PendingTopupReceiptError extends Error {
  constructor(public readonly receiptId?: string) {
    super('PENDING_TOPUP_RECEIPT_EXISTS');
    this.name = 'PendingTopupReceiptError';
  }
}

export class DuplicateReceiptError extends Error {
  readonly code = 'DUPLICATE_RECEIPT';

  constructor(public readonly originalReceiptId: string) {
    super(`DUPLICATE_RECEIPT:${originalReceiptId}`);
    this.name = 'DuplicateReceiptError';
  }
}

export type TopupVoidErrorReason = 'not_found' | 'not_approved';

export class TopupVoidError extends Error {
  readonly code: 'TOPUP_VOID_NOT_FOUND' | 'TOPUP_VOID_NOT_APPROVED';

  constructor(
    public readonly reason: TopupVoidErrorReason,
    public readonly receiptId: string,
    public readonly currentStatus?: string
  ) {
    super(
      reason === 'not_found'
        ? `TOPUP_VOID_NOT_FOUND:${receiptId}`
        : `TOPUP_VOID_NOT_APPROVED:${receiptId}:${currentStatus ?? 'unknown'}`
    );
    this.name = 'TopupVoidError';
    this.code = reason === 'not_found' ? 'TOPUP_VOID_NOT_FOUND' : 'TOPUP_VOID_NOT_APPROVED';
  }
}

export interface TopupReceiptFingerprint {
  fileUniqueId?: string | null;
  fileSha256?: string | null;
}

export interface SubmitTopupReceiptParams extends TopupReceiptFingerprint {
  telegramId: number;
  amount: number;
  photoFileId: string;
  mediaType?: 'photo' | 'document';
  /** Optional bank card identifier assigned to this top-up session. */
  cardId?: string | null;
  /** Optional normalized bank card number snapshot assigned to this top-up session. */
  cardNumber?: string | null;
}

export interface SubmitTopupReceiptResult {
  receiptId: string;
  duplicateOfReceiptId: string | null;
}

export interface VoidApprovedTopupParams {
  receiptId: string;
  adminId: number;
  reason?: string;
  disablePurchasedConfigs?: boolean;
  disableConfig?: (username: string, panelId?: string) => Promise<void>;
}

export interface VoidApprovedTopupResult {
  receiptId: string;
  telegramId: number;
  originalAmount: number;
  deductedAmount: number;
  shortfallAmount: number;
  balanceAfter?: number;
  disabledConfigs: string[];
  alreadyVoided: boolean;
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

export interface WalletTransferParams {
  fromTelegramId: number;
  toTelegramId: number;
  amount: number;
  description?: string;
  /** Optional stable operation key used to make transfer attempts idempotent. */
  referenceId?: string;
}

export interface WalletTransferResult {
  success: boolean;
  fromTelegramId: number;
  toTelegramId: number;
  amount: number;
  fromBalanceAfter: number;
  toBalanceAfter: number;
  txIdSender: string;
  txIdRecipient: string;
}
