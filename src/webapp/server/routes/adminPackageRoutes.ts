import type { FastifyInstance, FastifyReply } from 'fastify';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import { customVolumeEnabled } from '../../../domain/services/FeatureSettings.js';
import type {
  PackageCategory,
  PackageCategoryService,
} from '../../../domain/services/PackageCategoryService.js';
import {
  FALLBACK_PACKAGES,
  generatePackageId,
  hasDuplicatePackageName,
  MAX_CATEGORY_ID_LENGTH,
  MAX_DURATION_DAYS,
  MAX_GB_AMOUNT,
  MAX_PACKAGE_COUNT,
  MAX_PACKAGE_NAME_LENGTH,
  MAX_PRICE,
  MAX_PRICE_RULES,
  MAX_SERVICE_ID,
  MAX_WEB_CUSTOM_DAYS,
  PACKAGE_ID_PATTERN,
  PANEL_ID_PATTERN,
  parseCustomPriceOverridesJson,
  parsePackageOptionsJson,
  parseVolumePricingTiersJson,
  type CustomPriceOverride,
  type CustomPriceQuote,
  type PackageOption,
  type PricingService,
  type VolumePricingTier,
} from '../../../domain/services/PricingService.js';
import type {
  RebeccaPanelRegistry,
  RebeccaPanelSummary,
} from '../../../domain/services/RebeccaPanelRegistry.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import type { UserService } from '../../../domain/services/UserService.js';

export interface AdminPackageRoutesDeps {
  pricingService?: PricingService;
  packageCategoryService?: PackageCategoryService;
  translationService?: TranslationService;
  panelRegistry?: RebeccaPanelRegistry;
  userService?: Pick<UserService, 'recordAdminAction'>;
  adminService?: Pick<AdminService, 'isAdmin'>;
}

export interface AdminPackageDto extends PackageOption {
  enabled: boolean;
}

export interface AdminCategoryDto {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  enabled: boolean;
  linkedPackagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTargetPanelDto {
  panelId: string;
  panelName: string;
  enabled: boolean;
  isDefault: boolean;
  defaultServiceId: number | null;
  services: Array<{
    serviceId: number;
    name: string;
    isDefault: boolean;
  }>;
}

export interface PackagePoliciesDto {
  packageDisplayMode: 'specs' | 'name';
  lowTrafficThresholdGb: number;
  expiryWarningDays: number;
  refundWindowHours: number;
}

export interface CustomPricingSettingsDto {
  enabled: boolean;
  pricePerGb: number;
  pricePerDay: number;
  minGb: number;
  maxGb: number;
  defaultDays: number;
  target: { panelId: string; serviceId: number } | null;
  warnings: string[];
}

const MAX_LOW_TRAFFIC_THRESHOLD_GB = 100_000;
const MAX_EXPIRY_WARNING_DAYS = 3_650;
const MAX_REFUND_WINDOW_HOURS = 8_760;
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_CATEGORY_DESCRIPTION_LENGTH = 240;
const MAX_CATEGORY_ICON_LENGTH = 32;
const MAX_DISPLAY_ORDER = 1_000_000;

class RouteValidationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RouteValidationError';
  }
}

