export const queryKeys = {
  stats: ['admin', 'stats'] as const,
  receipts: (limit?: number) => ['admin', 'receipts', { limit }] as const,
  users: (page?: number, search?: string) => ['admin', 'users', { page, search }] as const,
  userDossier: (telegramId: number) => ['admin', 'userDossier', telegramId] as const,
  panels: ['admin', 'panels'] as const,
};
