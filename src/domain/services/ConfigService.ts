/**
 * ConfigService — manages config naming, counter sync, and sub-link claiming.
 *
 * Layering: all Rebecca API calls go through RebeccaService.
 * No direct RebeccaApiClient imports.
 */
import { getDb } from '../../infra/db.js';
import { userConfigs, configCounters, notificationDeliveries, users } from '../../infra/schema.js';
import { withConfigLock } from './ConfigLock.js';
import { RebeccaApiError, type RebeccaService, type RebeccaUserDetail } from './RebeccaService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import {
  normalizeRebeccaPanelAccess,
  isRebeccaPanelRegistryAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';
import type { TranslationService } from './TranslationService.js';
import { remoteFingerprint } from './RebeccaOwnership.js';
import {
  ConfigIncarnationMismatchError,
  ConfigIncarnationUnverifiedError,
  verifyOrEstablishConfigIncarnation,
} from './ConfigIncarnation.js';
import { logger } from '../../infra/logger.js';
import crypto from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  activeConfigCountSql,
  deletedConfigLifecycle,
  observedConfigLifecycle,
} from './ConfigLifecycle.js';

const CREDENTIAL_KEY_RE = /^[a-f0-9-]{16,128}$/i;
const OPAQUE_SUBSCRIPTION_TOKEN_RE = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9_-]{15,}$/;
const URL_CANDIDATE_RE = /https:\/\/[^\s<>"'`\\]+/giu;
const CLAIM_COOLDOWN_MS = 30_000;
const CLAIM_SEARCH_LIMIT = 10;
const MAX_REBECCA_USERNAME_LENGTH = 32;
const MIN_REBECCA_USERNAME_LENGTH = 3;
const MAX_COUNTER = 2_147_483_647;

export type SubscriptionClaimResult = {
  success: boolean;
  messageKey: string;
  username?: string;
  panelId?: string;
};

export type AutoRenewPreference = {
  autoRenewEnabled: boolean;
  autoRenewPackageId: string | null;
  autoRenewPrice: number | null;
};

type ConfigRecord = typeof userConfigs.$inferSelect;
export type ConfigRemoteReference = Pick<ConfigRecord, 'panelId' | 'configUsername'>;

export class ConfigService {
  private readonly claimCooldowns = new Map<number, number>();
  private readonly counterSyncedPanels = new Set<string>();
  private readonly legacySinglePanel: boolean;

  constructor(
    panels: RebeccaPanelRegistry | RebeccaService,
    private translationService: TranslationService
  ) {
    this.legacySinglePanel = !isRebeccaPanelRegistryAccess(panels);
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  private readonly panels: NormalizedRebeccaPanelAccess;

  /**
   * Change auto-renew only for a config owned by this Telegram user. Disabling
   * intentionally retains the package ID so a later re-enable is one tap.
   */
  async setAutoRenew(
    telegramId: number,
    configId: string,
    enabled: boolean,
    packageId?: string,
    approvedPrice?: number
  ): Promise<AutoRenewPreference | null> {
    if (
      enabled &&
      (!packageId ||
        (!this.legacySinglePanel && approvedPrice === undefined) ||
        (approvedPrice !== undefined && !Number.isSafeInteger(approvedPrice)) ||
        (approvedPrice ?? 0) < 0)
    ) {
      throw new Error('AUTO_RENEW_PACKAGE_REQUIRED');
    }

    const config = await this.getOwnedConfigById(telegramId, configId);
    if (!config) return null;

    return withConfigLock(config.panelId, config.configUsername, async () => {
      const values = enabled
        ? {
            autoRenewEnabled: true,
            autoRenewPackageId: packageId!,
            ...(approvedPrice === undefined ? {} : { autoRenewPrice: approvedPrice }),
          }
        : { autoRenewEnabled: false };
      const [updated] = await getDb()
        .update(userConfigs)
        .set(values)
        .where(and(eq(userConfigs.id, configId), eq(userConfigs.telegramId, telegramId)))
        .returning({
          autoRenewEnabled: userConfigs.autoRenewEnabled,
          autoRenewPackageId: userConfigs.autoRenewPackageId,
          autoRenewPrice: userConfigs.autoRenewPrice,
        });
      return updated ?? null;
    });
  }

  /**
   * Sync internal counter against the highest existing user index from Rebecca API.
   * Each mode pattern is paginated fully — no 1000-user cap.
   */
  async syncCounters(requiredPanelId?: string): Promise<number> {
    const db = getDb();
    const prefix = this.translationService.getSetting('naming_prefix', 'rebecca');
    const template = this.translationService.getSetting(
      'custom_naming_template',
      '{prefix}_{counter}'
    );
    const patterns: Record<string, RegExp> = {
      prefix_number: prefixCounterPattern(prefix),
      telegramid_number: /^(?:\d+)_(?<counter>\d+)$/i,
      custom: templateCounterPattern(template, prefix),
    };
    const panelIds = requiredPanelId ? [requiredPanelId] : this.panels.getEnabledPanelIds();
    const aggregateCounters = Object.fromEntries(
      Object.keys(patterns).map((mode) => [mode, 0])
    ) as Record<string, number>;
    const syncedPanelIds: string[] = [];
    const failedPanelIds: string[] = [];

    for (const panelId of panelIds) {
      // A failed refresh invalidates the runtime proof for this panel. Its
      // first later purchase must retry the remote scan before generating a
      // username, while other healthy panels remain usable.
      this.counterSyncedPanels.delete(panelId);
      try {
        const modeCounters = await this.panels.getService(panelId).getHighestCounters(patterns);
        for (const mode of Object.keys(patterns)) {
          const panelMax = modeCounters[mode] ?? 0;
          if (!Number.isSafeInteger(panelMax) || panelMax < 0 || panelMax > MAX_COUNTER) {
            throw new Error(`CONFIG_COUNTER_OUT_OF_RANGE:${mode}`);
          }
          aggregateCounters[mode] = Math.max(aggregateCounters[mode] ?? 0, panelMax);
        }
        syncedPanelIds.push(panelId);
      } catch (err) {
        failedPanelIds.push(panelId);
        logger.warn({ err, panelId }, 'Config counter sync deferred for Rebecca panel');
      }
    }

    if (requiredPanelId && failedPanelIds.length > 0) {
      // This path runs immediately before a purchase on the requested panel.
      // Reusing an unsynchronised username is not safe, so fail only that
      // purchase and let the user retry after the panel recovers.
      throw new Error(`CONFIG_COUNTER_SYNC_FAILED:${requiredPanelId}`);
    }

    if (syncedPanelIds.length === 0) {
      logger.warn(
        { configuredPanelCount: panelIds.length, failedPanelIds },
        'No Rebecca panel was available for config counter sync'
      );
      // The bot must still start so an administrator can configure or repair
      // panels from Telegram. No purchase can pass the target-specific guard.
      return 0;
    }

    let maxNum = 0;
    try {
      for (const mode of Object.keys(patterns)) {
        const modeMax = aggregateCounters[mode] ?? 0;
        maxNum = Math.max(maxNum, modeMax);
        await db
          .insert(configCounters)
          .values({ mode, currentCount: modeMax, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: configCounters.mode,
            set: {
              currentCount: sql`GREATEST(${configCounters.currentCount}, ${modeMax})`,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to persist synchronized config counters');
      throw err;
    }

    for (const panelId of syncedPanelIds) this.counterSyncedPanels.add(panelId);
    logger.info(
      { maxNum, prefix, syncedPanelIds, failedPanelIds },
      'Config counters synced with Rebecca API'
    );
    return maxNum;
  }

  /**
   * Generate a unique config name based on admin-defined naming mode.
   *
   * Modes:
   *   prefix_number      → {prefix}_{counter}
   *   telegramid_number  → {telegramId}_{counter}
   *   custom (default)   → uses custom_naming_template with placeholders
   *                        {prefix}, {telegram_id}, {counter}, {random4}
   */
  async generateConfigName(telegramId: number, panelId?: string): Promise<string> {
    if (panelId && !this.counterSyncedPanels.has(panelId)) {
      await this.syncCounters(panelId);
    }
    const mode = this.translationService.getSetting('naming_mode', 'custom');
    const prefix = this.translationService.getSetting('naming_prefix', 'rebecca');

    if (mode === 'prefix_number') {
      const counter = await this.incrementCounter(mode);
      return toRebeccaUsername(`${prefix}_${counter}`, counter);
    }

    if (mode === 'telegramid_number') {
      const counter = await this.incrementCounter(mode);
      return toRebeccaUsername(`${telegramId}_${counter}`, counter);
    }

    // Default 'custom' template mode
    const template = this.translationService.getSetting(
      'custom_naming_template',
      '{prefix}_{counter}'
    );
    const counter = await this.incrementCounter('custom');
    const random4 = crypto.randomBytes(2).toString('hex');

    const rendered = template
      .replaceAll('{prefix}', prefix)
      .replaceAll('{telegram_id}', String(telegramId))
      .replaceAll('{counter}', String(counter))
      .replaceAll('{random4}', random4);

    // Templates without a counter are allowed for administrator convenience,
    // but the generated username must still be collision-resistant.
    const name = template.includes('{counter}') ? rendered : `${rendered}_${counter}`;
    return toRebeccaUsername(name, counter);
  }

  private async incrementCounter(mode: string): Promise<number> {
    const db = getDb();
    const [updated] = await db
      .insert(configCounters)
      .values({ mode, currentCount: 1, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: configCounters.mode,
        set: {
          currentCount: sql`${configCounters.currentCount} + 1`,
          updatedAt: new Date(),
        },
        setWhere: sql`${configCounters.currentCount} < ${MAX_COUNTER}`,
      })
      .returning();
    if (!updated) throw new Error('CONFIG_COUNTER_EXHAUSTED');
    return updated.currentCount;
  }

  async listConfigsForOwner(telegramId: number) {
    const db = getDb();
    return db
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.telegramId, telegramId))
      .orderBy(desc(userConfigs.createdAt), desc(userConfigs.id));
  }

  async isOwnedBy(telegramId: number, configUsername: string, panelId?: string): Promise<boolean> {
    const db = getDb();
    const [config] = await db
      .select({ id: userConfigs.id })
      .from(userConfigs)
      .where(
        panelId
          ? and(
              eq(userConfigs.telegramId, telegramId),
              eq(userConfigs.panelId, panelId),
              eq(userConfigs.configUsername, configUsername)
            )
          : and(
              eq(userConfigs.telegramId, telegramId),
              eq(userConfigs.configUsername, configUsername)
            )
      )
      .limit(1);
    return config !== undefined;
  }

  async getOwnedConfigById(telegramId: number, configId: string) {
    if (!/^uc_[a-zA-Z0-9_]+$/u.test(configId) || configId.length > 40) return undefined;
    const [config] = await getDb()
      .select()
      .from(userConfigs)
      .where(and(eq(userConfigs.telegramId, telegramId), eq(userConfigs.id, configId)))
      .limit(1);
    return config;
  }

  async getConfigById(configId: string) {
    if (!/^uc_[a-zA-Z0-9_]+$/u.test(configId) || configId.length > 40) return undefined;
    const [config] = await getDb()
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.id, configId))
      .limit(1);
    return config;
  }

  async getOwnedConfigByUsername(telegramId: number, configUsername: string, panelId?: string) {
    const configs = await getDb()
      .select()
      .from(userConfigs)
      .where(
        and(
          eq(userConfigs.telegramId, telegramId),
          eq(userConfigs.configUsername, configUsername),
          ...(panelId ? [eq(userConfigs.panelId, panelId)] : [])
        )
      )
      .limit(panelId ? 1 : 2);
    return configs.length === 1 ? configs[0] : undefined;
  }

  /** Resolve a legacy username-only admin action only when it is unambiguous. */
  async getConfigByUsername(configUsername: string, panelId?: string) {
    const rows = await getDb()
      .select()
      .from(userConfigs)
      .where(
        panelId
          ? and(eq(userConfigs.panelId, panelId), eq(userConfigs.configUsername, configUsername))
          : eq(userConfigs.configUsername, configUsername)
      )
      .limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  }

  /**
   * Read the panel-authoritative subscription record for a known local binding.
   * Telegram code uses this boundary instead of reaching through the panel
   * registry to a RebeccaService instance itself.
   */
  async getRemoteConfigDetail(config: ConfigRemoteReference): Promise<RebeccaUserDetail> {
    return this.panels.getService(config.panelId).getUser(config.configUsername);
  }

  /**
   * Extract a likely Rebecca subscription URL from a text message.
   *
   * This intentionally does not accept every ordinary HTTPS URL.  Rebecca
   * subscription links always finish with an opaque credential/token segment;
   * matching that shape before calling the API avoids treating normal pasted
   * links as claim attempts. The panel remains the authority: this is only a
   * cheap pre-filter and never establishes ownership by itself.
   */
  extractSubUrl(text: string): string | null {
    for (const match of text.matchAll(URL_CANDIDATE_RE)) {
      const normalized = normalizeSubscriptionUrl(trimMessagePunctuation(match[0]));
      if (!normalized) continue;

      if (isLikelySubscriptionUrl(normalized)) {
        return normalized.toString();
      }
    }
    return null;
  }

  /**
   * Claim a subscription link.
   *
   * Rules (enforced atomically):
   *  1. Verify the URL exists on the Rebecca panel.
   *  2. If the username is already claimed by a DIFFERENT user → hard reject (no reassignment).
   *  3. If the username is already claimed by THIS user → idempotent success.
   *  4. Otherwise → insert claim record.
   *
   * The Rebecca Go API's `search` parameter understands subscription URLs,
   * credential keys, and signed subscription tokens. We use that targeted
   * lookup and then verify candidates via GET /api/user/:username, rather than
   * paginating every panel user (which is both slow and unsafe at scale).
   */
  async claimSubLink(telegramId: number, subUrl: string): Promise<SubscriptionClaimResult> {
    const db = getDb();

    if (!this.acquireClaimCooldown(telegramId)) {
      return { success: false, messageKey: 'claim_rate_limited' };
    }

    const normalizedSubUrl = normalizeSubscriptionUrl(subUrl);
    if (!normalizedSubUrl || !isLikelySubscriptionUrl(normalizedSubUrl)) {
      return { success: false, messageKey: 'claim_failed' };
    }

    try {
      const match = await this.findPanelUserForSubscription(normalizedSubUrl);
      if (!match) {
        return { success: false, messageKey: 'claim_failed' };
      }
      const { remote: matchedUser, panelId } = match;
      const matchedUsername = matchedUser.username;

      // Do an explicit owner check so a purchased config (not only a previous
      // manual claim) cannot be rebound. `config_username` is also UNIQUE in
      // the DB, and the insert below is conflict-safe for concurrent requests.
      const [existingClaim] = await db
        .select({ telegramId: userConfigs.telegramId })
        .from(userConfigs)
        .where(
          and(eq(userConfigs.panelId, panelId), eq(userConfigs.configUsername, matchedUsername))
        )
        .limit(1);

      if (existingClaim) {
        if (existingClaim.telegramId === telegramId) {
          return {
            success: true,
            messageKey: 'claimed_success',
            username: matchedUsername,
            panelId,
          };
        }
        logger.warn(
          { telegramId, matchedUsername, owner: existingClaim.telegramId },
          'ConfigService: conflicting subscription claim attempt rejected'
        );
        return { success: false, messageKey: 'claim_already_claimed' };
      }

      // New claim — INSERT only. onConflictDoNothing makes the UNIQUE
      // config_username constraint the final permanent-owner guard.
      const id = `uc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const serviceId =
        matchedUser.service_id ?? (await this.panels.resolveTarget(panelId)).serviceId;
      const observedAt = new Date();
      const inserted = await db.transaction(async (tx) => {
        const created = await tx
          .insert(userConfigs)
          .values({
            id,
            telegramId,
            panelId,
            serviceId,
            configUsername: matchedUsername,
            subUrl: normalizedSubUrl.toString(),
            isClaimed: true,
            claimedAt: new Date(),
            remoteCreatedAt: remoteFingerprint(matchedUser),
            ...observedConfigLifecycle(matchedUser, observedAt),
          })
          .onConflictDoNothing({ target: [userConfigs.panelId, userConfigs.configUsername] })
          .returning({ telegramId: userConfigs.telegramId });
        if (created.length > 0) {
          await tx
            .update(users)
            .set({
              activeSubscriptionCount: activeConfigCountSql(telegramId),
              updatedAt: observedAt,
            })
            .where(eq(users.telegramId, telegramId));
        }
        return created;
      });

      if (inserted.length === 0) {
        const [ownerAfterConflict] = await db
          .select({ telegramId: userConfigs.telegramId })
          .from(userConfigs)
          .where(
            and(eq(userConfigs.panelId, panelId), eq(userConfigs.configUsername, matchedUsername))
          )
          .limit(1);
        if (ownerAfterConflict?.telegramId === telegramId) {
          return {
            success: true,
            messageKey: 'claimed_success',
            username: matchedUsername,
            panelId,
          };
        }
        logger.warn(
          { telegramId, matchedUsername, owner: ownerAfterConflict?.telegramId },
          'ConfigService: concurrent conflicting subscription claim rejected'
        );
        return { success: false, messageKey: 'claim_already_claimed' };
      }

      logger.info({ telegramId, matchedUsername }, 'ConfigService: sub-link claimed');
      return {
        success: true,
        messageKey: 'claimed_success',
        username: matchedUsername,
        panelId,
      };
    } catch (err) {
      // Subscription URLs carry credentials. Never put the raw value in logs.
      logger.error(
        { telegramId, errorName: err instanceof Error ? err.name : typeof err },
        'ConfigService: error claiming subscription link'
      );
      return { success: false, messageKey: 'claim_failed' };
    }
  }

  private acquireClaimCooldown(telegramId: number): boolean {
    const now = Date.now();
    const previous = this.claimCooldowns.get(telegramId) ?? 0;
    if (now - previous < CLAIM_COOLDOWN_MS) return false;

    this.claimCooldowns.set(telegramId, now);
    if (this.claimCooldowns.size > 10_000) {
      for (const [id, timestamp] of this.claimCooldowns) {
        if (now - timestamp >= CLAIM_COOLDOWN_MS) this.claimCooldowns.delete(id);
      }
    }
    return true;
  }

  private async findPanelUserForSubscription(
    submittedUrl: URL
  ): Promise<{ panelId: string; remote: RebeccaUserDetail } | null> {
    const locallyBound = await this.findLocallyBoundUser(submittedUrl);
    if (locallyBound) return locallyBound;

    const explicitUsername = explicitUsernameFromSubscriptionUrl(submittedUrl);
    for (const panelId of this.panels.getEnabledPanelIds()) {
      const rebeccaService = this.panels.getService(panelId);
      if (explicitUsername) {
        try {
          const remote = await rebeccaService.getUser(explicitUsername);
          if (subscriptionUrlBelongsToUser(submittedUrl, remote)) return { panelId, remote };
        } catch (err) {
          if (!(err instanceof RebeccaApiError && err.status === 404)) {
            logger.warn(
              { panelId, errorName: err instanceof Error ? err.name : typeof err },
              'Subscription claim panel lookup deferred'
            );
          }
        }
      }

      try {
        const candidates = await rebeccaService.getUsers(
          0,
          CLAIM_SEARCH_LIMIT,
          submittedUrl.toString(),
          undefined,
          true
        );
        for (const candidate of candidates.users) {
          const remote = await rebeccaService.getUser(candidate.username);
          if (subscriptionUrlBelongsToUser(submittedUrl, remote)) return { panelId, remote };
        }
      } catch (err) {
        logger.warn(
          { panelId, errorName: err instanceof Error ? err.name : typeof err },
          'Subscription claim search failed on one Rebecca panel'
        );
      }
    }
    return null;
  }

  private async findLocallyBoundUser(
    submittedUrl: URL
  ): Promise<{ panelId: string; remote: RebeccaUserDetail } | null> {
    const [localConfig] = await getDb()
      .select({ panelId: userConfigs.panelId, configUsername: userConfigs.configUsername })
      .from(userConfigs)
      .where(eq(userConfigs.subUrl, submittedUrl.toString()))
      .limit(1);
    if (!localConfig) return null;

    try {
      const remote = await this.panels
        .getService(localConfig.panelId)
        .getUser(localConfig.configUsername);
      return subscriptionUrlBelongsToUser(submittedUrl, remote)
        ? { panelId: localConfig.panelId, remote }
        : null;
    } catch (err) {
      // A stale local binding must not turn into a permanent false negative.
      // Panel/network errors still propagate; only a definite remote 404 may
      // fall through to Rebecca's targeted credential/token lookup.
      if (err instanceof RebeccaApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Revoke subscription (rotate UUID) and update cached subUrl in DB */
  async revokeSubscription(configUsername: string, panelId?: string): Promise<string | undefined> {
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      const currentConfig = await this.resolveLocalConfig(config.configUsername, config.panelId);
      const remote = await this.panels
        .getService(currentConfig.panelId)
        .getUser(currentConfig.configUsername);
      await this.assertConfigIncarnation(currentConfig, remote);

      const updated = await this.panels
        .getService(currentConfig.panelId)
        .revokeSubscription(currentConfig.configUsername);
      const newSubUrl = canonicalSubscriptionUrls(updated)[0];
      const observedAt = new Date();
      await getDb().transaction(async (tx) => {
        await tx
          .update(userConfigs)
          .set({
            ...(newSubUrl ? { subUrl: newSubUrl } : {}),
            ...observedConfigLifecycle(updated, observedAt),
          })
          .where(eq(userConfigs.id, currentConfig.id));
        await tx
          .update(users)
          .set({
            activeSubscriptionCount: activeConfigCountSql(currentConfig.telegramId),
            updatedAt: observedAt,
          })
          .where(eq(users.telegramId, currentConfig.telegramId));
      });
      return newSubUrl;
    });
  }

  async resetUsage(configUsername: string, panelId?: string): Promise<void> {
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      const remote = await this.panels.getService(config.panelId).getUser(config.configUsername);
      await this.assertConfigIncarnation(config, remote);
      await this.panels.getService(config.panelId).resetUserTraffic(config.configUsername);
    });
  }

  /** Toggle a locally bound config according to its current remote state. */
  async toggleConfig(configUsername: string, panelId?: string): Promise<'enabled' | 'disabled'> {
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      const remote = await this.getRemoteConfigDetail(config);
      const enabled = remote.status === 'disabled';
      // Reuse the remote snapshot we already fetched to decide the toggle. The
      // old path fetched the same Rebecca user twice before every toggle.
      await this.setConfigEnabled(config, enabled, remote);
      return enabled ? 'enabled' : 'disabled';
    });
  }

  async disableConfig(configUsername: string, panelId?: string): Promise<void> {
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      await this.setConfigEnabled(config, false);
    });
  }

  async enableConfig(configUsername: string, panelId?: string): Promise<void> {
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      await this.setConfigEnabled(config, true);
    });
  }

  private async setConfigEnabled(
    config: ConfigRecord,
    enabled: boolean,
    remoteSnapshot?: RebeccaUserDetail
  ): Promise<void> {
    const remoteUser =
      remoteSnapshot ??
      (await this.panels.getService(config.panelId).getUser(config.configUsername));
    await this.assertConfigIncarnation(config, remoteUser);
    const remote = enabled
      ? await this.panels.getService(config.panelId).enableUser(config.configUsername)
      : await this.panels.getService(config.panelId).disableUser(config.configUsername);
    const observedAt = new Date();
    await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(userConfigs)
        .set(observedConfigLifecycle(remote, observedAt))
        .where(eq(userConfigs.id, config.id))
        .returning({ id: userConfigs.id });
      if (!updated) throw new Error('CONFIG_NOT_FOUND');
      await tx
        .update(users)
        .set({
          activeSubscriptionCount: activeConfigCountSql(config.telegramId),
          updatedAt: observedAt,
        })
        .where(eq(users.telegramId, config.telegramId));
    });
  }

  private async markLocalConfigStale(config: ConfigRecord): Promise<void> {
    const observedAt = new Date();
    await getDb().transaction(async (tx) => {
      await tx
        .update(userConfigs)
        .set(deletedConfigLifecycle(observedAt))
        .where(eq(userConfigs.id, config.id));
      await tx
        .update(users)
        .set({
          activeSubscriptionCount: activeConfigCountSql(config.telegramId),
          updatedAt: observedAt,
        })
        .where(eq(users.telegramId, config.telegramId));
    });
  }

  private async assertConfigIncarnation(
    config: ConfigRecord,
    remote: RebeccaUserDetail
  ): Promise<void> {
    try {
      await verifyOrEstablishConfigIncarnation(config, remote);
    } catch (err) {
      if (err instanceof ConfigIncarnationMismatchError) {
        await this.markLocalConfigStale(config);
      }
      throw err;
    }
  }

  /**
   * Permanently remove a config from BOTH the Rebecca panel (via its REST API)
   * and the bot's own database. This is intentionally destructive and unlike
   * disableConfig/enableConfig which only toggle the remote status.
   *
   * A Rebecca 404 (already deleted on the panel) is treated as success so a
   * caller can converge on the desired end state. Returns true when a matching
   * local row was actually removed.
   */
  async deleteConfigCompletely(configUsername: string, panelId?: string): Promise<boolean> {
    const db = getDb();
    if (this.legacySinglePanel && !panelId) {
      return withConfigLock('legacy', configUsername, async () => {
        let deleteRemote = true;
        try {
          const remote = await this.panels.getService('legacy').getUser(configUsername);
          const [local] = await db
            .select()
            .from(userConfigs)
            .where(eq(userConfigs.configUsername, configUsername))
            .limit(1);
          if (!local) {
            // Never let the legacy compatibility path become a generic Rebecca
            // deletion primitive for manually-created services.
            deleteRemote = false;
          } else {
            try {
              await verifyOrEstablishConfigIncarnation(local, remote);
            } catch (err) {
              if (
                err instanceof ConfigIncarnationMismatchError ||
                err instanceof ConfigIncarnationUnverifiedError
              ) {
                logger.warn(
                  { configUsername, reason: err.message },
                  'Remote config identity could not be verified during legacy deletion; ' +
                    'preserving remote user'
                );
                deleteRemote = false;
              } else {
                throw err;
              }
            }
          }
        } catch (err) {
          if (err instanceof RebeccaApiError && err.status === 404) {
            deleteRemote = false;
          } else {
            // A network/contract/identity-verification failure is not evidence
            // that this Rebecca username is safe to delete. Fail closed rather
            // than falling through to the destructive call.
            throw err;
          }
        }
        if (deleteRemote) {
          try {
            await this.panels.getService('legacy').deleteUser(configUsername);
          } catch (err) {
            if (!(err instanceof RebeccaApiError && err.status === 404)) throw err;
          }
        }
        return db.transaction(async (tx) => {
          const [deleted] = await tx
            .delete(userConfigs)
            .where(eq(userConfigs.configUsername, configUsername))
            .returning({
              configUsername: userConfigs.configUsername,
              telegramId: userConfigs.telegramId,
            });
          if (!deleted) return false;
          await tx
            .delete(notificationDeliveries)
            .where(eq(notificationDeliveries.configUsername, configUsername));
          await tx
            .update(users)
            .set({
              activeSubscriptionCount: activeConfigCountSql(deleted.telegramId),
              updatedAt: new Date(),
            })
            .where(eq(users.telegramId, deleted.telegramId));
          return true;
        });
      });
    }
    const config = await this.resolveLocalConfig(configUsername, panelId);
    return withConfigLock(config.panelId, config.configUsername, async () => {
      let deleteRemote = true;
      try {
        const remote = await this.panels.getService(config.panelId).getUser(config.configUsername);
        try {
          await verifyOrEstablishConfigIncarnation(config, remote);
        } catch (err) {
          if (
            err instanceof ConfigIncarnationMismatchError ||
            err instanceof ConfigIncarnationUnverifiedError
          ) {
            logger.warn(
              {
                configUsername: config.configUsername,
                panelId: config.panelId,
                reason: err.message,
              },
              'Remote config identity could not be verified during deletion; preserving remote user'
            );
            deleteRemote = false;
          } else {
            throw err;
          }
        }
      } catch (err) {
        if (err instanceof RebeccaApiError && err.status === 404) {
          deleteRemote = false;
        } else {
          throw err;
        }
      }

      if (deleteRemote) {
        try {
          await this.panels.getService(config.panelId).deleteUser(config.configUsername);
        } catch (err) {
          if (!(err instanceof RebeccaApiError && err.status === 404)) throw err;
        }
      }

      return db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(userConfigs)
          .where(eq(userConfigs.id, config.id))
          .returning({
            configUsername: userConfigs.configUsername,
            telegramId: userConfigs.telegramId,
          });
        if (!deleted) return false;
        await tx
          .delete(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.panelId, config.panelId),
              eq(notificationDeliveries.configUsername, config.configUsername)
            )
          );
        await tx
          .update(users)
          .set({
            activeSubscriptionCount: activeConfigCountSql(config.telegramId),
            updatedAt: new Date(),
          })
          .where(eq(users.telegramId, config.telegramId));
        return true;
      });
    });
  }

  private async resolveLocalConfig(configUsername: string, panelId?: string) {
    const rows = await getDb()
      .select()
      .from(userConfigs)
      .where(
        panelId
          ? and(eq(userConfigs.panelId, panelId), eq(userConfigs.configUsername, configUsername))
          : eq(userConfigs.configUsername, configUsername)
      )
      .limit(2);
    if (rows.length === 0) throw new Error('CONFIG_NOT_FOUND');
    if (!panelId && rows.length > 1) throw new Error('AMBIGUOUS_CONFIG_USERNAME');
    return rows[0]!;
  }
}

/** Normalize names to Rebecca's verified 3–32 character username contract. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._@-]/g, '_').toLowerCase();
}

function toRebeccaUsername(name: string, counter: number): string {
  const suffix = `_${counter}`;
  let normalized = sanitize(name);
  if (!normalized) normalized = `cfg${suffix}`;

  if (normalized.length > MAX_REBECCA_USERNAME_LENGTH) {
    const prefixLength = MAX_REBECCA_USERNAME_LENGTH - suffix.length;
    const prefix = normalized.slice(0, Math.max(0, prefixLength)) || 'cfg';
    normalized = `${prefix}${suffix}`;
  }

  if (normalized.length < MIN_REBECCA_USERNAME_LENGTH) {
    normalized = `cfg${suffix}`;
  }
  if (normalized.length > MAX_REBECCA_USERNAME_LENGTH) {
    // This can only happen if the counter itself has exceeded the supported
    // integer range, but keep the API boundary explicit and fail closed.
    throw new Error('CONFIG_USERNAME_TOO_LONG');
  }
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateCounterPattern(template: string, prefix: string): RegExp {
  const primaryMarker = '__counter_primary__';
  const additionalMarker = '__counter_additional__';
  let foundCounter = false;
  let source = template.replace(/\{counter\}/g, () => {
    if (!foundCounter) {
      foundCounter = true;
      return primaryMarker;
    }
    return additionalMarker;
  });
  if (!foundCounter) source += `_${primaryMarker}`;
  source = source
    .replaceAll('{prefix}', prefix)
    .replaceAll('{telegram_id}', '__telegram__')
    .replaceAll('{random4}', '__random__');
  // Long templates are truncated by toRebeccaUsername and retain a trailing
  // counter. In that form the literal template prefix is no longer reliable;
  // a conservative suffix scan may skip numbers from another naming mode but
  // can never reuse a panel name.
  const projected = sanitize(source)
    .replace(primaryMarker, '0')
    .replaceAll(additionalMarker, '0')
    .replace('__telegram__', '999999999999999')
    .replace('__random__', '0000');
  if (projected.length > MAX_REBECCA_USERNAME_LENGTH) {
    return /_(?<counter>\d+)$/i;
  }
  source = escapeRegExp(sanitize(source))
    .replace(primaryMarker, '(?<counter>\\d+)')
    .replaceAll(additionalMarker, '\\d+')
    .replace('__telegram__', '\\d+')
    .replace('__random__', '[a-f0-9]{4}');
  return new RegExp(`^${source}$`, 'i');
}

function prefixCounterPattern(prefix: string): RegExp {
  const normalized = sanitize(prefix);
  if (`${normalized}_${MAX_COUNTER}`.length > MAX_REBECCA_USERNAME_LENGTH) {
    return /_(?<counter>\d+)$/i;
  }
  return new RegExp(`^${escapeRegExp(normalized)}_(?<counter>\\d+)$`, 'i');
}

function trimMessagePunctuation(value: string): string {
  return value.replace(/[.,!?;:]+$/u, '').replace(/[)\]}]+$/u, '');
}

function normalizeSubscriptionUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    // Rebecca is deployed behind a real TLS domain.  Subscription URLs carry
    // bearer-like credentials, so accepting a plaintext HTTP link here would
    // train users to disclose those credentials over an insecure transport.
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      return null;
    }
    // Telegram clients commonly add a fragment when sharing a link. Fragments
    // are not sent to Rebecca and must not prevent exact canonical comparison.
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function isLikelySubscriptionUrl(url: URL): boolean {
  const terminalSegment = url.pathname.split('/').filter(Boolean).at(-1);
  return (
    terminalSegment !== undefined &&
    (CREDENTIAL_KEY_RE.test(terminalSegment) || OPAQUE_SUBSCRIPTION_TOKEN_RE.test(terminalSegment))
  );
}

function subscriptionUrlBelongsToUser(submittedUrl: URL, user: RebeccaUserDetail): boolean {
  return canonicalSubscriptionUrls(user).some((candidate) => {
    const normalized = normalizeSubscriptionUrl(candidate);
    return normalized?.toString() === submittedUrl.toString();
  });
}

function canonicalSubscriptionUrls(user: RebeccaUserDetail): string[] {
  const variants = user.subscription_urls;
  const aliases =
    variants && typeof variants === 'object'
      ? Object.values(variants).filter((value): value is string => typeof value === 'string')
      : [];
  return [user.subscription_url, ...aliases].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
}

function explicitUsernameFromSubscriptionUrl(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  // A Rebecca subscription path is always present (default: /sub). Therefore
  // username/key links have at least three path segments, while opaque key and
  // signed-token links do not expose a trustworthy username.
  if (parts.length < 3) return null;
  const encodedUsername = parts.at(-2);
  if (!encodedUsername) return null;
  try {
    const username = decodeURIComponent(encodedUsername);
    return /^[a-z0-9_-]{1,128}$/i.test(username) ? username : null;
  } catch {
    return null;
  }
}
