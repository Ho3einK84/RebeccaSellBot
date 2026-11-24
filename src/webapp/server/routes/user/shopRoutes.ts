import type { FastifyInstance } from 'fastify';
import { normalizeCustomServiceName } from '../../../../domain/services/ConfigService.js';
import { PromoValidationError } from '../../../../domain/services/PromoService.js';
import {
  applyGroupDiscount,
  parseVolumePricingTiersJson,
} from '../../../../domain/services/PricingService.js';
import {
  type PurchaseCheckoutService,
  PurchaseCheckoutUnavailableError,
} from '../../../../domain/services/PurchaseCheckoutService.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
} from '../../../../domain/services/WalletService.js';
import { RebeccaOriginDownError } from '../../../../domain/services/RebeccaService.js';
import { resolvePurchasePackage } from '../../../../domain/services/PurchasePackageResolver.js';
import {
  isCustomServiceNameAllowed,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
} from '../../../../domain/services/FeatureSettings.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
} from '../../../../domain/services/CatalogDiscountService.js';
import { safeGetEffectiveUserPolicy } from '../../../../domain/services/UserGroupService.js';
import type { ContactVerificationService } from '../../../../domain/services/ContactVerificationService.js';
import { trackFunnelEvent } from '../../../../domain/services/FunnelTelemetry.js';
import {
  recordCheckoutCompleted,
  recordCheckoutFailed,
} from '../../../../telegram/checkoutLifecycle.js';
import { computeRolloverPreview } from '../../../../telegram/checkoutRenderer.js';
import { sendWebAppConfigArtifact } from '../../../../telegram/webappNotifications.js';
import {
  localizeBilingualLabel,
  localizePackageName,
  resolveUserLocale,
  type UserRateLimitConfigs,
  type UserRoutesOptions,
} from './shared.js';

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

