import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  detectIranianBankName,
  normalizeCardNumber,
  parseBankCardsJson,
} from '../../../../domain/services/PaymentService.js';
import {
  uniqueTopupAmountEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../../../domain/services/FeatureSettings.js';
import {
  DuplicateReceiptError,
  PendingTopupReceiptError,
} from '../../../../domain/services/WalletService.js';
import {
  AutomatedPaymentError,
  formatPaymentOrderShortId,
} from '../../../../domain/services/AutomatedPaymentService.js';
import type { PaymentOrderRow } from '../../../../infra/schema.js';
import {
  sendAdminAutomatedTopupReport,
  sendAdminNewReceiptNotification,
  sendAutomatedTopupSuccessNotification,
} from '../../../../telegram/features/admin/adminNotifications.js';
import {
  sendWebAppWalletTransferNotification,
  uploadReceiptMediaToTelegram,
} from '../../../../telegram/webappNotifications.js';
import {
  buildMaskedRecipientPreview,
  clampPositiveInt,
  decodeAndValidateReceiptUpload,
  formatReceiptShortId,
  resolveUserLocale,
  type UserRateLimitConfigs,
  type UserRoutesOptions,
} from './shared.js';

const ALLOWED_TX_FILTERS = new Set(['all', 'topup', 'purchase', 'rewards', 'transfer']);

export function registerUserWalletRoutes(
  userScope: FastifyInstance,
  options: UserRoutesOptions,
  limits: UserRateLimitConfigs
): void {
  // GET /api/user/transactions
  userScope.get<{
    Querystring: {
      page?: string;
      limit?: string;
      type?: string;
    };
  }>(
    '/api/user/transactions',
    {
      config: {
        rateLimit: limits.standard,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const page = clampPositiveInt(request.query.page, 1, 10_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);
      const rawType = typeof request.query.type === 'string' ? request.query.type.trim() : 'all';
      const filter = ALLOWED_TX_FILTERS.has(rawType)
        ? (rawType as 'all' | 'topup' | 'purchase' | 'rewards' | 'transfer')
        : 'all';

      const result =
        filter === 'all'
          ? await options.walletService.listTransactionsForUser(telegramId, page, limit)
          : await options.walletService.listTransactionsForUser(telegramId, page, limit, filter);

      return reply.code(200).send({
        transactions: result.transactions.map((tx) => ({
          id: tx.id,
          amount: tx.amount,
          balanceAfter: tx.balanceAfter,
          type: tx.type,
          description: tx.description,
          createdAt: tx.createdAt,
        })),
        total: result.total,
        totalPages: result.totalPages,
        page: result.page,
        filter,
      });
    }
  );

  // GET /api/user/receipts — user's own top-up receipt history
  userScope.get<{
    Querystring: {
      page?: string;
      limit?: string;
    };
  }>(
    '/api/user/receipts',
    {
      config: {
        rateLimit: limits.standard,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (typeof options.userService.listReceiptsForUser !== 'function') {
        return reply.code(200).send({ receipts: [], total: 0, totalPages: 1, page: 1 });
      }

      const page = clampPositiveInt(request.query.page, 1, 10_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);
      const res = await options.userService.listReceiptsForUser(telegramId, page, limit);

      return reply.code(200).send({
        receipts: res.receipts.map((r) => ({
          id: r.id,
          shortId: formatReceiptShortId(r.id),
          amount: r.amount,
          status: r.status,
          cardNumber: r.cardNumber ? `•••• ${normalizeCardNumber(r.cardNumber).slice(-4)}` : null,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        })),
        total: res.total,
        totalPages: res.totalPages,
        page: res.page,
      });
    }
  );

  // POST /api/user/topup/prepare — select bank card respecting daily caps + allocate unique amount
  userScope.post<{
    Body?: { amount?: number };
  }>(
    '/api/user/topup/prepare',
    {
      config: {
        rateLimit: limits.action30,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const pendingReceipt = await options.walletService.getPendingReceiptForUser?.(telegramId);
      if (pendingReceipt) {
        return reply.code(409).send({
          error: 'You already have a pending receipt under review',
          code: 'PENDING_RECEIPT_EXISTS',
          pendingReceipt: {
            id: pendingReceipt.id,
            shortId: formatReceiptShortId(pendingReceipt.id),
            amount: pendingReceipt.amount,
            status: pendingReceipt.status,
            createdAt:
              pendingReceipt.createdAt instanceof Date
                ? pendingReceipt.createdAt.toISOString()
                : String(pendingReceipt.createdAt),
          },
        });
      }

      const ts = options.translationService;
      const minAmount =
        typeof ts?.getSettingNum === 'function'
          ? ts.getSettingNum('topup_min_amount', 10_000)
          : 10_000;
      const maxAmount =
        typeof ts?.getSettingNum === 'function'
          ? ts.getSettingNum('topup_max_amount', 10_000_000)
          : 10_000_000;

      const requestedAmount = Number(request.body?.amount);
      if (
        !Number.isSafeInteger(requestedAmount) ||
        requestedAmount < minAmount ||
        requestedAmount > maxAmount
      ) {
        return reply.code(400).send({
          error: `Amount must be between ${minAmount} and ${maxAmount}`,
          code: 'INVALID_TOPUP_AMOUNT',
          minAmount,
          maxAmount,
        });
      }

      const locale = await resolveUserLocale(telegramId, options);
      let cardId = '';
      let cardNumber = '';
      let cardHolder = '';
      let bankName = '';

      if (options.paymentService) {
        const selected =
          typeof options.paymentService.selectCardForTopupWithDailyCaps === 'function'
            ? await options.paymentService.selectCardForTopupWithDailyCaps({
                amountToman: requestedAmount,
              })
            : typeof options.paymentService.selectCardForTopup === 'function'
              ? options.paymentService.selectCardForTopup({ amountToman: requestedAmount })
              : null;

        if (!selected) {
          const activeCards =
            typeof options.paymentService.getActiveBankCards === 'function'
              ? options.paymentService.getActiveBankCards()
              : [];
          if (activeCards.length > 0) {
            return reply.code(503).send({
              error: 'All bank cards have reached their daily deposit cap',
              code: 'ALL_CARDS_CAP_REACHED',
            });
          }
          return reply.code(503).send({
            error: 'No bank card is currently configured',
            code: 'NO_BANK_CARD',
          });
        }

        cardId = selected.id;
        cardNumber = selected.cardNumber;
        cardHolder = selected.cardHolder || ts?.getSetting('card_holder', '').trim() || '';
        bankName = selected.bankName || detectIranianBankName(cardNumber, locale) || '';
      } else if (ts) {
        const configured = parseBankCardsJson(ts.getSetting('bank_cards_json', '[]')).filter(
          (c) => c.enabled
        );
        if (configured.length > 0) {
          const picked = configured[0]!;
          cardId = picked.id;
          cardNumber = picked.cardNumber;
          cardHolder = picked.cardHolder;
          bankName = picked.bankName || detectIranianBankName(cardNumber, locale) || '';
        } else {
          cardNumber = normalizeCardNumber(ts.getSetting('card_number', ''));
          cardHolder = ts.getSetting('card_holder', '').trim();
          bankName = cardNumber ? (detectIranianBankName(cardNumber, locale) ?? '') : '';
        }
        if (!cardNumber) {
          return reply.code(503).send({
            error: 'No bank card is currently configured',
            code: 'NO_BANK_CARD',
          });
        }
      }

      let payableAmount = requestedAmount;
      let isUniqueAmount = false;
      const uniqueEnabled = ts ? uniqueTopupAmountEnabled(ts) : false;
      if (
        uniqueEnabled &&
        typeof options.paymentService?.allocateUniquePayableAmount === 'function'
      ) {
        try {
          const allocated =
            await options.paymentService.allocateUniquePayableAmount(requestedAmount);
          payableAmount = allocated.payableAmount;
          isUniqueAmount = allocated.isUnique && allocated.payableAmount !== requestedAmount;
        } catch {
          payableAmount = requestedAmount;
          isUniqueAmount = false;
        }
      }

      return reply.code(200).send({
        requestedAmount,
        payableAmount,
        isUniqueAmount,
        card: {
          id: cardId || 'legacy_default',
          cardNumber,
          cardHolder,
          bankName,
        },
        nativeUploadEnabled: Boolean(options.botApi),
      });
    }
  );

  // POST /api/user/topup/receipt — native WebApp receipt image/PDF submission
  userScope.post<{
    Body?: {
      amount?: number;
      cardId?: string;
      cardNumber?: string;
      fileBase64?: string;
      fileName?: string;
    };
  }>(
    '/api/user/topup/receipt',
    {
      bodyLimit: 8 * 1024 * 1024, // Supports up to 5 MiB binary encoded as base64
      config: {
        rateLimit: limits.action6,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!options.botApi || !options.translationService) {
        return reply.code(503).send({
          error: 'Direct receipt upload is unavailable; please send your receipt in Telegram bot',
          code: 'RECEIPT_UPLOAD_UNAVAILABLE',
        });
      }

      if (typeof options.walletService.submitTopupReceiptDetailed !== 'function') {
        return reply.code(503).send({
          error: 'Receipt submission service unavailable',
          code: 'SERVICE_UNAVAILABLE',
        });
      }

      const ts = options.translationService;
      const minAmount =
        typeof ts.getSettingNum === 'function'
          ? ts.getSettingNum('topup_min_amount', 10_000)
          : 10_000;
      const maxAmount =
        typeof ts.getSettingNum === 'function'
          ? ts.getSettingNum('topup_max_amount', 10_000_000)
          : 10_000_000;
      const amount = Number(request.body?.amount);
      // Allow slight unique-amount offset below minAmount (up to 999 Toman)
      const effectiveMin = uniqueTopupAmountEnabled(ts) ? Math.max(1, minAmount - 999) : minAmount;
      if (!Number.isSafeInteger(amount) || amount < effectiveMin || amount > maxAmount + 999) {
        return reply.code(400).send({
          error: `Amount must be between ${minAmount} and ${maxAmount}`,
          code: 'INVALID_TOPUP_AMOUNT',
        });
      }

      const decoded = decodeAndValidateReceiptUpload(request.body?.fileBase64 ?? '');
      if (!decoded.ok) {
        return reply.code(400).send({ error: decoded.error, code: decoded.code });
      }

      // Ensure user row exists
      const profile = await options.userService.findProfile(String(telegramId));
      if (!profile) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      // Check existing pending receipt before uploading media to Telegram
      const existingPending = await options.walletService.getPendingReceiptForUser?.(telegramId);
      if (existingPending) {
        return reply.code(409).send({
          error: 'You already have a pending receipt under review',
          code: 'PENDING_RECEIPT_EXISTS',
          receiptId: existingPending.id,
        });
      }

      const fileSha256 = crypto.createHash('sha256').update(decoded.file.buffer).digest('hex');
      const safeFileName = `receipt_${telegramId}_${Date.now()}.${decoded.file.extension}`;
      const adminIds = options.adminIds ?? options.adminService?.adminIds ?? [];

      let uploaded: { fileId: string; fileUniqueId?: string };
      try {
        uploaded = await uploadReceiptMediaToTelegram(
          options.botApi,
          { userService: options.userService, translationService: ts },
          {
            telegramId,
            amount,
            buffer: decoded.file.buffer,
            mediaType: decoded.file.mediaType,
            fileName: safeFileName,
            fallbackAdminIds: adminIds,
          }
        );
      } catch {
        return reply.code(502).send({
          error: 'Could not upload receipt image to Telegram; please try sending it in the bot',
          code: 'TELEGRAM_UPLOAD_FAILED',
        });
      }

      const normalizedCardNumber = request.body?.cardNumber
        ? normalizeCardNumber(request.body.cardNumber)
        : undefined;
      const cardId =
        typeof request.body?.cardId === 'string' && request.body.cardId.trim()
          ? request.body.cardId.trim()
          : undefined;

      try {
        const submitted = await options.walletService.submitTopupReceiptDetailed({
          telegramId,
          amount,
          photoFileId: uploaded.fileId,
          mediaType: decoded.file.mediaType,
          fileUniqueId: uploaded.fileUniqueId,
          fileSha256,
          cardId,
          cardNumber: normalizedCardNumber,
        });

        if (cardId && typeof options.paymentService?.recordCardDailyUsage === 'function') {
          options.paymentService.recordCardDailyUsage(cardId, amount);
        }

        // Prevent double credit if the user fell back from a pending ForApp automated order
        // to manual receipt upload.
        await options.automatedPaymentService?.cancelPendingForAppOrdersForUser?.(telegramId);

        const cardSummary =
          typeof options.paymentService?.resolveCardDisplayLabel === 'function'
            ? options.paymentService.resolveCardDisplayLabel({
                cardId,
                cardNumber: normalizedCardNumber,
              })
            : null;

        void sendAdminNewReceiptNotification(
          options.botApi,
          {
            userService: options.userService,
            translationService: ts,
            adminIds,
          },
          {
            receiptId: submitted.receiptId,
            telegramId,
            amount,
            photoFileId: uploaded.fileId,
            mediaType: decoded.file.mediaType,
            duplicateOfReceiptId: submitted.duplicateOfReceiptId,
            cardSummary,
          }
        );

        return reply.code(201).send({
          success: true,
          receiptId: submitted.receiptId,
          shortId: formatReceiptShortId(submitted.receiptId),
          amount,
          status: 'pending',
          duplicateWarning: Boolean(submitted.duplicateOfReceiptId),
        });
      } catch (err: unknown) {
        if (err instanceof PendingTopupReceiptError) {
          return reply.code(409).send({
            error: 'You already have a pending receipt under review',
            code: 'PENDING_RECEIPT_EXISTS',
          });
        }
        if (err instanceof DuplicateReceiptError) {
          return reply.code(409).send({
            error: 'This receipt image has already been submitted',
            code: 'DUPLICATE_RECEIPT',
          });
        }
        throw err;
      }
    }
  );

  // POST /api/user/wallet/transfer/preview — verify recipient before wallet transfer
  userScope.post<{
    Body?: { recipient?: string };
  }>(
    '/api/user/wallet/transfer/preview',
    {
      config: {
        rateLimit: limits.action30,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (options.translationService && !walletTransferEnabled(options.translationService)) {
        return reply
          .code(403)
          .send({ error: 'Wallet transfer is disabled', code: 'WALLET_TRANSFER_DISABLED' });
      }

      const rawRecipient =
        typeof request.body?.recipient === 'string' ? request.body.recipient.trim() : '';
      if (!rawRecipient) {
        return reply.code(400).send({ error: 'Recipient is required', code: 'INVALID_RECIPIENT' });
      }

      const target =
        typeof options.userService.findTransferRecipient === 'function'
          ? await options.userService.findTransferRecipient(rawRecipient)
          : null;
      if (!target) {
        return reply
          .code(404)
          .send({ error: 'Recipient user not found', code: 'TRANSFER_TARGET_NOT_FOUND' });
      }
      if (target.telegramId === telegramId) {
        return reply
          .code(400)
          .send({ error: 'Cannot transfer to yourself', code: 'TRANSFER_TO_SELF' });
      }
      if (target.isBanned) {
        return reply
          .code(403)
          .send({ error: 'Recipient account is banned', code: 'TRANSFER_TARGET_BANNED' });
      }

      return reply.code(200).send({
        recipient: buildMaskedRecipientPreview(target),
      });
    }
  );

  // POST /api/user/wallet/transfer — execute atomic P2P wallet transfer
  userScope.post<{
    Body?: { recipient?: string; toTelegramId?: number; amount?: number; note?: string };
  }>(
    '/api/user/wallet/transfer',
    {
      config: {
        rateLimit: limits.action10,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (options.translationService && !walletTransferEnabled(options.translationService)) {
        return reply
          .code(403)
          .send({ error: 'Wallet transfer is disabled', code: 'WALLET_TRANSFER_DISABLED' });
      }

      if (typeof options.walletService.transferBalance !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Wallet transfer unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const minAmount = options.translationService
        ? walletTransferMinAmount(options.translationService)
        : 5_000;
      const amount = Number(request.body?.amount);
      if (!Number.isSafeInteger(amount) || amount < minAmount) {
        return reply.code(400).send({
          error: `Minimum transfer amount is ${minAmount}`,
          code: 'TRANSFER_BELOW_MIN',
          minAmount,
        });
      }

      let toTelegramId =
        typeof request.body?.toTelegramId === 'number' &&
        Number.isSafeInteger(request.body.toTelegramId) &&
        request.body.toTelegramId > 0
          ? request.body.toTelegramId
          : undefined;
      if (!toTelegramId && typeof request.body?.recipient === 'string') {
        const target =
          typeof options.userService.findTransferRecipient === 'function'
            ? await options.userService.findTransferRecipient(request.body.recipient)
            : null;
        if (!target) {
          return reply
            .code(404)
            .send({ error: 'Recipient user not found', code: 'TRANSFER_TARGET_NOT_FOUND' });
        }
        toTelegramId = target.telegramId;
      }
      if (!toTelegramId) {
        return reply.code(400).send({ error: 'Recipient is required', code: 'INVALID_RECIPIENT' });
      }

      const note =
        typeof request.body?.note === 'string' ? request.body.note.trim().slice(0, 120) : undefined;

      try {
        const result = await options.walletService.transferBalance({
          fromTelegramId: telegramId,
          toTelegramId,
          amount,
          ...(note ? { description: note } : {}),
        });

        if (options.botApi && options.translationService) {
          const sender = await options.userService.findProfile(String(telegramId));
          const senderName = sender
            ? [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() ||
              (sender.username ? `@${sender.username}` : undefined)
            : undefined;
          void sendWebAppWalletTransferNotification(
            options.botApi,
            {
              userService: options.userService,
              translationService: options.translationService,
            },
            {
              fromTelegramId: telegramId,
              fromDisplayName: senderName,
              toTelegramId: result.toTelegramId,
              amount: result.amount,
              recipientBalanceAfter: result.toBalanceAfter,
              webAppUrl: options.webAppUrl,
            }
          );
        }

        return reply.code(200).send({
          success: true,
          amount: result.amount,
          toTelegramId: result.toTelegramId,
          fromBalanceAfter: result.fromBalanceAfter,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'TRANSFER_TO_SELF') {
          return reply
            .code(400)
            .send({ error: 'Cannot transfer to yourself', code: 'TRANSFER_TO_SELF' });
        }
        if (msg === 'TRANSFER_TARGET_NOT_FOUND') {
          return reply
            .code(404)
            .send({ error: 'Recipient user not found', code: 'TRANSFER_TARGET_NOT_FOUND' });
        }
        if (msg === 'TRANSFER_TARGET_BANNED') {
          return reply
            .code(403)
            .send({ error: 'Recipient account is banned', code: 'TRANSFER_TARGET_BANNED' });
        }
        if (msg === 'INSUFFICIENT_BALANCE') {
          return reply
            .code(409)
            .send({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });
        }
        if (msg === 'INVALID_TRANSFER_AMOUNT') {
          return reply
            .code(400)
            .send({ error: 'Invalid transfer amount', code: 'INVALID_TRANSFER_AMOUNT' });
        }
        throw err;
      }
    }
  );

  const serializePaymentOrder = (order: PaymentOrderRow) => ({
    id: order.id,
    shortId: formatPaymentOrderShortId(order.id),
    provider: order.provider,
    status: order.status,
    requestedAmount: order.requestedAmount,
    payableAmount: order.payableAmount,
    payableAmountRial: order.payableAmountRial ?? null,
    creditedAmount: order.creditedAmount ?? null,
    cashbackAmount: order.cashbackAmount ?? 0,
    cardId: order.cardId ?? null,
    cardNumber: order.cardNumber ?? null,
    cardHolder: order.cardHolder ?? null,
    bankName: order.bankName ?? null,
    paymentUrl: order.paymentUrl ?? null,
    fiatAmountUsd: order.fiatAmountUsd ?? null,
    exchangeRateTomanPerUsd: order.exchangeRateTomanPerUsd ?? null,
    payCurrency: order.payCurrency ?? null,
    payAmount: order.payAmount ?? null,
    actuallyPaid: order.actuallyPaid ?? null,
    providerStatus: order.providerStatus ?? null,
    expiresAt:
      order.expiresAt instanceof Date ? order.expiresAt.toISOString() : String(order.expiresAt),
    completedAt:
      order.completedAt instanceof Date
        ? order.completedAt.toISOString()
        : order.completedAt
          ? String(order.completedAt)
          : null,
    createdAt:
      order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt),
  });

  // POST /api/user/topup/forapp-order — create automated ForApp card-to-card order
  userScope.post<{
    Body?: { amount?: number };
  }>(
    '/api/user/topup/forapp-order',
    {
      config: { rateLimit: limits.action10 },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!options.automatedPaymentService) {
        return reply
          .code(503)
          .send({ error: 'Automated payment service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const profile = await options.userService.findProfile(String(telegramId));
      if (!profile) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      const locale = await resolveUserLocale(telegramId, options);
      try {
        const order = await options.automatedPaymentService.createForAppOrder({
          telegramId,
          requestedAmount: Number(request.body?.amount),
          locale,
        });
        return reply.code(201).send({
          order: serializePaymentOrder(order),
          nativeUploadEnabled: Boolean(options.botApi),
        });
      } catch (err) {
        if (err instanceof AutomatedPaymentError) {
          const statusMap: Record<string, number> = {
            FORAPP_DISABLED: 403,
            INVALID_TOPUP_AMOUNT: 400,
            ALL_CARDS_CAP_REACHED: 503,
            NO_BANK_CARD: 503,
            NO_UNIQUE_AMOUNT_AVAILABLE: 503,
          };
          return reply
            .code(statusMap[err.code] ?? 400)
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    }
  );

  // POST /api/user/topup/nowpayments-order — create NOWPayments crypto invoice
  userScope.post<{
    Body?: { amount?: number };
  }>(
    '/api/user/topup/nowpayments-order',
    {
      config: { rateLimit: limits.action10 },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!options.automatedPaymentService) {
        return reply
          .code(503)
          .send({ error: 'Automated payment service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const profile = await options.userService.findProfile(String(telegramId));
      if (!profile) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      try {
        const order = await options.automatedPaymentService.createNowPaymentsOrder({
          telegramId,
          amountToman: Number(request.body?.amount),
        });
        return reply.code(201).send({ order: serializePaymentOrder(order) });
      } catch (err) {
        if (err instanceof AutomatedPaymentError) {
          const statusMap: Record<string, number> = {
            NOWPAYMENTS_DISABLED: 403,
            NOWPAYMENTS_NOT_CONFIGURED: 503,
            INVALID_TOPUP_AMOUNT: 400,
            AMOUNT_TOO_SMALL_USD: 400,
          };
          return reply
            .code(statusMap[err.code] ?? 400)
            .send({ error: err.message, code: err.code });
        }
        return reply.code(502).send({
          error: err instanceof Error ? err.message : 'Failed to create NOWPayments invoice',
          code: 'NOWPAYMENTS_INVOICE_FAILED',
        });
      }
    }
  );

  // GET /api/user/topup/orders — list user's automated payment orders
  userScope.get<{
    Querystring: { page?: string; limit?: string };
  }>(
    '/api/user/topup/orders',
    {
      config: { rateLimit: limits.standard },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!options.automatedPaymentService) {
        return reply.code(200).send({ orders: [], total: 0, page: 1, totalPages: 1 });
      }
      const page = clampPositiveInt(request.query.page, 1, 10_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);
      const res = await options.automatedPaymentService.listOrdersForUser(telegramId, page, limit);
      return reply.code(200).send({
        orders: res.orders.map(serializePaymentOrder),
        total: res.total,
        page: res.page,
        totalPages: res.totalPages,
      });
    }
  );

  // GET /api/user/topup/orders/:id/status — poll or verify automated order status
  userScope.get<{
    Params: { id: string };
  }>(
    '/api/user/topup/orders/:id/status',
    {
      config: { rateLimit: limits.action30 },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }

      const checked = await options.automatedPaymentService.checkOrderStatusForUser({
        orderId: request.params.id,
        telegramId,
      });
      if (!checked) {
        return reply.code(404).send({ error: 'Payment order not found', code: 'ORDER_NOT_FOUND' });
      }

      if (checked.newlyCompleted && options.botApi && options.translationService) {
        const notifyServices = {
          userService: options.userService,
          translationService: options.translationService,
          adminIds: options.adminService?.adminIds ?? options.adminIds ?? [],
        };
        const provider =
          checked.order.provider === 'nowpayments' ? 'nowpayments' : ('forapp_card' as const);
        const creditedAmount = checked.order.creditedAmount ?? checked.order.payableAmount;
        void sendAutomatedTopupSuccessNotification(options.botApi, notifyServices, {
          telegramId,
          amount: creditedAmount,
          cashbackAmount: checked.order.cashbackAmount,
          balanceAfter: checked.balanceAfter,
          provider,
          orderId: checked.order.id,
        });
        void sendAdminAutomatedTopupReport(options.botApi, notifyServices, {
          telegramId,
          amount: creditedAmount,
          cashbackAmount: checked.order.cashbackAmount,
          provider,
          orderId: checked.order.id,
          payCurrency: checked.order.payCurrency,
        });
      }

      return reply.code(200).send({
        order: serializePaymentOrder(checked.order),
        newlyCompleted: checked.newlyCompleted,
      });
    }
  );

  // POST /api/user/topup/orders/:id/cancel — cancel user's pending automated order
  userScope.post<{
    Params: { id: string };
  }>(
    '/api/user/topup/orders/:id/cancel',
    {
      config: { rateLimit: limits.action30 },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!options.automatedPaymentService) {
        return reply.code(503).send({ error: 'Automated payment service unavailable' });
      }
      const cancelled = await options.automatedPaymentService.cancelOrderForUser(
        request.params.id,
        telegramId
      );
      if (!cancelled) {
        return reply.code(404).send({ error: 'Pending order not found', code: 'ORDER_NOT_FOUND' });
      }
      return reply.code(200).send({ success: true, order: serializePaymentOrder(cancelled) });
    }
  );
}
