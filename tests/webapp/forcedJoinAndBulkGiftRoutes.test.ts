import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  ForcedJoinService,
  type ForcedJoinTelegramAdapter,
} from '../../src/domain/services/ForcedJoinService.js';
import type { BulkGiftJob, BulkGiftService } from '../../src/domain/services/BulkGiftService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  createMockAdminServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';

describe('WebApp Forced Join & Bulk Gift Routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let rateLimitStore: ReturnType<typeof createResettableRateLimitStore>;
  let forcedJoinService: ForcedJoinService;
  let memberJoined: boolean;
  let mockBulkGiftService: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(async () => {
    rateLimitStore = createResettableRateLimitStore();
    memberJoined = false;
    const { mockServices, mockUserService, mockTranslationService, mockWalletService } =
      createMockAdminServices();

    const settings = new Map<string, string>([
      ['bot_enabled', 'true'],
      ['forced_join_scope', 'off'],
      ['forced_join_channels_json', '[]'],
      ['trial_enabled', 'true'],
      ['trial_gb', '2'],
      ['trial_days', '3'],
      ['currency', 'Toman'],
    ]);

    (mockTranslationService as Record<string, unknown>).get = vi.fn((key: string) => key);
    (mockTranslationService as Record<string, unknown>).getDefaultLocale = vi.fn(() => 'en');
    (mockTranslationService as Record<string, unknown>).getSetting = vi.fn(
      (key: string, fallback = '') => settings.get(key) ?? fallback
    );
    (mockTranslationService as Record<string, unknown>).getSettingBool = vi.fn(
      (key: string, fallback = false) => {
        const val = settings.get(key);
        if (val === undefined) return fallback;
        return val === 'true' || val === '1';
      }
    );
    (mockTranslationService as Record<string, unknown>).getSettingNum = vi.fn(
      (key: string, fallback = 0) => {
        const val = settings.get(key);
        if (val === undefined) return fallback;
        const n = Number(val);
        return Number.isFinite(n) ? n : fallback;
      }
    );
    (mockTranslationService as Record<string, unknown>).updateSetting = vi.fn(
      async (key: string, val: string) => {
        settings.set(key, val);
      }
    );

    const adapter: ForcedJoinTelegramAdapter = {
      getMe: vi.fn(async () => ({ id: 999000, username: 'test_bot' })),
      getChat: vi.fn(async (chatId) => ({
        id: -1001122334455,
        title: 'Official Channel',
        username: String(chatId).startsWith('@') ? String(chatId).slice(1) : undefined,
      })),
      getChatMember: vi.fn(async (_chatId, userId) => ({
        status: userId === 999000 ? 'administrator' : memberJoined ? 'member' : 'left',
      })),
    };

    forcedJoinService = new ForcedJoinService({
      translationService: mockTranslationService as unknown as TranslationService,
      getAdapter: () => adapter,
      isAdmin: (id) => id === 12345,
    });

    const sampleJob: BulkGiftJob = {
      id: '11111111-1111-1111-1111-111111111111',
      actorTelegramId: 12345,
      giftGb: 10,
      giftDays: 5,
      targetStatuses: '["active"]',
      panelId: null,
      serviceId: null,
      notifyMessage: 'Bonus!',
      status: 'queued',
      totalCount: 4,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdAt: new Date('2026-11-24T00:00:00Z'),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date('2026-11-24T00:00:00Z'),
    };

    mockBulkGiftService = {
      listRecentJobs: vi.fn(async () => ({
        items: [sampleJob],
        total: 1,
        page: 1,
        totalPages: 1,
        activeCount: 1,
      })),
      getJob: vi.fn(async (id: string) => (id === sampleJob.id ? sampleJob : undefined)),
      previewTargets: vi.fn(async () => ({ configCount: 4, userCount: 3 })),
      createJob: vi.fn(async () => sampleJob),
      requestCancel: vi.fn(async () => true),
    };

    (mockUserService as Record<string, unknown>).isBanned = vi.fn(async () => false);
    (mockUserService as Record<string, unknown>).findProfile = vi.fn(async (id: string) => ({
      id: 'u_1',
      telegramId: Number(id),
      username: 'member_user',
      firstName: 'Member',
      lastName: null,
      balance: 200_000,
      reservedBalance: 0,
      referralCode: 'REF001',
      totalSpend: 0,
      activeSubscriptionCount: 1,
      transactionCount: 1,
      referredUserCount: 0,
      referralBonusEarned: 0,
      cashbackEarned: 0,
      hasUsedTrial: false,
      createdAt: new Date().toISOString(),
    }));
    (mockWalletService as Record<string, unknown>).getOrCreateUser = vi.fn(async (id: number) => ({
      telegramId: id,
      balance: 200_000,
    }));

    mockServices.forcedJoinService = forcedJoinService;
    mockServices.bulkGiftService = mockBulkGiftService as unknown as BulkGiftService;
    mockServices.trialService = {
      claimTrial: vi.fn(async () => ({ success: true, subUrl: 'https://sub.example/t' })),
    } as never;
    mockServices.configService = {
      generateConfigName: vi.fn(async () => 'trial_55555'),
      getOwnedConfigById: vi.fn(async (_tgId: number, configId: string) => ({
        id: configId,
        panelId: 'default',
        serviceId: 1,
        configUsername: 'existing_cfg',
        panelStatus: 'active',
        panelDataLimit: 20 * 1024 ** 3,
        panelUsedTraffic: 2 * 1024 ** 3,
        panelExpire: Math.floor(Date.now() / 1000) + 10 * 86_400,
      })),
    } as never;
    mockServices.pricingService = {
      getPackageById: vi.fn(() => ({
        id: 'pkg_1',
        name: '30 GB - 30 Days',
        gbAmount: 30,
        durationDays: 30,
        price: 100_000,
        enabled: true,
      })),
      getPackages: vi.fn(() => [
        {
          id: 'pkg_1',
          name: '30 GB - 30 Days',
          gbAmount: 30,
          durationDays: 30,
          price: 100_000,
          enabled: true,
        },
      ]),
      resolvePackageTarget: vi.fn(() => ({ panelId: 'default', serviceId: 1 })),
    } as never;
    mockServices.purchaseCheckoutService = {
      create: vi.fn(async (input) => ({
        id: 'chk_1',
        packageId: input.pkg.id,
        packageName: input.pkg.name,
        gbAmount: input.pkg.gbAmount,
        durationDays: input.pkg.durationDays,
        amount: input.quotedAmount,
        quotedAmount: input.quotedAmount,
        expiresAt: new Date(Date.now() + 600_000),
      })),
    } as never;

    app = await createWebAppServer(createTestConfig(), mockServices, {
      serveStatic: false,
      rateLimitStore: rateLimitStore.Store,
    });

    adminToken = app.jwt.sign({ telegramId: 12345, role: 'admin' });
    userToken = app.jwt.sign({ telegramId: 55555, role: 'user' });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    rateLimitStore.reset();
    memberJoined = false;
    forcedJoinService.invalidateAllCache();
    await forcedJoinService.setScope('off');
    for (const ch of forcedJoinService.listChannels()) {
      await forcedJoinService.deleteChannel(ch.id);
    }
    vi.clearAllMocks();
  });

  it('enforces global forced join (scope=all) in userGuard, bypasses admins, and unlocks via /api/user/forced-join/check', async () => {
    await forcedJoinService.addChannel({ channelId: '@main_gate', title: 'Main Gate' });
    await forcedJoinService.setScope('all');

    // Unjoined user gets 403 CHANNEL_JOIN_REQUIRED with channels payload
    const blockedRes = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(blockedRes.statusCode).toBe(403);
    const blockedBody = blockedRes.json();
    expect(blockedBody.code).toBe('CHANNEL_JOIN_REQUIRED');
    expect(blockedBody.scope).toBe('all');
    expect(blockedBody.channels).toHaveLength(1);
    expect(blockedBody.channels[0].channelId).toBe('@main_gate');

    // Admin always bypasses userGuard forced join
    const adminProfileRes = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminProfileRes.statusCode).toBe(200);

    // Verification endpoint stays reachable while locked
    const checkStillMissing = await app.inject({
      method: 'POST',
      url: '/api/user/forced-join/check',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { action: 'any' },
    });
    expect(checkStillMissing.statusCode).toBe(200);
    expect(checkStillMissing.json()).toMatchObject({ joined: false, scope: 'all' });

    // User joins channel and clicks Re-check -> cache invalidated immediately -> unlocked!
    memberJoined = true;
    const checkJoined = await app.inject({
      method: 'POST',
      url: '/api/user/forced-join/check',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { action: 'any' },
    });
    expect(checkJoined.statusCode).toBe(200);
    expect(checkJoined.json()).toMatchObject({ joined: true, channels: [] });

    const unlockedRes = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(unlockedRes.statusCode).toBe(200);
  });

  it('enforces purchase_and_trial on trial & new purchases while keeping renewals unblocked', async () => {
    await forcedJoinService.addChannel({ channelId: '@shop_gate', title: 'Shop Gate' });
    await forcedJoinService.setScope('purchase_and_trial');

    // Profile stays accessible
    const profileRes = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(profileRes.statusCode).toBe(200);

    // Free trial is blocked with 403 CHANNEL_JOIN_REQUIRED
    const trialRes = await app.inject({
      method: 'POST',
      url: '/api/user/trial/claim',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(trialRes.statusCode).toBe(403);
    expect(trialRes.json().code).toBe('CHANNEL_JOIN_REQUIRED');

    // New purchase checkout is blocked with 403 CHANNEL_JOIN_REQUIRED
    const newBuyRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { kind: 'new_config', packageId: 'pkg_1' },
    });
    expect(newBuyRes.statusCode).toBe(403);
    expect(newBuyRes.json().code).toBe('CHANNEL_JOIN_REQUIRED');

    // Renewal checkout is NEVER blocked under purchase_and_trial!
    const renewRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { kind: 'renew_config', configId: 'cfg_existing', packageId: 'pkg_1' },
    });
    expect(renewRes.statusCode).toBe(201);
  });

  it('exposes admin Forced Join CRUD + test access and Bulk Gift preview/create/list/cancel APIs', async () => {
    // Non-admin rejected
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/forced-join',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Admin tests bot access & adds channel
    const testRes = await app.inject({
      method: 'POST',
      url: '/api/admin/forced-join/test',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { channelId: '@my_channel' },
    });
    expect(testRes.statusCode).toBe(200);
    expect(testRes.json()).toMatchObject({
      ok: true,
      isAdmin: true,
      chatTitle: 'Official Channel',
    });

    const addRes = await app.inject({
      method: 'POST',
      url: '/api/admin/forced-join/channels',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { channelId: '@my_channel', title: 'Official Channel' },
    });
    expect(addRes.statusCode).toBe(201);
    const channelId = addRes.json().channel.id as string;

    const scopeRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/forced-join/scope',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scope: 'trial_only' },
    });
    expect(scopeRes.statusCode).toBe(200);
    expect(scopeRes.json().scope).toBe('trial_only');

    const toggleRes = await app.inject({
      method: 'POST',
      url: `/api/admin/forced-join/channels/${channelId}/toggle`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    expect(toggleRes.statusCode).toBe(200);
    expect(toggleRes.json().channel.enabled).toBe(false);

    // Bulk Gift preview, create, list, cancel
    const previewRes = await app.inject({
      method: 'POST',
      url: '/api/admin/bulk-gift/preview',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { targetStatuses: ['active', 'on_hold'] },
    });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json()).toEqual({ configCount: 4, userCount: 3 });

    const createJobRes = await app.inject({
      method: 'POST',
      url: '/api/admin/bulk-gift/jobs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        giftGb: 10,
        giftDays: 5,
        targetStatuses: ['active'],
        notifyMessage: 'Bonus!',
      },
    });
    expect(createJobRes.statusCode).toBe(201);
    const jobId = createJobRes.json().job.id as string;

    const listJobsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/bulk-gift/jobs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listJobsRes.statusCode).toBe(200);
    expect(listJobsRes.json().items).toHaveLength(1);

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/admin/bulk-gift/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().requested).toBe(true);
    expect(mockBulkGiftService.requestCancel).toHaveBeenCalledWith(jobId, 12345);
  });
});
