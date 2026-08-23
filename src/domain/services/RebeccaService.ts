/**
 * RebeccaService — domain-layer facade over RebeccaApiClient.
 *
 * Rules:
 *  - This is the ONLY module in the codebase that calls RebeccaApiClient.
 *  - It adds structured logging, domain-level error classification, and
 *    an admin-alert hook so callers can distinguish "panel is down" from
 *    any other failure without importing infra types.
 *  - It re-exports the error types so upper layers can catch them without
 *    a direct import from infra/.
 *
 * Error taxonomy surfaced to callers:
 *   RebeccaOriginDownError  — panel unreachable; inspect requestDispatched before rollback
 *   RebeccaApiError         — panel returned a 4xx/5xx; may need inspection
 *   RebeccaContractError    — panel returned 2xx with an invalid response shape
 *   Error                   — unexpected / programming error
 */

import type {
  RebeccaApiClient,
  RebeccaUserDetail,
  RebeccaUsersResponse,
  RebeccaCreateUserPayload,
  RebeccaUpdateUserPayload,
  RebeccaDeleteResponse,
  RebeccaConnectionOptions,
  UserStatus,
} from '../../infra/RebeccaApiClient.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
} from '../../infra/RebeccaApiClient.js';
import { logger } from '../../infra/logger.js';

// Re-export so callers don't need to reach into infra/
export { RebeccaApiError, RebeccaContractError, RebeccaOriginDownError };
export type {
  RebeccaUserDetail,
  RebeccaUsersResponse,
  RebeccaCreateUserPayload,
  RebeccaUpdateUserPayload,
  RebeccaDeleteResponse,
  UserStatus,
};

// Optional callback the bot can register to fire an admin Telegram alert
// when the panel goes down. The domain emits structured, locale-neutral data;
// Telegram renders it through TranslationService without creating a circular
// dependency on the delivery layer.
export type RebeccaOutageAlert = {
  kind: 'rebecca_origin_down';
  panelId?: string;
  panelName?: string;
  endpoint: string;
  attempts: number;
};

type AdminAlertFn = (alert: RebeccaOutageAlert) => Promise<void>;
let _adminAlert: AdminAlertFn | null = null;
const OUTAGE_ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const lastOutageAlertAt = new Map<string, number>();

export function registerAdminAlertHook(fn: AdminAlertFn): void {
  _adminAlert = fn;
}

async function fireAdminAlert(alert: RebeccaOutageAlert): Promise<void> {
  if (!_adminAlert) return;
  const now = Date.now();
  const key = alert.panelId ?? 'legacy';
  if (now - (lastOutageAlertAt.get(key) ?? 0) < OUTAGE_ALERT_COOLDOWN_MS) return;
  lastOutageAlertAt.set(key, now);
  try {
    await _adminAlert(alert);
  } catch (err) {
    logger.error({ err }, 'Failed to fire admin alert');
  }
}

function markPanelHealthy(panelId = 'legacy'): void {
  // A later outage after any confirmed successful request is a new incident
  // and should alert immediately instead of waiting for the old cooldown.
  lastOutageAlertAt.delete(panelId);
}

function safeRebeccaError(err: unknown): Record<string, unknown> {
  if (err instanceof RebeccaOriginDownError) {
    return {
      name: err.name,
      endpoint: redactEndpoint(err.endpoint),
      lastStatus: err.lastStatus,
      attempts: err.attempts,
      requestDispatched: err.requestDispatched,
    };
  }
  if (err instanceof RebeccaApiError) {
    return { name: err.name, endpoint: redactEndpoint(err.endpoint), status: err.status };
  }
  if (err instanceof RebeccaContractError) {
    return { name: err.name, endpoint: redactEndpoint(err.endpoint), issueCount: err.issueCount };
  }
  return { name: err instanceof Error ? err.name : typeof err };
}

function redactEndpoint(endpoint: string): string {
  const question = endpoint.indexOf('?');
  return question === -1 ? endpoint : `${endpoint.slice(0, question)}?…`;
}

export class RebeccaService {
  constructor(
    private readonly client: RebeccaApiClient,
    private readonly panel: { panelId?: string; panelName?: string } = {}
  ) {}

  private outageAlert(endpoint: string, attempts: number): RebeccaOutageAlert {
    return {
      kind: 'rebecca_origin_down',
      ...(this.panel.panelId ? { panelId: this.panel.panelId } : {}),
      ...(this.panel.panelName ? { panelName: this.panel.panelName } : {}),
      endpoint,
      attempts,
    };
  }

  private markHealthy(): void {
    markPanelHealthy(this.panel.panelId);
    this.client.resetCircuitBreaker();
  }

  resetCircuitBreaker(): void {
    this.client.resetCircuitBreaker();
    markPanelHealthy(this.panel.panelId);
  }

  isCircuitOpen(): boolean {
    return this.client.isCircuitOpen();
  }

  // ── Read operations ────────────────────────────────────────────────────────

