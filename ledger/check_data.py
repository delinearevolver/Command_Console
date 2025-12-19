import sqlite3
conn = sqlite3.connect('ledger.db')
cur = conn.cursor()

print('JOURNALS (transactions):')
cur.execute('SELECT * FROM journals LIMIT 5')
for row in cur.fetchall():
    print(row)

print('\nPOSTINGS (debits/credits):')
cur.execute('SELECT * FROM postings LIMIT 10')
for row in cur.fetchall():
    print(row)
    
print('\nINVOICES:')
cur.execute('SELECT * FROM invoices LIMIT 5')
for row in cur.fetchall():
    print(row)

# Get a summary
cur.execute('SELECT COUNT(*) FROM journals')
journal_count = cur.fetchone()[0]
cur.execute('SELECT MIN(date), MAX(date) FROM journals')
date_range = cur.fetchone()
print(f'\nTotal transactions: {journal_count}')
print(f'Date range: {date_range[0]} to {date_range[1]}')
