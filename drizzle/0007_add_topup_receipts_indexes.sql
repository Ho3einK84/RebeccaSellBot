CREATE INDEX IF NOT EXISTS "topup_receipts_status_created_idx" ON "topup_receipts" USING btree ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_receipts_user_status_idx" ON "topup_receipts" USING btree ("telegram_id", "status");
