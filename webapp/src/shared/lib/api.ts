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
  SupportedLocale,
  ApiErrorResponse,
} from '@/shared/types/api.js';

class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    // Same-origin is the production topology (Fastify serves /api + static),
    // but the default must be explicit so the session cookie is also sent
    // through the vite dev proxy and any same-site deployment.
    credentials: options.credentials ?? 'same-origin',
    headers,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errData = (await response.json()) as ApiErrorResponse;
      if (errData.error || errData.message) {
        errorMessage = errData.error || errData.message || errorMessage;
      }
    } catch {
      // Body was not JSON
    }
    throw new ApiClientError(errorMessage, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  validateTelegramAuth: (initData: string): Promise<AuthResponse> =>
    request<AuthResponse>('/api/auth/telegram-validate', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    }),

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

  getAdminReceipts: (limit = 30): Promise<ReceiptsResponse> =>
    request<ReceiptsResponse>(`/api/admin/receipts?limit=${limit}`),

  performReceiptAction: (
    receiptId: string,
    payload: ReceiptActionPayload
  ): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/admin/receipts/${receiptId}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAdminUsers: (
    params: { page?: number; limit?: number; search?: string } = {}
  ): Promise<UsersResponse> => {
    const search = params.search?.trim();
    const page = params.page ?? 1;
    const limit = params.limit ?? 12;
    if (search) {
      return request<UsersResponse>(
        `/api/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`
      );
    }
    return request<UsersResponse>(`/api/admin/users?page=${page}&limit=${limit}`);
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

  getAdminPanels: (): Promise<PanelsResponse> => request<PanelsResponse>('/api/admin/panels'),

  testAdminPanel: (panelId: string): Promise<TestPanelResponse> =>
    request<TestPanelResponse>(`/api/admin/panels/${panelId}/test`, {
      method: 'POST',
    }),
};
