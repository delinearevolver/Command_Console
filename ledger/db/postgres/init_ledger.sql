DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE account_type AS ENUM ('Asset','Liability','Equity','Income','Expense');
  END IF;
END
$$ LANGUAGE plpgsql;
CREATE TABLE IF NOT EXISTS accounts(id SERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT, type account_type);
CREATE TABLE IF NOT EXISTS journals(id SERIAL PRIMARY KEY, date DATE, memo TEXT, source TEXT, ref TEXT);
CREATE TABLE IF NOT EXISTS postings(id SERIAL PRIMARY KEY, journal_id INT REFERENCES journals(id), account_id INT REFERENCES accounts(id), debit NUMERIC, credit NUMERIC, invoice_id TEXT);
CREATE TABLE IF NOT EXISTS invoices(id SERIAL PRIMARY KEY, invoice_id TEXT UNIQUE, issue_date DATE, currency TEXT, net NUMERIC, tax NUMERIC, gross NUMERIC, status TEXT);
