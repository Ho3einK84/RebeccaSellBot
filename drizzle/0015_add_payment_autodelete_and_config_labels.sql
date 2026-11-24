ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "user_label" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_user_label_valid_chk" CHECK ("user_configs"."user_label" IS NULL OR (char_length(btrim("user_configs"."user_label")) BETWEEN 1 AND 40));
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_message_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"reason" text NOT NULL,
	"delete_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_message_deletions_chat_id_chk" CHECK ("scheduled_message_deletions"."chat_id" <> 0),
	CONSTRAINT "scheduled_message_deletions_message_id_chk" CHECK ("scheduled_message_deletions"."message_id" > 0),
	CONSTRAINT "scheduled_message_deletions_status_chk" CHECK ("scheduled_message_deletions"."status" IN ('pending', 'deleted', 'failed', 'cancelled')),
	CONSTRAINT "scheduled_message_deletions_attempts_chk" CHECK ("scheduled_message_deletions"."attempts" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_message_deletions_chat_msg_uidx" ON "scheduled_message_deletions" USING btree ("chat_id", "message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_message_deletions_due_idx" ON "scheduled_message_deletions" USING btree ("delete_at") WHERE "scheduled_message_deletions"."status" = 'pending';
