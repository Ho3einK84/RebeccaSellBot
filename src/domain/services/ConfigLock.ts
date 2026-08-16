import crypto from 'node:crypto';
import { getPool } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';

export class ConfigMutationBusyError extends Error {
  constructor(message = 'CONFIG_MUTATION_BUSY') {
    super(message);
    this.name = 'ConfigMutationBusyError';
  }
}

export function configLockKey(panelId: string, configUsername: string): bigint {
  const digest = crypto
    .createHash('sha256')
    .update(`RebeccaSellBot:config_mutation:${panelId}:${configUsername.toLowerCase()}`)
    .digest();
  const unsigned = digest.readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned);
}

export async function withConfigLock<T>(
  panelId: string,
  configUsername: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = configLockKey(panelId, configUsername);
  const client = await getPool()
    .connect()
    .catch((err: unknown) => {
      throw new Error('CONFIG_MUTATION_LOCK_UNAVAILABLE', { cause: err });
    });

  // Never block a pool connection behind another long-running remote API call.
  // A contender fails fast and can be retried by the user/UI instead of
  // exhausting the PostgreSQL pool under a revoke/renew burst.
  const result = await client
    .query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS locked', [
      lockKey.toString(),
    ])
    .catch((err: unknown) => {
      client.release(err instanceof Error ? err : true);
      throw new Error('CONFIG_MUTATION_LOCK_UNAVAILABLE', { cause: err });
    });

  if (!result.rows[0]?.locked) {
    client.release();
    throw new ConfigMutationBusyError('CONFIG_MUTATION_BUSY');
  }

  try {
    return await fn();
  } finally {
    let releaseError: Error | undefined;
    try {
      const unlock = await client.query<{ unlocked: boolean }>(
        'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
        [lockKey.toString()]
      );
      if (!unlock.rows[0]?.unlocked) {
        releaseError = new Error('CONFIG_MUTATION_UNLOCK_FAILED');
        logger.error(
          { panelId, configUsername },
          'PostgreSQL advisory config lock was not owned during release'
        );
      }
    } catch (err) {
      releaseError =
        err instanceof Error ? err : new Error('CONFIG_MUTATION_UNLOCK_FAILED', { cause: err });
      logger.error(
        { err, panelId, configUsername },
        'Failed to release PostgreSQL advisory config lock; discarding connection'
      );
    }

    // Advisory locks are session-scoped. If unlock failed, passing an error to
    // release() evicts this client instead of returning a possibly locked
    // PostgreSQL session to the pool.
    client.release(releaseError);
  }
}
