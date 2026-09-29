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

export interface CustomVolumeSettings {
  enabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  defaultDays: number;
  minGb: number;
  maxGb: number;
}

export interface PendingReceiptInfo {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface CustomVolumeQuoteResponse {
  gbAmount: number;
  durationDays: number;
  totalPrice: number;
  pricePerGb: number;
  pricePerDay: number;
}

export interface UserPortalSettings {
  currency: string;
  cardNumber: string;
  cardHolder: string;
  supportUsername: string;
  supportEnabled: boolean;
  botUsername: string;
  topupMinAmount?: number;
  topupMaxAmount?: number;
  customVolume?: CustomVolumeSettings;
}

export interface UserProfileResponse {
  user: UserPortalProfile;
  settings: UserPortalSettings;
  pendingReceipt?: PendingReceiptInfo | null;
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

export interface CreateCheckoutPayload {
  packageId?: string;
  custom?: {
    gb: number;
    days: number;
  };
}

export interface UserCheckoutResponse {
  checkoutId: string;
  name: string;
  gb: number;
  days: number;
  price: number;
  quotedAmount: number;
  availableBalance: number;
  expiresAt: string;
}

export interface UserConfirmCheckoutResponse {
  success: boolean;
  configUsername: string;
  subUrl?: string;
}
