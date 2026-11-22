import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getDb, initDatabase } from './db.js';
import { logger } from './logger.js';
import dotenv from 'dotenv';
import type { drizzle } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

dotenv.config();

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle'
);

/**
 * Idempotent DDL for receipt deduplication & voiding, catalog discounts,
 * privacy-preserving phone hash verification, first-use nudge, and expired
 * config cleanup. Safe to re-run against both fresh and pre-existing databases.
 */
export const FEATURE_SCHEMA_IDEMPOTENT_SQL: readonly string[] = [
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "file_unique_id" text;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "file_sha256" text;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "duplicate_of_receipt_id" text;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "voided_by" bigint;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "void_reason" text;`,
  `DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'topup_receipts'
      AND c.contype = 'c'
      AND (
        c.conname = 'topup_receipts_status_supported'
        OR (
          array_length(c.conkey, 1) = 1
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = t.oid
              AND a.attnum = c.conkey[1]
              AND a.attname = 'status'
          )
        )
      )
  LOOP
    EXECUTE format('ALTER TABLE "topup_receipts" DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_status_supported" CHECK ("topup_receipts"."status" IN ('pending', 'approved', 'rejected', 'voided'));
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_voided_by_safe_integer" CHECK ("topup_receipts"."voided_by" IS NULL OR ("topup_receipts"."voided_by" > 0 AND "topup_receipts"."voided_by" <= 9007199254740991));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `CREATE INDEX IF NOT EXISTS "topup_receipts_file_unique_id_idx" ON "topup_receipts" USING btree ("file_unique_id");`,
  `CREATE INDEX IF NOT EXISTS "topup_receipts_file_sha256_idx" ON "topup_receipts" USING btree ("file_sha256");`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "card_id" text;`,
  `ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "card_number" text;`,
  `CREATE INDEX IF NOT EXISTS "topup_receipts_card_created_idx" ON "topup_receipts" USING btree ("card_id", "created_at");`,
  `DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'wallet_transactions'
      AND c.contype = 'c'
      AND (
        c.conname = 'wallet_transactions_type_supported'
        OR (
          array_length(c.conkey, 1) = 1
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = t.oid
              AND a.attnum = c.conkey[1]
              AND a.attname = 'type'
          )
        )
      )
  LOOP
    EXECUTE format('ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_type_supported" CHECK ("wallet_transactions"."type" IN ('topup', 'topup_void', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial', 'transfer_sent', 'transfer_received', 'lucky_wheel'));
