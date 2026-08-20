ALTER TABLE "purchase_intents" DROP CONSTRAINT IF EXISTS "purchase_intents_previous_status_supported";--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_previous_status_supported" CHECK ("purchase_intents"."previous_status" IS NULL OR "purchase_intents"."previous_status" IN ('active', 'disabled', 'on_hold', 'limited', 'expired'));--> statement-breakpoint
ALTER TABLE "purchase_intents" DROP CONSTRAINT IF EXISTS "purchase_intents_expected_status_supported";--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_expected_status_supported" CHECK ("purchase_intents"."expected_status" IS NULL OR "purchase_intents"."expected_status" IN ('active', 'disabled', 'on_hold', 'limited', 'expired'));
