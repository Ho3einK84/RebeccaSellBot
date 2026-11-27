export type TabType = 'overview' | 'receipts' | 'users' | 'panels' | 'packages' | 'coming-soon';

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

export interface PanelHealth {
  configured: number;
  healthy: number;
  allHealthy?: boolean;
  latencyMs?: number;
}

export interface TopupReceipt {
  id: string;
  telegramId: number;
  amount: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  photoFileId?: string;
  mediaType?: string;
  reviewedBy?: number | null;
  rejectReason?: string | null;
  duplicateOfReceiptId?: string | null;
  duplicateWarning?: string | null;
  voidedAt?: string | null;
  voidedBy?: number | null;
  voidReason?: string | null;
  cardId?: string | null;
  cardNumber?: string | null;
  cardSummary?: string | null;
  user?: {
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    balance?: number;
  } | null;
}

export interface ReceiptAdminProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ReceiptSettings {
  enabled: boolean;
  mode: 'full' | 'simple';
  duplicatePolicy?: 'warn' | 'block';
  admins: number[];
  allAdmins: number[];
  adminProfiles?: ReceiptAdminProfile[];
}

export interface AdminUserGroupBadge {
  id: string;
  name: string;
  badge: string | null;
  isDefault: boolean;
  isAssigned: boolean;
  expiresAt: string | null;
  discountPercent: number;
  applyDiscountToCustomVolume?: boolean;
  creditLimit: number;
}

export interface UserProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  reservedBalance?: number;
  creditLimit?: number;
  group?: AdminUserGroupBadge | null;
  totalSpend: number;
  activeSubscriptionCount: number;
  isBanned?: boolean;
  isAdmin?: boolean;
  hasUsedTrial?: boolean;
  referralCode?: string | null;
  referredUserCount?: number;
  referralBonusEarned?: number;
  cashbackEarned?: number;
  createdAt: string;
}

export interface UserAuditLogItem {
  id: string;
  actorTelegramId: number;
  action: string;
  entityType: string;
  entityId: string;
  targetTelegramId?: number | null;
  metadata?: string | null;
  createdAt: string;
}

export interface UserConfigItem {
  id: string;
  panelId: string;
  panelName?: string;
  serviceId: number;
  configUsername: string;
  userLabel?: string | null;
  subUrl: string | null;
  panelStatus: string | null;
  panelDataLimit: number | null;
  panelUsedTraffic: number | null;
  panelExpire: number | null;
  panelOnHoldExpireDuration?: number | null;
  autoRenewEnabled: boolean;
  isClaimed: boolean;
  createdAt: string;
}

export interface UserTransactionItem {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  description: string;
  referenceId?: string | null;
  createdAt: string;
}

export type UserFilterType = 'all' | 'active_subs' | 'has_balance' | 'negative_balance' | 'banned';
export type UserSortType = 'newest' | 'balance_desc' | 'subs_desc' | 'spend_desc';

export interface UserReportSummary {
  user: UserProfile;
  totalDeposit: number;
  totalSpend: number;
  totalRefund: number;
  totalCashback: number;
  totalReferralBonus: number;
  totalLuckyWheel: number;
  totalTransactions: number;
  activeConfigsCount: number;
  totalConfigsCount: number;
  totalOrdersCount: number;
  receiptsApprovedCount: number;
  receiptsRejectedCount: number;
  receiptsPendingCount: number;
  totalReceiptsCount: number;
  auditEventsCount: number;
}

export interface UserOrder {
  id: string;
  packageName?: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface UserReceiptItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  photoFileId?: string | null;
  mediaType?: string | null;
  reviewedBy?: number | null;
}

export type InventoryUnavailableReason =
  | 'panel_disabled'
  | 'service_disabled'
  | 'panel_capacity_full'
  | 'service_capacity_full'
  | 'panel_out_of_stock'
  | 'service_out_of_stock'
  | 'panel_daily_limit_reached'
  | 'service_daily_limit_reached'
  | 'package_out_of_stock'
  | 'package_user_limit_reached'
  | 'trial_out_of_stock'
  | 'trial_daily_limit_reached'
  | 'custom_volume_out_of_stock'
  | 'custom_volume_daily_limit_reached';

