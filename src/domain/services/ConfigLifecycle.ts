import { sql } from 'drizzle-orm';
import { userConfigs } from '../../infra/schema.js';
import type { RebeccaUserDetail } from './RebeccaService.js';

export type ConfigLifecycleObservation = Pick<
  RebeccaUserDetail,
  'status' | 'data_limit' | 'expire' | 'used_traffic'
>;

/** Values observed from Rebecca that are safe to cache alongside a local binding. */
export function observedConfigLifecycle(
  remote: ConfigLifecycleObservation,
  observedAt = new Date()
) {
  return {
    panelStatus: remote.status,
    panelDataLimit: remote.data_limit,
    panelUsedTraffic: remote.used_traffic,
    panelExpire: remote.expire,
    lastSyncedAt: observedAt,
    updatedAt: observedAt,
  };
}

/** Preserve the last known limits while recording a terminal missing observation. */
export function deletedConfigLifecycle(observedAt = new Date()) {
  return {
    panelStatus: 'deleted' as const,
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

export type ConfigTrafficAndStatusSource = {
  panelStatus?: string | null;
  panelDataLimit?: number | bigint | null;
  panelUsedTraffic?: number | bigint | null;
  panelExpire?: number | bigint | null;
};

export type RemoteUserDetailSource = {
  status?: string | null;
  data_limit?: number | null;
  used_traffic?: number | null;
  expire?: number | null;
};

export type CalculatedTraffic = {
  dataLimit: number | null;
  usedTraffic: number | null;
  remainingBytes: number | null;
  isUnlimited: boolean;
  isCached: boolean;
  isUnavailable: boolean;
};

export function calculateTraffic(
  remote?: RemoteUserDetailSource | null,
  local?: ConfigTrafficAndStatusSource | null
): CalculatedTraffic {
  let dataLimit: number | null = null;
  let usedTraffic: number | null = null;
  let isCached = false;

  if (remote) {
    dataLimit = remote.data_limit ?? null;
    usedTraffic = remote.used_traffic ?? null;
    isCached = false;
  } else if (local) {
    dataLimit = local.panelDataLimit != null ? Number(local.panelDataLimit) : null;
    usedTraffic = local.panelUsedTraffic != null ? Number(local.panelUsedTraffic) : null;
    isCached = true;
  }

  const isUnlimited = dataLimit == null;
  const isUnavailable = !remote && local?.panelUsedTraffic == null && local?.panelDataLimit == null;
  const remainingBytes =
    dataLimit == null || usedTraffic == null ? null : Math.max(0, dataLimit - usedTraffic);

  return {
    dataLimit,
    usedTraffic,
    remainingBytes,
    isUnlimited,
    isCached,
    isUnavailable,
  };
}

export function isConfigActive(
  remote?: RemoteUserDetailSource | null,
  local?: ConfigTrafficAndStatusSource | null,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const status = remote?.status ?? local?.panelStatus;
  if (!status || status !== 'active') return false;

  const expire = remote?.expire ?? (local?.panelExpire != null ? Number(local.panelExpire) : null);
  if (expire != null && expire <= nowSeconds) return false;

  const traffic = calculateTraffic(remote, local);
  if (
    traffic.dataLimit != null &&
    traffic.usedTraffic != null &&
    traffic.usedTraffic >= traffic.dataLimit
  ) {
    return false;
  }

  return true;
}
