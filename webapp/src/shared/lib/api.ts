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
  SendUserMessagePayload,
  SendUserMessageResponse,
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
  AdminPaymentGatewaysResponse,
  AdminForAppConfigDto,
  AdminNowPaymentsConfigDto,
  UpdateAdminForAppPayload,
  AdminRotateForAppKeyResponse,
  AdminForAppDepositsResponse,
  UpdateAdminNowPaymentsPayload,
  TestNowPaymentsResponse,
  AdminForcedJoinScope,
  AdminForcedJoinConfigResponse,
  AdminForcedJoinTestResponse,
  CreateAdminForcedJoinChannelPayload,
  UpdateAdminForcedJoinChannelPayload,
  AdminBulkGiftJobsResponse,
  AdminBulkGiftJobDto,
  BulkGiftPreviewPayload,
  BulkGiftPreviewResponse,
  CreateBulkGiftJobPayload,
} from '@/shared/types/admin.js';
import type {
  UserProfileResponse,
  ForcedJoinCheckResponse,
  UserConfigsResponse,
  UserPackagesResponse,
  UserTransactionsResponse,
  TransactionFilterType,
  UserReceiptsResponse,
  PrepareTopupResponse,
  SubmitTopupReceiptResponse,
  CreateForAppOrderResponse,
  CreateNowPaymentsOrderResponse,
  CheckPaymentOrderStatusResponse,
  CancelPaymentOrderResponse,
  WalletTransferPreviewResponse,
  WalletTransferResponse,
  CustomVolumeQuoteResponse,
  CreateCheckoutPayload,
  UserCheckoutResponse,
  UserConfirmCheckoutResponse,
  ToggleAutoRenewResponse,
  ToggleConfigStatusResponse,
  RevokeConfigResponse,
  RefreshConfigResponse,
  SyncAllConfigsResponse,
  ClaimSubLinkResponse,
  UserConfigUsageResponse,
  ConfigRefundQuoteResponse,
  ConfigDeleteResponse,
  ConfigTransferPreviewResponse,
  ConfigTransferResponse,
  UserRenewalOptionsResponse,
  PromoQuoteResponse,
  PromoRedeemResponse,
  UserTrialStatus,
  TrialClaimResponse,
  LuckyWheelStatusResponse,
  LuckyWheelSpinResponse,
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
  const data = (await response.json()) as T;
  // HTTP 202 with pending-outcome code (e.g. PURCHASE_OUTCOME_PENDING / REFUND_OUTCOME_PENDING)
  // has response.ok === true; surface it as ApiClientError(202) so callers transition cleanly
  // to the verification/reconciliation state instead of hanging in processing.
  if (
    response.status === 202 &&
    data &&
    typeof data === 'object' &&
    (data as { success?: unknown }).success !== true
  ) {
    const body = data as { error?: string; message?: string; code?: string };
    throw new ApiClientError(
      body.error || body.message || 'Operation pending verification',
      202,
      body.code,
      data
    );
  }
  return data;
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

  getAdminStats: (options?: { refresh?: boolean }): Promise<StatsResponse> =>
    request<StatsResponse>(options?.refresh ? '/api/admin/stats?refresh=1' : '/api/admin/stats'),

  getAdminReceipts: (
    params: {
      page?: number;
      limit?: number;
      status?: 'pending' | 'approved' | 'rejected' | 'voided' | 'all';
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
  ): Promise<{ success: boolean; result?: unknown }> =>
    request<{ success: boolean; result?: unknown }>(
      `/api/admin/receipts/${encodeURIComponent(receiptId)}/action`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

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
    duplicatePolicy?: 'warn' | 'block';
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

  // Admin Automated Payment Gateways (ForApp & NOWPayments)
  getAdminPaymentGateways: (): Promise<AdminPaymentGatewaysResponse> =>
    request<AdminPaymentGatewaysResponse>('/api/admin/payment-gateways'),

  updateAdminForAppConfig: (
    payload: UpdateAdminForAppPayload
  ): Promise<{ success: boolean; forapp: AdminForAppConfigDto }> =>
    request<{ success: boolean; forapp: AdminForAppConfigDto }>(
      '/api/admin/payment-gateways/forapp',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  rotateAdminForAppKey: (): Promise<AdminRotateForAppKeyResponse> =>
    request<AdminRotateForAppKeyResponse>('/api/admin/payment-gateways/forapp/rotate-key', {
      method: 'POST',
    }),

  getAdminForAppDeposits: (
    params: { page?: number; limit?: number; status?: string } = {}
  ): Promise<AdminForAppDepositsResponse> => {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.status) sp.set('status', params.status);
    const qs = sp.toString();
    return request<AdminForAppDepositsResponse>(
      `/api/admin/payment-gateways/forapp/deposits${qs ? `?${qs}` : ''}`
    );
  },

  matchAdminForAppDeposit: (
    id: string,
    payload: { target: string; overrideAmountToman?: number; note?: string }
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/payment-gateways/forapp/deposits/${encodeURIComponent(id)}/match`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  dismissAdminForAppDeposit: (id: string, note?: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(
      `/api/admin/payment-gateways/forapp/deposits/${encodeURIComponent(id)}/dismiss`,
      {
        method: 'POST',
        body: JSON.stringify(note ? { note } : {}),
      }
    ),

  updateAdminNowPaymentsConfig: (
    payload: UpdateAdminNowPaymentsPayload
  ): Promise<{ success: boolean; nowpayments: AdminNowPaymentsConfigDto }> =>
    request<{ success: boolean; nowpayments: AdminNowPaymentsConfigDto }>(
      '/api/admin/payment-gateways/nowpayments',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  testAdminNowPayments: (): Promise<TestNowPaymentsResponse> =>
    request<TestNowPaymentsResponse>('/api/admin/payment-gateways/nowpayments/test', {
      method: 'POST',
    }),

  // Admin Forced Channel Join API
  getAdminForcedJoin: (): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>('/api/admin/forced-join'),

  updateAdminForcedJoinScope: (
    scope: AdminForcedJoinScope
  ): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>('/api/admin/forced-join/scope', {
      method: 'PUT',
      body: JSON.stringify({ scope }),
    }),

  createAdminForcedJoinChannel: (
    payload: CreateAdminForcedJoinChannelPayload
  ): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>('/api/admin/forced-join/channels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminForcedJoinChannel: (
    id: string,
    payload: UpdateAdminForcedJoinChannelPayload
  ): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>(
      `/api/admin/forced-join/channels/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  toggleAdminForcedJoinChannel: (
    id: string,
    enabled?: boolean
  ): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>(
      `/api/admin/forced-join/channels/${encodeURIComponent(id)}/toggle`,
      {
        method: 'POST',
        body: JSON.stringify(enabled === undefined ? {} : { enabled }),
      }
    ),

  deleteAdminForcedJoinChannel: (id: string): Promise<AdminForcedJoinConfigResponse> =>
    request<AdminForcedJoinConfigResponse>(
      `/api/admin/forced-join/channels/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),

  testAdminForcedJoinChannel: (channelId: string): Promise<AdminForcedJoinTestResponse> =>
    request<AdminForcedJoinTestResponse>('/api/admin/forced-join/test', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    }),

  // Admin Bulk Gift Campaigns API
  getAdminBulkGiftJobs: (page = 1, limit = 10): Promise<AdminBulkGiftJobsResponse> =>
    request<AdminBulkGiftJobsResponse>(`/api/admin/bulk-gift/jobs?page=${page}&limit=${limit}`),

  getAdminBulkGiftJob: (id: string): Promise<{ job: AdminBulkGiftJobDto }> =>
    request<{ job: AdminBulkGiftJobDto }>(`/api/admin/bulk-gift/jobs/${encodeURIComponent(id)}`),

  previewAdminBulkGift: (payload: BulkGiftPreviewPayload): Promise<BulkGiftPreviewResponse> =>
    request<BulkGiftPreviewResponse>('/api/admin/bulk-gift/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createAdminBulkGiftJob: (
    payload: CreateBulkGiftJobPayload
  ): Promise<{ success: boolean; job: AdminBulkGiftJobDto }> =>
    request<{ success: boolean; job: AdminBulkGiftJobDto }>('/api/admin/bulk-gift/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cancelAdminBulkGiftJob: (
    id: string
  ): Promise<{ success: boolean; requested: boolean; job: AdminBulkGiftJobDto }> =>
    request<{ success: boolean; requested: boolean; job: AdminBulkGiftJobDto }>(
      `/api/admin/bulk-gift/jobs/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
      }
    ),

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

  sendAdminUserMessage: (
    telegramId: number,
    payload: SendUserMessagePayload
  ): Promise<SendUserMessageResponse> =>
    request<SendUserMessageResponse>(`/api/admin/users/${telegramId}/message`, {
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

  checkUserForcedJoin: (
    action: 'any' | 'trial' | 'purchase' = 'any'
  ): Promise<ForcedJoinCheckResponse> =>
    request<ForcedJoinCheckResponse>('/api/user/forced-join/check', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  getUserConfigs: (): Promise<UserConfigsResponse> =>
    request<UserConfigsResponse>('/api/user/configs'),

  getUserPackages: (): Promise<UserPackagesResponse> =>
    request<UserPackagesResponse>('/api/user/packages'),

  getUserTransactions: (
    page = 1,
    limit = 10,
    filter: TransactionFilterType = 'all'
  ): Promise<UserTransactionsResponse> => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filter && filter !== 'all') {
      params.set('type', filter);
    }
    return request<UserTransactionsResponse>(`/api/user/transactions?${params.toString()}`);
  },

  getUserReceipts: (page = 1, limit = 10): Promise<UserReceiptsResponse> =>
    request<UserReceiptsResponse>(`/api/user/receipts?page=${page}&limit=${limit}`),

  prepareUserTopup: (amount: number): Promise<PrepareTopupResponse> =>
    request<PrepareTopupResponse>('/api/user/topup/prepare', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  submitUserTopupReceipt: (payload: {
    amount: number;
    cardId?: string;
    cardNumber?: string;
    fileBase64: string;
    fileName?: string;
  }): Promise<SubmitTopupReceiptResponse> =>
    request<SubmitTopupReceiptResponse>('/api/user/topup/receipt', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createUserForAppOrder: (amount: number): Promise<CreateForAppOrderResponse> =>
    request<CreateForAppOrderResponse>('/api/user/topup/forapp-order', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  createUserNowPaymentsOrder: (amount: number): Promise<CreateNowPaymentsOrderResponse> =>
    request<CreateNowPaymentsOrderResponse>('/api/user/topup/nowpayments-order', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  checkUserPaymentOrderStatus: (orderId: string): Promise<CheckPaymentOrderStatusResponse> =>
    request<CheckPaymentOrderStatusResponse>(
      `/api/user/topup/orders/${encodeURIComponent(orderId)}/status`
    ),

  cancelUserPaymentOrder: (orderId: string): Promise<CancelPaymentOrderResponse> =>
    request<CancelPaymentOrderResponse>(
      `/api/user/topup/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: 'POST',
      }
    ),

  previewWalletTransfer: (recipient: string): Promise<WalletTransferPreviewResponse> =>
    request<WalletTransferPreviewResponse>('/api/user/wallet/transfer/preview', {
      method: 'POST',
      body: JSON.stringify({ recipient }),
    }),

  executeWalletTransfer: (payload: {
    recipient?: string;
    toTelegramId?: number;
    amount: number;
    note?: string;
  }): Promise<WalletTransferResponse> =>
    request<WalletTransferResponse>('/api/user/wallet/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getUserTrialStatus: (): Promise<UserTrialStatus> =>
    request<UserTrialStatus>('/api/user/trial/status'),

  claimUserTrial: (): Promise<TrialClaimResponse> =>
    request<TrialClaimResponse>('/api/user/trial/claim', {
      method: 'POST',
    }),

  getUserWheelStatus: (): Promise<LuckyWheelStatusResponse> =>
    request<LuckyWheelStatusResponse>('/api/user/wheel/status'),

  spinUserWheel: (): Promise<LuckyWheelSpinResponse> =>
    request<LuckyWheelSpinResponse>('/api/user/wheel/spin', {
      method: 'POST',
    }),

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
    price?: number,
    custom?: { gb: number; days: number }
  ): Promise<ToggleAutoRenewResponse> =>
    request<ToggleAutoRenewResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/auto-renew`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled, packageId, price, ...(custom ? { custom } : {}) }),
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

  syncAllUserConfigs: (): Promise<SyncAllConfigsResponse> =>
    request<SyncAllConfigsResponse>('/api/user/configs/sync-all', {
      method: 'POST',
    }),

  claimUserSubLink: (subUrl: string): Promise<ClaimSubLinkResponse> =>
    request<ClaimSubLinkResponse>('/api/user/configs/claim', {
      method: 'POST',
      body: JSON.stringify({ subUrl }),
    }),

  getUserConfigUsage: (configId: string): Promise<UserConfigUsageResponse> =>
    request<UserConfigUsageResponse>(`/api/user/configs/${encodeURIComponent(configId)}/usage`),

  getUserConfigRefundQuote: (configId: string): Promise<ConfigRefundQuoteResponse> =>
    request<ConfigRefundQuoteResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/refund-quote`
    ),

  deleteUserConfig: (configId: string, withRefund = false): Promise<ConfigDeleteResponse> =>
    request<ConfigDeleteResponse>(`/api/user/configs/${encodeURIComponent(configId)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ withRefund }),
    }),

  previewUserConfigTransfer: (
    configId: string,
    recipient: string
  ): Promise<ConfigTransferPreviewResponse> =>
    request<ConfigTransferPreviewResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/transfer/preview`,
      {
        method: 'POST',
        body: JSON.stringify({ recipient }),
      }
    ),

  transferUserConfig: (
    configId: string,
    payload: { recipient?: string; toTelegramId?: number }
  ): Promise<ConfigTransferResponse> =>
    request<ConfigTransferResponse>(`/api/user/configs/${encodeURIComponent(configId)}/transfer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRenewalOptions: (configId: string): Promise<UserRenewalOptionsResponse> =>
    request<UserRenewalOptionsResponse>(
      `/api/user/configs/${encodeURIComponent(configId)}/renewal-options`
    ),

  quotePromo: (payload: {
    code: string;
    packageId?: string;
    custom?: { gb: number; days: number };
  }): Promise<PromoQuoteResponse> =>
    request<PromoQuoteResponse>('/api/user/promo/quote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  redeemGiftPromo: (code: string): Promise<PromoRedeemResponse> =>
    request<PromoRedeemResponse>('/api/user/promo/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};
