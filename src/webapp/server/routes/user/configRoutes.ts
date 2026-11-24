import type { FastifyInstance } from 'fastify';
import {
  MAX_CONFIG_USER_LABEL_LENGTH,
  sanitizeConfigUserLabel,
} from '../../../../domain/services/ConfigService.js';
import { RebeccaOriginDownError } from '../../../../domain/services/RebeccaService.js';
import { normalizeDataLimit } from '../../../../domain/services/TrafficLimit.js';
import {
  customVolumeEnabled,
  renewalRolloverEnabled,
} from '../../../../domain/services/FeatureSettings.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
} from '../../../../domain/services/CatalogDiscountService.js';
import { applyGroupDiscount } from '../../../../domain/services/PricingService.js';
import { safeGetEffectiveUserPolicy } from '../../../../domain/services/UserGroupService.js';
import { RefundOutcomePendingError } from '../../../../domain/services/RefundService.js';
import { computeRolloverPreview } from '../../../../telegram/checkoutRenderer.js';
import {
  sendWebAppConfigArtifact,
  sendWebAppConfigTransferNotification,
} from '../../../../telegram/webappNotifications.js';
import {
  buildMaskedRecipientPreview,
  localizePackageName,
  resolveUserLocale,
  type UserRateLimitConfigs,
  type UserRoutesOptions,
} from './shared.js';

