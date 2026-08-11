import { sql } from 'drizzle-orm';
import { userConfigs } from '../../infra/schema.js';
import type { RebeccaUserDetail } from './RebeccaService.js';

/** Values observed from Rebecca that are safe to cache alongside a local binding. */
export function observedConfigLifecycle(remote: RebeccaUserDetail, observedAt = new Date()) {
  return {
    panelStatus: remote.status,
    panelDataLimit: remote.data_limit,
    panelExpire: remote.expire,
    lastSyncedAt: observedAt,
    updatedAt: observedAt,
  };
}

/** SQL expression used transactionally after a lifecycle-affecting config write. */
export function activeConfigCountSql(telegramId: number) {
  return sql`(
    SELECT COUNT(*)::integer FROM ${userConfigs}
    WHERE ${userConfigs.telegramId} = ${telegramId}
      AND ${userConfigs.panelStatus} = 'active'
  )`;
}
