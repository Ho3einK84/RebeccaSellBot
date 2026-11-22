import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { RebeccaOriginDownError } from '../../src/domain/services/RebeccaService.js';
import {
  TEST_BOT_TOKEN,
  createMockAdminServices,
  createTestConfig,
} from './helpers/webappTestHarness.js';

describe('WebApp Server & Admin Routes', () => {
  let app: FastifyInstance;
  const {
    mockServices,
    mockAdminService,
    mockWalletService,
    mockUserService,
    mockConfigService,
    mockTranslationService,
    mockPanelRegistry,
  } = createMockAdminServices();
  const mockConfig = createTestConfig();

  beforeEach(async () => {
    app = await createWebAppServer(mockConfig, mockServices);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  const getAdminToken = () => {
    return app.jwt.sign({ telegramId: 12345, role: 'admin' });
  };

  const getUserToken = () => {
    return app.jwt.sign({ telegramId: 55555, role: 'user' });
  };

  describe('Auth Guard (403 on every /api/admin/* route)', () => {
    const adminEndpoints = [
      { method: 'GET' as const, url: '/api/admin/stats' },
      { method: 'GET' as const, url: '/api/admin/receipts' },
      {
        method: 'POST' as const,
        url: '/api/admin/receipts/rec_1/action',
        payload: { action: 'approve' },
      },
      {
        method: 'POST' as const,
        url: '/api/admin/receipts/batch-action',
        payload: { action: 'approve', ids: ['rec_1'] },
      },
      { method: 'GET' as const, url: '/api/admin/receipts/settings' },
      { method: 'GET' as const, url: '/api/admin/users' },
      { method: 'GET' as const, url: '/api/admin/users/55555' },
      {
        method: 'POST' as const,
        url: '/api/admin/users/55555/balance',
        payload: { operation: 'add', amount: 100, reason: 'test' },
      },
      { method: 'GET' as const, url: '/api/admin/panels' },
    ];

    for (const ep of adminEndpoints) {
      it(`returns 403 for unauthenticated ${ep.method} ${ep.url}`, async () => {
        const response = await app.inject({
          method: ep.method,
          url: ep.url,
          payload: ep.payload,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Forbidden' });
      });

      it(`returns 403 for non-admin user session on ${ep.method} ${ep.url}`, async () => {
        const userToken = getUserToken();
        const response = await app.inject({
          method: ep.method,
          url: ep.url,
          headers: {
            authorization: `Bearer ${userToken}`,
          },
          payload: ep.payload,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Forbidden' });
      });
    }
  });

  describe('Admin Endpoints with Admin Session', () => {
    it('GET /api/admin/stats returns dashboard metrics and panel health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/stats',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.stats.totalUsers).toBe(100);
      expect(data.stats.dailyRevenue).toBe(50_000);
      expect(data.panelHealth.healthy).toBe(2);
    });

    it('GET /api/admin/receipts returns pending receipts queue', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts?page=1&limit=10',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe('rec_1001');
    });

    it('POST /api/admin/receipts/:id/action approves receipt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        result: { telegramId: 55555, amount: 100_000 },
      });
      expect(mockWalletService.approveTopup).toHaveBeenCalledWith('rec_1001', 12345);
    });

    it('POST /api/admin/receipts/:id/action rejects receipt via WalletService without duplicate audit action', async () => {
      mockUserService.recordAdminAction.mockClear();
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'reject', reason: 'Unreadable receipt screenshot' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockWalletService.rejectTopup).toHaveBeenCalledWith(
        'rec_1001',
        12345,
        'Unreadable receipt screenshot'
      );
      expect(mockUserService.recordAdminAction).not.toHaveBeenCalled();
    });

    it('POST /api/admin/receipts/:id/action rejects without reason returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'reject' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('reason');
    });

    it('POST /api/admin/receipts/batch-action approves receipts in bulk', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/batch-action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve', ids: ['rec_1001'] },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(data.approvedCount).toBe(1);
      expect(mockWalletService.approveTopup).toHaveBeenCalledWith('rec_1001', 12345);
    });

    it('POST /api/admin/receipts/batch-action rejects empty ids array with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/batch-action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve', ids: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('receipt IDs');
    });

    it('GET /api/admin/receipts/settings returns notification settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/settings',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('enabled');
      expect(data).toHaveProperty('mode');
      expect(data).toHaveProperty('admins');
      expect(data).toHaveProperty('allAdmins');
      expect(data.allAdmins).toContain(12345);
    });

    it('PUT /api/admin/receipts/settings updates notification configuration', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/receipts/settings',
        cookies: { session: getAdminToken() },
        payload: {
          enabled: false,
          mode: 'simple',
          admins: [12345],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(mockTranslationService.updateSetting).toHaveBeenCalledWith(
        'receipt_notify_enabled',
        'false'
      );
      expect(mockTranslationService.updateSetting).toHaveBeenCalledWith(
        'receipt_notify_mode',
        'simple'
      );
      expect(mockTranslationService.updateSetting).toHaveBeenCalledWith(
        'receipt_notify_admins',
        '12345'
      );
    });

    it('GET /api/admin/users lists users and supports search', async () => {
      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/users?page=1&limit=10',
        cookies: { session: getAdminToken() },
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().users.length).toBe(1);

      const searchResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/users?search=testuser',
        cookies: { session: getAdminToken() },
      });
      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.json().users[0].username).toBe('testuser');
      expect(mockUserService.searchProfiles).toHaveBeenCalledWith('testuser', 10);
    });

    it('GET /api/admin/users/:id returns user summary report', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/users/55555',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.summary.totalDeposit).toBe(150_000);
      expect(data.summary.user.telegramId).toBe(55555);
    });

    it('POST /api/admin/users/:id/balance modifies balance with mandatory reason', async () => {
      // Missing / empty reason should fail with 400
      const emptyReasonRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/balance',
        cookies: { session: getAdminToken() },
        payload: { operation: 'add', amount: 50_000, reason: '' },
      });
      expect(emptyReasonRes.statusCode).toBe(400);

      // Valid adjustment
      const validRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/balance',
        cookies: { session: getAdminToken() },
        payload: { operation: 'add', amount: 50_000, reason: 'Compensation bonus' },
      });
      expect(validRes.statusCode).toBe(200);
      expect(validRes.json()).toEqual({ success: true, balance: 150_000 });
      expect(mockWalletService.adjustBalanceAdmin).toHaveBeenCalledWith({
        telegramId: 55555,
        operation: 'add',
        amount: 50_000,
        adminId: 12345,
        description: 'Compensation bonus',
      });
      expect(mockUserService.recordAdminAction).toHaveBeenCalled();
    });

    it('GET /api/admin/users/:id returns configs and transactions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/users/55555',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data.configs)).toBe(true);
      expect(data.configs.length).toBe(1);
      expect(data.configs[0].configUsername).toBe('cfg_test');
      expect(data.configs[0].panelName).toBe('Main Germany Panel');
      expect(Array.isArray(data.transactions)).toBe(true);
    });

    it('POST /api/admin/users/:id/ban sets banned state and records audit', async () => {
      const banRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/ban',
        cookies: { session: getAdminToken() },
        payload: { isBanned: true, reason: 'Abuse detected' },
      });

      expect(banRes.statusCode).toBe(200);
      expect(banRes.json()).toEqual({ success: true, isBanned: true });
      expect(mockUserService.setBanned).toHaveBeenCalledWith(55555, true, 12345);
      expect(mockUserService.recordAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_ban_user_with_reason',
          targetTelegramId: 55555,
        })
      );
    });

    it('POST /api/admin/users/:id/configs/:configUsername/toggle toggles config state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/configs/cfg_test/toggle',
        cookies: { session: getAdminToken() },
        payload: { panelId: 'panel_1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, status: 'disabled' });
      expect(mockConfigService.toggleConfig).toHaveBeenCalledWith('cfg_test', 'panel_1');
    });

    it('POST /api/admin/users/:id/configs/:configUsername/reset-usage resets traffic', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/configs/cfg_test/reset-usage',
        cookies: { session: getAdminToken() },
        payload: { panelId: 'panel_1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockConfigService.resetUsage).toHaveBeenCalledWith('cfg_test', 'panel_1');
    });

    it('POST /api/admin/users/:id/configs/:configUsername/revoke rotates sub url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/configs/cfg_test/revoke',
        cookies: { session: getAdminToken() },
        payload: { panelId: 'panel_1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, subUrl: 'https://sub.example.com/new-token' });
      expect(mockConfigService.revokeSubscription).toHaveBeenCalledWith('cfg_test', 'panel_1');
    });

    it('POST /api/admin/users/:id/configs/:configUsername/sync gets live detail', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/configs/cfg_test/sync',
        cookies: { session: getAdminToken() },
        payload: { panelId: 'panel_1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().detail.username).toBe('cfg_test');
    });

    it('GET /api/admin/panels returns panel registry list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/panels',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.panels.length).toBe(2);
      expect(data.panels[0].name).toBe('Main Germany Panel');
    });

    it('GET /api/admin/receipts/:id/photo returns 404 for unknown receipt', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/rec_missing/photo',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects query token on non-photo admin endpoints while accepting on photo endpoint', async () => {
      const adminToken = getAdminToken();

      // 1. Non-photo admin endpoints reject query token (403)
      const statsRes = await app.inject({
        method: 'GET',
        url: `/api/admin/stats?token=${adminToken}`,
      });
      expect(statsRes.statusCode).toBe(403);
      expect(statsRes.json()).toEqual({ error: 'Forbidden' });

      const receiptsRes = await app.inject({
        method: 'GET',
        url: `/api/admin/receipts?token=${adminToken}`,
      });
      expect(receiptsRes.statusCode).toBe(403);
      expect(receiptsRes.json()).toEqual({ error: 'Forbidden' });

      // 2. Photo endpoint accepts query token (even without cookies or headers)
      const photoRes = await app.inject({
        method: 'GET',
        url: `/api/admin/receipts/rec_missing/photo?token=${adminToken}`,
      });
      // Auth passed, handler executed and returned 404 for missing receipt (not 403 Forbidden)
      expect(photoRes.statusCode).toBe(404);
      expect(photoRes.json()).toEqual({ error: 'Receipt not found' });
    });

    it('rejects a signed JWT when the admin was removed from the registry', async () => {
      mockAdminService.isAdmin.mockReturnValueOnce(false);
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/stats',
        cookies: { session: getAdminToken() },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/admin/panels', () => {
    it('returns enriched panels list with fleetSummary, health and usage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/panels',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.panels).toHaveLength(2);
      expect(data.panels[0].id).toBe('panel_1');
      expect(data.panels[0].activeConfigsCount).toBe(5);
      expect(data.panels[0].healthy).toBe(true);
      expect(data.panels[0].packagesCount).toBe(1);
      expect(data.panels[0].services[0].isCustomTarget).toBe(true);
      expect(data.fleetSummary).toEqual(
        expect.objectContaining({
          totalPanels: 2,
          healthyPanels: 2,
          disabledPanels: 0,
          unhealthyPanels: 0,
          totalActiveConfigs: 10,
          allHealthy: true,
        })
      );
    });
  });

  describe('POST /api/admin/panels', () => {
    it('creates a new panel successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
        payload: {
          name: 'New Node Panel',
          baseUrl: 'https://new-panel.example.com',
          apiKey: 'api-secret-token',
          serviceId: 2,
          serviceName: 'V2Ray Service',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.panel.name).toBe('New Node Panel');
      expect(mockPanelRegistry.createPanel).toHaveBeenCalled();
    });

    it('rejects panel with invalid URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
        payload: {
          name: 'Invalid URL Panel',
          baseUrl: 'ftp://not-allowed.com',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });
  });

  describe('PATCH /api/admin/panels/:id', () => {
    it('updates panel details successfully', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/panels/panel_1',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
        payload: {
          name: 'Updated Panel Name',
          baseUrl: 'https://updated-panel.example.com',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.updatePanel).toHaveBeenCalledWith('panel_1', {
        name: 'Updated Panel Name',
        baseUrl: 'https://updated-panel.example.com',
      });
    });
  });

  describe('POST /api/admin/panels/:id/toggle', () => {
    it('toggles panel enabled state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_2/toggle',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, enabled: false });
      expect(mockPanelRegistry.setPanelEnabled).toHaveBeenCalledWith('panel_2', false);
    });
  });

  describe('POST /api/admin/panels/:id/default', () => {
    it('sets default panel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_2/default',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.setDefaultPanel).toHaveBeenCalledWith('panel_2');
    });
  });

  describe('DELETE /api/admin/panels/:id', () => {
    it('deletes panel when allowed', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/panels/panel_2',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.deletePanel).toHaveBeenCalledWith('panel_2');
    });
  });

  describe('POST /api/admin/panels/:id/test', () => {
    it('tests panel connection successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_1/test',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.healthy).toBe(true);
      expect(typeof data.latencyMs).toBe('number');
    });
  });

  describe('POST /api/admin/panels/test-all', () => {
    it('tests all panels in fleet', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/test-all',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.results.panel_1.healthy).toBe(true);
      expect(data.results.panel_2.healthy).toBe(true);
    });
  });

  describe('POST /api/admin/panels/:id/services', () => {
    it('adds a new service to panel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_1/services',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
        payload: {
          serviceId: 3,
          name: 'Trojan Service',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.addService).toHaveBeenCalledWith('panel_1', 3, 'Trojan Service');
    });
  });

  describe('POST /api/admin/panels/:id/services/:serviceId/default', () => {
    it('sets default service for panel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_1/services/2/default',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.setDefaultService).toHaveBeenCalledWith('panel_1', 2);
    });
  });

  describe('POST /api/admin/panels/:id/services/:serviceId/custom-target', () => {
    it('sets custom volume target service', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/panels/panel_1/services/1/custom-target',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.resolveTarget).toHaveBeenCalledWith('panel_1', 1);
    });
  });

  describe('DELETE /api/admin/panels/:id/services/:serviceId', () => {
    it('deletes panel service', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/panels/panel_1/services/2',
        headers: {
          authorization: `Bearer ${getAdminToken()}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPanelRegistry.deleteService).toHaveBeenCalledWith('panel_1', 2);
    });
  });

  describe('Regression Tests — Photo Proxy, Validation, Batching & Audit Redaction', () => {
    it('GET /api/admin/receipts/:id/photo securely streams JPEG inline without BOT_TOKEN leak or redirect', async () => {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/getFile')) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: 'photos/receipt_1.jpg' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/rec_1001/photo',
        cookies: { session: getAdminToken() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['content-disposition']).toBe('inline; filename="receipt-rec_1001.jpg"');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(res.body).not.toContain(TEST_BOT_TOKEN);
      expect(JSON.stringify(res.headers)).not.toContain(TEST_BOT_TOKEN);
    });

    it('GET /api/admin/receipts/:id/photo?download=1 sets attachment disposition and returns 502 on upstream failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          if (String(input).includes('/getFile')) {
            return new Response(
              JSON.stringify({ ok: true, result: { file_path: 'photos/receipt_2.png' } }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        })
      );

      const downloadRes = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/rec_1001/photo?download=1',
        cookies: { session: getAdminToken() },
      });
      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.headers['content-type']).toBe('image/png');
      expect(downloadRes.headers['content-disposition']).toBe(
        'attachment; filename="receipt-rec_1001.jpg"'
      );

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Upstream Error', { status: 500 }))
      );
      const errorRes = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/rec_1001/photo',
        cookies: { session: getAdminToken() },
      });
      expect(errorRes.statusCode).toBe(502);
    });

    it('POST /api/admin/receipts/batch-action deduplicates IDs and rejects > 100 unique IDs', async () => {
      mockWalletService.approveTopup.mockClear();

      const dedupRes = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/batch-action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve', ids: [' rec_1001 ', 'rec_1001', '   '] },
      });
      expect(dedupRes.statusCode).toBe(200);
      expect(dedupRes.json().approvedCount).toBe(1);
      expect(mockWalletService.approveTopup).toHaveBeenCalledTimes(1);

      const tooManyIds = Array.from({ length: 101 }, (_, idx) => `rec_${idx + 1}`);
      const capRes = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/batch-action',
        cookies: { session: getAdminToken() },
        payload: { action: 'approve', ids: tooManyIds },
      });
      expect(capRes.statusCode).toBe(400);
      expect(capRes.json().error).toContain('100');
    });

    it('POST /api/admin/receipts/:id/action returns 404 on USER_NOT_FOUND reject and tolerates notification failures', async () => {
      mockWalletService.rejectTopup.mockRejectedValueOnce(new Error('USER_NOT_FOUND'));
      const missingUserRes = await app.inject({
        method: 'POST',
        url: '/api/admin/receipts/rec_1001/action',
        cookies: { session: getAdminToken() },
        payload: { action: 'reject', reason: 'Blurry image' },
      });
      expect(missingUserRes.statusCode).toBe(404);
      expect(missingUserRes.json().error).toBe('Receipt owner not found');

      (mockTranslationService as unknown as { t?: (k: string) => string }).t = vi.fn(
        (k: string) => k
      );
      (mockServices as unknown as { botApi?: unknown }).botApi = {
        sendMessage: vi.fn().mockRejectedValueOnce(new Error('Telegram timeout')),
      };
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/receipts/rec_1001/action',
          cookies: { session: getAdminToken() },
          payload: { action: 'reject', reason: 'Blurry image' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
      } finally {
        (mockServices as unknown as { botApi?: unknown }).botApi = undefined;
      }
    });

    it('GET /api/admin/users expands search cap for filters/sorts/pages and guards invalid pagination', async () => {
      mockUserService.searchProfiles.mockResolvedValueOnce([
        {
          telegramId: 111,
          username: 'alpha_inactive',
          firstName: 'A',
          lastName: null,
          balance: 100_000,
          totalSpend: 10_000,
          activeSubscriptionCount: 0,
          createdAt: new Date(),
        },
        {
          telegramId: 222,
          username: 'beta_low',
          firstName: 'B',
          lastName: null,
          balance: 20_000,
          totalSpend: 50_000,
          activeSubscriptionCount: 2,
          createdAt: new Date(),
        },
        {
          telegramId: 333,
          username: 'gamma_high',
          firstName: 'C',
          lastName: null,
          balance: 900_000,
          totalSpend: 500_000,
          activeSubscriptionCount: 1,
          createdAt: new Date(),
        },
      ]);

      const filteredRes = await app.inject({
        method: 'GET',
        url: '/api/admin/users?search=test&filter=active_subs&sort=balance_desc&page=2&limit=1',
        cookies: { session: getAdminToken() },
      });

      expect(filteredRes.statusCode).toBe(200);
      expect(mockUserService.searchProfiles).toHaveBeenCalledWith('test', 200);
      expect(filteredRes.json()).toMatchObject({
        total: 2,
        page: 2,
        totalPages: 2,
      });
      expect(filteredRes.json().users[0].telegramId).toBe(222);

      mockUserService.listUsers.mockClear();
      const clampedRes = await app.inject({
        method: 'GET',
        url: '/api/admin/users?page=0&limit=-5',
        cookies: { session: getAdminToken() },
      });
      expect(clampedRes.statusCode).toBe(200);
      expect(mockUserService.listUsers).toHaveBeenCalledWith(1, 10, {
        filter: undefined,
        sort: undefined,
      });
    });

    it('rejects non-positive/invalid :id (400) and maps RebeccaOriginDownError (503) on user config endpoints', async () => {
      const actions = ['toggle', 'reset-usage', 'revoke', 'sync'] as const;

      for (const action of actions) {
        const badIdRes = await app.inject({
          method: 'POST',
          url: `/api/admin/users/0/configs/cfg_test/${action}`,
          cookies: { session: getAdminToken() },
          payload: { panelId: 'panel_1' },
        });
        expect(badIdRes.statusCode).toBe(400);
        expect(badIdRes.json().error).toBe('Invalid user ID');
      }

      mockConfigService.toggleConfig.mockRejectedValueOnce(new RebeccaOriginDownError('down'));
      mockConfigService.resetUsage.mockRejectedValueOnce(new RebeccaOriginDownError('down'));
      mockConfigService.revokeSubscription.mockRejectedValueOnce(
        new RebeccaOriginDownError('down')
      );
      mockConfigService.getRemoteConfigDetail.mockRejectedValueOnce(
        new RebeccaOriginDownError('down')
      );

      for (const action of actions) {
        const downRes = await app.inject({
          method: 'POST',
          url: `/api/admin/users/55555/configs/cfg_test/${action}`,
          cookies: { session: getAdminToken() },
          payload: { panelId: 'panel_1' },
        });
        expect(downRes.statusCode).toBe(503);
        expect(downRes.json().code).toBe('PANEL_DOWN');
      }
    });

    it('validates panel POST fields and redacts apiKey in PATCH audit logs', async () => {
      const zeroServiceRes = await app.inject({
        method: 'POST',
        url: '/api/admin/panels',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: {
          name: 'Panel A',
          baseUrl: 'https://panel-a.example.com',
          serviceId: 0,
        },
      });
      expect(zeroServiceRes.statusCode).toBe(400);

      const nonStringKeyRes = await app.inject({
        method: 'POST',
        url: '/api/admin/panels',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: {
          name: 'Panel A',
          baseUrl: 'https://panel-a.example.com',
          apiKey: { secret: true },
        },
      });
      expect(nonStringKeyRes.statusCode).toBe(400);

      const badPatchKeyRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/panels/panel_1',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: { apiKey: 12345 },
      });
      expect(badPatchKeyRes.statusCode).toBe(400);

      mockUserService.recordAdminAction.mockClear();
      const secretPatchRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/panels/panel_1',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: { apiKey: 'super-secret-value' },
      });
      expect(secretPatchRes.statusCode).toBe(200);
      expect(mockUserService.recordAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_update_panel',
          metadata: expect.objectContaining({ apiKey: '[REDACTED]' }),
        })
      );

      mockUserService.recordAdminAction.mockClear();
      const clearedPatchRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/panels/panel_1',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: { apiKey: null },
      });
      expect(clearedPatchRes.statusCode).toBe(200);
      expect(mockUserService.recordAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_update_panel',
          metadata: expect.objectContaining({ apiKey: '[CLEARED]' }),
        })
      );
    });

    it('supports full Bank Cards CRUD, toggle, reorder, import-legacy, settings, and duplicate rejection via /api/admin/bank-cards', async () => {
      const store = new Map<string, string>([
        ['card_number', '6037698111306846'],
        ['card_holder', 'Hossein Karimi'],
        ['bank_cards_json', '[]'],
        ['unique_topup_amount_enabled', 'false'],
      ]);
      mockTranslationService.getSetting.mockImplementation(
        (key: string, fallback = '') => store.get(key) ?? fallback
      );
      mockTranslationService.updateSetting.mockImplementation(async (key: string, val: string) => {
        store.set(key, val);
      });
      mockTranslationService.updateSettings = vi.fn(async (pairs: Record<string, string>) => {
        for (const [k, v] of Object.entries(pairs)) store.set(k, v);
      });

      const headers = { authorization: `Bearer ${getAdminToken()}` };

      // 1. GET initial empty state with legacy default card
      const initialRes = await app.inject({ method: 'GET', url: '/api/admin/bank-cards', headers });
      expect(initialRes.statusCode).toBe(200);
      expect(initialRes.json().cards).toHaveLength(0);
      expect(initialRes.json().legacyCard).toMatchObject({
        cardNumber: '6037698111306846',
        cardHolder: 'Hossein Karimi',
        bankName: 'بانک صادرات',
      });

      // 2. Import legacy card
      const importRes = await app.inject({
        method: 'POST',
        url: '/api/admin/bank-cards/import-legacy',
        headers,
      });
      expect(importRes.statusCode).toBe(200);
      expect(importRes.json().cards).toHaveLength(1);
      const card1Id = importRes.json().cards[0].id as string;

      // 3. Reject duplicate card number (even with Persian digits & dashes)
      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/admin/bank-cards',
        headers,
        payload: {
          cardNumber: '۶۰۳۷-۶۹۸۱-۱۱۳۰-۶۸۴۶',
          cardHolder: 'Duplicate',
        },
      });
      expect(dupRes.statusCode).toBe(409);

      // 4. Add second card with auto-detected Blu Bank & daily cap
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/bank-cards',
        headers,
        payload: {
          cardNumber: '۶۲۱۹-۸۶۱۹-۱۱۱۱-۲۲۲۲',
          cardHolder: 'Ali Rezaei',
          dailyCapToman: 5_000_000,
        },
      });
      expect(createRes.statusCode).toBe(201);
      expect(createRes.json().cards).toHaveLength(2);
      expect(createRes.json().rotationActive).toBe(true);
      const card2Id = createRes.json().card.id as string;
      expect(createRes.json().card.bankName).toBe('بلوبانک (سامان)');

      // 5. Patch card 2 holder & toggle disabled
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/admin/bank-cards/${card2Id}`,
        headers,
        payload: { cardHolder: 'Ali Updated', dailyCapToman: 10_000_000 },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().card.cardHolder).toBe('Ali Updated');
      expect(patchRes.json().card.dailyCapToman).toBe(10_000_000);

      const toggleRes = await app.inject({
        method: 'POST',
        url: `/api/admin/bank-cards/${card2Id}/toggle`,
        headers,
        payload: { enabled: false },
      });
      expect(toggleRes.statusCode).toBe(200);
      expect(toggleRes.json().activeCount).toBe(1);

      // 6. Reorder
      const reorderRes = await app.inject({
        method: 'POST',
        url: '/api/admin/bank-cards/reorder',
        headers,
        payload: { orderedIds: [card2Id, card1Id] },
      });
      expect(reorderRes.statusCode).toBe(200);
      expect(reorderRes.json().cards[0].id).toBe(card2Id);

      // 7. Settings toggle uniqueTopupAmountEnabled
      const settingsRes = await app.inject({
        method: 'PUT',
        url: '/api/admin/bank-cards/settings',
        headers,
        payload: { uniqueTopupAmountEnabled: true },
      });
      expect(settingsRes.statusCode).toBe(200);
      expect(settingsRes.json().uniqueTopupAmountEnabled).toBe(true);

      // 8. Delete card 2
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/admin/bank-cards/${card2Id}`,
        headers,
      });
      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().cards).toHaveLength(1);
    });

    it('blocks banning administrators with 403 CANNOT_BAN_ADMIN', async () => {
      mockUserService.setBanned.mockClear();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/12345/ban',
        cookies: { session: getAdminToken() },
        payload: { isBanned: true, reason: 'Self-ban attempt' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: 'Cannot ban an administrator',
        code: 'CANNOT_BAN_ADMIN',
      });
      expect(mockUserService.setBanned).not.toHaveBeenCalled();
    });

    it('caches panelHealth on GET /api/admin/stats, exposes latencies, and refreshes on ?refresh=1', async () => {
      mockPanelRegistry.healthSummary.mockClear();

      const first = await app.inject({
        method: 'GET',
        url: '/api/admin/stats?refresh=1',
        cookies: { session: getAdminToken() },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json();
      expect(typeof firstBody.dbLatencyMs).toBe('number');
      expect(typeof firstBody.panelHealth.latencyMs).toBe('number');
      expect(firstBody.panelHealth.allHealthy).toBe(true);
      expect(mockPanelRegistry.healthSummary).toHaveBeenCalledTimes(1);

      // Second call without refresh=1 reuses shared TTL cache
      const cached = await app.inject({
        method: 'GET',
        url: '/api/admin/stats',
        cookies: { session: getAdminToken() },
      });
      expect(cached.statusCode).toBe(200);
      expect(mockPanelRegistry.healthSummary).toHaveBeenCalledTimes(1);

      // Explicit ?refresh=1 bypasses cache
      const forced = await app.inject({
        method: 'GET',
        url: '/api/admin/stats?refresh=1',
        cookies: { session: getAdminToken() },
      });
      expect(forced.statusCode).toBe(200);
      expect(mockPanelRegistry.healthSummary).toHaveBeenCalledTimes(2);
    });

    it('returns named adminProfiles and duplicatePolicy in receipt settings and persists duplicatePolicy', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/admin/receipts/settings',
        cookies: { session: getAdminToken() },
      });
      expect(getRes.statusCode).toBe(200);
      const data = getRes.json();
      expect(data.duplicatePolicy).toBe('warn');
      expect(Array.isArray(data.adminProfiles)).toBe(true);
      expect(data.adminProfiles[0]).toMatchObject({ telegramId: 12345 });

      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/admin/receipts/settings',
        cookies: { session: getAdminToken() },
        payload: { duplicatePolicy: 'block' },
      });
      expect(putRes.statusCode).toBe(200);
      expect(mockTranslationService.updateSetting).toHaveBeenCalledWith(
        'receipt_duplicate_policy',
        'block'
      );
    });

    it('returns isAdmin and auditLogs in user dossier and delivers direct messages via POST /api/admin/users/:id/message', async () => {
      (mockUserService as unknown as { listAuditLogsForUser?: unknown }).listAuditLogsForUser =
        vi.fn(async () => ({
          logs: [
            {
              id: 'audit_1',
              actorTelegramId: 12345,
              action: 'admin_balance_adjustment',
              entityType: 'user_wallet',
              entityId: '55555',
              targetTelegramId: 55555,
              metadata: null,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          totalPages: 1,
          page: 1,
        }));

      const dossierRes = await app.inject({
        method: 'GET',
        url: '/api/admin/users/55555',
        cookies: { session: getAdminToken() },
      });
      expect(dossierRes.statusCode).toBe(200);
      const dossier = dossierRes.json();
      expect(dossier.isAdmin).toBe(false);
      expect(dossier.auditLogs).toHaveLength(1);
      expect(dossier.auditLogs[0].action).toBe('admin_balance_adjustment');

      // Without botApi configured, returns 503
      const noBotRes = await app.inject({
        method: 'POST',
        url: '/api/admin/users/55555/message',
        cookies: { session: getAdminToken() },
        payload: { message: 'Hello from admin' },
      });
      expect(noBotRes.statusCode).toBe(503);

      const sendMessage = vi.fn().mockResolvedValue({ message_id: 99 });
      mockUserService.recordAdminAction.mockClear();
      const dmApp = await createWebAppServer(mockConfig, {
        ...mockServices,
        botApi: { sendMessage } as unknown as NonNullable<typeof mockServices.botApi>,
      });
      try {
        const dmToken = dmApp.jwt.sign({ telegramId: 12345, role: 'admin' });
        const dmRes = await dmApp.inject({
          method: 'POST',
          url: '/api/admin/users/55555/message',
          cookies: { session: dmToken },
          payload: { message: 'سلام، سرویس شما بررسی شد.' },
        });
        expect(dmRes.statusCode).toBe(200);
        expect(dmRes.json()).toEqual({ success: true });
        expect(sendMessage).toHaveBeenCalledWith(55555, 'سلام، سرویس شما بررسی شد.');
        expect(mockUserService.recordAdminAction).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'admin_direct_message',
            targetTelegramId: 55555,
          })
        );
      } finally {
        await dmApp.close();
      }
    });
  });
});
