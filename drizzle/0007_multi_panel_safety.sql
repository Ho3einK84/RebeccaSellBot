CREATE TABLE IF NOT EXISTS "rebecca_panels" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "base_url" text,
  "api_key_encrypted" text,
  "admin_username" text,
  "admin_password_encrypted" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "rebecca_panels_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS "rebecca_panels_one_default"
  ON "rebecca_panels" ("is_default") WHERE "is_default" = true;

INSERT INTO "rebecca_panels" (
  "id", "name", "base_url", "enabled", "is_default"
) VALUES (
  'legacy',
  'پنل اصلی',
  (SELECT NULLIF(btrim("value"), '') FROM "settings" WHERE "key" = 'rebecca_api_url'),
  EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'rebecca_api_url' AND btrim("value") <> ''),
  true
) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "rebecca_panel_services" (
  "panel_id" text NOT NULL REFERENCES "rebecca_panels"("id") ON DELETE CASCADE,
  "service_id" integer NOT NULL,
  "name" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "rebecca_panel_services_panel_id_service_id_pk" PRIMARY KEY("panel_id", "service_id"),
  CONSTRAINT "rebecca_panel_services_id_positive" CHECK ("service_id" > 0 AND "service_id" <= 2147483647),
  CONSTRAINT "rebecca_panel_services_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS "rebecca_panel_services_one_default"
  ON "rebecca_panel_services" ("panel_id") WHERE "is_default" = true;
INSERT INTO "rebecca_panel_services" ("panel_id", "service_id", "name", "is_default")
  VALUES ('legacy', 1, 'سرویس پیش‌فرض', true)
  ON CONFLICT ("panel_id", "service_id") DO NOTHING;

-- Preserve an administrator-selected legacy service ID during an upgrade.
-- Service 1 remains as a compatibility row for old/defaulted records, while
-- every existing Rebecca-backed record is moved to the stored target before
-- the composite foreign keys are installed below.
UPDATE "rebecca_panel_services" SET "is_default" = false
  WHERE "panel_id" = 'legacy';
INSERT INTO "rebecca_panel_services" ("panel_id", "service_id", "name", "is_default")
SELECT
  'legacy',
  COALESCE((
    SELECT CASE
      WHEN btrim("value") ~ '^[1-9][0-9]*$' THEN
        CASE
          WHEN btrim("value")::numeric <= 2147483647 THEN btrim("value")::integer
          ELSE 1
        END
      ELSE 1
    END
    FROM "settings" WHERE "key" = 'rebecca_service_id'
  ), 1),
  'سرویس پیش‌فرض',
  true
ON CONFLICT ("panel_id", "service_id") DO UPDATE
  SET "is_default" = true, "updated_at" = now();

ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "service_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "checkout_id" text;
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "operation_started_at" timestamp;
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
UPDATE "purchase_intents" SET "service_id" = COALESCE((
  SELECT CASE
    WHEN btrim("value") ~ '^[1-9][0-9]*$' THEN
      CASE WHEN btrim("value")::numeric <= 2147483647 THEN btrim("value")::integer ELSE 1 END
    ELSE 1
  END
  FROM "settings" WHERE "key" = 'rebecca_service_id'
), 1) WHERE "panel_id" = 'legacy';
ALTER TABLE "purchase_intents" DROP CONSTRAINT IF EXISTS "purchase_intents_amount_positive_safe_integer";
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_amount_positive_safe_integer"
  CHECK ("amount" >= 0 AND "amount" <= 9007199254740991) NOT VALID;
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_service_id_positive"
  CHECK ("service_id" > 0 AND "service_id" <= 2147483647) NOT VALID;
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_panel_service_fk"
  FOREIGN KEY ("panel_id", "service_id") REFERENCES "rebecca_panel_services"("panel_id", "service_id");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_intents_checkout_unique"
  ON "purchase_intents" ("checkout_id") WHERE "checkout_id" IS NOT NULL;
DROP INDEX IF EXISTS "purchase_intents_nonterminal_created_at_idx";
CREATE INDEX IF NOT EXISTS "purchase_intents_nonterminal_updated_at_idx"
  ON "purchase_intents" ("updated_at")
  WHERE "status" IN ('pending', 'reconciliation_required');

ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "service_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "auto_renew_price" bigint;
UPDATE "user_configs" SET "service_id" = COALESCE((
  SELECT CASE
    WHEN btrim("value") ~ '^[1-9][0-9]*$' THEN
      CASE WHEN btrim("value")::numeric <= 2147483647 THEN btrim("value")::integer ELSE 1 END
    ELSE 1
  END
  FROM "settings" WHERE "key" = 'rebecca_service_id'
), 1) WHERE "panel_id" = 'legacy';
ALTER TABLE "user_configs" DROP CONSTRAINT IF EXISTS "user_configs_config_username_unique";
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_service_id_positive"
  CHECK ("service_id" > 0 AND "service_id" <= 2147483647) NOT VALID;
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_service_fk"
  FOREIGN KEY ("panel_id", "service_id") REFERENCES "rebecca_panel_services"("panel_id", "service_id");
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_auto_renew_price_safe"
  CHECK ("auto_renew_price" IS NULL OR "auto_renew_price" BETWEEN 0 AND 9007199254740991) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS "user_configs_panel_username_unique"
  ON "user_configs" ("panel_id", "config_username");

CREATE TABLE IF NOT EXISTS "purchase_checkouts" (
  "id" text PRIMARY KEY NOT NULL,
  "telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
  "kind" text NOT NULL,
  "config_id" text,
  "package_id" text NOT NULL,
  "package_name" text NOT NULL,
  "panel_id" text NOT NULL REFERENCES "rebecca_panels"("id"),
  "service_id" integer NOT NULL,
  "amount" bigint NOT NULL,
  "quoted_amount" bigint NOT NULL,
  "gb_amount" integer NOT NULL,
  "duration_days" integer NOT NULL,
  "promo_code" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "claimed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_checkouts_kind_supported" CHECK ("kind" IN ('new_config', 'renew_config')),
  CONSTRAINT "purchase_checkouts_status_supported" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  CONSTRAINT "purchase_checkouts_amount_safe" CHECK ("amount" >= 0 AND "amount" <= 9007199254740991),
  CONSTRAINT "purchase_checkouts_quoted_amount_safe" CHECK ("quoted_amount" >= 0 AND "quoted_amount" <= "amount"),
  CONSTRAINT "purchase_checkouts_gb_positive" CHECK ("gb_amount" > 0),
  CONSTRAINT "purchase_checkouts_days_positive" CHECK ("duration_days" > 0),
  CONSTRAINT "purchase_checkouts_service_positive" CHECK ("service_id" > 0 AND "service_id" <= 2147483647)
);
CREATE INDEX IF NOT EXISTS "purchase_checkouts_expiry_idx"
  ON "purchase_checkouts" ("expires_at") WHERE "status" = 'pending';
ALTER TABLE "purchase_checkouts" ADD CONSTRAINT "purchase_checkouts_panel_service_fk"
  FOREIGN KEY ("panel_id", "service_id") REFERENCES "rebecca_panel_services"("panel_id", "service_id");

ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT IF EXISTS "notification_deliveries_telegram_id_config_username_notification_type_pk";
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_panel_pk"
  PRIMARY KEY ("telegram_id", "panel_id", "config_username", "notification_type");
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");

ALTER TABLE "refund_intents" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "refund_intents" ADD COLUMN IF NOT EXISTS "operation_started_at" timestamp;
ALTER TABLE "refund_intents" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
DROP INDEX IF EXISTS "refund_intents_one_nonterminal_per_config";
CREATE UNIQUE INDEX "refund_intents_one_nonterminal_per_config"
  ON "refund_intents" ("panel_id", "config_username")
  WHERE "status" IN ('pending', 'reconciliation_required');
ALTER TABLE "refund_intents" DROP CONSTRAINT IF EXISTS "refund_intents_gross_positive";
ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_gross_positive"
  CHECK ("gross_amount" >= 0 AND "gross_amount" <= 9007199254740991) NOT VALID;
ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");
DROP INDEX IF EXISTS "refund_intents_reconciliation_idx";
CREATE INDEX IF NOT EXISTS "refund_intents_reconciliation_updated_at_idx"
  ON "refund_intents" ("updated_at")
  WHERE "status" IN ('pending', 'reconciliation_required');

ALTER TABLE "config_reconciliation_issues" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "config_reconciliation_issues"
  DROP CONSTRAINT IF EXISTS "config_reconciliation_issue_unique";
CREATE UNIQUE INDEX "config_reconciliation_issue_unique"
  ON "config_reconciliation_issues" ("panel_id", "kind", "config_username");
ALTER TABLE "config_reconciliation_issues" ADD CONSTRAINT "config_reconciliation_issues_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");

