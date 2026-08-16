CREATE TABLE IF NOT EXISTS "package_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "package_categories_id_safe" CHECK (length(btrim("package_categories"."id")) BETWEEN 1 AND 64),
	CONSTRAINT "package_categories_name_safe" CHECK (length(btrim("package_categories"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "package_categories_display_order_safe" CHECK ("package_categories"."display_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "package_categories_order_idx" ON "package_categories" ("display_order", "created_at");
