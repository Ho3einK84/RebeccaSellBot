CREATE TABLE "code_redemptions" (
	"code" text NOT NULL,
	"telegram_id" bigint NOT NULL,
	"purchase_intent_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_redemptions_code_telegram_id_pk" PRIMARY KEY("code","telegram_id")
);
--> statement-breakpoint
CREATE TABLE "config_counters" (
	"mode" text PRIMARY KEY NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grammy_sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"telegram_id" bigint NOT NULL,
	"config_username" text NOT NULL,
	"notification_type" text NOT NULL,
	"condition_active" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_telegram_id_config_username_notification_type_pk" PRIMARY KEY("telegram_id","config_username","notification_type")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topup_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"photo_file_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_claims" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"config_username" text NOT NULL,
	"gb_amount" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sub_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trial_claims_config_username_unique" UNIQUE("config_username")
);
--> statement-breakpoint
CREATE TABLE "user_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"config_username" text NOT NULL,
	"sub_url" text,
	"is_claimed" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_configs_config_username_unique" UNIQUE("config_username")
);
--> statement-breakpoint
CREATE TABLE "users" (
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
	"referrer_id" bigint,
	"referral_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_unique" UNIQUE("id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_reserved_balance_nonnegative" CHECK ("users"."reserved_balance" >= 0),
	CONSTRAINT "users_available_balance_nonnegative" CHECK ("users"."balance" >= "users"."reserved_balance"),
	CONSTRAINT "users_locale_supported" CHECK ("users"."locale" IN ('fa', 'en'))
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"type" text NOT NULL,
	"reference_id" text,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_promo_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."promo_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_purchase_intent_id_purchase_intents_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_redemptions_purchase_intent_unique" ON "code_redemptions" USING btree ("purchase_intent_id") WHERE "code_redemptions"."purchase_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_intents_one_pending_per_user" ON "purchase_intents" USING btree ("telegram_id") WHERE "purchase_intents"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "purchase_intents_nonterminal_created_at_idx" ON "purchase_intents" USING btree ("created_at") WHERE "purchase_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE INDEX "purchase_intents_nonterminal_user_idx" ON "purchase_intents" USING btree ("telegram_id") WHERE "purchase_intents"."status" IN ('pending', 'reconciliation_required');--> statement-breakpoint
CREATE INDEX "purchase_intents_bonus_retry_idx" ON "purchase_intents" USING btree ("created_at") WHERE "purchase_intents"."status" = 'completed' AND "purchase_intents"."bonuses_processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "trial_claims_recovery_idx" ON "trial_claims" USING btree ("created_at") WHERE "trial_claims"."status" IN ('pending', 'compensating');--> statement-breakpoint
CREATE INDEX "user_configs_telegram_id_idx" ON "user_configs" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "user_configs_sub_url_idx" ON "user_configs" USING btree ("sub_url");