export function registerAdminPackageRoutes(
  app: FastifyInstance,
  deps: AdminPackageRoutesDeps
): void {
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', async (request, reply) => {
      await adminGuardWithCheck(
        request,
        reply,
        deps.adminService ? (id) => deps.adminService!.isAdmin(id) : undefined
      );
    });

    // =========================================================================
    // Packages & Policies
    // =========================================================================

    adminScope.get<{
      Querystring: { includeDisabled?: string; categoryId?: string; panelId?: string };
    }>('/api/admin/packages', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const categoryService = requireCategoryService(deps);
        const snapshot = loadPackagesSnapshot(ts);
        const rawCategories = await categoryService.listCategories(true);
        const categories = buildCategoryDtos(rawCategories, snapshot.packages);

        const includeDisabled = request.query.includeDisabled !== 'false';
        const filterCategoryId = request.query.categoryId?.trim();
        const filterPanelId = request.query.panelId?.trim();

        const filteredPackages = snapshot.packages
          .filter((pkg) => includeDisabled || pkg.enabled)
          .filter((pkg) => {
            if (!filterCategoryId) return true;
            return filterCategoryId === 'uncategorized'
              ? !pkg.categoryId
              : pkg.categoryId === filterCategoryId;
          })
          .filter((pkg) => (!filterPanelId ? true : pkg.panelId === filterPanelId));

        return reply.code(200).send({
          packages: filteredPackages,
          totalPackages: snapshot.packages.length,
          isFallbackActive: snapshot.isFallbackActive,
          categories,
          policies: loadPackagePolicies(ts),
          targets: buildTargetSummaries(deps.panelRegistry),
          bounds: {
            maxPackages: MAX_PACKAGE_COUNT,
            maxNameLength: MAX_PACKAGE_NAME_LENGTH,
            maxGbAmount: MAX_GB_AMOUNT,
            maxDurationDays: MAX_DURATION_DAYS,
            maxPrice: MAX_PRICE,
            maxLowTrafficThresholdGb: MAX_LOW_TRAFFIC_THRESHOLD_GB,
            maxExpiryWarningDays: MAX_EXPIRY_WARNING_DAYS,
            maxRefundWindowHours: MAX_REFUND_WINDOW_HOURS,
          },
        });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.post('/api/admin/packages', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const snapshot = loadPackagesSnapshot(ts);
        if (snapshot.packages.length >= MAX_PACKAGE_COUNT) {
          throw new RouteValidationError(
            400,
            'PACKAGE_LIMIT_REACHED',
            `Cannot exceed ${MAX_PACKAGE_COUNT} packages`
          );
        }

        const name = parseTrimmedString(
          body.name,
          MAX_PACKAGE_NAME_LENGTH,
          'INVALID_PACKAGE_NAME',
          'Package name must be a non-empty string up to 120 characters'
        );
        if (hasDuplicatePackageName(snapshot.packages, name)) {
          throw new RouteValidationError(
            409,
            'DUPLICATE_PACKAGE_NAME',
            'A package with this name already exists'
          );
        }

        const explicitId =
          body.id !== undefined
            ? parseStrictIdentifier(body.id, 'INVALID_PACKAGE_ID', 'Package ID')
            : undefined;
        const id = explicitId ?? generatePackageId(name, snapshot.packages);
        if (snapshot.packages.some((pkg) => pkg.id === id)) {
          throw new RouteValidationError(
            409,
            'DUPLICATE_PACKAGE_ID',
            `Package ID "${id}" already exists`
          );
        }

        const gbAmount = parseSafeInt(
          body.gbAmount,
          1,
          MAX_GB_AMOUNT,
          'INVALID_PACKAGE_GB',
          `gbAmount must be an integer between 1 and ${MAX_GB_AMOUNT}`
        );
        const durationDays = parseSafeInt(
          body.durationDays,
          1,
          MAX_DURATION_DAYS,
          'INVALID_PACKAGE_DAYS',
          `durationDays must be an integer between 1 and ${MAX_DURATION_DAYS}`
        );
        const price = parseSafeInt(
          body.price,
          1,
          MAX_PRICE,
          'INVALID_PACKAGE_PRICE',
          'price must be a positive safe integer'
        );
        const enabled =
          body.enabled !== undefined
            ? parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled')
            : true;
        const startOnFirstUse =
          body.startOnFirstUse !== undefined
            ? parseBooleanField(
                body.startOnFirstUse,
                'INVALID_START_ON_FIRST_USE_FLAG',
                'startOnFirstUse'
              )
            : undefined;
        const rolloverQuota =
          body.rolloverQuota !== undefined
            ? parseBooleanField(body.rolloverQuota, 'INVALID_ROLLOVER_QUOTA_FLAG', 'rolloverQuota')
            : undefined;

        const target = resolveCreatePackageTarget(deps.panelRegistry, body.panelId, body.serviceId);
        const categoryId = await resolveCategoryIdInput(
          deps.packageCategoryService,
          body.categoryId
        );

        const createdPkg: AdminPackageDto = {
          id,
          name,
          gbAmount,
          durationDays,
          price,
          enabled,
          ...(target ? { panelId: target.panelId, serviceId: target.serviceId } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(startOnFirstUse !== undefined ? { startOnFirstUse } : {}),
          ...(rolloverQuota !== undefined ? { rolloverQuota } : {}),
        };

        const nextPackages = [...snapshot.packages, createdPkg];
        await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_create_package',
          'package',
          id,
          {
            name,
            gbAmount,
            durationDays,
            price,
            ...(target ?? {}),
            ...(categoryId ? { categoryId } : {}),
          }
        );

        return reply.code(201).send({ package: createdPkg, packages: nextPackages });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.put('/api/admin/packages/policies', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const updates: Record<string, string> = {};

        if ('packageDisplayMode' in body && body.packageDisplayMode !== undefined) {
          if (body.packageDisplayMode !== 'specs' && body.packageDisplayMode !== 'name') {
            throw new RouteValidationError(
              400,
              'INVALID_DISPLAY_MODE',
              'packageDisplayMode must be "specs" or "name"'
            );
          }
          updates.package_display_mode = body.packageDisplayMode;
        }

        if ('lowTrafficThresholdGb' in body && body.lowTrafficThresholdGb !== undefined) {
          const threshold = parseFiniteNumber(
            body.lowTrafficThresholdGb,
            0,
            MAX_LOW_TRAFFIC_THRESHOLD_GB,
            'INVALID_LOW_TRAFFIC_THRESHOLD',
            `lowTrafficThresholdGb must be a finite number between 0 and ${MAX_LOW_TRAFFIC_THRESHOLD_GB}`
          );
          updates.low_traffic_threshold_gb = String(threshold);
        }

        if ('expiryWarningDays' in body && body.expiryWarningDays !== undefined) {
          const warningDays = parseSafeInt(
            body.expiryWarningDays,
            0,
            MAX_EXPIRY_WARNING_DAYS,
            'INVALID_EXPIRY_WARNING_DAYS',
            `expiryWarningDays must be an integer between 0 and ${MAX_EXPIRY_WARNING_DAYS}`
          );
          updates.expiry_warning_days = String(warningDays);
        }

        if ('refundWindowHours' in body && body.refundWindowHours !== undefined) {
          const refundHours = parseSafeInt(
            body.refundWindowHours,
            0,
            MAX_REFUND_WINDOW_HOURS,
            'INVALID_REFUND_WINDOW_HOURS',
            `refundWindowHours must be an integer between 0 and ${MAX_REFUND_WINDOW_HOURS}`
          );
          updates.refund_window_hours = String(refundHours);
        }

        if (Object.keys(updates).length === 0) {
          throw new RouteValidationError(
            400,
            'EMPTY_UPDATE',
            'Provide at least one policy setting to update'
          );
        }

        await saveSettingsBatch(ts, updates);
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_update_package_policies',
          'setting',
          'package_policies',
          updates
        );

        return reply.code(200).send({ policies: loadPackagePolicies(ts) });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.post('/api/admin/packages/reorder', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const snapshot = loadPackagesSnapshot(ts);
        const orderedIds = parseReorderIds(
          body.orderedIds,
          snapshot.packages.map((pkg) => pkg.id)
        );
        const byId = new Map(snapshot.packages.map((pkg) => [pkg.id, pkg]));
        const nextPackages = orderedIds.map((id) => byId.get(id)!);

        await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_reorder_packages',
          'package',
          'order',
          { orderedIds }
        );

        return reply.code(200).send({ packages: nextPackages });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.patch<{ Params: { id: string } }>(
      '/api/admin/packages/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const pkgId = parsePackageParamId(request.params.id);
          const body = assertBodyRecord(request.body);
          const snapshot = loadPackagesSnapshot(ts);
          const index = snapshot.packages.findIndex((pkg) => pkg.id === pkgId);
          if (index === -1) {
            throw new RouteValidationError(404, 'PACKAGE_NOT_FOUND', 'Package not found');
          }
          const existing = snapshot.packages[index]!;

          const hasKnownField =
            'name' in body ||
            'gbAmount' in body ||
            'durationDays' in body ||
            'price' in body ||
            'enabled' in body ||
            'panelId' in body ||
            'serviceId' in body ||
            'categoryId' in body ||
            'startOnFirstUse' in body ||
            'rolloverQuota' in body;
          if (!hasKnownField) {
            throw new RouteValidationError(
              400,
              'EMPTY_UPDATE',
              'Provide at least one package field to update'
            );
          }

          const nextName =
            'name' in body && body.name !== undefined
              ? parseTrimmedString(
                  body.name,
                  MAX_PACKAGE_NAME_LENGTH,
                  'INVALID_PACKAGE_NAME',
                  'Package name must be a non-empty string up to 120 characters'
                )
              : existing.name;
          if (hasDuplicatePackageName(snapshot.packages, nextName, index)) {
            throw new RouteValidationError(
              409,
              'DUPLICATE_PACKAGE_NAME',
              'A package with this name already exists'
            );
          }

          const nextGbAmount =
            'gbAmount' in body && body.gbAmount !== undefined
              ? parseSafeInt(
                  body.gbAmount,
                  1,
                  MAX_GB_AMOUNT,
                  'INVALID_PACKAGE_GB',
                  `gbAmount must be an integer between 1 and ${MAX_GB_AMOUNT}`
                )
              : existing.gbAmount;

          const nextDurationDays =
            'durationDays' in body && body.durationDays !== undefined
              ? parseSafeInt(
                  body.durationDays,
                  1,
                  MAX_DURATION_DAYS,
                  'INVALID_PACKAGE_DAYS',
                  `durationDays must be an integer between 1 and ${MAX_DURATION_DAYS}`
                )
              : existing.durationDays;

          const nextPrice =
            'price' in body && body.price !== undefined
              ? parseSafeInt(
                  body.price,
                  1,
                  MAX_PRICE,
                  'INVALID_PACKAGE_PRICE',
                  'price must be a positive safe integer'
                )
              : existing.price;

          const nextEnabled =
            'enabled' in body && body.enabled !== undefined
              ? parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled')
              : existing.enabled;

          const nextTarget = resolvePatchPackageTarget(
            deps.panelRegistry,
            existing,
            body,
            'panelId' in body,
            'serviceId' in body
          );

          const nextCategoryId =
            'categoryId' in body
              ? await resolveCategoryIdInput(deps.packageCategoryService, body.categoryId)
              : existing.categoryId;

          const nextStartOnFirstUse =
            'startOnFirstUse' in body
              ? body.startOnFirstUse === null || body.startOnFirstUse === undefined
                ? undefined
                : parseBooleanField(
                    body.startOnFirstUse,
                    'INVALID_START_ON_FIRST_USE_FLAG',
                    'startOnFirstUse'
                  )
              : existing.startOnFirstUse;

          const nextRolloverQuota =
            'rolloverQuota' in body
              ? body.rolloverQuota === null || body.rolloverQuota === undefined
                ? undefined
                : parseBooleanField(
                    body.rolloverQuota,
                    'INVALID_ROLLOVER_QUOTA_FLAG',
                    'rolloverQuota'
                  )
              : existing.rolloverQuota;

          const updatedPkg: AdminPackageDto = {
            id: existing.id,
            name: nextName,
            gbAmount: nextGbAmount,
            durationDays: nextDurationDays,
            price: nextPrice,
            enabled: nextEnabled,
            ...(nextTarget ? { panelId: nextTarget.panelId, serviceId: nextTarget.serviceId } : {}),
            ...(nextCategoryId ? { categoryId: nextCategoryId } : {}),
            ...(nextStartOnFirstUse !== undefined ? { startOnFirstUse: nextStartOnFirstUse } : {}),
            ...(nextRolloverQuota !== undefined ? { rolloverQuota: nextRolloverQuota } : {}),
          };

          const nextPackages = snapshot.packages.map((pkg, i) => (i === index ? updatedPkg : pkg));
          await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_update_package',
            'package',
            existing.id,
            { updatedFields: Object.keys(body) }
          );

          return reply.code(200).send({ package: updatedPkg, packages: nextPackages });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post<{ Params: { id: string } }>(
      '/api/admin/packages/:id/toggle',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const pkgId = parsePackageParamId(request.params.id);
          const snapshot = loadPackagesSnapshot(ts);
          const index = snapshot.packages.findIndex((pkg) => pkg.id === pkgId);
          if (index === -1) {
            throw new RouteValidationError(404, 'PACKAGE_NOT_FOUND', 'Package not found');
          }

          let nextEnabled = !snapshot.packages[index]!.enabled;
          if (request.body !== undefined) {
            const body = assertBodyRecord(request.body);
            if ('enabled' in body && body.enabled !== undefined) {
              nextEnabled = parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled');
            }
          }

          const updatedPkg: AdminPackageDto = {
            ...snapshot.packages[index]!,
            enabled: nextEnabled,
          };
          const nextPackages = snapshot.packages.map((pkg, i) => (i === index ? updatedPkg : pkg));

          await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_toggle_package',
            'package',
            pkgId,
            { enabled: nextEnabled }
          );

          return reply.code(200).send({ package: updatedPkg, packages: nextPackages });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post<{ Params: { id: string } }>(
      '/api/admin/packages/:id/clone',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const pkgId = parsePackageParamId(request.params.id);
          const snapshot = loadPackagesSnapshot(ts);
          const index = snapshot.packages.findIndex((pkg) => pkg.id === pkgId);
          if (index === -1) {
            throw new RouteValidationError(404, 'PACKAGE_NOT_FOUND', 'Package not found');
          }
          if (snapshot.packages.length >= MAX_PACKAGE_COUNT) {
            throw new RouteValidationError(
              400,
              'PACKAGE_LIMIT_REACHED',
              `Cannot exceed ${MAX_PACKAGE_COUNT} packages`
            );
          }

          const existing = snapshot.packages[index]!;
          let explicitName: string | undefined;
          if (request.body !== undefined) {
            const body = assertBodyRecord(request.body);
            if ('name' in body && body.name !== undefined) {
              explicitName = parseTrimmedString(
                body.name,
                MAX_PACKAGE_NAME_LENGTH,
                'INVALID_PACKAGE_NAME',
                'Package name must be a non-empty string up to 120 characters'
              );
              if (hasDuplicatePackageName(snapshot.packages, explicitName)) {
                throw new RouteValidationError(
                  409,
                  'DUPLICATE_PACKAGE_NAME',
                  'A package with this name already exists'
                );
              }
            }
          }

          const cloneName =
            explicitName ?? buildUniqueCloneName(ts, existing.name, snapshot.packages);
          const cloneId = generatePackageId(cloneName, snapshot.packages);
          const clonedPkg: AdminPackageDto = {
            ...existing,
            id: cloneId,
            name: cloneName,
            enabled: existing.enabled,
          };

          const nextPackages = [
            ...snapshot.packages.slice(0, index + 1),
            clonedPkg,
            ...snapshot.packages.slice(index + 1),
          ];

          await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_clone_package',
            'package',
            cloneId,
            { sourcePackageId: pkgId, name: cloneName }
          );

          return reply.code(201).send({ package: clonedPkg, packages: nextPackages });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.delete<{ Params: { id: string } }>(
      '/api/admin/packages/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const pkgId = parsePackageParamId(request.params.id);
          const snapshot = loadPackagesSnapshot(ts);
          const existing = snapshot.packages.find((pkg) => pkg.id === pkgId);
          if (!existing) {
            throw new RouteValidationError(404, 'PACKAGE_NOT_FOUND', 'Package not found');
          }
          if (snapshot.packages.length <= 1) {
            throw new RouteValidationError(
              400,
              'LAST_PACKAGE_CANNOT_BE_DELETED',
              'Cannot delete the last remaining package'
            );
          }

          const nextPackages = snapshot.packages.filter((pkg) => pkg.id !== pkgId);
          await saveSettingSingle(ts, 'packages_json', JSON.stringify(nextPackages));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_delete_package',
            'package',
            pkgId,
            { name: existing.name }
          );

          return reply.code(200).send({ deletedId: pkgId, packages: nextPackages });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    // =========================================================================
    // Categories
    // =========================================================================

    adminScope.get<{ Querystring: { includeDisabled?: string } }>(
      '/api/admin/categories',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const categoryService = requireCategoryService(deps);
          const includeDisabled = request.query.includeDisabled !== 'false';
          const snapshot = loadPackagesSnapshot(ts);
          const rows = await categoryService.listCategories(includeDisabled);
          const categories = buildCategoryDtos(rows, snapshot.packages);
          const uncategorizedPackagesCount = snapshot.packages.filter(
            (pkg) => !pkg.categoryId
          ).length;

          return reply.code(200).send({
            categories,
            uncategorizedPackagesCount,
            bounds: {
              maxNameLength: MAX_CATEGORY_NAME_LENGTH,
              maxDescriptionLength: MAX_CATEGORY_DESCRIPTION_LENGTH,
              maxIconLength: MAX_CATEGORY_ICON_LENGTH,
            },
          });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post('/api/admin/categories', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const categoryService = requireCategoryService(deps);
        const body = assertBodyRecord(request.body);

        const explicitId =
          body.id !== undefined
            ? parseStrictIdentifier(body.id, 'INVALID_CATEGORY_ID', 'Category ID')
            : undefined;
        if (explicitId) {
          const duplicate = await categoryService.getCategoryById(explicitId);
          if (duplicate) {
            throw new RouteValidationError(
              409,
              'DUPLICATE_CATEGORY_ID',
              `Category ID "${explicitId}" already exists`
            );
          }
        }

        const name = parseTrimmedString(
          body.name,
          MAX_CATEGORY_NAME_LENGTH,
          'INVALID_CATEGORY_NAME',
          'Category name must be a non-empty string up to 100 characters'
        );
        const description = parseOptionalNullableText(
          body.description,
          MAX_CATEGORY_DESCRIPTION_LENGTH,
          'INVALID_CATEGORY_DESCRIPTION',
          'Category description must be 240 characters or fewer'
        );
        const icon = parseOptionalNullableText(
          body.icon,
          MAX_CATEGORY_ICON_LENGTH,
          'INVALID_CATEGORY_ICON',
          'Category icon must be 32 characters or fewer'
        );
        const displayOrder =
          body.displayOrder !== undefined
            ? parseSafeInt(
                body.displayOrder,
                0,
                MAX_DISPLAY_ORDER,
                'INVALID_DISPLAY_ORDER',
                `displayOrder must be an integer between 0 and ${MAX_DISPLAY_ORDER}`
              )
            : undefined;
        const enabled =
          body.enabled !== undefined
            ? parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled')
            : true;

        const created = await categoryService.createCategory({
          ...(explicitId ? { id: explicitId } : {}),
          name,
          ...(description ? { description } : {}),
          ...(icon ? { icon } : {}),
          ...(displayOrder !== undefined ? { displayOrder } : {}),
          enabled,
        });

        const snapshot = loadPackagesSnapshot(ts);
        const allCategories = buildCategoryDtos(
          await categoryService.listCategories(true),
          snapshot.packages
        );
        const dto =
          allCategories.find((c) => c.id === created.id) ??
          serializeCategory(created, snapshot.packages);

        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_create_category',
          'package_category',
          created.id,
          { name: created.name }
        );

        return reply.code(201).send({ category: dto, categories: allCategories });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.post('/api/admin/categories/reorder', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const categoryService = requireCategoryService(deps);
        const body = assertBodyRecord(request.body);
        const existing = await categoryService.listCategories(true);
        const orderedIds = parseReorderIds(
          body.orderedIds,
          existing.map((cat) => cat.id)
        );

        await categoryService.reorderCategories(orderedIds);
        const snapshot = loadPackagesSnapshot(ts);
        const categories = buildCategoryDtos(
          await categoryService.listCategories(true),
          snapshot.packages
        );

        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_reorder_categories',
          'package_category',
          'order',
          { orderedIds }
        );

        return reply.code(200).send({ categories });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.patch<{ Params: { id: string } }>(
      '/api/admin/categories/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const categoryService = requireCategoryService(deps);
          const catId = parseCategoryParamId(request.params.id);
          const existing = await categoryService.getCategoryById(catId);
          if (!existing) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          const body = assertBodyRecord(request.body);
          const hasKnownField =
            'name' in body ||
            'description' in body ||
            'icon' in body ||
            'displayOrder' in body ||
            'enabled' in body;
          if (!hasKnownField) {
            throw new RouteValidationError(
              400,
              'EMPTY_UPDATE',
              'Provide at least one category field to update'
            );
          }

          const updates: {
            name?: string;
            description?: string;
            icon?: string;
            displayOrder?: number;
            enabled?: boolean;
          } = {};

          if ('name' in body && body.name !== undefined) {
            updates.name = parseTrimmedString(
              body.name,
              MAX_CATEGORY_NAME_LENGTH,
              'INVALID_CATEGORY_NAME',
              'Category name must be a non-empty string up to 100 characters'
            );
          }
          if ('description' in body && body.description !== undefined) {
            updates.description =
              parseOptionalNullableText(
                body.description,
                MAX_CATEGORY_DESCRIPTION_LENGTH,
                'INVALID_CATEGORY_DESCRIPTION',
                'Category description must be 240 characters or fewer'
              ) ?? '';
          }
          if ('icon' in body && body.icon !== undefined) {
            updates.icon =
              parseOptionalNullableText(
                body.icon,
                MAX_CATEGORY_ICON_LENGTH,
                'INVALID_CATEGORY_ICON',
                'Category icon must be 32 characters or fewer'
              ) ?? '';
          }
          if ('displayOrder' in body && body.displayOrder !== undefined) {
            updates.displayOrder = parseSafeInt(
              body.displayOrder,
              0,
              MAX_DISPLAY_ORDER,
              'INVALID_DISPLAY_ORDER',
              `displayOrder must be an integer between 0 and ${MAX_DISPLAY_ORDER}`
            );
          }
          if ('enabled' in body && body.enabled !== undefined) {
            updates.enabled = parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled');
          }

          const updated = await categoryService.updateCategory(catId, updates);
          if (!updated) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          const snapshot = loadPackagesSnapshot(ts);
          const allCategories = buildCategoryDtos(
            await categoryService.listCategories(true),
            snapshot.packages
          );
          const dto =
            allCategories.find((c) => c.id === updated.id) ??
            serializeCategory(updated, snapshot.packages);

          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_update_category',
            'package_category',
            catId,
            { updatedFields: Object.keys(updates) }
          );

          return reply.code(200).send({ category: dto, categories: allCategories });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post<{ Params: { id: string } }>(
      '/api/admin/categories/:id/toggle',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const categoryService = requireCategoryService(deps);
          const catId = parseCategoryParamId(request.params.id);
          const existing = await categoryService.getCategoryById(catId);
          if (!existing) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          let nextEnabled = !existing.enabled;
          if (request.body !== undefined) {
            const body = assertBodyRecord(request.body);
            if ('enabled' in body && body.enabled !== undefined) {
              nextEnabled = parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled');
            }
          }

          const updated = await categoryService.updateCategory(catId, { enabled: nextEnabled });
          if (!updated) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          const snapshot = loadPackagesSnapshot(ts);
          const allCategories = buildCategoryDtos(
            await categoryService.listCategories(true),
            snapshot.packages
          );
          const dto =
            allCategories.find((c) => c.id === updated.id) ??
            serializeCategory(updated, snapshot.packages);

          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_toggle_category',
            'package_category',
            catId,
            { enabled: nextEnabled }
          );

          return reply.code(200).send({ category: dto, categories: allCategories });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.delete<{ Params: { id: string } }>(
      '/api/admin/categories/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const categoryService = requireCategoryService(deps);
          const catId = parseCategoryParamId(request.params.id);
          const existing = await categoryService.getCategoryById(catId);
          if (!existing) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          const beforePackages = parsePackageOptionsJson(ts.getSetting('packages_json')) ?? [];
          const linkedCountBefore = beforePackages.filter((pkg) => pkg.categoryId === catId).length;

          const deleted = await categoryService.deleteCategory(catId);
          if (!deleted) {
            throw new RouteValidationError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
          }

          // Fallback safety in case a mock categoryService only deleted the category row
          const afterPackages = parsePackageOptionsJson(ts.getSetting('packages_json'));
          if (afterPackages && afterPackages.some((pkg) => pkg.categoryId === catId)) {
            const unlinked = afterPackages.map((pkg) => {
              if (pkg.categoryId !== catId) return pkg;
              const copy = { ...pkg };
              delete copy.categoryId;
              return copy;
            });
            await saveSettingSingle(ts, 'packages_json', JSON.stringify(unlinked));
          }

          const snapshotAfter = loadPackagesSnapshot(ts);
          const categories = buildCategoryDtos(
            await categoryService.listCategories(true),
            snapshotAfter.packages
          );

          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_delete_category',
            'package_category',
            catId,
            { name: existing.name, unlinkedPackagesCount: linkedCountBefore }
          );

          return reply.code(200).send({
            deletedId: catId,
            unlinkedPackagesCount: linkedCountBefore,
            categories,
          });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    // =========================================================================
    // Custom Pricing / Tariffs, Tiers, Overrides & Simulator
    // =========================================================================

    adminScope.get('/api/admin/pricing/custom', async (_request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const pricingService = requirePricingService(deps);
        return reply.code(200).send({
          settings: loadCustomPricingSettings(ts, pricingService),
          tiers: loadVolumeTiers(ts),
          overrides: loadCustomOverrides(ts),
          targets: buildTargetSummaries(deps.panelRegistry),
          bounds: {
            minGbLimit: 1,
            maxGbLimit: MAX_GB_AMOUNT,
            minDaysLimit: 1,
            maxDaysLimit: MAX_DURATION_DAYS,
            webMaxDaysLimit: MAX_WEB_CUSTOM_DAYS,
            maxRules: MAX_PRICE_RULES,
            maxPrice: MAX_PRICE,
          },
        });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.put('/api/admin/pricing/custom/settings', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const pricingService = requirePricingService(deps);
        const body = assertBodyRecord(request.body);
        const current = loadCustomPricingSettings(ts, pricingService);
        const updates: Record<string, string> = {};

        if ('enabled' in body && body.enabled !== undefined) {
          const enabled = parseBooleanField(body.enabled, 'INVALID_ENABLED_FLAG', 'enabled');
          updates.custom_volume_enabled = enabled ? 'true' : 'false';
        }

        if ('pricePerGb' in body && body.pricePerGb !== undefined) {
          const pricePerGb = parseSafeInt(
            body.pricePerGb,
            0,
            MAX_PRICE,
            'INVALID_CUSTOM_RATE',
            'pricePerGb must be a non-negative safe integer'
          );
          updates.price_per_gb = String(pricePerGb);
        }

        if ('pricePerDay' in body && body.pricePerDay !== undefined) {
          const pricePerDay = parseSafeInt(
            body.pricePerDay,
            0,
            MAX_PRICE,
            'INVALID_CUSTOM_RATE',
            'pricePerDay must be a non-negative safe integer'
          );
          updates.price_per_day = String(pricePerDay);
        }

        let nextMinGb = current.minGb;
        let nextMaxGb = current.maxGb;
        if ('minGb' in body && body.minGb !== undefined) {
          nextMinGb = parseSafeInt(
            body.minGb,
            1,
            MAX_GB_AMOUNT,
            'INVALID_CUSTOM_BOUNDS',
            `minGb must be an integer between 1 and ${MAX_GB_AMOUNT}`
          );
          updates.custom_min_gb = String(nextMinGb);
        }
        if ('maxGb' in body && body.maxGb !== undefined) {
          nextMaxGb = parseSafeInt(
            body.maxGb,
            1,
            MAX_GB_AMOUNT,
            'INVALID_CUSTOM_BOUNDS',
            `maxGb must be an integer between 1 and ${MAX_GB_AMOUNT}`
          );
          updates.custom_max_gb = String(nextMaxGb);
        }
        if (nextMinGb > nextMaxGb) {
          throw new RouteValidationError(
            400,
            'INVALID_CUSTOM_BOUNDS',
            'minGb cannot be greater than maxGb'
          );
        }

        if ('defaultDays' in body && body.defaultDays !== undefined) {
          const defaultDays = parseSafeInt(
            body.defaultDays,
            1,
            MAX_DURATION_DAYS,
            'INVALID_CUSTOM_BOUNDS',
            `defaultDays must be an integer between 1 and ${MAX_DURATION_DAYS}`
          );
          updates.custom_default_days = String(defaultDays);
        }

        if ('target' in body && body.target !== undefined) {
          if (body.target === null) {
            updates.custom_volume_target_json = '';
            updates.custom_volume_panel_id = '';
            updates.custom_volume_service_id = '';
          } else {
            const targetRecord = assertBodyRecord(
              body.target,
              'INVALID_PACKAGE_TARGET',
              'target must be an object with { panelId, serviceId } or null'
            );
            const normalizedPanelId =
              typeof targetRecord.panelId === 'string'
                ? targetRecord.panelId.trim()
                : targetRecord.panelId;
            const isTargetChanged =
              current.target?.panelId !== normalizedPanelId ||
              current.target?.serviceId !== targetRecord.serviceId;
            const resolved = validateTargetPair(
              deps.panelRegistry,
              targetRecord.panelId,
              targetRecord.serviceId,
              isTargetChanged
            );
            updates.custom_volume_target_json = JSON.stringify(resolved);
            updates.custom_volume_panel_id = '';
            updates.custom_volume_service_id = '';
          }
        }

        if (Object.keys(updates).length === 0) {
          throw new RouteValidationError(
            400,
            'EMPTY_UPDATE',
            'Provide at least one custom pricing setting to update'
          );
        }

        await saveSettingsBatch(ts, updates);
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_update_custom_pricing_settings',
          'setting',
          'custom_pricing',
          updates
        );

        return reply.code(200).send({
          settings: loadCustomPricingSettings(ts, pricingService),
        });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.post('/api/admin/pricing/custom/tiers', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const tiers = loadVolumeTiers(ts);
        if (tiers.length >= MAX_PRICE_RULES) {
          throw new RouteValidationError(
            400,
            'PRICE_RULE_LIMIT_REACHED',
            `Cannot exceed ${MAX_PRICE_RULES} volume pricing tiers`
          );
        }

        const minGb = parseSafeInt(
          body.minGb,
          1,
          MAX_GB_AMOUNT,
          'INVALID_VOLUME_TIER',
          `minGb must be an integer between 1 and ${MAX_GB_AMOUNT}`
        );
        const maxGb =
          body.maxGb !== undefined && body.maxGb !== null
            ? parseSafeInt(
                body.maxGb,
                minGb,
                MAX_GB_AMOUNT,
                'INVALID_VOLUME_TIER',
                `maxGb must be an integer between ${minGb} and ${MAX_GB_AMOUNT}`
              )
            : undefined;

        const pricePerGb =
          body.pricePerGb !== undefined && body.pricePerGb !== null
            ? parseSafeInt(
                body.pricePerGb,
                0,
                MAX_PRICE,
                'INVALID_VOLUME_TIER',
                'pricePerGb must be a non-negative safe integer'
              )
            : undefined;
        const discountPercent =
          body.discountPercent !== undefined && body.discountPercent !== null
            ? parseSafeInt(
                body.discountPercent,
                0,
                100,
                'INVALID_VOLUME_TIER',
                'discountPercent must be an integer between 0 and 100'
              )
            : undefined;

        if ((pricePerGb !== undefined) === (discountPercent !== undefined)) {
          throw new RouteValidationError(
            400,
            'TIER_RATE_DISCOUNT_XOR',
            'Provide exactly one of pricePerGb or discountPercent'
          );
        }

        const explicitId =
          body.id !== undefined
            ? parseStrictIdentifier(body.id, 'INVALID_TIER_ID', 'Tier ID')
            : undefined;
        const id = explicitId ?? generateTierId(minGb, maxGb, tiers);
        if (tiers.some((tier) => tier.id === id)) {
          throw new RouteValidationError(
            409,
            'DUPLICATE_TIER_ID',
            `Volume tier ID "${id}" already exists`
          );
        }

        const newTier: VolumePricingTier = {
          id,
          minGb,
          ...(maxGb !== undefined ? { maxGb } : {}),
          ...(pricePerGb !== undefined ? { pricePerGb } : {}),
          ...(discountPercent !== undefined ? { discountPercent } : {}),
        };

        const nextTiers = [...tiers, newTier].sort((a, b) => b.minGb - a.minGb);
        await saveSettingSingle(ts, 'volume_pricing_tiers_json', JSON.stringify(nextTiers));
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_create_volume_tier',
          'volume_tier',
          id,
          { tier: newTier }
        );

        return reply.code(201).send({ tier: newTier, tiers: nextTiers });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.patch<{ Params: { id: string } }>(
      '/api/admin/pricing/custom/tiers/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const tierId = parseStrictIdentifier(request.params.id, 'INVALID_TIER_ID', 'Tier ID');
          const tiers = loadVolumeTiers(ts);
          const index = tiers.findIndex((tier) => tier.id === tierId);
          if (index === -1) {
            throw new RouteValidationError(404, 'TIER_NOT_FOUND', 'Volume pricing tier not found');
          }
          const existing = tiers[index]!;
          const body = assertBodyRecord(request.body);

          const hasKnownField =
            'minGb' in body || 'maxGb' in body || 'pricePerGb' in body || 'discountPercent' in body;
          if (!hasKnownField) {
            throw new RouteValidationError(
              400,
              'EMPTY_UPDATE',
              'Provide at least one tier field to update'
            );
          }

          const nextMinGb =
            'minGb' in body && body.minGb !== undefined
              ? parseSafeInt(
                  body.minGb,
                  1,
                  MAX_GB_AMOUNT,
                  'INVALID_VOLUME_TIER',
                  `minGb must be an integer between 1 and ${MAX_GB_AMOUNT}`
                )
              : existing.minGb;

          let nextMaxGb: number | undefined = existing.maxGb;
          if ('maxGb' in body && body.maxGb !== undefined) {
            nextMaxGb =
              body.maxGb === null
                ? undefined
                : parseSafeInt(
                    body.maxGb,
                    1,
                    MAX_GB_AMOUNT,
                    'INVALID_VOLUME_TIER',
                    `maxGb must be an integer between 1 and ${MAX_GB_AMOUNT}`
                  );
          }
          if (nextMaxGb !== undefined && nextMaxGb < nextMinGb) {
            throw new RouteValidationError(
              400,
              'INVALID_VOLUME_TIER',
              'maxGb cannot be less than minGb'
            );
          }

          let nextPricePerGb: number | undefined = existing.pricePerGb;
          if ('pricePerGb' in body && body.pricePerGb !== undefined) {
            nextPricePerGb =
              body.pricePerGb === null
                ? undefined
                : parseSafeInt(
                    body.pricePerGb,
                    0,
                    MAX_PRICE,
                    'INVALID_VOLUME_TIER',
                    'pricePerGb must be a non-negative safe integer'
                  );
          }

          let nextDiscountPercent: number | undefined = existing.discountPercent;
          if ('discountPercent' in body && body.discountPercent !== undefined) {
            nextDiscountPercent =
              body.discountPercent === null
                ? undefined
                : parseSafeInt(
                    body.discountPercent,
                    0,
                    100,
                    'INVALID_VOLUME_TIER',
                    'discountPercent must be an integer between 0 and 100'
                  );
          }

          if ((nextPricePerGb !== undefined) === (nextDiscountPercent !== undefined)) {
            throw new RouteValidationError(
              400,
              'TIER_RATE_DISCOUNT_XOR',
              'Tier must define exactly one of pricePerGb or discountPercent (pass null to clear the other mode)'
            );
          }

          const updatedTier: VolumePricingTier = {
            id: existing.id,
            minGb: nextMinGb,
            ...(nextMaxGb !== undefined ? { maxGb: nextMaxGb } : {}),
            ...(nextPricePerGb !== undefined ? { pricePerGb: nextPricePerGb } : {}),
            ...(nextDiscountPercent !== undefined ? { discountPercent: nextDiscountPercent } : {}),
          };

          const nextTiers = tiers
            .map((tier, i) => (i === index ? updatedTier : tier))
            .sort((a, b) => b.minGb - a.minGb);

          await saveSettingSingle(ts, 'volume_pricing_tiers_json', JSON.stringify(nextTiers));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_update_volume_tier',
            'volume_tier',
            tierId,
            { tier: updatedTier }
          );

          return reply.code(200).send({ tier: updatedTier, tiers: nextTiers });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.delete<{ Params: { id: string } }>(
      '/api/admin/pricing/custom/tiers/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const tierId = parseStrictIdentifier(request.params.id, 'INVALID_TIER_ID', 'Tier ID');
          const tiers = loadVolumeTiers(ts);
          if (!tiers.some((tier) => tier.id === tierId)) {
            throw new RouteValidationError(404, 'TIER_NOT_FOUND', 'Volume pricing tier not found');
          }

          const nextTiers = tiers.filter((tier) => tier.id !== tierId);
          await saveSettingSingle(ts, 'volume_pricing_tiers_json', JSON.stringify(nextTiers));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_delete_volume_tier',
            'volume_tier',
            tierId
          );

          return reply.code(200).send({ deletedId: tierId, tiers: nextTiers });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post('/api/admin/pricing/custom/overrides', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const overrides = loadCustomOverrides(ts);
        if (overrides.length >= MAX_PRICE_RULES) {
          throw new RouteValidationError(
            400,
            'PRICE_RULE_LIMIT_REACHED',
            `Cannot exceed ${MAX_PRICE_RULES} custom price overrides`
          );
        }

        const validated = validateOverrideFields(body, {});
        const explicitId =
          body.id !== undefined
            ? parseStrictIdentifier(body.id, 'INVALID_OVERRIDE_ID', 'Override ID')
            : undefined;
        const id = explicitId ?? generateOverrideId(validated, overrides);
        if (overrides.some((ovr) => ovr.id === id)) {
          throw new RouteValidationError(
            409,
            'DUPLICATE_OVERRIDE_ID',
            `Override ID "${id}" already exists`
          );
        }

        const newOverride: CustomPriceOverride = { id, ...validated };
        const nextOverrides = [...overrides, newOverride];

        await saveSettingSingle(ts, 'custom_price_overrides_json', JSON.stringify(nextOverrides));
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_create_price_override',
          'custom_price_override',
          id,
          { override: newOverride }
        );

        return reply.code(201).send({ override: newOverride, overrides: nextOverrides });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.post('/api/admin/pricing/custom/overrides/reorder', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const body = assertBodyRecord(request.body);
        const overrides = loadCustomOverrides(ts);
        const orderedIds = parseReorderIds(
          body.orderedIds,
          overrides.map((ovr) => ovr.id)
        );
        const byId = new Map(overrides.map((ovr) => [ovr.id, ovr]));
        const nextOverrides = orderedIds.map((id) => byId.get(id)!);

        await saveSettingSingle(ts, 'custom_price_overrides_json', JSON.stringify(nextOverrides));
        await recordAudit(
          deps,
          request.userSession!.telegramId,
          'admin_reorder_price_overrides',
          'custom_price_override',
          'order',
          { orderedIds }
        );

        return reply.code(200).send({ overrides: nextOverrides });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });

    adminScope.patch<{ Params: { id: string } }>(
      '/api/admin/pricing/custom/overrides/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const overrideId = parseStrictIdentifier(
            request.params.id,
            'INVALID_OVERRIDE_ID',
            'Override ID'
          );
          const overrides = loadCustomOverrides(ts);
          const index = overrides.findIndex((ovr) => ovr.id === overrideId);
          if (index === -1) {
            throw new RouteValidationError(
              404,
              'OVERRIDE_NOT_FOUND',
              'Custom price override not found'
            );
          }

          const existing = overrides[index]!;
          const body = assertBodyRecord(request.body);
          const hasKnownField =
            'minGb' in body ||
            'maxGb' in body ||
            'minDays' in body ||
            'maxDays' in body ||
            'price' in body ||
            'pricePerGb' in body ||
            'pricePerDay' in body;
          if (!hasKnownField) {
            throw new RouteValidationError(
              400,
              'EMPTY_UPDATE',
              'Provide at least one override field to update'
            );
          }

          const validated = validateOverrideFields(body, existing);
          const updatedOverride: CustomPriceOverride = { id: existing.id, ...validated };
          const nextOverrides = overrides.map((ovr, i) => (i === index ? updatedOverride : ovr));

          await saveSettingSingle(ts, 'custom_price_overrides_json', JSON.stringify(nextOverrides));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_update_price_override',
            'custom_price_override',
            overrideId,
            { override: updatedOverride }
          );

          return reply.code(200).send({ override: updatedOverride, overrides: nextOverrides });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.delete<{ Params: { id: string } }>(
      '/api/admin/pricing/custom/overrides/:id',
      async (request, reply) => {
        try {
          const ts = requireTranslationService(deps);
          const overrideId = parseStrictIdentifier(
            request.params.id,
            'INVALID_OVERRIDE_ID',
            'Override ID'
          );
          const overrides = loadCustomOverrides(ts);
          if (!overrides.some((ovr) => ovr.id === overrideId)) {
            throw new RouteValidationError(
              404,
              'OVERRIDE_NOT_FOUND',
              'Custom price override not found'
            );
          }

          const nextOverrides = overrides.filter((ovr) => ovr.id !== overrideId);
          await saveSettingSingle(ts, 'custom_price_overrides_json', JSON.stringify(nextOverrides));
          await recordAudit(
            deps,
            request.userSession!.telegramId,
            'admin_delete_price_override',
            'custom_price_override',
            overrideId
          );

          return reply.code(200).send({ deletedId: overrideId, overrides: nextOverrides });
        } catch (err) {
          return handleRouteError(reply, err);
        }
      }
    );

    adminScope.post('/api/admin/pricing/custom/quote', async (request, reply) => {
      try {
        const ts = requireTranslationService(deps);
        const pricingService = requirePricingService(deps);
        const body = assertBodyRecord(request.body);

        const gbAmount = parseSafeInt(
          body.gbAmount,
          1,
          MAX_GB_AMOUNT,
          'INVALID_CUSTOM_BOUNDS',
          `gbAmount must be an integer between 1 and ${MAX_GB_AMOUNT}`
        );
        const durationDays = parseSafeInt(
          body.durationDays,
          1,
          MAX_DURATION_DAYS,
          'INVALID_CUSTOM_BOUNDS',
          `durationDays must be an integer between 1 and ${MAX_DURATION_DAYS}`
        );

        let quote: CustomPriceQuote;
        try {
          quote = pricingService.getCustomPriceQuote(gbAmount, durationDays);
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'CUSTOM_PRICE_OVERFLOW') {
            throw new RouteValidationError(
              400,
              'CUSTOM_PRICE_OVERFLOW',
              'Calculated custom price exceeds maximum supported integer'
            );
          }
          throw err;
        }

        const settings = loadCustomPricingSettings(ts, pricingService);
        const warnings: string[] = [];
        if (!settings.enabled) warnings.push('CUSTOM_VOLUME_DISABLED');
        if (gbAmount < settings.minGb || gbAmount > settings.maxGb) {
          warnings.push('GB_OUTSIDE_CONFIGURED_BOUNDS');
        }
        if (durationDays > MAX_WEB_CUSTOM_DAYS) {
          warnings.push('DURATION_EXCEEDS_WEB_LIMIT');
        }

        return reply.code(200).send({
          quote,
          gbAmount,
          durationDays,
          warnings,
        });
      } catch (err) {
        return handleRouteError(reply, err);
      }
    });
  });
}

