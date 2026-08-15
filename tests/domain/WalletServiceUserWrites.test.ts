import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletService } from '../../src/domain/services/WalletService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ReferralService } from '../../src/domain/services/ReferralService.js';
import type { PromoService } from '../../src/domain/services/PromoService.js';

const selectQueryMock = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
const updateQueryMock = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const dbMock = {
  select: vi.fn().mockReturnValue(selectQueryMock),
  update: vi.fn().mockReturnValue(updateQueryMock),
};

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(() => dbMock),
}));

describe('P2 — Reduce unnecessary user DB writes in WalletService.getOrCreateUser', () => {
  let walletService: WalletService;
  let mockPanels: RebeccaPanelRegistry;
  let mockTranslationService: TranslationService;
  let mockReferralService: ReferralService;
  let mockPromoService: PromoService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPanels = {
      resolveTarget: vi.fn(),
      getEnabledPanelIds: vi.fn(() => []),
    } as unknown as RebeccaPanelRegistry;
    mockTranslationService = {} as unknown as TranslationService;
    mockReferralService = {} as unknown as ReferralService;
    mockPromoService = {} as unknown as PromoService;
    walletService = new WalletService(
      mockPanels,
      mockTranslationService,
      mockReferralService,
      mockPromoService
    );
  });

  it('skips database update when user profile is unchanged and lastSeenAt was within 10 minutes', async () => {
    const recentLastSeen = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
    const existingUser = {
      telegramId: 12345,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      locale: 'fa',
      localeManual: false,
      lastSeenAt: recentLastSeen,
      balance: 10000,
    };
    selectQueryMock.limit.mockResolvedValueOnce([existingUser]);

    const result = await walletService.getOrCreateUser(
      12345,
      'alice',
      'Alice',
      undefined,
      undefined,
      'fa'
    );
    expect(result).toEqual(existingUser);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('performs database update when profile fields change even within 10 minutes', async () => {
    const recentLastSeen = new Date(Date.now() - 2 * 60 * 1000);
    const existingUser = {
      telegramId: 12345,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      locale: 'fa',
      localeManual: false,
      lastSeenAt: recentLastSeen,
      balance: 10000,
    };
    selectQueryMock.limit.mockResolvedValueOnce([existingUser]);
    updateQueryMock.returning.mockResolvedValueOnce([
      { ...existingUser, firstName: 'AliceUpdated' },
    ]);

    const result = await walletService.getOrCreateUser(
      12345,
      'alice',
      'AliceUpdated',
      undefined,
      undefined,
      'fa'
    );
    expect(dbMock.update).toHaveBeenCalled();
    expect(result.firstName).toBe('AliceUpdated');
  });

  it('updates lastSeenAt when more than 10 minutes have elapsed since last update', async () => {
    const oldLastSeen = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
    const existingUser = {
      telegramId: 12345,
      username: 'alice',
      firstName: 'Alice',
      lastName: null,
      locale: 'fa',
      localeManual: false,
      lastSeenAt: oldLastSeen,
      balance: 10000,
    };
    selectQueryMock.limit.mockResolvedValueOnce([existingUser]);
    updateQueryMock.returning.mockResolvedValueOnce([{ ...existingUser, lastSeenAt: new Date() }]);

    await walletService.getOrCreateUser(12345, 'alice', 'Alice', undefined, undefined, 'fa');
    expect(dbMock.update).toHaveBeenCalled();
  });
});
