ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "max_discount_amount" bigint;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "first_purchase_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_max_discount_safe" CHECK ("promo_codes"."max_discount_amount" IS NULL OR ("promo_codes"."max_discount_amount" > 0 AND "promo_codes"."max_discount_amount" <= 9007199254740991));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