// =============================================================================
// Shared Loaders & Persistence Helpers
// =============================================================================

function requireTranslationService(deps: AdminPackageRoutesDeps): TranslationService {
  if (!deps.translationService || typeof deps.translationService.getSetting !== 'function') {
    throw new RouteValidationError(503, 'SERVICE_UNAVAILABLE', 'Settings service is unavailable');
  }
  return deps.translationService;
}

function requirePricingService(deps: AdminPackageRoutesDeps): PricingService {
  if (!deps.pricingService || typeof deps.pricingService.getCustomPriceQuote !== 'function') {
    throw new RouteValidationError(503, 'SERVICE_UNAVAILABLE', 'Pricing service is unavailable');
  }
  return deps.pricingService;
}

function requireCategoryService(deps: AdminPackageRoutesDeps): PackageCategoryService {
  if (
    !deps.packageCategoryService ||
    typeof deps.packageCategoryService.listCategories !== 'function'
  ) {
    throw new RouteValidationError(503, 'SERVICE_UNAVAILABLE', 'Category service is unavailable');
  }
  return deps.packageCategoryService;
}

function loadPackagesSnapshot(ts: TranslationService): {
  packages: AdminPackageDto[];
  isFallbackActive: boolean;
} {
  const parsed = parsePackageOptionsJson(ts.getSetting('packages_json'));
  const source = parsed ?? FALLBACK_PACKAGES;
  return {
    packages: source.map((pkg) => ({
      ...pkg,
      enabled: pkg.enabled !== false,
    })),
    isFallbackActive: parsed === undefined,
  };
}

