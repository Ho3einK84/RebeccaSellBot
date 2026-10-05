import type {
  AuthResponse,
  StatsResponse,
  ReceiptsResponse,
  ReceiptActionPayload,
  UsersResponse,
  UserDossierResponse,
  AdjustBalancePayload,
  AdjustBalanceResponse,
  PanelsResponse,
  TestPanelResponse,
  CreatePanelPayload,
  CreatePanelResponse,
  UpdatePanelPayload,
  TogglePanelResponse,
  AddPanelServicePayload,
  TestAllPanelsResponse,
  SupportedLocale,
  ApiErrorResponse,
  BanUserPayload,
  BanUserResponse,
  ToggleConfigResponse,
  RevokeSubUrlResponse,
  BatchReceiptActionPayload,
} from '@/shared/types/api.js';
import type { UserFilterType, UserSortType, ReceiptSettings } from '@/shared/types/admin.js';
import type {
  UserProfileResponse,
  UserConfigsResponse,
  UserPackagesResponse,
  UserTransactionsResponse,
  CustomVolumeQuoteResponse,
  CreateCheckoutPayload,
  UserCheckoutResponse,
  UserConfirmCheckoutResponse,
  ToggleAutoRenewResponse,
  ToggleConfigStatusResponse,
  RevokeConfigResponse,
  RefreshConfigResponse,
} from '@/shared/types/userPortal.js';

export class ApiClientError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

async function request<T>(url: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Authorization') && inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const response = await fetch(url, {
    ...options,
    // Same-origin is the production topology (Fastify serves /api + static),
    // but the default must be explicit so the session cookie is also sent
    // through the vite dev proxy and any same-site deployment.
    credentials: options.credentials ?? 'same-origin',
    headers,
  });

  if (response.status === 401 && !isRetry && !url.includes('/api/auth/')) {
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      try {
        await api.validateTelegramAuth(initData);
        return await request<T>(url, options, true);
      } catch {
        // Refresh failed, fall through to error handling
      }
    }
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorCode: string | undefined;
    let errBody: unknown;
    try {
      errBody = await response.json();
      const errData = errBody as ApiErrorResponse & { code?: string };
      if (errData.error || errData.message) {
        errorMessage = errData.error || errData.message || errorMessage;
      }
      if (errData.code) {
        errorCode = errData.code;
      }
    } catch {
      // Body was not JSON
    }
    throw new ApiClientError(errorMessage, response.status, errorCode, errBody);
  }

  return response.json() as Promise<T>;
}