ALTER TABLE "trial_claims" ADD COLUMN IF NOT EXISTS "panel_id" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "trial_claims" ADD COLUMN IF NOT EXISTS "service_id" integer DEFAULT 1 NOT NULL;
UPDATE "trial_claims" SET "service_id" = COALESCE((
  SELECT CASE
    WHEN btrim("value") ~ '^[1-9][0-9]*$' THEN
      CASE WHEN btrim("value")::numeric <= 2147483647 THEN btrim("value")::integer ELSE 1 END
    ELSE 1
  END
  FROM "settings" WHERE "key" = 'rebecca_service_id'
), 1) WHERE "panel_id" = 'legacy';
ALTER TABLE "trial_claims" DROP CONSTRAINT IF EXISTS "trial_claims_config_username_unique";
ALTER TABLE "trial_claims" DROP CONSTRAINT IF EXISTS "trial_claims_status_supported";
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_status_supported"
  CHECK ("status" IN ('pending', 'compensating', 'review_required', 'completed', 'converted', 'failed')) NOT VALID;
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_panel_id_rebecca_panels_id_fk"
  FOREIGN KEY ("panel_id") REFERENCES "rebecca_panels"("id");
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_service_id_positive"
  CHECK ("service_id" > 0 AND "service_id" <= 2147483647) NOT VALID;
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_panel_service_fk"
  FOREIGN KEY ("panel_id", "service_id") REFERENCES "rebecca_panel_services"("panel_id", "service_id");
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_panel_username_unique"
  ON "trial_claims" ("panel_id", "config_username");

DELETE FROM "settings"
  WHERE "key" IN ('rebecca_api_url', 'rebecca_api_key', 'rebecca_service_id')
    AND btrim("value") = '';
