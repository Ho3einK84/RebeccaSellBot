CREATE TABLE IF NOT EXISTS "user_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"badge" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
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
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_groups_one_default" ON "user_groups" USING btree ("is_default") WHERE "user_groups"."is_default" = true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "group_expires_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_group_id_idx" ON "users" USING btree ("group_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_available_balance_nonnegative";
	ALTER TABLE "users" ADD CONSTRAINT "users_available_balance_nonnegative" CHECK (("users"."balance" - "users"."reserved_balance") BETWEEN -9007199254740991 AND 9007199254740991);
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_balance_safe_integer";
	ALTER TABLE "users" ADD CONSTRAINT "users_balance_safe_integer" CHECK ("users"."balance" BETWEEN -9007199254740991 AND 9007199254740991);
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_balance_after_safe_integer";
	ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_after_safe_integer" CHECK ("wallet_transactions"."balance_after" BETWEEN -9007199254740991 AND 9007199254740991);
END $$;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "credit_limit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_credit_limit_safe" CHECK ("purchase_intents"."credit_limit" >= 0 AND "purchase_intents"."credit_limit" <= 9007199254740991);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "broadcast_jobs" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "broadcast_jobs" ADD CONSTRAINT "broadcast_jobs_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
