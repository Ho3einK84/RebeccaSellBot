ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "max_configs" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "stock_remaining" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "daily_create_limit" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panels" ADD COLUMN IF NOT EXISTS "reserved_creations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_max_configs_safe" CHECK ("rebecca_panels"."max_configs" IS NULL OR "rebecca_panels"."max_configs" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_stock_remaining_safe" CHECK ("rebecca_panels"."stock_remaining" IS NULL OR "rebecca_panels"."stock_remaining" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_daily_create_limit_safe" CHECK ("rebecca_panels"."daily_create_limit" IS NULL OR "rebecca_panels"."daily_create_limit" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panels" ADD CONSTRAINT "rebecca_panels_reserved_creations_nonnegative" CHECK ("rebecca_panels"."reserved_creations" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "max_configs" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "stock_remaining" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "daily_create_limit" integer;--> statement-breakpoint
ALTER TABLE "rebecca_panel_services" ADD COLUMN IF NOT EXISTS "reserved_creations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_max_configs_safe" CHECK ("rebecca_panel_services"."max_configs" IS NULL OR "rebecca_panel_services"."max_configs" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_stock_remaining_safe" CHECK ("rebecca_panel_services"."stock_remaining" IS NULL OR "rebecca_panel_services"."stock_remaining" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_daily_create_limit_safe" CHECK ("rebecca_panel_services"."daily_create_limit" IS NULL OR "rebecca_panel_services"."daily_create_limit" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "rebecca_panel_services" ADD CONSTRAINT "rebecca_panel_services_reserved_creations_nonnegative" CHECK ("rebecca_panel_services"."reserved_creations" >= 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_configs_panel_service_status_idx" ON "user_configs" USING btree ("panel_id", "service_id", "panel_status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "package_inventory" (
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
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_reservations" (
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_user_pkg_idx" ON "inventory_reservations" USING btree ("telegram_id", "package_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_panel_service_created_idx" ON "inventory_reservations" USING btree ("panel_id", "service_id", "created_at") WHERE "inventory_reservations"."status" IN ('reserved', 'committed');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_pkg_created_idx" ON "inventory_reservations" USING btree ("package_id", "created_at") WHERE "inventory_reservations"."status" IN ('reserved', 'committed');
