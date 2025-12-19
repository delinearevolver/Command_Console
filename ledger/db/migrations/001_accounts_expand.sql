BEGIN;

-- Ensure enum exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE account_type AS ENUM ('Asset','Liability','Equity','Income','Expense');
  END IF;
END$$;

-- Ensure accounts table exists (if init_ledger.sql already created it, this is harmless)
CREATE TABLE IF NOT EXISTS public.accounts (
  id   SERIAL PRIMARY KEY,
  code INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type account_type NOT NULL
);

-- Add metadata columns (idempotent)
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS parent_code      INTEGER,
  ADD COLUMN IF NOT EXISTS statement        TEXT,         -- 'BS' or 'PL'
  ADD COLUMN IF NOT EXISTS section          TEXT,
  ADD COLUMN IF NOT EXISTS report_line      TEXT,
  ADD COLUMN IF NOT EXISTS normal_balance   TEXT,         -- 'DR' or 'CR'
  ADD COLUMN IF NOT EXISTS is_contra        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contra_to        INTEGER,
  ADD COLUMN IF NOT EXISTS is_control       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subledger        TEXT,         -- 'AR','AP','VAT','PAYROLL','CLEARING', etc
  ADD COLUMN IF NOT EXISTS posting_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tags             TEXT,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS effective_from   DATE,
  ADD COLUMN IF NOT EXISTS effective_to     DATE;

-- Constraints to keep data sane (idempotent guards)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_statement_chk') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_statement_chk CHECK (statement IS NULL OR statement IN ('BS','PL'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_normal_balance_chk') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_normal_balance_chk CHECK (normal_balance IS NULL OR normal_balance IN ('DR','CR'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_contra_chk') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_contra_chk CHECK (
        (is_contra = FALSE AND contra_to IS NULL) OR
        (is_contra = TRUE  AND contra_to IS NOT NULL)
      );
  END IF;
END$$;

-- Self-references (deferrable so you can load parents/children in one transaction)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_parent_code_fk') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_parent_code_fk
      FOREIGN KEY (parent_code) REFERENCES public.accounts(code)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_contra_to_fk') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_contra_to_fk
      FOREIGN KEY (contra_to) REFERENCES public.accounts(code)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS accounts_parent_code_idx ON public.accounts(parent_code);
CREATE INDEX IF NOT EXISTS accounts_type_idx        ON public.accounts(type);
CREATE INDEX IF NOT EXISTS accounts_status_idx      ON public.accounts(status);
CREATE INDEX IF NOT EXISTS accounts_subledger_idx   ON public.accounts(subledger);

COMMIT;
