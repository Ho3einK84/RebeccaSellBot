ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "cashback_percent" integer;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "cashback_amount" bigint;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "referrer_telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "referral_bonus_amount" bigint;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_intents" DROP CONSTRAINT IF EXISTS "purchase_intents_status_supported";--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_status_supported" CHECK ("purchase_intents"."status" IN ('pending', 'reconciliation_required', 'completed', 'failed', 'refunded'));--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_cashback_percent_safe" CHECK ("purchase_intents"."cashback_percent" IS NULL OR ("purchase_intents"."cashback_percent" >= 0 AND "purchase_intents"."cashback_percent" <= 100));--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_cashback_amount_safe" CHECK ("purchase_intents"."cashback_amount" IS NULL OR ("purchase_intents"."cashback_amount" >= 0 AND "purchase_intents"."cashback_amount" <= 9007199254740991));--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_referrer_id_safe" CHECK ("purchase_intents"."referrer_telegram_id" IS NULL OR ("purchase_intents"."referrer_telegram_id" > 0 AND "purchase_intents"."referrer_telegram_id" <= 9007199254740991));--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_referral_bonus_amount_safe" CHECK ("purchase_intents"."referral_bonus_amount" IS NULL OR ("purchase_intents"."referral_bonus_amount" >= 0 AND "purchase_intents"."referral_bonus_amount" <= 9007199254740991));
