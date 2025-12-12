import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, serverTimestamp, where, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db, useAuth } from '../App';
import { Card, Input, Button, Select, TextArea, Label } from './ui';

const STATUS_OPTIONS = ['Draft', 'Sent', 'Acknowledged', 'PartiallyReceived', 'Received', 'Invoiced', 'Completed', 'Cancelled'];
const PAYMENT_TERMS = ['Net 30', 'Net 60', 'Net 90', 'Cash on Delivery'];
const CURRENCIES = ['GBP', 'EUR', 'USD'];

export default function PurchaseOrderConsole() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('current');
    const [draft, setDraft] = useState(getInitialPOState());
    const [hasDraft, setHasDraft] = useState(false);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.orgId) return;
        const unsubSuppliers = onSnapshot(
            query(collection(db, 'suppliers'), where('orgId', '==', user.orgId)),
            (snap) => {
                setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
                setLoading(false);
            },
            () => setLoading(false),
        );
        const unsubPOs = onSnapshot(
            query(collection(db, 'purchaseOrders'), where('orgId', '==', user.orgId)),
            (snap) => setPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        );
        return () => {
            unsubSuppliers();
            unsubPOs();
        };
    }, [user?.orgId]);

    useEffect(() => {
        const totals = calculateTotals(draft.lines);
        setDraft((prev) => ({ ...prev, totals }));
    }, [draft.lines]);

    const handleSaveDraft = async () => {
        if (!user?.orgId) return;
        const payload = {
            ...draft,
            orgId: user.orgId,
            updatedAt: serverTimestamp(),
            lastModifiedBy: user.email || '',
            lastModifiedFrom: 'PO Console',
        };
        try {
            if (draft.id) {
                await updateDoc(doc(db, 'purchaseOrders', draft.id), payload);
            } else {
                const poNumber = `PO-${new Date().getFullYear()}-${String(purchaseOrders.length + 1).padStart(4, '0')}`;
                await addDoc(collection(db, 'purchaseOrders'), {
                    ...payload,
                    id: poNumber,
                    createdAt: serverTimestamp(),
                    createdBy: user.email || '',
                    status: 'Draft',
                });
            }
            setHasDraft(false);
            alert('Purchase order saved');
        } catch (error) {
            alert(error.message || 'Failed to save purchase order');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <p className="text-red-400 text-xl">Loading Purchase Orders...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <Card className="bg-black bg-opacity-90">
                <h1 className="text-3xl font-bold text-red-300">Purchase Orders</h1>
                <p className="text-gray-400 mt-2">Supplier orders and goods receipt</p>
            </Card>

            <Card className="p-0 overflow-hidden">
                <div className="flex flex-wrap border-b border-red-900">
                    <TabButton active={activeTab === 'current'} onClick={() => setActiveTab('current')}>
                        Current PO
                    </TabButton>
                    <TabButton active={activeTab === 'list'} onClick={() => setActiveTab('list')}>
                        PO List ({purchaseOrders.length})
                    </TabButton>
                </div>

                <div className="p-6">
                    {activeTab === 'current' ? (
                        <POBuilder
                            draft={draft}
                            setDraft={setDraft}
                            hasDraft={hasDraft}
                            setHasDraft={setHasDraft}
                            suppliers={suppliers}
                            onSave={handleSaveDraft}
                        />
                    ) : (
                        <POList
                            purchaseOrders={purchaseOrders}
                            onEdit={(po) => {
                                setDraft(po);
                                setHasDraft(false);
                                setActiveTab('current');
                            }}
                        />
                    )}
                </div>
            </Card>
        </div>
    );
}

