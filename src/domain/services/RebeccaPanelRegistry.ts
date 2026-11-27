import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { CredentialCipher } from '../../infra/CredentialCipher.js';
import { RebeccaApiClient } from '../../infra/RebeccaApiClient.js';
import { validateRebeccaBaseUrl } from '../../infra/rebeccaBaseUrl.js';
import {
  purchaseIntents,
  purchaseCheckouts,
  notificationDeliveries,
  configReconciliationIssues,
  rebeccaPanels,
  rebeccaPanelServices,
  refundIntents,
  trialClaims,
  userConfigs,
  settings,
} from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import { RebeccaService } from './RebeccaService.js';
import type { TranslationService } from './TranslationService.js';

export const LEGACY_PANEL_ID = 'legacy';
const MAX_SERVICE_ID = 2_147_483_647;

export class RebeccaPanelNotConfiguredError extends Error {
  constructor(readonly panelId?: string) {
    super('REBECCA_PANEL_NOT_CONFIGURED');
    this.name = 'RebeccaPanelNotConfiguredError';
  }
}

export class RebeccaPanelInUseError extends Error {
  constructor(readonly panelId: string) {
    super('REBECCA_PANEL_IN_USE');
    this.name = 'RebeccaPanelInUseError';
  }
}

export type LegacyRebeccaBootstrap = {
  baseUrl?: string;
  apiKey?: string;
  adminUsername?: string;
  adminPassword?: string;
  serviceId: number;
};

export type RebeccaPanelSummary = {
  id: string;
  name: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  credentialMode: 'api_key' | 'password' | 'none';
  maxConfigs: number | null;
  stockRemaining: number | null;
  dailyCreateLimit: number | null;
  services: RebeccaPanelServiceSummary[];
};

export type RebeccaPanelServiceSummary = {
  serviceId: number;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  maxConfigs: number | null;
  stockRemaining: number | null;
  dailyCreateLimit: number | null;
};

export type RebeccaTarget = {
  panelId: string;
  panelName: string;
  serviceId: number;
  serviceName: string;
  service: RebeccaService;
};

export type CreateRebeccaPanelInput = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  adminUsername?: string;
  adminPassword?: string;
  serviceId: number;
  serviceName: string;
  maxConfigs?: number | null;
  stockRemaining?: number | null;
  dailyCreateLimit?: number | null;
};

type LoadedPanel = typeof rebeccaPanels.$inferSelect;

/**
 * Runtime registry and persistence boundary for every Rebecca panel.
 * Domain services request an explicit panel target; no mutable global client
 * can silently redirect an in-flight financial operation.
 */
export class RebeccaPanelRegistry {
  private readonly cipher: CredentialCipher;
  private readonly clients = new Map<string, RebeccaService>();
  private panels: RebeccaPanelSummary[] = [];

  constructor(
    private readonly bootstrap: LegacyRebeccaBootstrap,
    credentialSecret: string
  ) {
    this.cipher = new CredentialCipher(credentialSecret);
  }

