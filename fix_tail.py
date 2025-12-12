from pathlib import Path

path = Path('src/components/BillingConsole.jsx')
text = path.read_text(encoding='utf8')
start_marker = '                <Card className="space-y-4">\r\n                    <h3 className="text-lg text-red-400">Payment history</h3>'
start = text.index(start_marker)
new_tail = '''                <Card className="space-y-4">
                    <h3 className="text-lg text-red-400">Payment history</h3>
                    <div className="hidden md:grid md:grid-cols-5 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                        <span>Date</span>
                        <span>Customer</span>
                        <span>Invoice</span>
                        <span className="text-right">Amount</span>
                        <span>Method</span>
                    </div>
                    {paymentHistory.length === 0 && (
                        <p className="text-sm text-gray-500">No payments captured yet.</p>
                    )}
                    {paymentHistory.map(entry => (
                        <div key={entry.id} className="grid grid-cols-1 md:grid-cols-5 gap-3 border border-red-900 bg-gray-900/60 p-3">
                            <div className="text-sm text-gray-300">{entry.date || '-'}</div>
                            <div className="text-sm text-gray-300">{entry.customerName}</div>
                            <div className="text-sm text-gray-300">{entry.invoiceReference}</div>
                            <div className="md:text-right text-sm text-gray-300">{formatCurrency(entry.amount, entry.currency || 'GBP')}</div>
                            <div className="text-sm text-gray-300">{entry.method || '-'}{entry.note ? ` - ${entry.note}` : ''}</div>
                        </div>
                    ))}
                </Card>
            </div>
        )}
    </div>
);

export default BillingConsole;
'''
text = text[:start] + new_tail
path.write_text(text, encoding='utf8')