export interface FleetCapacitySummary {
  totalPanels: number;
  fullPanelsCount: number;
  lowCapacityPanelsCount: number;
  pausedServicesCount: number;
  fullServicesCount: number;
}

export interface PanelServiceSummary {
  serviceId: number;
  name: string;
  enabled?: boolean;
  isDefault: boolean;
  isCustomTarget?: boolean;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
  activeConfigsCount?: number;
  reservedCount?: number;
  todayCreatedCount?: number;
  remainingCapacity?: number | null;
  utilizationPercent?: number | null;
  isAvailableForCreate?: boolean;
  unavailableReason?: InventoryUnavailableReason | null;
}

export interface PanelSummary {
  id: string;
  name: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  credentialMode: 'api_key' | 'password' | 'none';
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
  reservedCount?: number;
  todayCreatedCount?: number;
  remainingCapacity?: number | null;
  utilizationPercent?: number | null;
  isAvailableForCreate?: boolean;
  unavailableReason?: InventoryUnavailableReason | null;
  services: PanelServiceSummary[];
  packagesCount?: number;
  activeConfigsCount?: number;
  healthy?: boolean;
  latencyMs?: number;
}

export interface FleetSummary {
  totalPanels: number;
  healthyPanels: number;
  disabledPanels: number;
  unhealthyPanels: number;
  totalActiveConfigs: number;
  totalServices: number;
  allHealthy: boolean;
  fullPanelsCount?: number;
  lowCapacityPanelsCount?: number;
  pausedServicesCount?: number;
  fullServicesCount?: number;
}

export type BalanceOperation = 'add' | 'deduct' | 'set';

export interface AdminPackageDto {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number;
  enabled: boolean;
  panelId?: string;
  serviceId?: number;
  categoryId?: string;
  startOnFirstUse?: boolean;
  rolloverQuota?: boolean;
  stockRemaining?: number | null;
  reservedCount?: number;
  soldCount?: number;
  maxPurchasesPerUser?: number | null;
  effectiveRemaining?: number | null;
  isOutOfStock?: boolean;
  outOfStockReason?: InventoryUnavailableReason | null;
}

