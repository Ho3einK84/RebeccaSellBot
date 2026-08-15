CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_telegram_id" bigint,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"target_telegram_id" bigint,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_admins" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"added_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_admins_telegram_id_safe" CHECK ("bot_admins"."telegram_id" > 0 AND "bot_admins"."telegram_id" <= 9007199254740991),
	CONSTRAINT "bot_admins_added_by_safe" CHECK ("bot_admins"."added_by" IS NULL OR ("bot_admins"."added_by" > 0 AND "bot_admins"."added_by" <= 9007199254740991))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_telegram_id" bigint NOT NULL,
	"audience" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_jobs_actor_safe" CHECK ("broadcast_jobs"."actor_telegram_id" > 0 AND "broadcast_jobs"."actor_telegram_id" <= 9007199254740991),
	CONSTRAINT "broadcast_jobs_audience_supported" CHECK ("broadcast_jobs"."audience" IN ('all', 'active_subscription', 'no_subscription', 'no_purchase_30d', 'no_active_subscription')),
	CONSTRAINT "broadcast_jobs_status_supported" CHECK ("broadcast_jobs"."status" IN ('queued', 'running', 'cancel_requested', 'cancelled', 'completed')),
	CONSTRAINT "broadcast_jobs_counts_safe" CHECK ("broadcast_jobs"."recipient_count" >= 0 AND "broadcast_jobs"."sent_count" >= 0 AND "broadcast_jobs"."failed_count" >= 0 AND "broadcast_jobs"."sent_count" + "broadcast_jobs"."failed_count" <= "broadcast_jobs"."recipient_count")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
	"job_id" uuid NOT NULL,
	"telegram_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"sent_at" timestamp,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_recipients_job_id_telegram_id_pk" PRIMARY KEY("job_id","telegram_id"),
	CONSTRAINT "broadcast_recipients_status_supported" CHECK ("broadcast_recipients"."status" IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "broadcast_recipients_attempts_safe" CHECK ("broadcast_recipients"."attempts" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"telegram_id" bigint NOT NULL,
	"purchase_intent_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_redemptions_status_supported" CHECK ("code_redemptions"."status" IN ('pending', 'completed'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_counters" (
	"mode" text PRIMARY KEY NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "config_counters_nonnegative" CHECK ("config_counters"."current_count" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"config_username" text NOT NULL,
	"local_config_id" text,
	"local_owner_telegram_id" bigint,
	"remote_created_at" text,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "config_reconciliation_issue_kind_supported" CHECK ("config_reconciliation_issues"."kind" IN ('local_missing_remote', 'remote_unbound')),
	CONSTRAINT "config_reconciliation_issue_status_supported" CHECK ("config_reconciliation_issues"."status" IN ('open', 'ignored', 'resolved'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grammy_sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"telegram_id" bigint NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"config_username" text NOT NULL,
	"notification_type" text NOT NULL,
	"condition_active" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_telegram_id_panel_id_config_username_notification_type_pk" PRIMARY KEY("telegram_id","panel_id","config_username","notification_type"),
	CONSTRAINT "notification_deliveries_type_supported" CHECK ("notification_deliveries"."notification_type" IN ('low_traffic', 'near_expiry', 'auto_renew_low_balance', 'auto_renew_package_missing'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_codes" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"max_uses_per_user" integer DEFAULT 1 NOT NULL,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"min_purchase_amount" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_id_unique" UNIQUE("id"),
	CONSTRAINT "promo_codes_type_supported" CHECK ("promo_codes"."type" IN ('discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb')),
	CONSTRAINT "promo_codes_value_positive" CHECK ("promo_codes"."value" > 0),
	CONSTRAINT "promo_codes_percent_range" CHECK ("promo_codes"."type" <> 'discount_percent' OR "promo_codes"."value" BETWEEN 1 AND 100),
	CONSTRAINT "promo_codes_max_uses_positive" CHECK ("promo_codes"."max_uses" > 0),
	CONSTRAINT "promo_codes_max_uses_per_user_positive" CHECK ("promo_codes"."max_uses_per_user" > 0),
	CONSTRAINT "promo_codes_current_uses_valid" CHECK ("promo_codes"."current_uses" >= 0 AND "promo_codes"."current_uses" <= "promo_codes"."max_uses"),
	CONSTRAINT "promo_codes_min_purchase_safe" CHECK ("promo_codes"."min_purchase_amount" BETWEEN 0 AND 9007199254740991)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"config_id" text,
	"package_id" text NOT NULL,
	"package_name" text NOT NULL,
	"panel_id" text NOT NULL,
	"service_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"quoted_amount" bigint NOT NULL,
	"gb_amount" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"promo_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_checkouts_kind_supported" CHECK ("purchase_checkouts"."kind" IN ('new_config', 'renew_config')),
	CONSTRAINT "purchase_checkouts_status_supported" CHECK ("purchase_checkouts"."status" IN ('pending', 'processing', 'completed', 'failed', 'expired')),
	CONSTRAINT "purchase_checkouts_amount_safe" CHECK ("purchase_checkouts"."amount" >= 0 AND "purchase_checkouts"."amount" <= 9007199254740991),
	CONSTRAINT "purchase_checkouts_quoted_amount_safe" CHECK ("purchase_checkouts"."quoted_amount" >= 0 AND "purchase_checkouts"."quoted_amount" <= "purchase_checkouts"."amount"),
	CONSTRAINT "purchase_checkouts_gb_positive" CHECK ("purchase_checkouts"."gb_amount" > 0),
	CONSTRAINT "purchase_checkouts_days_positive" CHECK ("purchase_checkouts"."duration_days" > 0),
	CONSTRAINT "purchase_checkouts_service_positive" CHECK ("purchase_checkouts"."service_id" > 0 AND "purchase_checkouts"."service_id" <= 2147483647)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"service_id" integer DEFAULT 1 NOT NULL,
	"checkout_id" text,
	"amount" bigint NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"config_username" text,
	"gb_amount" integer,
	"duration_days" integer,
	"previous_data_limit" bigint,
	"previous_expire" bigint,
	"previous_status" text,
	"expected_data_limit" bigint,
	"expected_expire" bigint,
	"expected_status" text,
	"error_message" text,
	"bonuses_processed_at" timestamp,
	"operation_started_at" timestamp,
	"lease_expires_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_intents_amount_positive_safe_integer" CHECK ("purchase_intents"."amount" >= 0 AND "purchase_intents"."amount" <= 9007199254740991),
	CONSTRAINT "purchase_intents_type_supported" CHECK ("purchase_intents"."type" IN ('new_config', 'renew_config')),
	CONSTRAINT "purchase_intents_status_supported" CHECK ("purchase_intents"."status" IN ('pending', 'reconciliation_required', 'completed', 'failed')),
	CONSTRAINT "purchase_intents_gb_amount_positive" CHECK ("purchase_intents"."gb_amount" IS NULL OR "purchase_intents"."gb_amount" > 0),
	CONSTRAINT "purchase_intents_duration_days_positive" CHECK ("purchase_intents"."duration_days" IS NULL OR "purchase_intents"."duration_days" > 0),
	CONSTRAINT "purchase_intents_service_id_positive" CHECK ("purchase_intents"."service_id" > 0 AND "purchase_intents"."service_id" <= 2147483647),
	CONSTRAINT "purchase_intents_previous_data_limit_safe" CHECK ("purchase_intents"."previous_data_limit" IS NULL OR "purchase_intents"."previous_data_limit" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "purchase_intents_expected_data_limit_safe" CHECK ("purchase_intents"."expected_data_limit" IS NULL OR "purchase_intents"."expected_data_limit" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "purchase_intents_previous_expire_safe" CHECK ("purchase_intents"."previous_expire" IS NULL OR "purchase_intents"."previous_expire" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "purchase_intents_expected_expire_safe" CHECK ("purchase_intents"."expected_expire" IS NULL OR "purchase_intents"."expected_expire" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "purchase_intents_previous_status_supported" CHECK ("purchase_intents"."previous_status" IS NULL OR "purchase_intents"."previous_status" IN ('active', 'disabled', 'on_hold')),
	CONSTRAINT "purchase_intents_expected_status_supported" CHECK ("purchase_intents"."expected_status" IS NULL OR "purchase_intents"."expected_status" IN ('active', 'disabled', 'on_hold'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rebecca_panel_services" (
	"panel_id" text NOT NULL,
	"service_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rebecca_panel_services_panel_id_service_id_pk" PRIMARY KEY("panel_id","service_id"),
	CONSTRAINT "rebecca_panel_services_id_positive" CHECK ("rebecca_panel_services"."service_id" > 0 AND "rebecca_panel_services"."service_id" <= 2147483647),
	CONSTRAINT "rebecca_panel_services_name_present" CHECK (length(btrim("rebecca_panel_services"."name")) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rebecca_panels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"admin_username" text,
	"admin_password_encrypted" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rebecca_panels_name_present" CHECK (length(btrim("rebecca_panels"."name")) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refund_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_intent_id" text NOT NULL,
	"telegram_id" bigint NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"config_username" text NOT NULL,
	"gross_amount" bigint NOT NULL,
	"cashback_withheld" bigint DEFAULT 0 NOT NULL,
	"refund_amount" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"operation_started_at" timestamp,
	"lease_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refund_intents_gross_positive" CHECK ("refund_intents"."gross_amount" >= 0 AND "refund_intents"."gross_amount" <= 9007199254740991),
	CONSTRAINT "refund_intents_cashback_safe" CHECK ("refund_intents"."cashback_withheld" >= 0 AND "refund_intents"."cashback_withheld" <= "refund_intents"."gross_amount"),
	CONSTRAINT "refund_intents_amount_safe" CHECK ("refund_intents"."refund_amount" >= 0 AND "refund_intents"."refund_amount" <= "refund_intents"."gross_amount"),
	CONSTRAINT "refund_intents_status_supported" CHECK ("refund_intents"."status" IN ('pending', 'reconciliation_required', 'completed', 'failed'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topup_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"photo_file_id" text NOT NULL,
	"media_type" text DEFAULT 'photo' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "topup_receipts_amount_positive_safe_integer" CHECK ("topup_receipts"."amount" > 0 AND "topup_receipts"."amount" <= 9007199254740991),
	CONSTRAINT "topup_receipts_media_type_supported" CHECK ("topup_receipts"."media_type" IN ('photo', 'document')),
	CONSTRAINT "topup_receipts_status_supported" CHECK ("topup_receipts"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "topup_receipts_reviewed_by_safe_integer" CHECK ("topup_receipts"."reviewed_by" IS NULL OR ("topup_receipts"."reviewed_by" > 0 AND "topup_receipts"."reviewed_by" <= 9007199254740991))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_claims" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"service_id" integer DEFAULT 1 NOT NULL,
	"config_username" text NOT NULL,
	"gb_amount" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sub_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trial_claims_gb_amount_positive" CHECK ("trial_claims"."gb_amount" > 0),
	CONSTRAINT "trial_claims_duration_days_positive" CHECK ("trial_claims"."duration_days" > 0),
	CONSTRAINT "trial_claims_service_id_positive" CHECK ("trial_claims"."service_id" > 0 AND "trial_claims"."service_id" <= 2147483647),
	CONSTRAINT "trial_claims_status_supported" CHECK ("trial_claims"."status" IN ('pending', 'compensating', 'review_required', 'completed', 'converted', 'failed'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"panel_id" text DEFAULT 'legacy' NOT NULL,
	"service_id" integer DEFAULT 1 NOT NULL,
	"config_username" text NOT NULL,
	"sub_url" text,
	"is_claimed" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp,
	"panel_status" text,
	"panel_data_limit" bigint,
	"panel_used_traffic" bigint,
	"panel_expire" bigint,
	"auto_renew_enabled" boolean DEFAULT false NOT NULL,
	"auto_renew_package_id" text,
	"auto_renew_price" bigint,
	"remote_created_at" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_configs_panel_status_supported" CHECK ("user_configs"."panel_status" IS NULL OR "user_configs"."panel_status" IN ('active', 'disabled', 'limited', 'expired', 'on_hold', 'deleted')),
	CONSTRAINT "user_configs_panel_data_limit_safe" CHECK ("user_configs"."panel_data_limit" IS NULL OR "user_configs"."panel_data_limit" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "user_configs_panel_used_traffic_safe" CHECK ("user_configs"."panel_used_traffic" IS NULL OR "user_configs"."panel_used_traffic" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "user_configs_panel_expire_safe" CHECK ("user_configs"."panel_expire" IS NULL OR "user_configs"."panel_expire" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "user_configs_service_id_positive" CHECK ("user_configs"."service_id" > 0 AND "user_configs"."service_id" <= 2147483647),
	CONSTRAINT "user_configs_auto_renew_price_safe" CHECK ("user_configs"."auto_renew_price" IS NULL OR "user_configs"."auto_renew_price" BETWEEN 0 AND 9007199254740991)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"balance" bigint DEFAULT 0 NOT NULL,
	"reserved_balance" bigint DEFAULT 0 NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"has_used_trial" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"locale_manual" boolean DEFAULT false NOT NULL,
	"referrer_id" bigint,
	"referral_code" text NOT NULL,
	"registration_source" text DEFAULT 'telegram' NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"total_spend" bigint DEFAULT 0 NOT NULL,
	"active_subscription_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_unique" UNIQUE("id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_reserved_balance_nonnegative" CHECK ("users"."reserved_balance" >= 0),
	CONSTRAINT "users_available_balance_nonnegative" CHECK ("users"."balance" >= "users"."reserved_balance"),
	CONSTRAINT "users_locale_supported" CHECK ("users"."locale" IN ('fa', 'en')),
	CONSTRAINT "users_total_spend_nonnegative" CHECK ("users"."total_spend" >= 0),
	CONSTRAINT "users_telegram_id_safe_integer" CHECK ("users"."telegram_id" > 0 AND "users"."telegram_id" <= 9007199254740991),
	CONSTRAINT "users_balance_safe_integer" CHECK ("users"."balance" <= 9007199254740991),
	CONSTRAINT "users_total_spend_safe_integer" CHECK ("users"."total_spend" <= 9007199254740991),
	CONSTRAINT "users_referrer_id_safe_integer" CHECK ("users"."referrer_id" IS NULL OR ("users"."referrer_id" > 0 AND "users"."referrer_id" <= 9007199254740991)),
	CONSTRAINT "users_active_subscription_count_nonnegative" CHECK ("users"."active_subscription_count" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"type" text NOT NULL,
	"reference_id" text,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "wallet_transactions_amount_safe_integer" CHECK ("wallet_transactions"."amount" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "wallet_transactions_balance_after_safe_integer" CHECK ("wallet_transactions"."balance_after" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "wallet_transactions_type_supported" CHECK ("wallet_transactions"."type" IN ('topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial'))
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_job_id_broadcast_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."broadcast_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_promo_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."promo_codes"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_purchase_intent_id_purchase_intents_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "config_reconciliation_issues" ADD CONSTRAINT "config_reconciliation_issues_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_checkouts" ADD CONSTRAINT "purchase_checkouts_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_checkouts" ADD CONSTRAINT "purchase_checkouts_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_checkouts" ADD CONSTRAINT "purchase_checkouts_panel_service_fk" FOREIGN KEY ("panel_id","service_id") REFERENCES "public"."rebecca_panel_services"("panel_id","service_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_panel_service_fk" FOREIGN KEY ("panel_id","service_id") REFERENCES "public"."rebecca_panel_services"("panel_id","service_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_purchase_intent_id_purchase_intents_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_panel_service_fk" FOREIGN KEY ("panel_id","service_id") REFERENCES "public"."rebecca_panel_services"("panel_id","service_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_id_rebecca_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."rebecca_panels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_service_fk" FOREIGN KEY ("panel_id","service_id") REFERENCES "public"."rebecca_panel_services"("panel_id","service_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_target_idx" ON "audit_logs" USING btree ("target_telegram_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_jobs_runnable_idx" ON "broadcast_jobs" USING btree ("created_at") WHERE "broadcast_jobs"."status" IN ('queued', 'running', 'cancel_requested');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_recipients_pending_idx" ON "broadcast_recipients" USING btree ("job_id","telegram_id") WHERE "broadcast_recipients"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_recipients_stale_idx" ON "broadcast_recipients" USING btree ("claimed_at") WHERE "broadcast_recipients"."status" = 'sending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "code_redemptions_purchase_intent_unique" ON "code_redemptions" USING btree ("purchase_intent_id") WHERE "code_redemptions"."purchase_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_redemptions_user_code_idx" ON "code_redemptions" USING btree ("code","telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "config_reconciliation_issue_unique" ON "config_reconciliation_issues" USING btree ("panel_id","kind","config_username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_reconciliation_open_idx" ON "config_reconciliation_issues" USING btree ("last_seen_at") WHERE "config_reconciliation_issues"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_checkouts_expiry_idx" ON "purchase_checkouts" USING btree ("expires_at") WHERE "purchase_checkouts"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_intents_one_pending_per_user" ON "purchase_intents" USING btree ("telegram_id") WHERE "purchase_intents"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_intents_nonterminal_updated_at_idx" ON "purchase_intents" USING btree ("updated_at") WHERE "purchase_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_intents_nonterminal_user_idx" ON "purchase_intents" USING btree ("telegram_id") WHERE "purchase_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_intents_bonus_retry_idx" ON "purchase_intents" USING btree ("created_at") WHERE "purchase_intents"."status" = 'completed' AND "purchase_intents"."bonuses_processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_intents_checkout_unique" ON "purchase_intents" USING btree ("checkout_id") WHERE "purchase_intents"."checkout_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rebecca_panel_services_one_default" ON "rebecca_panel_services" USING btree ("panel_id") WHERE "rebecca_panel_services"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rebecca_panels_one_default" ON "rebecca_panels" USING btree ("is_default") WHERE "rebecca_panels"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_intents_purchase_unique" ON "refund_intents" USING btree ("purchase_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_intents_one_nonterminal_per_config" ON "refund_intents" USING btree ("panel_id","config_username") WHERE "refund_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_intents_reconciliation_updated_at_idx" ON "refund_intents" USING btree ("updated_at") WHERE "refund_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_panel_username_unique" ON "trial_claims" USING btree ("panel_id","config_username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_claims_recovery_idx" ON "trial_claims" USING btree ("created_at") WHERE "trial_claims"."status" IN ('pending', 'compensating');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_configs_telegram_id_idx" ON "user_configs" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_configs_sub_url_idx" ON "user_configs" USING btree ("sub_url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_configs_panel_username_unique" ON "user_configs" USING btree ("panel_id","config_username");--> statement-breakpoint
INSERT INTO "rebecca_panels" ("id", "name", "enabled", "is_default")
VALUES ('legacy', 'پنل اصلی', false, true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "rebecca_panel_services" ("panel_id", "service_id", "name", "is_default")
VALUES ('legacy', 1, 'سرویس پیش‌فرض', true)
ON CONFLICT ("panel_id", "service_id") DO NOTHING;
