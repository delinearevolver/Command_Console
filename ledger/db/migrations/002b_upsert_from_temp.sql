-- Upsert into accounts from staging table
INSERT INTO public.accounts (
  code, name, type, parent_code, statement, section, report_line,
  normal_balance, is_contra, contra_to, is_control, subledger,
  posting_allowed, tags, status, effective_from, effective_to
)
SELECT
  code,
  name,
  type::account_type,
  parent_code,
  statement,
  section,
  report_line,
  normal_balance,
  COALESCE(is_contra, false),
  contra_to,
  COALESCE(is_control, false),
  subledger,
  COALESCE(posting_allowed, true),
  tags,
  COALESCE(status, 'active'),
  effective_from,
  effective_to
FROM coa_seed
ON CONFLICT (code) DO UPDATE SET
  name            = EXCLUDED.name,
  type            = EXCLUDED.type,
  parent_code     = EXCLUDED.parent_code,
  statement       = EXCLUDED.statement,
  section         = EXCLUDED.section,
  report_line     = EXCLUDED.report_line,
  normal_balance  = EXCLUDED.normal_balance,
  is_contra       = EXCLUDED.is_contra,
  contra_to       = EXCLUDED.contra_to,
  is_control      = EXCLUDED.is_control,
  subledger       = EXCLUDED.subledger,
  posting_allowed = EXCLUDED.posting_allowed,
  tags            = EXCLUDED.tags,
  status          = EXCLUDED.status,
  effective_from  = EXCLUDED.effective_from,
  effective_to    = EXCLUDED.effective_to;

-- Verify row count matches CSV
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM public.accounts WHERE status = 'active';
  RAISE NOTICE 'Loaded % active accounts', row_count;
  
  IF row_count < 400 THEN
    RAISE EXCEPTION 'Expected ~496 accounts, only got %', row_count;
  END IF;
END$$;
