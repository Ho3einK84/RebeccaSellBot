CREATE TABLE IF NOT EXISTS "refund_intents" (
  "id" text PRIMARY KEY NOT NULL,
  "purchase_intent_id" text NOT NULL REFERENCES "purchase_intents"("id"),
  "telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
  "config_username" text NOT NULL,
  "gross_amount" bigint NOT NULL,
  "cashback_withheld" bigint DEFAULT 0 NOT NULL,
  "refund_amount" bigint NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "refund_intents_purchase_unique" UNIQUE("purchase_intent_id"),
  CONSTRAINT "refund_intents_gross_positive" CHECK ("gross_amount" > 0 AND "gross_amount" <= 9007199254740991),
  CONSTRAINT "refund_intents_cashback_safe" CHECK ("cashback_withheld" >= 0 AND "cashback_withheld" <= "gross_amount"),
  CONSTRAINT "refund_intents_amount_safe" CHECK ("refund_amount" >= 0 AND "refund_amount" <= "gross_amount"),
  CONSTRAINT "refund_intents_status_supported" CHECK ("status" IN ('pending', 'reconciliation_required', 'completed', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "refund_intents_one_nonterminal_per_config"
  ON "refund_intents" ("config_username")
  WHERE "status" IN ('pending', 'reconciliation_required');
CREATE INDEX IF NOT EXISTS "refund_intents_reconciliation_idx"
  ON "refund_intents" ("created_at")
  WHERE "status" IN ('pending', 'reconciliation_required');

CREATE TABLE IF NOT EXISTS "config_reconciliation_issues" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "config_username" text NOT NULL,
  "local_config_id" text,
  "local_owner_telegram_id" bigint,
  "remote_created_at" text,
  "status" text DEFAULT 'open' NOT NULL,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  CONSTRAINT "config_reconciliation_issue_unique" UNIQUE("kind", "config_username"),
  CONSTRAINT "config_reconciliation_issue_kind_supported" CHECK ("kind" IN ('local_missing_remote', 'remote_unbound')),
  CONSTRAINT "config_reconciliation_issue_status_supported" CHECK ("status" IN ('open', 'ignored', 'resolved'))
);
CREATE INDEX IF NOT EXISTS "config_reconciliation_open_idx"
  ON "config_reconciliation_issues" ("last_seen_at") WHERE "status" = 'open';

CREATE TABLE IF NOT EXISTS "bot_admins" (
  "telegram_id" bigint PRIMARY KEY NOT NULL,
  "added_by" bigint,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "bot_admins_telegram_id_safe" CHECK ("telegram_id" > 0 AND "telegram_id" <= 9007199254740991),
  CONSTRAINT "bot_admins_added_by_safe" CHECK ("added_by" IS NULL OR ("added_by" > 0 AND "added_by" <= 9007199254740991))
);

CREATE TABLE IF NOT EXISTS "broadcast_jobs" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "actor_telegram_id" bigint NOT NULL,
  "audience" text NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "broadcast_jobs_actor_safe" CHECK ("actor_telegram_id" > 0 AND "actor_telegram_id" <= 9007199254740991),
  CONSTRAINT "broadcast_jobs_audience_supported" CHECK ("audience" IN ('all', 'active_subscription', 'no_subscription', 'no_purchase_30d', 'no_active_subscription')),
  CONSTRAINT "broadcast_jobs_status_supported" CHECK ("status" IN ('queued', 'running', 'cancel_requested', 'cancelled', 'completed')),
  CONSTRAINT "broadcast_jobs_counts_safe" CHECK ("recipient_count" >= 0 AND "sent_count" >= 0 AND "failed_count" >= 0 AND "sent_count" + "failed_count" <= "recipient_count")
);
CREATE INDEX IF NOT EXISTS "broadcast_jobs_runnable_idx"
  ON "broadcast_jobs" ("created_at") WHERE "status" IN ('queued', 'running', 'cancel_requested');

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
  "job_id" uuid NOT NULL REFERENCES "broadcast_jobs"("id") ON DELETE CASCADE,
  "telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claimed_at" timestamp,
  "sent_at" timestamp,
  "last_error" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "broadcast_recipients_pk" PRIMARY KEY("job_id", "telegram_id"),
  CONSTRAINT "broadcast_recipients_status_supported" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  CONSTRAINT "broadcast_recipients_attempts_safe" CHECK ("attempts" >= 0)
);
CREATE INDEX IF NOT EXISTS "broadcast_recipients_pending_idx"
  ON "broadcast_recipients" ("job_id", "telegram_id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "broadcast_recipients_stale_idx"
  ON "broadcast_recipients" ("claimed_at") WHERE "status" = 'sending';