END $$;`,
  `CREATE TABLE IF NOT EXISTS "catalog_discounts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"target_id" text,
	"discount_type" text NOT NULL,
	"value" integer NOT NULL,
	"max_discount_amount" bigint,
	"starts_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_discounts_scope_supported" CHECK ("catalog_discounts"."scope" IN ('all', 'category', 'package')),
	CONSTRAINT "catalog_discounts_type_supported" CHECK ("catalog_discounts"."discount_type" IN ('percent', 'fixed')),
	CONSTRAINT "catalog_discounts_value_positive" CHECK ("catalog_discounts"."value" > 0),
	CONSTRAINT "catalog_discounts_percent_range" CHECK ("catalog_discounts"."discount_type" <> 'percent' OR "catalog_discounts"."value" <= 100),
	CONSTRAINT "catalog_discounts_max_discount_safe" CHECK ("catalog_discounts"."max_discount_amount" IS NULL OR ("catalog_discounts"."max_discount_amount" > 0 AND "catalog_discounts"."max_discount_amount" <= 9007199254740991))
);`,
  `CREATE INDEX IF NOT EXISTS "catalog_discounts_active_window_idx" ON "catalog_discounts" USING btree ("active", "starts_at", "expires_at");`,
  `CREATE INDEX IF NOT EXISTS "catalog_discounts_scope_target_idx" ON "catalog_discounts" USING btree ("scope", "target_id");`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_hash" text;`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_hash_unique" ON "users" USING btree ("phone_hash") WHERE "users"."phone_hash" IS NOT NULL;`,
  `ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "first_use_checked_at" timestamp;`,
  `ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "cleanup_hold_until" timestamp;`,
  `CREATE INDEX IF NOT EXISTS "user_configs_first_use_pending_idx" ON "user_configs" USING btree ("created_at") WHERE "user_configs"."first_use_checked_at" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "user_configs_expired_cleanup_idx" ON "user_configs" USING btree ("panel_status", "panel_expire", "cleanup_hold_until") WHERE "user_configs"."panel_status" = 'expired';`,
  `DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'notification_deliveries'
      AND c.contype = 'c'
      AND (
        c.conname = 'notification_deliveries_type_supported'
        OR (
          array_length(c.conkey, 1) = 1
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = t.oid
              AND a.attnum = c.conkey[1]
              AND a.attname = 'notification_type'
          )
        )
      )
  LOOP
    EXECUTE format('ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_type_supported" CHECK ("notification_deliveries"."notification_type" IN ('low_traffic', 'near_expiry', 'auto_renew_low_balance', 'auto_renew_package_missing', 'first_use_nudge', 'expired_cleanup_warn_first', 'expired_cleanup_warn_last'));
END $$;`,
  `CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_amount" bigint NOT NULL,
	"payable_amount" bigint NOT NULL,
	"payable_amount_rial" bigint,
	"credited_amount" bigint,
	"cashback_amount" bigint DEFAULT 0 NOT NULL,
	"card_id" text,
	"card_number" text,
	"card_holder" text,
	"bank_name" text,
	"external_id" text,
	"external_payment_id" text,
	"payment_url" text,
	"fiat_amount_usd" text,
	"exchange_rate_toman_per_usd" bigint,
	"pay_currency" text,
	"pay_amount" text,
	"actually_paid" text,
	"provider_status" text,
	"wallet_transaction_id" text,
	"metadata" text,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_provider_supported" CHECK ("payment_orders"."provider" IN ('forapp_card', 'nowpayments')),
	CONSTRAINT "payment_orders_status_supported" CHECK ("payment_orders"."status" IN ('pending', 'confirming', 'partially_paid', 'completed', 'expired', 'failed', 'cancelled')),
	CONSTRAINT "payment_orders_requested_amount_safe" CHECK ("payment_orders"."requested_amount" > 0 AND "payment_orders"."requested_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_payable_amount_safe" CHECK ("payment_orders"."payable_amount" > 0 AND "payment_orders"."payable_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_payable_rial_safe" CHECK ("payment_orders"."payable_amount_rial" IS NULL OR ("payment_orders"."payable_amount_rial" > 0 AND "payment_orders"."payable_amount_rial" <= 9007199254740991)),
	CONSTRAINT "payment_orders_credited_amount_safe" CHECK ("payment_orders"."credited_amount" IS NULL OR ("payment_orders"."credited_amount" >= 0 AND "payment_orders"."credited_amount" <= 9007199254740991)),
	CONSTRAINT "payment_orders_cashback_amount_safe" CHECK ("payment_orders"."cashback_amount" >= 0 AND "payment_orders"."cashback_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_exchange_rate_safe" CHECK ("payment_orders"."exchange_rate_toman_per_usd" IS NULL OR ("payment_orders"."exchange_rate_toman_per_usd" > 0 AND "payment_orders"."exchange_rate_toman_per_usd" <= 9007199254740991))
);`,
  `CREATE INDEX IF NOT EXISTS "payment_orders_user_status_idx" ON "payment_orders" USING btree ("telegram_id", "status", "created_at");`,
  `CREATE INDEX IF NOT EXISTS "payment_orders_forapp_pending_match_idx" ON "payment_orders" USING btree ("payable_amount", "expires_at") WHERE "payment_orders"."provider" = 'forapp_card' AND "payment_orders"."status" = 'pending';`,
  `CREATE INDEX IF NOT EXISTS "payment_orders_external_id_idx" ON "payment_orders" USING btree ("provider", "external_id") WHERE "payment_orders"."external_id" IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS "payment_orders_external_payment_id_idx" ON "payment_orders" USING btree ("external_payment_id") WHERE "payment_orders"."external_payment_id" IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS "payment_orders_expiry_idx" ON "payment_orders" USING btree ("expires_at") WHERE "payment_orders"."status" IN ('pending', 'confirming');`,
  `CREATE TABLE IF NOT EXISTS "forapp_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"forapp_message_id" text,
	"amount_rial" bigint NOT NULL,
	"amount_toman" bigint,
	"unit" text DEFAULT 'rial' NOT NULL,
	"is_deposit" boolean,
	"bank" text,
	"sender" text,
	"code" text,
	"raw_body" text,
	"device" text,
	"received_at" timestamp,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"matched_order_id" text REFERENCES "payment_orders"("id"),
	"matched_telegram_id" bigint REFERENCES "users"("telegram_id"),
	"matched_by_admin_id" bigint,
	"wallet_transaction_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forapp_deposits_status_supported" CHECK ("forapp_deposits"."status" IN ('matched', 'unmatched', 'ignored', 'manual_matched', 'dismissed')),
	CONSTRAINT "forapp_deposits_amount_rial_safe" CHECK ("forapp_deposits"."amount_rial" >= 0 AND "forapp_deposits"."amount_rial" <= 9007199254740991),
	CONSTRAINT "forapp_deposits_amount_toman_safe" CHECK ("forapp_deposits"."amount_toman" IS NULL OR ("forapp_deposits"."amount_toman" >= 0 AND "forapp_deposits"."amount_toman" <= 9007199254740991)),
	CONSTRAINT "forapp_deposits_matched_admin_safe" CHECK ("forapp_deposits"."matched_by_admin_id" IS NULL OR ("forapp_deposits"."matched_by_admin_id" > 0 AND "forapp_deposits"."matched_by_admin_id" <= 9007199254740991))
);`,
  `CREATE INDEX IF NOT EXISTS "forapp_deposits_status_created_idx" ON "forapp_deposits" USING btree ("status", "created_at");`,
  `CREATE INDEX IF NOT EXISTS "forapp_deposits_amount_toman_idx" ON "forapp_deposits" USING btree ("amount_toman") WHERE "forapp_deposits"."status" = 'unmatched';`,
  `CREATE INDEX IF NOT EXISTS "forapp_deposits_matched_order_idx" ON "forapp_deposits" USING btree ("matched_order_id") WHERE "forapp_deposits"."matched_order_id" IS NOT NULL;`,
];

export async function ensureFeatureSchemaMigrations(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  if (typeof (dbInstance as { execute?: unknown } | null | undefined)?.execute !== 'function') {
    return;
  }
  for (const statement of FEATURE_SCHEMA_IDEMPOTENT_SQL) {
    await dbInstance.execute(sql.raw(statement));
  }
}

export async function autoMigrate(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  logger.info('Auto-checking & running database migrations...');
  try {
    await migrate(dbInstance, { migrationsFolder: MIGRATIONS_FOLDER });
    await ensureFeatureSchemaMigrations(dbInstance);
    logger.info('Database migrations applied successfully');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to run database migrations');
    throw err;
  }
}

export async function runMigrationsStandalone(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }
  logger.info('Running standalone database migrations script...');

  initDatabase(dbUrl);
  const db = getDb();

  try {
    await autoMigrate(db);
  } finally {
    await closeDatabase();
  }
}

// Run directly if invoked via CLI
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrationsStandalone().catch(() => process.exit(1));
}
