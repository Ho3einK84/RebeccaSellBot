CREATE INDEX IF NOT EXISTS "wallet_transactions_user_created_idx" ON "wallet_transactions" USING btree ("telegram_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_intents_user_created_idx" ON "purchase_intents" USING btree ("telegram_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_reconciliation_active_queue_idx" ON "config_reconciliation_issues" USING btree ("status", "kind", "first_seen_at") WHERE "status" IN ('open', 'ignored');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_reconciliation_panel_stale_idx" ON "config_reconciliation_issues" USING btree ("panel_id", "last_seen_at") WHERE "status" IN ('open', 'ignored');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_reconciliation_resolved_prune_idx" ON "config_reconciliation_issues" USING btree ("panel_id", "resolved_at") WHERE "status" = 'resolved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_recipients_job_id_broadcast_jobs_id_fk') THEN
    ALTER TABLE "broadcast_recipients" DROP CONSTRAINT IF EXISTS "broadcast_recipients_job_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_recipients_telegram_id_users_telegram_id_fk') THEN
    ALTER TABLE "broadcast_recipients" DROP CONSTRAINT IF EXISTS "broadcast_recipients_telegram_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_checkouts_panel_id_rebecca_panels_id_fk') THEN
    ALTER TABLE "purchase_checkouts" DROP CONSTRAINT IF EXISTS "purchase_checkouts_panel_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_checkouts_telegram_id_users_telegram_id_fk') THEN
    ALTER TABLE "purchase_checkouts" DROP CONSTRAINT IF EXISTS "purchase_checkouts_telegram_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rebecca_panel_services_panel_id_rebecca_panels_id_fk') THEN
    ALTER TABLE "rebecca_panel_services" DROP CONSTRAINT IF EXISTS "rebecca_panel_services_panel_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_intents_purchase_intent_id_purchase_intents_id_fk') THEN
    ALTER TABLE "refund_intents" DROP CONSTRAINT IF EXISTS "refund_intents_purchase_intent_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_intents_telegram_id_users_telegram_id_fk') THEN
    ALTER TABLE "refund_intents" DROP CONSTRAINT IF EXISTS "refund_intents_telegram_id_fkey";
  END IF;
END $$;
