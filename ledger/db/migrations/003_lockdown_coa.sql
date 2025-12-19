BEGIN;

-- Create app role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccc_app') THEN
    CREATE ROLE ccc_app NOINHERIT LOGIN;
  END IF;
END$$;

-- Lock down accounts table
REVOKE INSERT, UPDATE, DELETE ON public.accounts FROM PUBLIC;
GRANT  SELECT ON public.accounts TO ccc_app;

-- Grant sequence usage for other tables the app needs to write to
GRANT USAGE ON SEQUENCE accounts_id_seq TO ccc_app;

-- If you want to grant broader access to other tables:
-- GRANT SELECT, INSERT, UPDATE ON public.invoices TO ccc_app;
-- GRANT SELECT, INSERT, UPDATE ON public.journals TO ccc_app;
-- GRANT SELECT, INSERT, UPDATE ON public.postings TO ccc_app;

COMMIT;
