CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL REFERENCES "users"("telegram_id"),
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_amount" bigint NOT NULL,
	"payable_amount" bigint NOT NULL,
	"payable_amount_rial" bigint,
	"credited_amount" bigint,
	"cashback_amount" bigint DEFAULT 0 NOT NULL,
	"card_id" text,
	"card_number" text,
	"card_holder" text,
	"bank_name" text,
	"external_id" text,
	"external_payment_id" text,
	"payment_url" text,
	"fiat_amount_usd" text,
	"exchange_rate_toman_per_usd" bigint,
	"pay_currency" text,
	"pay_amount" text,
	"actually_paid" text,
	"provider_status" text,
	"wallet_transaction_id" text,
	"metadata" text,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_provider_supported" CHECK ("payment_orders"."provider" IN ('forapp_card', 'nowpayments')),
	CONSTRAINT "payment_orders_status_supported" CHECK ("payment_orders"."status" IN ('pending', 'confirming', 'partially_paid', 'completed', 'expired', 'failed', 'cancelled')),
	CONSTRAINT "payment_orders_requested_amount_safe" CHECK ("payment_orders"."requested_amount" > 0 AND "payment_orders"."requested_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_payable_amount_safe" CHECK ("payment_orders"."payable_amount" > 0 AND "payment_orders"."payable_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_payable_rial_safe" CHECK ("payment_orders"."payable_amount_rial" IS NULL OR ("payment_orders"."payable_amount_rial" > 0 AND "payment_orders"."payable_amount_rial" <= 9007199254740991)),
	CONSTRAINT "payment_orders_credited_amount_safe" CHECK ("payment_orders"."credited_amount" IS NULL OR ("payment_orders"."credited_amount" >= 0 AND "payment_orders"."credited_amount" <= 9007199254740991)),
	CONSTRAINT "payment_orders_cashback_amount_safe" CHECK ("payment_orders"."cashback_amount" >= 0 AND "payment_orders"."cashback_amount" <= 9007199254740991),
	CONSTRAINT "payment_orders_exchange_rate_safe" CHECK ("payment_orders"."exchange_rate_toman_per_usd" IS NULL OR ("payment_orders"."exchange_rate_toman_per_usd" > 0 AND "payment_orders"."exchange_rate_toman_per_usd" <= 9007199254740991))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_user_status_idx" ON "payment_orders" USING btree ("telegram_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_forapp_pending_match_idx" ON "payment_orders" USING btree ("payable_amount", "expires_at") WHERE "payment_orders"."provider" = 'forapp_card' AND "payment_orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_external_id_idx" ON "payment_orders" USING btree ("provider", "external_id") WHERE "payment_orders"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_external_payment_id_idx" ON "payment_orders" USING btree ("external_payment_id") WHERE "payment_orders"."external_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_expiry_idx" ON "payment_orders" USING btree ("expires_at") WHERE "payment_orders"."status" IN ('pending', 'confirming');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forapp_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"forapp_message_id" text,
	"amount_rial" bigint NOT NULL,
	"amount_toman" bigint,
	"unit" text DEFAULT 'rial' NOT NULL,
	"is_deposit" boolean,
	"bank" text,
	"sender" text,
	"code" text,
	"raw_body" text,
	"device" text,
	"received_at" timestamp,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"matched_order_id" text REFERENCES "payment_orders"("id"),
	"matched_telegram_id" bigint REFERENCES "users"("telegram_id"),
	"matched_by_admin_id" bigint,
	"wallet_transaction_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forapp_deposits_status_supported" CHECK ("forapp_deposits"."status" IN ('matched', 'unmatched', 'ignored', 'manual_matched', 'dismissed')),
	CONSTRAINT "forapp_deposits_amount_rial_safe" CHECK ("forapp_deposits"."amount_rial" >= 0 AND "forapp_deposits"."amount_rial" <= 9007199254740991),
	CONSTRAINT "forapp_deposits_amount_toman_safe" CHECK ("forapp_deposits"."amount_toman" IS NULL OR ("forapp_deposits"."amount_toman" >= 0 AND "forapp_deposits"."amount_toman" <= 9007199254740991)),
	CONSTRAINT "forapp_deposits_matched_admin_safe" CHECK ("forapp_deposits"."matched_by_admin_id" IS NULL OR ("forapp_deposits"."matched_by_admin_id" > 0 AND "forapp_deposits"."matched_by_admin_id" <= 9007199254740991))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forapp_deposits_status_created_idx" ON "forapp_deposits" USING btree ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forapp_deposits_amount_toman_idx" ON "forapp_deposits" USING btree ("amount_toman") WHERE "forapp_deposits"."status" = 'unmatched';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forapp_deposits_matched_order_idx" ON "forapp_deposits" USING btree ("matched_order_id") WHERE "forapp_deposits"."matched_order_id" IS NOT NULL;
