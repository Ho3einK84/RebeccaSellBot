import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import type { RebeccaUserDetail } from '../../../src/domain/services/RebeccaService.js';
import { closeDatabase, getDb, getPool, initDatabase } from '../../../src/infra/db.js';
import { autoMigrate } from '../../../src/infra/migrate.js';
import { users } from '../../../src/infra/schema.js';

export const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!databaseUrl && process.env.REQUIRE_INTEGRATION_DB === '1') {
  throw new Error('TEST_DATABASE_URL must be set when REQUIRE_INTEGRATION_DB=1');
}

export const describeIntegration = databaseUrl ? describe : describe.skip;

// Preserve migration-seeded `rebecca_panels` and `rebecca_panel_services` catalog
// rows while purging every runtime/transactional table between test cases.
const RUNTIME_TABLES_TRUNCATE_SQL = `TRUNCATE TABLE
  audit_logs,
  bot_admins,
  broadcast_recipients,
  broadcast_jobs,
  bulk_gift_items,
  bulk_gift_jobs,
  code_redemptions,
  config_counters,
  config_reconciliation_issues,
  forapp_deposits,
  grammy_sessions,
  lucky_wheel_spins,
  notification_deliveries,
  package_categories,
  payment_orders,
  promo_codes,
  purchase_checkouts,
  purchase_intents,
  refund_intents,
  scheduled_message_deletions,
  settings,
  topup_receipts,
  trial_claims,
  user_configs,
  users,
  wallet_transactions
CASCADE`;

export async function setupIntegrationDb(): Promise<void> {
  initDatabase(databaseUrl!);
  await autoMigrate(getDb());
}

export async function resetIntegrationTables(): Promise<void> {
  await getPool().query(RUNTIME_TABLES_TRUNCATE_SQL);
}

export async function teardownIntegrationDb(): Promise<void> {
  if (databaseUrl) {
    await closeDatabase();
  }
}

export function registerIntegrationLifecycleHooks(): void {
  beforeAll(async () => {
    await setupIntegrationDb();
  });

  beforeEach(async () => {
    await resetIntegrationTables();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });
}

export async function seedIntegrationUser(
  telegramId: number,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<void> {
  await getDb()
    .insert(users)
    .values({
      telegramId,
      referralCode: `ref_${telegramId}_integration`,
      balance: 0,
      reservedBalance: 0,
      locale: 'en',
      ...overrides,
    });
}

export function remoteUser(
  username: string,
  overrides: Partial<RebeccaUserDetail> = {}
): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * 1024 ** 3,
    expire: Math.floor(Date.now() / 1000) + 30 * 86_400,
    created_at: new Date().toISOString(),
    subscription_url: `https://rebecca.example/sub/${username}`,
    subscription_urls: {},
    links: [],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: null,
    admin_username: null,
    ...overrides,
  };
}