  async getUser(username: string): Promise<RebeccaUserDetail> {
    try {
      const result = await this.client.getUser(username);
      this.markHealthy();
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert(`GET /api/user/${username}`, err.attempts));
      }
      throw err;
    }
  }

  async getUsers(
    offset = 0,
    limit = 100,
    search?: string,
    status?: UserStatus,
    includeLinks = false
  ): Promise<RebeccaUsersResponse> {
    try {
      const result = await this.client.getUsers(offset, limit, search, status, includeLinks);
      this.markHealthy();
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert('GET /api/users', err.attempts));
      }
      throw err;
    }
  }

  configureConnection(options: Partial<RebeccaConnectionOptions>): void {
    this.client.configure(options);
    logger.info(
      {
        baseUrlChanged: options.baseUrl !== undefined,
        apiKeyChanged: options.apiKey !== undefined,
      },
      'Rebecca API connection settings updated'
    );
  }

  // ── Write operations ───────────────────────────────────────────────────────

  async createUser(payload: RebeccaCreateUserPayload): Promise<RebeccaUserDetail> {
    logger.info({ username: payload.username }, 'RebeccaService: creating user on panel');
    try {
      const result = await this.client.createUser(payload);
      this.markHealthy();
      logger.info(
        { username: result.username, status: result.status },
        'RebeccaService: user created'
      );
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert(`POST /api/user/${payload.username}`, err.attempts));
      }
      logger.error(
        { error: safeRebeccaError(err), username: payload.username },
        'RebeccaService: createUser failed'
      );
      throw err;
    }
  }

  async updateUser(
    username: string,
    payload: RebeccaUpdateUserPayload
  ): Promise<RebeccaUserDetail> {
    logger.info(
      { username, fields: Object.keys(payload) },
      'RebeccaService: updating user on panel'
    );
    try {
      const result = await this.client.updateUser(username, payload);
      this.markHealthy();
      logger.info({ username, status: result.status }, 'RebeccaService: user updated');
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert(`PUT /api/user/${username}`, err.attempts));
      }
      logger.error({ error: safeRebeccaError(err), username }, 'RebeccaService: updateUser failed');
      throw err;
    }
  }

  async deleteUser(username: string): Promise<RebeccaDeleteResponse> {
    logger.info({ username }, 'RebeccaService: deleting user from panel');
    try {
      const result = await this.client.deleteUser(username);
      this.markHealthy();
      logger.info({ username, status: result.status }, 'RebeccaService: user deleted');
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert(`DELETE /api/user/${username}`, err.attempts));
      }
      logger.error({ error: safeRebeccaError(err), username }, 'RebeccaService: deleteUser failed');
      throw err;
    }
  }

  async resetUserTraffic(username: string): Promise<RebeccaUserDetail> {
    logger.info({ username }, 'RebeccaService: resetting user traffic');
    try {
      const result = await this.client.resetUserTraffic(username);
      this.markHealthy();
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(this.outageAlert(`POST /api/user/${username}/reset`, err.attempts));
      }
      throw err;
    }
  }

  async revokeSubscription(username: string): Promise<RebeccaUserDetail> {
    logger.info({ username }, 'RebeccaService: revoking subscription key');
    try {
      const result = await this.client.revokeSubscription(username);
      this.markHealthy();
      return result;
    } catch (err) {
      if (err instanceof RebeccaOriginDownError) {
        void fireAdminAlert(
          this.outageAlert(`POST /api/user/${username}/revoke_sub`, err.attempts)
        );
      }
      throw err;
    }
  }

  async enableUser(username: string): Promise<RebeccaUserDetail> {
    logger.info({ username }, 'RebeccaService: enabling user');
    return this.updateUser(username, { status: 'active' });
  }

  async disableUser(username: string): Promise<RebeccaUserDetail> {
    logger.info({ username }, 'RebeccaService: disabling user');
    return this.updateUser(username, { status: 'disabled' });
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  async checkHealth(): Promise<boolean> {
    const healthy = await this.client.checkHealth();
    if (healthy) this.markHealthy();
    return healthy;
  }

  // ── Naming counter sync helper ─────────────────────────────────────────────

  /**
   * Scans all usernames on the panel matching a given prefix pattern and returns
   * the highest numeric suffix found. Used by ConfigService.syncCounters() on startup.
   *
   * Example: prefix="shop" matches "shop_0042", "shop_0137" → returns 137
   */
  async getHighestCounterForPrefix(prefix: string): Promise<number> {
    let highest = 0;
    let offset = 0;
    const limit = 200;
    const pattern = new RegExp(`^${escapeRegExp(prefix)}_?(\\d+)$`, 'i');

    for (;;) {
      const res = await this.getUsers(offset, limit, prefix);
      for (const u of res.users) {
        const m = u.username.match(pattern);
        if (m && m[1]) {
          const n = parseInt(m[1], 10);
          if (n > highest) highest = n;
        }
      }
      offset += limit;
      if (offset >= res.total) break;
    }

    return highest;
  }

  async getHighestCounters(
    patterns: Readonly<Record<string, RegExp>>
  ): Promise<Record<string, number>> {
    const entries = Object.entries(patterns);
    const highest = Object.fromEntries(entries.map(([name]) => [name, 0])) as Record<
      string,
      number
    >;
    let offset = 0;
    const limit = 200;

    for (;;) {
      const res = await this.getUsers(offset, limit);
      for (const user of res.users) {
        for (const [name, pattern] of entries) {
          const match = user.username.match(pattern);
          const counter = match?.groups?.counter;
          if (!counter) continue;
          const parsed = Number.parseInt(counter, 10);
          if (Number.isSafeInteger(parsed) && parsed > (highest[name] ?? 0)) {
            highest[name] = parsed;
          }
        }
      }
      offset += limit;
      if (offset >= res.total) return highest;
    }
  }

  async getHighestCounter(pattern: RegExp): Promise<number> {
    const result = await this.getHighestCounters({ counter: pattern });
    return result.counter ?? 0;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
