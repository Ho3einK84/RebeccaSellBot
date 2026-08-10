import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { auditLogs, notificationDeliveries, userConfigs, users } from '../../infra/schema.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { RebeccaService } from './RebeccaService.js';
import {
  normalizeRebeccaPanelAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';

export class ConfigTransferService {
  private readonly panels: NormalizedRebeccaPanelAccess;

  constructor(panels: RebeccaPanelRegistry | RebeccaService) {
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  async transfer(params: {
    configId: string;
    fromTelegramId: number;
    toTelegramId: number;
    actorTelegramId: number;
    allowAdminOverride?: boolean;
  }): Promise<{ configUsername: string; fromTelegramId: number; toTelegramId: number }> {
    if (params.fromTelegramId === params.toTelegramId) throw new Error('TRANSFER_TO_SELF');
    const db = getDb();

    const [target] = await db
      .select({ telegramId: users.telegramId, isBanned: users.isBanned })
      .from(users)
      .where(eq(users.telegramId, params.toTelegramId))
      .limit(1);
    if (!target) throw new Error('TRANSFER_TARGET_NOT_FOUND');
    if (target.isBanned) throw new Error('TRANSFER_TARGET_BANNED');

    const [config] = await db
      .select()
      .from(userConfigs)
      .where(eq(userConfigs.id, params.configId))
      .limit(1);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    if (!params.allowAdminOverride && config.telegramId !== params.fromTelegramId) {
      throw new Error('CONFIG_NOT_OWNED');
    }

    // Never move a stale/deleted local shell. The panel remains the authority.
    const remote = await this.panels.getService(config.panelId).getUser(config.configUsername);
    if (remote.status === 'deleted') throw new Error('CONFIG_REMOTE_DELETED');

    return db.transaction(async (tx) => {
      // Conditional owner match makes a concurrent transfer lose safely.
      const [moved] = await tx
        .update(userConfigs)
        .set({
          telegramId: params.toTelegramId,
          autoRenewEnabled: false,
          autoRenewPackageId: null,
          autoRenewPrice: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(userConfigs.id, params.configId), eq(userConfigs.telegramId, config.telegramId))
        )
        .returning({ configUsername: userConfigs.configUsername });
      if (!moved) throw new Error('TRANSFER_CONFLICT');

      await tx
        .delete(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.panelId, config.panelId),
            eq(notificationDeliveries.configUsername, moved.configUsername)
          )
        );

      for (const telegramId of [config.telegramId, params.toTelegramId]) {
        await tx
          .update(users)
          .set({
            activeSubscriptionCount: sql`(
              SELECT COUNT(*)::integer FROM ${userConfigs}
              WHERE ${userConfigs.telegramId} = ${telegramId}
                AND ${userConfigs.panelStatus} = 'active'
            )`,
            updatedAt: new Date(),
          })
          .where(eq(users.telegramId, telegramId));
      }

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.actorTelegramId,
        action: 'subscription_transferred',
        entityType: 'user_config',
        entityId: params.configId,
        targetTelegramId: params.toTelegramId,
        metadata: JSON.stringify({
          configUsername: moved.configUsername,
          fromTelegramId: config.telegramId,
          toTelegramId: params.toTelegramId,
          autoRenewReset: config.autoRenewEnabled,
        }),
      });

      return {
        configUsername: moved.configUsername,
        fromTelegramId: config.telegramId,
        toTelegramId: params.toTelegramId,
      };
    });
  }
}