function TabButton({ active, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 sm:px-6 py-3 font-semibold transition-colors ${
                active
                    ? 'bg-red-800 text-red-200 border-b-2 border-red-400'
                    : 'bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
            }`}
        >
            {children}
        </button>
    );
}

function getInitialPOState() {
    return {
        id: null,
        documentType: 'PurchaseOrder',
        status: 'Draft',
        supplierId: '',
        supplierSnapshot: null,
        supplierReference: '',
        issueDate: new Date().toISOString().split('T')[0],
        expectedDeliveryDate: '',
        currency: 'GBP',
        paymentTerms: 'Net 30',
        paymentTermsDays: 30,
        lines: [],
        totals: { net: 0, tax: 0, gross: 0, received: 0, invoiced: 0 },
        deliveryAddress: null,
        notes: '',
        internalNotes: '',
    };
}

function calculateTotals(lines) {
    const net = lines.reduce((sum, line) => sum + (line.net || 0), 0);
    const tax = lines.reduce((sum, line) => sum + (line.tax || 0), 0);
    const gross = net + tax;
    return {
        net: Math.round(net * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        gross: Math.round(gross * 100) / 100,
        received: 0,
        invoiced: 0,
    };
}

function createNewLine(lineNumber, expenseAccount) {
    return updateLineCalculations({
        lineNumber,
        sku: '',
        description: '',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 0,
        taxRate: 20,
        net: 0,
        tax: 0,
        gross: 0,
        quantityReceived: 0,
        quantityInvoiced: 0,
        expenseAccount: expenseAccount || '5000-Expenses:General',
        projectId: null,
        costCenter: '',
    });
}

function updateLineCalculations(line) {
    const qty = parseFloat(line.quantity) || 0;
    const price = parseFloat(line.unitPrice) || 0;
    const rate = parseFloat(line.taxRate) || 0;

    const net = qty * price;
    const tax = net * (rate / 100);
    const gross = net + tax;

    return {
        ...line,
        net: Math.round(net * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        gross: Math.round(gross * 100) / 100,
    };
}

function POBuilder({ draft, setDraft, hasDraft, setHasDraft, suppliers, onSave }) {
    const handleSupplierSelect = (supplierId) => {
        const supplier = suppliers.find((s) => s.id === supplierId);
        if (!supplier) return;
        setDraft((prev) => ({
            ...prev,
            supplierId,
            supplierSnapshot: {
                name: supplier.name,
                email: supplier.email,
                phone: supplier.phone,
                paymentTerms: supplier.paymentTerms,
                currency: supplier.currency,
                ledgerSupplierId: supplier.ledgerSupplierId || '',
                ledgerControlAccountId: supplier.ledgerControlAccountId || '',
                defaultExpenseAccount: supplier.defaultExpenseAccount || '',
            },
            currency: supplier.currency || prev.currency,
            paymentTerms: supplier.paymentTerms || prev.paymentTerms,
            paymentTermsDays: supplier.paymentTermsDays || prev.paymentTermsDays,
        }));
        setHasDraft(true);
    };

    const handleFieldChange = (key, value) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
        setHasDraft(true);
    };

    const addLine = () => {
        const expenseAccount = draft.supplierSnapshot?.defaultExpenseAccount || '5000-Expenses:General';
        setDraft((prev) => ({
            ...prev,
            lines: [...prev.lines, createNewLine(prev.lines.length + 1, expenseAccount)],
        }));
        setHasDraft(true);
    };

    const updateLine = (index, field, value) => {
        setDraft((prev) => {
            const lines = prev.lines.map((line, idx) => {
                if (idx !== index) return line;
                const next = { ...line, [field]: value };
                return updateLineCalculations(next);
            });
            return { ...prev, lines };
        });
        setHasDraft(true);
    };

    const removeLine = (index) => {
        setDraft((prev) => {
            const lines = prev.lines.filter((_, idx) => idx !== index).map((line, idx) => ({ ...line, lineNumber: idx + 1 }));
            return { ...prev, lines };
        });
        setHasDraft(true);
    };

    const canSave = draft.supplierId && draft.lines.length > 0;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <Label>Supplier</Label>
                    <Select value={draft.supplierId} onChange={(e) => handleSupplierSelect(e.target.value)}>
                        <option value="">Select supplier...</option>
                        {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name || 'Supplier'}</option>
                        ))}
                    </Select>
                </div>
                <div>
                    <Label>Status</Label>
                    <Select value={draft.status} onChange={(e) => handleFieldChange('status', e.target.value)}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                </div>
                <div>
                    <Label>Issue Date</Label>
                    <Input type="date" value={draft.issueDate} onChange={(e) => handleFieldChange('issueDate', e.target.value)} />
                </div>
                <div>
                    <Label>Expected Delivery</Label>
                    <Input
                        type="date"
                        value={draft.expectedDeliveryDate}
                        onChange={(e) => handleFieldChange('expectedDeliveryDate', e.target.value)}
                    />
                </div>
                <div>
                    <Label>Payment Terms</Label>
                    <Select value={draft.paymentTerms} onChange={(e) => handleFieldChange('paymentTerms', e.target.value)}>
                        {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                </div>
                <div>
                    <Label>Currency</Label>
                    <Select value={draft.currency} onChange={(e) => handleFieldChange('currency', e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                </div>
            </div>

            <Card className="bg-gray-900 border-red-900 space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-red-300">Line Items</h3>
                    <Button className="w-auto px-4 py-1" onClick={addLine}>+ Add line</Button>
                </div>
                {draft.lines.length === 0 ? (
                    <p className="text-gray-400 text-sm">No lines yet. Add a line to start building the PO.</p>
                ) : (
                    <div className="space-y-3">
                        {draft.lines.map((line, idx) => (
                            <Card key={idx} className="bg-gray-950 border-red-800">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-gray-300 font-semibold">Line {line.lineNumber}</span>
                                    <Button
                                        className="w-auto bg-gray-700 hover:bg-gray-600 px-3 py-1 text-sm"
                                        onClick={() => removeLine(idx)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-2">
                                        <Label>Description</Label>
                                        <Input
                                            value={line.description}
                                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                                            placeholder="Item description"
                                        />
                                    </div>
                                    <div>
                                        <Label>SKU</Label>
                                        <Input
                                            value={line.sku}
                                            onChange={(e) => updateLine(idx, 'sku', e.target.value)}
                                            placeholder="SKU/Code"
                                        />
                                    </div>
                                    <div>
                                        <Label>Quantity</Label>
                                        <Input
                                            type="number"
                                            value={line.quantity}
                                            onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>Unit Price</Label>
                                        <Input
                                            type="number"
                                            value={line.unitPrice}
                                            onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>Tax Rate %</Label>
                                        <Input
                                            type="number"
                                            value={line.taxRate}
                                            onChange={(e) => updateLine(idx, 'taxRate', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>Expense Account</Label>
                                        <Input
                                            value={line.expenseAccount}
                                            onChange={(e) => updateLine(idx, 'expenseAccount', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>UoM</Label>
                                        <Input
                                            value={line.unitOfMeasure}
                                            onChange={(e) => updateLine(idx, 'unitOfMeasure', e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-200">
                                    <div className="border border-red-900 bg-gray-900/70 p-2 rounded">
                                        <div className="text-xs text-gray-500">Net</div>
                                        <div className="font-semibold">{draft.currency} {line.net.toFixed(2)}</div>
                                    </div>
                                    <div className="border border-red-900 bg-gray-900/70 p-2 rounded">
                                        <div className="text-xs text-gray-500">Tax</div>
                                        <div className="font-semibold">{draft.currency} {line.tax.toFixed(2)}</div>
                                    </div>
                                    <div className="border border-red-900 bg-gray-900/70 p-2 rounded">
                                        <div className="text-xs text-gray-500">Gross</div>
                                        <div className="font-semibold">{draft.currency} {line.gross.toFixed(2)}</div>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </Card>

            <Card className="bg-gray-900 border-red-900">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-200">
                    <div className="border border-red-900 bg-gray-950 p-3 rounded">
                        <div className="text-xs text-gray-500">Net</div>
                        <div className="text-lg font-semibold">{draft.currency} {draft.totals.net.toFixed(2)}</div>
                    </div>
                    <div className="border border-red-900 bg-gray-950 p-3 rounded">
                        <div className="text-xs text-gray-500">Tax</div>
                        <div className="text-lg font-semibold">{draft.currency} {draft.totals.tax.toFixed(2)}</div>
                    </div>
                    <div className="border border-red-900 bg-gray-950 p-3 rounded">
                        <div className="text-xs text-gray-500">Gross</div>
                        <div className="text-lg font-semibold">{draft.currency} {draft.totals.gross.toFixed(2)}</div>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <Label>Notes</Label>
                    <TextArea rows={3} value={draft.notes} onChange={(e) => handleFieldChange('notes', e.target.value)} />
                </div>
                <div>
                    <Label>Internal Notes</Label>
                    <TextArea rows={3} value={draft.internalNotes} onChange={(e) => handleFieldChange('internalNotes', e.target.value)} />
                </div>
            </div>

            <div className="flex gap-3 justify-end">
                <Button className="w-auto bg-gray-700 hover:bg-gray-600" onClick={() => setDraft(getInitialPOState())}>
                    Reset
                </Button>
                <Button className="w-auto px-6" onClick={onSave} disabled={!canSave}>
                    Save PO
                </Button>
            </div>
        </div>
    );
}

function POList({ purchaseOrders, onEdit }) {
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    const filtered = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return purchaseOrders.filter((po) => {
            if (filterStatus !== 'all' && po.status !== filterStatus) return false;
            if (!term) return true;
            return (
                po.id?.toLowerCase().includes(term) ||
                po.supplierSnapshot?.name?.toLowerCase().includes(term)
            );
        });
    }, [purchaseOrders, filterStatus, searchTerm]);

    if (!purchaseOrders.length) {
        return <p className="text-gray-400">No purchase orders yet.</p>;
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                    placeholder="Search PO number or supplier..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">All Statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </Select>
            </div>
            <div className="space-y-3">
                {filtered.map((po) => (
                    <Card
                        key={po.id || po.reference}
                        className="border-red-900 bg-gray-900/70 hover:border-red-500 cursor-pointer"
                        onClick={() => onEdit(po)}
                    >
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-sm text-gray-400">{po.id || 'Unnumbered PO'}</p>
                                <p className="text-lg font-bold text-red-300">{po.supplierSnapshot?.name || 'Supplier'}</p>
                                <p className="text-xs text-gray-500">{po.issueDate}</p>
                            </div>
                            <StatusPill status={po.status} />
                        </div>
                        <div className="text-sm text-gray-300 mt-2">
                            Total: {po.currency || 'GBP'} {po.totals?.gross?.toFixed ? po.totals.gross.toFixed(2) : (po.totals?.gross || 0)}
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}

function StatusPill({ status }) {
    const color = {
        Draft: 'bg-gray-800 text-gray-200',
        Sent: 'bg-blue-800 text-blue-200',
        Acknowledged: 'bg-purple-800 text-purple-200',
        PartiallyReceived: 'bg-amber-800 text-amber-200',
        Received: 'bg-green-800 text-green-200',
        Invoiced: 'bg-orange-800 text-orange-200',
        Completed: 'bg-green-900 text-green-100',
        Cancelled: 'bg-red-900 text-red-200',
    }[status] || 'bg-gray-800 text-gray-200';
    return (
        <span className={`px-2 py-1 text-xs rounded ${color}`}>
            {status || 'Draft'}
        </span>
    );
}
