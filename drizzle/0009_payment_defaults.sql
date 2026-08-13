UPDATE "settings"
SET "value" = 'Name', "updated_at" = NOW()
WHERE "key" = 'card_holder' AND "value" = 'Hossein Karimi';--> statement-breakpoint
UPDATE "settings"
SET "value" = '10000000', "updated_at" = NOW()
WHERE "key" = 'topup_max_amount' AND "value" = '50000000';
