-- Derive missing account attributes for UK GAAP CoA
-- Run in psql as a single transaction and review before COMMIT/ROLLBACK

BEGIN;

-- 1) Pre-flight: confirm enum values
SELECT enum_range(NULL::account_type);

-- 2) Count NULLs before
SELECT 
  COUNT(*) FILTER (WHERE type IS NULL) AS null_type,
  COUNT(*) FILTER (WHERE statement IS NULL) AS null_statement,
  COUNT(*) FILTER (WHERE normal_balance IS NULL) AS null_normal_balance,
  COUNT(*) FILTER (WHERE parent_code IS NULL) AS null_parent_code
FROM public.accounts
WHERE status = 'active';

-- 3) Populate type where NULL (title case)
UPDATE public.accounts
SET type = CASE
  WHEN code BETWEEN 1000 AND 1999 THEN 'Asset'
  WHEN code BETWEEN 2000 AND 2999 THEN 'Liability'
  WHEN code BETWEEN 3000 AND 3999 THEN 'Equity'
  WHEN code BETWEEN 4000 AND 4999 THEN 'Income'
  WHEN code BETWEEN 5000 AND 9999 THEN 'Expense'
  ELSE NULL
END::account_type
WHERE status = 'active'
  AND type IS NULL;

-- 4) Populate statement where NULL
UPDATE public.accounts
SET statement = CASE
  WHEN code BETWEEN 1000 AND 3999 THEN 'BS'
  WHEN code BETWEEN 4000 AND 9999 THEN 'PL'
  ELSE NULL
END
WHERE status = 'active'
  AND statement IS NULL;

-- 5) Populate normal_balance where NULL (derived from type)
UPDATE public.accounts
SET normal_balance = CASE
  WHEN type IN ('Asset', 'Expense') THEN 'DR'
  WHEN type IN ('Liability', 'Equity', 'Income') THEN 'CR'
  ELSE NULL
END
WHERE status = 'active'
  AND normal_balance IS NULL;

-- 6) Populate parent_code where NULL, preferring hundred-level then thousand-level, only if parent exists and not self
UPDATE public.accounts a
SET parent_code = derived.parent_code
FROM (
  SELECT
    child.id,
    (
      SELECT pc FROM (
        VALUES ((child.code / 100) * 100),
               ((child.code / 1000) * 1000)
      ) AS candidates(pc)
      WHERE pc <> child.code
        AND EXISTS (SELECT 1 FROM public.accounts p WHERE p.code = pc)
      ORDER BY CASE WHEN pc = ((child.code / 100) * 100) THEN 1 ELSE 2 END
      LIMIT 1
    ) AS parent_code
  FROM public.accounts child
  WHERE child.status = 'active'
    AND child.parent_code IS NULL
) AS derived
WHERE a.id = derived.id
  AND derived.parent_code IS NOT NULL;

-- 7) Count NULLs after
SELECT 
  COUNT(*) FILTER (WHERE type IS NULL) AS null_type,
  COUNT(*) FILTER (WHERE statement IS NULL) AS null_statement,
  COUNT(*) FILTER (WHERE normal_balance IS NULL) AS null_normal_balance,
  COUNT(*) FILTER (WHERE parent_code IS NULL) AS null_parent_code
FROM public.accounts
WHERE status = 'active';

-- 8) Edge cases for manual review
SELECT code, name, type, statement, normal_balance, parent_code
FROM public.accounts
WHERE status = 'active'
  AND (type IS NULL OR statement IS NULL OR normal_balance IS NULL OR parent_code IS NULL)
ORDER BY code;

-- Review results, then explicitly COMMIT or ROLLBACK
-- COMMIT;
-- ROLLBACK;
