ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "promo_codes" SET "id" = gen_random_uuid() WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_id_unique" ON "promo_codes" ("id");
