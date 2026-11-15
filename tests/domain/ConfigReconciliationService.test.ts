import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigReconciliationService } from '../../src/domain/services/ConfigReconciliationService.js';
import { RebeccaApiError } from '../../src/domain/services/RebeccaService.js';
import { getDb } from '../../src/infra/db.js';
import type { RebeccaPanelRegistry } from '../../src/domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('ConfigReconciliationService', () => {
  const getDbMock = vi.mocked(getDb);
  let panelAService: { getUsers: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn> };
  let panelBService: { getUsers: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn> };
  let service: ConfigReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    panelAService = { getUsers: vi.fn(), getUser: vi.fn() };
    panelBService = { getUsers: vi.fn(), getUser: vi.fn() };
    const registry = {
      getEnabledPanelIds: vi.fn(() => ['panel_a', 'panel_b']),
      getService: vi.fn(
        (id: string) =>
          (id === 'panel_b' ? panelBService : panelAService) as unknown as RebeccaService
      ),
      resolveTarget: vi.fn().mockResolvedValue({ panelId: 'panel_a', serviceId: 1 }),
    } as unknown as RebeccaPanelRegistry;
    service = new ConfigReconciliationService(registry);
  });

  it('reconciles live & missing bindings per panel, recomputes affected activeSubscriptionCount, and isolates failed panels', async () => {
    const localMissing = {
      id: 'uc_missing',
      telegramId: 101,
      panelId: 'panel_a',
      configUsername: 'gone_cfg',
      subUrl: 'https://sub.example/gone',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };
    const localHealthy = {
      id: 'uc_ok',
      telegramId: 102,
      panelId: 'panel_a',
      configUsername: 'live_cfg',
      subUrl: 'https://sub.example/live',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
    };

    panelAService.getUsers.mockResolvedValueOnce({
      users: [
        {
          username: 'live_cfg',
          status: 'active',
          used_traffic: 100,
          data_limit: 1024,
          expire: null,
          created_at: '2026-01-01T00:00:00Z',
          subscription_url: 'https://sub.example/live',
        },
        {
          username: 'orphan_cfg',
          status: 'active',
          used_traffic: 0,
          data_limit: 1024,
          expire: null,
          created_at: '2026-01-05T00:00:00Z',
          subscription_url: 'https://sub.example/orphan',
        },
      ],
      total: 2,
      status_breakdown: {},
    });
    panelBService.getUsers.mockRejectedValueOnce(new Error('panel_b timeout'));

    const { db, state } = createMockDb({
      selectResults: [[localMissing, localHealthy]],
      returningResults: [[{ status: 'open' }], [{ status: 'open' }]],
    });
    getDbMock.mockReturnValue(db as never);

    const summary = await service.scan();
    expect(summary).toEqual({
      localMissingRemote: 1,
      remoteUnbound: 1,
      remoteIgnored: 0,
      failedPanels: ['panel_b'],
    });

    // Both affected users (101 for missing -> deleted, 102 for live -> active) get activeSubscriptionCount recomputed
    const countUpdates = state.updateCalls.filter((c) => 'activeSubscriptionCount' in c.set);
    expect(countUpdates).toHaveLength(2);
    expect(state.updateCalls.some((c) => c.set.panelStatus === 'deleted')).toBe(true);
    expect(state.updateCalls.some((c) => c.set.panelStatus === 'active')).toBe(true);
  });

  it('throws ORPHAN_SCAN_ALL_PANELS_FAILED when every enabled panel fails', async () => {
    panelAService.getUsers.mockRejectedValueOnce(new Error('down A'));
    panelBService.getUsers.mockRejectedValueOnce(new Error('down B'));

    await expect(service.scan()).rejects.toThrow('ORPHAN_SCAN_ALL_PANELS_FAILED');
  });

  it('paginates issues cleanly and resolves removeLocalMissing, assignRemoteUnbound, and ignoreIssue', async () => {
    const issueMissing = {
      id: 'cri_1',
      panelId: 'panel_a',
      kind: 'local_missing_remote' as const,
      configUsername: 'missing_user',
      localConfigId: 'uc_miss',
      localOwnerTelegramId: 301,
      status: 'open' as const,
    };
    const issueUnbound = {
      id: 'cri_2',
      panelId: 'panel_a',
      kind: 'remote_unbound' as const,
      configUsername: 'unbound_user',
      remoteCreatedAt: 'created:2026-01-01T00:00:00Z',
      status: 'open' as const,
    };

    const listDb = createMockDb({
      selectResults: [[{ value: 2 }], [issueMissing, issueUnbound]],
    });
    getDbMock.mockReturnValue(listDb.db as never);
    await expect(service.listIssues(9, 100)).resolves.toMatchObject({
      issues: [issueMissing, issueUnbound],
      total: 2,
      page: 1,
      totalPages: 1,
    });
    expect(listDb.state.selectCalls[1]?.limit).toBe(25);

    // removeLocalMissing removes local row after 404 verification & updates activeSubscriptionCount
    const removeDb = createMockDb({
      selectResults: [[issueMissing]],
      returningResults: [[{ id: 'uc_miss' }], [{ id: 'cri_1' }]],
    });
    getDbMock.mockReturnValue(removeDb.db as never);
    panelAService.getUser.mockRejectedValueOnce(
      new RebeccaApiError(404, '/api/user/missing_user', '')
    );
    await expect(service.removeLocalMissing('cri_1', 999)).resolves.toBe(true);
    expect(removeDb.state.deleteCalls.length).toBeGreaterThanOrEqual(2);
    expect(removeDb.state.updateCalls.some((c) => 'activeSubscriptionCount' in c.set)).toBe(true);

    // assignRemoteUnbound validates target user, binds config, marks issue resolved, and updates count
    const assignDb = createMockDb({
      selectResults: [[issueUnbound], [{ telegramId: 302, isBanned: false }], []],
    });
    getDbMock.mockReturnValue(assignDb.db as never);
    panelAService.getUser.mockResolvedValueOnce({
      username: 'unbound_user',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      subscription_url: 'https://sub.example/unbound',
    });
    await expect(service.assignRemoteUnbound('cri_2', 302, 999)).resolves.toMatchObject({
      configUsername: 'unbound_user',
      configId: expect.stringMatching(/^uc_/u),
    });
    expect(assignDb.state.insertCalls.map((c) => c.values)).toContainEqual(
      expect.objectContaining({ telegramId: 302, configUsername: 'unbound_user' })
    );

    // ignoreIssue records audit trail
    const ignoreDb = createMockDb({
      returningResults: [[{ configUsername: 'unbound_user' }]],
    });
    getDbMock.mockReturnValue(ignoreDb.db as never);
    await expect(service.ignoreIssue('cri_2', 999)).resolves.toBe(true);
    expect(ignoreDb.state.insertCalls[0]?.values).toMatchObject({
      action: 'orphan_issue_ignored',
      entityId: 'cri_2',
    });
  });

  it('establishes remote baseline across unbound remote users non-destructively', async () => {
    const baselineDb = createMockDb({
      selectResults: [[], []],
    });
    getDbMock.mockReturnValue(baselineDb.db as never);
    panelAService.getUsers.mockResolvedValueOnce({
      users: [
        {
          username: 'legacy_panel_a',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          subscription_url: 'https://sub.example/a',
        },
      ],
      total: 1,
      status_breakdown: {},
    });
    panelBService.getUsers.mockResolvedValueOnce({
      users: [],
      total: 0,
      status_breakdown: {},
    });

    await expect(service.establishRemoteBaseline(999)).resolves.toEqual({
      remoteTotal: 1,
      alreadyBound: 0,
      ignoredUnbound: 1,
    });
    expect(baselineDb.state.insertCalls.map((c) => c.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ configUsername: 'legacy_panel_a', status: 'ignored' }),
        expect.objectContaining({ action: 'orphan_remote_baseline_established' }),
      ])
    );
  });
});
