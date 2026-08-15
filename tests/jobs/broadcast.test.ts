import { describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { BroadcastService, BroadcastJob } from '../../src/domain/services/BroadcastService.js';
import { processNextBroadcast } from '../../src/jobs/broadcast.js';

const CREATED_AT = new Date('2026-08-08T00:00:00Z');

function job(status: BroadcastJob['status'] = 'queued'): BroadcastJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    actorTelegramId: 1,
    audience: 'all',
    message: 'hello',
    status,
    recipientCount: 2,
    sentCount: 0,
    failedCount: 0,
    createdAt: CREATED_AT,
    startedAt: status === 'queued' ? null : CREATED_AT,
    completedAt: null,
    updatedAt: CREATED_AT,
  };
}

function serviceMock() {
  return {
    requeueStaleClaims: vi.fn().mockResolvedValue(0),
    nextRunnableJob: vi.fn(),
    markRunning: vi.fn(),
    getJob: vi.fn(),
    claimBatch: vi.fn(),
    markRecipientSent: vi.fn().mockResolvedValue(true),
    markRecipientFailed: vi.fn().mockResolvedValue(true),
    finalizeCompleted: vi.fn().mockResolvedValue(true),
    finalizeCancelled: vi.fn().mockResolvedValue(true),
  };
}

describe('durable broadcast worker', () => {
  it('delivers a claimed batch, records per-recipient outcomes, and finalizes', async () => {
    const service = serviceMock();
    const queued = job('queued');
    const running = job('running');
    service.nextRunnableJob.mockResolvedValue(queued);
    service.markRunning.mockResolvedValue(running);
    service.getJob.mockResolvedValue(running);
    service.claimBatch.mockResolvedValueOnce([101, 102]).mockResolvedValueOnce([]);

    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 1 })
      .mockRejectedValueOnce(new Error('blocked'));

    await processNextBroadcast(
      service as unknown as BroadcastService,
      { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
      { interBatchDelayMs: 0 }
    );

    expect(service.requeueStaleClaims).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(service.markRecipientSent).toHaveBeenCalledWith(running.id, 101);
    expect(service.markRecipientFailed).toHaveBeenCalledWith(running.id, 102, expect.any(Error));
    expect(service.finalizeCompleted).toHaveBeenCalledWith(running.id);
  });

  it('honors a persisted cancellation before sending anything', async () => {
    const service = serviceMock();
    const cancelling = job('cancel_requested');
    service.nextRunnableJob.mockResolvedValue(cancelling);
    const sendMessage = vi.fn();

    await processNextBroadcast(
      service as unknown as BroadcastService,
      { sendMessage } as unknown as Pick<Api, 'sendMessage'>
    );

    expect(service.finalizeCancelled).toHaveBeenCalledWith(cancelling.id);
    expect(service.markRunning).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
