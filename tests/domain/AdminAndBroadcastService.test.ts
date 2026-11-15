import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import { AdminService, LastAdminRemovalError } from '../../src/domain/services/AdminService.js';
import { BroadcastService } from '../../src/domain/services/BroadcastService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('AdminService & BroadcastService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AdminService', () => {
    it('seeds bootstrap admins inside advisory lock when table is empty and populates adminIds', async () => {
      const mock = createMockDb({
        selectResults: [[{ value: 0 }], [{ telegramId: 1001 }, { telegramId: 1002 }]],
      });
      getDbMock.mockReturnValue(mock.db as never);

      const service = new AdminService();
      await service.initialize([1001, 1002]);

      expect(mock.state.executeCalls[0]).toContain('pg_advisory_xact_lock');
      expect(mock.state.insertCalls[0]?.values).toEqual([
        { telegramId: 1001, addedBy: null },
        { telegramId: 1002, addedBy: null },
      ]);
      expect(service.adminIds).toEqual([1001, 1002]);
      expect(service.isAdmin(1001)).toBe(true);
      expect(service.isAdmin(9999)).toBe(false);
    });

    it('throws ADMIN_BOOTSTRAP_REQUIRED when table is empty and no bootstrap IDs are provided', async () => {
      const mock = createMockDb({ selectResults: [[{ value: 0 }]] });
      getDbMock.mockReturnValue(mock.db as never);

      await expect(new AdminService().initialize([])).rejects.toThrow('ADMIN_BOOTSTRAP_REQUIRED');
    });

    it('adds a new admin with audit log and skips duplicate refresh when already present', async () => {
      const mock = createMockDb({
        returningResults: [[{ telegramId: 2002 }]],
        selectResults: [[{ telegramId: 1001 }, { telegramId: 2002 }]],
      });
      getDbMock.mockReturnValue(mock.db as never);

      const service = new AdminService();
      await expect(service.addAdmin(2002, 1001)).resolves.toBe(true);
      expect(mock.state.insertCalls).toHaveLength(2);
      expect(service.adminIds).toEqual([1001, 2002]);

      const dupMock = createMockDb({ returningResults: [[]] });
      getDbMock.mockReturnValue(dupMock.db as never);
      await expect(service.addAdmin(2002, 1001)).resolves.toBe(false);
      expect(dupMock.state.insertCalls).toHaveLength(1);
    });

    it('protects the last remaining admin from removal and writes audit logs when removing non-last admin', async () => {
      const lastMock = createMockDb({ selectResults: [[{ value: 1 }]] });
      getDbMock.mockReturnValue(lastMock.db as never);
      const service = new AdminService();
      await expect(service.removeAdmin(1001, 1001)).rejects.toBeInstanceOf(LastAdminRemovalError);

      const removeMock = createMockDb({
        selectResults: [[{ value: 2 }], [{ telegramId: 1001 }]],
        returningResults: [[{ telegramId: 2002 }]],
      });
      getDbMock.mockReturnValue(removeMock.db as never);
      await expect(service.removeAdmin(2002, 1001)).resolves.toBe(true);
      expect(removeMock.state.insertCalls[0]?.values).toMatchObject({
        action: 'admin_removed',
        targetTelegramId: 2002,
      });
      expect(service.adminIds).toEqual([1001]);

      await expect(service.removeAdmin(0, 1001)).rejects.toThrow('INVALID_TELEGRAM_ID');
    });
  });

  describe('BroadcastService', () => {
    it('validates message length and completes immediately when snapshot recipient count is 0', async () => {
      const service = new BroadcastService();
      await expect(
        service.createJob({ actorTelegramId: 1, audience: 'all', message: '' })
      ).rejects.toThrow('INVALID_BROADCAST_MESSAGE');
      await expect(
        service.createJob({ actorTelegramId: 1, audience: 'all', message: 'a'.repeat(4_097) })
      ).rejects.toThrow('INVALID_BROADCAST_MESSAGE');

      const emptyJob = {
        id: 'job_empty',
        actorTelegramId: 1,
        audience: 'all',
        message: 'hi',
        status: 'completed',
        recipientCount: 0,
      };
      const mock = createMockDb({
        selectResults: [[{ value: 0 }]],
        returningResults: [[emptyJob]],
      });
      getDbMock.mockReturnValue(mock.db as never);

      const created = await service.createJob({
        actorTelegramId: 1,
        audience: 'no_purchase_30d',
        message: 'hello users',
      });
      expect(created.status).toBe('completed');
      expect(mock.state.updateCalls[0]?.set).toMatchObject({
        recipientCount: 0,
        status: 'completed',
      });
      expect(
        mock.state.insertCalls.some(
          (c) => (c.values as { action?: string }).action === 'broadcast_queued'
        )
      ).toBe(true);
    });

    it('claims batches bounded to [1, 100], tracks sent/failed counts, and requeues stale claims', async () => {
      const claimMock = createMockDb({
        selectResults: [[{ telegramId: 10 }, { telegramId: 20 }]],
        returningResults: [[{ telegramId: 10 }, { telegramId: 20 }]],
      });
      getDbMock.mockReturnValue(claimMock.db as never);

      const service = new BroadcastService();
      await expect(service.claimBatch('job_1', 500)).resolves.toEqual([10, 20]);
      expect(claimMock.state.selectCalls[0]?.limit).toBe(100);
      expect(claimMock.state.updateCalls[0]?.set).toMatchObject({ status: 'sending' });

      const finishMock = createMockDb({
        returningResults: [[{ telegramId: 10 }], [{ telegramId: 20 }], [{ telegramId: 99 }]],
      });
      getDbMock.mockReturnValue(finishMock.db as never);
      await expect(service.markRecipientSent('job_1', 10)).resolves.toBe(true);
      await expect(
        service.markRecipientFailed('job_1', 20, new Error('403: bot was blocked'))
      ).resolves.toBe(true);
      expect(finishMock.state.updateCalls[2]?.set).toMatchObject({
        status: 'failed',
        lastError: 'Error: 403: bot was blocked',
      });
      await expect(service.requeueStaleClaims(new Date('2026-01-01T00:20:00Z'))).resolves.toBe(1);
    });

    it('finalizes cancellation truthfully as completed when no recipients remain', async () => {
      const mock = createMockDb({
        selectResults: [[{ actorTelegramId: 1 }], [{ value: 0 }]],
        returningResults: [[{ id: 'job_race' }]],
      });
      getDbMock.mockReturnValue(mock.db as never);

      const service = new BroadcastService();
      await expect(service.finalizeCancelled('job_race')).resolves.toBe(true);
      expect(mock.state.updateCalls[0]?.set).toMatchObject({ status: 'completed' });
      expect(mock.state.insertCalls[0]?.values).toMatchObject({ action: 'broadcast_completed' });

      const cancelMock = createMockDb({
        selectResults: [[{ actorTelegramId: 1 }], [{ value: 4 }]],
        returningResults: [[{ id: 'job_cancel' }]],
      });
      getDbMock.mockReturnValue(cancelMock.db as never);
      await expect(service.finalizeCancelled('job_cancel')).resolves.toBe(true);
      expect(cancelMock.state.updateCalls[0]?.set).toMatchObject({ status: 'cancelled' });
      expect(cancelMock.state.updateCalls[1]?.set).toMatchObject({ status: 'cancelled' });
      expect(cancelMock.state.insertCalls[0]?.values).toMatchObject({
        action: 'broadcast_cancelled',
      });
    });
  });
});
