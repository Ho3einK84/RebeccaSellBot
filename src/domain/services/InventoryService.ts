import crypto from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, type DbTransaction } from '../../infra/db.js';
import {
  inventoryReservations,
  packageInventory,
  rebeccaPanels,
  rebeccaPanelServices,
  userConfigs,
  type InventoryReservationKind,
  type InventoryReservationOperation,
} from '../../infra/schema.js';
import { resolveTehranDayStartUtc } from './PaymentService.js';
import {
  customVolumeDailyLimit,
  shopLowStockThreshold,
  trialDailyLimit,
  type SettingReader,
} from './FeatureSettings.js';
import type { PackageOption } from './PricingService.js';

export const TRIAL_INVENTORY_ID = '__trial__';
export const CUSTOM_VOLUME_INVENTORY_ID = '__custom_volume__';
export const MAX_INVENTORY_VALUE = 2_147_483_647;

export type InventoryUnavailableReason =
  | 'panel_disabled'
  | 'service_disabled'
  | 'panel_capacity_full'
  | 'service_capacity_full'
  | 'panel_out_of_stock'
  | 'service_out_of_stock'
  | 'panel_daily_limit_reached'
  | 'service_daily_limit_reached'
  | 'package_out_of_stock'
  | 'package_user_limit_reached'
  | 'trial_out_of_stock'
  | 'trial_daily_limit_reached'
  | 'custom_volume_out_of_stock'
  | 'custom_volume_daily_limit_reached';

export type InventoryErrorCode =
  | 'OUT_OF_STOCK'
  | 'CAPACITY_FULL'
  | 'DAILY_LIMIT_REACHED'
  | 'PACKAGE_USER_LIMIT_REACHED'
  | 'SERVICE_UNAVAILABLE';

export function mapInventoryReasonToCode(reason: InventoryUnavailableReason): InventoryErrorCode {
  switch (reason) {
    case 'panel_out_of_stock':
    case 'service_out_of_stock':
    case 'package_out_of_stock':
    case 'trial_out_of_stock':
    case 'custom_volume_out_of_stock':
      return 'OUT_OF_STOCK';
    case 'panel_capacity_full':
    case 'service_capacity_full':
      return 'CAPACITY_FULL';
    case 'panel_daily_limit_reached':
    case 'service_daily_limit_reached':
    case 'trial_daily_limit_reached':
    case 'custom_volume_daily_limit_reached':
      return 'DAILY_LIMIT_REACHED';
    case 'package_user_limit_reached':
      return 'PACKAGE_USER_LIMIT_REACHED';
    case 'panel_disabled':
    case 'service_disabled':
      return 'SERVICE_UNAVAILABLE';
  }
}

export class InventoryUnavailableError extends Error {
  readonly code: InventoryErrorCode;

  constructor(
    readonly reason: InventoryUnavailableReason,
    readonly details?: {
      panelId?: string;
      serviceId?: number;
      packageId?: string;
      limit?: number;
      current?: number;
    }
  ) {
    super(`INVENTORY_UNAVAILABLE:${reason}`);
    this.name = 'InventoryUnavailableError';
    this.code = mapInventoryReasonToCode(reason);
  }
}

export interface ServiceCapacitySnapshot {
  panelId: string;
  serviceId: number;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  activeConfigsCount: number;
  reservedCount: number;
  todayCreatedCount: number;
  maxConfigs: number | null;
  stockRemaining: number | null;
  dailyCreateLimit: number | null;
  remainingCapacity: number | null;
  utilizationPercent: number | null;
  isAvailableForCreate: boolean;
  unavailableReason: InventoryUnavailableReason | null;
}

export interface PanelCapacitySnapshot {
  panelId: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  activeConfigsCount: number;
  reservedCount: number;
  todayCreatedCount: number;
  maxConfigs: number | null;
  stockRemaining: number | null;
  dailyCreateLimit: number | null;
  remainingCapacity: number | null;
  utilizationPercent: number | null;
  isAvailableForCreate: boolean;
  unavailableReason: InventoryUnavailableReason | null;
  services: ServiceCapacitySnapshot[];
}

export interface FleetCapacitySummary {
  totalPanels: number;
  fullPanelsCount: number;
  lowCapacityPanelsCount: number;
  pausedServicesCount: number;
  fullServicesCount: number;
}

export interface FleetCapacitySnapshot {
  panels: PanelCapacitySnapshot[];
  summary: FleetCapacitySummary;
}

export interface PackageInventoryRecord {
  packageId: string;
  stockRemaining: number | null;
  reservedCount: number;
  soldCount: number;
  maxPurchasesPerUser: number | null;
  updatedAt: Date;
}

export interface PackageAvailabilitySnapshot {
  packageId: string;
  stockRemaining: number | null;
  reservedCount: number;
  soldCount: number;
  maxPurchasesPerUser: number | null;
  userPurchasedCount: number;
  userLimitReached: boolean;
  effectiveRemaining: number | null;
  renewalRemaining: number | null;
  available: boolean;
  renewalAvailable: boolean;
  lowStock: boolean;
  unavailableReason: InventoryUnavailableReason | null;
  renewalUnavailableReason: InventoryUnavailableReason | null;
}

export interface SpecialSkuAvailabilitySnapshot {
  skuId: typeof TRIAL_INVENTORY_ID | typeof CUSTOM_VOLUME_INVENTORY_ID;
  panelId: string | null;
  serviceId: number | null;
  stockRemaining: number | null;
  reservedCount: number;
  soldCount: number;
  dailyLimit: number | null;
  todayCreatedCount: number;
  effectiveRemaining: number | null;
  available: boolean;
  lowStock: boolean;
  unavailableReason: InventoryUnavailableReason | null;
}

export interface InventoryCheckParams {
  telegramId?: number;
  operationType: InventoryReservationOperation;
  panelId: string;
  serviceId: number;
  packageId?: string | null;
  now?: Date;
}

export interface InventoryReserveParams {
  kind: InventoryReservationKind;
  referenceId: string;
  telegramId: number;
  operationType: InventoryReservationOperation;
  panelId: string;
  serviceId: number;
  packageId?: string | null;
  now?: Date;
}