function loadPackagePolicies(ts: TranslationService): PackagePoliciesDto {
  const rawDisplayMode = ts.getSetting('package_display_mode', 'specs').trim().toLowerCase();
  const packageDisplayMode: 'specs' | 'name' = rawDisplayMode === 'name' ? 'name' : 'specs';
  const rawThreshold = ts.getSettingNum('low_traffic_threshold_gb', 2);
  const lowTrafficThresholdGb =
    Number.isFinite(rawThreshold) && rawThreshold >= 0
      ? Math.min(rawThreshold, MAX_LOW_TRAFFIC_THRESHOLD_GB)
      : 2;
  const rawWarningDays = Math.trunc(ts.getSettingNum('expiry_warning_days', 3));
  const expiryWarningDays =
    Number.isSafeInteger(rawWarningDays) && rawWarningDays >= 0
      ? Math.min(rawWarningDays, MAX_EXPIRY_WARNING_DAYS)
      : 3;
  const rawRefundHours = Math.trunc(ts.getSettingNum('refund_window_hours', 0));
  const refundWindowHours =
    Number.isSafeInteger(rawRefundHours) && rawRefundHours >= 0
      ? Math.min(rawRefundHours, MAX_REFUND_WINDOW_HOURS)
      : 0;

  return {
    packageDisplayMode,
    lowTrafficThresholdGb,
    expiryWarningDays,
    refundWindowHours,
  };
}

