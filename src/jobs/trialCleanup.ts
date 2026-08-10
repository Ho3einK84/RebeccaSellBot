/**
 * Trial cleanup job — automatically removes expired trial/test configs.
 *
 * A free trial is only ever meant to expire; if, after a grace period, its
 * expiry date has passed it has clearly neither been renewed nor had its expiry
 * extended on the panel, so it is permanently deleted from BOTH the Rebecca
 * panel and the bot's local config table. Because these are trial configs there
 * is no confirmation prompt.
 *
 * Renewal semantics: renewing a config extends the SAME username's expiry on the
 * panel, so a future `expire` value proves the trial is still in use and the
 * sweep leaves it alone. Upgrading to a paid plan normally provisions a new
 * username; the stale trial remains expired and is fair game for cleanup.
 */
import cron from 'node-cron';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../infra/db.js';
import { trialClaims, userConfigs } from '../infra/schema.js';
import { RebeccaApiError, RebeccaOriginDownError } from '../domain/services/RebeccaService.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import type { RebeccaService } from '../domain/services/RebeccaService.js';
import { getRebeccaService } from '../domain/services/RebeccaPanelAccess.js';
import type { ConfigService } from '../domain/services/ConfigService.js';
import { logger } from '../infra/logger.js';
import { forEachConcurrent, jobRunner } from './workerRuntime.js';

/** Trials receive a 3-day grace after expiry before automatic removal. */
export const TRIAL_EXPIRY_GRACE_DAYS = 3;
const SECONDS_PER_DAY = 86_400;

export async function sweepExpiredTrialConfigs(
  panels: RebeccaPanelRegistry | RebeccaService,
  configService: ConfigService,
  now = Date.now()
): Promise<number> {
  const db = getDb();
  const graceCutoffSeconds = Math.floor(now / 1000) - TRIAL_EXPIRY_GRACE_DAYS * SECONDS_PER_DAY;

  // Only completed trial claims that were successfully bound into user_configs.
  const trials = await db
    .select({ panelId: trialClaims.panelId, configUsername: trialClaims.configUsername })
    .from(trialClaims)
    .innerJoin(
      userConfigs,
      sql`${trialClaims.panelId} = ${userConfigs.panelId}
        AND ${trialClaims.configUsername} = ${userConfigs.configUsername}`
    )
    .where(eq(trialClaims.status, 'completed'));

  if (trials.length === 0) return 0;

  let removed = 0;
  await forEachConcurrent(trials, 4, async (trial) => {
    const reason = await trialExpiryReason(
      panels,
      trial.panelId,
      trial.configUsername,
      graceCutoffSeconds
    );
    if (reason === null) return;

    try {
      if (trial.panelId) {
        await configService.deleteConfigCompletely(trial.configUsername, trial.panelId);
      } else {
        await configService.deleteConfigCompletely(trial.configUsername);
      }
      removed += 1;
      logger.info(
        { configUsername: trial.configUsername, reason },
        'Expired trial config permanently deleted'
      );
    } catch (err) {
      logger.error(
        { err, configUsername: trial.configUsername },
        'Failed to permanently delete expired trial config'
      );
    }
  });

  logger.info({ checked: trials.length, removed }, 'Trial cleanup sweep complete');
  return removed;
}

/**
 * Decide whether a trial has been expired for more than the grace period.
 * Returns a short reason string, or null when the trial should be kept.
 */
async function trialExpiryReason(
  panels: RebeccaPanelRegistry | RebeccaService,
  panelId: string,
  configUsername: string,
  graceCutoffSeconds: number
): Promise<'expired' | 'deleted' | null> {
  try {
    const remote = await getRebeccaService(panels, panelId).getUser(configUsername);
    if (remote.status === 'deleted') return 'deleted';
    if (typeof remote.expire === 'number' && remote.expire <= graceCutoffSeconds) {
      return 'expired';
    }
    return null;
  } catch (err) {
    if (err instanceof RebeccaApiError && err.status === 404) {
      // Already absent on the panel — the local row is stale; purge it.
      return 'deleted';
    }
    if (err instanceof RebeccaOriginDownError) {
      // Panel unreachable — defer the whole sweep rather than deleting blindly.
      logger.warn({ configUsername }, 'Trial cleanup deferred: Rebecca panel origin down');
      return null;
    }
    logger.warn({ err, configUsername }, 'Trial cleanup deferred: remote state unavailable');
    return null;
  }
}

let task: ReturnType<typeof cron.schedule> | null = null;
export function startTrialCleanupCron(
  panels: RebeccaPanelRegistry,
  configService: ConfigService,
  schedule = '30 3 * * *'
): void {
  stopTrialCleanupCron();
  const run = async (): Promise<void> => {
    try {
      await jobRunner.run('trial-cleanup', async () => {
        await sweepExpiredTrialConfigs(panels, configService);
      });
    } catch (err) {
      logger.error({ err }, 'Error in trial cleanup cron worker');
    }
  };

  void run();
  task = cron.schedule(schedule, () => {
    void run();
  });
  logger.info('Trial cleanup cron worker started (daily at 03:30 UTC)');
}

export function stopTrialCleanupCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
