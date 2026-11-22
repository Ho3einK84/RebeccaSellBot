export type UserTabType = 'dashboard' | 'services' | 'shop' | 'wallet' | 'referral';

export type TransactionFilterType = 'all' | 'topup' | 'purchase' | 'rewards' | 'transfer';

export interface VolumePricingTierItem {
  id: string;
  minGb: number;
  maxGb?: number;
  pricePerGb?: number;
  discountPercent?: number;
}

export interface UserPortalProfile {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  referralCode: string;
  totalSpend: number;
  activeSubscriptionCount: number;
  transactionCount: number;
  referredUserCount: number;
  activeBuyersCount?: number;
  referralBonusEarned: number;
  cashbackEarned: number;
  hasUsedTrial: boolean;
  phoneVerificationRequired?: boolean;
  phoneVerified?: boolean;
  createdAt: string;
}

export interface CustomVolumeSettings {
  enabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  defaultDays: number;
  minGb: number;
  maxGb: number;
  tiers?: VolumePricingTierItem[];
}

export interface PendingReceiptInfo {
  id: string;
  shortId?: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface CustomVolumeQuoteResponse {
  gbAmount: number;
  durationDays: number;
  totalPrice: number;
  originalPrice?: number;
  effectivePrice?: number;
  activeDiscountTitle?: string | null;
  discountExpiresAt?: string | null;
  pricePerGb: number;
  pricePerDay: number;
  tierId?: string | null;
}

export interface UserPortalSettings {
  currency: string;
  cardNumber: string;
  cardHolder: string;
  bankName?: string;
  cardId?: string;
  allCardsCapReached?: boolean;
  uniqueTopupAmountEnabled?: boolean;
  nativeReceiptUploadEnabled?: boolean;
  walletTransferEnabled?: boolean;
  walletTransferMinAmount?: number;
  supportUsername: string;
  supportUrl?: string;
  supportLabel?: string;
  supportEnabled: boolean;
  botUsername: string;
  topupMinAmount?: number;
  topupMaxAmount?: number;
  referralBonusToman?: number;
  cashbackPercent?: number;
  maintenanceMode?: boolean;
  isAdminBypass?: boolean;
  customServiceNameEnabled?: boolean;
  onHoldDefaultEnabled?: boolean;
  renewalRolloverEnabled?: boolean;
  customVolume?: CustomVolumeSettings;
}

export interface UserTrialStatus {
  enabled: boolean;
  eligible: boolean;
  hasUsedTrial: boolean;
  gb: number;
  days: number;
  requirePhone: boolean;
  phoneVerificationRequired?: boolean;
}

export interface TrialClaimResponse {
  success: boolean;
  configUsername: string;
  subUrl: string;
  gb: number;
  days: number;
}

export interface LuckyWheelHistoryItem {
  id: string;
  amount: number;
  spinNumber: number;
  createdAt: string;
}

export interface LuckyWheelSummary {
  enabled: boolean;
  canSpin: boolean;
  reason?: string;
  totalSpins: number;
  maxSpins: number;
  spinsRemaining: number;
  minPrize: number;
  maxPrize: number;
  nextSpinAt: string | null;
  secondsRemaining: number | null;
}

export interface LuckyWheelStatusResponse extends LuckyWheelSummary {
  currentEffectiveLuck: number;
  history: LuckyWheelHistoryItem[];
}

export interface LuckyWheelSpinResponse {
  success: boolean;
  amount: number;
  balanceAfter: number;
  spinNumber: number;
  spinsRemaining: number;
  nextSpinAt: string | null;
}

export interface UserProfileResponse {
  user: UserPortalProfile;
  settings: UserPortalSettings;
  trial?: UserTrialStatus | null;
  luckyWheel?: LuckyWheelSummary | null;
  pendingReceipt?: PendingReceiptInfo | null;
}

export interface UserConfigRecord {
  id: string;
  configUsername: string;
  panelId?: string | null;
  panelName?: string | null;
  serviceId?: number | null;
  subUrl: string | null;
  panelStatus: string | null;
  panelDataLimit: number | null;
  panelUsedTraffic: number | null;
  panelExpire: number | null;
  panelOnHoldExpireDuration?: number | null;
  autoRenewEnabled: boolean;
  autoRenewPackageId?: string | null;
  autoRenewPackageName?: string | null;
  autoRenewPrice?: number | null;
  lastSyncedAt?: string | null;
  createdAt: string;
}

export interface UserConfigUsageNode {
  nodeId: number | null;
  nodeName: string;
  usedTraffic: number;
}

export interface UserConfigUsageResponse {
  onlineAt: string | null;
  subUpdatedAt: string | null;
  lifetimeUsedTraffic: number | null;
  nodes: UserConfigUsageNode[];
}

export interface ConfigRefundQuoteResponse {
  eligible: boolean;
  reason?: string;
  configId?: string;
  configUsername?: string;
  grossAmount?: number;
  cashbackWithheld?: number;
  refundAmount?: number;
  purchasedAt?: string;
}

export interface ConfigDeleteResponse {
  success: boolean;
  refunded: boolean;
  refundAmount: number;
  configUsername: string;
}

export interface RecipientPreview {
  telegramId: number;
  displayName: string;
  username: string | null;
}

export interface ConfigTransferPreviewResponse {
  recipient: RecipientPreview;
  autoRenewWillReset: boolean;
}

export interface ConfigTransferResponse {
  success: boolean;
  configUsername: string;
  toTelegramId: number;
}

export interface ClaimSubLinkResponse {
  success: boolean;
  username: string;
  panelId?: string | null;
  messageKey: string;
}

export interface SyncAllConfigsResponse {
  success: boolean;
  total: number;
  synced: number;
  failed: number;
}

export interface ToggleAutoRenewResponse {
  success: boolean;
  autoRenewEnabled: boolean;
  packageId?: string;
  packageName?: string;
  price?: number;
}

export interface ToggleConfigStatusResponse {
  success: boolean;
  status: string;
}

export interface RevokeConfigResponse {
  success: boolean;
  subUrl: string;
}

export interface RefreshConfigResponse {
  success: boolean;
  config: {
    panelStatus: string | null;
    panelDataLimit: number | null;
    panelUsedTraffic: number | null;
    panelExpire: number | null;
    panelOnHoldExpireDuration?: number | null;
    lastSyncedAt: string | Date | null;
  };
}

export interface UserConfigsResponse {
  configs: UserConfigRecord[];
}

export interface UserCategoryItem {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  displayOrder: number;
}

export interface UserPackageItem {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number;
  originalPrice?: number;
  effectivePrice?: number;
  discountAmount?: number;
  activeDiscountTitle?: string | null;
  discountExpiresAt?: string | null;
  categoryId?: string | null;
  startOnFirstUse?: boolean;
  rolloverQuota?: boolean;
  featured?: boolean;
}

export interface UserPackagesResponse {
  packages: UserPackageItem[];
  categories?: UserCategoryItem[];
  volumePricingTiers?: VolumePricingTierItem[];
}

export interface RolloverPreviewDto {
  enabled: boolean;
  currentRemainingGb?: number | null;
  currentRemainingDays?: number | null;
  projectedTotalGb?: number | null;
  projectedTotalDays?: number | null;
}

export interface UserRenewalOptionsResponse {
  config: {
    id: string;
    configUsername: string;
    panelStatus: string | null;
    currentRemainingGb: number | null;
    currentRemainingDays: number | null;
    autoRenewEnabled: boolean;
    autoRenewPackageId: string | null;
    autoRenewPackageName?: string | null;
    autoRenewPrice: number | null;
  };
  packages: UserPackageItem[];
  defaultRolloverEnabled: boolean;
  customVolumeEnabled: boolean;
}

export interface PromoQuoteResponse {
  valid: boolean;
  code: string;
  type: 'percent' | 'fixed' | 'gift_gb' | string;
  value: number;
  originalPrice: number;
  effectivePrice: number;
  finalAmount: number;
  discountAmount: number;
  baseGb: number;
  bonusGb: number;
  finalGb: number;
}

export interface PromoRedeemResponse {
  success: boolean;
  code?: string;
  type: 'gift_credit';
  value: number;
  messageKey: string;
  availableBalance?: number;
}

export interface WalletDeficitContext {
  amount: number;
  itemName: string;
}

export interface UserTransactionRecord {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface UserTransactionsResponse {
  transactions: UserTransactionRecord[];
  total: number;
  totalPages: number;
  page: number;
  filter?: TransactionFilterType;
}

export interface UserReceiptRecord {
  id: string;
  shortId: string;
  amount: number;
  status: string;
  cardNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserReceiptsResponse {
  receipts: UserReceiptRecord[];
  total: number;
  totalPages: number;
  page: number;
}

export interface PrepareTopupResponse {
  requestedAmount: number;
  payableAmount: number;
  isUniqueAmount: boolean;
  card: {
    id: string;
    cardNumber: string;
    cardHolder: string;
    bankName: string;
  };
  nativeUploadEnabled: boolean;
}

export interface SubmitTopupReceiptResponse {
  success: boolean;
  receiptId: string;
  shortId: string;
  amount: number;
  status: string;
  duplicateWarning?: boolean;
}

export interface WalletTransferPreviewResponse {
  recipient: RecipientPreview;
}

export interface WalletTransferResponse {
  success: boolean;
  amount: number;
  toTelegramId: number;
  fromBalanceAfter: number;
}

export interface CreateCheckoutPayload {
  kind?: 'new_config' | 'renew_config';
  configId?: string;
  packageId?: string;
  custom?: {
    gb: number;
    days: number;
  };
  promoCode?: string;
  requestedUsername?: string;
}

export interface UserCheckoutResponse {
  checkoutId: string;
  kind?: 'new_config' | 'renew_config';
  configId?: string;
  configUsername?: string;
  name: string;
  gb: number;
  bonusGb?: number;
  finalGb?: number;
  days: number;
  price: number;
  basePrice?: number;
  quotedAmount: number;
  originalPrice?: number;
  effectivePrice?: number;
  discountAmount?: number;
  activeDiscountTitle?: string | null;
  discountExpiresAt?: string | null;
  promoCode?: string | null;
  promoType?: string | null;
  promoDiscountAmount?: number;
  requestedUsername?: string | null;
  startOnFirstUse?: boolean;
  rolloverEnabled?: boolean;
  rolloverPreview?: RolloverPreviewDto;
  availableBalance: number;
  expiresAt: string;
}

export interface UserConfirmCheckoutResponse {
  success: boolean;
  kind?: 'new_config' | 'renew_config';
  configUsername: string;
  subUrl?: string;
  startOnFirstUse?: boolean;
  availableBalanceAfter?: number;
}
