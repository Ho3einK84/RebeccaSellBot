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
  user?: {
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    balance?: number;
  } | null;
}

export interface ReceiptSettings {
  enabled: boolean;
  mode: 'full' | 'simple';
  admins: number[];
  allAdmins: number[];
}

export interface UserProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  totalSpend: number;
  activeSubscriptionCount: number;
  isBanned?: boolean;
  createdAt: string;
}

export interface UserConfigItem {
  id: string;
  panelId: string;
  panelName?: string;
  serviceId: number;
  configUsername: string;
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

export type UserFilterType = 'all' | 'active_subs' | 'has_balance' | 'banned';
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

export interface PanelServiceSummary {
  serviceId: number;
  name: string;
  isDefault: boolean;
  isCustomTarget?: boolean;
}

export interface PanelSummary {
  id: string;
  name: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  credentialMode: 'api_key' | 'password' | 'none';
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
}

export interface AdminTargetPanelDto {
  panelId: string;
  panelName: string;
  enabled: boolean;
  isDefault: boolean;
  defaultServiceId: number | null;
  services: AdminTargetServiceDto[];
}

export interface AdminPackagePoliciesDto {
  packageDisplayMode: 'specs' | 'name';
  lowTrafficThresholdGb: number;
  expiryWarningDays: number;
  refundWindowHours: number;
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
