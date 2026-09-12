import type { FastifyInstance } from 'fastify';
import type { Api } from 'grammy';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import type { RebeccaPanelRegistry } from '../../../domain/services/RebeccaPanelRegistry.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import type { AdminBalanceOperation } from '../../../domain/services/WalletContracts.js';
import { getTelegramFileUrl } from '../../../infra/telegramFiles.js';
import {
  sendReceiptApprovalNotification,
  sendReceiptRejectionNotification,
  sendBalanceAdjustmentNotification,
} from '../../../telegram/features/admin/adminNotifications.js';

interface ReceiptActionBody {
  action: 'approve' | 'reject';
  reason?: string;
}

interface AdjustBalanceBody {
  operation: AdminBalanceOperation;
  amount: number;
  reason: string;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  services: {
    walletService: WalletService;
    userService: UserService;
    configService?: ConfigService;
    panelRegistry: RebeccaPanelRegistry;
    botToken?: string;
    adminService?: Pick<AdminService, 'isAdmin'>;
    botApi?: Api;
    translationService?: TranslationService;
  }
): void {
  app.register(async (adminScope) => {
    // Re-validate the admin registry on every request: a JWT signed before
    // an admin was removed must stop working immediately, not after 12h.
    adminScope.addHook('preHandler', (request, reply) =>
      adminGuardWithCheck(
        request,
        reply,
        services.adminService ? (id) => services.adminService!.isAdmin(id) : undefined
      )
    );

    // GET /api/admin/stats
    adminScope.get('/api/admin/stats', async (_request, reply) => {
      const [stats, panelHealth] = await Promise.all([
        services.walletService.getDashboardStats().catch(() => null),
        services.panelRegistry.healthSummary().catch(() => ({ configured: 0, healthy: 0 })),
      ]);

      return reply.code(200).send({
        stats,
        panelHealth,
      });
    });

    // GET /api/admin/receipts
    adminScope.get<{
      Querystring: { page?: string; limit?: string };
    }>('/api/admin/receipts', async (request, reply) => {
      const page = clampPositiveInt(request.query.page, 1, 1_000_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);
      const result = await services.walletService.listPendingTopupsPage(page, limit);
      return reply.code(200).send(result);
    });

    // GET /api/admin/receipts/:id/photo — redirect to the Telegram-hosted
    // receipt image so the <img> tag constructed by the frontend resolves
    // instead of hitting the generic 404 handler.
    adminScope.get<{
      Params: { id: string };
    }>('/api/admin/receipts/:id/photo', async (request, reply) => {
      const { id } = request.params;
      const receipt = await services.walletService.getPendingTopup(id);
      if (!receipt) {
        return reply.code(404).send({ error: 'Receipt not found' });
      }
      if (!services.botToken) {
        return reply.code(404).send({ error: 'Receipt photo unavailable' });
      }
      const resolved = await getTelegramFileUrl(services.botToken, receipt.photoFileId);
      if (!resolved.ok) {
        return reply.code(502).send({ error: resolved.error });
      }
      return reply.redirect(resolved.url);
    });

    // POST /api/admin/receipts/:id/action
    adminScope.post<{
      Params: { id: string };
      Body: ReceiptActionBody;
    }>(
      '/api/admin/receipts/:id/action',
      {
        schema: {
          body: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['approve', 'reject'] },
              reason: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { action, reason } = request.body;
        const adminId = request.userSession!.telegramId;

        if (action === 'approve') {
          try {
            const result = await services.walletService.approveTopup(id, adminId);
            if (!result) {
              return reply.code(404).send({ error: 'Receipt not found or already processed' });
            }

            if (services.botApi && services.translationService) {
              await sendReceiptApprovalNotification(
                services.botApi,
                {
                  userService: services.userService,
                  translationService: services.translationService,
                },
                {
                  telegramId: result.telegramId,
                  amount: result.amount,
                  receiptId: id,
                }
              );
            }

            return reply.code(200).send({ success: true, result });
          } catch (err: unknown) {
            if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
              return reply.code(404).send({ error: 'Receipt owner not found' });
            }
            throw err;
          }
        }

        if (!reason?.trim()) {
          return reply.code(400).send({ error: 'A rejection reason is required' });
        }

        const result = await services.walletService.rejectTopup(id, adminId);
        if (!result) {
          return reply.code(404).send({ error: 'Receipt not found or already processed' });
        }

        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'topup_receipt_rejected_with_reason',
          entityType: 'topup_receipt',
          entityId: id,
          targetTelegramId: result.telegramId,
          metadata: { reason: reason.trim() },
        });

        if (services.botApi && services.translationService) {
          await sendReceiptRejectionNotification(
            services.botApi,
            {
              userService: services.userService,
              translationService: services.translationService,
            },
            {
              telegramId: result.telegramId,
              receiptId: id,
              reason: reason.trim(),
            }
          );
        }

        return reply.code(200).send({ success: true });
      }
    );

    // GET /api/admin/users
    adminScope.get<{
      Querystring: {
        search?: string;
        page?: string;
        limit?: string;
        filter?: 'all' | 'active_subs' | 'has_balance' | 'banned';
        sort?: 'newest' | 'balance_desc' | 'subs_desc' | 'spend_desc';
      };
    }>('/api/admin/users', async (request, reply) => {
      const { search, page, limit, filter, sort } = request.query;

      if (search?.trim()) {
        const limit = clampPositiveInt(request.query.limit, 10, 50);
        let users = await services.userService.searchProfiles(search.trim(), limit);
        if (filter === 'active_subs') {
          users = users.filter((u) => u.activeSubscriptionCount > 0);
        } else if (filter === 'has_balance') {
          users = users.filter((u) => u.balance > 0);
        } else if (filter === 'banned') {
          users = users.filter((u) => u.isBanned);
        }
        if (sort === 'balance_desc') {
          users.sort((a, b) => b.balance - a.balance);
        } else if (sort === 'subs_desc') {
          users.sort((a, b) => b.activeSubscriptionCount - a.activeSubscriptionCount);
        } else if (sort === 'spend_desc') {
          users.sort((a, b) => b.totalSpend - a.totalSpend);
        }
        return reply.code(200).send({
          users,
          total: users.length,
          page: 1,
          totalPages: 1,
        });
      }

      const parsedPage = clampPositiveInt(page, 1, 1_000_000);
      const parsedLimit = clampPositiveInt(limit, 10, 50);
      const result = await services.userService.listUsers(parsedPage, parsedLimit, {
        filter,
        sort,
      });
      return reply.code(200).send(result);
    });

    // GET /api/admin/users/:id
    adminScope.get<{
      Params: { id: string };
    }>('/api/admin/users/:id', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }

      const summary = await services.userService.getUserReportSummary(telegramId);
      if (!summary) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const [ordersRes, receiptsRes, rawConfigs, txRes] = await Promise.all([
        services.userService.listOrdersForUser(telegramId, 1, 10),
        services.userService.listReceiptsForUser(telegramId, 1, 10),
        services.configService
          ? services.configService.listConfigsForOwner(telegramId).catch(() => [])
          : Promise.resolve([]),
        services.userService
          .listTransactionsForUser(telegramId, 1, 15)
          .catch(() => ({ transactions: [] })),
      ]);

      const configs = rawConfigs.map((cfg) => {
        const panel = services.panelRegistry.getPanel(cfg.panelId);
        return {
          id: cfg.id,
          panelId: cfg.panelId,
          panelName: panel?.name || cfg.panelId,
          serviceId: cfg.serviceId,
          configUsername: cfg.configUsername,
          subUrl: cfg.subUrl,
          panelStatus: cfg.panelStatus,
          panelDataLimit: cfg.panelDataLimit,
          panelUsedTraffic: cfg.panelUsedTraffic,
          panelExpire: cfg.panelExpire,
          autoRenewEnabled: cfg.autoRenewEnabled,
          isClaimed: cfg.isClaimed,
          createdAt: cfg.createdAt,
        };
      });

      return reply.code(200).send({
        summary,
        orders: ordersRes.orders,
        receipts: receiptsRes.receipts,
        configs,
        transactions: txRes.transactions,
      });
    });

    // POST /api/admin/users/:id/ban
    adminScope.post<{
      Params: { id: string };
      Body: { isBanned: boolean; reason?: string };
    }>(
      '/api/admin/users/:id/ban',
      {
        schema: {
          body: {
            type: 'object',
            required: ['isBanned'],
            properties: {
              isBanned: { type: 'boolean' },
              reason: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const telegramId = Number(request.params.id);
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
          return reply.code(400).send({ error: 'Invalid user ID' });
        }

        const { isBanned, reason } = request.body;
        const adminId = request.userSession!.telegramId;

        const updated = await services.userService.setBanned(telegramId, isBanned, adminId);
        if (!updated) {
          return reply.code(404).send({ error: 'User not found' });
        }

        if (reason?.trim()) {
          await services.userService.recordAdminAction({
            actorTelegramId: adminId,
            action: isBanned ? 'admin_ban_user_with_reason' : 'admin_unban_user_with_reason',
            entityType: 'telegram_user',
            entityId: String(telegramId),
            targetTelegramId: telegramId,
            metadata: { reason: reason.trim() },
          });
        }

        return reply.code(200).send({ success: true, isBanned });
      }
    );

    // POST /api/admin/users/:id/configs/:configUsername/toggle
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/toggle', async (request, reply) => {
      const telegramId = Number(request.params.id);
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const status = await services.configService.toggleConfig(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_toggle_user_config',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { status, panelId },
        });
        return reply.code(200).send({ success: true, status });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to toggle config';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/reset-usage
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/reset-usage', async (request, reply) => {
      const telegramId = Number(request.params.id);
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        await services.configService.resetUsage(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_reset_user_config_usage',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { panelId },
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to reset usage';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/revoke
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/revoke', async (request, reply) => {
      const telegramId = Number(request.params.id);
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const newSubUrl = await services.configService.revokeSubscription(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_revoke_user_config_sub_url',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { panelId, newSubUrl },
        });
        return reply.code(200).send({ success: true, subUrl: newSubUrl });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to revoke subscription';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/sync
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/sync', async (request, reply) => {
      const telegramId = Number(request.params.id);
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const config = await services.configService.getOwnedConfigByUsername(
        telegramId,
        configUsername,
        panelId
      );
      if (!config) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const detail = await services.configService.getRemoteConfigDetail(config);
        return reply.code(200).send({ success: true, detail });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to sync config with panel';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/balance
    adminScope.post<{
      Params: { id: string };
      Body: AdjustBalanceBody;
    }>(
      '/api/admin/users/:id/balance',
      {
        schema: {
          body: {
            type: 'object',
            required: ['operation', 'amount', 'reason'],
            properties: {
              operation: { type: 'string', enum: ['add', 'deduct', 'set'] },
              amount: { type: 'number', minimum: 0 },
              reason: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request, reply) => {
        const telegramId = Number(request.params.id);
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
          return reply.code(400).send({ error: 'Invalid user ID' });
        }

        const { operation, amount, reason } = request.body;
        if (!reason || !reason.trim()) {
          return reply.code(400).send({ error: 'A non-empty reason is required' });
        }
        if (!Number.isSafeInteger(amount) || amount < 0) {
          return reply.code(400).send({ error: 'Amount must be a non-negative integer' });
        }

        const adminId = request.userSession!.telegramId;

        try {
          const previousBalance = await services.walletService.getBalance(telegramId);
          const newBalance = await services.walletService.adjustBalanceAdmin({
            telegramId,
            operation,
            amount,
            adminId,
            description: reason.trim(),
          });

          await services.userService.recordAdminAction({
            actorTelegramId: adminId,
            action: 'admin_balance_adjustment',
            entityType: 'user_wallet',
            entityId: String(telegramId),
            targetTelegramId: telegramId,
            metadata: {
              operation,
              amount,
              previousBalance,
              newBalance,
              reason: reason.trim(),
            },
          });

          if (services.botApi && services.translationService) {
            await sendBalanceAdjustmentNotification(
              services.botApi,
              {
                userService: services.userService,
                translationService: services.translationService,
              },
              {
                telegramId,
                newBalance,
              }
            );
          }

          return reply.code(200).send({ success: true, balance: newBalance });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Balance adjustment failed';
          return reply.code(400).send({ error: message });
        }
      }
    );

    // GET /api/admin/panels
    adminScope.get('/api/admin/panels', async (_request, reply) => {
      const panels = services.panelRegistry.listPanels();
      const enrichedPanels = await Promise.all(
        panels.map(async (panel) => {
          let activeConfigsCount = 0;
          let healthy = panel.enabled;
          let latencyMs: number | undefined;

          try {
            if (typeof services.panelRegistry.getPanelUsage === 'function') {
              const countRes = await services.panelRegistry.getPanelUsage(panel.id);
              activeConfigsCount = countRes.activeConfigsCount;
            }
          } catch {
            // default to 0
          }

          try {
            if (panel.enabled && typeof services.panelRegistry.getService === 'function') {
              const service = services.panelRegistry.getService(panel.id);
              const start = Date.now();
              healthy = await service.checkHealth();
              latencyMs = Date.now() - start;
            }
          } catch {
            healthy = false;
          }

          return {
            ...panel,
            activeConfigsCount,
            healthy,
            latencyMs,
          };
        })
      );

      return reply.code(200).send({ panels: enrichedPanels });
    });

    // POST /api/admin/panels/:id/test
    adminScope.post<{
      Params: { id: string };
    }>('/api/admin/panels/:id/test', async (request, reply) => {
      const { id } = request.params;
      try {
        if (typeof services.panelRegistry.getService !== 'function') {
          return reply
            .code(400)
            .send({ success: false, healthy: false, error: 'Registry service unavailable' });
        }
        const service = services.panelRegistry.getService(id);
        const start = Date.now();
        const healthy = await service.checkHealth();
        const latencyMs = Date.now() - start;
        return reply.code(200).send({
          success: true,
          healthy,
          latencyMs,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Connection test failed';
        return reply.code(200).send({
          success: false,
          healthy: false,
          error: message,
        });
      }
    });
  });
}

/**
 * Clamp a raw querystring integer into [1, max]. Rejects NaN, negatives,
 * and huge values that previously caused Drizzle errors / full scans.
 */
function clampPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed) || fallback, max));
}