function loadCustomPricingSettings(
  ts: TranslationService,
  pricingService: PricingService
): CustomPricingSettingsDto {
  const enabled = customVolumeEnabled(ts);
  const rawPricePerGb = Math.trunc(ts.getSettingNum('price_per_gb', 5000));
  const pricePerGb =
    Number.isSafeInteger(rawPricePerGb) && rawPricePerGb >= 0 ? rawPricePerGb : 5000;
  const rawPricePerDay = Math.trunc(ts.getSettingNum('price_per_day', 0));
  const pricePerDay =
    Number.isSafeInteger(rawPricePerDay) && rawPricePerDay >= 0 ? rawPricePerDay : 0;

  const rawMinGb = Math.trunc(ts.getSettingNum('custom_min_gb', 5));
  const minGb = Math.min(MAX_GB_AMOUNT, Math.max(1, Number.isSafeInteger(rawMinGb) ? rawMinGb : 5));
  const rawMaxGb = Math.trunc(ts.getSettingNum('custom_max_gb', 500));
  const maxGb = Math.min(
    MAX_GB_AMOUNT,
    Math.max(minGb, Number.isSafeInteger(rawMaxGb) ? rawMaxGb : 500)
  );
  const rawDefaultDays = Math.trunc(ts.getSettingNum('custom_default_days', 30));
  const defaultDays = Math.min(
    MAX_DURATION_DAYS,
    Math.max(1, Number.isSafeInteger(rawDefaultDays) ? rawDefaultDays : 30)
  );

  const rawTarget = pricingService.getCustomVolumeTarget();
  const target =
    rawTarget.panelId !== undefined && rawTarget.serviceId !== undefined
      ? { panelId: rawTarget.panelId, serviceId: rawTarget.serviceId }
      : null;

  const warnings: string[] = [];
  if (defaultDays > MAX_WEB_CUSTOM_DAYS) warnings.push('DEFAULT_DAYS_EXCEEDS_WEB_LIMIT');
  if (pricePerGb === 0 && pricePerDay === 0) warnings.push('ZERO_BASE_RATES');

  return {
    enabled,
    pricePerGb,
    pricePerDay,
    minGb,
    maxGb,
    defaultDays,
    target,
    warnings,
  };
}

