ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "panel_used_traffic" bigint;
ALTER TABLE "topup_receipts" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'photo' NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_configs_panel_used_traffic_safe'
  ) THEN
    ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_used_traffic_safe"
      CHECK ("panel_used_traffic" IS NULL OR "panel_used_traffic" BETWEEN 0 AND 9007199254740991);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topup_receipts_media_type_supported'
  ) THEN
    ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_media_type_supported"
      CHECK ("media_type" IN ('photo', 'document'));
  END IF;
END $$;
