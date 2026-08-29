ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_type_supported";--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_type_supported" CHECK ("wallet_transactions"."type" IN ('topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial', 'transfer_sent', 'transfer_received', 'lucky_wheel'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lucky_wheel_spins" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"effective_luck_percent" integer NOT NULL,
	"spin_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lucky_wheel_spins_amount_safe" CHECK ("lucky_wheel_spins"."amount" >= 0),
	CONSTRAINT "lucky_wheel_spins_spin_number_safe" CHECK ("lucky_wheel_spins"."spin_number" >= 1)
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "lucky_wheel_spins" ADD CONSTRAINT "lucky_wheel_spins_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lucky_wheel_spins_telegram_id_idx" ON "lucky_wheel_spins" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lucky_wheel_spins_created_at_idx" ON "lucky_wheel_spins" USING btree ("created_at");