function loadVolumeTiers(ts: TranslationService): VolumePricingTier[] {
  return parseVolumePricingTiersJson(ts.getSetting('volume_pricing_tiers_json')) ?? [];
}

function loadCustomOverrides(ts: TranslationService): CustomPriceOverride[] {
  return parseCustomPriceOverridesJson(ts.getSetting('custom_price_overrides_json')) ?? [];
}

async function saveSettingSingle(
  ts: TranslationService,
  key: string,
  value: string
): Promise<void> {
  await ts.updateSetting(key, value);
}

async function saveSettingsBatch(
  ts: TranslationService,
  pairs: Record<string, string>
): Promise<void> {
  const entries = Object.entries(pairs);
  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    await ts.updateSetting(key, value);
    return;
  }
  await ts.updateSettings(pairs);
}

async function recordAudit(
  deps: AdminPackageRoutesDeps,
  actorTelegramId: number,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (typeof deps.userService?.recordAdminAction !== 'function') return;
  await deps.userService.recordAdminAction({
    actorTelegramId,
    action,
    entityType,
    entityId,
    ...(metadata ? { metadata } : {}),
  });
}

// =============================================================================
// DTO Serializers & Target / Category Resolution
// =============================================================================

function buildCategoryDtos(
  categories: readonly PackageCategory[],
  packages: readonly AdminPackageDto[]
): AdminCategoryDto[] {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    if (pkg.categoryId) {
      counts.set(pkg.categoryId, (counts.get(pkg.categoryId) ?? 0) + 1);
    }
  }
  return categories.map((cat) => serializeCategoryWithCount(cat, counts.get(cat.id) ?? 0));
}

