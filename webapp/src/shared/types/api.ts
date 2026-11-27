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
  UserAuditLogItem,
  PanelSummary,
  FleetSummary,
  FleetCapacitySummary,
  BalanceOperation,
} from './admin.js';

export type SupportedLocale = 'fa' | 'en';

export type ReleaseChannel = 'stable' | 'dev' | 'prerelease';

export interface AppVersionInfo {
  name: string;
  version: string;
  displayVersion: string;
  fullVersion?: string;
  channel: ReleaseChannel;
  branch?: string | null;
  commit?: string | null;
  tag?: string | null;
  commitsAhead?: number | null;
  dirty?: boolean;
  builtAt?: string | null;
  repositoryUrl?: string;
}

export interface BotInfoResponse {
  username?: string;
  appVersion?: AppVersionInfo;
}

export interface AuthResponse {
  token?: string;
  role: 'admin' | 'user';
  user: TelegramWebAppUser;
  locale?: SupportedLocale;
  languageSelectionEnabled?: boolean;
  botUsername?: string;
  startParam?: string;
  appVersion?: AppVersionInfo;
}

export interface StatsResponse {
  stats: DashboardStats;
  panelHealth: PanelHealth;
  fleetCapacity?: FleetCapacitySummary | null;
  dbLatencyMs?: number;
  appVersion?: AppVersionInfo;
}

export interface ReceiptsResponse {
  items: TopupReceipt[];
  total: number;
  page: number;
  totalPages: number;
  pendingCount?: number;
}

export interface ReceiptActionPayload {
  action: 'approve' | 'reject' | 'void';
  reason?: string;
  disablePurchasedConfigs?: boolean;
}

export interface BatchReceiptActionPayload {
  ids: string[];
  action: 'approve';
}

export interface UsersResponse {
  users: UserProfile[];
  page: number;
  totalPages: number;
  total: number;
}

export interface UserDossierResponse {
  summary: UserReportSummary;
  isAdmin?: boolean;
  orders: UserOrder[];
  receipts: UserReceiptItem[];
  configs: UserConfigItem[];
  transactions: UserTransactionItem[];
  auditLogs?: UserAuditLogItem[];
}

export interface SendUserMessagePayload {
  message: string;
}

export interface SendUserMessageResponse {
  success: boolean;
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
  fleetSummary?: FleetSummary;
}

export interface CreatePanelPayload {
  name: string;
  baseUrl: string;
  apiKey?: string;
  serviceId?: number;
  serviceName?: string;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
}

export interface CreatePanelResponse {
  success: boolean;
  panel: PanelSummary;
}

export interface UpdatePanelPayload {
  name?: string;
  baseUrl?: string;
  apiKey?: string | null;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
}

export interface TogglePanelResponse {
  success: boolean;
  enabled: boolean;
}

export interface AddPanelServicePayload {
  serviceId: number;
  name: string;
  enabled?: boolean;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
}

export interface UpdatePanelServicePayload {
  name?: string;
  enabled?: boolean;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
}

export interface TestAllPanelsResponse {
  success: boolean;
  results: Record<string, { healthy: boolean; latencyMs?: number; error?: string }>;
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