export function registerUserShopRoutes(
  userScope: FastifyInstance,
  options: UserRoutesOptions,
  limits: UserRateLimitConfigs,
  contactVerificationService: ContactVerificationService
): void {
  // GET /api/user/packages
  userScope.get(
    '/api/user/packages',
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

      if (!options.pricingService) {
        return reply.code(200).send({ packages: [], categories: [], volumePricingTiers: [] });
      }

      const locale = await resolveUserLocale(telegramId, options);
      const defaultOnHold = options.translationService
        ? onHoldDefaultEnabled(options.translationService)
        : false;
      const defaultRollover = options.translationService
        ? renewalRolloverEnabled(options.translationService)
        : true;

      const [activeDiscounts, rawCategories, userPolicy] = await Promise.all([
        safeListActiveDiscounts(options.catalogDiscountService),
        (async () => {
          try {
            return (await options.packageCategoryService?.listCategories?.(false)) ?? [];
          } catch {
            return [];
          }
        })(),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);

      const now = new Date();
      const rawPackages = options.pricingService
        .getPackages(undefined, undefined, false)
        .filter((p) => p.enabled !== false);

      const packages = rawPackages.map((p) => {
        const priced =
          typeof options.pricingService!.resolvePackagePrice === 'function'
            ? options.pricingService!.resolvePackagePrice(p, activeDiscounts, now, userPolicy)
            : (() => {
                const groupDisc = applyGroupDiscount(p.price, userPolicy.discountPercent);
                const catDisc = userPolicy.allowCatalogDiscounts
                  ? resolveBestCatalogDiscount(
                      activeDiscounts,
                      {
                        packageId: p.id,
                        categoryId: p.categoryId ?? null,
                        originalPrice: groupDisc.finalAmount,
                      },
                      now
                    )
                  : {
                      originalPrice: groupDisc.finalAmount,
                      effectivePrice: groupDisc.finalAmount,
                      discountAmount: 0,
                      activeDiscountTitle: null,
                      discountExpiresAt: null,
                    };
                return {
                  originalPrice: p.price,
                  effectivePrice: catDisc.effectivePrice,
                  discountAmount: Math.max(0, p.price - catDisc.effectivePrice),
                  groupDiscountPercent: groupDisc.discountPercent,
                  groupDiscountAmount: groupDisc.discountAmount,
                  catalogDiscountAmount: catDisc.discountAmount,
                  activeDiscountTitle: catDisc.activeDiscountTitle,
                  discountExpiresAt: catDisc.discountExpiresAt,
                };
              })();
        return {
          id: p.id,
          name: localizePackageName(p.id, p.name, locale, options.translationService),
          gbAmount: p.gbAmount,
          durationDays: p.durationDays,
          price: priced.effectivePrice,
          originalPrice: priced.originalPrice,
          effectivePrice: priced.effectivePrice,
          discountAmount: priced.discountAmount,
          groupDiscountPercent: priced.groupDiscountPercent ?? 0,
          groupDiscountAmount: priced.groupDiscountAmount ?? 0,
          catalogDiscountAmount: priced.catalogDiscountAmount ?? 0,
          activeDiscountTitle: priced.activeDiscountTitle,
          discountExpiresAt: priced.discountExpiresAt
            ? priced.discountExpiresAt.toISOString()
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
          name: localizeBilingualLabel(cat.name, locale),
          description: cat.description ? localizeBilingualLabel(cat.description, locale) : null,
          icon: cat.icon ?? null,
          displayOrder: cat.displayOrder,
        }));

      const hasGroupCustomRate =
        userPolicy.customPricePerGb !== null || userPolicy.customPricePerDay !== null;
      const volumePricingTiers = hasGroupCustomRate
        ? []
        : (parseVolumePricingTiersJson(
            options.translationService?.getSetting('volume_pricing_tiers_json', '') ?? ''
          ) ?? []);

      return reply.code(200).send({ packages, categories, volumePricingTiers });
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
        rateLimit: limits.checkout,
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

      const userPolicy = await safeGetEffectiveUserPolicy(options.userGroupService, telegramId);
      if (!userPolicy.allowPromoCodes) {
        return reply.code(400).send({
          error: 'promo_not_allowed_for_group',
          code: 'PROMO_NOT_ALLOWED',
          messageKey: 'promo_not_allowed_for_group',
        });
      }

      const activeDiscounts = await safeListActiveDiscounts(options.catalogDiscountService);
      const resolved = resolvePurchasePackage({
        packageId: request.body?.packageId,
        custom: request.body?.custom,
        pricingService: options.pricingService,
        translationService: options.translationService,
        userPolicy,
        activeDiscounts,
      });
      if (!resolved.success) {
        return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
      }

      const prePromoPrice = resolved.quotedAmount;
      const originalPrice = resolved.originalPrice ?? prePromoPrice;

      try {
        const quote = await options.promoService.quoteForPurchase(
          telegramId,
          rawCode,
          prePromoPrice,
          resolved.pkg.gbAmount
        );
        return reply.code(200).send({
          valid: true,
          code: quote.code,
          type: quote.type,
          value: quote.value,
          originalPrice,
          effectivePrice: prePromoPrice,
          finalAmount: quote.finalAmount,
          discountAmount: Math.max(0, prePromoPrice - quote.finalAmount),
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
                : err.messageKey === 'promo_not_allowed_for_group'
                  ? 'PROMO_NOT_ALLOWED'
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
        rateLimit: limits.action10,
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

      const userPolicy = await safeGetEffectiveUserPolicy(options.userGroupService, telegramId);
      if (!userPolicy.allowPromoCodes) {
        return reply.code(400).send({
          error: 'promo_not_allowed_for_group',
          code: 'PROMO_NOT_ALLOWED',
          messageKey: 'promo_not_allowed_for_group',
        });
      }

      const res = await options.promoService.redeemCode(telegramId, rawCode);
      if (!res.success) {
        return reply.code(400).send({
          error: res.messageKey,
          code:
            res.messageKey === 'promo_not_allowed_for_group'
              ? 'PROMO_NOT_ALLOWED'
              : 'PROMO_INVALID',
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
      const availableBalance = profile ? profile.balance - profile.reservedBalance : undefined;
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
        rateLimit: limits.standard,
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

      const [activeDiscounts, userPolicy] = await Promise.all([
        safeListActiveDiscounts(options.catalogDiscountService),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);
      const now = new Date();

      if (options.pricingService) {
        try {
          if (typeof options.pricingService.resolveCustomPriceWithDiscount === 'function') {
            const priced = options.pricingService.resolveCustomPriceWithDiscount(
              gb,
              days,
              activeDiscounts,
              now,
              userPolicy
            );
            return reply.code(200).send({
              gbAmount: gb,
              durationDays: days,
              totalPrice: priced.effectivePrice,
              originalPrice: priced.originalPrice,
              effectivePrice: priced.effectivePrice,
              groupDiscountPercent: priced.groupDiscountPercent ?? 0,
              groupDiscountAmount: priced.groupDiscountAmount ?? 0,
              catalogDiscountAmount: priced.catalogDiscountAmount ?? 0,
              activeDiscountTitle: priced.activeDiscountTitle,
              discountExpiresAt: priced.discountExpiresAt
                ? priced.discountExpiresAt.toISOString()
                : null,
              pricePerGb: priced.pricePerGb,
              pricePerDay: priced.pricePerDay,
              tierId: priced.tierId ?? null,
            });
          }

          const quote = options.pricingService.getCustomPriceQuote(gb, days, userPolicy);
          const discount = userPolicy.allowCatalogDiscounts
            ? resolveBestCatalogDiscount(
                activeDiscounts,
                {
                  packageId: `custom_${gb}gb_${days}d`,
                  categoryId: null,
                  originalPrice: quote.totalPrice,
                },
                now
              )
            : {
                originalPrice: quote.totalPrice,
                effectivePrice: quote.totalPrice,
                discountAmount: 0,
                activeDiscountTitle: null,
                discountExpiresAt: null,
              };
          return reply.code(200).send({
            gbAmount: gb,
            durationDays: days,
            totalPrice: discount.effectivePrice,
            originalPrice: quote.originalPrice ?? discount.originalPrice,
            effectivePrice: discount.effectivePrice,
            groupDiscountPercent: quote.groupDiscountPercent ?? 0,
            groupDiscountAmount: quote.groupDiscountAmount ?? 0,
            catalogDiscountAmount: discount.discountAmount,
            activeDiscountTitle: discount.activeDiscountTitle,
            discountExpiresAt: discount.discountExpiresAt
              ? discount.discountExpiresAt.toISOString()
              : null,
            pricePerGb: quote.pricePerGb,
            pricePerDay: quote.pricePerDay,
            tierId: quote.tierId ?? null,
          });
        } catch (err: unknown) {
          return reply.code(400).send({
            error: err instanceof Error ? err.message : 'Invalid custom quote parameters',
            code: 'INVALID_CUSTOM_BOUNDS',
          });
        }
      }

      const basePricePerGb =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_gb', 5000)
          : 5000;
      const basePricePerDay =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_day', 0)
          : 0;
      const pricePerGb =
        userPolicy.customPricePerGb !== null ? userPolicy.customPricePerGb : basePricePerGb;
      const pricePerDay =
        userPolicy.customPricePerDay !== null ? userPolicy.customPricePerDay : basePricePerDay;
      const baseTotalPrice = gb * pricePerGb + days * pricePerDay;
      const effectiveCustomDiscPct = userPolicy.applyDiscountToCustomVolume
        ? userPolicy.discountPercent
        : 0;
      const groupDisc = applyGroupDiscount(baseTotalPrice, effectiveCustomDiscPct);
      const discount = userPolicy.allowCatalogDiscounts
        ? resolveBestCatalogDiscount(
            activeDiscounts,
            {
              packageId: `custom_${gb}gb_${days}d`,
              categoryId: null,
              originalPrice: groupDisc.finalAmount,
            },
            now
          )
        : {
            originalPrice: groupDisc.finalAmount,
            effectivePrice: groupDisc.finalAmount,
            discountAmount: 0,
            activeDiscountTitle: null,
            discountExpiresAt: null,
          };
      return reply.code(200).send({
        gbAmount: gb,
        durationDays: days,
        totalPrice: discount.effectivePrice,
        originalPrice: baseTotalPrice,
        effectivePrice: discount.effectivePrice,
        groupDiscountPercent: groupDisc.discountPercent,
        groupDiscountAmount: groupDisc.discountAmount,
        catalogDiscountAmount: discount.discountAmount,
        activeDiscountTitle: discount.activeDiscountTitle,
        discountExpiresAt: discount.discountExpiresAt
          ? discount.discountExpiresAt.toISOString()
          : null,
        pricePerGb,
        pricePerDay,
        tierId: null,
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
        rateLimit: limits.checkout,
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
        return reply.code(400).send({ error: 'Invalid checkout request', code: 'INVALID_REQUEST' });
      }

      const kind: 'new_config' | 'renew_config' =
        body.kind === 'renew_config' ? 'renew_config' : 'new_config';

      const isAdmin =
        request.userSession?.role === 'admin' ||
        Boolean(options.adminService?.isAdmin?.(telegramId)) ||
        Boolean(options.adminIds?.includes(telegramId));

      // Forced join applies to new purchases under `purchase_and_trial` (or `all`),
      // and NEVER blocks existing-service renewals (`renew_config`).
      if (kind === 'new_config' && !isAdmin && options.forcedJoinService) {
        const fjCheck = await options.forcedJoinService.checkMembership(telegramId, 'purchase');
        if (!fjCheck.allowed) {
          return reply.code(403).send({
            error: 'Channel membership required',
            code: 'CHANNEL_JOIN_REQUIRED',
            scope: fjCheck.scope,
            channels: fjCheck.missingChannels,
          });
        }
      }

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

      const [activeDiscounts, userPolicy] = await Promise.all([
        safeListActiveDiscounts(options.catalogDiscountService),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);

      const resolved = resolvePurchasePackage({
        packageId: hasPackageId ? body.packageId : undefined,
        custom: hasCustom ? body.custom : undefined,
        pricingService: options.pricingService,
        translationService: options.translationService,
        userPolicy,
        activeDiscounts,
      });

      if (!resolved.success) {
        return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
      }

      const { pkg, target, quotedAmount: afterCatalogPrice } = resolved;
      const originalPrice = resolved.originalPrice ?? afterCatalogPrice;
      const totalPrePromoDiscount =
        resolved.discountAmount ?? Math.max(0, originalPrice - afterCatalogPrice);
      const groupDiscountPercent = resolved.groupDiscountPercent ?? 0;
      const groupDiscountAmount = resolved.groupDiscountAmount ?? 0;
      const catalogDiscountAmount = resolved.catalogDiscountAmount ?? 0;
      const activeDiscountTitle = resolved.activeDiscountTitle ?? null;
      const discountExpiresAt = resolved.discountExpiresAt ?? null;

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

      const checkoutPkg =
        pkg.price !== afterCatalogPrice ? { ...pkg, price: afterCatalogPrice } : pkg;

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
        if (!userPolicy.allowPromoCodes) {
          return reply.code(400).send({
            error: 'promo_not_allowed_for_group',
            code: 'PROMO_NOT_ALLOWED',
            messageKey: 'promo_not_allowed_for_group',
          });
        }
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
                  : err.messageKey === 'promo_not_allowed_for_group'
                    ? 'PROMO_NOT_ALLOWED'
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

      const availableBalance = profile.balance - profile.reservedBalance;
      const creditLimit = userPolicy.creditLimit;
      const purchasingPower = Math.max(0, availableBalance + creditLimit);
      if (purchasingPower < quotedAmount) {
        return reply.code(409).send({
          error: 'Insufficient balance',
          code: 'INSUFFICIENT_BALANCE',
          deficit: quotedAmount - purchasingPower,
          availableBalance,
          creditLimit,
          purchasingPower,
          price: quotedAmount,
          originalPrice,
          effectivePrice: afterCatalogPrice,
          groupDiscountPercent,
          groupDiscountAmount,
          catalogDiscountAmount,
          promoDiscountAmount: appliedPromo?.discountAmount ?? 0,
          bonusGb: appliedPromo?.bonusGb ?? 0,
        });
      }

      let requestedUsername: string | undefined;
      const customNameAllowed = options.translationService
        ? isCustomServiceNameAllowed(options.translationService, userPolicy)
        : userPolicy.allowCustomServiceName;
      if (
        kind === 'new_config' &&
        typeof body.requestedUsername === 'string' &&
        body.requestedUsername.trim().length > 0 &&
        customNameAllowed
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

      const locale = await resolveUserLocale(telegramId, options);
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
        name: localizePackageName(
          checkout.packageId,
          checkout.packageName,
          locale,
          options.translationService
        ),
        gb: checkout.gbAmount,
        bonusGb: appliedPromo?.bonusGb ?? 0,
        finalGb,
        days: checkout.durationDays,
        price: checkout.quotedAmount,
        basePrice: checkout.amount,
        quotedAmount: checkout.quotedAmount,
        originalPrice,
        effectivePrice: afterCatalogPrice,
        discountAmount: totalPrePromoDiscount,
        groupDiscountPercent,
        groupDiscountAmount,
        catalogDiscountAmount,
        activeDiscountTitle,
        discountExpiresAt: discountExpiresAt ? discountExpiresAt.toISOString() : null,
        promoCode: appliedPromo?.code ?? null,
        promoType: appliedPromo?.type ?? null,
        promoDiscountAmount: appliedPromo?.discountAmount ?? 0,
        requestedUsername: requestedUsername ?? null,
        startOnFirstUse: kind === 'new_config' ? (pkg.startOnFirstUse ?? defaultOnHold) : false,
        rolloverEnabled: kind === 'renew_config' ? rolloverEnabled : false,
        ...(rolloverPreview ? { rolloverPreview } : {}),
        availableBalance,
        creditLimit,
        purchasingPower,
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
        rateLimit: limits.confirm,
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
              return reply.code(410).send({ error: 'Checkout expired', code: 'CHECKOUT_EXPIRED' });
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

      // Forced join applies ONLY to `new_config` purchases (never renewals).
      const isAdminAtConfirm =
        request.userSession?.role === 'admin' ||
        Boolean(options.adminService?.isAdmin?.(telegramId)) ||
        Boolean(options.adminIds?.includes(telegramId));
      if (checkout.kind === 'new_config' && !isAdminAtConfirm && options.forcedJoinService) {
        const fjCheck = await options.forcedJoinService.checkMembership(telegramId, 'purchase');
        if (!fjCheck.allowed) {
          await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);
          return reply.code(403).send({
            error: 'Channel membership required',
            code: 'CHANNEL_JOIN_REQUIRED',
            scope: fjCheck.scope,
            channels: fjCheck.missingChannels,
          });
        }
      }

      // P0-3 fix: Phone verification gate applies ONLY to `new_config` purchases (matches Telegram bot).
      // Existing subscribers renewing a config are never blocked at confirm time.
      if (
        checkout.kind === 'new_config' &&
        (await contactVerificationService.shouldRequirePhoneForPurchase(
          telegramId,
          options.translationService
        ))
      ) {
        await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);
        return reply.code(403).send({
          error: 'Phone verification is required before purchasing',
          code: 'PHONE_VERIFICATION_REQUIRED',
        });
      }

      // Re-check purchasing power (signed available balance + credit limit) >= checkout.quotedAmount
      const [profile, confirmPolicy] = await Promise.all([
        options.userService.findProfile(String(telegramId)),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);
      const availableBalance = profile ? profile.balance - profile.reservedBalance : 0;
      const creditLimit = confirmPolicy.creditLimit;
      const purchasingPower = Math.max(0, availableBalance + creditLimit);
      if (purchasingPower < checkout.quotedAmount) {
        await safeRecordCheckoutFailed(options.purchaseCheckoutService, checkout.id);
        return reply.code(409).send({
          error: 'Insufficient balance',
          code: 'INSUFFICIENT_BALANCE',
          deficit: checkout.quotedAmount - purchasingPower,
          availableBalance,
          creditLimit,
          purchasingPower,
          price: checkout.quotedAmount,
        });
      }

      const resolvedPkg =
        typeof options.pricingService?.getPackageById === 'function'
          ? options.pricingService.getPackageById(checkout.packageId)
          : undefined;
      const isRenewal = checkout.kind === 'renew_config';

      let configName: string;
      let configUserLabel: string | null = null;
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
        configUserLabel = targetConfig.userLabel ?? null;
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
      const startOnFirstUse = !isRenewal && (resolvedPkg?.startOnFirstUse ?? defaultOnHold);

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

        // Mirror permanent subscription artifact to user's Telegram chat (non-blocking)
        if (options.botApi && options.translationService) {
          void sendWebAppConfigArtifact(
            options.botApi,
            {
              userService: options.userService,
              translationService: options.translationService,
            },
            {
              telegramId,
              kind: isRenewal ? 'renew_config' : 'new_config',
              configUsername: result.configUsername,
              userLabel: configUserLabel,
              configId: checkout.configId ?? undefined,
              subUrl: result.subUrl,
              gbAmount: checkout.gbAmount,
              durationDays: checkout.durationDays,
              startOnFirstUse,
              webAppUrl: options.webAppUrl,
            }
          );
        }

        return reply.code(200).send({
          success: true,
          kind: isRenewal ? 'renew_config' : 'new_config',
          ...(checkout.configId ? { configId: checkout.configId } : {}),
          configUsername: result.configUsername,
          subUrl: result.subUrl,
          startOnFirstUse,
          availableBalanceAfter: availableBalance - checkout.quotedAmount,
          creditLimit,
          purchasingPowerAfter: Math.max(0, availableBalance + creditLimit - checkout.quotedAmount),
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
}
