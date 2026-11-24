/**
 * Public Payment Gateway Webhook Routes (Fastify):
 *  - POST /api/webhooks/forapp      (authenticated via timing-safe X-API-Key)
 *  - POST /api/webhooks/nowpayments (authenticated via HMAC-SHA512 x-nowpayments-sig)
 */
import type { FastifyInstance } from 'fastify';
import type { Api } from 'grammy';
import type { AutomatedPaymentService } from '../../../domain/services/AutomatedPaymentService.js';
import {
  FORAPP_WEBHOOK_PATH,
  NOWPAYMENTS_WEBHOOK_PATH,
} from '../../../domain/services/AutomatedPaymentService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import { logger } from '../../../infra/logger.js';
import {
  sendAdminAutomatedTopupReport,
  sendAdminForAppUnmatchedDepositAlert,
  sendAutomatedTopupSuccessNotification,
  sendNowPaymentsPartialPaymentNotification,
} from '../../../telegram/features/admin/adminNotifications.js';

export interface PaymentWebhookRoutesOptions {
  automatedPaymentService?: AutomatedPaymentService;
  userService: UserService;
  translationService?: TranslationService;
  adminService?: Pick<AdminService, 'adminIds'>;
  adminIds?: number[];
  botApi?: Api;
}

export function registerPaymentWebhookRoutes(
  app: FastifyInstance,
  options: PaymentWebhookRoutesOptions
): void {
  const resolveAdminIds = () => options.adminService?.adminIds ?? options.adminIds ?? [];

  // POST /api/webhooks/forapp
  app.post(
    FORAPP_WEBHOOK_PATH,
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }

      const result = await options.automatedPaymentService.processForAppWebhook({
        apiKeyHeader: request.headers['x-api-key'],
        idempotencyKeyHeader: request.headers['idempotency-key'],
        body: request.body,
      });

      if (options.botApi && options.translationService) {
        const notifyServices = {
          userService: options.userService,
          translationService: options.translationService,
          adminIds: resolveAdminIds(),
        };

        if (result.outcome === 'matched' && result.order && result.creditedAmount) {
          void sendAutomatedTopupSuccessNotification(options.botApi, notifyServices, {
            telegramId: result.order.telegramId,
            amount: result.creditedAmount,
            balanceAfter: result.balanceAfter,
            provider: 'forapp_card',
            orderId: result.order.id,
            orderMetadata: result.order.metadata,
          });
          void sendAdminAutomatedTopupReport(options.botApi, notifyServices, {
            telegramId: result.order.telegramId,
            amount: result.creditedAmount,
            provider: 'forapp_card',
            orderId: result.order.id,
            bank: result.deposit?.bank ?? result.order.bankName,
          });
        } else if (result.outcome === 'unmatched' && result.deposit) {
          void sendAdminForAppUnmatchedDepositAlert(options.botApi, notifyServices, {
            depositId: result.deposit.id,
            amountRial: result.deposit.amountRial,
            amountToman: result.deposit.amountToman,
            bank: result.deposit.bank,
            sender: result.deposit.sender,
            note: result.deposit.note,
            relatedOrderId: result.relatedOrder?.id ?? null,
            relatedTelegramId: result.relatedOrder?.telegramId ?? null,
          });
        }
      }

      return reply.code(result.statusCode).send({
        ok: result.statusCode >= 200 && result.statusCode < 300,
        outcome: result.outcome,
        ...(result.outcome === 'test_ok' ? { test: true, enabled: result.enabled } : {}),
        ...(result.order ? { orderId: result.order.id } : {}),
        ...(result.deposit ? { depositId: result.deposit.id } : {}),
      });
    }
  );

  // POST /api/webhooks/nowpayments
  app.post(
    NOWPAYMENTS_WEBHOOK_PATH,
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }

      let result;
      try {
        result = await options.automatedPaymentService.processNowPaymentsIpn({
          payload: request.body,
          signatureHeader: request.headers['x-nowpayments-sig'],
        });
      } catch (err) {
        logger.error({ err }, 'NOWPayments IPN processing failed during API verification');
        return reply.code(502).send({ error: 'Failed to verify payment with NOWPayments API' });
      }

      if (options.botApi && options.translationService && result.order) {
        const notifyServices = {
          userService: options.userService,
          translationService: options.translationService,
          adminIds: resolveAdminIds(),
        };

        if (result.outcome === 'completed' && result.newlyCompleted && result.creditedAmount) {
          void sendAutomatedTopupSuccessNotification(options.botApi, notifyServices, {
            telegramId: result.order.telegramId,
            amount: result.creditedAmount,
            cashbackAmount: result.cashbackAmount,
            balanceAfter: result.balanceAfter,
            provider: 'nowpayments',
            orderId: result.order.id,
            orderMetadata: result.order.metadata,
          });
          void sendAdminAutomatedTopupReport(options.botApi, notifyServices, {
            telegramId: result.order.telegramId,
            amount: result.creditedAmount,
            cashbackAmount: result.cashbackAmount,
            provider: 'nowpayments',
            orderId: result.order.id,
            payCurrency: result.paymentDetail?.payCurrency ?? result.order.payCurrency,
          });
        } else if (result.outcome === 'partially_paid') {
          void sendNowPaymentsPartialPaymentNotification(options.botApi, notifyServices, {
            telegramId: result.order.telegramId,
            orderId: result.order.id,
            expectedAmountToman: result.order.payableAmount,
            payCurrency: result.paymentDetail?.payCurrency ?? result.order.payCurrency,
            payAmount: result.paymentDetail?.payAmount ?? result.order.payAmount,
            actuallyPaid: result.paymentDetail?.actuallyPaid ?? result.order.actuallyPaid,
          });
        }
      }

      return reply.code(result.statusCode).send({
        ok: result.statusCode >= 200 && result.statusCode < 300,
        outcome: result.outcome,
        ...(result.order ? { orderId: result.order.id, status: result.order.status } : {}),
      });
    }
  );
}
