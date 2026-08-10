ALTER TABLE "users" ADD COLUMN "registration_source" text DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "total_spend" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_subscription_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_total_spend_nonnegative" CHECK ("users"."total_spend" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_subscription_count_nonnegative" CHECK ("users"."active_subscription_count" >= 0);--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN "panel_status" text;--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN "panel_data_limit" bigint;--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN "panel_expire" bigint;--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "max_uses_per_user" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "min_purchase_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "code_redemptions" SET "id" = CONCAT('cr_legacy_', "code", '_', "telegram_id") WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "code_redemptions" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "code_redemptions" DROP CONSTRAINT "code_redemptions_code_telegram_id_pk";--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_pkey" PRIMARY KEY ("id");--> statement-breakpoint
CREATE INDEX "code_redemptions_user_code_idx" ON "code_redemptions" USING btree ("code", "telegram_id");--> statement-breakpoint
CREATE TABLE "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_telegram_id" bigint,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "target_telegram_id" bigint,
  "metadata" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_telegram_id");
