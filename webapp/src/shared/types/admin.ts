export type TabType = 'overview' | 'receipts' | 'users' | 'panels' | 'coming-soon';

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
  photoFileId?: string;
  mediaType?: string;
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
}

export interface PanelServiceSummary {
  serviceId: number;
  name: string;
  isDefault: boolean;
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
  activeConfigsCount?: number;
  healthy?: boolean;
  latencyMs?: number;
}

export type BalanceOperation = 'add' | 'deduct' | 'set';
