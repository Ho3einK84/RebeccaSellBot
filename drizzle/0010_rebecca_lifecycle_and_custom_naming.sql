ALTER TABLE "purchase_checkouts" ADD COLUMN IF NOT EXISTS "requested_username" text;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "panel_on_hold_expire_duration" bigint;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_on_hold_expire_duration_safe" CHECK ("user_configs"."panel_on_hold_expire_duration" IS NULL OR "user_configs"."panel_on_hold_expire_duration" BETWEEN 0 AND 9007199254740991);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
