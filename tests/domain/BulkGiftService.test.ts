import { describe, expect, it, vi } from 'vitest';
import {
  computeBulkGiftMutation,
  normalizeBulkGiftStatuses,
  type BulkGiftItem,
  type BulkGiftJob,
  type BulkGiftService,
} from '../../src/domain/services/BulkGiftService.js';
import { processNextBulkGift } from '../../src/jobs/bulkGift.js';
import type { Api } from 'grammy';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { UserService } from '../../src/domain/services/UserService.js';

const GB = 1024 * 1024 * 1024;
const DAY = 86_400;

function baseItem(overrides: Partial<BulkGiftItem> = {}): BulkGiftItem {
  return {
    jobId: '00000000-0000-0000-0000-000000000001',
    configId: 'cfg_1',
    telegramId: 1001,
    panelId: 'default',
    serviceId: 1,
    configUsername: 'user_cfg_1',
    status: 'processing',
    attempts: 1,
    previousDataLimit: null,
    newDataLimit: null,
    previousExpire: null,
    newExpire: null,
    previousOnHoldDuration: null,
    newOnHoldDuration: null,
    notifiedAt: null,
    lastError: null,
    claimedAt: new Date(),
    appliedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseJob(overrides: Partial<BulkGiftJob> = {}): BulkGiftJob {
  const now = new Date();
  return {
    id: '00000000-0000-0000-0000-000000000001',
    actorTelegramId: 999,
    giftGb: 10,
    giftDays: 5,
    targetStatuses: '["active"]',
    panelId: null,
    serviceId: null,
    notifyMessage: null,
    status: 'queued',
    totalCount: 2,
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('BulkGiftService pure mutation logic', () => {
  it('normalizes and deduplicates target statuses safely', () => {
    expect(
      normalizeBulkGiftStatuses(['active', 'ON_HOLD', 'active', 'expired', 'limited'])
    ).toEqual(['active', 'on_hold', 'limited']);
    expect(normalizeBulkGiftStatuses(null)).toEqual([]);
  });

  it('adds GB only, days only, or both to active finite subscriptions', () => {
    const nowSec = 1_700_000_000;
    const remote = {
      status: 'active',
      data_limit: 50 * GB,
      used_traffic: 10 * GB,
      expire: nowSec + 10 * DAY,
      on_hold_expire_duration: null,
    };

    const gbOnly = computeBulkGiftMutation(remote, { giftGb: 15, giftDays: 0 }, baseItem(), nowSec);
    expect(gbOnly).toMatchObject({
      action: 'update',
      payload: { data_limit: 65 * GB },
      newDataLimit: 65 * GB,
      newExpire: null,
    });

    const daysOnly = computeBulkGiftMutation(
      remote,
      { giftGb: 0, giftDays: 7 },
      baseItem(),
      nowSec
    );
    expect(daysOnly).toMatchObject({
      action: 'update',
      payload: { expire: nowSec + 17 * DAY },
      newDataLimit: null,
      newExpire: nowSec + 17 * DAY,
    });

    const both = computeBulkGiftMutation(remote, { giftGb: 20, giftDays: 3 }, baseItem(), nowSec);
    expect(both).toMatchObject({
      action: 'update',
      payload: { data_limit: 70 * GB, expire: nowSec + 13 * DAY },
    });
  });

  it('extends on_hold_expire_duration while preserving on_hold status', () => {
    const remote = {
      status: 'on_hold',
      data_limit: 30 * GB,
      used_traffic: 0,
      expire: null,
      on_hold_expire_duration: 30 * DAY,
    };

    const plan = computeBulkGiftMutation(remote, { giftGb: 10, giftDays: 7 }, baseItem());
    expect(plan).toMatchObject({
      action: 'update',
      payload: {
        data_limit: 40 * GB,
        on_hold_expire_duration: 37 * DAY,
        status: 'on_hold',
      },
      previousOnHoldDuration: 30 * DAY,
      newOnHoldDuration: 37 * DAY,
      newExpire: null,
    });
  });

  it('reactivates limited services to active when gifted traffic exceeds used_traffic', () => {
    const nowSec = 1_700_000_000;
    const remote = {
      status: 'limited',
      data_limit: 20 * GB,
      used_traffic: 20 * GB,
      expire: nowSec + 15 * DAY,
      on_hold_expire_duration: null,
    };

    const plan = computeBulkGiftMutation(remote, { giftGb: 5, giftDays: 0 }, baseItem(), nowSec);
    expect(plan).toMatchObject({
      action: 'update',
      payload: {
        data_limit: 25 * GB,
        status: 'active',
      },
    });
  });

  it('preserves unlimited data/time plans and skips when gift has no applicable dimension', () => {
    const remote = {
      status: 'active',
      data_limit: null,
      used_traffic: 5 * GB,
      expire: null,
      on_hold_expire_duration: null,
    };

    const plan = computeBulkGiftMutation(remote, { giftGb: 10, giftDays: 5 }, baseItem());
    expect(plan).toEqual({
      action: 'skip',
      reason: 'NO_APPLICABLE_LIMIT_OR_EXPIRY',
    });
  });

  it('skips disabled, deleted, and expired services', () => {
    for (const status of ['disabled', 'deleted', 'expired']) {
      const plan = computeBulkGiftMutation(
        {
          status,
          data_limit: 20 * GB,
          used_traffic: 0,
          expire: 1_800_000_000,
          on_hold_expire_duration: null,
        },
        { giftGb: 5, giftDays: 5 },
        baseItem()
      );
      expect(plan.action).toBe('skip');
    }
  });

  it('guarantees crash-recovery idempotency when prior attempt already updated the panel', () => {
    const nowSec = 1_700_000_000;
    const targetLimit = 60 * GB;
    const targetExpire = nowSec + 40 * DAY;

    const plan = computeBulkGiftMutation(
      {
        status: 'active',
        data_limit: targetLimit,
        used_traffic: 10 * GB,
        expire: targetExpire,
        on_hold_expire_duration: null,
      },
      { giftGb: 10, giftDays: 10 },
      baseItem({
        attempts: 2,
        newDataLimit: targetLimit,
        newExpire: targetExpire,
      }),
      nowSec
    );
    expect(plan).toEqual({ action: 'already_applied', reason: 'ALREADY_APPLIED_ON_PANEL' });
  });
});

describe('BulkGift worker execution & cancellation', () => {
  it('processes items with bounded concurrency, delivers optional DM with 429 retry, and ignores blocked users', async () => {
    const job = baseJob({ notifyMessage: 'Compensation gift for outage!' });
    const items = [
      baseItem({ configId: 'cfg_1', telegramId: 101, configUsername: 'alice_1' }),
      baseItem({ configId: 'cfg_2', telegramId: 102, configUsername: 'bob_1' }),
      baseItem({ configId: 'cfg_3', telegramId: 103, configUsername: 'carol_1' }),
    ];

    let batchServed = false;
    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const mockBulkGiftService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => job),
      markRunning: vi.fn(async () => ({ ...job, status: 'running' as const })),
      getJob: vi.fn(async () => ({ ...job, status: 'running' as const })),
      claimBatch: vi.fn(async () => {
        if (batchServed) return [];
        batchServed = true;
        return items;
      }),
      applyGiftToItem: vi.fn(async () => {
        activeConcurrency += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
        await new Promise((r) => setTimeout(r, 15));
        activeConcurrency -= 1;
        return { status: 'applied' as const };
      }),
      markItemNotified: vi.fn(async () => undefined),
      finalizeCompleted: vi.fn(async () => undefined),
      finalizeCancelled: vi.fn(async () => undefined),
    } as unknown as BulkGiftService;

    let aliceAttempts = 0;
    const sendMessage = vi.fn(async (chatId: number) => {
      if (chatId === 101 && aliceAttempts === 0) {
        aliceAttempts += 1;
        const err = new Error('Too Many Requests') as Error & {
          error_code: number;
          parameters: { retry_after: number };
        };
        err.error_code = 429;
        err.parameters = { retry_after: 1 };
        throw err;
      }
      if (chatId === 102) {
        const err = new Error('Forbidden: bot was blocked by the user') as Error & {
          error_code: number;
        };
        err.error_code = 403;
        throw err;
      }
      return { message_id: 1 };
    });

    const botApi = { sendMessage } as unknown as Api;
    const translationService = {
      getDefaultLocale: () => 'en',
      get: (key: string) => key,
    } as unknown as TranslationService;
    const userService = {
      getLocale: vi.fn(async () => 'en' as const),
    } as unknown as UserService;

    await processNextBulkGift(mockBulkGiftService, {
      telegramApi: botApi,
      translationService,
      userService,
      concurrency: 2,
      batchSize: 10,
      interBatchDelayMs: 0,
    });

    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(mockBulkGiftService.applyGiftToItem).toHaveBeenCalledTimes(3);
    // alice (retried after 429 -> ok) + carol (ok); bob (403 blocked -> non-fatal, not marked notified)
    expect(mockBulkGiftService.markItemNotified).toHaveBeenCalledTimes(2);
    expect(mockBulkGiftService.finalizeCompleted).toHaveBeenCalledWith(job.id);
  });

  it('halts claiming and finalizes cancelled immediately when job is cancel_requested', async () => {
    const job = baseJob({ status: 'cancel_requested' });
    const mockBulkGiftService = {
      requeueStaleClaims: vi.fn(async () => 0),
      nextRunnableJob: vi.fn(async () => job),
      markRunning: vi.fn(async () => job),
      getJob: vi.fn(async () => job),
      claimBatch: vi.fn(async () => []),
      applyGiftToItem: vi.fn(),
      markItemNotified: vi.fn(),
      finalizeCompleted: vi.fn(),
      finalizeCancelled: vi.fn(async () => undefined),
    } as unknown as BulkGiftService;

    await processNextBulkGift(mockBulkGiftService, {
      telegramApi: { sendMessage: vi.fn() } as unknown as Api,
      translationService: {
        getDefaultLocale: () => 'en',
        get: (k: string) => k,
      } as unknown as TranslationService,
      userService: { getLocale: vi.fn(async () => 'en') } as unknown as UserService,
    });

    expect(mockBulkGiftService.claimBatch).not.toHaveBeenCalled();
    expect(mockBulkGiftService.applyGiftToItem).not.toHaveBeenCalled();
    expect(mockBulkGiftService.finalizeCancelled).toHaveBeenCalledWith(job.id);
  });
});
