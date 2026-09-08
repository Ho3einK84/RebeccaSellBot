import type { TelegramWebAppUser } from './telegram.js';
import type {
  DashboardStats,
  PanelHealth,
  TopupReceipt,
  UserProfile,
  UserReportSummary,
  UserOrder,
  UserReceiptItem,
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