  async initialize(translationService: TranslationService): Promise<void> {
    const db = getDb();
    const [existingLegacy] = await db
      .select({ id: rebeccaPanels.id })
      .from(rebeccaPanels)
      .where(eq(rebeccaPanels.id, LEGACY_PANEL_ID))
      .limit(1);
    const legacySeeded = !existingLegacy;

    if (legacySeeded) {
      await db
        .insert(rebeccaPanels)
        .values({ id: LEGACY_PANEL_ID, name: 'پنل اصلی', enabled: false, isDefault: true })
        .onConflictDoNothing();
      await db
        .insert(rebeccaPanelServices)
        .values({
          panelId: LEGACY_PANEL_ID,
          serviceId: validServiceId(this.bootstrap.serviceId) ? this.bootstrap.serviceId : 1,
          name: 'سرویس پیش‌فرض',
          isDefault: true,
        })
        .onConflictDoNothing();
    }

    const [legacy] = await db
      .select()
      .from(rebeccaPanels)
      .where(eq(rebeccaPanels.id, LEGACY_PANEL_ID))
      .limit(1);
    if (!legacy) throw new Error('LEGACY_PANEL_BOOTSTRAP_FAILED');

    const storedUrl = translationService.getStoredSetting('rebecca_api_url');
    const storedKey = translationService.getStoredSetting('rebecca_api_key');
    const storedService = positiveServiceId(
      translationService.getStoredSetting('rebecca_service_id')
    );

    // Initial Drizzle migration seeds an empty `legacy` placeholder row before
    // the app boots for the first time (`baseUrl: null`, no credentials,
    // `enabled: false`). Treat that untouched placeholder—and any incomplete
    // prior bootstrap where credentials were saved without a URL—the same as a
    // freshly seeded panel so .env bootstrap values actually take effect, while
    // never overwriting a configured or admin-disabled panel on restart.
    const isUnconfiguredLegacy =
      legacySeeded ||
      (!legacy.baseUrl && !legacy.apiKeyEncrypted && !legacy.adminPasswordEncrypted);
    const isIncompleteLegacyBootstrap =
      !legacy.baseUrl && !legacy.enabled && Boolean(this.bootstrap.baseUrl);
    const shouldBootstrapLegacyEnv = isUnconfiguredLegacy || isIncompleteLegacyBootstrap;
    const hasBootstrapConnection = Boolean(
      this.bootstrap.baseUrl || this.bootstrap.apiKey || this.bootstrap.adminPassword
    );

    const shouldBootstrapUrl = shouldBootstrapLegacyEnv || !legacy.baseUrl || Boolean(storedUrl);
    const baseUrl =
      legacy.baseUrl ||
      storedUrl ||
      (shouldBootstrapLegacyEnv ? this.bootstrap.baseUrl : undefined);
    const apiKey = storedKey || this.bootstrap.apiKey;
    const adminPassword = this.bootstrap.adminPassword;
    const shouldImportCredentials =
      Boolean(storedKey) || (!legacy.apiKeyEncrypted && !legacy.adminPasswordEncrypted);

    if ((shouldBootstrapUrl && baseUrl) || (shouldImportCredentials && (apiKey || adminPassword))) {
      let normalizedUrl: string | null = legacy.baseUrl ?? null;
      if (baseUrl) {
        try {
          normalizedUrl = validateRebeccaBaseUrl(baseUrl);
        } catch {
          normalizedUrl = null;
          logger.warn({ panelId: LEGACY_PANEL_ID }, 'Invalid legacy Rebecca URL was disabled');
        }
      }
      const nextHasCredentials = Boolean(
        legacy.apiKeyEncrypted ||
        legacy.adminPasswordEncrypted ||
        (shouldImportCredentials && (apiKey || adminPassword))
      );
      const nextEnabled =
        normalizedUrl === null
          ? false
          : shouldBootstrapLegacyEnv || storedUrl || storedKey
            ? nextHasCredentials
            : legacy.enabled && nextHasCredentials;

      await db
        .update(rebeccaPanels)
        .set({
          baseUrl: normalizedUrl,
          ...(shouldImportCredentials
            ? {
                apiKeyEncrypted: this.cipher.encrypt(apiKey),
                adminUsername: this.bootstrap.adminUsername || 'admin',
                adminPasswordEncrypted: this.cipher.encrypt(adminPassword),
              }
            : {}),
          enabled: nextEnabled,
          updatedAt: new Date(),
        })
        .where(eq(rebeccaPanels.id, LEGACY_PANEL_ID));
    }

    const desiredServiceId =
      storedService ??
      (shouldBootstrapLegacyEnv && hasBootstrapConnection ? this.bootstrap.serviceId : undefined);
    if (desiredServiceId !== undefined && validServiceId(desiredServiceId)) {
      await db.transaction(async (tx) => {
        if (shouldBootstrapLegacyEnv && desiredServiceId !== 1) {
          // Remove the unused service_id=1 placeholder seeded by the initial
          // migration so restricted reseller tokens are not left with a stale
          // unauthorized service entry.
          await tx
            .delete(rebeccaPanelServices)
            .where(
              and(
                eq(rebeccaPanelServices.panelId, LEGACY_PANEL_ID),
                eq(rebeccaPanelServices.serviceId, 1)
              )
            );
        }
        await tx
          .update(rebeccaPanelServices)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(rebeccaPanelServices.panelId, LEGACY_PANEL_ID));
        await tx
          .insert(rebeccaPanelServices)
          .values({
            panelId: LEGACY_PANEL_ID,
            serviceId: desiredServiceId,
            name: 'سرویس پیش‌فرض',
            isDefault: true,
          })
          .onConflictDoUpdate({
            target: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
            set: { isDefault: true, updatedAt: new Date() },
          });
      });
    }

