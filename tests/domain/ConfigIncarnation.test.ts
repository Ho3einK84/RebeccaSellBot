import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../src/domain/services/ConfigService.js';
import { RefundService } from '../../src/domain/services/RefundService.js';
import { ConfigTransferService } from '../../src/domain/services/ConfigTransferService.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

const selectResults: unknown[][] = [];
const selectQueryMock = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
  orderBy: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
};
const insertQueryMock = {
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const deleteQueryMock = {
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const updateQueryMock = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const dbMock = {
  select: vi.fn().mockReturnValue(selectQueryMock),
  insert: vi.fn().mockReturnValue(insertQueryMock),
  delete: vi.fn().mockReturnValue(deleteQueryMock),
  update: vi.fn().mockReturnValue(updateQueryMock),
  transaction: vi.fn(),
};
dbMock.transaction.mockImplementation(async (callback: (tx: typeof dbMock) => unknown) =>
  callback(dbMock)
);

let advisoryLocked = false;

vi.mock('../../src/infra/db.js', () => ({
  getDb: vi.fn(() => dbMock),
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(async (query: string) => {
        if (query.includes('pg_try_advisory_lock')) {
          if (advisoryLocked) return { rows: [{ locked: false }] };
          advisoryLocked = true;
          return { rows: [{ locked: true }] };
        }
        if (query.includes('pg_advisory_unlock')) {
          advisoryLocked = false;
          return { rows: [{ unlocked: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    }),
  })),
}));

function createRemoteUser(
  username: string,
  createdAt: string,
  subUrl = 'https://sub.example/sub/alice123'
): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * 1024 * 1024 * 1024,
    expire: null,
    created_at: createdAt,
    subscription_url: subUrl,
    links: [],
    proxies: {},
    inbounds: {},
  };
}

describe('P0 — Remote Config Incarnation Verification', () => {
  let mockRebeccaService: {
    getUser: ReturnType<typeof vi.fn>;
    enableUser: ReturnType<typeof vi.fn>;
    disableUser: ReturnType<typeof vi.fn>;
    revokeSubscription: ReturnType<typeof vi.fn>;
    resetUserTraffic: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    getUsers: ReturnType<typeof vi.fn>;
  };
  let mockPanels: RebeccaPanelRegistry;
  let mockTranslationService: TranslationService;

  beforeEach(() => {
    vi.clearAllMocks();
    advisoryLocked = false;
    mockRebeccaService = {
      getUser: vi.fn(),
      enableUser: vi.fn(),
      disableUser: vi.fn(),
      revokeSubscription: vi.fn(),
      resetUserTraffic: vi.fn(),
      deleteUser: vi.fn(),
      getUsers: vi.fn(),
    };
    mockPanels = {
      getService: vi.fn(() => mockRebeccaService as unknown as RebeccaService),
      resolveTarget: vi.fn().mockResolvedValue({ panelId: 'panel_a', serviceId: 1 }),
      getEnabledPanelIds: vi.fn(() => ['panel_a']),
      getPanel: vi.fn(),
      getDefaultPanelId: vi.fn(() => 'panel_a'),
      hasPanels: vi.fn(() => true),
    } as unknown as RebeccaPanelRegistry;

    selectResults.length = 0;
    mockTranslationService = {
      getSetting: vi.fn((key: string, def: string) => def),
      getSettingNum: vi.fn((key: string, def: number) => def),
    } as unknown as TranslationService;
  });

  describe('ConfigService incarnation checks', () => {
    it('rejects revokeSubscription when remote user has a different created_at', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
        subUrl: 'https://sub.example/sub/old',
      };
      selectResults.push([localConfig], [localConfig]);

      // Recreated remote user with newer created_at
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );

      await expect(configService.revokeSubscription('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_MISMATCH'
      );

      // Verify remote mutation was NOT called
      expect(mockRebeccaService.revokeSubscription).not.toHaveBeenCalled();
      // Verify local row was marked stale
      expect(dbMock.update).toHaveBeenCalled();
    });

    it('allows only one concurrent revoke to reach Rebecca and fails the contender closed', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
        subUrl: 'https://sub.example/sub/original',
      };
      // First revoke resolves once before the lock and once after acquiring it;
      // the contender resolves once before its lock attempt.
      selectResults.push([localConfig], [localConfig], [localConfig]);
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-01-01T00:00:00Z')
      );
      let finishRemote!: (value: RebeccaUserDetail) => void;
      mockRebeccaService.revokeSubscription.mockImplementation(
        () =>
          new Promise<RebeccaUserDetail>((resolve) => {
            finishRemote = resolve;
          })
      );

      const first = configService.revokeSubscription('alice', 'panel_a');
      await vi.waitFor(() =>
        expect(mockRebeccaService.revokeSubscription).toHaveBeenCalledTimes(1)
      );
      const second = configService.revokeSubscription('alice', 'panel_a');
      await expect(second).rejects.toThrow('CONFIG_MUTATION_BUSY');

      finishRemote(
        createRemoteUser('alice', '2026-01-01T00:00:00Z', 'https://sub.example/sub/rotated')
      );
      await expect(first).resolves.toBe('https://sub.example/sub/rotated');
      expect(mockRebeccaService.revokeSubscription).toHaveBeenCalledTimes(1);
    });

    it('rejects enableConfig/disableConfig on incarnation mismatch', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      selectResults.push([localConfig]);
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );

      await expect(configService.enableConfig('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_MISMATCH'
      );
      expect(mockRebeccaService.enableUser).not.toHaveBeenCalled();
      expect(mockRebeccaService.disableUser).not.toHaveBeenCalled();
    });

    it('rejects resetUsage on incarnation mismatch before resetting remote traffic', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      selectResults.push([localConfig]);
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );
      await expect(configService.resetUsage('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_MISMATCH'
      );
      expect(mockRebeccaService.resetUserTraffic).not.toHaveBeenCalled();
    });

    it('fails closed for a legacy NULL fingerprint when continuity cannot be proven', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_legacy',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: null,
        subUrl: 'https://sub.example/sub/old-secret',
      };
      // resolveLocalConfig, then the completed-new-config ownership lookup.
      selectResults.push([localConfig], []);
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z', 'https://sub.example/sub/new-secret')
      );

      await expect(configService.resetUsage('alice', 'panel_a')).rejects.toThrow(
        'CONFIG_INCARNATION_UNVERIFIED'
      );
      expect(mockRebeccaService.resetUserTraffic).not.toHaveBeenCalled();
    });

    it('safely backfills a legacy NULL fingerprint when the stored subscription credential matches', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_legacy',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: null,
        subUrl: 'https://sub.example/sub/same-secret',
      };
      selectResults.push([localConfig]);
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-01-01T00:00:00Z', localConfig.subUrl)
      );
      updateQueryMock.returning.mockResolvedValueOnce([
        { remoteCreatedAt: 'created:2026-01-01T00:00:00Z' },
      ]);
      mockRebeccaService.resetUserTraffic.mockResolvedValue(undefined);

      await expect(configService.resetUsage('alice', 'panel_a')).resolves.toBeUndefined();
      expect(mockRebeccaService.resetUserTraffic).toHaveBeenCalledWith('alice');
      expect(localConfig.remoteCreatedAt).toBe('created:2026-01-01T00:00:00Z');
    });

    it('preserves recreated remote user when deleteConfigCompletely encounters incarnation mismatch', async () => {
      const configService = new ConfigService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      selectResults.push([localConfig]);
      deleteQueryMock.returning.mockResolvedValueOnce([
        { configUsername: 'alice', telegramId: 1001 },
      ]);

      // Remote user was recreated by another user
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );

      const deleted = await configService.deleteConfigCompletely('alice', 'panel_a');
      expect(deleted).toBe(true);
      // deleteUser on remote Rebecca panel must NOT have been called
      expect(mockRebeccaService.deleteUser).not.toHaveBeenCalled();
      // Local row was deleted
      expect(dbMock.delete).toHaveBeenCalled();
    });
  });

  describe('ConfigTransferService incarnation check', () => {
    it('rejects transfer when remote user created_at differs from local binding', async () => {
      const transferService = new ConfigTransferService(mockPanels);
      const targetUser = { telegramId: 2002, isBanned: false };
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      selectResults.push([targetUser], [localConfig]);

      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );

      await expect(
        transferService.transfer({
          configId: 'uc_1',
          fromTelegramId: 1001,
          toTelegramId: 2002,
          actorTelegramId: 1001,
        })
      ).rejects.toThrow('CONFIG_INCARNATION_MISMATCH');
    });
  });

  describe('RefundService incarnation check and completedAt refund window', () => {
    it('rejects refund quote on remote incarnation mismatch', async () => {
      const refundService = new RefundService(mockPanels, mockTranslationService);
      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      const initialIntent = {
        id: 'pi_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        type: 'new_config',
        amount: 50000,
        status: 'completed',
        createdAt: new Date(Date.now() - 3600_000),
        completedAt: new Date(Date.now() - 1800_000),
      };

      selectResults.push(
        [localConfig], // config lookup
        [initialIntent], // intents
        [], // refund intents
        [], // referral reward
        [] // cashback
      );

      // Remote user has different created_at
      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-02-01T00:00:00Z')
      );

      const quote = await refundService.quote(1001, 'uc_1');
      expect(quote.eligible).toBe(false);
      expect(quote.reason).toBe('ownership_mismatch');
    });

    it('uses completedAt rather than createdAt to calculate refund window', async () => {
      const refundService = new RefundService(mockPanels, mockTranslationService);
      vi.mocked(mockTranslationService.getSettingNum).mockReturnValue(2); // 2 hours window

      const localConfig = {
        id: 'uc_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      };
      // Intent was created 3 hours ago (would be expired if using createdAt), but completed 30 mins ago
      const initialIntent = {
        id: 'pi_1',
        telegramId: 1001,
        panelId: 'panel_a',
        configUsername: 'alice',
        type: 'new_config',
        amount: 50000,
        status: 'completed',
        createdAt: new Date(Date.now() - 3 * 3600_000),
        completedAt: new Date(Date.now() - 30 * 60_000),
      };

      selectResults.push([localConfig], [initialIntent], [], [], []);

      mockRebeccaService.getUser.mockResolvedValue(
        createRemoteUser('alice', '2026-01-01T00:00:00Z')
      );

      const quote = await refundService.quote(1001, 'uc_1');
      expect(quote.eligible).toBe(true);
      expect(quote.purchasedAt).toEqual(initialIntent.completedAt);
    });
  });
});
