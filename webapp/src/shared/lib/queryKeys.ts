export const queryKeys = {
  stats: ['admin', 'stats'] as const,
  receipts: (limit?: number) => ['admin', 'receipts', { limit }] as const,
  users: (page?: number, search?: string, filter?: string, sort?: string) =>
    ['admin', 'users', { page, search, filter, sort }] as const,
  userDossier: (telegramId: number) => ['admin', 'userDossier', telegramId] as const,
  panels: ['admin', 'panels'] as const,
};
