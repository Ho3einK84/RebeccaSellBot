export type UserTabType = 'dashboard' | 'services' | 'shop' | 'wallet' | 'referral';

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
  referralBonusEarned: number;
  cashbackEarned: number;
  hasUsedTrial: boolean;
  createdAt: string;
}

export interface UserPortalSettings {
  currency: string;
  cardNumber: string;
  cardHolder: string;
  supportUsername: string;
  supportEnabled: boolean;
  botUsername: string;
}

export interface UserProfileResponse {
  user: UserPortalProfile;
  settings: UserPortalSettings;
}

export interface UserConfigRecord {
  id: string;
  configUsername: string;
  subUrl: string | null;
  panelStatus: string | null;
  panelDataLimit: number | null;
  panelUsedTraffic: number | null;
  panelExpire: number | null;
  autoRenewEnabled: boolean;
  createdAt: string;
}

export interface UserConfigsResponse {
  configs: UserConfigRecord[];
}

export interface UserPackageItem {
  id: string;
  name: string;
  gbAmount: number;
  durationDays: number;
  price: number;
}

export interface UserPackagesResponse {
  packages: UserPackageItem[];
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
}
