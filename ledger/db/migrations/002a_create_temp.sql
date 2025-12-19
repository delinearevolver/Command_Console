-- Create staging table to load CSV into
CREATE TEMP TABLE coa_seed (
  code            INTEGER,
  name            TEXT,
  type            TEXT,
  parent_code     INTEGER,
  statement       TEXT,
  section         TEXT,
  report_line     TEXT,
  normal_balance  TEXT,
  is_contra       BOOLEAN,
  contra_to       INTEGER,
  is_control      BOOLEAN,
  subledger       TEXT,
  posting_allowed BOOLEAN,
  tags            TEXT,
  status          TEXT,
  effective_from  DATE,
  effective_to    DATE
) ON COMMIT DROP;
