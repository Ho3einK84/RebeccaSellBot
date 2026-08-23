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
  services: RebeccaPanelServiceSummary[];
};

export type RebeccaPanelServiceSummary = {
  serviceId: number;
  name: string;
  isDefault: boolean;
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
    await db
      .insert(rebeccaPanels)
      .values({ id: LEGACY_PANEL_ID, name: 'پنل اصلی', enabled: false, isDefault: true })
      .onConflictDoNothing();
    await db
      .insert(rebeccaPanelServices)
      .values({
        panelId: LEGACY_PANEL_ID,
        serviceId: 1,
        name: 'سرویس پیش‌فرض',
        isDefault: true,
      })
      .onConflictDoNothing();

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
    const baseUrl = legacy.baseUrl || storedUrl || this.bootstrap.baseUrl;
    const apiKey = storedKey || this.bootstrap.apiKey;
    const adminPassword = this.bootstrap.adminPassword;
    const shouldImportCredentials = !legacy.apiKeyEncrypted && !legacy.adminPasswordEncrypted;

    if (baseUrl || (shouldImportCredentials && (apiKey || adminPassword))) {
      let normalizedUrl: string | null = null;
      if (baseUrl) {
        try {
          normalizedUrl = validateRebeccaBaseUrl(baseUrl);
        } catch {
          logger.warn({ panelId: LEGACY_PANEL_ID }, 'Invalid legacy Rebecca URL was disabled');
        }
      }
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
          enabled:
            Boolean(normalizedUrl) &&
            Boolean(
              legacy.apiKeyEncrypted ||
              legacy.adminPasswordEncrypted ||
              (shouldImportCredentials && (apiKey || adminPassword))
            ),
          updatedAt: new Date(),
        })
        .where(eq(rebeccaPanels.id, LEGACY_PANEL_ID));
    }

    const desiredServiceId = storedService ?? this.bootstrap.serviceId;
    if (validServiceId(desiredServiceId)) {
      await db.transaction(async (tx) => {
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
          isDefault: service.isDefault,
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
    const hasEnabledDefault = this.panels.some(
      (panel) => panel.isDefault && this.clients.has(panel.id)
    );
    await db.transaction(async (tx) => {
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
      });
      await tx.insert(rebeccaPanelServices).values({
        panelId,
        serviceId: values.serviceId,
        name: values.serviceName,
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
    }
  ): Promise<void> {
    const panel = await this.requirePanelRow(panelId);
    const name = changes.name?.trim();
    if (name !== undefined && (name.length < 1 || name.length > 80)) {
      throw new Error('PANEL_NAME_INVALID');
    }
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
        enabled: Boolean(baseUrl ?? panel.baseUrl) && nextHasCredential && panel.enabled,
        updatedAt: new Date(),
      })
      .where(eq(rebeccaPanels.id, panelId));
    await this.reload();
  }

  async setPanelEnabled(panelId: string, enabled: boolean): Promise<void> {
    const panel = await this.requirePanelRow(panelId);
    if (enabled && (!panel.baseUrl || (!panel.apiKeyEncrypted && !panel.adminPasswordEncrypted))) {
      throw new RebeccaPanelNotConfiguredError(panelId);
    }
    const replacement =
      !enabled && panel.isDefault
        ? this.panels.find(
            (candidate) => candidate.id !== panelId && this.clients.has(candidate.id)
          )
        : undefined;
    const makeDefault =
      enabled &&
      !this.panels.some(
        (candidate) =>
          candidate.id !== panelId && candidate.isDefault && this.clients.has(candidate.id)
      );
    await getDb().transaction(async (tx) => {
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

  async addService(panelId: string, serviceId: number, name: string): Promise<void> {
    await this.requirePanelRow(panelId);
    if (!validServiceId(serviceId)) throw new Error('SERVICE_ID_INVALID');
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) throw new Error('SERVICE_NAME_INVALID');
    const existing = this.getPanel(panelId)?.services ?? [];
    await getDb()
      .insert(rebeccaPanelServices)
      .values({
        panelId,
        serviceId,
        name: normalizedName,
        isDefault: existing.length === 0,
      })
      .onConflictDoUpdate({
        target: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
        set: { name: normalizedName, updatedAt: new Date() },
      });
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

  async testConnection(panelId: string): Promise<boolean> {
    try {
      const service = this.getService(panelId);
      service.resetCircuitBreaker();
      await service.getUsers(0, 1);
      return true;
    } catch {
      return false;
    }
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
  return {
    ...input,
    name,
    serviceName,
    baseUrl: validateRebeccaBaseUrl(input.baseUrl),
  };
}

function validServiceId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SERVICE_ID;
}

function positiveServiceId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/u.test(value.trim())) return undefined;
  const parsed = Number(value);
  return validServiceId(parsed) ? parsed : undefined;
}
