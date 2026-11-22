import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authGuard } from '../middleware/adminGuard.js';
import { resolveRateLimitKey } from '../server.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import { normalizeCustomServiceName } from '../../../domain/services/ConfigService.js';
import type { PricingService } from '../../../domain/services/PricingService.js';
import type { PackageCategoryService } from '../../../domain/services/PackageCategoryService.js';
import { PromoValidationError, type PromoService } from '../../../domain/services/PromoService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import {
  detectIranianBankName,
  normalizeCardNumber,
  parseBankCardsJson,
  type PaymentService,
} from '../../../domain/services/PaymentService.js';
import {
  type PurchaseCheckoutService,
  PurchaseCheckoutUnavailableError,
} from '../../../domain/services/PurchaseCheckoutService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../../../domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../../../domain/services/RebeccaService.js';
import { normalizeDataLimit } from '../../../domain/services/TrafficLimit.js';
import { resolvePurchasePackage } from '../../../domain/services/PurchasePackageResolver.js';
import {
  customServiceNameEnabled,
  customVolumeEnabled,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
} from '../../../domain/services/FeatureSettings.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
  type CatalogDiscountService,
} from '../../../domain/services/CatalogDiscountService.js';
import { ContactVerificationService } from '../../../domain/services/ContactVerificationService.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import {
  recordCheckoutCompleted,
  recordCheckoutFailed,
} from '../../../telegram/checkoutLifecycle.js';
import { computeRolloverPreview } from '../../../telegram/checkoutRenderer.js';

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
  kind?: 'new_config' | 'renew_config';
  configId?: string;
  packageId?: string;
  custom?: {
    gb?: number;
    days?: number;
  };
  promoCode?: string;
  requestedUsername?: string;
  price?: number;
  quotedAmount?: number;
}

