ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "card_id" text;--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "card_number" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_receipts_card_created_idx" ON "topup_receipts" USING btree ("card_id", "created_at");
