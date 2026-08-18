CREATE INDEX IF NOT EXISTS "purchase_checkouts_processing_claimed_idx"
ON "purchase_checkouts" ("claimed_at")
WHERE "purchase_checkouts"."status" = 'processing';
