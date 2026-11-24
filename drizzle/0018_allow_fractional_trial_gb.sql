DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'trial_claims'
      AND column_name = 'gb_amount'
      AND data_type <> 'double precision'
  ) THEN
    ALTER TABLE "trial_claims" ALTER COLUMN "gb_amount" TYPE double precision USING "gb_amount"::double precision;
  END IF;
END $$;