export interface AdminCategoryDto {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  enabled: boolean;
  linkedPackagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTargetServiceDto {
  serviceId: number;
  name: string;
  isDefault: boolean;
  enabled?: boolean;
  isAvailableForCreate?: boolean;
  remainingCapacity?: number | null;
  unavailableReason?: InventoryUnavailableReason | null;
}

export interface AdminTargetPanelDto {
  panelId: string;
  panelName: string;
  enabled: boolean;
  isDefault: boolean;
  defaultServiceId: number | null;
  isAvailableForCreate?: boolean;
  remainingCapacity?: number | null;
  unavailableReason?: InventoryUnavailableReason | null;
  services: AdminTargetServiceDto[];
}

export interface AdminPackagePoliciesDto {
  packageDisplayMode: 'specs' | 'name';
  lowTrafficThresholdGb: number;
  expiryWarningDays: number;
  refundWindowHours: number;
  showOutOfStockPackages?: boolean;
  lowStockThreshold?: number;
}

export interface AdminPackagesBoundsDto {
  maxPackages: number;
  maxNameLength: number;
  maxGbAmount: number;
  maxDurationDays: number;
  maxPrice: number;
  maxLowTrafficThresholdGb: number;
  maxExpiryWarningDays: number;
  maxRefundWindowHours: number;
  maxLowStockThreshold?: number;
  maxStockRemaining?: number;
}

export interface AdminPackagesResponse {
  packages: AdminPackageDto[];
  totalPackages: number;
  isFallbackActive: boolean;
  categories: AdminCategoryDto[];
  policies: AdminPackagePoliciesDto;
  targets: AdminTargetPanelDto[];
  bounds: AdminPackagesBoundsDto;
}

export interface CreateAdminPackagePayload {
  id?: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number;
  enabled?: boolean;
  panelId?: string | null;
  serviceId?: number | null;
  categoryId?: string | null;
  startOnFirstUse?: boolean;
  rolloverQuota?: boolean;
  stockRemaining?: number | null;
  maxPurchasesPerUser?: number | null;
}

export interface UpdateAdminPackagePayload {
  name?: string;
  gbAmount?: number;
  durationDays?: number;
  price?: number;
  enabled?: boolean;
  panelId?: string | null;
  serviceId?: number | null;
  categoryId?: string | null;
  startOnFirstUse?: boolean | null;
  rolloverQuota?: boolean | null;
  stockRemaining?: number | null;
  maxPurchasesPerUser?: number | null;
}

export interface AdminPackageMutationResponse {
  package: AdminPackageDto;
  packages: AdminPackageDto[];
}

export interface AdminPackageReorderResponse {
  packages: AdminPackageDto[];
}

export interface AdminPackageDeleteResponse {
  deletedId: string;
  packages: AdminPackageDto[];
}

export interface AdminCategoriesBoundsDto {
  maxNameLength: number;
  maxDescriptionLength: number;
  maxIconLength: number;
}

export interface AdminCategoriesResponse {
  categories: AdminCategoryDto[];
  uncategorizedPackagesCount: number;
  bounds: AdminCategoriesBoundsDto;
}

export interface CreateAdminCategoryPayload {
  id?: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  displayOrder?: number;
  enabled?: boolean;
}

export interface UpdateAdminCategoryPayload {
  name?: string;
  description?: string | null;
  icon?: string | null;
  displayOrder?: number;
  enabled?: boolean;
}

export interface AdminCategoryMutationResponse {
  category: AdminCategoryDto;
  categories: AdminCategoryDto[];
}

export interface AdminCategoryDeleteResponse {
  deletedId: string;
  unlinkedPackagesCount: number;
  categories: AdminCategoryDto[];
}

export interface CustomPricingTargetDto {
  panelId: string;
  serviceId: number;
}

export interface CustomPricingSettingsDto {
  enabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  minGb: number;
  maxGb: number;
  defaultDays: number;
  target: CustomPricingTargetDto | null;
  warnings: string[];
  stockRemaining?: number | null;
  reservedCount?: number;
  soldCount?: number;
  dailyCreateLimit?: number;
  todayCreatedCount?: number;
  available?: boolean;
  effectiveRemaining?: number | null;
  unavailableReason?: InventoryUnavailableReason | null;
}

export interface VolumePricingTierDto {
  id: string;
  minGb: number;
  maxGb?: number | null;
  pricePerGb?: number | null;
  discountPercent?: number | null;
}

export interface CustomPriceOverrideDto {
  id: string;
  minGb?: number | null;
  maxGb?: number | null;
  minDays?: number | null;
  maxDays?: number | null;
  price?: number | null;
  pricePerGb?: number | null;
  pricePerDay?: number | null;
}

export interface CustomPricingBoundsDto {
  minGbLimit: number;
  maxGbLimit: number;
  minDaysLimit: number;
  maxDaysLimit: number;
  webMaxDaysLimit: number;
  maxRules: number;
  maxPrice: number;
}

export interface AdminCustomPricingResponse {
  settings: CustomPricingSettingsDto;
  tiers: VolumePricingTierDto[];
  overrides: CustomPriceOverrideDto[];
  targets: AdminTargetPanelDto[];
  bounds: CustomPricingBoundsDto;
}

export interface UpdateCustomPricingSettingsPayload {
  enabled?: boolean;
  pricePerGb?: number;
  pricePerDay?: number;
  minGb?: number;
  maxGb?: number;
  defaultDays?: number;
  target?: CustomPricingTargetDto | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
}

export interface CreateVolumeTierPayload {
  id?: string;
  minGb: number;
  maxGb?: number | null;
  pricePerGb?: number | null;
  discountPercent?: number | null;
}

export interface UpdateVolumeTierPayload {
  minGb?: number;
  maxGb?: number | null;
  pricePerGb?: number | null;
  discountPercent?: number | null;
}

export interface VolumeTierMutationResponse {
  tier: VolumePricingTierDto;
  tiers: VolumePricingTierDto[];
}

export interface CreatePriceOverridePayload {
  id?: string;
  minGb?: number | null;
  maxGb?: number | null;
  minDays?: number | null;
  maxDays?: number | null;
  price?: number | null;
  pricePerGb?: number | null;
  pricePerDay?: number | null;
}

export interface UpdatePriceOverridePayload {
  minGb?: number | null;
  maxGb?: number | null;
  minDays?: number | null;
  maxDays?: number | null;
  price?: number | null;
  pricePerGb?: number | null;
  pricePerDay?: number | null;
}

export interface PriceOverrideMutationResponse {
  override: CustomPriceOverrideDto;
  overrides: CustomPriceOverrideDto[];
}

export interface AdminPricingQuoteResultDto {
  totalPrice: number;
  volumePrice: number;
  durationPrice: number;
  pricePerGb: number;
  pricePerDay: number;
  tierId?: string;
  overrideId?: string;
}

export interface AdminPricingQuoteResponse {
  quote: AdminPricingQuoteResultDto;
  gbAmount: number;
  durationDays: number;
  warnings: string[];
}

export interface AdminBankCardDto {
  id: string;
  cardNumber: string;
  cardHolder: string;
  enabled: boolean;
  dailyCapToman: number | null;
  bankName?: string;
  dailyUsageToman: number;
  remainingCapToman: number | null;
  isCapReached: boolean;
  detectedBankName?: string;
  luhnValid: boolean;
}

export interface AdminLegacyBankCardDto {
  id: string;
  cardNumber: string;
  cardHolder: string;
  enabled: boolean;
  dailyCapToman: number | null;
  bankName?: string;
}

export interface AdminBankCardsResponse {
  cards: AdminBankCardDto[];
  legacyCard: AdminLegacyBankCardDto | null;
  activeCount: number;
  rotationActive: boolean;
  uniqueTopupAmountEnabled: boolean;
  bounds: { maxCards: number };
}

export interface CreateAdminBankCardPayload {
  cardNumber: string;
  cardHolder: string;
  bankName?: string | null;
  dailyCapToman?: number | null;
  enabled?: boolean;
}

export interface UpdateAdminBankCardPayload {
  cardNumber?: string;
  cardHolder?: string;
  bankName?: string | null;
  dailyCapToman?: number | null;
  enabled?: boolean;
}

export interface UpdateAdminBankCardSettingsPayload {
  uniqueTopupAmountEnabled?: boolean;
  cardNumber?: string;
  cardHolder?: string;
}

export interface AdminForAppConfigDto {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
  orderExpiryMinutes: number;
  webhookUrl: string | null;
  unmatchedCount: number;
}

export interface AdminNowPaymentsConfigDto {
  enabled: boolean;
  sandbox: boolean;
  apiKeyConfigured: boolean;
  ipnSecretConfigured: boolean;
  rateMode: 'manual' | 'auto';
  manualUsdRateToman: number;
  effectiveUsdRateToman: number;
  effectiveRateSource: 'auto' | 'manual' | 'fallback';
  minAmountToman: number;
  maxAmountToman: number;
  cashbackPercent: number;
  orderExpiryMinutes: number;
  webhookUrl: string | null;
}

export interface AdminPaymentGatewaysResponse {
  forapp: AdminForAppConfigDto;
  nowpayments: AdminNowPaymentsConfigDto;
}

export interface UpdateAdminForAppPayload {
  enabled?: boolean;
  orderExpiryMinutes?: number;
}

export interface AdminRotateForAppKeyResponse {
  success: boolean;
  apiKey: string;
  apiKeyMasked: string;
  webhookUrl: string | null;
  forapp: AdminForAppConfigDto;
}

export interface AdminForAppDepositDto {
  id: string;
  idempotencyKey: string;
  forappMessageId: string | null;
  amountRial: number;
  amountToman: number | null;
  unit: string;
  isDeposit: boolean | null;
  bank: string | null;
  sender: string | null;
  code: string | null;
  rawBody: string | null;
  device: string | null;
  receivedAt: string | null;
  status: 'matched' | 'unmatched' | 'ignored' | 'manual_matched' | 'dismissed' | string;
  matchedOrderId: string | null;
  matchedTelegramId: number | null;
  matchedByAdminId: number | null;
  walletTransactionId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminForAppDepositsResponse {
  items: AdminForAppDepositDto[];
  total: number;
  unmatchedCount: number;
  page: number;
  totalPages: number;
}

export interface UpdateAdminNowPaymentsPayload {
  enabled?: boolean;
  sandbox?: boolean;
  apiKey?: string | null;
  ipnSecret?: string | null;
  rateMode?: 'manual' | 'auto';
  manualUsdRateToman?: number;
  minAmountToman?: number;
  maxAmountToman?: number;
  cashbackPercent?: number;
  orderExpiryMinutes?: number;
}

export interface TestNowPaymentsResponse {
  ok: boolean;
  message: string;
  sandbox: boolean;
  rateToman: number;
  rateSource: 'auto' | 'manual' | 'fallback';
}

export type AdminForcedJoinScope = 'off' | 'all' | 'trial_only' | 'purchase_and_trial';

export interface AdminForcedJoinChannelDto {
  id: string;
  channelId: string;
  title: string;
  inviteLink: string;
  enabled: boolean;
}

export interface AdminForcedJoinConfigResponse {
  scope: AdminForcedJoinScope;
  channels: AdminForcedJoinChannelDto[];
  activeCount: number;
  maxChannels: number;
  scopes?: AdminForcedJoinScope[];
}

export interface AdminForcedJoinTestResponse {
  ok: boolean;
  isAdmin: boolean;
  channelId: string;
  status?: string;
  chatTitle?: string;
  inviteLink?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CreateAdminForcedJoinChannelPayload {
  channelId: string;
  title: string;
  inviteLink?: string | null;
  enabled?: boolean;
}

export interface UpdateAdminForcedJoinChannelPayload {
  channelId?: string;
  title?: string;
  inviteLink?: string | null;
  enabled?: boolean;
}

export type BulkGiftTargetStatusDto = 'active' | 'on_hold' | 'limited';

export type BulkGiftJobStatusDto =
  'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'completed';

export interface AdminBulkGiftJobDto {
  id: string;
  actorTelegramId: number;
  giftGb: number;
  giftDays: number;
  targetStatuses: BulkGiftTargetStatusDto[];
  panelId: string | null;
  serviceId: number | null;
  notifyMessage: string | null;
  status: BulkGiftJobStatusDto;
  totalCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface AdminBulkGiftPanelDto {
  id: string;
  name: string;
  enabled: boolean;
  services: Array<{
    serviceId: number;
    name: string;
    isDefault: boolean;
  }>;
}

export interface AdminBulkGiftJobsResponse {
  items: AdminBulkGiftJobDto[];
  total: number;
  page: number;
  totalPages: number;
  activeCount: number;
  panels: AdminBulkGiftPanelDto[];
  limits: {
    maxGb: number;
    maxDays: number;
    maxMessageLength: number;
  };
}

export interface BulkGiftPreviewPayload {
  targetStatuses: BulkGiftTargetStatusDto[];
  panelId?: string | null;
  serviceId?: number | null;
}

export interface BulkGiftPreviewResponse {
  configCount: number;
  userCount: number;
}

export interface CreateBulkGiftJobPayload extends BulkGiftPreviewPayload {
  giftGb: number;
  giftDays: number;
  notifyMessage?: string | null;
}

export interface AdminUserGroupDto {
  id: string;
  name: string;
  badge: string | null;
  isDefault: boolean;
  discountPercent: number;
  applyDiscountToCustomVolume: boolean;
  customPricePerGb: number | null;
  customPricePerDay: number | null;
  allowCatalogDiscounts: boolean;
  allowPromoCodes: boolean;
  allowCashback: boolean;
  allowLuckyWheel: boolean;
  allowCustomServiceName: boolean;
  creditLimit: number;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUserGroupsResponse {
  groups: AdminUserGroupDto[];
}

export interface CreateAdminUserGroupPayload {
  name: string;
  badge?: string | null;
  isDefault?: boolean;
  discountPercent?: number;
  applyDiscountToCustomVolume?: boolean;
  customPricePerGb?: number | null;
  customPricePerDay?: number | null;
  allowCatalogDiscounts?: boolean;
  allowPromoCodes?: boolean;
  allowCashback?: boolean;
  allowLuckyWheel?: boolean;
  allowCustomServiceName?: boolean;
  creditLimit?: number;
}

export type UpdateAdminUserGroupPayload = Partial<CreateAdminUserGroupPayload>;

export interface AssignUserGroupPayload {
  groupId: string | null;
  durationDays?: number | null;
  expiresAt?: string | null;
}

export interface DeleteAdminUserGroupResponse {
  success: boolean;
  deleted: boolean;
  transferredCount: number;
  targetGroupId: string | null;
}
