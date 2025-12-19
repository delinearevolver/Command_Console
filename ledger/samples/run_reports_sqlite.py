#!/usr/bin/env python3
import sqlite3, csv, os
os.makedirs('reports',exist_ok=True)
db=sqlite3.connect('ledger.db'); cur=db.cursor()
cur.execute('CREATE VIEW IF NOT EXISTS pl_ytd AS SELECT "Income" as type, "4000-Sales:Services" as code, "Sales - Services" as name, -SUM(credit) as amount FROM postings p JOIN accounts a ON a.id=p.account_id WHERE a.code="4000-Sales:Services" UNION ALL SELECT "Expense","5000-Expenses:General","Expenses - General",SUM(debit) FROM postings p JOIN accounts a ON a.id=p.account_id WHERE a.code="5000-Expenses:General"')
cur.execute('CREATE VIEW IF NOT EXISTS balance_sheet AS SELECT "Asset" as type, "1100-AR" as code, "Accounts Receivable" as name, SUM(debit-credit) as amount FROM postings p JOIN accounts a ON a.id=p.account_id WHERE a.code="1100-AR" UNION ALL SELECT "Liability","2000-VAT Payable","VAT Payable", SUM(credit-debit) FROM postings p JOIN accounts a ON a.id=p.account_id WHERE a.code="2000-VAT Payable" UNION ALL SELECT "Asset","1000-Bank","Bank", SUM(debit-credit) FROM postings p JOIN accounts a ON a.id=p.account_id WHERE a.code="1000-Bank"')
for view, out in [('pl_ytd','reports/pl_ytd.csv'),('balance_sheet','reports/balance_sheet_asof.csv')]:
    rows=cur.execute(f'SELECT * FROM {view}').fetchall()
    with open(out,'w',newline='') as f: w=csv.writer(f); w.writerow(['type','code','name','amount']); w.writerows(rows)
print('Wrote CSVs'); db.close()