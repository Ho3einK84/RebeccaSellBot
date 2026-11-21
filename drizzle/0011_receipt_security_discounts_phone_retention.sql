ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "file_unique_id" text;
--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "file_sha256" text;
--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "duplicate_of_receipt_id" text;
--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;
--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "voided_by" bigint;
--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "void_reason" text;
--> statement-breakpoint
DO $$
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
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_voided_by_safe_integer" CHECK ("topup_receipts"."voided_by" IS NULL OR ("topup_receipts"."voided_by" > 0 AND "topup_receipts"."voided_by" <= 9007199254740991));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_receipts_file_unique_id_idx" ON "topup_receipts" USING btree ("file_unique_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_receipts_file_sha256_idx" ON "topup_receipts" USING btree ("file_sha256");
--> statement-breakpoint
DO $$
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
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_discounts" (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_discounts_active_window_idx" ON "catalog_discounts" USING btree ("active", "starts_at", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_discounts_scope_target_idx" ON "catalog_discounts" USING btree ("scope", "target_id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_hash_unique" ON "users" USING btree ("phone_hash") WHERE "users"."phone_hash" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "first_use_checked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "cleanup_hold_until" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_configs_first_use_pending_idx" ON "user_configs" USING btree ("created_at") WHERE "user_configs"."first_use_checked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_configs_expired_cleanup_idx" ON "user_configs" USING btree ("panel_status", "panel_expire", "cleanup_hold_until") WHERE "user_configs"."panel_status" = 'expired';
--> statement-breakpoint
DO $$
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
END $$;