export function registerUserRoutes(
  app: FastifyInstance,
  options: {
    userService: UserService;
    walletService: WalletService;
    configService?: ConfigService;
    pricingService?: PricingService;
    packageCategoryService?: PackageCategoryService;
    promoService?: PromoService;
    paymentService?: PaymentService;
    translationService?: TranslationService;
    purchaseCheckoutService?: PurchaseCheckoutService;
    catalogDiscountService?: CatalogDiscountService;
    contactVerificationService?: ContactVerificationService;
    botUsername?: string;
  }
): void {
  const contactVerificationService =
    options.contactVerificationService ??
    new ContactVerificationService({
      translationService: options.translationService,
    });
  const userRateLimitKey = (req: FastifyRequest) => resolveRateLimitKey(req);

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

  const actionRateLimit30 = {
    max: 30,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: userRateLimitKey,
  };

  const actionRateLimit10 = {
    max: 10,
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
        let cardNumber = '';
        let cardHolder = '';
        let bankName = '';
        let cardId = '';

        if (options.paymentService) {
          const selectedCard =
            typeof options.paymentService.selectCardForTopupWithDailyCaps === 'function'
              ? await options.paymentService.selectCardForTopupWithDailyCaps()
              : typeof options.paymentService.selectCardForTopup === 'function'
                ? options.paymentService.selectCardForTopup()
                : null;
          if (selectedCard) {
            cardId = selectedCard.id;
            cardNumber = selectedCard.cardNumber;
            cardHolder = selectedCard.cardHolder;
            bankName = selectedCard.bankName || detectIranianBankName(cardNumber) || '';
          }
        } else if (options.translationService) {
          const configuredEnabled = parseBankCardsJson(
            options.translationService.getSetting('bank_cards_json', '[]')
          ).filter((card) => card.enabled);
          if (configuredEnabled.length > 0) {
            const picked = configuredEnabled[0]!;
            cardId = picked.id;
            cardNumber = picked.cardNumber;
            cardHolder = picked.cardHolder;
            bankName = picked.bankName || detectIranianBankName(cardNumber) || '';
          } else {
            cardNumber = normalizeCardNumber(
              options.translationService.getSetting('card_number', '')
            );
            cardHolder = options.translationService.getSetting('card_holder', '').trim();
            bankName = cardNumber ? (detectIranianBankName(cardNumber) ?? '') : '';
          }
        }

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

        const customNameEnabled = options.translationService
          ? customServiceNameEnabled(options.translationService)
          : false;
        const onHoldDefault = options.translationService
          ? onHoldDefaultEnabled(options.translationService)
          : false;
        const rolloverDefault = options.translationService
          ? renewalRolloverEnabled(options.translationService)
          : true;
        let phoneVerificationRequired: boolean;
        try {
          phoneVerificationRequired =
            await contactVerificationService.shouldRequirePhoneForPurchase(
              telegramId,
              options.translationService
            );
        } catch {
          phoneVerificationRequired = false;
        }

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
            phoneVerificationRequired,
            createdAt: profile.createdAt,
          },
          settings: {
            currency,
            cardNumber,
            cardHolder,
            ...(bankName ? { bankName } : {}),
            ...(cardId ? { cardId } : {}),
            supportUsername,
            supportEnabled,
            botUsername: options.botUsername || '',
            topupMinAmount,
            topupMaxAmount,
            customServiceNameEnabled: customNameEnabled,
            onHoldDefaultEnabled: onHoldDefault,
            renewalRolloverEnabled: rolloverDefault,
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
          panelDataLimit: normalizeDataLimit(c.panelDataLimit) ?? null,
          panelUsedTraffic: c.panelUsedTraffic,
          panelExpire: c.panelExpire,
          panelOnHoldExpireDuration: c.panelOnHoldExpireDuration ?? null,
          autoRenewEnabled: c.autoRenewEnabled,
          autoRenewPackageId: c.autoRenewPackageId,
          autoRenewPrice: c.autoRenewPrice,
          lastSyncedAt: c.lastSyncedAt,
          createdAt: c.createdAt,
        }));

        return reply.code(200).send({ configs });
      }
    );

    // POST /api/user/configs/:id/auto-renew
    userScope.post<{
      Params: { id: string };
      Body?: {
        enabled?: boolean;
        packageId?: string;
        price?: number;
      };
    }>(
      '/api/user/configs/:id/auto-renew',
      {
        config: {
          rateLimit: actionRateLimit30,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.configService) {
          return reply
            .code(503)
            .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const config = await options.configService.getOwnedConfigById(
          telegramId,
          request.params.id
        );
        if (!config) {
          const anyConfig = await options.configService.getConfigById?.(request.params.id);
          if (anyConfig) {
            return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
          }
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }

        const enabled = Boolean(request.body?.enabled);
        if (!enabled) {
          await options.configService.setAutoRenew(telegramId, config.id, false);
          return reply.code(200).send({ success: true, autoRenewEnabled: false });
        }

        if (!options.pricingService) {
          return reply.code(500).send({ error: 'Pricing service unavailable' });
        }

        const availablePackages = options.pricingService.getPackages(
          config.panelId,
          config.serviceId,
          false
        );

        let selectedPackage;
        const requestedPackageId =
          typeof request.body?.packageId === 'string' && request.body.packageId.trim().length > 0
            ? request.body.packageId.trim()
            : undefined;

        if (requestedPackageId) {
          selectedPackage = availablePackages.find((pkg) => pkg.id === requestedPackageId);
          if (!selectedPackage) {
            return reply.code(404).send({
              error: 'Package not found, disabled, or does not match config panel/service',
              code: 'PACKAGE_NOT_FOUND',
            });
          }
        } else if (config.autoRenewPackageId) {
          selectedPackage = availablePackages.find((pkg) => pkg.id === config.autoRenewPackageId);
          if (!selectedPackage) {
            return reply.code(404).send({
              error: 'Configured auto-renew package is no longer available',
              code: 'PACKAGE_NOT_FOUND',
            });
          }
        } else if (availablePackages.length > 0) {
          selectedPackage = availablePackages[0];
        }

        if (!selectedPackage) {
          return reply.code(400).send({
            error: 'No package available for auto-renew',
            code: 'PACKAGE_NOT_FOUND',
          });
        }

        await options.configService.setAutoRenew(
          telegramId,
          config.id,
          true,
          selectedPackage.id,
          selectedPackage.price
        );
        return reply.code(200).send({
          success: true,
          autoRenewEnabled: true,
          packageId: selectedPackage.id,
          packageName: selectedPackage.name,
          price: selectedPackage.price,
        });
      }
    );

    // POST /api/user/configs/:id/toggle-status
    userScope.post<{
      Params: { id: string };
      Body?: {
        status?: 'active' | 'disabled';
      };
    }>(
      '/api/user/configs/:id/toggle-status',
      {
        config: {
          rateLimit: actionRateLimit30,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.configService) {
          return reply
            .code(503)
            .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const config = await options.configService.getOwnedConfigById(
          telegramId,
          request.params.id
        );
        if (!config) {
          const anyConfig = await options.configService.getConfigById?.(request.params.id);
          if (anyConfig) {
            return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
          }
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }

        const requestedStatus = request.body?.status;
        if (
          requestedStatus !== undefined &&
          requestedStatus !== 'active' &&
          requestedStatus !== 'disabled'
        ) {
          return reply.code(400).send({
            error: "Status must be 'active' or 'disabled'",
            code: 'INVALID_STATUS',
          });
        }

        try {
          let finalStatus: 'active' | 'disabled';
          if (requestedStatus === 'active') {
            await options.configService.enableConfig(config.configUsername, config.panelId);
            finalStatus = 'active';
          } else if (requestedStatus === 'disabled') {
            await options.configService.disableConfig(config.configUsername, config.panelId);
            finalStatus = 'disabled';
          } else {
            const res = await options.configService.toggleConfig(
              config.configUsername,
              config.panelId
            );
            finalStatus = res === 'enabled' ? 'active' : 'disabled';
          }

          return reply.code(200).send({ success: true, status: finalStatus });
        } catch (err) {
          if (err instanceof RebeccaOriginDownError) {
            return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
          }
          throw err;
        }
      }
    );

    // POST /api/user/configs/:id/revoke
    userScope.post<{
      Params: { id: string };
    }>(
      '/api/user/configs/:id/revoke',
      {
        config: {
          rateLimit: actionRateLimit10,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.configService) {
          return reply
            .code(503)
            .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const config = await options.configService.getOwnedConfigById(
          telegramId,
          request.params.id
        );
        if (!config) {
          const anyConfig = await options.configService.getConfigById?.(request.params.id);
          if (anyConfig) {
            return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
          }
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }

        try {
          const subUrl = await options.configService.revokeSubscription(
            config.configUsername,
            config.panelId
          );
          return reply.code(200).send({ success: true, subUrl: subUrl ?? '' });
        } catch (err) {
          if (err instanceof RebeccaOriginDownError) {
            return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
          }
          throw err;
        }
      }
    );

    // POST /api/user/configs/:id/refresh
    userScope.post<{
      Params: { id: string };
    }>(
      '/api/user/configs/:id/refresh',
      {
        config: {
          rateLimit: actionRateLimit30,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (!options.configService) {
          return reply
            .code(503)
            .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const config = await options.configService.getOwnedConfigById(
          telegramId,
          request.params.id
        );
        if (!config) {
          const anyConfig = await options.configService.getConfigById?.(request.params.id);
          if (anyConfig) {
            return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
          }
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }

        try {
          let refreshed: {
            panelStatus: string | null;
            panelDataLimit: number | bigint | null;
            panelUsedTraffic: number | bigint | null;
            panelExpire: number | bigint | null;
            panelOnHoldExpireDuration?: number | bigint | null;
            lastSyncedAt: Date | string | null;
          };

          if (typeof options.configService.refreshConfig === 'function') {
            const res = await options.configService.refreshConfig(telegramId, config.id);
            if (!res) {
              return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
            }
            refreshed = res;
          } else {
            const remote = await options.configService.getRemoteConfigDetail(config);
            refreshed = {
              panelStatus: remote.status,
              panelDataLimit: normalizeDataLimit(remote.data_limit) ?? null,
              panelUsedTraffic: remote.used_traffic,
              panelExpire: remote.expire,
              panelOnHoldExpireDuration:
                remote.status === 'on_hold' ? (remote.on_hold_expire_duration ?? null) : null,
              lastSyncedAt: new Date(),
            };
          }

          return reply.code(200).send({
            success: true,
            config: refreshed,
          });
        } catch (err) {
          if (err instanceof RebeccaOriginDownError) {
            return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
          }
          throw err;
        }
      }
    );

    // GET /api/user/configs/:id/renewal-options
    userScope.get<{
      Params: { id: string };
    }>(
      '/api/user/configs/:id/renewal-options',
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
          return reply
            .code(503)
            .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const config = await options.configService.getOwnedConfigById(
          telegramId,
          request.params.id
        );
        if (!config) {
          const anyConfig = await options.configService.getConfigById?.(request.params.id);
          if (anyConfig) {
            return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
          }
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }

        const defaultRollover = options.translationService
          ? renewalRolloverEnabled(options.translationService)
          : true;
        const cvEnabled = options.translationService
          ? customVolumeEnabled(options.translationService)
          : true;

        const activeDiscounts = await safeListActiveDiscounts(options.catalogDiscountService);
        const compatiblePackages = (
          options.pricingService?.getPackages(config.panelId, config.serviceId, false) ?? []
        )
          .filter((p) => p.enabled !== false)
          .map((p) => {
            const discount = resolveBestCatalogDiscount(activeDiscounts, {
              packageId: p.id,
              categoryId: p.categoryId ?? null,
              originalPrice: p.price,
            });
            return {
              id: p.id,
              name: p.name,
              gbAmount: p.gbAmount,
              durationDays: p.durationDays,
              price: discount.effectivePrice,
              originalPrice: discount.originalPrice,
              effectivePrice: discount.effectivePrice,
              discountAmount: discount.discountAmount,
              activeDiscountTitle: discount.activeDiscountTitle,
              discountExpiresAt: discount.discountExpiresAt
                ? discount.discountExpiresAt.toISOString()
                : null,
              categoryId: p.categoryId ?? null,
              rolloverQuota: p.rolloverQuota ?? defaultRollover,
              featured: p.id.includes('popular') || p.id.includes('best') || p.id.includes('pro'),
            };
          });

        const basePreview = computeRolloverPreview({
          enabled: true,
          addedGb: 0,
          addedDays: 0,
          dataLimitBytes: config.panelDataLimit,
          usedTrafficBytes: config.panelUsedTraffic,
          expireTimestampSec: config.panelExpire,
          status: config.panelStatus,
          onHoldExpireDurationSec: config.panelOnHoldExpireDuration ?? null,
        });

        return reply.code(200).send({
          config: {
            id: config.id,
            configUsername: config.configUsername,
            panelStatus: config.panelStatus,
            currentRemainingGb: basePreview.currentRemainingGb ?? null,
            currentRemainingDays: basePreview.currentRemainingDays ?? null,
            autoRenewEnabled: config.autoRenewEnabled,
            autoRenewPackageId: config.autoRenewPackageId ?? null,
            autoRenewPrice: config.autoRenewPrice ?? null,
          },
          packages: compatiblePackages,
          defaultRolloverEnabled: defaultRollover,
          customVolumeEnabled: cvEnabled,
        });
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
          return reply.code(200).send({ packages: [], categories: [] });
        }

        const defaultOnHold = options.translationService
          ? onHoldDefaultEnabled(options.translationService)
          : false;
        const defaultRollover = options.translationService
          ? renewalRolloverEnabled(options.translationService)
          : true;

        const [activeDiscounts, rawCategories] = await Promise.all([
          safeListActiveDiscounts(options.catalogDiscountService),
          (async () => {
            try {
              return (await options.packageCategoryService?.listCategories?.(false)) ?? [];
            } catch {
              return [];
            }
          })(),
        ]);

        const rawPackages = options.pricingService
          .getPackages(undefined, undefined, false)
          .filter((p) => p.enabled !== false);

        const packages = rawPackages.map((p) => {
          const discount = resolveBestCatalogDiscount(activeDiscounts, {
            packageId: p.id,
            categoryId: p.categoryId ?? null,
            originalPrice: p.price,
          });
          return {
            id: p.id,
            name: p.name,
            gbAmount: p.gbAmount,
            durationDays: p.durationDays,
            price: discount.effectivePrice,
            originalPrice: discount.originalPrice,
            effectivePrice: discount.effectivePrice,
            discountAmount: discount.discountAmount,
            activeDiscountTitle: discount.activeDiscountTitle,
            discountExpiresAt: discount.discountExpiresAt
              ? discount.discountExpiresAt.toISOString()
              : null,
            categoryId: p.categoryId ?? null,
            startOnFirstUse: p.startOnFirstUse ?? defaultOnHold,
            rolloverQuota: p.rolloverQuota ?? defaultRollover,
            featured: p.id.includes('popular') || p.id.includes('best') || p.id.includes('pro'),
          };
        });

        const categories = rawCategories
          .filter((cat) => packages.some((pkg) => pkg.categoryId === cat.id))
          .map((cat) => ({
            id: cat.id,
            name: cat.name,
            description: cat.description ?? null,
            icon: cat.icon ?? null,
            displayOrder: cat.displayOrder,
          }));

        return reply.code(200).send({ packages, categories });
      }
    );

    // POST /api/user/promo/quote
    userScope.post<{
      Body: {
        code?: string;
        packageId?: string;
        custom?: { gb?: number; days?: number };
      };
    }>(
      '/api/user/promo/quote',
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
        if (typeof options.promoService?.quoteForPurchase !== 'function') {
          return reply
            .code(503)
            .send({ error: 'Promo service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }
        if (!options.pricingService) {
          return reply.code(500).send({ error: 'Pricing service unavailable' });
        }

        const rawCode = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
        if (!rawCode) {
          return reply.code(400).send({
            error: 'Promo code is required',
            code: 'PROMO_INVALID',
            messageKey: 'promo_invalid',
          });
        }

        const resolved = resolvePurchasePackage({
          packageId: request.body?.packageId,
          custom: request.body?.custom,
          pricingService: options.pricingService,
          translationService: options.translationService,
        });
        if (!resolved.success) {
          return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
        }

        const activeDiscounts = await safeListActiveDiscounts(options.catalogDiscountService);
        const catalogDiscount = resolveBestCatalogDiscount(activeDiscounts, {
          packageId: resolved.pkg.id,
          categoryId: resolved.pkg.categoryId ?? null,
          originalPrice: resolved.quotedAmount,
        });

        try {
          const quote = await options.promoService.quoteForPurchase(
            telegramId,
            rawCode,
            catalogDiscount.effectivePrice,
            resolved.pkg.gbAmount
          );
          return reply.code(200).send({
            valid: true,
            code: quote.code,
            type: quote.type,
            value: quote.value,
            originalPrice: catalogDiscount.originalPrice,
            effectivePrice: catalogDiscount.effectivePrice,
            finalAmount: quote.finalAmount,
            discountAmount: Math.max(0, catalogDiscount.effectivePrice - quote.finalAmount),
            baseGb: resolved.pkg.gbAmount,
            bonusGb: Math.max(0, quote.finalGbAmount - resolved.pkg.gbAmount),
            finalGb: quote.finalGbAmount,
          });
        } catch (err: unknown) {
          if (err instanceof PromoValidationError) {
            return reply.code(400).send({
              error: err.messageKey,
              code:
                err.messageKey === 'promo_not_purchase_code'
                  ? 'PROMO_GIFT_CREDIT_ONLY'
                  : 'PROMO_INVALID',
              messageKey: err.messageKey,
            });
          }
          return reply.code(400).send({
            error: 'promo_redeem_failed',
            code: 'PROMO_INVALID',
            messageKey: 'promo_redeem_failed',
          });
        }
      }
    );

    // POST /api/user/promo/redeem
    userScope.post<{
      Body: { code?: string };
    }>(
      '/api/user/promo/redeem',
      {
        config: {
          rateLimit: actionRateLimit10,
        },
      },
      async (request, reply) => {
        const telegramId = request.userSession?.telegramId;
        if (!telegramId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        if (typeof options.promoService?.redeemCode !== 'function') {
          return reply
            .code(503)
            .send({ error: 'Promo service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }

        const rawCode = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
        if (!rawCode) {
          return reply
            .code(400)
            .send({ error: 'promo_invalid', code: 'PROMO_INVALID', messageKey: 'promo_invalid' });
        }

        const res = await options.promoService.redeemCode(telegramId, rawCode);
        if (!res.success) {
          return reply.code(400).send({
            error: res.messageKey,
            code: 'PROMO_INVALID',
            messageKey: res.messageKey,
          });
        }
        if (res.codeType !== 'gift_credit') {
          return reply.code(400).send({
            error: 'Purchase promo codes must be applied during checkout',
            code: 'PROMO_PURCHASE_ONLY',
            messageKey: 'promo_valid',
            promoType: res.codeType,
          });
        }

        const profile = await options.userService.findProfile(String(telegramId));
        const availableBalance = profile
          ? Math.max(0, profile.balance - profile.reservedBalance)
          : undefined;
        return reply.code(200).send({
          success: true,
          code: res.code,
          type: 'gift_credit',
          value: res.value ?? 0,
          messageKey: res.messageKey,
          ...(availableBalance !== undefined ? { availableBalance } : {}),
        });
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

        const activeDiscounts = await safeListActiveDiscounts(options.catalogDiscountService);

        if (options.pricingService) {
          try {
            const quote = options.pricingService.getCustomPriceQuote(gb, days);
            const discount = resolveBestCatalogDiscount(activeDiscounts, {
              packageId: `custom_${gb}gb_${days}d`,
              categoryId: null,
              originalPrice: quote.totalPrice,
            });
            return reply.code(200).send({
              gbAmount: gb,
              durationDays: days,
              totalPrice: discount.effectivePrice,
              originalPrice: discount.originalPrice,
              effectivePrice: discount.effectivePrice,
              activeDiscountTitle: discount.activeDiscountTitle,
              discountExpiresAt: discount.discountExpiresAt
                ? discount.discountExpiresAt.toISOString()
                : null,
              pricePerGb: quote.pricePerGb,
              pricePerDay: quote.pricePerDay,
            });
          } catch (err: unknown) {
            return reply.code(400).send({
              error: err instanceof Error ? err.message : 'Invalid custom quote parameters',
              code: 'INVALID_CUSTOM_BOUNDS',
            });
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
        const baseTotalPrice = gb * pricePerGb + days * pricePerDay;
        const discount = resolveBestCatalogDiscount(activeDiscounts, {
          packageId: `custom_${gb}gb_${days}d`,
          categoryId: null,
          originalPrice: baseTotalPrice,
        });
        return reply.code(200).send({
          gbAmount: gb,
          durationDays: days,
          totalPrice: discount.effectivePrice,
          originalPrice: discount.originalPrice,
          effectivePrice: discount.effectivePrice,
          activeDiscountTitle: discount.activeDiscountTitle,
          discountExpiresAt: discount.discountExpiresAt
            ? discount.discountExpiresAt.toISOString()
            : null,
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

        if (!options.purchaseCheckoutService) {
          return reply.code(500).send({ error: 'Purchase checkout service unavailable' });
        }

        const body = request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return reply
            .code(400)
            .send({ error: 'Invalid checkout request', code: 'INVALID_REQUEST' });
        }

        const kind: 'new_config' | 'renew_config' =
          body.kind === 'renew_config' ? 'renew_config' : 'new_config';

        if (
          kind === 'new_config' &&
          (await contactVerificationService.shouldRequirePhoneForPurchase(
            telegramId,
            options.translationService
          ))
        ) {
          return reply.code(403).send({
            error: 'Phone verification is required before purchasing',
            code: 'PHONE_VERIFICATION_REQUIRED',
          });
        }

        let renewConfig:
          | NonNullable<
              Awaited<ReturnType<NonNullable<typeof options.configService>['getOwnedConfigById']>>
            >
          | undefined;
        if (kind === 'renew_config') {
          const configId = typeof body.configId === 'string' ? body.configId.trim() : '';
          if (!configId || !options.configService) {
            return reply
              .code(400)
              .send({ error: 'configId is required for renewal', code: 'INVALID_REQUEST' });
          }
          const owned = await options.configService.getOwnedConfigById(telegramId, configId);
          if (!owned) {
            const anyConfig = await options.configService.getConfigById?.(configId);
            if (anyConfig) {
              return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
            }
            return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
          }
          renewConfig = owned;
        }

        const hasPackageId = typeof body.packageId === 'string' && body.packageId.trim().length > 0;
        const hasCustom =
          body.custom !== undefined && typeof body.custom === 'object' && body.custom !== null;

        if ((!hasPackageId && !hasCustom) || (hasPackageId && hasCustom)) {
          return reply
            .code(400)
            .send({ error: 'Provide either packageId or custom volume', code: 'INVALID_REQUEST' });
        }

        if (!options.pricingService) {
          return reply.code(500).send({ error: 'Pricing service unavailable' });
        }

        const resolved = resolvePurchasePackage({
          packageId: hasPackageId ? body.packageId : undefined,
          custom: hasCustom ? body.custom : undefined,
          pricingService: options.pricingService,
          translationService: options.translationService,
        });

        if (!resolved.success) {
          return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
        }

        const { pkg, target, quotedAmount: baseQuotedAmount } = resolved;

        if (
          renewConfig &&
          !hasCustom &&
          ((pkg.panelId !== undefined && pkg.panelId !== renewConfig.panelId) ||
            (pkg.serviceId !== undefined && pkg.serviceId !== renewConfig.serviceId))
        ) {
          return reply.code(400).send({
            error: 'Package does not match target service panel',
            code: 'PACKAGE_TARGET_MISMATCH',
          });
        }

        const activeDiscounts = await safeListActiveDiscounts(options.catalogDiscountService);
        const catalogDiscount = resolveBestCatalogDiscount(activeDiscounts, {
          packageId: pkg.id,
          categoryId: pkg.categoryId ?? null,
          originalPrice: baseQuotedAmount,
        });
        const afterCatalogPrice = catalogDiscount.effectivePrice;
        const checkoutPkg =
          catalogDiscount.discountAmount > 0 ? { ...pkg, price: afterCatalogPrice } : pkg;

        let appliedPromo:
          | {
              code: string;
              type: string;
              finalAmount: number;
              discountAmount: number;
              bonusGb: number;
              finalGb: number;
            }
          | undefined;
        const rawPromoCode = typeof body.promoCode === 'string' ? body.promoCode.trim() : '';
        if (rawPromoCode) {
          if (typeof options.promoService?.quoteForPurchase !== 'function') {
            return reply
              .code(503)
              .send({ error: 'Promo service unavailable', code: 'SERVICE_UNAVAILABLE' });
          }
          try {
            const quote = await options.promoService.quoteForPurchase(
              telegramId,
              rawPromoCode,
              afterCatalogPrice,
              pkg.gbAmount
            );
            appliedPromo = {
              code: quote.code,
              type: quote.type,
              finalAmount: quote.finalAmount,
              discountAmount: Math.max(0, afterCatalogPrice - quote.finalAmount),
              bonusGb: Math.max(0, quote.finalGbAmount - pkg.gbAmount),
              finalGb: quote.finalGbAmount,
            };
          } catch (err: unknown) {
            if (err instanceof PromoValidationError) {
              return reply.code(400).send({
                error: err.messageKey,
                code:
                  err.messageKey === 'promo_not_purchase_code'
                    ? 'PROMO_GIFT_CREDIT_ONLY'
                    : 'PROMO_INVALID',
                messageKey: err.messageKey,
              });
            }
            return reply.code(400).send({
              error: 'promo_redeem_failed',
              code: 'PROMO_INVALID',
              messageKey: 'promo_redeem_failed',
            });
          }
        }

        const quotedAmount = appliedPromo ? appliedPromo.finalAmount : afterCatalogPrice;

        const clientSpecifiedPrice = body.price !== undefined ? body.price : body.quotedAmount;
        if (clientSpecifiedPrice !== undefined && clientSpecifiedPrice !== quotedAmount) {
          return reply.code(400).send({
            error: 'Client price mismatch with server quote',
            code: 'PRICE_MISMATCH',
          });
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
            originalPrice: catalogDiscount.originalPrice,
            effectivePrice: catalogDiscount.effectivePrice,
            promoDiscountAmount: appliedPromo?.discountAmount ?? 0,
            bonusGb: appliedPromo?.bonusGb ?? 0,
          });
        }

        let requestedUsername: string | undefined;
        if (
          kind === 'new_config' &&
          typeof body.requestedUsername === 'string' &&
          body.requestedUsername.trim().length > 0 &&
          options.translationService &&
          customServiceNameEnabled(options.translationService)
        ) {
          const normalizedName = normalizeCustomServiceName(body.requestedUsername);
          if (!normalizedName) {
            return reply.code(400).send({
              error: 'Invalid custom service name',
              code: 'INVALID_CUSTOM_SERVICE_NAME',
            });
          }
          requestedUsername = normalizedName;
        }

        const resolvedTarget = renewConfig
          ? { panelId: renewConfig.panelId, serviceId: pkg.serviceId ?? renewConfig.serviceId }
          : target;

        const checkout = await options.purchaseCheckoutService.create({
          telegramId,
          kind,
          ...(renewConfig ? { configId: renewConfig.id } : {}),
          pkg: checkoutPkg,
          ...resolvedTarget,
          ...(appliedPromo ? { promoCode: appliedPromo.code } : {}),
          ...(requestedUsername ? { requestedUsername } : {}),
          quotedAmount,
        });

        const defaultOnHold = options.translationService
          ? onHoldDefaultEnabled(options.translationService)
          : false;
        const defaultRollover = options.translationService
          ? renewalRolloverEnabled(options.translationService)
          : true;
        const rolloverEnabled = pkg.rolloverQuota ?? defaultRollover;
        const finalGb = appliedPromo ? appliedPromo.finalGb : checkout.gbAmount;
        const rolloverPreview = renewConfig
          ? computeRolloverPreview({
              enabled: rolloverEnabled,
              addedGb: finalGb,
              addedDays: checkout.durationDays,
              dataLimitBytes: renewConfig.panelDataLimit,
              usedTrafficBytes: renewConfig.panelUsedTraffic,
              expireTimestampSec: renewConfig.panelExpire,
              status: renewConfig.panelStatus,
              onHoldExpireDurationSec: renewConfig.panelOnHoldExpireDuration ?? null,
            })
          : undefined;

        trackFunnelEvent('checkout_start');

        return reply.code(201).send({
          checkoutId: checkout.id,
          kind,
          ...(renewConfig
            ? { configId: renewConfig.id, configUsername: renewConfig.configUsername }
            : {}),
          name: checkout.packageName,
          gb: checkout.gbAmount,
          bonusGb: appliedPromo?.bonusGb ?? 0,
          finalGb,
          days: checkout.durationDays,
          price: checkout.quotedAmount,
          basePrice: checkout.amount,
          quotedAmount: checkout.quotedAmount,
          originalPrice: catalogDiscount.originalPrice,
          effectivePrice: catalogDiscount.effectivePrice,
          discountAmount: catalogDiscount.discountAmount,
          activeDiscountTitle: catalogDiscount.activeDiscountTitle,
          discountExpiresAt: catalogDiscount.discountExpiresAt
            ? catalogDiscount.discountExpiresAt.toISOString()
            : null,
          promoCode: appliedPromo?.code ?? null,
          promoType: appliedPromo?.type ?? null,
          promoDiscountAmount: appliedPromo?.discountAmount ?? 0,
          requestedUsername: requestedUsername ?? null,
          startOnFirstUse: kind === 'new_config' ? (pkg.startOnFirstUse ?? defaultOnHold) : false,
          rolloverEnabled: kind === 'renew_config' ? rolloverEnabled : false,
          ...(rolloverPreview ? { rolloverPreview } : {}),
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

        if (!options.purchaseCheckoutService) {
          return reply.code(500).send({ error: 'Purchase checkout service unavailable' });
        }

        if (
          await contactVerificationService.shouldRequirePhoneForPurchase(
            telegramId,
            options.translationService
          )
        ) {
          return reply.code(403).send({
            error: 'Phone verification is required before purchasing',
            code: 'PHONE_VERIFICATION_REQUIRED',
          });
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
          return reply.code(409).send({
            error: 'Insufficient balance',
            code: 'INSUFFICIENT_BALANCE',
            deficit: checkout.quotedAmount - availableBalance,
            availableBalance,
            price: checkout.quotedAmount,
          });
        }

        const resolvedPkg =
          typeof options.pricingService?.getPackageById === 'function'
            ? options.pricingService.getPackageById(checkout.packageId)
            : undefined;
        const isRenewal = checkout.kind === 'renew_config';

        let configName: string;
        if (isRenewal) {
          const targetConfig =
            checkout.configId && options.configService
              ? await options.configService.getOwnedConfigById(telegramId, checkout.configId)
              : undefined;
          if (!targetConfig || targetConfig.panelId !== checkout.panelId) {
            await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);
            return reply.code(403).send({ error: 'Config not owned', code: 'OWNER_MISMATCH' });
          }
          configName = targetConfig.configUsername;
        } else if (
          checkout.requestedUsername &&
          typeof options.configService?.resolveCustomConfigName === 'function'
        ) {
          configName = await options.configService.resolveCustomConfigName(
            checkout.requestedUsername,
            checkout.panelId ?? undefined
          );
        } else if (typeof options.configService?.generateConfigName === 'function') {
          configName = await options.configService.generateConfigName(
            telegramId,
            checkout.panelId ?? undefined
          );
        } else {
          configName = `u${telegramId}_${Date.now()}`;
        }

        const defaultOnHold = options.translationService
          ? onHoldDefaultEnabled(options.translationService)
          : false;

        // Execute saga
        try {
          const result = await options.walletService.executePurchaseSaga({
            telegramId,
            amount: checkout.amount,
            maxAmount: checkout.quotedAmount,
            type: isRenewal ? 'renew_config' : 'new_config',
            configUsername: configName,
            gbAmount: checkout.gbAmount,
            durationDays: checkout.durationDays,
            panelId: checkout.panelId,
            serviceId: checkout.serviceId,
            checkoutId: checkout.id,
            ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
            ...(!isRenewal && resolvedPkg?.startOnFirstUse !== undefined
              ? { startOnFirstUse: resolvedPkg.startOnFirstUse }
              : {}),
            ...(isRenewal && resolvedPkg?.rolloverQuota !== undefined
              ? { rolloverQuota: resolvedPkg.rolloverQuota }
              : {}),
          });

          await safeRecordCheckoutCompleted(options.purchaseCheckoutService, checkout.id);
          trackFunnelEvent('purchase_confirm');
          return reply.code(200).send({
            success: true,
            kind: isRenewal ? 'renew_config' : 'new_config',
            ...(checkout.configId ? { configId: checkout.configId } : {}),
            configUsername: result.configUsername,
            subUrl: result.subUrl,
            startOnFirstUse: !isRenewal && (resolvedPkg?.startOnFirstUse ?? defaultOnHold),
            availableBalanceAfter: Math.max(0, availableBalance - checkout.quotedAmount),
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