export function normalizeInventoryPackageId(packageId?: string | null): string | null {
  if (!packageId) return null;
  const trimmed = packageId.trim();
  if (!trimmed) return null;
  if (trimmed === TRIAL_INVENTORY_ID || trimmed === CUSTOM_VOLUME_INVENTORY_ID) {
    return trimmed;
  }
  if (/^custom_\d+gb_\d+d$/iu.test(trimmed)) {
    return CUSTOM_VOLUME_INVENTORY_ID;
  }
  return trimmed;
}

export function trialInventoryReferenceId(telegramId: number, configUsername: string): string {
  return `trial:${telegramId}:${configUsername}`;
}

export function validateOptionalInventoryInt(
  value: number | null | undefined,
  options: { min: number; max?: number; errorCode: string }
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const max = options.max ?? MAX_INVENTORY_VALUE;
  if (!Number.isSafeInteger(value) || value < options.min || value > max) {
    throw new Error(options.errorCode);
  }
  return value;
}

/**
 * Central inventory and creation-capacity engine covering Rebecca panels,
 * panel services, named packages, custom volume, and free trials.
 *
 * Deadlock-free lock order (always ascending):
 *   users -> inventory_reservations (existing) -> rebecca_panels -> rebecca_panel_services -> package_inventory
 */
export class InventoryService {
  constructor(private readonly settings?: Partial<SettingReader>) {}

  private getLowStockThreshold(): number {
    if (typeof this.settings?.getSetting === 'function') {
      return shopLowStockThreshold(this.settings as SettingReader);
    }
    return 5;
  }

  private getTrialDailyLimit(): number | null {
    if (typeof this.settings?.getSetting !== 'function') return null;
    const limit = trialDailyLimit(this.settings as SettingReader);
    return limit > 0 ? limit : null;
  }

  private getCustomVolumeDailyLimit(): number | null {
    if (typeof this.settings?.getSetting !== 'function') return null;
    const limit = customVolumeDailyLimit(this.settings as SettingReader);
    return limit > 0 ? limit : null;
  }

  /**
   * Bulk fleet capacity snapshot across all panels and services using 4 flat
   * queries (zero N+1 queries).
   */
  async getFleetCapacitySnapshot(now: Date = new Date()): Promise<FleetCapacitySnapshot> {
    const db = getDb();
    const dayStartUtc = resolveTehranDayStartUtc(now);
    const lowStockThreshold = this.getLowStockThreshold();

    const [panelRows, serviceRows, activeConfigRows, todayCreatedRows] = await Promise.all([
      db.select().from(rebeccaPanels),
      db.select().from(rebeccaPanelServices),
      db
        .select({
          panelId: userConfigs.panelId,
          serviceId: userConfigs.serviceId,
          count: sql<number>`count(*)::integer`,
        })
        .from(userConfigs)
        .where(sql`${userConfigs.panelStatus} IS DISTINCT FROM 'deleted'`)
        .groupBy(userConfigs.panelId, userConfigs.serviceId),
      db
        .select({
          panelId: inventoryReservations.panelId,
          serviceId: inventoryReservations.serviceId,
          count: sql<number>`count(*)::integer`,
        })
        .from(inventoryReservations)
        .where(
          and(
            inArray(inventoryReservations.status, ['reserved', 'committed']),
            inArray(inventoryReservations.operationType, ['new_config', 'trial']),
            gte(inventoryReservations.createdAt, dayStartUtc)
          )
        )
        .groupBy(inventoryReservations.panelId, inventoryReservations.serviceId),
    ]);

    const activeByPanel = new Map<string, number>();
    const activeByService = new Map<string, number>();
    for (const row of activeConfigRows) {
      const cnt = Number(row.count ?? 0);
      activeByPanel.set(row.panelId, (activeByPanel.get(row.panelId) ?? 0) + cnt);
      activeByService.set(serviceKey(row.panelId, row.serviceId), cnt);
    }

    const todayByPanel = new Map<string, number>();
    const todayByService = new Map<string, number>();
    for (const row of todayCreatedRows) {
      const cnt = Number(row.count ?? 0);
      todayByPanel.set(row.panelId, (todayByPanel.get(row.panelId) ?? 0) + cnt);
      todayByService.set(serviceKey(row.panelId, row.serviceId), cnt);
    }

    let fullPanelsCount = 0;
    let lowCapacityPanelsCount = 0;
    let pausedServicesCount = 0;
    let fullServicesCount = 0;

    const panels: PanelCapacitySnapshot[] = panelRows.map((panel) => {
      const panelActive = activeByPanel.get(panel.id) ?? 0;
      const panelReserved = Math.max(0, panel.reservedCreations ?? 0);
      const panelToday = todayByPanel.get(panel.id) ?? 0;
      const panelEval = evaluateCreationLimits({
        enabled: panel.enabled,
        disabledReason: 'panel_disabled',
        activeCount: panelActive,
        reservedCount: panelReserved,
        todayCount: panelToday,
        maxConfigs: panel.maxConfigs ?? null,
        capacityReason: 'panel_capacity_full',
        stockRemaining: panel.stockRemaining ?? null,
        stockReason: 'panel_out_of_stock',
        dailyLimit: panel.dailyCreateLimit ?? null,
        dailyReason: 'panel_daily_limit_reached',
      });

      if (panel.enabled && !panelEval.isAvailable) {
        fullPanelsCount += 1;
      } else if (
        panel.enabled &&
        ((panelEval.remainingCapacity !== null &&
          panelEval.remainingCapacity <= lowStockThreshold) ||
          (panelEval.utilizationPercent !== null && panelEval.utilizationPercent >= 85))
      ) {
        lowCapacityPanelsCount += 1;
      }

      const services: ServiceCapacitySnapshot[] = serviceRows
        .filter((service) => service.panelId === panel.id)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.serviceId - b.serviceId)
        .map((service) => {
          const sKey = serviceKey(panel.id, service.serviceId);
          const svcActive = activeByService.get(sKey) ?? 0;
          const svcReserved = Math.max(0, service.reservedCreations ?? 0);
          const svcToday = todayByService.get(sKey) ?? 0;
          const svcEval = evaluateCreationLimits({
            enabled: service.enabled ?? true,
            disabledReason: 'service_disabled',
            activeCount: svcActive,
            reservedCount: svcReserved,
            todayCount: svcToday,
            maxConfigs: service.maxConfigs ?? null,
            capacityReason: 'service_capacity_full',
            stockRemaining: service.stockRemaining ?? null,
            stockReason: 'service_out_of_stock',
            dailyLimit: service.dailyCreateLimit ?? null,
            dailyReason: 'service_daily_limit_reached',
          });

          if (!service.enabled) {
            pausedServicesCount += 1;
          } else if (!svcEval.isAvailable) {
            fullServicesCount += 1;
          }

          return {
            panelId: panel.id,
            serviceId: service.serviceId,
            name: service.name,
            enabled: service.enabled,
            isDefault: service.isDefault,
            activeConfigsCount: svcActive,
            reservedCount: svcReserved,
            todayCreatedCount: svcToday,
            maxConfigs: service.maxConfigs ?? null,
            stockRemaining: service.stockRemaining ?? null,
            dailyCreateLimit: service.dailyCreateLimit ?? null,
            remainingCapacity: svcEval.remainingCapacity,
            utilizationPercent: svcEval.utilizationPercent,
            isAvailableForCreate: svcEval.isAvailable,
            unavailableReason: svcEval.unavailableReason,
          };
        });

      return {
        panelId: panel.id,
        name: panel.name,
        enabled: panel.enabled,
        isDefault: panel.isDefault,
        activeConfigsCount: panelActive,
        reservedCount: panelReserved,
        todayCreatedCount: panelToday,
        maxConfigs: panel.maxConfigs ?? null,
        stockRemaining: panel.stockRemaining ?? null,
        dailyCreateLimit: panel.dailyCreateLimit ?? null,
        remainingCapacity: panelEval.remainingCapacity,
        utilizationPercent: panelEval.utilizationPercent,
        isAvailableForCreate: panelEval.isAvailable,
        unavailableReason: panelEval.unavailableReason,
        services,
      };
    });

