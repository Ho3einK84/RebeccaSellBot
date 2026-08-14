import crypto from 'node:crypto';
import { and, asc, count, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  configReconciliationIssues,
  notificationDeliveries,
  userConfigs,
  users,
} from '../../infra/schema.js';
import type { RebeccaUsersResponse } from './RebeccaService.js';
import { RebeccaApiError } from './RebeccaService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { RebeccaService } from './RebeccaService.js';
import {
  normalizeRebeccaPanelAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';
import {
  activeConfigCountSql,
  deletedConfigLifecycle,
  observedConfigLifecycle,
} from './ConfigLifecycle.js';
import { remoteFingerprint } from './RebeccaOwnership.js';
import {
  ConfigIncarnationMismatchError,
  ConfigIncarnationUnverifiedError,
  verifyOrEstablishConfigIncarnation,
} from './ConfigIncarnation.js';
import { logger } from '../../infra/logger.js';

export type ConfigReconciliationIssue = typeof configReconciliationIssues.$inferSelect;

/** Detect and administratively repair drift between Rebecca and local ownership. */
export class ConfigReconciliationService {
  private readonly panels: NormalizedRebeccaPanelAccess;

  constructor(panels: RebeccaPanelRegistry | RebeccaService) {
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  async scan(): Promise<{
    localMissingRemote: number;
    remoteUnbound: number;
    remoteIgnored: number;
    failedPanels: string[];
  }> {
    let localMissingRemote = 0;
    let remoteUnbound = 0;
    let remoteIgnored = 0;
    const panelIds = this.panels.getEnabledPanelIds();
    const failedPanels: string[] = [];
    for (const panelId of panelIds) {
      try {
        const scanStartedAt = new Date();
        // Snapshot each panel before mutating its observations. A failed panel
        // cannot generate false missing-remote issues for another panel.
        const remoteUsers = await this.listAllRemoteUsers(panelId);
        const localConfigs = await getDb()
          .select()
          .from(userConfigs)
          .where(eq(userConfigs.panelId, panelId));
        localMissingRemote += await this.reconcileLocalBindings(
          panelId,
          localConfigs,
          remoteUsers,
          scanStartedAt
        );
        const remoteResult = await this.reconcileRemoteBindings(
          panelId,
          localConfigs,
          remoteUsers,
          scanStartedAt
        );
        remoteUnbound += remoteResult.open;
        remoteIgnored += remoteResult.ignored;
        await this.resolveStaleObservations(panelId, scanStartedAt);
      } catch (err) {
        failedPanels.push(panelId);
        logger.warn({ err, panelId }, 'Orphan reconciliation deferred for Rebecca panel');
      }
    }
    if (panelIds.length > 0 && failedPanels.length === panelIds.length) {
      throw new Error('ORPHAN_SCAN_ALL_PANELS_FAILED');
    }
    return { localMissingRemote, remoteUnbound, remoteIgnored, failedPanels };
  }

  async listIssues(
    requestedPage = 1,
    pageSize = 8
  ): Promise<{
    issues: ConfigReconciliationIssue[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const db = getDb();
    const safeSize = Math.max(1, Math.min(Math.floor(pageSize), 25));
    const [[totalRow]] = await Promise.all([
      db
        .select({ value: count() })
        .from(configReconciliationIssues)
        .where(eq(configReconciliationIssues.status, 'open')),
    ]);
    const total = totalRow?.value ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / safeSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
    const issues = await db
      .select()
      .from(configReconciliationIssues)
      .where(eq(configReconciliationIssues.status, 'open'))
      .orderBy(asc(configReconciliationIssues.firstSeenAt))
      .limit(safeSize)
      .offset((page - 1) * safeSize);
    return { issues, total, page, totalPages };
  }

  async getIssue(issueId: string): Promise<ConfigReconciliationIssue | undefined> {
    const [issue] = await getDb()
      .select()
      .from(configReconciliationIssues)
      .where(eq(configReconciliationIssues.id, issueId))
      .limit(1);
    return issue;
  }

  async removeLocalMissing(issueId: string, actorTelegramId: number): Promise<boolean> {
    const db = getDb();
    const [issue] = await db
      .select()
      .from(configReconciliationIssues)
      .where(
        and(
          eq(configReconciliationIssues.id, issueId),
          eq(configReconciliationIssues.kind, 'local_missing_remote'),
          eq(configReconciliationIssues.status, 'open')
        )
      )
      .limit(1);
    if (!issue) return false;

    // Re-check immediately before removing the local binding. A remote account
    // with the same username only cancels the issue when it is provably the
    // SAME incarnation; a recreated username must not keep a stale local owner.
    try {
      const remote = await this.panels.getService(issue.panelId).getUser(issue.configUsername);
      if (remote.status !== 'deleted') {
        const [local] = await db
          .select()
          .from(userConfigs)
          .where(
            issue.localConfigId
              ? eq(userConfigs.id, issue.localConfigId)
              : and(
                  eq(userConfigs.panelId, issue.panelId),
                  eq(userConfigs.configUsername, issue.configUsername)
                )
          )
          .limit(1);
        if (local) {
          try {
            await verifyOrEstablishConfigIncarnation(local, remote);
            await db
              .update(configReconciliationIssues)
              .set({ status: 'resolved', resolvedAt: new Date(), lastSeenAt: new Date() })
              .where(eq(configReconciliationIssues.id, issue.id));
            throw new Error('ORPHAN_REMOTE_REAPPEARED');
          } catch (err) {
            if (
              err instanceof ConfigIncarnationMismatchError ||
              err instanceof ConfigIncarnationUnverifiedError
            ) {
              // This is exactly the stale/recreated case the issue represents;
              // continue and remove only the local binding below.
            } else {
              throw err;
            }
          }
        }
      }
    } catch (err) {
      if (!(err instanceof RebeccaApiError && err.status === 404)) throw err;
    }

    return db.transaction(async (tx) => {
      const deleteCondition = issue.localConfigId
        ? and(
            eq(userConfigs.id, issue.localConfigId),
            ...(issue.localOwnerTelegramId
              ? [eq(userConfigs.telegramId, issue.localOwnerTelegramId)]
              : [])
          )
        : and(
            eq(userConfigs.panelId, issue.panelId),
            eq(userConfigs.configUsername, issue.configUsername),
            ...(issue.localOwnerTelegramId
              ? [eq(userConfigs.telegramId, issue.localOwnerTelegramId)]
              : [])
          );
      const [deleted] = await tx
        .delete(userConfigs)
        .where(deleteCondition)
        .returning({ id: userConfigs.id });
      if (!deleted) throw new Error('ORPHAN_LOCAL_BINDING_CHANGED');

      await tx
        .delete(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.panelId, issue.panelId),
            eq(notificationDeliveries.configUsername, issue.configUsername)
          )
        );
      const [resolved] = await tx
        .update(configReconciliationIssues)
        .set({ status: 'resolved', resolvedAt: new Date(), lastSeenAt: new Date() })
        .where(
          and(
            eq(configReconciliationIssues.id, issue.id),
            eq(configReconciliationIssues.status, 'open')
          )
        )
        .returning({ id: configReconciliationIssues.id });
      if (!resolved) throw new Error('ORPHAN_ISSUE_CHANGED');

      if (issue.localOwnerTelegramId) {
        await tx
          .update(users)
          .set({
            activeSubscriptionCount: activeConfigCountSql(issue.localOwnerTelegramId),
            updatedAt: new Date(),
          })
          .where(eq(users.telegramId, issue.localOwnerTelegramId));
      }
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'orphan_local_binding_removed',
        entityType: 'config_reconciliation_issue',
        entityId: issue.id,
        targetTelegramId: issue.localOwnerTelegramId,
        metadata: JSON.stringify({ panelId: issue.panelId, configUsername: issue.configUsername }),
      });
      return true;
    });
  }

  async assignRemoteUnbound(
    issueId: string,
    targetTelegramId: number,
    actorTelegramId: number
  ): Promise<{ configId: string; configUsername: string } | null> {
    const db = getDb();
    const [issue] = await db
      .select()
      .from(configReconciliationIssues)
      .where(
        and(
          eq(configReconciliationIssues.id, issueId),
          eq(configReconciliationIssues.kind, 'remote_unbound'),
          eq(configReconciliationIssues.status, 'open')
        )
      )
      .limit(1);
    if (!issue) return null;
    const [target] = await db
      .select({ telegramId: users.telegramId, isBanned: users.isBanned })
      .from(users)
      .where(eq(users.telegramId, targetTelegramId))
      .limit(1);
    if (!target) throw new Error('ORPHAN_TARGET_NOT_FOUND');
    if (target.isBanned) throw new Error('ORPHAN_TARGET_BANNED');

    const remote = await this.panels.getService(issue.panelId).getUser(issue.configUsername);
    if (remote.status === 'deleted') throw new Error('ORPHAN_REMOTE_DELETED');
    const remoteCreatedAt = remoteFingerprint(remote);
    if (issue.remoteCreatedAt && issue.remoteCreatedAt !== remoteCreatedAt) {
      await this.upsertIssue({
        panelId: issue.panelId,
        kind: 'remote_unbound',
        configUsername: issue.configUsername,
        remoteCreatedAt,
        seenAt: new Date(),
      });
      throw new Error('ORPHAN_REMOTE_CHANGED');
    }
    const configId = `uc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const subUrl = remote.subscription_url || Object.values(remote.subscription_urls ?? {})[0];
    const observedAt = new Date();

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: userConfigs.id })
        .from(userConfigs)
        .where(
          and(
            eq(userConfigs.panelId, issue.panelId),
            eq(userConfigs.configUsername, issue.configUsername)
          )
        )
        .limit(1);
      if (existing) throw new Error('ORPHAN_ALREADY_BOUND');

      await tx.insert(userConfigs).values({
        id: configId,
        telegramId: targetTelegramId,
        panelId: issue.panelId,
        serviceId: remote.service_id ?? (await this.panels.resolveTarget(issue.panelId)).serviceId,
        configUsername: issue.configUsername,
        subUrl,
        isClaimed: true,
        claimedAt: observedAt,
        remoteCreatedAt,
        ...observedConfigLifecycle(remote, observedAt),
      });
      await tx
        .update(configReconciliationIssues)
        .set({ status: 'resolved', resolvedAt: observedAt, lastSeenAt: observedAt })
        .where(eq(configReconciliationIssues.id, issue.id));
      await tx
        .update(users)
        .set({
          activeSubscriptionCount: activeConfigCountSql(targetTelegramId),
          updatedAt: observedAt,
        })
        .where(eq(users.telegramId, targetTelegramId));
      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'orphan_remote_service_assigned',
        entityType: 'config_reconciliation_issue',
        entityId: issue.id,
        targetTelegramId,
        metadata: JSON.stringify({
          panelId: issue.panelId,
          configUsername: issue.configUsername,
          configId,
        }),
      });
      return { configId, configUsername: issue.configUsername };
    });
  }

  async ignoreIssue(issueId: string, actorTelegramId: number): Promise<boolean> {
    const [updated] = await getDb()
      .update(configReconciliationIssues)
      .set({ status: 'ignored', resolvedAt: new Date(), lastSeenAt: new Date() })
      .where(
        and(
          eq(configReconciliationIssues.id, issueId),
          eq(configReconciliationIssues.status, 'open')
        )
      )
      .returning({ configUsername: configReconciliationIssues.configUsername });
    if (!updated) return false;
    await getDb()
      .insert(auditLogs)
      .values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId,
        action: 'orphan_issue_ignored',
        entityType: 'config_reconciliation_issue',
        entityId: issueId,
        metadata: JSON.stringify({ configUsername: updated.configUsername }),
      });
    return true;
  }

  /**
   * Treat every currently-unbound Rebecca service as pre-existing/manual.
   *
   * This is deliberately non-destructive: no Rebecca service or local binding
   * is deleted, created, or reassigned. The Rebecca `created_at` value is kept
   * as an incarnation fingerprint, so if a service is later deleted and a new
   * service reuses the same username, the new incarnation is surfaced again.
   */
  async establishRemoteBaseline(actorTelegramId: number): Promise<{
    remoteTotal: number;
    alreadyBound: number;
    ignoredUnbound: number;
  }> {
    let remoteTotal = 0;
    let alreadyBound = 0;
    let ignoredUnbound = 0;
    for (const panelId of this.panels.getEnabledPanelIds()) {
      const establishedAt = new Date();
      const remoteUsers = await this.listAllRemoteUsers(panelId);
      // Legacy-incarnation verification needs the old local subscription URL
      // and owner metadata as continuity evidence. Load the complete binding
      // rather than only username/fingerprint so safe rows can be upgraded in
      // place while ambiguous rows remain fail-closed.
      const localConfigs = await getDb()
        .select()
        .from(userConfigs)
        .where(eq(userConfigs.panelId, panelId));
      const currentRemoteByUsername = new Map(
        remoteUsers
          .filter((remote) => remote.status !== 'deleted')
          .map((remote) => [remote.username, remote])
      );
      for (const local of localConfigs) {
        if (local.remoteCreatedAt?.startsWith('created:')) continue;
        const remote = currentRemoteByUsername.get(local.configUsername);
        if (!remote) continue;
        try {
          local.remoteCreatedAt = await this.verifyReconciliationIncarnation(
            panelId,
            local,
            remote
          );
        } catch (err) {
          if (
            !(err instanceof ConfigIncarnationMismatchError) &&
            !(err instanceof ConfigIncarnationUnverifiedError)
          ) {
            throw err;
          }
        }
      }
      const bound = new Map(localConfigs.map((config) => [config.configUsername, config]));
      const currentRemote = remoteUsers.filter((remote) => remote.status !== 'deleted');
      const unbound = currentRemote.filter((remote) => {
        const local = bound.get(remote.username);
        return (
          !local ||
          local.remoteCreatedAt == null ||
          local.remoteCreatedAt !== remoteFingerprint(remote)
        );
      });

      await getDb().transaction(async (tx) => {
        for (const remote of unbound) {
          await tx
            .insert(configReconciliationIssues)
            .values({
              panelId,
              kind: 'remote_unbound',
              configUsername: remote.username,
              remoteCreatedAt: remoteFingerprint(remote),
              status: 'ignored',
              firstSeenAt: establishedAt,
              lastSeenAt: establishedAt,
              resolvedAt: establishedAt,
            })
            .onConflictDoUpdate({
              target: [
                configReconciliationIssues.panelId,
                configReconciliationIssues.kind,
                configReconciliationIssues.configUsername,
              ],
              set: {
                localConfigId: null,
                localOwnerTelegramId: null,
                remoteCreatedAt: remoteFingerprint(remote),
                status: 'ignored',
                lastSeenAt: establishedAt,
                resolvedAt: establishedAt,
              },
            });
        }

        await tx.insert(auditLogs).values({
          id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          actorTelegramId,
          action: 'orphan_remote_baseline_established',
          entityType: 'config_reconciliation_baseline',
          entityId: `${panelId}:${establishedAt.toISOString()}`,
          metadata: JSON.stringify({
            panelId,
            remoteTotal: currentRemote.length,
            alreadyBound: currentRemote.length - unbound.length,
            ignoredUnbound: unbound.length,
          }),
        });
      });

      // Close stale open remote-only observations that were not part of this
      // complete Rebecca snapshot. Local→missing observations are untouched.
      await this.resolveStaleObservations(panelId, establishedAt);
      remoteTotal += currentRemote.length;
      alreadyBound += currentRemote.length - unbound.length;
      ignoredUnbound += unbound.length;
    }

    return { remoteTotal, alreadyBound, ignoredUnbound };
  }

  private async listAllRemoteUsers(panelId: string): Promise<RebeccaUsersResponse['users']> {
    const users: RebeccaUsersResponse['users'] = [];
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await this.panels
        .getService(panelId)
        .getUsers(offset, limit, undefined, undefined, false);
      users.push(...page.users);
      offset += page.users.length;
      if (page.users.length === 0 || offset >= page.total) break;
    }
    return users;
  }

  private async reconcileLocalBindings(
    panelId: string,
    localConfigs: Array<typeof userConfigs.$inferSelect>,
    remoteUsers: RebeccaUsersResponse['users'],
    scanStartedAt: Date
  ): Promise<number> {
    const db = getDb();
    const remoteByUsername = new Map(remoteUsers.map((user) => [user.username, user]));
    let missing = 0;
    for (const config of localConfigs) {
      const remote = remoteByUsername.get(config.configUsername);
      let isVerified = false;
      if (remote && remote.status !== 'deleted') {
        try {
          config.remoteCreatedAt = await this.verifyReconciliationIncarnation(
            panelId,
            config,
            remote
          );
          isVerified = true;
        } catch (err) {
          if (
            !(err instanceof ConfigIncarnationMismatchError) &&
            !(err instanceof ConfigIncarnationUnverifiedError)
          ) {
            throw err;
          }
        }
      }
      if (!remote || remote.status === 'deleted' || !isVerified) {
        missing += 1;
        await db
          .update(userConfigs)
          .set(deletedConfigLifecycle(scanStartedAt))
          .where(eq(userConfigs.id, config.id));
        await this.upsertIssue({
          panelId,
          kind: 'local_missing_remote',
          configUsername: config.configUsername,
          localConfigId: config.id,
          localOwnerTelegramId: config.telegramId,
          seenAt: scanStartedAt,
        });
        continue;
      }

      await Promise.all([
        db
          .update(userConfigs)
          .set({
            ...observedConfigLifecycle(remote, scanStartedAt),
            subUrl: remote.subscription_url || config.subUrl,
          })
          .where(eq(userConfigs.id, config.id)),
        db
          .update(configReconciliationIssues)
          .set({ status: 'resolved', resolvedAt: scanStartedAt, lastSeenAt: scanStartedAt })
          .where(
            and(
              eq(configReconciliationIssues.kind, 'local_missing_remote'),
              eq(configReconciliationIssues.panelId, panelId),
              eq(configReconciliationIssues.configUsername, config.configUsername),
              eq(configReconciliationIssues.status, 'open')
            )
          ),
      ]);
    }
    return missing;
  }

  private async reconcileRemoteBindings(
    panelId: string,
    localConfigs: Array<typeof userConfigs.$inferSelect>,
    remoteUsers: RebeccaUsersResponse['users'],
    scanStartedAt: Date
  ): Promise<{ open: number; ignored: number }> {
    const db = getDb();
    const bound = new Map(localConfigs.map((config) => [config.configUsername, config]));
    let open = 0;
    let ignored = 0;
    for (const remote of remoteUsers) {
      if (remote.status === 'deleted') continue;
      const local = bound.get(remote.username);
      const isBoundMatch =
        local &&
        local.remoteCreatedAt != null &&
        local.remoteCreatedAt === remoteFingerprint(remote);
      if (isBoundMatch) {
        await db
          .update(configReconciliationIssues)
          .set({ status: 'resolved', resolvedAt: scanStartedAt, lastSeenAt: scanStartedAt })
          .where(
            and(
              eq(configReconciliationIssues.kind, 'remote_unbound'),
              eq(configReconciliationIssues.panelId, panelId),
              eq(configReconciliationIssues.configUsername, remote.username),
              eq(configReconciliationIssues.status, 'open')
            )
          );
        continue;
      }
      const status = await this.upsertIssue({
        panelId,
        kind: 'remote_unbound',
        configUsername: remote.username,
        remoteCreatedAt: remoteFingerprint(remote),
        seenAt: scanStartedAt,
      });
      if (status === 'ignored') ignored += 1;
      else open += 1;
    }
    return { open, ignored };
  }

  private async verifyReconciliationIncarnation(
    panelId: string,
    config: typeof userConfigs.$inferSelect,
    remote: RebeccaUsersResponse['users'][number]
  ): Promise<string> {
    try {
      return await verifyOrEstablishConfigIncarnation(config, remote);
    } catch (err) {
      if (!(err instanceof ConfigIncarnationUnverifiedError)) throw err;

      // List responses do not include Rebecca's ownership note. Most legacy
      // rows are proven from their cached subscription URL without this extra
      // request; only ambiguous rows pay for one detail lookup so a purchase or
      // trial marker can still recover a legitimate pre-migration binding.
      const detail = await this.panels.getService(panelId).getUser(config.configUsername);
      return verifyOrEstablishConfigIncarnation(config, detail);
    }
  }

  private async resolveStaleObservations(panelId: string, scanStartedAt: Date): Promise<void> {
    // If a remote-only service no longer appears in a complete Rebecca scan,
    // the issue has disappeared on its own. Ignored issues stay ignored.
    await getDb()
      .update(configReconciliationIssues)
      .set({ status: 'resolved', resolvedAt: scanStartedAt })
      .where(
        and(
          eq(configReconciliationIssues.kind, 'remote_unbound'),
          eq(configReconciliationIssues.panelId, panelId),
          eq(configReconciliationIssues.status, 'open'),
          lt(configReconciliationIssues.lastSeenAt, scanStartedAt)
        )
      );
  }

  private async upsertIssue(params: {
    panelId: string;
    kind: 'local_missing_remote' | 'remote_unbound';
    configUsername: string;
    localConfigId?: string;
    localOwnerTelegramId?: number;
    remoteCreatedAt?: string | null;
    seenAt: Date;
  }): Promise<'open' | 'ignored' | 'resolved'> {
    const [row] = await getDb()
      .insert(configReconciliationIssues)
      .values({
        panelId: params.panelId,
        kind: params.kind,
        configUsername: params.configUsername,
        localConfigId: params.localConfigId,
        localOwnerTelegramId: params.localOwnerTelegramId,
        remoteCreatedAt: params.remoteCreatedAt,
        status: 'open',
        firstSeenAt: params.seenAt,
        lastSeenAt: params.seenAt,
      })
      .onConflictDoUpdate({
        target: [
          configReconciliationIssues.panelId,
          configReconciliationIssues.kind,
          configReconciliationIssues.configUsername,
        ],
        set: {
          localConfigId: params.localConfigId,
          localOwnerTelegramId: params.localOwnerTelegramId,
          remoteCreatedAt: params.remoteCreatedAt,
          lastSeenAt: params.seenAt,
          resolvedAt: null,
          // Remote-only ignores are scoped to one Rebecca service incarnation.
          // A service recreated with the same username but a different
          // `created_at` is a new drift and must become actionable again.
          status: sql`CASE
            WHEN ${configReconciliationIssues.status} = 'ignored'
              AND (
                ${configReconciliationIssues.kind} <> 'remote_unbound'
                OR ${configReconciliationIssues.remoteCreatedAt} IS NOT DISTINCT FROM ${params.remoteCreatedAt ?? null}
              )
            THEN 'ignored'
            ELSE 'open'
          END`,
        },
      })
      .returning({ status: configReconciliationIssues.status });
    return (row?.status ?? 'open') as 'open' | 'ignored' | 'resolved';
  }
}
