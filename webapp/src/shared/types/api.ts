import type { TelegramWebAppUser } from './telegram.js';
import type {
  DashboardStats,
  PanelHealth,
  TopupReceipt,
  UserProfile,
  UserReportSummary,
  UserOrder,
  UserReceiptItem,
  UserConfigItem,
  UserTransactionItem,
  PanelSummary,
  BalanceOperation,
} from './admin.js';

export type SupportedLocale = 'fa' | 'en';

export interface AuthResponse {
  role: 'admin' | 'user';
  user: TelegramWebAppUser;
  locale?: SupportedLocale;
  languageSelectionEnabled?: boolean;
}

export interface StatsResponse {
  stats: DashboardStats;
  panelHealth: PanelHealth;
}

export interface ReceiptsResponse {
  items: TopupReceipt[];
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface ReceiptActionPayload {
  action: 'approve' | 'reject';
  reason?: string;
}

export interface UsersResponse {
  users: UserProfile[];
  page: number;
  totalPages: number;
  total: number;
}

export interface UserDossierResponse {
  summary: UserReportSummary;
  orders: UserOrder[];
  receipts: UserReceiptItem[];
  configs: UserConfigItem[];
  transactions: UserTransactionItem[];
}

export interface BanUserPayload {
  isBanned: boolean;
  reason?: string;
}

export interface BanUserResponse {
  success: boolean;
  isBanned: boolean;
}

export interface ToggleConfigResponse {
  success: boolean;
  status: 'enabled' | 'disabled';
}

export interface RevokeSubUrlResponse {
  success: boolean;
  subUrl?: string;
}

export interface AdjustBalancePayload {
  operation: BalanceOperation;
  amount: number;
  reason: string;
}

export interface AdjustBalanceResponse {
  balance: number;
}

export interface PanelsResponse {
  panels: PanelSummary[];
}

export interface TestPanelResponse {
  success: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ApiErrorResponse {
  error?: string;
  message?: string;
}
