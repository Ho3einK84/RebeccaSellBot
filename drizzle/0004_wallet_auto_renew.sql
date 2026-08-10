ALTER TABLE "user_configs" ADD COLUMN "auto_renew_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN "auto_renew_package_id" text;
