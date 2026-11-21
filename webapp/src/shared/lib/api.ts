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
import type {
  UserFilterType,
  UserSortType,
  ReceiptSettings,
  AdminPackagesResponse,
  CreateAdminPackagePayload,
  UpdateAdminPackagePayload,
  AdminPackageMutationResponse,
  AdminPackageReorderResponse,
  AdminPackageDeleteResponse,
  AdminPackagePoliciesDto,
  AdminCategoriesResponse,
  AdminCategoryDto,
  CreateAdminCategoryPayload,
  UpdateAdminCategoryPayload,
  AdminCategoryMutationResponse,
  AdminCategoryDeleteResponse,
  AdminCustomPricingResponse,
  CustomPricingSettingsDto,
  UpdateCustomPricingSettingsPayload,
  CreateVolumeTierPayload,
  UpdateVolumeTierPayload,
  VolumeTierMutationResponse,
  VolumePricingTierDto,
  CreatePriceOverridePayload,
  UpdatePriceOverridePayload,
  PriceOverrideMutationResponse,
  CustomPriceOverrideDto,
  AdminPricingQuoteResponse,
  AdminBankCardsResponse,
  CreateAdminBankCardPayload,
  UpdateAdminBankCardPayload,
  UpdateAdminBankCardSettingsPayload,
} from '@/shared/types/admin.js';
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
let refreshInFlight: Promise<void> | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  isRetry = false
): Promise<Response> {
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
    const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : undefined;
    if (initData) {
      try {
        if (!refreshInFlight) {
          refreshInFlight = api
            .validateTelegramAuth(initData)
            .then(() => undefined)
            .finally(() => {
              refreshInFlight = null;
            });
        }
        await refreshInFlight;
        return await fetchWithAuth(url, options, true);
      } catch {
        // Refresh failed, fall through to error handling
      }
    }
  }

  return response;
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
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
  return new ApiClientError(errorMessage, response.status, errorCode, errBody);
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuth(url, options);
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return response.json() as Promise<T>;
}

async function requestBlob(url: string, options: RequestInit = {}): Promise<Blob> {
  const response = await fetchWithAuth(url, options);
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return response.blob();
}

