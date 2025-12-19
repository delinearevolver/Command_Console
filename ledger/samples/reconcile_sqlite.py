#!/usr/bin/env python3
import sqlite3, sys, xml.etree.ElementTree as ET, re
NS={'ns':'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02'}
def ids(e): 
    return set(re.findall(r'(CMQUO-\d{4}-\d{4,})',' '.join([(x.text or '') for x in e.findall('.//ns:RmtInf/ns:Ustrd',NS)+e.findall('.//ns:Refs/ns:TxId',NS)])))
def main(xml, db='ledger.db'):
    c=sqlite3.connect(db); cur=c.cursor()
    for n in ET.parse(xml).getroot().findall('.//ns:Ntry',NS):
        if n.findtext('ns:CdtDbtInd',namespaces=NS)!='CRDT': continue
        amt=float(n.findtext('ns:Amt',namespaces=NS))
        for inv in ids(n):
            cur.execute('INSERT INTO journals(date,memo,source,ref) VALUES (date("now"),"Payment","camt.053",?)',(inv,)); jid=cur.lastrowid
            for ac,deb,cred in [('1000-Bank',amt,0),('1100-AR',0,amt)]:
                cur.execute('SELECT id FROM accounts WHERE code=?',(ac,)); aid=cur.fetchone()[0]
                cur.execute('INSERT INTO postings(journal_id,account_id,debit,credit,invoice_id) VALUES (?,?,?,?,?)',(jid,aid,deb,cred,inv))
            cur.execute('UPDATE invoices SET status="Paid" WHERE invoice_id=? AND ABS(gross-?)<0.01',(inv,amt))
    c.commit(); c.close(); print('Done')
if __name__=='__main__':
    if len(sys.argv)<2: print('usage: reconcile_sqlite.py statement.xml'); sys.exit(1)
    main(sys.argv[1])