    // Remove legacy plaintext settings only after their durable import.
    for (const key of ['rebecca_api_url', 'rebecca_api_key', 'rebecca_service_id']) {
      if (translationService.getStoredSetting(key) !== undefined) {
        await translationService.deleteSetting(key);
      }
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    const db = getDb();
    const [panelRows, serviceRows] = await Promise.all([
      db.select().from(rebeccaPanels),
      db.select().from(rebeccaPanelServices),
    ]);
    this.clients.clear();
    this.panels = panelRows.map((panel) => {
      const services = serviceRows
        .filter((service) => service.panelId === panel.id)
        .map((service) => ({
          serviceId: service.serviceId,
          name: service.name,
          enabled: service.enabled ?? true,
          isDefault: service.isDefault,
          maxConfigs: service.maxConfigs ?? null,
          stockRemaining: service.stockRemaining ?? null,
          dailyCreateLimit: service.dailyCreateLimit ?? null,
        }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.serviceId - b.serviceId);
      const credentialMode = panel.apiKeyEncrypted
        ? 'api_key'
        : panel.adminPasswordEncrypted
          ? 'password'
          : 'none';
      if (panel.enabled && panel.baseUrl && credentialMode !== 'none') {
        try {
          const service = new RebeccaService(
            new RebeccaApiClient({
              baseUrl: validateRebeccaBaseUrl(panel.baseUrl),
              ...(panel.apiKeyEncrypted
                ? { apiKey: this.cipher.decrypt(panel.apiKeyEncrypted) }
                : {
                    adminUsername: panel.adminUsername || 'admin',
                    adminPassword: this.cipher.decrypt(panel.adminPasswordEncrypted),
                  }),
            }),
            { panelId: panel.id, panelName: panel.name }
          );
          this.clients.set(panel.id, service);
        } catch (error) {
          logger.error(
            { panelId: panel.id, errorName: error instanceof Error ? error.name : typeof error },
            'Rebecca panel client could not be loaded'
          );
        }
      }
      return {
        id: panel.id,
        name: panel.name,
        ...(panel.baseUrl ? { baseUrl: panel.baseUrl } : {}),
        enabled: panel.enabled,
        isDefault: panel.isDefault,
        credentialConfigured: credentialMode !== 'none',
        credentialMode,
        maxConfigs: panel.maxConfigs ?? null,
        stockRemaining: panel.stockRemaining ?? null,
        dailyCreateLimit: panel.dailyCreateLimit ?? null,
        services,
      };
    });
  }

  listPanels(): RebeccaPanelSummary[] {
    return this.panels.map((panel) => ({
      ...panel,
      services: panel.services.map((service) => ({ ...service })),
    }));
  }

  getPanel(panelId: string): RebeccaPanelSummary | undefined {
    const panel = this.panels.find((candidate) => candidate.id === panelId);
    return panel
      ? { ...panel, services: panel.services.map((service) => ({ ...service })) }
      : undefined;
  }

  getService(panelId: string): RebeccaService {
    const service = this.clients.get(panelId);
    if (!service) throw new RebeccaPanelNotConfiguredError(panelId);
    return service;
  }

  getEnabledPanelIds(): string[] {
    return this.panels.filter((panel) => this.clients.has(panel.id)).map((panel) => panel.id);
  }

  async resolveTarget(panelId?: string, serviceId?: number): Promise<RebeccaTarget> {
    const panel = panelId
      ? this.panels.find((candidate) => candidate.id === panelId)
      : (this.panels.find((candidate) => candidate.isDefault && this.clients.has(candidate.id)) ??
        this.panels.find((candidate) => this.clients.has(candidate.id)));
    if (!panel || !this.clients.has(panel.id)) {
      throw new RebeccaPanelNotConfiguredError(panelId);
    }
    const selectedService = serviceId
      ? panel.services.find((candidate) => candidate.serviceId === serviceId)
      : (panel.services.find((candidate) => candidate.isDefault) ?? panel.services[0]);
    if (!selectedService) throw new Error('REBECCA_SERVICE_ID_NOT_CONFIGURED');
    return {
      panelId: panel.id,
      panelName: panel.name,
      serviceId: selectedService.serviceId,
      serviceName: selectedService.name,
      service: this.clients.get(panel.id)!,
    };
  }

  async createPanel(input: CreateRebeccaPanelInput): Promise<RebeccaPanelSummary> {
    const values = validatePanelInput(input);
    const db = getDb();
    const panelId = `rp_${crypto.randomBytes(6).toString('hex')}`;
    await db.transaction(async (tx) => {
      const existingPanels = await tx
        .select({
          id: rebeccaPanels.id,
          enabled: rebeccaPanels.enabled,
          isDefault: rebeccaPanels.isDefault,
          baseUrl: rebeccaPanels.baseUrl,
          apiKeyEncrypted: rebeccaPanels.apiKeyEncrypted,
          adminPasswordEncrypted: rebeccaPanels.adminPasswordEncrypted,
        })
        .from(rebeccaPanels);
      const hasEnabledDefault = existingPanels.some(
        (panel) => panel.isDefault && isPanelRowUsable(panel)
      );
      if (!hasEnabledDefault) {
        await tx.update(rebeccaPanels).set({ isDefault: false, updatedAt: new Date() });
      }
      await tx.insert(rebeccaPanels).values({
        id: panelId,
        name: values.name,
        baseUrl: values.baseUrl,
        apiKeyEncrypted: this.cipher.encrypt(values.apiKey),
        adminUsername: values.adminUsername || 'admin',
        adminPasswordEncrypted: this.cipher.encrypt(values.adminPassword),
        enabled: true,
        isDefault: !hasEnabledDefault,
        ...(values.maxConfigs !== undefined ? { maxConfigs: values.maxConfigs } : {}),
        ...(values.stockRemaining !== undefined ? { stockRemaining: values.stockRemaining } : {}),
        ...(values.dailyCreateLimit !== undefined
          ? { dailyCreateLimit: values.dailyCreateLimit }
          : {}),
      });
      await tx.insert(rebeccaPanelServices).values({
        panelId,
        serviceId: values.serviceId,
        name: values.serviceName,
        enabled: true,
        isDefault: true,
      });
    });
    await this.reload();
    return this.getPanel(panelId)!;
  }

  async updatePanel(
    panelId: string,
    changes: {
      name?: string;
      baseUrl?: string;
      apiKey?: string | null;
      adminUsername?: string;
      adminPassword?: string | null;
      maxConfigs?: number | null;
      stockRemaining?: number | null;
      dailyCreateLimit?: number | null;
    }
  ): Promise<void> {
    const panel = await this.requirePanelRow(panelId);
    const name = changes.name?.trim();
    if (name !== undefined && (name.length < 1 || name.length > 80)) {
      throw new Error('PANEL_NAME_INVALID');
    }
    const maxConfigs = normalizeOptionalLimit(changes.maxConfigs, 'PANEL_LIMIT_INVALID');
    const stockRemaining = normalizeOptionalLimit(changes.stockRemaining, 'PANEL_LIMIT_INVALID');
    const dailyCreateLimit = normalizeOptionalLimit(
      changes.dailyCreateLimit,
      'PANEL_LIMIT_INVALID'
    );
    const baseUrl = changes.baseUrl ? validateRebeccaBaseUrl(changes.baseUrl) : undefined;
    const apiKeyEncrypted =
      changes.apiKey === undefined ? undefined : this.cipher.encrypt(changes.apiKey || undefined);
    const passwordEncrypted =
      changes.adminPassword === undefined
        ? undefined
        : this.cipher.encrypt(changes.adminPassword || undefined);
    const nextHasCredential =
      Boolean(apiKeyEncrypted === undefined ? panel.apiKeyEncrypted : apiKeyEncrypted) ||
      Boolean(passwordEncrypted === undefined ? panel.adminPasswordEncrypted : passwordEncrypted);
    await getDb()
      .update(rebeccaPanels)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(apiKeyEncrypted === undefined ? {} : { apiKeyEncrypted }),
        ...(changes.adminUsername === undefined
          ? {}
          : { adminUsername: changes.adminUsername.trim() || 'admin' }),
        ...(passwordEncrypted === undefined ? {} : { adminPasswordEncrypted: passwordEncrypted }),
        ...(maxConfigs === undefined ? {} : { maxConfigs }),
        ...(stockRemaining === undefined ? {} : { stockRemaining }),
        ...(dailyCreateLimit === undefined ? {} : { dailyCreateLimit }),
        enabled: Boolean(baseUrl ?? panel.baseUrl) && nextHasCredential && panel.enabled,
        updatedAt: new Date(),
      })
      .where(eq(rebeccaPanels.id, panelId));
    await this.reload();
  }

  async setPanelEnabled(panelId: string, enabled: boolean): Promise<void> {
    await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({
          id: rebeccaPanels.id,
          enabled: rebeccaPanels.enabled,
          isDefault: rebeccaPanels.isDefault,
          baseUrl: rebeccaPanels.baseUrl,
          apiKeyEncrypted: rebeccaPanels.apiKeyEncrypted,
          adminPasswordEncrypted: rebeccaPanels.adminPasswordEncrypted,
        })
        .from(rebeccaPanels);
      const panel = rows.find((row) => row.id === panelId);
      if (!panel) throw new Error('PANEL_NOT_FOUND');
      if (
        enabled &&
        (!panel.baseUrl || (!panel.apiKeyEncrypted && !panel.adminPasswordEncrypted))
      ) {
        throw new RebeccaPanelNotConfiguredError(panelId);
      }

      const replacement =
        !enabled && panel.isDefault
          ? rows.find((candidate) => candidate.id !== panelId && isPanelRowUsable(candidate))
          : undefined;
      const makeDefault =
        enabled &&
        !rows.some(
          (candidate) =>
            candidate.id !== panelId && candidate.isDefault && isPanelRowUsable(candidate)
        );

      if (makeDefault) {
        await tx.update(rebeccaPanels).set({ isDefault: false, updatedAt: new Date() });
      }
      await tx
        .update(rebeccaPanels)
        .set({
          enabled,
          ...(makeDefault ? { isDefault: true } : replacement ? { isDefault: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(rebeccaPanels.id, panelId));
      if (replacement) {
        await tx
          .update(rebeccaPanels)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(rebeccaPanels.id, replacement.id));
      }
    });
    await this.reload();
  }

  async setDefaultPanel(panelId: string): Promise<void> {
    if (!this.clients.has(panelId)) throw new RebeccaPanelNotConfiguredError(panelId);
    await getDb().transaction(async (tx) => {
      await tx.update(rebeccaPanels).set({ isDefault: false, updatedAt: new Date() });
      const [updated] = await tx
        .update(rebeccaPanels)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(rebeccaPanels.id, panelId))
        .returning({ id: rebeccaPanels.id });
      if (!updated) throw new Error('PANEL_NOT_FOUND');
    });
    await this.reload();
  }

  async addService(
    panelId: string,
    serviceId: number,
    name: string,
    options?: {
      enabled?: boolean;
      maxConfigs?: number | null;
      stockRemaining?: number | null;
      dailyCreateLimit?: number | null;
    }
  ): Promise<void> {
    await this.requirePanelRow(panelId);
    if (!validServiceId(serviceId)) throw new Error('SERVICE_ID_INVALID');
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) throw new Error('SERVICE_NAME_INVALID');
    const maxConfigs = normalizeOptionalLimit(options?.maxConfigs, 'SERVICE_LIMIT_INVALID');
    const stockRemaining = normalizeOptionalLimit(options?.stockRemaining, 'SERVICE_LIMIT_INVALID');
    const dailyCreateLimit = normalizeOptionalLimit(
      options?.dailyCreateLimit,
      'SERVICE_LIMIT_INVALID'
    );
    const enabled = options?.enabled ?? true;
    const existing = this.getPanel(panelId)?.services ?? [];
    await getDb()
      .insert(rebeccaPanelServices)
      .values({
        panelId,
        serviceId,
        name: normalizedName,
        enabled,
        isDefault: existing.length === 0,
        ...(maxConfigs !== undefined ? { maxConfigs } : {}),
        ...(stockRemaining !== undefined ? { stockRemaining } : {}),
        ...(dailyCreateLimit !== undefined ? { dailyCreateLimit } : {}),
      })
      .onConflictDoUpdate({
        target: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
        set: {
          name: normalizedName,
          ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
          ...(maxConfigs !== undefined ? { maxConfigs } : {}),
          ...(stockRemaining !== undefined ? { stockRemaining } : {}),
          ...(dailyCreateLimit !== undefined ? { dailyCreateLimit } : {}),
          updatedAt: new Date(),
        },
      });
    await this.reload();
  }

  async updateService(
    panelId: string,
    serviceId: number,
    changes: {
      name?: string;
      enabled?: boolean;
      maxConfigs?: number | null;
      stockRemaining?: number | null;
      dailyCreateLimit?: number | null;
    }
  ): Promise<void> {
    await this.requirePanelRow(panelId);
    if (!validServiceId(serviceId)) throw new Error('SERVICE_ID_INVALID');
    const normalizedName = changes.name?.trim();
    if (normalizedName !== undefined && (!normalizedName || normalizedName.length > 80)) {
      throw new Error('SERVICE_NAME_INVALID');
    }
    const maxConfigs = normalizeOptionalLimit(changes.maxConfigs, 'SERVICE_LIMIT_INVALID');
    const stockRemaining = normalizeOptionalLimit(changes.stockRemaining, 'SERVICE_LIMIT_INVALID');
    const dailyCreateLimit = normalizeOptionalLimit(
      changes.dailyCreateLimit,
      'SERVICE_LIMIT_INVALID'
    );
    const [updated] = await getDb()
      .update(rebeccaPanelServices)
      .set({
        ...(normalizedName === undefined ? {} : { name: normalizedName }),
        ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
        ...(maxConfigs === undefined ? {} : { maxConfigs }),
        ...(stockRemaining === undefined ? {} : { stockRemaining }),
        ...(dailyCreateLimit === undefined ? {} : { dailyCreateLimit }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(rebeccaPanelServices.panelId, panelId),
          eq(rebeccaPanelServices.serviceId, serviceId)
        )
      )
      .returning({ serviceId: rebeccaPanelServices.serviceId });
    if (!updated) throw new Error('SERVICE_NOT_FOUND');
    await this.reload();
  }

  async setDefaultService(panelId: string, serviceId: number): Promise<void> {
    await getDb().transaction(async (tx) => {
      await tx
        .update(rebeccaPanelServices)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(rebeccaPanelServices.panelId, panelId));
      const [updated] = await tx
        .update(rebeccaPanelServices)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(
            eq(rebeccaPanelServices.panelId, panelId),
            eq(rebeccaPanelServices.serviceId, serviceId)
          )
        )
        .returning({ serviceId: rebeccaPanelServices.serviceId });
      if (!updated) throw new Error('SERVICE_NOT_FOUND');
    });
    await this.reload();
  }

  async deleteService(panelId: string, serviceId: number): Promise<void> {
    const panel = this.getPanel(panelId);
    const service = panel?.services.find((candidate) => candidate.serviceId === serviceId);
    if (!panel || !service) throw new Error('SERVICE_NOT_FOUND');
    if (service.isDefault || panel.services.length <= 1) throw new Error('SERVICE_IS_DEFAULT');
    const references = await this.countServiceReferences(panelId, serviceId);
    if (references > 0) throw new Error('SERVICE_IN_USE');
    await getDb()
      .delete(rebeccaPanelServices)
      .where(
        and(
          eq(rebeccaPanelServices.panelId, panelId),
          eq(rebeccaPanelServices.serviceId, serviceId)
        )
      );
    await this.reload();
  }

  async deletePanel(panelId: string): Promise<void> {
    if (!this.getPanel(panelId)) throw new Error('PANEL_NOT_FOUND');
    if (this.panels.length <= 1) throw new RebeccaPanelInUseError(panelId);
    if (await this.countPanelReferences(panelId)) throw new RebeccaPanelInUseError(panelId);
    const replacementId = this.panels.find(
      (panel) => panel.id !== panelId && this.clients.has(panel.id)
    )?.id;
    await getDb().transaction(async (tx) => {
      const [panel] = await tx
        .delete(rebeccaPanels)
        .where(eq(rebeccaPanels.id, panelId))
        .returning({ wasDefault: rebeccaPanels.isDefault });
      if (!panel) throw new Error('PANEL_NOT_FOUND');
      if (panel.wasDefault) {
        if (replacementId) {
          await tx
            .update(rebeccaPanels)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(rebeccaPanels.id, replacementId));
        }
      }
    });
    await this.reload();
  }

  async testConnection(panelId: string): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = performance.now();
    try {
      const service = this.getService(panelId);
      service.resetCircuitBreaker();
      await service.getUsers(0, 1);
      return { ok: true, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) };
    } catch {
      return { ok: false, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) };
    }
  }

  async getPanelUsage(panelId: string): Promise<{ activeConfigsCount: number }> {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userConfigs)
      .where(
        and(
          eq(userConfigs.panelId, panelId),
          sql`${userConfigs.panelStatus} IS DISTINCT FROM 'deleted'`
        )
      );
    return { activeConfigsCount: Number(row?.count ?? 0) };
  }

  async healthSummary(): Promise<{ configured: number; healthy: number }> {
    const services = [...this.clients.values()];
    const checks = await Promise.all(services.map((service) => service.checkHealth()));
    return { configured: services.length, healthy: checks.filter(Boolean).length };
  }

  private async requirePanelRow(panelId: string): Promise<LoadedPanel> {
    const [panel] = await getDb()
      .select()
      .from(rebeccaPanels)
      .where(eq(rebeccaPanels.id, panelId))
      .limit(1);
    if (!panel) throw new Error('PANEL_NOT_FOUND');
    return panel;
  }

  private async countPanelReferences(panelId: string): Promise<number> {
    const db = getDb();
    const rows = await Promise.all([
      db
        .select({ value: sql<number>`count(*)` })
        .from(userConfigs)
        .where(eq(userConfigs.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(purchaseIntents)
        .where(eq(purchaseIntents.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(refundIntents)
        .where(eq(refundIntents.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(trialClaims)
        .where(eq(trialClaims.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(purchaseCheckouts)
        .where(eq(purchaseCheckouts.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.panelId, panelId)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(configReconciliationIssues)
        .where(eq(configReconciliationIssues.panelId, panelId)),
    ]);
    return (
      rows.reduce((total, [row]) => total + Number(row?.value ?? 0), 0) +
      (await this.countSettingReferences(panelId))
    );
  }

  private async countServiceReferences(panelId: string, serviceId: number): Promise<number> {
    const db = getDb();
    const rows = await Promise.all([
      db
        .select({ value: sql<number>`count(*)` })
        .from(userConfigs)
        .where(and(eq(userConfigs.panelId, panelId), eq(userConfigs.serviceId, serviceId))),
      db
        .select({ value: sql<number>`count(*)` })
        .from(purchaseIntents)
        .where(and(eq(purchaseIntents.panelId, panelId), eq(purchaseIntents.serviceId, serviceId))),
      db
        .select({ value: sql<number>`count(*)` })
        .from(trialClaims)
        .where(and(eq(trialClaims.panelId, panelId), eq(trialClaims.serviceId, serviceId))),
      db
        .select({ value: sql<number>`count(*)` })
        .from(purchaseCheckouts)
        .where(
          and(eq(purchaseCheckouts.panelId, panelId), eq(purchaseCheckouts.serviceId, serviceId))
        ),
    ]);
    return (
      rows.reduce((total, [row]) => total + Number(row?.value ?? 0), 0) +
      (await this.countSettingReferences(panelId, serviceId))
    );
  }

  private async countSettingReferences(panelId: string, serviceId?: number): Promise<number> {
    const rows = await getDb()
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [
          'packages_json',
          'custom_volume_target_json',
          'custom_volume_panel_id',
          'custom_volume_service_id',
        ])
      );
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    let currentCustomTarget: { panelId?: unknown; serviceId?: unknown } | undefined;
    try {
      const parsed: unknown = JSON.parse(values['custom_volume_target_json'] ?? '{}');
      if (typeof parsed === 'object' && parsed !== null) currentCustomTarget = parsed;
    } catch {
      // Invalid settings are ignored by PricingService too.
    }
    let count =
      currentCustomTarget?.panelId === panelId &&
      (serviceId === undefined || currentCustomTarget.serviceId === serviceId)
        ? 1
        : 0;
    if (
      values['custom_volume_panel_id'] === panelId &&
      (serviceId === undefined || Number(values['custom_volume_service_id']) === serviceId)
    ) {
      count += 1;
    }
    try {
      const packages: unknown = JSON.parse(values['packages_json'] ?? '[]');
      if (Array.isArray(packages)) {
        count += packages.filter(
          (pkg) =>
            typeof pkg === 'object' &&
            pkg !== null &&
            (pkg as { panelId?: unknown }).panelId === panelId &&
            (serviceId === undefined || (pkg as { serviceId?: unknown }).serviceId === serviceId)
        ).length;
      }
    } catch {
      // Invalid package JSON is ignored by PricingService too.
    }
    return count;
  }
}

function validatePanelInput(input: CreateRebeccaPanelInput): CreateRebeccaPanelInput {
  const name = input.name.trim();
  const serviceName = input.serviceName.trim();
  if (!name || name.length > 80) throw new Error('PANEL_NAME_INVALID');
  if (!serviceName || serviceName.length > 80) throw new Error('SERVICE_NAME_INVALID');
  if (!validServiceId(input.serviceId)) throw new Error('SERVICE_ID_INVALID');
  if (!input.apiKey && !input.adminPassword) throw new Error('PANEL_CREDENTIAL_MISSING');
  const maxConfigs = normalizeOptionalLimit(input.maxConfigs, 'PANEL_LIMIT_INVALID');
  const stockRemaining = normalizeOptionalLimit(input.stockRemaining, 'PANEL_LIMIT_INVALID');
  const dailyCreateLimit = normalizeOptionalLimit(input.dailyCreateLimit, 'PANEL_LIMIT_INVALID');
  return {
    ...input,
    name,
    serviceName,
    baseUrl: validateRebeccaBaseUrl(input.baseUrl),
    ...(maxConfigs !== undefined ? { maxConfigs } : {}),
    ...(stockRemaining !== undefined ? { stockRemaining } : {}),
    ...(dailyCreateLimit !== undefined ? { dailyCreateLimit } : {}),
  };
}

function normalizeOptionalLimit(
  value: number | null | undefined,
  errorCode: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SERVICE_ID) {
    throw new Error(errorCode);
  }
  return value;
}

function validServiceId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SERVICE_ID;
}

function positiveServiceId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/u.test(value.trim())) return undefined;
  const parsed = Number(value);
  return validServiceId(parsed) ? parsed : undefined;
}

function isPanelRowUsable(row: {
  enabled: boolean;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  adminPasswordEncrypted: string | null;
}): boolean {
  return (
    row.enabled &&
    Boolean(row.baseUrl) &&
    Boolean(row.apiKeyEncrypted || row.adminPasswordEncrypted)
  );
}
