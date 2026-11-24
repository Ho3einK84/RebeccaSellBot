ALTER TABLE "user_groups" ADD COLUMN IF NOT EXISTS "apply_discount_to_custom_volume" boolean DEFAULT false NOT NULL;
