-- These constraints are added NOT VALID so deployment does not fail because of
-- pre-existing legacy rows. PostgreSQL still enforces them for new/updated
-- rows. After auditing legacy data, operators should VALIDATE each constraint.
ALTER TABLE "users" ADD CONSTRAINT "users_telegram_id_safe_integer" CHECK ("telegram_id" > 0 AND "telegram_id" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_balance_safe_integer" CHECK ("balance" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_total_spend_safe_integer" CHECK ("total_spend" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referrer_id_safe_integer" CHECK ("referrer_id" IS NULL OR ("referrer_id" > 0 AND "referrer_id" <= 9007199254740991)) NOT VALID;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_safe_integer" CHECK ("amount" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_after_safe_integer" CHECK ("balance_after" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_type_supported" CHECK ("type" IN ('topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial')) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_amount_positive_safe_integer" CHECK ("amount" > 0 AND "amount" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_type_supported" CHECK ("type" IN ('new_config', 'renew_config')) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_status_supported" CHECK ("status" IN ('pending', 'reconciliation_required', 'completed', 'failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_gb_amount_positive" CHECK ("gb_amount" IS NULL OR "gb_amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_duration_days_positive" CHECK ("duration_days" IS NULL OR "duration_days" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_previous_data_limit_safe" CHECK ("previous_data_limit" IS NULL OR "previous_data_limit" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_expected_data_limit_safe" CHECK ("expected_data_limit" IS NULL OR "expected_data_limit" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_previous_expire_safe" CHECK ("previous_expire" IS NULL OR "previous_expire" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_expected_expire_safe" CHECK ("expected_expire" IS NULL OR "expected_expire" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_previous_status_supported" CHECK ("previous_status" IS NULL OR "previous_status" IN ('active', 'disabled', 'on_hold')) NOT VALID;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_expected_status_supported" CHECK ("expected_status" IS NULL OR "expected_status" IN ('active', 'disabled', 'on_hold')) NOT VALID;--> statement-breakpoint
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_status_supported" CHECK ("panel_status" IS NULL OR "panel_status" IN ('active', 'disabled', 'limited', 'expired', 'on_hold', 'deleted')) NOT VALID;--> statement-breakpoint
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_data_limit_safe" CHECK ("panel_data_limit" IS NULL OR "panel_data_limit" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_panel_expire_safe" CHECK ("panel_expire" IS NULL OR "panel_expire" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_type_supported" CHECK ("notification_type" IN ('low_traffic', 'near_expiry', 'auto_renew_low_balance', 'auto_renew_package_missing')) NOT VALID;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_gb_amount_positive" CHECK ("gb_amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_duration_days_positive" CHECK ("duration_days" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_status_supported" CHECK ("status" IN ('pending', 'compensating', 'review_required', 'completed', 'failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_type_supported" CHECK ("type" IN ('discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb')) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_value_positive" CHECK ("value" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_percent_range" CHECK ("type" <> 'discount_percent' OR "value" BETWEEN 1 AND 100) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_max_uses_positive" CHECK ("max_uses" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_max_uses_per_user_positive" CHECK ("max_uses_per_user" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_current_uses_valid" CHECK ("current_uses" >= 0 AND "current_uses" <= "max_uses") NOT VALID;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_min_purchase_safe" CHECK ("min_purchase_amount" BETWEEN 0 AND 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_status_supported" CHECK ("status" IN ('pending', 'completed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_amount_positive_safe_integer" CHECK ("amount" > 0 AND "amount" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_status_supported" CHECK ("status" IN ('pending', 'approved', 'rejected')) NOT VALID;--> statement-breakpoint
ALTER TABLE "topup_receipts" ADD CONSTRAINT "topup_receipts_reviewed_by_safe_integer" CHECK ("reviewed_by" IS NULL OR ("reviewed_by" > 0 AND "reviewed_by" <= 9007199254740991)) NOT VALID;--> statement-breakpoint
ALTER TABLE "config_counters" ADD CONSTRAINT "config_counters_nonnegative" CHECK ("current_count" >= 0) NOT VALID;