export const api = {
  setAuthToken,
  getAuthToken,

  validateTelegramAuth: async (initData: string): Promise<AuthResponse> => {
    const res = await request<AuthResponse>('/api/auth/telegram-validate', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
    if (res.token) {
      inMemoryToken = res.token;
    }
    return res;
  },

  updateUserLocale: async (locale: SupportedLocale): Promise<boolean> => {
    try {
      await request('/api/user/locale', {
        method: 'POST',
        body: JSON.stringify({ locale }),
      });
      return true;
    } catch {
      return false;
    }
  },

  getAdminStats: (): Promise<StatsResponse> => request<StatsResponse>('/api/admin/stats'),

  getAdminReceipts: (
    params: {
      page?: number;
      limit?: number;
      status?: 'pending' | 'approved' | 'rejected' | 'all';
      search?: string;
    } = {}
  ): Promise<ReceiptsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return request<ReceiptsResponse>(`/api/admin/receipts${qs ? `?${qs}` : ''}`);
  },

  performReceiptAction: (
    receiptId: string,
    payload: ReceiptActionPayload
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/receipts/${receiptId}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  performBatchReceiptAction: (
    payload: BatchReceiptActionPayload
  ): Promise<{ success: boolean; approvedCount: number }> =>
    request<{ success: boolean; approvedCount: number }>('/api/admin/receipts/batch-action', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReceiptSettings: (): Promise<ReceiptSettings> =>
    request<ReceiptSettings>('/api/admin/receipts/settings'),

  updateReceiptSettings: (payload: {
    enabled?: boolean;
    mode?: 'full' | 'simple';
    admins?: number[];
  }): Promise<{ success: boolean }> =>
    request<{ success: boolean }>('/api/admin/receipts/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getAdminUsers: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      filter?: UserFilterType;
      sort?: UserSortType;
    } = {}
  ): Promise<UsersResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.search?.trim()) searchParams.set('search', params.search.trim());
    if (params.filter && params.filter !== 'all') searchParams.set('filter', params.filter);
    if (params.sort && params.sort !== 'newest') searchParams.set('sort', params.sort);
    const qs = searchParams.toString();
    return request<UsersResponse>(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  getAdminUserDossier: (telegramId: number): Promise<UserDossierResponse> =>
    request<UserDossierResponse>(`/api/admin/users/${telegramId}`),

  adjustUserBalance: (
    telegramId: number,
    payload: AdjustBalancePayload
  ): Promise<AdjustBalanceResponse> =>
    request<AdjustBalanceResponse>(`/api/admin/users/${telegramId}/balance`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  banUser: (telegramId: number, payload: BanUserPayload): Promise<BanUserResponse> =>
    request<BanUserResponse>(`/api/admin/users/${telegramId}/ban`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleUserConfig: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ): Promise<ToggleConfigResponse> =>
    request<ToggleConfigResponse>(
      `/api/admin/users/${telegramId}/configs/${encodeURIComponent(configUsername)}/toggle`,
      {
        method: 'POST',
        body: JSON.stringify({ panelId }),
      }
    ),

  resetUserConfigUsage: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/users/${telegramId}/configs/${encodeURIComponent(configUsername)}/reset-usage`,
      {
        method: 'POST',
        body: JSON.stringify({ panelId }),
      }
    ),

  revokeUserConfigSubUrl: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ): Promise<RevokeSubUrlResponse> =>
    request<RevokeSubUrlResponse>(
      `/api/admin/users/${telegramId}/configs/${encodeURIComponent(configUsername)}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({ panelId }),
      }
    ),

  syncUserConfig: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ): Promise<{ success: boolean; detail?: unknown }> =>
    request<{ success: boolean; detail?: unknown }>(
      `/api/admin/users/${telegramId}/configs/${encodeURIComponent(configUsername)}/sync`,
      {
        method: 'POST',
        body: JSON.stringify({ panelId }),
      }
    ),

  getAdminPanels: (): Promise<PanelsResponse> => request<PanelsResponse>('/api/admin/panels'),

  createAdminPanel: (payload: CreatePanelPayload): Promise<CreatePanelResponse> =>
    request<CreatePanelResponse>('/api/admin/panels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminPanel: (panelId: string, payload: UpdatePanelPayload): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  toggleAdminPanel: (panelId: string, enabled: boolean): Promise<TogglePanelResponse> =>
    request<TogglePanelResponse>(`/api/admin/panels/${panelId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  setDefaultAdminPanel: (panelId: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}/default`, {
      method: 'POST',
    }),

  deleteAdminPanel: (panelId: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}`, {
      method: 'DELETE',
    }),

  testAdminPanel: (panelId: string): Promise<TestPanelResponse> =>
    request<TestPanelResponse>(`/api/admin/panels/${panelId}/test`, {
      method: 'POST',
    }),

  testAllAdminPanels: (): Promise<TestAllPanelsResponse> =>
    request<TestAllPanelsResponse>('/api/admin/panels/test-all', {
      method: 'POST',
    }),

  addAdminPanelService: (
    panelId: string,
    payload: AddPanelServicePayload
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}/services`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setDefaultAdminPanelService: (
    panelId: string,
    serviceId: number
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}/services/${serviceId}/default`, {
      method: 'POST',
    }),

  setCustomTargetAdminPanelService: (
    panelId: string,
    serviceId: number
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/panels/${panelId}/services/${serviceId}/custom-target`,
      {
        method: 'POST',
      }
    ),

  deleteAdminPanelService: (panelId: string, serviceId: number): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${panelId}/services/${serviceId}`, {
      method: 'DELETE',
    }),

  // User Portal API
  getUserProfile: (): Promise<UserProfileResponse> =>
    request<UserProfileResponse>('/api/user/profile'),

  getUserConfigs: (): Promise<UserConfigsResponse> =>
    request<UserConfigsResponse>('/api/user/configs'),

  getUserPackages: (): Promise<UserPackagesResponse> =>
    request<UserPackagesResponse>('/api/user/packages'),

  getUserTransactions: (page = 1, limit = 10): Promise<UserTransactionsResponse> =>
    request<UserTransactionsResponse>(`/api/user/transactions?page=${page}&limit=${limit}`),

  getUserQuote: (gb: number, days: number): Promise<CustomVolumeQuoteResponse> =>
    request<CustomVolumeQuoteResponse>(`/api/user/quote?gb=${gb}&days=${days}`),

  createCheckout: (payload: CreateCheckoutPayload): Promise<UserCheckoutResponse> =>
    request<UserCheckoutResponse>('/api/user/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  confirmCheckout: (checkoutId: string): Promise<UserConfirmCheckoutResponse> =>
    request<UserConfirmCheckoutResponse>(
      `/api/user/checkout/${encodeURIComponent(checkoutId)}/confirm`,
      {
        method: 'POST',
      }
    ),

  toggleAutoRenew: (
    configId: string,
    enabled: boolean,
    packageId?: string,
    price?: number
  ): Promise<ToggleAutoRenewResponse> =>
    request<ToggleAutoRenewResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/auto-renew`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled, packageId, price }),
      }
    ),

  toggleConfigStatus: (
    configId: string,
    status?: 'active' | 'disabled'
  ): Promise<ToggleConfigStatusResponse> =>
    request<ToggleConfigStatusResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/toggle-status`,
      {
        method: 'POST',
        body: JSON.stringify({ status }),
      }
    ),

  revokeConfigLink: (configId: string): Promise<RevokeConfigResponse> =>
    request<RevokeConfigResponse>(`/api/user/configs/${encodeURIComponent(configId)}/revoke`, {
      method: 'POST',
    }),

  refreshConfigStats: (configId: string): Promise<RefreshConfigResponse> =>
    request<RefreshConfigResponse>(`/api/user/configs/${encodeURIComponent(configId)}/refresh`, {
      method: 'POST',
    }),
};