    return {
      panels,
      summary: {
        totalPanels: panels.length,
        fullPanelsCount,
        lowCapacityPanelsCount,
        pausedServicesCount,
        fullServicesCount,
      },
    };
  }

  async getPackageInventoryRecords(
    packageIds?: readonly string[]
  ): Promise<Map<string, PackageInventoryRecord>> {
    const db = getDb();
    const rows =
      packageIds && packageIds.length > 0
        ? await db
            .select()
            .from(packageInventory)
            .where(inArray(packageInventory.packageId, [...new Set(packageIds)]))
        : await db.select().from(packageInventory);
    return new Map(
      rows.map((row) => [
        row.packageId,
        {
          packageId: row.packageId,
          stockRemaining: row.stockRemaining ?? null,
          reservedCount: row.reservedCount,
          soldCount: row.soldCount,
          maxPurchasesPerUser: row.maxPurchasesPerUser ?? null,
          updatedAt: row.updatedAt,
        },
      ])
    );
  }

  async getPackageInventoryRecord(packageId: string): Promise<PackageInventoryRecord> {
    const records = await this.getPackageInventoryRecords([packageId]);
    const existing = records.get(packageId);
    if (existing) return existing;
    return {
      packageId,
      stockRemaining: null,
      reservedCount: 0,
      soldCount: 0,
      maxPurchasesPerUser: null,
      updatedAt: new Date(0),
    };
  }

  /**
   * Compute full availability map for a list of packages, factoring in package
   * stock, per-user purchase limits, and target panel/service creation capacity.
   */
  async getPackagesAvailabilityMap(
    packages: readonly Pick<PackageOption, 'id' | 'panelId' | 'serviceId'>[],
    options?: {
      telegramId?: number;
      fleetSnapshot?: FleetCapacitySnapshot;
      now?: Date;
    }
  ): Promise<Map<string, PackageAvailabilitySnapshot>> {
    const result = new Map<string, PackageAvailabilitySnapshot>();
    if (packages.length === 0) return result;

    const now = options?.now ?? new Date();
    const lowStockThreshold = this.getLowStockThreshold();
    const packageIds = [...new Set(packages.map((pkg) => pkg.id))];

    const [fleet, records, userCounts] = await Promise.all([
      options?.fleetSnapshot
        ? Promise.resolve(options.fleetSnapshot)
        : this.getFleetCapacitySnapshot(now),
      this.getPackageInventoryRecords(packageIds),
      options?.telegramId
        ? this.getUserPackagePurchaseCounts(options.telegramId, packageIds)
        : Promise.resolve(new Map<string, number>()),
    ]);

    const panelById = new Map(fleet.panels.map((p) => [p.panelId, p]));
    const defaultPanel =
      fleet.panels.find((p) => p.isDefault && p.enabled) ??
      fleet.panels.find((p) => p.enabled) ??
      fleet.panels[0];

    for (const pkg of packages) {
      const rec = records.get(pkg.id);
      const stockRemaining = rec?.stockRemaining ?? null;
      const reservedCount = rec?.reservedCount ?? 0;
      const soldCount = rec?.soldCount ?? 0;
      const maxPurchasesPerUser = rec?.maxPurchasesPerUser ?? null;
      const userPurchasedCount = userCounts.get(pkg.id) ?? 0;
      const userRemaining =
        maxPurchasesPerUser !== null ? Math.max(0, maxPurchasesPerUser - userPurchasedCount) : null;
      const userLimitReached =
        maxPurchasesPerUser !== null && userPurchasedCount >= maxPurchasesPerUser;

      // Renewal availability depends strictly on package stock & per-user limit
      let renewalUnavailableReason: InventoryUnavailableReason | null = null;
      if (stockRemaining !== null && stockRemaining <= 0) {
        renewalUnavailableReason = 'package_out_of_stock';
      } else if (userLimitReached) {
        renewalUnavailableReason = 'package_user_limit_reached';
      }
      const renewalRemaining = minNullable(stockRemaining, userRemaining);
      const renewalAvailable = renewalUnavailableReason === null;

      // New creation availability additionally depends on target panel & service capacity
      const targetPanel = pkg.panelId ? panelById.get(pkg.panelId) : defaultPanel;
      const targetService = targetPanel
        ? pkg.serviceId !== undefined
          ? targetPanel.services.find((s) => s.serviceId === pkg.serviceId)
          : (targetPanel.services.find((s) => s.isDefault) ?? targetPanel.services[0])
        : undefined;

      let unavailableReason: InventoryUnavailableReason | null = null;
      if (targetPanel && !targetPanel.isAvailableForCreate) {
        unavailableReason = targetPanel.unavailableReason;
      } else if (targetService && !targetService.isAvailableForCreate) {
        unavailableReason = targetService.unavailableReason;
      } else if (renewalUnavailableReason) {
        unavailableReason = renewalUnavailableReason;
      }

      const effectiveRemaining =
        unavailableReason !== null
          ? 0
          : minNullable(
              renewalRemaining,
              targetPanel?.remainingCapacity ?? null,
              targetService?.remainingCapacity ?? null
            );

      const available = unavailableReason === null;
      const lowStock =
        available &&
        effectiveRemaining !== null &&
        effectiveRemaining > 0 &&
        effectiveRemaining <= lowStockThreshold;

      result.set(pkg.id, {
        packageId: pkg.id,
        stockRemaining,
        reservedCount,
        soldCount,
        maxPurchasesPerUser,
        userPurchasedCount,
        userLimitReached,
        effectiveRemaining,
        renewalRemaining: renewalAvailable ? renewalRemaining : 0,
        available,
        renewalAvailable,
        lowStock,
        unavailableReason,
        renewalUnavailableReason,
      });
    }

    return result;
  }

  async getCustomVolumeAvailability(
    target?: { panelId?: string; serviceId?: number },
    options?: { fleetSnapshot?: FleetCapacitySnapshot; now?: Date }
  ): Promise<SpecialSkuAvailabilitySnapshot> {
    return this.getSpecialSkuAvailability(CUSTOM_VOLUME_INVENTORY_ID, target, options);
  }

  async getTrialAvailability(
    target?: { panelId?: string; serviceId?: number },
    options?: { fleetSnapshot?: FleetCapacitySnapshot; now?: Date }
  ): Promise<SpecialSkuAvailabilitySnapshot> {
    return this.getSpecialSkuAvailability(TRIAL_INVENTORY_ID, target, options);
  }

  private async getSpecialSkuAvailability(
    skuId: typeof TRIAL_INVENTORY_ID | typeof CUSTOM_VOLUME_INVENTORY_ID,
    target?: { panelId?: string; serviceId?: number },
    options?: { fleetSnapshot?: FleetCapacitySnapshot; now?: Date }
  ): Promise<SpecialSkuAvailabilitySnapshot> {
    const now = options?.now ?? new Date();
    const dayStartUtc = resolveTehranDayStartUtc(now);
    const lowStockThreshold = this.getLowStockThreshold();
    const dailyLimit =
      skuId === TRIAL_INVENTORY_ID ? this.getTrialDailyLimit() : this.getCustomVolumeDailyLimit();

    const [fleet, record, todayRow] = await Promise.all([
      options?.fleetSnapshot
        ? Promise.resolve(options.fleetSnapshot)
        : this.getFleetCapacitySnapshot(now),
      this.getPackageInventoryRecord(skuId),
      getDb()
        .select({ count: sql<number>`count(*)::integer` })
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.packageId, skuId),
            inArray(inventoryReservations.status, ['reserved', 'committed']),
            inArray(inventoryReservations.operationType, ['new_config', 'trial']),
            gte(inventoryReservations.createdAt, dayStartUtc)
          )
        ),
    ]);

    const todayCreatedCount = Number(todayRow[0]?.count ?? 0);
    const targetPanel = target?.panelId
      ? fleet.panels.find((p) => p.panelId === target.panelId)
      : (fleet.panels.find((p) => p.isDefault && p.enabled) ??
        fleet.panels.find((p) => p.enabled) ??
        fleet.panels[0]);
    const targetService = targetPanel
      ? target?.serviceId !== undefined
        ? targetPanel.services.find((s) => s.serviceId === target.serviceId)
        : (targetPanel.services.find((s) => s.isDefault) ?? targetPanel.services[0])
      : undefined;

    const stockRemaining = record.stockRemaining;
    const dailyRemaining = dailyLimit !== null ? Math.max(0, dailyLimit - todayCreatedCount) : null;

    let unavailableReason: InventoryUnavailableReason | null = null;
    if (targetPanel && !targetPanel.isAvailableForCreate) {
      unavailableReason = targetPanel.unavailableReason;
    } else if (targetService && !targetService.isAvailableForCreate) {
      unavailableReason = targetService.unavailableReason;
    } else if (stockRemaining !== null && stockRemaining <= 0) {
      unavailableReason =
        skuId === TRIAL_INVENTORY_ID ? 'trial_out_of_stock' : 'custom_volume_out_of_stock';
    } else if (dailyLimit !== null && todayCreatedCount >= dailyLimit) {
      unavailableReason =
        skuId === TRIAL_INVENTORY_ID
          ? 'trial_daily_limit_reached'
          : 'custom_volume_daily_limit_reached';
    }

    const effectiveRemaining =
      unavailableReason !== null
        ? 0
        : minNullable(
            stockRemaining,
            dailyRemaining,
            targetPanel?.remainingCapacity ?? null,
            targetService?.remainingCapacity ?? null
          );
    const available = unavailableReason === null;
    const lowStock =
      available &&
      effectiveRemaining !== null &&
      effectiveRemaining > 0 &&
      effectiveRemaining <= lowStockThreshold;

    return {
      skuId,
      panelId: targetPanel?.panelId ?? null,
      serviceId: targetService?.serviceId ?? null,
      stockRemaining,
      reservedCount: record.reservedCount,
      soldCount: record.soldCount,
      dailyLimit,
      todayCreatedCount,
      effectiveRemaining,
      available,
      lowStock,
      unavailableReason,
    };
  }

  /**
   * Non-locking pre-flight availability check used before creating a checkout
   * session so sold-out items fail fast without locking inventory prematurely.
   */
  async assertCheckoutAvailability(params: InventoryCheckParams): Promise<void> {
    const now = params.now ?? new Date();
    const normalizedPkgId = normalizeInventoryPackageId(params.packageId);
    const isNewCreation = params.operationType !== 'renew_config';

    if (isNewCreation) {
      const fleet = await this.getFleetCapacitySnapshot(now);
      const panel = fleet.panels.find((p) => p.panelId === params.panelId);
      if (panel && !panel.isAvailableForCreate && panel.unavailableReason) {
        throw new InventoryUnavailableError(panel.unavailableReason, {
          panelId: params.panelId,
          serviceId: params.serviceId,
        });
      }
      const service = panel?.services.find((s) => s.serviceId === params.serviceId);
      if (service && !service.isAvailableForCreate && service.unavailableReason) {
        throw new InventoryUnavailableError(service.unavailableReason, {
          panelId: params.panelId,
          serviceId: params.serviceId,
        });
      }
    }

    if (!normalizedPkgId) return;

    const isSpecialSku =
      normalizedPkgId === TRIAL_INVENTORY_ID || normalizedPkgId === CUSTOM_VOLUME_INVENTORY_ID;
    // Custom volume creation limits do not gate existing subscription renewals.
    if (params.operationType === 'renew_config' && isSpecialSku) {
      return;
    }

    const record = await this.getPackageInventoryRecord(normalizedPkgId);
    if (record.stockRemaining !== null && record.stockRemaining <= 0) {
      const reason: InventoryUnavailableReason =
        normalizedPkgId === TRIAL_INVENTORY_ID
          ? 'trial_out_of_stock'
          : normalizedPkgId === CUSTOM_VOLUME_INVENTORY_ID
            ? 'custom_volume_out_of_stock'
            : 'package_out_of_stock';
      throw new InventoryUnavailableError(reason, {
        panelId: params.panelId,
        serviceId: params.serviceId,
        packageId: normalizedPkgId,
      });
    }

    if (isSpecialSku) {
      const dailyLimit =
        normalizedPkgId === TRIAL_INVENTORY_ID
          ? this.getTrialDailyLimit()
          : this.getCustomVolumeDailyLimit();
      if (dailyLimit !== null) {
        const dayStartUtc = resolveTehranDayStartUtc(now);
        const [todayRow] = await getDb()
          .select({ count: sql<number>`count(*)::integer` })
          .from(inventoryReservations)
          .where(
            and(
              eq(inventoryReservations.packageId, normalizedPkgId),
              inArray(inventoryReservations.status, ['reserved', 'committed']),
              inArray(inventoryReservations.operationType, ['new_config', 'trial']),
              gte(inventoryReservations.createdAt, dayStartUtc)
            )
          );
        const todayCount = Number(todayRow?.count ?? 0);
        if (todayCount >= dailyLimit) {
          throw new InventoryUnavailableError(
            normalizedPkgId === TRIAL_INVENTORY_ID
              ? 'trial_daily_limit_reached'
              : 'custom_volume_daily_limit_reached',
            {
              panelId: params.panelId,
              serviceId: params.serviceId,
              packageId: normalizedPkgId,
              limit: dailyLimit,
              current: todayCount,
            }
          );
        }
      }
    }

    if (params.telegramId && record.maxPurchasesPerUser !== null && !isSpecialSku) {
      const counts = await this.getUserPackagePurchaseCounts(params.telegramId, [normalizedPkgId]);
      const userCount = counts.get(normalizedPkgId) ?? 0;
      if (userCount >= record.maxPurchasesPerUser) {
        throw new InventoryUnavailableError('package_user_limit_reached', {
          panelId: params.panelId,
          serviceId: params.serviceId,
          packageId: normalizedPkgId,
          limit: record.maxPurchasesPerUser,
          current: userCount,
        });
      }
    }
  }

  /**
   * Atomically lock and reserve capacity/stock inside a caller-managed saga
   * transaction. Acquires FOR UPDATE locks strictly in canonical order:
   *   rebecca_panels -> rebecca_panel_services -> package_inventory
   */
  async reserveInTransaction(tx: DbTransaction, params: InventoryReserveParams): Promise<void> {
    const now = params.now ?? new Date();
    const dayStartUtc = resolveTehranDayStartUtc(now);
    const isNewCreation = params.operationType !== 'renew_config';
    const normalizedPkgId = normalizeInventoryPackageId(params.packageId);
    const isSpecialSku =
      normalizedPkgId === TRIAL_INVENTORY_ID || normalizedPkgId === CUSTOM_VOLUME_INVENTORY_ID;
    const enforcePackageInventory =
      normalizedPkgId !== null && !(params.operationType === 'renew_config' && isSpecialSku);

    let creationReserved = false;
    let panelStockConsumed = false;
    let serviceStockConsumed = false;
    let packageReserved = false;
    let packageStockConsumed = false;

    if (isNewCreation) {
      // 1. Lock panel row FOR NO KEY UPDATE (mutually exclusive with concurrent
      // reservations/updates while compatible with FK FOR KEY SHARE locks taken
      // by INSERT INTO purchase_intents / trial_claims / user_configs).
      const [panel] = await tx
        .select()
        .from(rebeccaPanels)
        .where(eq(rebeccaPanels.id, params.panelId))
        .for('no key update')
        .limit(1);
      if (!panel || !panel.enabled) {
        throw new InventoryUnavailableError('panel_disabled', {
          panelId: params.panelId,
          serviceId: params.serviceId,
        });
      }

      if (panel.maxConfigs !== null) {
        const [activeRow] = await tx
          .select({ count: sql<number>`count(*)::integer` })
          .from(userConfigs)
          .where(
            and(
              eq(userConfigs.panelId, params.panelId),
              sql`${userConfigs.panelStatus} IS DISTINCT FROM 'deleted'`
            )
          );
        const occupied = Number(activeRow?.count ?? 0) + Math.max(0, panel.reservedCreations ?? 0);
        if (occupied >= panel.maxConfigs) {
          throw new InventoryUnavailableError('panel_capacity_full', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: panel.maxConfigs,
            current: occupied,
          });
        }
      }

      if (panel.stockRemaining !== null) {
        if (panel.stockRemaining <= 0) {
          throw new InventoryUnavailableError('panel_out_of_stock', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: 0,
            current: 0,
          });
        }
        panelStockConsumed = true;
      }

      if (panel.dailyCreateLimit !== null) {
        const [todayRow] = await tx
          .select({ count: sql<number>`count(*)::integer` })
          .from(inventoryReservations)
          .where(
            and(
              eq(inventoryReservations.panelId, params.panelId),
              inArray(inventoryReservations.status, ['reserved', 'committed']),
              inArray(inventoryReservations.operationType, ['new_config', 'trial']),
              gte(inventoryReservations.createdAt, dayStartUtc)
            )
          );
        const todayCount = Number(todayRow?.count ?? 0);
        if (todayCount >= panel.dailyCreateLimit) {
          throw new InventoryUnavailableError('panel_daily_limit_reached', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: panel.dailyCreateLimit,
            current: todayCount,
          });
        }
      }

      // 2. Lock service row FOR NO KEY UPDATE
      const [service] = await tx
        .select()
        .from(rebeccaPanelServices)
        .where(
          and(
            eq(rebeccaPanelServices.panelId, params.panelId),
            eq(rebeccaPanelServices.serviceId, params.serviceId)
          )
        )
        .for('no key update')
        .limit(1);
      if (!service || !service.enabled) {
        throw new InventoryUnavailableError('service_disabled', {
          panelId: params.panelId,
          serviceId: params.serviceId,
        });
      }

      if (service.maxConfigs !== null) {
        const [activeRow] = await tx
          .select({ count: sql<number>`count(*)::integer` })
          .from(userConfigs)
          .where(
            and(
              eq(userConfigs.panelId, params.panelId),
              eq(userConfigs.serviceId, params.serviceId),
              sql`${userConfigs.panelStatus} IS DISTINCT FROM 'deleted'`
            )
          );
        const occupied =
          Number(activeRow?.count ?? 0) + Math.max(0, service.reservedCreations ?? 0);
        if (occupied >= service.maxConfigs) {
          throw new InventoryUnavailableError('service_capacity_full', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: service.maxConfigs,
            current: occupied,
          });
        }
      }

      if (service.stockRemaining !== null) {
        if (service.stockRemaining <= 0) {
          throw new InventoryUnavailableError('service_out_of_stock', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: 0,
            current: 0,
          });
        }
        serviceStockConsumed = true;
      }

      if (service.dailyCreateLimit !== null) {
        const [todayRow] = await tx
          .select({ count: sql<number>`count(*)::integer` })
          .from(inventoryReservations)
          .where(
            and(
              eq(inventoryReservations.panelId, params.panelId),
              eq(inventoryReservations.serviceId, params.serviceId),
              inArray(inventoryReservations.status, ['reserved', 'committed']),
              inArray(inventoryReservations.operationType, ['new_config', 'trial']),
              gte(inventoryReservations.createdAt, dayStartUtc)
            )
          );
        const todayCount = Number(todayRow?.count ?? 0);
        if (todayCount >= service.dailyCreateLimit) {
          throw new InventoryUnavailableError('service_daily_limit_reached', {
            panelId: params.panelId,
            serviceId: params.serviceId,
            limit: service.dailyCreateLimit,
            current: todayCount,
          });
        }
      }

      // Apply panel & service reservations
      await tx
        .update(rebeccaPanels)
        .set({
          reservedCreations: sql`${rebeccaPanels.reservedCreations} + 1`,
          ...(panelStockConsumed
            ? { stockRemaining: sql`${rebeccaPanels.stockRemaining} - 1` }
            : {}),
          updatedAt: now,
        })
        .where(eq(rebeccaPanels.id, params.panelId));

      await tx
        .update(rebeccaPanelServices)
        .set({
          reservedCreations: sql`${rebeccaPanelServices.reservedCreations} + 1`,
          ...(serviceStockConsumed
            ? { stockRemaining: sql`${rebeccaPanelServices.stockRemaining} - 1` }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(rebeccaPanelServices.panelId, params.panelId),
            eq(rebeccaPanelServices.serviceId, params.serviceId)
          )
        );

      creationReserved = true;
    }

    // 3. Ensure & lock package_inventory row FOR UPDATE (always 3rd in canonical order)
    if (enforcePackageInventory && normalizedPkgId) {
      await tx
        .insert(packageInventory)
        .values({ packageId: normalizedPkgId, updatedAt: now })
        .onConflictDoNothing();

      const [pkgRow] = await tx
        .select()
        .from(packageInventory)
        .where(eq(packageInventory.packageId, normalizedPkgId))
        .for('no key update')
        .limit(1);

      if (pkgRow) {
        if (pkgRow.stockRemaining !== null) {
          if (pkgRow.stockRemaining <= 0) {
            const reason: InventoryUnavailableReason =
              normalizedPkgId === TRIAL_INVENTORY_ID
                ? 'trial_out_of_stock'
                : normalizedPkgId === CUSTOM_VOLUME_INVENTORY_ID
                  ? 'custom_volume_out_of_stock'
                  : 'package_out_of_stock';
            throw new InventoryUnavailableError(reason, {
              panelId: params.panelId,
              serviceId: params.serviceId,
              packageId: normalizedPkgId,
            });
          }
          packageStockConsumed = true;
        }

        if (isSpecialSku) {
          const dailyLimit =
            normalizedPkgId === TRIAL_INVENTORY_ID
              ? this.getTrialDailyLimit()
              : this.getCustomVolumeDailyLimit();
          if (dailyLimit !== null) {
            const [todayRow] = await tx
              .select({ count: sql<number>`count(*)::integer` })
              .from(inventoryReservations)
              .where(
                and(
                  eq(inventoryReservations.packageId, normalizedPkgId),
                  inArray(inventoryReservations.status, ['reserved', 'committed']),
                  inArray(inventoryReservations.operationType, ['new_config', 'trial']),
                  gte(inventoryReservations.createdAt, dayStartUtc)
                )
              );
            const todayCount = Number(todayRow?.count ?? 0);
            if (todayCount >= dailyLimit) {
              throw new InventoryUnavailableError(
                normalizedPkgId === TRIAL_INVENTORY_ID
                  ? 'trial_daily_limit_reached'
                  : 'custom_volume_daily_limit_reached',
                {
                  panelId: params.panelId,
                  serviceId: params.serviceId,
                  packageId: normalizedPkgId,
                  limit: dailyLimit,
                  current: todayCount,
                }
              );
            }
          }
        } else if (pkgRow.maxPurchasesPerUser !== null) {
          const [userCountRow] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(inventoryReservations)
            .where(
              and(
                eq(inventoryReservations.telegramId, params.telegramId),
                eq(inventoryReservations.packageId, normalizedPkgId),
                inArray(inventoryReservations.status, ['reserved', 'committed'])
              )
            );
          const userCount = Number(userCountRow?.count ?? 0);
          if (userCount >= pkgRow.maxPurchasesPerUser) {
            throw new InventoryUnavailableError('package_user_limit_reached', {
              panelId: params.panelId,
              serviceId: params.serviceId,
              packageId: normalizedPkgId,
              limit: pkgRow.maxPurchasesPerUser,
              current: userCount,
            });
          }
        }

        await tx
          .update(packageInventory)
          .set({
            reservedCount: sql`${packageInventory.reservedCount} + 1`,
            ...(packageStockConsumed
              ? { stockRemaining: sql`${packageInventory.stockRemaining} - 1` }
              : {}),
            updatedAt: now,
          })
          .where(eq(packageInventory.packageId, normalizedPkgId));

        packageReserved = true;
      }
    }

    if (!creationReserved && !packageReserved) {
      return;
    }

    const reservationId = `ir_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await tx.insert(inventoryReservations).values({
      id: reservationId,
      kind: params.kind,
      referenceId: params.referenceId,
      telegramId: params.telegramId,
      operationType: params.operationType,
      panelId: params.panelId,
      serviceId: params.serviceId,
      packageId: enforcePackageInventory ? normalizedPkgId : null,
      creationReserved,
      panelStockConsumed,
      serviceStockConsumed,
      packageReserved,
      packageStockConsumed,
      status: 'reserved',
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Finalize an in-flight reservation inside Phase 3 / reconciliation commit.
   * Idempotent: returns safely if no reservation exists or if already settled.
   */
  async commitInTransaction(tx: DbTransaction, referenceId: string): Promise<boolean> {
    const now = new Date();
    const [res] = await tx
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.referenceId, referenceId))
      .for('no key update')
      .limit(1);
    if (!res || res.status !== 'reserved') return false;

    await tx
      .update(inventoryReservations)
      .set({ status: 'committed', updatedAt: now })
      .where(eq(inventoryReservations.id, res.id));

    if (res.creationReserved) {
      await tx
        .update(rebeccaPanels)
        .set({
          reservedCreations: sql`GREATEST(0, ${rebeccaPanels.reservedCreations} - 1)`,
          updatedAt: now,
        })
        .where(eq(rebeccaPanels.id, res.panelId));

      await tx
        .update(rebeccaPanelServices)
        .set({
          reservedCreations: sql`GREATEST(0, ${rebeccaPanelServices.reservedCreations} - 1)`,
          updatedAt: now,
        })
        .where(
          and(
            eq(rebeccaPanelServices.panelId, res.panelId),
            eq(rebeccaPanelServices.serviceId, res.serviceId)
          )
        );
    }

    if (res.packageReserved && res.packageId) {
      await tx
        .update(packageInventory)
        .set({
          reservedCount: sql`GREATEST(0, ${packageInventory.reservedCount} - 1)`,
          soldCount: sql`${packageInventory.soldCount} + 1`,
          updatedAt: now,
        })
        .where(eq(packageInventory.packageId, res.packageId));
    }

    return true;
  }

  /**
   * Release an in-flight reservation upon panel failure, compensation, or
   * reconciler-confirmed absence. Restores exact snapshotted stock consumption.
   */
  async releaseInTransaction(tx: DbTransaction, referenceId: string): Promise<boolean> {
    const now = new Date();
    const [res] = await tx
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.referenceId, referenceId))
      .for('no key update')
      .limit(1);
    if (!res || res.status !== 'reserved') return false;

    await tx
      .update(inventoryReservations)
      .set({ status: 'released', updatedAt: now })
      .where(eq(inventoryReservations.id, res.id));

    if (res.creationReserved) {
      await tx
        .update(rebeccaPanels)
        .set({
          reservedCreations: sql`GREATEST(0, ${rebeccaPanels.reservedCreations} - 1)`,
          ...(res.panelStockConsumed
            ? {
                stockRemaining: sql`CASE WHEN ${rebeccaPanels.stockRemaining} IS NOT NULL THEN ${rebeccaPanels.stockRemaining} + 1 ELSE NULL END`,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(rebeccaPanels.id, res.panelId));

      await tx
        .update(rebeccaPanelServices)
        .set({
          reservedCreations: sql`GREATEST(0, ${rebeccaPanelServices.reservedCreations} - 1)`,
          ...(res.serviceStockConsumed
            ? {
                stockRemaining: sql`CASE WHEN ${rebeccaPanelServices.stockRemaining} IS NOT NULL THEN ${rebeccaPanelServices.stockRemaining} + 1 ELSE NULL END`,
              }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(rebeccaPanelServices.panelId, res.panelId),
            eq(rebeccaPanelServices.serviceId, res.serviceId)
          )
        );
    }

    if (res.packageReserved && res.packageId) {
      await tx
        .update(packageInventory)
        .set({
          reservedCount: sql`GREATEST(0, ${packageInventory.reservedCount} - 1)`,
          ...(res.packageStockConsumed
            ? {
                stockRemaining: sql`CASE WHEN ${packageInventory.stockRemaining} IS NOT NULL THEN ${packageInventory.stockRemaining} + 1 ELSE NULL END`,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(packageInventory.packageId, res.packageId));
    }

    return true;
  }

  /**
   * Restore consumed stock and decrement sold count when an unused subscription
   * is fully refunded and deleted.
   */
  async restoreOnRefundInTransaction(
    tx: DbTransaction,
    purchaseIntentId: string
  ): Promise<boolean> {
    const now = new Date();
    const [res] = await tx
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.referenceId, purchaseIntentId))
      .for('no key update')
      .limit(1);
    if (!res || res.status !== 'committed') return false;

    await tx
      .update(inventoryReservations)
      .set({ status: 'refunded', updatedAt: now })
      .where(eq(inventoryReservations.id, res.id));

    if (res.panelStockConsumed) {
      await tx
        .update(rebeccaPanels)
        .set({
          stockRemaining: sql`CASE WHEN ${rebeccaPanels.stockRemaining} IS NOT NULL THEN ${rebeccaPanels.stockRemaining} + 1 ELSE NULL END`,
          updatedAt: now,
        })
        .where(eq(rebeccaPanels.id, res.panelId));
    }

    if (res.serviceStockConsumed) {
      await tx
        .update(rebeccaPanelServices)
        .set({
          stockRemaining: sql`CASE WHEN ${rebeccaPanelServices.stockRemaining} IS NOT NULL THEN ${rebeccaPanelServices.stockRemaining} + 1 ELSE NULL END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(rebeccaPanelServices.panelId, res.panelId),
            eq(rebeccaPanelServices.serviceId, res.serviceId)
          )
        );
    }

    if (res.packageId) {
      await tx
        .update(packageInventory)
        .set({
          soldCount: sql`GREATEST(0, ${packageInventory.soldCount} - 1)`,
          ...(res.packageStockConsumed
            ? {
                stockRemaining: sql`CASE WHEN ${packageInventory.stockRemaining} IS NOT NULL THEN ${packageInventory.stockRemaining} + 1 ELSE NULL END`,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(packageInventory.packageId, res.packageId));
    }

    return true;
  }

  /**
   * Admin mutation: upsert stock and/or per-user purchase ceiling for a package
   * or special SKU (`__trial__` / `__custom_volume__`).
   */
  async setPackageInventory(
    packageId: string,
    changes: {
      stockRemaining?: number | null;
      maxPurchasesPerUser?: number | null;
    }
  ): Promise<PackageInventoryRecord> {
    const normalizedId = packageId.trim();
    if (!normalizedId || normalizedId.length > 80) {
      throw new Error('PACKAGE_INVENTORY_ID_INVALID');
    }
    const stockRemaining = validateOptionalInventoryInt(changes.stockRemaining, {
      min: 0,
      errorCode: 'PACKAGE_STOCK_INVALID',
    });
    const maxPurchasesPerUser = validateOptionalInventoryInt(changes.maxPurchasesPerUser, {
      min: 1,
      errorCode: 'PACKAGE_USER_LIMIT_INVALID',
    });

    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(packageInventory)
      .values({
        packageId: normalizedId,
        stockRemaining: stockRemaining === undefined ? null : stockRemaining,
        maxPurchasesPerUser: maxPurchasesPerUser === undefined ? null : maxPurchasesPerUser,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: packageInventory.packageId,
        set: {
          ...(stockRemaining !== undefined ? { stockRemaining } : {}),
          ...(maxPurchasesPerUser !== undefined ? { maxPurchasesPerUser } : {}),
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error('PACKAGE_INVENTORY_UPDATE_FAILED');
    return {
      packageId: row.packageId,
      stockRemaining: row.stockRemaining ?? null,
      reservedCount: row.reservedCount,
      soldCount: row.soldCount,
      maxPurchasesPerUser: row.maxPurchasesPerUser ?? null,
      updatedAt: row.updatedAt,
    };
  }

  async deletePackageInventory(packageId: string): Promise<void> {
    const normalizedId = packageId.trim();
    if (!normalizedId) return;
    await getDb().delete(packageInventory).where(eq(packageInventory.packageId, normalizedId));
  }

  private async getUserPackagePurchaseCounts(
    telegramId: number,
    packageIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (packageIds.length === 0) return new Map();
    const rows = await getDb()
      .select({
        packageId: inventoryReservations.packageId,
        count: sql<number>`count(*)::integer`,
      })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.telegramId, telegramId),
          inArray(inventoryReservations.packageId, [...packageIds]),
          inArray(inventoryReservations.status, ['reserved', 'committed'])
        )
      )
      .groupBy(inventoryReservations.packageId);

    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.packageId) {
        map.set(row.packageId, Number(row.count ?? 0));
      }
    }
    return map;
  }
}