function serializeCategory(
  cat: PackageCategory,
  packages: readonly AdminPackageDto[]
): AdminCategoryDto {
  const linkedPackagesCount = packages.filter((pkg) => pkg.categoryId === cat.id).length;
  return serializeCategoryWithCount(cat, linkedPackagesCount);
}

function serializeCategoryWithCount(
  cat: PackageCategory,
  linkedPackagesCount: number
): AdminCategoryDto {
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description ?? null,
    icon: cat.icon ?? null,
    displayOrder: cat.displayOrder,
    enabled: cat.enabled,
    linkedPackagesCount,
    createdAt: cat.createdAt instanceof Date ? cat.createdAt.toISOString() : String(cat.createdAt),
    updatedAt: cat.updatedAt instanceof Date ? cat.updatedAt.toISOString() : String(cat.updatedAt),
  };
}

function buildTargetSummaries(panelRegistry?: RebeccaPanelRegistry): AdminTargetPanelDto[] {
  if (!panelRegistry || typeof panelRegistry.listPanels !== 'function') return [];
  return panelRegistry.listPanels().map((panel: RebeccaPanelSummary) => {
    const defaultService = panel.services.find((service) => service.isDefault) ?? panel.services[0];
    return {
      panelId: panel.id,
      panelName: panel.name,
      enabled: panel.enabled,
      isDefault: panel.isDefault,
      defaultServiceId: defaultService?.serviceId ?? null,
      services: panel.services.map((service) => ({
        serviceId: service.serviceId,
        name: service.name,
        isDefault: service.isDefault,
      })),
    };
  });
}

function resolveCreatePackageTarget(
  panelRegistry: RebeccaPanelRegistry | undefined,
  rawPanelId: unknown,
  rawServiceId: unknown
): { panelId: string; serviceId: number } | undefined {
  const hasPanel = rawPanelId !== undefined && rawPanelId !== null;
  const hasService = rawServiceId !== undefined && rawServiceId !== null;
  if (!hasPanel && !hasService) return undefined;
  if (hasPanel !== hasService) {
    throw new RouteValidationError(
      400,
      'INCOMPLETE_TARGET',
      'Both panelId and serviceId must be provided together'
    );
  }
  return validateTargetPair(panelRegistry, rawPanelId, rawServiceId, true);
}

function resolvePatchPackageTarget(
  panelRegistry: RebeccaPanelRegistry | undefined,
  existing: AdminPackageDto,
  body: Record<string, unknown>,
  hasPanelKey: boolean,
  hasServiceKey: boolean
): { panelId: string; serviceId: number } | undefined {
  if (!hasPanelKey && !hasServiceKey) {
    return existing.panelId !== undefined && existing.serviceId !== undefined
      ? { panelId: existing.panelId, serviceId: existing.serviceId }
      : undefined;
  }

  const rawPanelId = body.panelId;
  const rawServiceId = body.serviceId;
  if (rawPanelId === null && rawServiceId === null) {
    return undefined;
  }

  if (
    rawPanelId === null ||
    rawPanelId === undefined ||
    rawServiceId === null ||
    rawServiceId === undefined
  ) {
    throw new RouteValidationError(
      400,
      'INCOMPLETE_TARGET',
      'Provide both panelId and serviceId together, or set both to null to reset to system default'
    );
  }

  const normalizedPanelId = typeof rawPanelId === 'string' ? rawPanelId.trim() : rawPanelId;
  const isTargetChanged =
    existing.panelId !== normalizedPanelId || existing.serviceId !== rawServiceId;
  return validateTargetPair(panelRegistry, rawPanelId, rawServiceId, isTargetChanged);
}

function validateTargetPair(
  panelRegistry: RebeccaPanelRegistry | undefined,
  rawPanelId: unknown,
  rawServiceId: unknown,
  requireEnabledPanel: boolean
): { panelId: string; serviceId: number } {
  if (typeof rawPanelId !== 'string') {
    throw new RouteValidationError(
      400,
      'INVALID_PACKAGE_TARGET',
      'panelId must be a valid identifier string'
    );
  }
  const panelId = rawPanelId.trim();
  if (!PANEL_ID_PATTERN.test(panelId)) {
    throw new RouteValidationError(400, 'INVALID_PACKAGE_TARGET', 'panelId format is invalid');
  }

  const serviceId = parseSafeInt(
    rawServiceId,
    1,
    MAX_SERVICE_ID,
    'INVALID_PACKAGE_TARGET',
    `serviceId must be an integer between 1 and ${MAX_SERVICE_ID}`
  );

  if (!panelRegistry) {
    throw new RouteValidationError(503, 'SERVICE_UNAVAILABLE', 'Panel registry is unavailable');
  }

  const panel =
    typeof panelRegistry.getPanel === 'function'
      ? panelRegistry.getPanel(panelId)
      : panelRegistry.listPanels?.().find((candidate) => candidate.id === panelId);
  if (!panel) {
    throw new RouteValidationError(400, 'PANEL_NOT_FOUND', `Panel "${panelId}" does not exist`);
  }
  if (requireEnabledPanel && !panel.enabled) {
    throw new RouteValidationError(
      400,
      'PANEL_DISABLED',
      `Panel "${panelId}" is currently disabled`
    );
  }
  if (!panel.services.some((service) => service.serviceId === serviceId)) {
    throw new RouteValidationError(
      400,
      'SERVICE_NOT_FOUND',
      `Service ${serviceId} does not exist on panel "${panelId}"`
    );
  }

  return { panelId, serviceId };
}

async function resolveCategoryIdInput(
  categoryService: PackageCategoryService | undefined,
  rawCategoryId: unknown
): Promise<string | undefined> {
  if (rawCategoryId === undefined || rawCategoryId === null) return undefined;
  if (typeof rawCategoryId !== 'string') {
    throw new RouteValidationError(
      400,
      'INVALID_CATEGORY_ID',
      'categoryId must be a string or null'
    );
  }
  const trimmed = rawCategoryId.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_CATEGORY_ID_LENGTH) {
    throw new RouteValidationError(
      400,
      'INVALID_CATEGORY_ID',
      `categoryId cannot exceed ${MAX_CATEGORY_ID_LENGTH} characters`
    );
  }
  if (!categoryService || typeof categoryService.getCategoryById !== 'function') {
    throw new RouteValidationError(503, 'SERVICE_UNAVAILABLE', 'Category service is unavailable');
  }
  const existing = await categoryService.getCategoryById(trimmed);
  if (!existing) {
    throw new RouteValidationError(
      400,
      'CATEGORY_NOT_FOUND',
      `Category "${trimmed}" does not exist`
    );
  }
  return existing.id;
}

