#!/usr/bin/env python3
import sqlite3
c=sqlite3.connect('ledger.db'); cur=c.cursor()
for code,name,typ in [('1000-Bank','Bank','Asset'),('1100-AR','Accounts Receivable','Asset'),('2000-VAT Payable','VAT Payable','Liability'),('3000-Retained Earnings','Retained Earnings','Equity'),('4000-Sales:Services','Sales - Services','Income'),('5000-Expenses:General','Expenses - General','Expense')]:
    cur.execute('INSERT OR IGNORE INTO accounts(code,name,type) VALUES (?,?,?)',(code,name,typ))
cur.execute('INSERT OR IGNORE INTO invoices(invoice_id,issue_date,currency,net,tax,gross,status) VALUES (?,?,?,?,?,?,?)',('CMQUO-2025-0001','2025-09-28','GBP',1000,200,1200,'Sent'))
cur.execute('INSERT INTO journals(date,memo,source,ref) VALUES (date("now"),"Invoice posted","seed","CMQUO-2025-0001")'); jid=cur.lastrowid
def acct(code): cur.execute('SELECT id FROM accounts WHERE code=?',(code,)); return cur.fetchone()[0]
cur.execute('INSERT INTO postings(journal_id,account_id,debit,credit,invoice_id) VALUES (?,?,?,?,?)',(jid,acct('1100-AR'),1200,0,'CMQUO-2025-0001'))
cur.execute('INSERT INTO postings(journal_id,account_id,debit,credit,invoice_id) VALUES (?,?,?,?,?)',(jid,acct('4000-Sales:Services'),0,1000,'CMQUO-2025-0001'))
cur.execute('INSERT INTO postings(journal_id,account_id,debit,credit,invoice_id) VALUES (?,?,?,?,?)',(jid,acct('2000-VAT Payable'),0,200,'CMQUO-2025-0001'))
c.commit(); c.close(); print('Seeded')