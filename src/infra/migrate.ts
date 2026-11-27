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
  `CREATE TABLE IF NOT EXISTS "bulk_gift_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_telegram_id" bigint NOT NULL,
	"gift_gb" integer DEFAULT 0 NOT NULL,
	"gift_days" integer DEFAULT 0 NOT NULL,
	"target_statuses" text NOT NULL,
	"panel_id" text REFERENCES "rebecca_panels"("id"),
	"service_id" integer,
	"notify_message" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_gift_jobs_actor_safe" CHECK ("bulk_gift_jobs"."actor_telegram_id" > 0 AND "bulk_gift_jobs"."actor_telegram_id" <= 9007199254740991),
	CONSTRAINT "bulk_gift_jobs_gift_positive" CHECK ("bulk_gift_jobs"."gift_gb" >= 0 AND "bulk_gift_jobs"."gift_days" >= 0 AND ("bulk_gift_jobs"."gift_gb" > 0 OR "bulk_gift_jobs"."gift_days" > 0) AND "bulk_gift_jobs"."gift_gb" <= 10000 AND "bulk_gift_jobs"."gift_days" <= 3650),
	CONSTRAINT "bulk_gift_jobs_service_id_safe" CHECK ("bulk_gift_jobs"."service_id" IS NULL OR ("bulk_gift_jobs"."service_id" > 0 AND "bulk_gift_jobs"."service_id" <= 2147483647)),
	CONSTRAINT "bulk_gift_jobs_status_supported" CHECK ("bulk_gift_jobs"."status" IN ('queued', 'running', 'cancel_requested', 'cancelled', 'completed')),
	CONSTRAINT "bulk_gift_jobs_counts_safe" CHECK ("bulk_gift_jobs"."total_count" >= 0 AND "bulk_gift_jobs"."applied_count" >= 0 AND "bulk_gift_jobs"."failed_count" >= 0 AND "bulk_gift_jobs"."skipped_count" >= 0 AND "bulk_gift_jobs"."applied_count" + "bulk_gift_jobs"."failed_count" + "bulk_gift_jobs"."skipped_count" <= "bulk_gift_jobs"."total_count")
);`,
  `CREATE INDEX IF NOT EXISTS "bulk_gift_jobs_runnable_idx" ON "bulk_gift_jobs" USING btree ("created_at") WHERE "bulk_gift_jobs"."status" IN ('queued', 'running', 'cancel_requested');`,
  `CREATE TABLE IF NOT EXISTS "bulk_gift_items" (
	"job_id" uuid NOT NULL REFERENCES "bulk_gift_jobs"("id") ON DELETE cascade,
	"config_id" text NOT NULL,
	"telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
	"panel_id" text NOT NULL REFERENCES "rebecca_panels"("id"),
	"service_id" integer NOT NULL,
	"config_username" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"applied_at" timestamp,
	"notified_at" timestamp,
	"previous_data_limit" bigint,
	"new_data_limit" bigint,
	"previous_expire" bigint,
	"new_expire" bigint,
	"previous_on_hold_duration" bigint,
	"new_on_hold_duration" bigint,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_gift_items_job_id_config_id_pk" PRIMARY KEY("job_id","config_id"),
	CONSTRAINT "bulk_gift_items_status_supported" CHECK ("bulk_gift_items"."status" IN ('pending', 'processing', 'applied', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "bulk_gift_items_attempts_safe" CHECK ("bulk_gift_items"."attempts" >= 0),
	CONSTRAINT "bulk_gift_items_service_id_positive" CHECK ("bulk_gift_items"."service_id" > 0 AND "bulk_gift_items"."service_id" <= 2147483647)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "bulk_gift_items_job_panel_username_unique" ON "bulk_gift_items" USING btree ("job_id", "panel_id", "config_username");`,
  `CREATE INDEX IF NOT EXISTS "bulk_gift_items_pending_idx" ON "bulk_gift_items" USING btree ("job_id", "config_id") WHERE "bulk_gift_items"."status" = 'pending';`,
  `CREATE INDEX IF NOT EXISTS "bulk_gift_items_stale_idx" ON "bulk_gift_items" USING btree ("claimed_at") WHERE "bulk_gift_items"."status" = 'processing';`,
  `ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "user_label" text;`,
  `DO $$ BEGIN
  ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_user_label_valid_chk" CHECK ("user_configs"."user_label" IS NULL OR (char_length(btrim("user_configs"."user_label")) BETWEEN 1 AND 40));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `CREATE TABLE IF NOT EXISTS "scheduled_message_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"reason" text NOT NULL,
	"delete_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_message_deletions_chat_id_chk" CHECK ("scheduled_message_deletions"."chat_id" <> 0),
	CONSTRAINT "scheduled_message_deletions_message_id_chk" CHECK ("scheduled_message_deletions"."message_id" > 0),
	CONSTRAINT "scheduled_message_deletions_status_chk" CHECK ("scheduled_message_deletions"."status" IN ('pending', 'deleted', 'failed', 'cancelled')),
	CONSTRAINT "scheduled_message_deletions_attempts_chk" CHECK ("scheduled_message_deletions"."attempts" >= 0)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_message_deletions_chat_msg_uidx" ON "scheduled_message_deletions" USING btree ("chat_id", "message_id");`,
  `CREATE INDEX IF NOT EXISTS "scheduled_message_deletions_due_idx" ON "scheduled_message_deletions" USING btree ("delete_at") WHERE "scheduled_message_deletions"."status" = 'pending';`,
  `CREATE TABLE IF NOT EXISTS "user_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"badge" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"apply_discount_to_custom_volume" boolean DEFAULT false NOT NULL,
	"custom_price_per_gb" bigint,
	"custom_price_per_day" bigint,
	"allow_catalog_discounts" boolean DEFAULT true NOT NULL,
	"allow_promo_codes" boolean DEFAULT true NOT NULL,
	"allow_cashback" boolean DEFAULT true NOT NULL,
	"allow_lucky_wheel" boolean DEFAULT true NOT NULL,
	"allow_custom_service_name" boolean DEFAULT false NOT NULL,
	"credit_limit" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_groups_name_present" CHECK (length(btrim("user_groups"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "user_groups_badge_valid" CHECK ("user_groups"."badge" IS NULL OR (length(btrim("user_groups"."badge")) BETWEEN 1 AND 40)),
	CONSTRAINT "user_groups_discount_percent_range" CHECK ("user_groups"."discount_percent" BETWEEN 0 AND 90),
	CONSTRAINT "user_groups_custom_price_per_gb_safe" CHECK ("user_groups"."custom_price_per_gb" IS NULL OR ("user_groups"."custom_price_per_gb" >= 0 AND "user_groups"."custom_price_per_gb" <= 9007199254740991)),
	CONSTRAINT "user_groups_custom_price_per_day_safe" CHECK ("user_groups"."custom_price_per_day" IS NULL OR ("user_groups"."custom_price_per_day" >= 0 AND "user_groups"."custom_price_per_day" <= 9007199254740991)),
	CONSTRAINT "user_groups_credit_limit_safe" CHECK ("user_groups"."credit_limit" >= 0 AND "user_groups"."credit_limit" <= 9007199254740991)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "user_groups_one_default" ON "user_groups" USING btree ("is_default") WHERE "user_groups"."is_default" = true;`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "group_id" text;`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "group_expires_at" timestamp;`,
  `DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `CREATE INDEX IF NOT EXISTS "users_group_id_idx" ON "users" USING btree ("group_id");`,
  `DO $$ BEGIN
  ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_available_balance_nonnegative";
  ALTER TABLE "users" ADD CONSTRAINT "users_available_balance_nonnegative" CHECK (("users"."balance" - "users"."reserved_balance") BETWEEN -9007199254740991 AND 9007199254740991);
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_balance_safe_integer";
  ALTER TABLE "users" ADD CONSTRAINT "users_balance_safe_integer" CHECK ("users"."balance" BETWEEN -9007199254740991 AND 9007199254740991);
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_balance_after_safe_integer";
  ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_after_safe_integer" CHECK ("wallet_transactions"."balance_after" BETWEEN -9007199254740991 AND 9007199254740991);
