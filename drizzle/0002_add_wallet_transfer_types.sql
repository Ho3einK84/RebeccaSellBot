ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_type_supported";--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_type_supported" CHECK ("wallet_transactions"."type" IN ('topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial', 'transfer_sent', 'transfer_received'));
