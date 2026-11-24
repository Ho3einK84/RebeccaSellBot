import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Api } from 'grammy';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  TEST_BOT_TOKEN,
  createMockBaseServices,
  createMockUserServices,
  createResettableRateLimitStore,
  createSignedInitData,
  createTestConfig,
} from './helpers/webappTestHarness.js';
import { runNotifierSweep, type ConfigNotificationRecipient } from '../../src/jobs/notifier.js';
import { runAutoRenewalSweep } from '../../src/jobs/autoRenewal.js';
import {
  runFirstUseNudgeCycle,
  type FirstUseNudgeCandidate,
} from '../../src/jobs/firstUseNudge.js';
import {
  runExpiredConfigCleanupCycle,
  type ExpiredConfigCandidate,
} from '../../src/jobs/expiredConfigCleanup.js';
import { sendWebAppConfigArtifact } from '../../src/telegram/webappNotifications.js';
import { processNextBulkGift } from '../../src/jobs/bulkGift.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';

describe('WebApp Registration Control & Service Personal Label Routes', () => {
  describe('Registration Mode Enforcement (/api/auth/telegram-validate & userGuard)', () => {
    let app: FastifyInstance;
    const rateLimits = createResettableRateLimitStore();
    const getOrCreateUser = vi.fn(async (telegramId: number) => ({
      id: `u_${telegramId}`,
      telegramId,
      username: `u_${telegramId}`,
      locale: 'fa',
      localeManual: false,
      isBanned: false,
      balance: 0,
      reservedBalance: 0,
    }));
    const resolveReferrerId = vi.fn(async (code: string | undefined) =>
      code === 'ref_friend_55555' ? 55555 : undefined
    );

    const base = createMockBaseServices({
      walletService: { getOrCreateUser } as never,
      referralService: { resolveReferrerId } as never,
      configService: { listConfigsForOwner: vi.fn(async () => []) } as never,
    });

    const mockConfig = createTestConfig();
    let currentRegMode = 'open';

    beforeAll(async () => {
      app = await createWebAppServer(mockConfig, base.mockServices, {
        serveStatic: false,
        rateLimitStore: rateLimits.Store,
      });
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      rateLimits.reset();
      currentRegMode = 'open';
      base.mockTranslationService.getSetting.mockImplementation((key: string, fallback = '') =>
        key === 'registration_mode' ? currentRegMode : fallback
      );
      base.mockTranslationService.getSettingBool.mockImplementation((key: string, fb = false) => {
        if (key === 'language_selection_enabled' || key === 'webapp_enabled') return true;
        return fb;
      });
      (base.mockUserService as { exists: ReturnType<typeof vi.fn> }).exists.mockImplementation(
        async (id: number) => id === 55555
      );
      resolveReferrerId.mockImplementation(async (code: string | undefined) =>
        code === 'ref_friend_55555' ? 55555 : undefined
      );
    });

    it('blocks unregistered non-admin visitors with 403 REGISTRATION_CLOSED without creating user or cookie', async () => {
      currentRegMode = 'closed';
      const initData = createSignedInitData({ userId: 777001, botToken: TEST_BOT_TOKEN });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'REGISTRATION_CLOSED',
        registrationMode: 'closed',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(getOrCreateUser).not.toHaveBeenCalled();

      // Already-registered users and admins are never blocked even in closed mode
      const existingInitData = createSignedInitData({ userId: 55555, botToken: TEST_BOT_TOKEN });
      const existingRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData: existingInitData },
      });
      expect(existingRes.statusCode).toBe(200);

      const adminInitData = createSignedInitData({ userId: 12345, botToken: TEST_BOT_TOKEN });
      const adminRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData: adminInitData },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('enforces invite_only on start_param and allows valid referral links', async () => {
      currentRegMode = 'invite_only';

      const noRefInitData = createSignedInitData({ userId: 777002, botToken: TEST_BOT_TOKEN });
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData: noRefInitData },
      });
      expect(blockedRes.statusCode).toBe(403);
      expect(blockedRes.json()).toMatchObject({
        code: 'REGISTRATION_INVITE_ONLY',
        registrationMode: 'invite_only',
      });
      expect(getOrCreateUser).not.toHaveBeenCalled();

      const withRefInitData = createSignedInitData({
        botToken: TEST_BOT_TOKEN,
        fields: {
          auth_date: String(Math.floor(Date.now() / 1000)),
          start_param: 'ref_friend_55555',
          user: JSON.stringify({ id: 777003, first_name: 'Invited' }),
        },
      });
      const allowedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: { initData: withRefInitData },
      });
      expect(allowedRes.statusCode).toBe(200);
      expect(getOrCreateUser).toHaveBeenCalledWith(
        777003,
        null,
        'Invited',
        null,
        'ref_friend_55555',
        'fa',
        'webapp_referral'
      );
    });

    it('also enforces registration_mode in userGuard for /api/user/* endpoints', async () => {
      currentRegMode = 'closed';
      const forgedNewUserToken = app.jwt.sign({ telegramId: 888999, role: 'user' });
      const blocked = await app.inject({
        method: 'GET',
        url: '/api/user/configs',
        cookies: { session: forgedNewUserToken },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({ code: 'REGISTRATION_CLOSED' });

      const existingToken = app.jwt.sign({ telegramId: 55555, role: 'user' });
      const allowed = await app.inject({
        method: 'GET',
        url: '/api/user/configs',
        cookies: { session: existingToken },
      });
      expect(allowed.statusCode).toBe(200);
    });
  });

  describe('User Config Label API Routes', () => {
    let app: FastifyInstance;
    const rateLimits = createResettableRateLimitStore();
    const userHarness = createMockUserServices();
    const mockConfig = createTestConfig();

    beforeAll(async () => {
      app = await createWebAppServer(mockConfig, userHarness.mockServices, {
        serveStatic: false,
        rateLimitStore: rateLimits.Store,
      });
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      rateLimits.reset();
    });

    const userToken = () => app.jwt.sign({ telegramId: 55555, role: 'user' });

    it('exposes userLabel on GET /api/user/configs and renewal-options, and updates/clears via PATCH /api/user/configs/:id/label', async () => {
      const getConfigsRes = await app.inject({
        method: 'GET',
        url: '/api/user/configs',
        cookies: { session: userToken() },
      });
      expect(getConfigsRes.statusCode).toBe(200);
      expect(getConfigsRes.json().configs[0]).toHaveProperty('userLabel', null);

      const renewalOptsRes = await app.inject({
        method: 'GET',
        url: '/api/user/configs/cfg_1/renewal-options',
        cookies: { session: userToken() },
      });
      expect(renewalOptsRes.statusCode).toBe(200);
      expect(renewalOptsRes.json().config).toHaveProperty('userLabel', null);

      const saveRes = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_1/label',
        cookies: { session: userToken() },
        payload: { label: '  گوشی\u200cمن  ' },
      });
      expect(saveRes.statusCode).toBe(200);
      expect(saveRes.json()).toEqual({
        success: true,
        id: 'cfg_1',
        configUsername: 'u55555_srv1',
        userLabel: 'گوشی\u200cمن',
      });
      expect(userHarness.mockConfigService.setUserLabel).toHaveBeenCalledWith(
        55555,
        'cfg_1',
        'گوشی\u200cمن'
      );

      const clearRes = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_1/label',
        cookies: { session: userToken() },
        payload: { label: '   ' },
      });
      expect(clearRes.statusCode).toBe(200);
      expect(clearRes.json().userLabel).toBeNull();
    });

    it('enforces validation (>40 chars), ownership (403), and missing config (404) on PATCH /label', async () => {
      const tooLong = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_1/label',
        cookies: { session: userToken() },
        payload: { label: 'a'.repeat(41) },
      });
      expect(tooLong.statusCode).toBe(400);
      expect(tooLong.json()).toMatchObject({ code: 'USER_LABEL_TOO_LONG', maxLength: 40 });

      const nonString = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_1/label',
        cookies: { session: userToken() },
        payload: { label: 12345 },
      });
      expect(nonString.statusCode).toBe(400);
      expect(nonString.json()).toMatchObject({ code: 'INVALID_USER_LABEL' });

      const notOwned = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_other_user/label',
        cookies: { session: userToken() },
        payload: { label: 'stolen' },
      });
      expect(notOwned.statusCode).toBe(403);
      expect(notOwned.json()).toMatchObject({ code: 'OWNER_MISMATCH' });

      const missing = await app.inject({
        method: 'PATCH',
        url: '/api/user/configs/cfg_missing/label',
        cookies: { session: userToken() },
        payload: { label: 'valid' },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    });
  });

  describe('Notifications display userLabel alongside configUsername', () => {
    it('renders userLabel in notifier, autoRenewal, firstUseNudge, expiredCleanup, webappNotifications, and bulkGift', async () => {
      const ts = new TranslationService();
      const now = new Date('2026-11-24T12:00:00Z');
      const remoteExpired = {
        username: 'cfg_u1',
        status: 'active',
        data_limit: 20 * 1024 ** 3,
        used_traffic: 19.5 * 1024 ** 3,
        lifetime_used_traffic: 19.5 * 1024 ** 3,
        expire: Math.floor(now.getTime() / 1000) + 86_400,
        created_at: '2026-01-01T00:00:00Z',
        proxies: {},
        inbounds: {},
        links: [],
        subscription_url: 'https://panel.example/sub/cfg_u1',
        subscription_urls: {},
      };

      // 1. Notifier
      const notifierApi = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as unknown as Api;
      const recipients: ConfigNotificationRecipient[] = [
        {
          configId: 'c1',
          panelId: 'legacy',
          serviceId: 1,
          configUsername: 'cfg_u1',
          userLabel: 'گوشی شخصی',
          telegramId: 1001,
          locale: 'en',
        },
      ];
      await runNotifierSweep(
        { getUser: vi.fn(async () => remoteExpired) } as never,
        ts,
        notifierApi,
        {
          listConfigs: vi.fn(async () => recipients),
          reserve: vi.fn(async () => true),
          deactivate: vi.fn(async () => {}),
          release: vi.fn(async () => {}),
        },
        now
      );
      expect((notifierApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toContain(
        '`cfg_u1` (گوشی شخصی)'
      );

      // 2. AutoRenewal low balance
      const autoRenewApi = {
        sendMessage: vi.fn(async () => ({ message_id: 2 })),
      } as unknown as Api;
      await runAutoRenewalSweep(
        { getUser: vi.fn(async () => remoteExpired) } as never,
        { getAvailableBalance: vi.fn(async () => 0) } as never,
        {
          getPackages: vi.fn(() => [
            { id: 'p1', name: '10G', gbAmount: 10, durationDays: 30, price: 50_000, enabled: true },
          ]),
        } as never,
        ts,
        autoRenewApi,
        {
          listEnabledConfigs: vi.fn(async () => [
            {
              configId: 'c1',
              panelId: 'legacy',
              serviceId: 1,
              configUsername: 'cfg_u1',
              userLabel: 'My Laptop',
              telegramId: 1001,
              locale: 'en',
              autoRenewEnabled: true,
              autoRenewPackageId: 'p1',
              autoRenewPrice: 50_000,
            },
          ]),
        },
        {
          listConfigs: vi.fn(async () => []),
          reserve: vi.fn(async () => true),
          deactivate: vi.fn(async () => {}),
          release: vi.fn(async () => {}),
        },
        now
      );
      expect((autoRenewApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toContain(
        '`cfg_u1` (My Laptop)'
      );

      // 3. First-use nudge
      vi.spyOn(ts, 'getSetting').mockImplementation((k, fb = '') =>
        k === 'first_use_nudge_enabled' || k === 'expired_cleanup_enabled' ? 'true' : fb
      );
      const nudgeApi = { sendMessage: vi.fn(async () => ({ message_id: 3 })) };
      const candidate: FirstUseNudgeCandidate = {
        id: 'c1',
        telegramId: 1001,
        panelId: 'legacy',
        configUsername: 'cfg_u1',
        userLabel: 'Router Home',
        createdAt: new Date(now.getTime() - 36 * 3_600_000),
        locale: 'en',
      };
      await runFirstUseNudgeCycle(
        {
          panels: {
            getUser: vi.fn(async () => ({
              ...remoteExpired,
              used_traffic: 0,
              lifetime_used_traffic: 0,
            })),
          } as never,
          translationService: ts,
          telegramApi: nudgeApi as never,
          store: {
            listCandidates: vi.fn(async () => [candidate]),
            claimFirstUseCheck: vi.fn(async () => true),
            recordDelivery: vi.fn(async () => true),
          },
        },
        now
      );
      expect(nudgeApi.sendMessage.mock.calls[0]?.[1]).toContain('Router Home');

      // 4. Expired cleanup first warning (12d past expiry with 14d default grace => 2 days left <= 3 warn threshold)
      const cleanupApi = { sendMessage: vi.fn(async () => ({ message_id: 4 })) };
      const expiredTimestampSec = Math.floor(now.getTime() / 1000) - 12 * 86_400;
      const expCandidate: ExpiredConfigCandidate = {
        id: 'c2',
        telegramId: 1001,
        panelId: 'legacy',
        configUsername: 'cfg_exp',
        userLabel: 'Work Tag',
        panelStatus: 'expired',
        panelExpire: expiredTimestampSec,
        cleanupHoldUntil: null,
        locale: 'en',
      };
      await runExpiredConfigCleanupCycle(
        {
          panels: {
            getUser: vi.fn(async () => ({
              ...remoteExpired,
              status: 'expired',
              expire: expiredTimestampSec,
            })),
          } as never,
          configService: { deleteConfigCompletely: vi.fn(async () => true) } as never,
          translationService: ts,
          telegramApi: cleanupApi as never,
          store: {
            listExpiredCandidates: vi.fn(async () => [expCandidate]),
            syncLocalConfigCache: vi.fn(async () => {}),
            reserveWarning: vi.fn(async () => true),
            releaseWarning: vi.fn(async () => {}),
            clearWarnings: vi.fn(async () => {}),
            recordCleanupAudit: vi.fn(async () => {}),
          },
        },
        now
      );
      expect(cleanupApi.sendMessage.mock.calls[0]?.[1]).toContain('Work Tag');

      // 5. WebApp artifact notification
      const artifactApi = { sendMessage: vi.fn(async () => ({ message_id: 5 })) } as unknown as Api;
      await sendWebAppConfigArtifact(
        artifactApi,
        {
          userService: { getLocale: vi.fn(async () => 'en') } as never,
          translationService: ts,
        },
        {
          telegramId: 1001,
          kind: 'revoke',
          configUsername: 'cfg_u1',
          userLabel: 'iPad',
          configId: 'c1',
          subUrl: 'https://panel.example/sub/new',
        }
      );
      expect((artifactApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toContain(
        '`cfg_u1` (iPad)'
      );

      // 6. BulkGift worker
      const giftApi = { sendMessage: vi.fn(async () => ({ message_id: 6 })) };
      const bulkJob = {
        id: 'bg_1',
        giftGb: 5,
        giftDays: 0,
        notifyMessage: 'Enjoy!',
        status: 'running',
      };
      await processNextBulkGift(
        {
          requeueStaleClaims: vi.fn(async () => 0),
          nextRunnableJob: vi.fn(async () => bulkJob),
          markRunning: vi.fn(async () => bulkJob),
          getJob: vi.fn(async () => bulkJob),
          claimBatch: vi
            .fn()
            .mockResolvedValueOnce([
              { id: 'bgi_1', configId: 'c1', telegramId: 1001, configUsername: 'cfg_u1' },
            ])
            .mockResolvedValueOnce([]),
          finalizeCompleted: vi.fn(async () => {}),
          applyGiftToItem: vi.fn(async () => ({ status: 'applied' })),
          markItemNotified: vi.fn(async () => {}),
        } as never,
        {
          telegramApi: giftApi as never,
          userService: { getLocale: vi.fn(async () => 'en') } as never,
          configService: {
            getConfigById: vi.fn(async () => ({ userLabel: 'VIP Phone' })),
          } as never,
          translationService: ts,
          interBatchDelayMs: 0,
        }
      );
      expect(giftApi.sendMessage.mock.calls[0]?.[1]).toContain('`cfg_u1` (VIP Phone)');
    });
  });
});
