import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authGuard } from '../middleware/adminGuard.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import type { PricingService, PackageOption } from '../../../domain/services/PricingService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import {
  type PurchaseCheckoutService,
  PurchaseCheckoutUnavailableError,
} from '../../../domain/services/PurchaseCheckoutService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../../../domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../../../domain/services/RebeccaService.js';
import { customVolumeEnabled } from '../../../domain/services/FeatureSettings.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import {
  recordCheckoutCompleted,
  recordCheckoutFailed,
} from '../../../telegram/checkoutLifecycle.js';

function clampPositiveInt(val: string | number | undefined, fallback: number, max = 1000): number {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = typeof val === 'number' ? val : Number.parseInt(String(val), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function normalizeSupportUsername(raw: string | undefined | null): string {
  if (!raw) return '';
  let str = raw.trim();
  str = str.replace(/^https?:\/\//i, '');
  str = str.replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, '');
  str = str.replace(/^@+/, '');
  str = str.split('?')[0].split('#')[0];
  str = str.split('/')[0].trim();
  return str;
}

async function safeRecordCheckoutCompleted(
  service: PurchaseCheckoutService | undefined,
  checkoutId: string
): Promise<void> {
  if (!service) return;
  await recordCheckoutCompleted(service, checkoutId);
}

async function safeRecordCheckoutFailed(
  service: PurchaseCheckoutService | undefined,
  checkoutId: string
): Promise<void> {
  if (!service) return;
  await recordCheckoutFailed(service, checkoutId);
}

interface CheckoutRequestBody {
  packageId?: string;
  custom?: {
    gb?: number;
    days?: number;
  };
}

export function registerUserRoutes(
  app: FastifyInstance,
  options: {
    userService: UserService;
    walletService: WalletService;
    configService?: ConfigService;
    pricingService?: PricingService;
    translationService?: TranslationService;
    purchaseCheckoutService?: PurchaseCheckoutService;
    botUsername?: string;
  }
): void {
  const userRateLimitKey = (req: FastifyRequest) => String(req.userSession?.telegramId || req.ip);

  const standardUserRateLimit = {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: userRateLimitKey,
  };

  const checkoutRateLimit = {
    max: 20,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: userRateLimitKey,
  };

  const confirmRateLimit = {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: userRateLimitKey,
  };

  app.register(async (userScope) => {
    userScope.addHook('preHandler', authGuard);

    userScope.addHook('preHandler', async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (telegramId && (await options.userService.isBanned?.(telegramId))) {
        return reply.code(403).send({ error: 'User is banned', code: 'USER_BANNED' });
      }
    });

    // GET /api/user/profile
    userScope.get(
      '/api/user/profile',
      {
        config: {
          rateLimit: standardUserRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        let profile = await options.userService.findProfile(String(telegramId));
        if (!profile) {
          await options.walletService.getOrCreateUser(telegramId);
          profile = await options.userService.findProfile(String(telegramId));
        }

        if (!profile) {
          return reply.code(404).send({ error: 'User profile not found' });
        }

        const currency = options.translationService?.getSetting('currency', 'تومان') || 'تومان';
        const cardNumber = options.translationService?.getSetting('card_number', '') || '';
        const cardHolder = options.translationService?.getSetting('card_holder', '') || '';
        const rawSupport = options.translationService?.getSetting('support_destination', '') || '';
        const supportUsername = normalizeSupportUsername(rawSupport);
        const supportEnabled =
          options.translationService?.getSettingBool('support_enabled', true) ?? true;

        const availableBalance = Math.max(0, profile.balance - profile.reservedBalance);

        const pendingReceiptRow =
          await options.walletService.getPendingReceiptForUser?.(telegramId);
        const pendingReceipt = pendingReceiptRow
          ? {
              id: pendingReceiptRow.id,
              amount: pendingReceiptRow.amount,
              status: pendingReceiptRow.status,
              createdAt:
                pendingReceiptRow.createdAt instanceof Date
                  ? pendingReceiptRow.createdAt.toISOString()
                  : String(pendingReceiptRow.createdAt),
            }
          : null;

        const cvEnabled = options.translationService
          ? customVolumeEnabled(options.translationService)
          : true;
        const pricePerGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('price_per_gb', 5000)
            : 5000;
        const pricePerDay =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('price_per_day', 0)
            : 0;
        const topupMinAmount =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('topup_min_amount', 10_000)
            : 10_000;
        const topupMaxAmount =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('topup_max_amount', 10_000_000)
            : 10_000_000;

        const defaultDays =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_default_days', 30)
            : 30;
        const minGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_min_gb', 5)
            : 5;
        const maxGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_max_gb', 500)
            : 500;

        return reply.code(200).send({
          user: {
            id: profile.id,
            telegramId: profile.telegramId,
            username: profile.username,
            firstName: profile.firstName,
            lastName: profile.lastName,
            balance: profile.balance,
            reservedBalance: profile.reservedBalance,
            availableBalance,
            referralCode: profile.referralCode,
            totalSpend: profile.totalSpend,
            activeSubscriptionCount: profile.activeSubscriptionCount,
            transactionCount: profile.transactionCount,
            referredUserCount: profile.referredUserCount,
            referralBonusEarned: profile.referralBonusEarned,
            cashbackEarned: profile.cashbackEarned,
            hasUsedTrial: profile.hasUsedTrial,
            createdAt: profile.createdAt,
          },
          settings: {
            currency,
            cardNumber,
            cardHolder,
            supportUsername,
            supportEnabled,
            botUsername: options.botUsername || '',
            topupMinAmount,
            topupMaxAmount,
            customVolume: {
              enabled: cvEnabled,
              pricePerGb,
              pricePerDay,
              defaultDays,
              minGb,
              maxGb,
            },
          },
          pendingReceipt,
        });
      }
    );

    // GET /api/user/configs
    userScope.get(
      '/api/user/configs',
      {
        config: {
          rateLimit: standardUserRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.configService) {
          return reply.code(200).send({ configs: [] });
        }

        const rows = await options.configService.listConfigsForOwner(telegramId);
        const configs = rows.map((c) => ({
          id: c.id,
          configUsername: c.configUsername,
          subUrl: c.subUrl,
          panelStatus: c.panelStatus,
          panelDataLimit: c.panelDataLimit,
          panelUsedTraffic: c.panelUsedTraffic,
          panelExpire: c.panelExpire,
          autoRenewEnabled: c.autoRenewEnabled,
          createdAt: c.createdAt,
        }));

        return reply.code(200).send({ configs });
      }
    );

    // GET /api/user/packages
    userScope.get(
      '/api/user/packages',
      {
        config: {
          rateLimit: standardUserRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.pricingService) {
          return reply.code(200).send({ packages: [] });
        }

        const packages = options.pricingService
          .getPackages(undefined, undefined, false)
          .filter((p) => p.enabled !== false)
          .map((p) => ({
            id: p.id,
            name: p.name,
            gbAmount: p.gbAmount,
            durationDays: p.durationDays,
            price: p.price,
          }));

        return reply.code(200).send({ packages });
      }
    );

    // GET /api/user/transactions
    userScope.get<{
      Querystring: {
        page?: string;
        limit?: string;
      };
    }>(
      '/api/user/transactions',
      {
        config: {
          rateLimit: standardUserRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const page = clampPositiveInt(request.query.page, 1, 10_000);
        const limit = clampPositiveInt(request.query.limit, 10, 50);

        const result = await options.walletService.listTransactionsForUser(telegramId, page, limit);

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
        });
      }
    );

    // GET /api/user/quote
    userScope.get<{
      Querystring: {
        gb?: string;
        days?: string;
      };
    }>(
      '/api/user/quote',
      {
        config: {
          rateLimit: standardUserRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const minGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_min_gb', 5)
            : 5;
        const maxGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_max_gb', 500)
            : 500;
        const defaultDays =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('custom_default_days', 30)
            : 30;

        let gb = minGb;
        if (request.query.gb !== undefined && request.query.gb !== '') {
          const parsed = Number(request.query.gb);
          if (!Number.isSafeInteger(parsed) || parsed < minGb || parsed > maxGb) {
            return reply.code(400).send({
              error: `GB amount must be between ${minGb} and ${maxGb}`,
              code: 'INVALID_CUSTOM_BOUNDS',
            });
          }
          gb = parsed;
        }

        let days = defaultDays;
        if (request.query.days !== undefined && request.query.days !== '') {
          const parsed = Number(request.query.days);
          if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365) {
            return reply.code(400).send({
              error: 'Duration days must be between 1 and 365',
              code: 'INVALID_CUSTOM_BOUNDS',
            });
          }
          days = parsed;
        }

        if (options.pricingService) {
          try {
            const quote = options.pricingService.getCustomPriceQuote(gb, days);
            return reply.code(200).send({
              gbAmount: gb,
              durationDays: days,
              totalPrice: quote.totalPrice,
              pricePerGb: quote.pricePerGb,
              pricePerDay: quote.pricePerDay,
            });
          } catch {
            // fallback to linear calculation
          }
        }

        const pricePerGb =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('price_per_gb', 5000)
            : 5000;
        const pricePerDay =
          typeof options.translationService?.getSettingNum === 'function'
            ? options.translationService.getSettingNum('price_per_day', 0)
            : 0;
        return reply.code(200).send({
          gbAmount: gb,
          durationDays: days,
          totalPrice: gb * pricePerGb + days * pricePerDay,
          pricePerGb,
          pricePerDay,
        });
      }
    );

    // POST /api/user/checkout
    userScope.post<{
      Body: CheckoutRequestBody;
    }>(
      '/api/user/checkout',
      {
        config: {
          rateLimit: checkoutRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (await options.userService.isBanned?.(telegramId)) {
          return reply.code(403).send({ error: 'User is banned', code: 'USER_BANNED' });
        }

        if (!options.purchaseCheckoutService) {
          return reply.code(500).send({ error: 'Purchase checkout service unavailable' });
        }

        const body = request.body;
        if (!body || typeof body !== 'object') {
          return reply
            .code(400)
            .send({ error: 'Invalid checkout request', code: 'INVALID_REQUEST' });
        }

        const hasPackageId = typeof body.packageId === 'string' && body.packageId.trim().length > 0;
        const hasCustom =
          body.custom !== undefined && typeof body.custom === 'object' && body.custom !== null;

        if ((!hasPackageId && !hasCustom) || (hasPackageId && hasCustom)) {
          return reply
            .code(400)
            .send({ error: 'Provide either packageId or custom volume', code: 'INVALID_REQUEST' });
        }

        let pkg: PackageOption | undefined;
        let target: { panelId?: string; serviceId?: number } = {};
        let quotedAmount = 0;

        if (hasPackageId) {
          if (!options.pricingService) {
            return reply.code(500).send({ error: 'Pricing service unavailable' });
          }

          const resolvedPkg = options.pricingService.getPackageById(body.packageId);
          if (!resolvedPkg || resolvedPkg.enabled === false) {
            return reply
              .code(404)
              .send({ error: 'Package not found or disabled', code: 'PACKAGE_NOT_FOUND' });
          }

          pkg = resolvedPkg;
          quotedAmount = resolvedPkg.price;
          if (resolvedPkg.panelId !== undefined || resolvedPkg.serviceId !== undefined) {
            target = { panelId: resolvedPkg.panelId, serviceId: resolvedPkg.serviceId };
          }
        } else if (hasCustom) {
          if (options.translationService && !customVolumeEnabled(options.translationService)) {
            return reply
              .code(400)
              .send({ error: 'Custom volume is disabled', code: 'CUSTOM_VOLUME_DISABLED' });
          }

          const minGb =
            typeof options.translationService?.getSettingNum === 'function'
              ? options.translationService.getSettingNum('custom_min_gb', 5)
              : 5;
          const maxGb =
            typeof options.translationService?.getSettingNum === 'function'
              ? options.translationService.getSettingNum('custom_max_gb', 500)
              : 500;
          const defaultDays =
            typeof options.translationService?.getSettingNum === 'function'
              ? options.translationService.getSettingNum('custom_default_days', 30)
              : 30;

          const gb = body.custom!.gb;
          const days = body.custom!.days ?? defaultDays;

          if (
            typeof gb !== 'number' ||
            !Number.isSafeInteger(gb) ||
            gb < minGb ||
            gb > maxGb ||
            typeof days !== 'number' ||
            !Number.isSafeInteger(days) ||
            days < 1 ||
            days > 365
          ) {
            return reply
              .code(400)
              .send({ error: 'Volume or duration out of bounds', code: 'INVALID_CUSTOM_BOUNDS' });
          }

          if (!options.pricingService) {
            return reply.code(500).send({ error: 'Pricing service unavailable' });
          }

          const quote = options.pricingService.getCustomPriceQuote(gb, days);
          quotedAmount = quote.totalPrice;
          target =
            typeof options.pricingService.getCustomVolumeTarget === 'function'
              ? options.pricingService.getCustomVolumeTarget()
              : {};

          pkg = {
            id: `custom_${gb}gb_${days}d`,
            name: `${gb} GB (${days} days)`,
            gbAmount: gb,
            durationDays: days,
            price: quote.totalPrice,
            ...target,
          };
        }

        if (!pkg) {
          return reply
            .code(400)
            .send({ error: 'Invalid checkout request', code: 'INVALID_REQUEST' });
        }

        let profile = await options.userService.findProfile(String(telegramId));
        if (!profile) {
          await options.walletService.getOrCreateUser(telegramId);
          profile = await options.userService.findProfile(String(telegramId));
        }

        if (!profile) {
          return reply.code(404).send({ error: 'User profile not found' });
        }

        const availableBalance = Math.max(0, profile.balance - profile.reservedBalance);
        if (availableBalance < quotedAmount) {
          return reply.code(409).send({
            error: 'Insufficient balance',
            code: 'INSUFFICIENT_BALANCE',
            deficit: quotedAmount - availableBalance,
            availableBalance,
            price: quotedAmount,
          });
        }

        const checkout = await options.purchaseCheckoutService.create({
          telegramId,
          kind: 'new_config',
          pkg,
          ...target,
          quotedAmount,
        });

        trackFunnelEvent('checkout_start');

        return reply.code(201).send({
          checkoutId: checkout.id,
          name: checkout.packageName,
          gb: checkout.gbAmount,
          days: checkout.durationDays,
          price: checkout.amount,
          quotedAmount: checkout.quotedAmount,
          availableBalance,
          expiresAt:
            checkout.expiresAt instanceof Date
              ? checkout.expiresAt.toISOString()
              : String(checkout.expiresAt),
        });
      }
    );

    // POST /api/user/checkout/:id/confirm
    userScope.post<{
      Params: { id: string };
    }>(
      '/api/user/checkout/:id/confirm',
      {
        config: {
          rateLimit: confirmRateLimit,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (await options.userService.isBanned?.(telegramId)) {
          return reply.code(403).send({ error: 'User is banned', code: 'USER_BANNED' });
        }

        if (!options.purchaseCheckoutService) {
          return reply.code(500).send({ error: 'Purchase checkout service unavailable' });
        }

        const { id } = request.params;
        let checkout;
        try {
          checkout = await options.purchaseCheckoutService.claim(id, telegramId);
        } catch (err: unknown) {
          if (
            err instanceof PurchaseCheckoutUnavailableError ||
            (err instanceof Error && err.name === 'PurchaseCheckoutUnavailableError')
          ) {
            const reason = (err as PurchaseCheckoutUnavailableError).reason;
            switch (reason) {
              case 'expired':
                return reply
                  .code(410)
                  .send({ error: 'Checkout expired', code: 'CHECKOUT_EXPIRED' });
              case 'consumed':
                return reply
                  .code(409)
                  .send({ error: 'Checkout already consumed', code: 'CHECKOUT_CONSUMED' });
              case 'owner_mismatch':
                return reply
                  .code(403)
                  .send({ error: 'Checkout belongs to another user', code: 'OWNER_MISMATCH' });
              case 'missing':
                return reply
                  .code(404)
                  .send({ error: 'Checkout not found', code: 'CHECKOUT_NOT_FOUND' });
            }
          }
          throw err;
        }

        // Re-check available balance >= checkout.quotedAmount
        const profile = await options.userService.findProfile(String(telegramId));
        const availableBalance = profile
          ? Math.max(0, profile.balance - profile.reservedBalance)
          : 0;
        if (availableBalance < checkout.quotedAmount) {
          await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);
          return reply
            .code(409)
            .send({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });
        }

        // Generate configName
        let configName: string;
        if (typeof options.configService?.generateConfigName === 'function') {
          configName = await options.configService.generateConfigName(
            telegramId,
            checkout.panelId ?? undefined
          );
        } else {
          configName = `u${telegramId}_${Date.now()}`;
        }

        // Execute saga
        try {
          const result = await options.walletService.executePurchaseSaga({
            telegramId,
            amount: checkout.amount,
            maxAmount: checkout.quotedAmount,
            type: 'new_config',
            configUsername: configName,
            gbAmount: checkout.gbAmount,
            durationDays: checkout.durationDays,
            panelId: checkout.panelId,
            serviceId: checkout.serviceId,
            checkoutId: checkout.id,
          });

          await safeRecordCheckoutCompleted(options.purchaseCheckoutService, checkout.id);
          trackFunnelEvent('purchase_confirm');
          return reply.code(200).send({
            success: true,
            configUsername: result.configUsername,
            subUrl: result.subUrl,
          });
        } catch (err: unknown) {
          trackFunnelEvent('purchase_failed');
          await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);

          if (
            err instanceof PurchaseInProgressError ||
            (err instanceof Error &&
              (err.name === 'PurchaseInProgressError' ||
                (err as { code?: unknown }).code === 'PURCHASE_IN_PROGRESS'))
          ) {
            return reply.code(409).send({
              error: 'Purchase already in progress',
              code: 'PURCHASE_IN_PROGRESS',
            });
          }

          if (
            err instanceof PurchaseOutcomePendingError ||
            (err instanceof Error &&
              (err.name === 'PurchaseOutcomePendingError' ||
                (err as { code?: unknown }).code === 'PURCHASE_OUTCOME_PENDING'))
          ) {
            return reply.code(202).send({
              error: 'being verified, funds stay reserved',
              message: 'being verified, funds stay reserved',
              code: 'PURCHASE_OUTCOME_PENDING',
            });
          }

          if (
            err instanceof RebeccaOriginDownError ||
            (err instanceof Error &&
              (err.name === 'RebeccaOriginDownError' ||
                (err.cause instanceof Error && err.cause.name === 'RebeccaOriginDownError')))
          ) {
            return reply.code(503).send({
              error: 'Panel is temporarily unavailable',
              code: 'PANEL_DOWN',
            });
          }

          if (
            err instanceof Error &&
            (err.message === 'INSUFFICIENT_BALANCE' ||
              (err as { code?: unknown }).code === 'INSUFFICIENT_BALANCE')
          ) {
            return reply.code(409).send({
              error: 'Insufficient balance',
              code: 'INSUFFICIENT_BALANCE',
            });
          }

          if (
            err instanceof Error &&
            (err.message === 'PURCHASE_QUOTE_CHANGED' ||
              (err as { code?: unknown }).code === 'PURCHASE_QUOTE_CHANGED')
          ) {
            return reply.code(409).send({
              error: 'Purchase quote has changed',
              code: 'PURCHASE_QUOTE_CHANGED',
            });
          }

          return reply.code(500).send({
            error: 'Purchase failed',
            code: 'PURCHASE_FAILED',
          });
        }
      }
    );
  });
}