export const api = {
  setAuthToken,
  getAuthToken,

  getBotInfo: (): Promise<{ username?: string }> =>
    request<{ username?: string }>('/api/auth/bot-info'),

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

  fetchBlob: (url: string, options: RequestInit = {}): Promise<Blob> => requestBlob(url, options),

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
    request<{ success: boolean }>(`/api/admin/receipts/${encodeURIComponent(receiptId)}/action`, {
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

  // Admin Bank Cards API
  getAdminBankCards: (): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>('/api/admin/bank-cards'),

  createAdminBankCard: (payload: CreateAdminBankCardPayload): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>('/api/admin/bank-cards', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminBankCard: (
    id: string,
    payload: UpdateAdminBankCardPayload
  ): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>(`/api/admin/bank-cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  toggleAdminBankCard: (id: string, enabled?: boolean): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>(`/api/admin/bank-cards/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify(enabled === undefined ? {} : { enabled }),
    }),

  reorderAdminBankCards: (orderedIds: string[]): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>('/api/admin/bank-cards/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),

  importLegacyAdminBankCard: (): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>('/api/admin/bank-cards/import-legacy', {
      method: 'POST',
    }),

  updateAdminBankCardSettings: (
    payload: UpdateAdminBankCardSettingsPayload
  ): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>('/api/admin/bank-cards/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteAdminBankCard: (id: string): Promise<AdminBankCardsResponse> =>
    request<AdminBankCardsResponse>(`/api/admin/bank-cards/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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
    request<{ success: boolean }>(`/api/admin/panels/${encodeURIComponent(panelId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  toggleAdminPanel: (panelId: string, enabled: boolean): Promise<TogglePanelResponse> =>
    request<TogglePanelResponse>(`/api/admin/panels/${encodeURIComponent(panelId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  setDefaultAdminPanel: (panelId: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${encodeURIComponent(panelId)}/default`, {
      method: 'POST',
    }),

  deleteAdminPanel: (panelId: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/panels/${encodeURIComponent(panelId)}`, {
      method: 'DELETE',
    }),

  testAdminPanel: (panelId: string): Promise<TestPanelResponse> =>
    request<TestPanelResponse>(`/api/admin/panels/${encodeURIComponent(panelId)}/test`, {
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
    request<{ success: boolean }>(`/api/admin/panels/${encodeURIComponent(panelId)}/services`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setDefaultAdminPanelService: (
    panelId: string,
    serviceId: number
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/panels/${encodeURIComponent(panelId)}/services/${serviceId}/default`,
      {
        method: 'POST',
      }
    ),

  setCustomTargetAdminPanelService: (
    panelId: string,
    serviceId: number
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/panels/${encodeURIComponent(panelId)}/services/${serviceId}/custom-target`,
      {
        method: 'POST',
      }
    ),

  deleteAdminPanelService: (panelId: string, serviceId: number): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/panels/${encodeURIComponent(panelId)}/services/${serviceId}`,
      {
        method: 'DELETE',
      }
    ),

  // Admin Packages, Categories & Custom Pricing API
  getAdminPackages: (params?: {
    includeDisabled?: boolean;
    categoryId?: string;
    panelId?: string;
  }): Promise<AdminPackagesResponse> => {
    const search = new URLSearchParams();
    if (params?.includeDisabled !== undefined) {
      search.set('includeDisabled', String(params.includeDisabled));
    }
    if (params?.categoryId) {
      search.set('categoryId', params.categoryId);
    }
    if (params?.panelId) {
      search.set('panelId', params.panelId);
    }
    const qs = search.toString();
    return request<AdminPackagesResponse>(`/api/admin/packages${qs ? `?${qs}` : ''}`);
  },

  createAdminPackage: (payload: CreateAdminPackagePayload): Promise<AdminPackageMutationResponse> =>
    request<AdminPackageMutationResponse>('/api/admin/packages', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminPackage: (
    id: string,
    payload: UpdateAdminPackagePayload
  ): Promise<AdminPackageMutationResponse> =>
    request<AdminPackageMutationResponse>(`/api/admin/packages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  toggleAdminPackage: (id: string, enabled?: boolean): Promise<AdminPackageMutationResponse> =>
    request<AdminPackageMutationResponse>(`/api/admin/packages/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify(enabled === undefined ? {} : { enabled }),
    }),

  cloneAdminPackage: (id: string, name?: string): Promise<AdminPackageMutationResponse> =>
    request<AdminPackageMutationResponse>(`/api/admin/packages/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),

  reorderAdminPackages: (orderedIds: string[]): Promise<AdminPackageReorderResponse> =>
    request<AdminPackageReorderResponse>('/api/admin/packages/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),

  deleteAdminPackage: (id: string): Promise<AdminPackageDeleteResponse> =>
    request<AdminPackageDeleteResponse>(`/api/admin/packages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  updateAdminPackagePolicies: (
    payload: Partial<AdminPackagePoliciesDto>
  ): Promise<{ policies: AdminPackagePoliciesDto }> =>
    request<{ policies: AdminPackagePoliciesDto }>('/api/admin/packages/policies', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getAdminCategories: (includeDisabled = true): Promise<AdminCategoriesResponse> =>
    request<AdminCategoriesResponse>(
      `/api/admin/categories?includeDisabled=${String(includeDisabled)}`
    ),

  createAdminCategory: (
    payload: CreateAdminCategoryPayload
  ): Promise<AdminCategoryMutationResponse> =>
    request<AdminCategoryMutationResponse>('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminCategory: (
    id: string,
    payload: UpdateAdminCategoryPayload
  ): Promise<AdminCategoryMutationResponse> =>
    request<AdminCategoryMutationResponse>(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  toggleAdminCategory: (id: string, enabled?: boolean): Promise<AdminCategoryMutationResponse> =>
    request<AdminCategoryMutationResponse>(
      `/api/admin/categories/${encodeURIComponent(id)}/toggle`,
      {
        method: 'POST',
        body: JSON.stringify(enabled === undefined ? {} : { enabled }),
      }
    ),

  reorderAdminCategories: (orderedIds: string[]): Promise<{ categories: AdminCategoryDto[] }> =>
    request<{ categories: AdminCategoryDto[] }>('/api/admin/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),

  deleteAdminCategory: (id: string): Promise<AdminCategoryDeleteResponse> =>
    request<AdminCategoryDeleteResponse>(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminCustomPricing: (): Promise<AdminCustomPricingResponse> =>
    request<AdminCustomPricingResponse>('/api/admin/pricing/custom'),

  updateAdminCustomPricingSettings: (
    payload: UpdateCustomPricingSettingsPayload
  ): Promise<{ settings: CustomPricingSettingsDto }> =>
    request<{ settings: CustomPricingSettingsDto }>('/api/admin/pricing/custom/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  createAdminVolumeTier: (payload: CreateVolumeTierPayload): Promise<VolumeTierMutationResponse> =>
    request<VolumeTierMutationResponse>('/api/admin/pricing/custom/tiers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminVolumeTier: (
    id: string,
    payload: UpdateVolumeTierPayload
  ): Promise<VolumeTierMutationResponse> =>
    request<VolumeTierMutationResponse>(
      `/api/admin/pricing/custom/tiers/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteAdminVolumeTier: (
    id: string
  ): Promise<{ deletedId: string; tiers: VolumePricingTierDto[] }> =>
    request<{ deletedId: string; tiers: VolumePricingTierDto[] }>(
      `/api/admin/pricing/custom/tiers/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),

  createAdminPriceOverride: (
    payload: CreatePriceOverridePayload
  ): Promise<PriceOverrideMutationResponse> =>
    request<PriceOverrideMutationResponse>('/api/admin/pricing/custom/overrides', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reorderAdminPriceOverrides: (
    orderedIds: string[]
  ): Promise<{ overrides: CustomPriceOverrideDto[] }> =>
    request<{ overrides: CustomPriceOverrideDto[] }>(
      '/api/admin/pricing/custom/overrides/reorder',
      {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      }
    ),

  updateAdminPriceOverride: (
    id: string,
    payload: UpdatePriceOverridePayload
  ): Promise<PriceOverrideMutationResponse> =>
    request<PriceOverrideMutationResponse>(
      `/api/admin/pricing/custom/overrides/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteAdminPriceOverride: (
    id: string
  ): Promise<{ deletedId: string; overrides: CustomPriceOverrideDto[] }> =>
    request<{ deletedId: string; overrides: CustomPriceOverrideDto[] }>(
      `/api/admin/pricing/custom/overrides/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),

  simulateAdminCustomQuote: (
    gbAmount: number,
    durationDays: number
  ): Promise<AdminPricingQuoteResponse> =>
    request<AdminPricingQuoteResponse>('/api/admin/pricing/custom/quote', {
      method: 'POST',
      body: JSON.stringify({ gbAmount, durationDays }),
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
