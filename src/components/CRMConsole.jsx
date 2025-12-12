import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, useAuth } from '../App';
import { Card, Input, Select } from './ui';

const TYPE_LABELS = {
    invoice: 'Invoice',
    purchaseOrder: 'Purchase Order',
    goodsReceipt: 'Goods Receipt',
    interaction: 'Interaction',
};

export default function CRMConsole() {
    const { user } = useAuth();
    const [interactions, setInteractions] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!user?.orgId) return;
        const unsubs = [];
        unsubs.push(onSnapshot(query(collection(db, 'interactions'), where('orgId', '==', user.orgId)), snap => {
            setInteractions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }));
        unsubs.push(onSnapshot(query(collection(db, 'invoices'), where('orgId', '==', user.orgId)), snap => {
            setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }));
        unsubs.push(onSnapshot(query(collection(db, 'purchaseOrders'), where('orgId', '==', user.orgId)), snap => {
            setPurchaseOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }));
        return () => unsubs.forEach(u => u());
    }, [user?.orgId]);

    const timeline = useMemo(() => {
        const items = [];
        interactions.forEach(it => items.push({
            id: `int-${it.id}`,
            kind: 'interaction',
            date: it.date || (it.createdAt?.toDate ? it.createdAt.toDate().toISOString().slice(0, 10) : ''),
            title: it.subject || 'Interaction',
            subtitle: it.relatedToName || it.type,
            details: it.description || '',
        }));
        invoices.forEach(inv => items.push({
            id: `inv-${inv.id}`,
            kind: 'invoice',
            date: inv.issueDate || inv.createdAt?.toDate?.().toISOString().slice(0, 10) || '',
            title: inv.reference || inv.invoiceId || inv.id,
            subtitle: inv.customerName || 'Customer',
            details: `${inv.currency || 'GBP'} ${(inv.totals?.gross || 0).toFixed ? inv.totals.gross.toFixed(2) : inv.totals?.gross || 0}`,
        }));
        purchaseOrders.forEach(po => items.push({
            id: `po-${po.id}`,
            kind: 'purchaseOrder',
            date: po.issueDate || po.createdAt?.toDate?.().toISOString().slice(0, 10) || '',
            title: po.id,
            subtitle: po.supplierSnapshot?.name || 'Supplier',
            details: `${po.currency || 'GBP'} ${(po.totals?.gross || 0).toFixed ? po.totals.gross.toFixed(2) : po.totals?.gross || 0}`,
        }));
        return items
            .filter(item => {
                if (filter !== 'all' && item.kind !== filter) return false;
                if (!search) return true;
                const term = search.toLowerCase();
                return [item.title, item.subtitle, item.details].some(v => (v || '').toLowerCase().includes(term));
            })
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [interactions, invoices, purchaseOrders, filter, search]);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <Card className="bg-black bg-opacity-90">
                <h1 className="text-3xl font-bold text-red-300">CRM</h1>
                <p className="text-gray-400 mt-2">Interactions enriched with real transactions (invoices & POs)</p>
            </Card>

            <Card className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input
                        placeholder="Search interactions & transactions..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
                        <option value="all">All types</option>
                        <option value="interaction">Interactions</option>
                        <option value="invoice">Invoices</option>
                        <option value="purchaseOrder">Purchase Orders</option>
                    </Select>
                </div>

                {timeline.length === 0 ? (
                    <p className="text-gray-400">No CRM activity yet.</p>
                ) : (
                    <div className="space-y-3">
                        {timeline.map(item => (
                            <Card key={item.id} className="bg-gray-900 border-red-900">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-xs text-gray-500">{item.date || 'No date'}</p>
                                        <p className="text-lg font-semibold text-red-300">{item.title}</p>
                                        <p className="text-sm text-gray-300">{item.subtitle}</p>
                                        {item.details && <p className="text-sm text-gray-400 mt-1">{item.details}</p>}
                                    </div>
                                    <span className="text-xs px-2 py-1 rounded bg-red-800 text-red-100">
                                        {TYPE_LABELS[item.kind] || item.kind}
                                    </span>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
