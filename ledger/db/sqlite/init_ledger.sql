PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, type TEXT);
CREATE TABLE IF NOT EXISTS journals(id INTEGER PRIMARY KEY, date TEXT, memo TEXT, source TEXT, ref TEXT);
CREATE TABLE IF NOT EXISTS postings(id INTEGER PRIMARY KEY, journal_id INTEGER, account_id INTEGER, debit NUMERIC, credit NUMERIC, invoice_id TEXT);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, invoice_id TEXT UNIQUE, issue_date TEXT, currency TEXT, net NUMERIC, tax NUMERIC, gross NUMERIC, status TEXT);
