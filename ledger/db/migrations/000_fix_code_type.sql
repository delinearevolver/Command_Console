BEGIN;

-- Convert accounts.code from TEXT to INTEGER if needed (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'accounts'
      AND column_name  = 'code'
      AND data_type    = 'text'
  ) THEN
    -- Drop existing unique constraint if present
    ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_code_key;

    -- Convert column type (fails if non-numeric data exists)
    ALTER TABLE public.accounts
      ALTER COLUMN code TYPE INTEGER USING code::INTEGER;

    -- Reinstate uniqueness
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_code_key UNIQUE (code);

    RAISE NOTICE 'Converted accounts.code from TEXT to INTEGER';
  END IF;
END$$;

COMMIT;
