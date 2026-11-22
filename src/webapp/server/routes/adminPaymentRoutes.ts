/**
 * Admin Payment Gateway Routes (ForApp & NOWPayments settings, key rotation, unmatched deposits).
 */
import type { FastifyInstance } from 'fastify';
import type { Api } from 'grammy';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import {
  AutomatedPaymentError,
  type AutomatedPaymentService,
} from '../../../domain/services/AutomatedPaymentService.js';
import type { ForAppDepositStatus } from '../../../infra/schema.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import { sendAutomatedTopupSuccessNotification } from '../../../telegram/features/admin/adminNotifications.js';

export interface AdminPaymentRoutesOptions {
  automatedPaymentService?: AutomatedPaymentService;
  userService: UserService;
  adminService?: Pick<AdminService, 'isAdmin'> & { adminIds?: number[] };
  adminIds?: number[];
  translationService?: TranslationService;
  botApi?: Api;
}

const VALID_DEPOSIT_STATUSES = new Set([
  'unmatched',
  'matched',
  'manual_matched',
  'ignored',
  'dismissed',
  'all',
]);

export function registerAdminPaymentRoutes(
  app: FastifyInstance,
  options: AdminPaymentRoutesOptions
): void {
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', (request, reply) =>
      adminGuardWithCheck(
        request,
        reply,
        options.adminService ? (id) => options.adminService!.isAdmin(id) : undefined
      )
    );

    // GET /api/admin/payment-gateways
    adminScope.get('/api/admin/payment-gateways', async (_request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const [forapp, nowpayments] = await Promise.all([
        options.automatedPaymentService.getForAppAdminConfig(),
        options.automatedPaymentService.getNowPaymentsAdminConfig(),
      ]);
      return reply.code(200).send({ forapp, nowpayments });
    });

    // PUT /api/admin/payment-gateways/forapp
    adminScope.put<{
      Body: {
        enabled?: boolean;
        orderExpiryMinutes?: number;
      };
    }>(
      '/api/admin/payment-gateways/forapp',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              orderExpiryMinutes: { type: 'number' },
            },
          },
        },
      },
      async (request, reply) => {
        if (!options.automatedPaymentService) {
          return reply.code(503).send({ error: 'Automated payment service unavailable' });
        }
        try {
          const forapp = await options.automatedPaymentService.updateForAppConfig({
            enabled: request.body?.enabled,
            orderExpiryMinutes: request.body?.orderExpiryMinutes,
          });
          await options.userService.recordAdminAction?.({
            actorTelegramId: request.userSession!.telegramId,
            action: 'admin_update_forapp_config',
            entityType: 'payment_gateway',
            entityId: 'forapp',
            metadata: { enabled: forapp.enabled, orderExpiryMinutes: forapp.orderExpiryMinutes },
          });
          return reply.code(200).send({ success: true, forapp });
        } catch (err) {
          if (err instanceof AutomatedPaymentError) {
            return reply.code(400).send({ error: err.message, code: err.code });
          }
          throw err;
        }
      }
    );

    // POST /api/admin/payment-gateways/forapp/rotate-key
    adminScope.post('/api/admin/payment-gateways/forapp/rotate-key', async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const rotated = await options.automatedPaymentService.rotateForAppApiKey();
      const forapp = await options.automatedPaymentService.getForAppAdminConfig();
      await options.userService.recordAdminAction?.({
        actorTelegramId: request.userSession!.telegramId,
        action: 'admin_rotate_forapp_api_key',
        entityType: 'payment_gateway',
        entityId: 'forapp',
        metadata: { apiKeyMasked: rotated.apiKeyMasked },
      });
      return reply.code(200).send({
        success: true,
        apiKey: rotated.apiKey,
        apiKeyMasked: rotated.apiKeyMasked,
        webhookUrl: rotated.webhookUrl,
        forapp,
      });
    });

    // GET /api/admin/payment-gateways/forapp/deposits
    adminScope.get<{
      Querystring: { page?: string; limit?: string; status?: string };
    }>('/api/admin/payment-gateways/forapp/deposits', async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const rawPage = Number(request.query.page);
      const rawLimit = Number(request.query.limit);
      const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
      const pageSize =
        Number.isSafeInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 50) : 15;
      const rawStatus = request.query.status?.trim() || 'unmatched';
      const status = (VALID_DEPOSIT_STATUSES.has(rawStatus) ? rawStatus : 'unmatched') as
        ForAppDepositStatus | 'all';

      const res = await options.automatedPaymentService.listForAppDeposits({
        page,
        pageSize,
        status,
      });
      return reply.code(200).send(res);
    });

    // POST /api/admin/payment-gateways/forapp/deposits/:id/match
    adminScope.post<{
      Params: { id: string };
      Body: {
        target?: string;
        targetTelegramId?: number;
        overrideAmountToman?: number;
        note?: string;
      };
    }>('/api/admin/payment-gateways/forapp/deposits/:id/match', async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }

      let targetTelegramId =
        typeof request.body?.targetTelegramId === 'number' &&
        Number.isSafeInteger(request.body.targetTelegramId) &&
        request.body.targetTelegramId > 0
          ? request.body.targetTelegramId
          : undefined;

      if (
        !targetTelegramId &&
        typeof request.body?.target === 'string' &&
        request.body.target.trim()
      ) {
        const profile = await options.userService.findProfile(request.body.target.trim());
        if (!profile) {
          return reply.code(404).send({ error: 'User not found', code: 'USER_NOT_FOUND' });
        }
        targetTelegramId = profile.telegramId;
      }

      if (!targetTelegramId) {
        return reply
          .code(400)
          .send({ error: 'Target user is required', code: 'INVALID_TARGET_USER' });
      }

      try {
        const result = await options.automatedPaymentService.manualMatchForAppDeposit({
          depositId: request.params.id,
          targetTelegramId,
          adminId: request.userSession!.telegramId,
          overrideAmountToman: request.body?.overrideAmountToman,
          note: request.body?.note,
        });

        if (options.botApi && options.translationService) {
          void sendAutomatedTopupSuccessNotification(
            options.botApi,
            {
              userService: options.userService,
              translationService: options.translationService,
              adminIds: options.adminService?.adminIds ?? options.adminIds ?? [],
            },
            {
              telegramId: result.telegramId,
              amount: result.creditedAmount,
              balanceAfter: result.balanceAfter,
              provider: 'forapp_card',
              orderId: result.deposit.id,
            }
          );
        }

        return reply.code(200).send({ success: true, result });
      } catch (err) {
        if (err instanceof AutomatedPaymentError) {
          const codeMap: Record<string, number> = {
            DEPOSIT_NOT_FOUND: 404,
            USER_NOT_FOUND: 404,
            DEPOSIT_NOT_UNMATCHED: 409,
          };
          return reply.code(codeMap[err.code] ?? 400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // POST /api/admin/payment-gateways/forapp/deposits/:id/dismiss
    adminScope.post<{
      Params: { id: string };
      Body?: { note?: string };
    }>('/api/admin/payment-gateways/forapp/deposits/:id/dismiss', async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const dismissed = await options.automatedPaymentService.dismissForAppDeposit({
        depositId: request.params.id,
        adminId: request.userSession!.telegramId,
        note: request.body?.note,
      });
      if (!dismissed) {
        return reply.code(404).send({ error: 'Deposit not found or already processed' });
      }
      return reply.code(200).send({ success: true, deposit: dismissed });
    });

    // PUT /api/admin/payment-gateways/nowpayments
    adminScope.put<{
      Body: {
        enabled?: boolean;
        sandbox?: boolean;
        apiKey?: string | null;
        ipnSecret?: string | null;
        rateMode?: 'manual' | 'auto';
        manualUsdRateToman?: number;
        minAmountToman?: number;
        maxAmountToman?: number;
        cashbackPercent?: number;
        orderExpiryMinutes?: number;
      };
    }>(
      '/api/admin/payment-gateways/nowpayments',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              sandbox: { type: 'boolean' },
              apiKey: { type: ['string', 'null'], maxLength: 512 },
              ipnSecret: { type: ['string', 'null'], maxLength: 512 },
              rateMode: { type: 'string', enum: ['manual', 'auto'] },
              manualUsdRateToman: { type: 'number' },
              minAmountToman: { type: 'number' },
              maxAmountToman: { type: 'number' },
              cashbackPercent: { type: 'number' },
              orderExpiryMinutes: { type: 'number' },
            },
          },
        },
      },
      async (request, reply) => {
        if (!options.automatedPaymentService) {
          return reply.code(503).send({ error: 'Automated payment service unavailable' });
        }
        try {
          const nowpayments = await options.automatedPaymentService.updateNowPaymentsConfig(
            request.body ?? {}
          );
          await options.userService.recordAdminAction?.({
            actorTelegramId: request.userSession!.telegramId,
            action: 'admin_update_nowpayments_config',
            entityType: 'payment_gateway',
            entityId: 'nowpayments',
            metadata: {
              enabled: nowpayments.enabled,
              sandbox: nowpayments.sandbox,
              rateMode: nowpayments.rateMode,
              manualUsdRateToman: nowpayments.manualUsdRateToman,
              minAmountToman: nowpayments.minAmountToman,
              maxAmountToman: nowpayments.maxAmountToman,
              cashbackPercent: nowpayments.cashbackPercent,
              apiKeyUpdated: request.body?.apiKey !== undefined,
              ipnSecretUpdated: request.body?.ipnSecret !== undefined,
            },
          });
          return reply.code(200).send({ success: true, nowpayments });
        } catch (err) {
          if (err instanceof AutomatedPaymentError) {
            return reply.code(400).send({ error: err.message, code: err.code });
          }
          throw err;
        }
      }
    );

    // POST /api/admin/payment-gateways/nowpayments/test
    adminScope.post('/api/admin/payment-gateways/nowpayments/test', async (_request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const result = await options.automatedPaymentService.testNowPaymentsConnection();
      return reply.code(200).send(result);
    });
  });
}
