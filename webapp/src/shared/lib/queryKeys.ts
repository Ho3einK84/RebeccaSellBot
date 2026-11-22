export const queryKeys = {
  stats: ['admin', 'stats'] as const,
  receipts: (
    params?: { page?: number; limit?: number; status?: string; search?: string } | number
  ) => ['admin', 'receipts', params] as const,
  receiptSettings: ['admin', 'receipts', 'settings'] as const,
  bankCards: ['admin', 'bankCards'] as const,
  paymentGateways: ['admin', 'paymentGateways'] as const,
  forappDeposits: (params?: { page?: number; status?: string }) =>
    ['admin', 'forappDeposits', params ?? { page: 1, status: 'unmatched' }] as const,
  users: (page?: number, search?: string, filter?: string, sort?: string) =>
    ['admin', 'users', { page, search, filter, sort }] as const,
  userDossier: (telegramId: number) => ['admin', 'userDossier', telegramId] as const,
  panels: ['admin', 'panels'] as const,
  packages: (filters?: { includeDisabled?: boolean; categoryId?: string; panelId?: string }) =>
    filters ? (['admin', 'packages', filters] as const) : (['admin', 'packages'] as const),
  categories: (includeDisabled = true) => ['admin', 'categories', { includeDisabled }] as const,
  customPricing: ['admin', 'pricing', 'custom'] as const,
  user: {
    profile: ['user', 'profile'] as const,
    configs: ['user', 'configs'] as const,
    configUsage: (configId: string) => ['user', 'configs', 'usage', configId] as const,
    packages: ['user', 'packages'] as const,
    transactions: (page?: number, filter?: string) =>
      filter && filter !== 'all'
        ? (['user', 'transactions', page, filter] as const)
        : (['user', 'transactions', page] as const),
    receipts: (page?: number) => ['user', 'receipts', page] as const,
    wheel: ['user', 'wheel'] as const,
    trial: ['user', 'trial'] as const,
  },
};