export function registerUserConfigRoutes(
  userScope: FastifyInstance,
  options: UserRoutesOptions,
  limits: UserRateLimitConfigs
): void {
  const resolveAutoRenewPackageName = (
    packageId: string | null | undefined,
    locale: 'fa' | 'en'
  ): string | null => {
    if (!packageId) return null;
    const pkg =
      typeof options.pricingService?.getPackageById === 'function'
        ? options.pricingService.getPackageById(packageId)
        : undefined;
    return localizePackageName(
      packageId,
      pkg?.name ?? packageId,
      locale,
      options.translationService
    );
  };

  // GET /api/user/configs
  userScope.get(
    '/api/user/configs',
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

      if (!options.configService) {
        return reply.code(200).send({ configs: [] });
      }

      const [rows, locale] = await Promise.all([
        options.configService.listConfigsForOwner(telegramId),
        resolveUserLocale(telegramId, options),
      ]);

      const panelNames = new Map<string, string>();
      if (typeof options.panelRegistry?.listPanels === 'function') {
        try {
          for (const panel of options.panelRegistry.listPanels()) {
            panelNames.set(panel.id, panel.name);
          }
        } catch {
          // Optional metadata
        }
      }

      const configs = rows.map((c) => ({
        id: c.id,
        configUsername: c.configUsername,
        userLabel: c.userLabel ?? null,
        panelId: c.panelId ?? null,
        panelName: c.panelId ? (panelNames.get(c.panelId) ?? null) : null,
        serviceId: c.serviceId ?? null,
        subUrl: c.subUrl,
        panelStatus: c.panelStatus,
        panelDataLimit: normalizeDataLimit(c.panelDataLimit) ?? null,
        panelUsedTraffic: c.panelUsedTraffic,
        panelExpire: c.panelExpire,
        panelOnHoldExpireDuration: c.panelOnHoldExpireDuration ?? null,
        autoRenewEnabled: c.autoRenewEnabled,
        autoRenewPackageId: c.autoRenewPackageId ?? null,
        autoRenewPackageName: resolveAutoRenewPackageName(c.autoRenewPackageId, locale),
        autoRenewPrice: c.autoRenewPrice ?? null,
        lastSyncedAt: c.lastSyncedAt,
        createdAt: c.createdAt,
      }));

      return reply.code(200).send({ configs });
    }
  );

  // POST /api/user/configs/sync-all
  userScope.post(
    '/api/user/configs/sync-all',
    {
      config: {
        rateLimit: limits.action6,
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

      const rows = await options.configService.listConfigsForOwner(telegramId);
      const targets = rows.slice(0, 15);
      let synced = 0;
      let failed = 0;

      for (const cfg of targets) {
        try {
          if (typeof options.configService.refreshConfig === 'function') {
            await options.configService.refreshConfig(telegramId, cfg.id);
          } else {
            await options.configService.getRemoteConfigDetail(cfg);
          }
          synced += 1;
        } catch {
          failed += 1;
        }
      }

      return reply.code(200).send({
        success: true,
        total: targets.length,
        synced,
        failed,
      });
    }
  );

  // POST /api/user/configs/claim — bind an existing Rebecca subscription URL
  userScope.post<{
    Body?: { subUrl?: string };
  }>(
    '/api/user/configs/claim',
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
      if (typeof options.configService?.claimSubLink !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Config claim unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const rawInput = typeof request.body?.subUrl === 'string' ? request.body.subUrl.trim() : '';
      const extracted =
        typeof options.configService.extractSubUrl === 'function'
          ? (options.configService.extractSubUrl(rawInput) ?? rawInput)
          : rawInput;

      if (!extracted) {
        return reply.code(400).send({
          error: 'Valid subscription URL is required',
          code: 'INVALID_SUB_URL',
          messageKey: 'claim_failed',
        });
      }

      try {
        const result = await options.configService.claimSubLink(telegramId, extracted);
        if (!result.success) {
          const status =
            result.messageKey === 'claim_rate_limited'
              ? 429
              : result.messageKey === 'claim_already_claimed'
                ? 409
                : 404;
          const code =
            result.messageKey === 'claim_rate_limited'
              ? 'CLAIM_RATE_LIMITED'
              : result.messageKey === 'claim_already_claimed'
                ? 'CLAIM_ALREADY_CLAIMED'
                : 'CLAIM_NOT_FOUND';
          return reply.code(status).send({
            error: result.messageKey,
            code,
            messageKey: result.messageKey,
          });
        }

        return reply.code(200).send({
          success: true,
          username: result.username ?? '',
          panelId: result.panelId ?? null,
          messageKey: result.messageKey,
        });
      } catch (err) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        throw err;
      }
    }
  );

  // POST /api/user/configs/:id/auto-renew
  userScope.post<{
    Params: { id: string };
    Body?: {
      enabled?: boolean;
      packageId?: string;
      custom?: { gb?: number; days?: number };
      price?: number;
    };
  }>(
    '/api/user/configs/:id/auto-renew',
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

      if (!options.configService) {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
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

      const [locale, userPolicy] = await Promise.all([
        resolveUserLocale(telegramId, options),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);
      const availablePackages = options.pricingService.getPackages(
        config.panelId,
        config.serviceId,
        false
      );

      let selectedPackage: { id: string; name: string; price: number } | undefined;
      const requestedPackageId =
        typeof request.body?.packageId === 'string' && request.body.packageId.trim().length > 0
          ? request.body.packageId.trim()
          : undefined;
      const customReq = request.body?.custom;

      if (customReq && typeof customReq === 'object') {
        const cvEnabled = options.translationService
          ? customVolumeEnabled(options.translationService)
          : true;
        if (!cvEnabled) {
          return reply.code(400).send({
            error: 'Custom volume is disabled',
            code: 'CUSTOM_VOLUME_DISABLED',
          });
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
        const gb = Number(customReq.gb);
        const days = customReq.days !== undefined ? Number(customReq.days) : defaultDays;
        if (
          !Number.isSafeInteger(gb) ||
          gb < minGb ||
          gb > maxGb ||
          !Number.isSafeInteger(days) ||
          days < 1 ||
          days > 365
        ) {
          return reply.code(400).send({
            error: `GB must be between ${minGb} and ${maxGb}`,
            code: 'INVALID_CUSTOM_BOUNDS',
          });
        }
        const quote = options.pricingService.getCustomPriceQuote(gb, days, userPolicy);
        const customId = `custom_${gb}gb_${days}d`;
        selectedPackage = {
          id: customId,
          name: localizePackageName(customId, `${gb} GB`, locale, options.translationService),
          price: quote.totalPrice,
        };
      } else if (requestedPackageId) {
        const match = availablePackages.find((pkg) => pkg.id === requestedPackageId);
        if (!match) {
          return reply.code(404).send({
            error: 'Package not found, disabled, or does not match config panel/service',
            code: 'PACKAGE_NOT_FOUND',
          });
        }
        const effectivePrice = applyGroupDiscount(
          match.price,
          userPolicy.discountPercent
        ).finalAmount;
        selectedPackage = {
          id: match.id,
          name: localizePackageName(match.id, match.name, locale, options.translationService),
          price: effectivePrice,
        };
      } else if (config.autoRenewPackageId) {
        const match = availablePackages.find((pkg) => pkg.id === config.autoRenewPackageId);
        if (match) {
          selectedPackage = {
            id: match.id,
            name: localizePackageName(match.id, match.name, locale, options.translationService),
            price: applyGroupDiscount(match.price, userPolicy.discountPercent).finalAmount,
          };
        } else if (/^custom_(\d+)gb_(\d+)d$/i.test(config.autoRenewPackageId)) {
          const customMatch = /^custom_(\d+)gb_(\d+)d$/i.exec(config.autoRenewPackageId);
          if (customMatch) {
            const gb = Number(customMatch[1]);
            const days = Number(customMatch[2]);
            const quote = options.pricingService.getCustomPriceQuote(gb, days, userPolicy);
            selectedPackage = {
              id: config.autoRenewPackageId,
              name: localizePackageName(
                config.autoRenewPackageId,
                `${gb} GB`,
                locale,
                options.translationService
              ),
              price: quote.totalPrice,
            };
          }
        }
        if (!selectedPackage) {
          return reply.code(404).send({
            error: 'Configured auto-renew package is no longer available',
            code: 'PACKAGE_NOT_FOUND',
          });
        }
      } else if (availablePackages.length > 0) {
        const first = availablePackages[0]!;
        selectedPackage = {
          id: first.id,
          name: localizePackageName(first.id, first.name, locale, options.translationService),
          price: applyGroupDiscount(first.price, userPolicy.discountPercent).finalAmount,
        };
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
        rateLimit: limits.action30,
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

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
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
        rateLimit: limits.action10,
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

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
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

        if (options.botApi && options.translationService && subUrl) {
          void sendWebAppConfigArtifact(
            options.botApi,
            {
              userService: options.userService,
              translationService: options.translationService,
            },
            {
              telegramId,
              kind: 'revoke',
              configUsername: config.configUsername,
              userLabel: config.userLabel ?? null,
              configId: config.id,
              subUrl,
              webAppUrl: options.webAppUrl,
            }
          );
        }

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
        rateLimit: limits.action30,
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

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
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

  // GET /api/user/configs/:id/usage — per-node traffic usage & live online_at
  userScope.get<{
    Params: { id: string };
  }>(
    '/api/user/configs/:id/usage',
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
      if (!options.configService) {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      try {
        const [usageRes, detailRes] = await Promise.all([
          typeof options.configService.getRemoteConfigUsage === 'function'
            ? options.configService.getRemoteConfigUsage(config).catch(() => null)
            : Promise.resolve(null),
          typeof options.configService.getRemoteConfigDetail === 'function'
            ? options.configService.getRemoteConfigDetail(config).catch(() => null)
            : Promise.resolve(null),
        ]);

        const rawUsages = usageRes?.usages ?? [];
        const nodes = rawUsages.map((u) => ({
          nodeId: u.node_id ?? null,
          nodeName: u.node_name || 'Master',
          usedTraffic: Number(u.used_traffic ?? 0),
        }));

        return reply.code(200).send({
          onlineAt: detailRes?.online_at ?? null,
          subUpdatedAt: detailRes?.sub_updated_at ?? null,
          lifetimeUsedTraffic: detailRes?.lifetime_used_traffic ?? null,
          nodes,
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
        rateLimit: limits.standard,
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

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      const locale = await resolveUserLocale(telegramId, options);
      const defaultRollover = options.translationService
        ? renewalRolloverEnabled(options.translationService)
        : true;
      const cvEnabled = options.translationService
        ? customVolumeEnabled(options.translationService)
        : true;

      const [activeDiscounts, userPolicy] = await Promise.all([
        safeListActiveDiscounts(options.catalogDiscountService),
        safeGetEffectiveUserPolicy(options.userGroupService, telegramId),
      ]);
      const now = new Date();
      const compatiblePackages = (
        options.pricingService?.getPackages(config.panelId, config.serviceId, false) ?? []
      )
        .filter((p) => p.enabled !== false)
        .map((p) => {
          const priced =
            typeof options.pricingService?.resolvePackagePrice === 'function'
              ? options.pricingService.resolvePackagePrice(p, activeDiscounts, now, userPolicy)
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
          userLabel: config.userLabel ?? null,
          panelStatus: config.panelStatus,
          currentRemainingGb: basePreview.currentRemainingGb ?? null,
          currentRemainingDays: basePreview.currentRemainingDays ?? null,
          autoRenewEnabled: config.autoRenewEnabled,
          autoRenewPackageId: config.autoRenewPackageId ?? null,
          autoRenewPackageName: resolveAutoRenewPackageName(config.autoRenewPackageId, locale),
          autoRenewPrice: config.autoRenewPrice ?? null,
        },
        packages: compatiblePackages,
        defaultRolloverEnabled: defaultRollover,
        customVolumeEnabled: cvEnabled,
      });
    }
  );

  // GET /api/user/configs/:id/refund-quote — preview refund eligibility before deletion
  userScope.get<{
    Params: { id: string };
  }>(
    '/api/user/configs/:id/refund-quote',
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
      if (!options.configService) {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      if (typeof options.refundService?.quote !== 'function') {
        return reply.code(200).send({
          eligible: false,
          reason: 'remote_unavailable',
        });
      }

      const quote = await options.refundService.quote(telegramId, config.id);
      if (!quote.eligible) {
        return reply.code(200).send({
          eligible: false,
          reason: quote.reason,
        });
      }

      return reply.code(200).send({
        eligible: true,
        configId: quote.configId,
        configUsername: quote.configUsername,
        grossAmount: quote.grossAmount,
        cashbackWithheld: quote.cashbackWithheld,
        refundAmount: quote.refundAmount,
        purchasedAt:
          quote.purchasedAt instanceof Date
            ? quote.purchasedAt.toISOString()
            : String(quote.purchasedAt),
      });
    }
  );

  // POST /api/user/configs/:id/delete — native delete with optional automatic refund
  userScope.post<{
    Params: { id: string };
    Body?: { withRefund?: boolean };
  }>(
    '/api/user/configs/:id/delete',
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
      if (!options.configService) {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      const withRefund = Boolean(request.body?.withRefund);

      if (withRefund) {
        if (typeof options.refundService?.executeDeleteWithRefund !== 'function') {
          return reply
            .code(503)
            .send({ error: 'Refund service unavailable', code: 'SERVICE_UNAVAILABLE' });
        }
        try {
          const outcome = await options.refundService.executeDeleteWithRefund(
            telegramId,
            config.id
          );
          if (!outcome.eligible) {
            return reply.code(409).send({
              error: 'Service is not eligible for refund',
              code: 'REFUND_INELIGIBLE',
              reason: outcome.reason,
            });
          }
          return reply.code(200).send({
            success: true,
            refunded: true,
            refundAmount: outcome.refundAmount,
            configUsername: outcome.configUsername,
          });
        } catch (err: unknown) {
          if (err instanceof RefundOutcomePendingError) {
            return reply.code(202).send({
              error: 'Refund is being reconciled',
              code: 'REFUND_OUTCOME_PENDING',
              refundIntentId: err.refundIntentId,
            });
          }
          if (err instanceof RebeccaOriginDownError) {
            return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
          }
          throw err;
        }
      }

      // Simple delete without refund
      if (typeof options.configService.deleteConfigCompletely !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Delete service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      try {
        await options.configService.deleteConfigCompletely(config.configUsername, config.panelId);
        return reply.code(200).send({
          success: true,
          refunded: false,
          refundAmount: 0,
          configUsername: config.configUsername,
        });
      } catch (err) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        throw err;
      }
    }
  );

  // POST /api/user/configs/:id/transfer/preview — verify recipient before transferring service
  userScope.post<{
    Params: { id: string };
    Body?: { recipient?: string };
  }>(
    '/api/user/configs/:id/transfer/preview',
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
      if (!options.configService) {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
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
        autoRenewWillReset: Boolean(config.autoRenewEnabled),
      });
    }
  );

  // POST /api/user/configs/:id/transfer — native service ownership transfer
  userScope.post<{
    Params: { id: string };
    Body?: { recipient?: string; toTelegramId?: number };
  }>(
    '/api/user/configs/:id/transfer',
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
      if (typeof options.configTransferService?.transfer !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Transfer service unavailable', code: 'SERVICE_UNAVAILABLE' });
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

      try {
        const moved = await options.configTransferService.transfer({
          configId: request.params.id,
          fromTelegramId: telegramId,
          toTelegramId,
          actorTelegramId: telegramId,
        });

        if (options.botApi && options.translationService) {
          void sendWebAppConfigTransferNotification(
            options.botApi,
            {
              userService: options.userService,
              translationService: options.translationService,
            },
            {
              fromTelegramId: telegramId,
              toTelegramId: moved.toTelegramId,
              configUsername: moved.configUsername,
              configId: request.params.id,
              webAppUrl: options.webAppUrl,
            }
          );
        }

        return reply.code(200).send({
          success: true,
          configUsername: moved.configUsername,
          toTelegramId: moved.toTelegramId,
        });
      } catch (err: unknown) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
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
        if (msg === 'CONFIG_NOT_FOUND') {
          return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
        }
        if (msg === 'CONFIG_NOT_OWNED') {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        if (msg === 'CONFIG_REMOTE_DELETED') {
          return reply
            .code(410)
            .send({ error: 'Service no longer exists on panel', code: 'CONFIG_REMOTE_DELETED' });
        }
        if (msg === 'TRANSFER_CONFLICT') {
          return reply.code(409).send({ error: 'Transfer conflict', code: 'TRANSFER_CONFLICT' });
        }
        throw err;
      }
    }
  );

  // PATCH /api/user/configs/:id/label — set or clear local personal label (`user_label`)
  userScope.patch<{
    Params: { id: string };
    Body?: { label?: string | null };
  }>(
    '/api/user/configs/:id/label',
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
      if (!options.configService || typeof options.configService.setUserLabel !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Config service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const config = await options.configService.getOwnedConfigById(telegramId, request.params.id);
      if (!config) {
        const anyConfig = await options.configService.getConfigById?.(request.params.id);
        if (anyConfig) {
          return reply.code(403).send({ error: 'Forbidden', code: 'OWNER_MISMATCH' });
        }
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      const rawLabel = request.body?.label;
      if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
        return reply.code(400).send({
          error: 'Invalid user label',
          code: 'INVALID_USER_LABEL',
          maxLength: MAX_CONFIG_USER_LABEL_LENGTH,
        });
      }

      const sanitized = sanitizeConfigUserLabel(rawLabel ?? null);
      if (!sanitized.valid) {
        return reply.code(400).send({
          error:
            sanitized.reason === 'too_long'
              ? `Label exceeds maximum length of ${MAX_CONFIG_USER_LABEL_LENGTH} characters`
              : 'Invalid user label',
          code: sanitized.reason === 'too_long' ? 'USER_LABEL_TOO_LONG' : 'INVALID_USER_LABEL',
          maxLength: MAX_CONFIG_USER_LABEL_LENGTH,
        });
      }

      const updated = await options.configService.setUserLabel(
        telegramId,
        config.id,
        sanitized.value
      );
      if (!updated) {
        return reply.code(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
      }

      return reply.code(200).send({
        success: true,
        id: updated.id,
        configUsername: updated.configUsername,
        userLabel: updated.userLabel ?? null,
      });
    }
  );
}
