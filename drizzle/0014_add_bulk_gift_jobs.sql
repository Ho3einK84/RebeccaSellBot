CREATE TABLE IF NOT EXISTS "bulk_gift_jobs" (
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_gift_jobs_runnable_idx" ON "bulk_gift_jobs" USING btree ("created_at") WHERE "bulk_gift_jobs"."status" IN ('queued', 'running', 'cancel_requested');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulk_gift_items" (
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
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bulk_gift_items_job_panel_username_unique" ON "bulk_gift_items" USING btree ("job_id", "panel_id", "config_username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_gift_items_pending_idx" ON "bulk_gift_items" USING btree ("job_id", "config_id") WHERE "bulk_gift_items"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_gift_items_stale_idx" ON "bulk_gift_items" USING btree ("claimed_at") WHERE "bulk_gift_items"."status" = 'processing';
