import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/adminGuard.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { RebeccaPanelRegistry } from '../../../domain/services/RebeccaPanelRegistry.js';
import type { AdminBalanceOperation } from '../../../domain/services/WalletContracts.js';

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
    panelRegistry: RebeccaPanelRegistry;
    botToken?: string;
  }
): void {
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', adminGuard);

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
      const page = Number(request.query.page) || 1;
      const limit = Number(request.query.limit) || 10;
      const result = await services.walletService.listPendingTopupsPage(page, limit);
      return reply.code(200).send(result);
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
          const result = await services.walletService.approveTopup(id, adminId);
          if (!result) {
            return reply.code(404).send({ error: 'Receipt not found or already processed' });
          }
          return reply.code(200).send({ success: true, result });
        }

        const result = await services.walletService.rejectTopup(id, adminId);
        if (!result) {
          return reply.code(404).send({ error: 'Receipt not found or already processed' });
        }

        if (reason?.trim()) {
          await services.userService.recordAdminAction({
            actorTelegramId: adminId,
            action: 'topup_receipt_rejected_with_reason',
            entityType: 'topup_receipt',
            entityId: id,
            targetTelegramId: result.telegramId,
            metadata: { reason: reason.trim() },
          });
        }

        return reply.code(200).send({ success: true });
      }
    );

    // GET /api/admin/users
    adminScope.get<{
      Querystring: { search?: string; page?: string; limit?: string };
    }>('/api/admin/users', async (request, reply) => {
      const { search, page, limit } = request.query;

      if (search?.trim()) {
        const users = await services.userService.searchProfiles(search.trim(), Number(limit) || 10);
        return reply.code(200).send({
          users,
          total: users.length,
          page: 1,
          totalPages: 1,
        });
      }

      const parsedPage = Number(page) || 1;
      const parsedLimit = Number(limit) || 10;
      const result = await services.userService.listUsers(parsedPage, parsedLimit);
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

      const [ordersRes, receiptsRes] = await Promise.all([
        services.userService.listOrdersForUser(telegramId, 1, 10),
        services.userService.listReceiptsForUser(telegramId, 1, 10),
      ]);

      return reply.code(200).send({
        summary,
        orders: ordersRes.orders,
        receipts: receiptsRes.receipts,
      });
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
              reason: reason.trim(),
              newBalance,
            },
          });

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
