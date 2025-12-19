import sqlite3
conn = sqlite3.connect('ledger.db')
cur = conn.cursor()
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('Tables in database:')
for t in tables:
    print(f'  - {t[0]}')
    
# Show first table's structure
if tables:
    first_table = tables[0][0]
    print(f'\nStructure of {first_table}:')
    cur.execute(f'PRAGMA table_info({first_table})')
    for col in cur.fetchall():
        print(f'  - {col[1]} ({col[2]})')
    
    # Show sample data
    print(f'\nSample data from {first_table}:')
    cur.execute(f'SELECT * FROM {first_table} LIMIT 5')
    for row in cur.fetchall():
        print(row)
