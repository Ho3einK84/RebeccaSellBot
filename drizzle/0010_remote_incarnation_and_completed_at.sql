ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "remote_created_at" text;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