END $$;`,
  `ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "credit_limit" bigint DEFAULT 0 NOT NULL;`,
  `DO $$ BEGIN
  ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_credit_limit_safe" CHECK ("purchase_intents"."credit_limit" >= 0 AND "purchase_intents"."credit_limit" <= 9007199254740991);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TABLE "broadcast_jobs" ADD COLUMN IF NOT EXISTS "group_id" text;`,
  `DO $$ BEGIN
  ALTER TABLE "broadcast_jobs" ADD CONSTRAINT "broadcast_jobs_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TABLE "user_groups" ADD COLUMN IF NOT EXISTS "apply_discount_to_custom_volume" boolean DEFAULT false NOT NULL;`,
  `DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'trial_claims'
      AND column_name = 'gb_amount'
      AND data_type <> 'double precision'
  ) THEN
    ALTER TABLE "trial_claims" ALTER COLUMN "gb_amount" TYPE double precision USING "gb_amount"::double precision;
  END IF;
END $$;`,
  `ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "max_configs" integer;`,
  `ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "stock_remaining" integer;`,
  `ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "daily_create_limit" integer;`,
  `ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "reserved_creations" integer DEFAULT 0 NOT NULL;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_max_configs_safe" CHECK ("rebecca_panels"."max_configs" IS NULL OR "rebecca_panels"."max_configs" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_stock_remaining_safe" CHECK ("rebecca_panels"."stock_remaining" IS NULL OR "rebecca_panels"."stock_remaining" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_daily_create_limit_safe" CHECK ("rebecca_panels"."daily_create_limit" IS NULL OR "rebecca_panels"."daily_create_limit" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_reserved_creations_nonnegative" CHECK ("rebecca_panels"."reserved_creations" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;`,
  `ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "max_configs" integer;`,
  `ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "stock_remaining" integer;`,
  `ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "daily_create_limit" integer;`,
  `ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "reserved_creations" integer DEFAULT 0 NOT NULL;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_max_configs_safe" CHECK ("rebecca_panel_services"."max_configs" IS NULL OR "rebecca_panel_services"."max_configs" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_stock_remaining_safe" CHECK ("rebecca_panel_services"."stock_remaining" IS NULL OR "rebecca_panel_services"."stock_remaining" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_daily_create_limit_safe" CHECK ("rebecca_panel_services"."daily_create_limit" IS NULL OR "rebecca_panel_services"."daily_create_limit" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_reserved_creations_nonnegative" CHECK ("rebecca_panel_services"."reserved_creations" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `CREATE INDEX IF NOT EXISTS "user_configs_panel_service_status_idx" ON "user_configs" USING btree ("panel_id", "service_id", "panel_status");`,
  `CREATE TABLE IF NOT EXISTS "package_inventory" (
	"package_id" text PRIMARY KEY NOT NULL,
	"stock_remaining" integer,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"max_purchases_per_user" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "package_inventory_id_safe" CHECK (length(btrim("package_inventory"."package_id")) BETWEEN 1 AND 80),
	CONSTRAINT "package_inventory_stock_remaining_safe" CHECK ("package_inventory"."stock_remaining" IS NULL OR "package_inventory"."stock_remaining" >= 0),
	CONSTRAINT "package_inventory_reserved_count_nonnegative" CHECK ("package_inventory"."reserved_count" >= 0),
	CONSTRAINT "package_inventory_sold_count_nonnegative" CHECK ("package_inventory"."sold_count" >= 0),
	CONSTRAINT "package_inventory_max_per_user_positive" CHECK ("package_inventory"."max_purchases_per_user" IS NULL OR "package_inventory"."max_purchases_per_user" >= 1)
);`,
  `CREATE TABLE IF NOT EXISTS "inventory_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"reference_id" text NOT NULL UNIQUE,
	"telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
	"operation_type" text NOT NULL,
	"panel_id" text NOT NULL REFERENCES "rebecca_panels"("id") ON DELETE cascade,
	"service_id" integer NOT NULL,
	"package_id" text,
	"creation_reserved" boolean DEFAULT false NOT NULL,
	"panel_stock_consumed" boolean DEFAULT false NOT NULL,
	"service_stock_consumed" boolean DEFAULT false NOT NULL,
	"package_reserved" boolean DEFAULT false NOT NULL,
	"package_stock_consumed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_kind_supported" CHECK ("inventory_reservations"."kind" IN ('purchase', 'trial')),
	CONSTRAINT "inventory_reservations_operation_supported" CHECK ("inventory_reservations"."operation_type" IN ('new_config', 'renew_config', 'trial')),
	CONSTRAINT "inventory_reservations_status_supported" CHECK ("inventory_reservations"."status" IN ('reserved', 'committed', 'released', 'refunded')),
	CONSTRAINT "inventory_reservations_service_id_positive" CHECK ("inventory_reservations"."service_id" > 0 AND "inventory_reservations"."service_id" <= 2147483647)
);`,
  `CREATE INDEX IF NOT EXISTS "inventory_reservations_user_pkg_idx" ON "inventory_reservations" USING btree ("telegram_id", "package_id", "status");`,
  `CREATE INDEX IF NOT EXISTS "inventory_reservations_panel_service_created_idx" ON "inventory_reservations" USING btree ("panel_id", "service_id", "created_at") WHERE "inventory_reservations"."status" IN ('reserved', 'committed');`,
  `CREATE INDEX IF NOT EXISTS "inventory_reservations_pkg_created_idx" ON "inventory_reservations" USING btree ("package_id", "created_at") WHERE "inventory_reservations"."status" IN ('reserved', 'committed');`,
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