function serviceKey(panelId: string, serviceId: number): string {
  return `${panelId}:${serviceId}`;
}

function minNullable(...values: Array<number | null>): number | null {
  let result: number | null = null;
  for (const val of values) {
    if (val === null) continue;
    result = result === null ? val : Math.min(result, val);
  }
  return result;
}

function evaluateCreationLimits(params: {
  enabled: boolean;
  disabledReason: InventoryUnavailableReason;
  activeCount: number;
  reservedCount: number;
  todayCount: number;
  maxConfigs: number | null;
  capacityReason: InventoryUnavailableReason;
  stockRemaining: number | null;
  stockReason: InventoryUnavailableReason;
  dailyLimit: number | null;
  dailyReason: InventoryUnavailableReason;
}): {
  remainingCapacity: number | null;
  utilizationPercent: number | null;
  isAvailable: boolean;
  unavailableReason: InventoryUnavailableReason | null;
} {
  const occupied = params.activeCount + params.reservedCount;
  const utilizationPercent =
    params.maxConfigs === null
      ? null
      : params.maxConfigs === 0
        ? 100
        : Math.min(100, Math.round((occupied / params.maxConfigs) * 100));

  let unavailableReason: InventoryUnavailableReason | null = null;
  if (!params.enabled) {
    unavailableReason = params.disabledReason;
  } else if (params.maxConfigs !== null && occupied >= params.maxConfigs) {
    unavailableReason = params.capacityReason;
  } else if (params.stockRemaining !== null && params.stockRemaining <= 0) {
    unavailableReason = params.stockReason;
  } else if (params.dailyLimit !== null && params.todayCount >= params.dailyLimit) {
    unavailableReason = params.dailyReason;
  }

  const remainingSlots =
    params.maxConfigs !== null ? Math.max(0, params.maxConfigs - occupied) : null;
  const remainingDaily =
    params.dailyLimit !== null ? Math.max(0, params.dailyLimit - params.todayCount) : null;
  const remainingCapacity =
    unavailableReason !== null
      ? 0
      : minNullable(remainingSlots, params.stockRemaining, remainingDaily);

  return {
    remainingCapacity,
    utilizationPercent,
    isAvailable: unavailableReason === null,
    unavailableReason,
  };
}
