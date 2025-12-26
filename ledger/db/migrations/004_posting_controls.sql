BEGIN;

-- Align root/header accounts with non-posting rollups
UPDATE public.accounts
SET name = 'Cash & Bank (Header)', posting_allowed = FALSE
WHERE code = 1000;

-- Main operating bank sits under the cash header and is a posting account
UPDATE public.accounts
SET name = 'Bank - Main', posting_allowed = TRUE, parent_code = 1000
WHERE code = 1010;

-- Top-level rollups should not be directly posted to
UPDATE public.accounts
SET posting_allowed = FALSE
WHERE code IN (
  2000, -- Accounts Payable (Trade Creditors)
  3000, -- Share Capital
  4000, -- Sales - Services
  5000, -- Cost of Sales - Materials
  6000, -- Advertising & Marketing
  7000, -- Corporation Tax Expense
  9000  -- Other Expense - Interest Paid
);

COMMIT;
