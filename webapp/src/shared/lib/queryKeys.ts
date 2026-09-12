export const queryKeys = {
  stats: ['admin', 'stats'] as const,
  receipts: (
    params?: { page?: number; limit?: number; status?: string; search?: string } | number
  ) => ['admin', 'receipts', params] as const,
  receiptSettings: ['admin', 'receipts', 'settings'] as const,
  users: (page?: number, search?: string, filter?: string, sort?: string) =>
    ['admin', 'users', { page, search, filter, sort }] as const,
  userDossier: (telegramId: number) => ['admin', 'userDossier', telegramId] as const,
  panels: ['admin', 'panels'] as const,
};