// =============================================================================
// Rule Validation & ID Generation Helpers
// =============================================================================

function validateOverrideFields(
  body: Record<string, unknown>,
  existing: Partial<Omit<CustomPriceOverride, 'id'>>
): Omit<CustomPriceOverride, 'id'> {
  const resolveOptInt = (
    key: 'minGb' | 'maxGb' | 'minDays' | 'maxDays' | 'price' | 'pricePerGb' | 'pricePerDay',
    min: number,
    max: number
  ): number | undefined => {
    if (!(key in body) || body[key] === undefined) return existing[key];
    if (body[key] === null) return undefined;
    return parseSafeInt(
      body[key],
      min,
      max,
      'INVALID_PRICE_OVERRIDE',
      `${key} must be an integer between ${min} and ${max}`
    );
  };

  const minGb = resolveOptInt('minGb', 1, MAX_GB_AMOUNT);
  const maxGb = resolveOptInt('maxGb', 1, MAX_GB_AMOUNT);
  const minDays = resolveOptInt('minDays', 1, MAX_DURATION_DAYS);
  const maxDays = resolveOptInt('maxDays', 1, MAX_DURATION_DAYS);
  const price = resolveOptInt('price', 0, MAX_PRICE);
  const pricePerGb = resolveOptInt('pricePerGb', 0, MAX_PRICE);
  const pricePerDay = resolveOptInt('pricePerDay', 0, MAX_PRICE);

  if (minGb !== undefined && maxGb !== undefined && minGb > maxGb) {
    throw new RouteValidationError(
      400,
      'INVALID_PRICE_OVERRIDE',
      'minGb cannot be greater than maxGb'
    );
  }
  if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
    throw new RouteValidationError(
      400,
      'INVALID_PRICE_OVERRIDE',
      'minDays cannot be greater than maxDays'
    );
  }
  if (price === undefined && pricePerGb === undefined && pricePerDay === undefined) {
    throw new RouteValidationError(
      400,
      'INVALID_PRICE_OVERRIDE',
      'Override must specify at least one of price, pricePerGb, or pricePerDay'
    );
  }

  return {
    ...(minGb !== undefined ? { minGb } : {}),
    ...(maxGb !== undefined ? { maxGb } : {}),
    ...(minDays !== undefined ? { minDays } : {}),
    ...(maxDays !== undefined ? { maxDays } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(pricePerGb !== undefined ? { pricePerGb } : {}),
    ...(pricePerDay !== undefined ? { pricePerDay } : {}),
  };
}

function buildUniqueCloneName(
  ts: TranslationService,
  sourceName: string,
  existing: readonly AdminPackageDto[]
): string {
  const defaultLocale = typeof ts.getDefaultLocale === 'function' ? ts.getDefaultLocale() : 'en';
  const copyWord = defaultLocale === 'fa' ? 'کپی' : 'Copy';

  for (let attempt = 1; attempt <= 999; attempt++) {
    const suffix = attempt === 1 ? copyWord : `${copyWord} ${attempt}`;
    const maxBaseChars = Math.max(1, MAX_PACKAGE_NAME_LENGTH - [...suffix].length - 1);
    const candidate = `${[...sourceName].slice(0, maxBaseChars).join('')} ${suffix}`.trim();
    if (!hasDuplicatePackageName(existing, candidate)) {
      return candidate;
    }
  }
  throw new RouteValidationError(
    409,
    'DUPLICATE_PACKAGE_NAME',
    'Could not generate a unique clone package name'
  );
}

function generateTierId(
  minGb: number,
  maxGb: number | undefined,
  existing: readonly VolumePricingTier[]
): string {
  const base = maxGb !== undefined ? `tier_${minGb}to${maxGb}gb` : `tier_${minGb}gb`;
  return makeUniqueId(
    base,
    existing.map((tier) => tier.id)
  );
}

function generateOverrideId(
  override: Omit<CustomPriceOverride, 'id'>,
  existing: readonly CustomPriceOverride[]
): string {
  const parts: string[] = ['ovr'];
  if (override.minGb !== undefined || override.maxGb !== undefined) {
    parts.push(`${override.minGb ?? 1}to${override.maxGb ?? 'max'}gb`);
  }
  if (override.minDays !== undefined || override.maxDays !== undefined) {
    parts.push(`${override.minDays ?? 1}to${override.maxDays ?? 'max'}d`);
  }
  if (parts.length === 1) parts.push('rule');
  const base = parts.join('_').slice(0, 48);
  return makeUniqueId(
    base,
    existing.map((ovr) => ovr.id)
  );
}

function makeUniqueId(base: string, existingIds: readonly string[]): string {
  const ids = new Set(existingIds);
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const candidate = `${base.slice(0, 56)}_${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new RouteValidationError(409, 'ID_SPACE_EXHAUSTED', 'Could not allocate unique rule ID');
}

// =============================================================================
// Primitive Validators & Error Handling
// =============================================================================

function assertBodyRecord(
  body: unknown,
  code = 'INVALID_REQUEST_BODY',
  message = 'Request body must be a JSON object'
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RouteValidationError(400, code, message);
  }
  return body as Record<string, unknown>;
}

function parsePackageParamId(raw: string): string {
  return parseStrictIdentifier(raw, 'INVALID_PACKAGE_ID', 'Package ID');
}

function parseCategoryParamId(raw: string): string {
  if (typeof raw !== 'string') {
    throw new RouteValidationError(400, 'INVALID_CATEGORY_ID', 'Category ID is required');
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CATEGORY_ID_LENGTH) {
    throw new RouteValidationError(
      400,
      'INVALID_CATEGORY_ID',
      `Category ID must be 1..${MAX_CATEGORY_ID_LENGTH} characters`
    );
  }
  return trimmed;
}

function parseStrictIdentifier(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string') {
    throw new RouteValidationError(400, code, `${label} must be a valid identifier string`);
  }
  const trimmed = value.trim();
  if (!PACKAGE_ID_PATTERN.test(trimmed)) {
    throw new RouteValidationError(400, code, `${label} must match /^[a-z0-9][a-z0-9_-]{0,63}$/`);
  }
  return trimmed;
}

function parseTrimmedString(
  value: unknown,
  maxLength: number,
  code: string,
  message: string
): string {
  if (typeof value !== 'string') {
    throw new RouteValidationError(400, code, message);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new RouteValidationError(400, code, message);
  }
  return trimmed;
}

function parseOptionalNullableText(
  value: unknown,
  maxLength: number,
  code: string,
  message: string
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new RouteValidationError(400, code, message);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new RouteValidationError(400, code, message);
  }
  return trimmed;
}

function parseSafeInt(
  value: unknown,
  min: number,
  max: number,
  code: string,
  message: string
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RouteValidationError(400, code, message);
  }
  return value;
}

function parseFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  code: string,
  message: string
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RouteValidationError(400, code, message);
  }
  return value;
}

function parseBooleanField(value: unknown, code: string, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RouteValidationError(400, code, `${fieldName} must be a boolean`);
  }
  return value;
}

function parseReorderIds(rawOrderedIds: unknown, existingIds: readonly string[]): string[] {
  if (!Array.isArray(rawOrderedIds)) {
    throw new RouteValidationError(
      400,
      'INVALID_REORDER_IDS',
      'orderedIds must be an array of IDs'
    );
  }
  if (rawOrderedIds.length !== existingIds.length) {
    throw new RouteValidationError(
      400,
      'INVALID_REORDER_IDS',
      'orderedIds must include every existing item exactly once'
    );
  }

  const existingSet = new Set(existingIds);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of rawOrderedIds) {
    if (typeof item !== 'string') {
      throw new RouteValidationError(
        400,
        'INVALID_REORDER_IDS',
        'Every entry in orderedIds must be a string'
      );
    }
    const id = item.trim();
    if (!id || seen.has(id) || !existingSet.has(id)) {
      throw new RouteValidationError(
        400,
        'INVALID_REORDER_IDS',
        'orderedIds must be a duplicate-free permutation of existing IDs'
      );
    }
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function handleRouteError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof RouteValidationError) {
    return reply.code(err.statusCode).send({
      error: err.message,
      code: err.code,
    });
  }
  if (err instanceof Error) {
    if (err.message === 'INVALID_CATEGORY_NAME') {
      return reply.code(400).send({
        error: 'Category name must be a non-empty string up to 100 characters',
        code: 'INVALID_CATEGORY_NAME',
      });
    }
  }
  throw err;
}
