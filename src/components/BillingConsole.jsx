import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, useAuth, useData } from '../App';
import { Card, Input, Button, Select, TextArea } from './ui';

const randomId = () => {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (error) {
        return Math.random().toString(36).slice(2);
    }
    return Math.random().toString(36).slice(2);
};

const asNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const toEditableItem = (item = {}) => ({
    tempId: item.tempId || item.id || item.sku || randomId(),
    sku: item.sku || '',
    name: item.name || '',
    description: item.description || '',
    unitPrice: asNumber(item.unitPrice),
    taxRate: asNumber(item.taxRate),
    defaultQuantity: asNumber(item.defaultQuantity, 1) || 1,
});

const toInvoiceLine = (item = {}, invoiceDate = todayISO()) => ({
    tempId: randomId(),
    sku: item.sku || '',
    description: item.description || item.name || '',
    quantity: asNumber(item.quantity ?? item.defaultQuantity, 1) || 1,
    unitPrice: asNumber(item.unitPrice),
    taxRate: asNumber(item.taxRate),
    lineDate: item.lineDate || invoiceDate,
    isoWeek: item.isoWeek || getISOWeek(item.lineDate || invoiceDate),
});

const blankInvoiceLine = (invoiceDate = todayISO()) => toInvoiceLine({ 
    description: '', 
    quantity: 1, 
    unitPrice: 0, 
    taxRate: 0 
}, invoiceDate);


const sanitizePriceItems = (items = []) => items.map(({ tempId, ...rest }) => ({
    sku: (rest.sku || '').trim(),
    name: (rest.name || '').trim(),
    description: (rest.description || '').trim(),
    unitPrice: Number.parseFloat(rest.unitPrice) || 0,
    taxRate: Number.parseFloat(rest.taxRate) || 0,
    defaultQuantity: Number.parseFloat(rest.defaultQuantity) || 1,
}));

const sanitizeInvoiceLines = (items = [], invoiceDate = todayISO()) => items.map(({ tempId, ...rest }) => {
    const lineDate = rest.lineDate || invoiceDate;
    const quantity = Number.parseFloat(rest.quantity);
    const unitPrice = Number.parseFloat(rest.unitPrice);
    const taxRate = Number.parseFloat(rest.taxRate);
    return {
        sku: (rest.sku || '').trim(),
        description: (rest.description || '').trim(),
        lineDate,
        isoWeek: getISOWeek(lineDate),
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        taxRate: Number.isFinite(taxRate) ? taxRate : 0,
    };
});

const calculateTotals = (lines = []) => {
    let net = 0; let tax = 0;
    lines.forEach(line => {
        const qty = asNumber(line.quantity, 0);
        const price = asNumber(line.unitPrice, 0);
        const rate = asNumber(line.taxRate, 0);
        const lineNet = qty * price;
        net += lineNet;
        if (rate) tax += lineNet * rate / 100;
    });
    const gross = net + tax;
    return { net: Number(net.toFixed(2)), tax: Number(tax.toFixed(2)), gross: Number(gross.toFixed(2)) };
};

const formatCurrency = (value, currency = 'GBP') => {
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value || 0);
    } catch (error) {
        return (value || 0).toFixed(2);
    }
};

const addDays = (days = 0) => {
    const value = Number(days);
    if (!Number.isFinite(value)) return '';
    const base = new Date();
    base.setDate(base.getDate() + value);
    return base.toISOString().slice(0, 10);
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const getISOWeek = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const dayOfWeek = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dayOfWeek + 3);
    const firstThursday = new Date(date.getFullYear(), 0, 4);
    const weekNumber = Math.ceil(((date - firstThursday) / 86400000 + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

const BillingConsole = () => {
    const { user } = useAuth();
    const { customers = [], priceBooks = [], invoices = [], invoiceTemplates = [], loading } = useData();
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [masterDraft, setMasterDraft] = useState({ name: 'Master Price Book', items: [] });
    const [customerDraft, setCustomerDraft] = useState(null);
    const [invoiceDraft, setInvoiceDraft] = useState({ 
    reference: '', 
    issueDate: todayISO(), 
    dueDate: '', 
    currency: 'GBP', 
    notes: '', 
    lineItems: [blankInvoiceLine(todayISO())] 
    });
    const [templateMeta, setTemplateMeta] = useState({ name: '', cadence: 'monthly', dueInDays: '30' });
    const [masterMessage, setMasterMessage] = useState(null);
    const [customerMessage, setCustomerMessage] = useState(null);
    const [invoiceMessage, setInvoiceMessage] = useState(null);
    const [templateMessage, setTemplateMessage] = useState(null);
    const lastCustomerRef = useRef('');

    const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId) || null, [customers, selectedCustomerId]);
    const masterPriceBook = useMemo(() => priceBooks.find(pb => pb.isMaster) || null, [priceBooks]);
    const assignedPriceBook = useMemo(() => {
        if (!selectedCustomer) return null;
        return priceBooks.find(pb => pb.id === selectedCustomer.priceBookId) || null;
    }, [priceBooks, selectedCustomer]);
    const activePriceBook = assignedPriceBook || masterPriceBook;

    useEffect(() => {
        if (masterPriceBook) {
            setMasterDraft({
                id: masterPriceBook.id,
                name: masterPriceBook.name || 'Master Price Book',
                items: (masterPriceBook.items || []).map(toEditableItem),
            });
        } else {
            setMasterDraft(prev => ({ ...prev, name: prev.name || 'Master Price Book' }));
        }
    }, [masterPriceBook]);

    useEffect(() => {
        if (!selectedCustomer) {
            setCustomerDraft(null);
            return;
        }
        if (assignedPriceBook && !assignedPriceBook.isMaster) {
            setCustomerDraft({
                id: assignedPriceBook.id,
                name: assignedPriceBook.name || `${selectedCustomer.name} Price Book`,
                items: (assignedPriceBook.items || []).map(toEditableItem),
                isCustom: true,
            });
        } else {
            setCustomerDraft({
                id: activePriceBook?.id || null,
                name: activePriceBook?.name || `${selectedCustomer?.name || 'Customer'} Price Book`,
                items: (activePriceBook?.items || []).map(toEditableItem),
                isCustom: false,
            });
        }
    }, [selectedCustomer, assignedPriceBook, activePriceBook]);

    useEffect(() => {
        if (!selectedCustomerId) {
            lastCustomerRef.current = '';
            setInvoiceDraft(prev => ({ ...prev, lineItems: [blankInvoiceLine(prev.issueDate)] }));
            return;
            }
        if (lastCustomerRef.current !== selectedCustomerId) {
            lastCustomerRef.current = selectedCustomerId;
            const base = (activePriceBook?.items || []).map(toInvoiceLine);
            setInvoiceDraft(prev => ({
                ...prev,
                currency: prev.currency || selectedCustomer?.currency || 'GBP',
                lineItems: base.length ? base : [blankInvoiceLine(prev.issueDate)],
            }));
        }
    }, [selectedCustomerId, activePriceBook, selectedCustomer]);

    const addMasterRow = () => setMasterDraft(prev => ({ ...prev, items: [...prev.items, toEditableItem()] }));
    const updateMasterRow = (id, field, value) => setMasterDraft(prev => ({ ...prev, items: prev.items.map(item => item.tempId === id ? { ...item, [field]: value } : item) }));
    const removeMasterRow = (id) => setMasterDraft(prev => ({ ...prev, items: prev.items.filter(item => item.tempId !== id) }));

    const addCustomerRow = () => setCustomerDraft(prev => !prev ? prev : ({ ...prev, items: [...prev.items, toEditableItem()] }));
    const updateCustomerRow = (id, field, value) => setCustomerDraft(prev => !prev ? prev : ({ ...prev, items: prev.items.map(item => item.tempId === id ? { ...item, [field]: value } : item) }));
    const removeCustomerRow = (id) => setCustomerDraft(prev => !prev ? prev : ({ ...prev, items: prev.items.filter(item => item.tempId !== id) }));

    const addInvoiceLineRow = () => setInvoiceDraft(prev => ({ ...prev, lineItems: [...prev.lineItems, blankInvoiceLine(prev.issueDate)] }));
    const updateInvoiceLine = (id, field, value) => setInvoiceDraft(prev => ({
        ...prev,
        lineItems: prev.lineItems.map(line => {
            if (line.tempId !== id) return line;
            const updated = { ...line, [field]: value };
            if (field === 'lineDate') {
                const lineDate = value || prev.issueDate || todayISO();
                updated.lineDate = lineDate;
                updated.isoWeek = getISOWeek(lineDate);
            }
            return updated;
        }),
    }));
    const removeInvoiceLine = (id) => setInvoiceDraft(prev => ({
        ...prev,
        lineItems: prev.lineItems.length > 1
            ? prev.lineItems.filter(line => line.tempId !== id)
            : [blankInvoiceLine(prev.issueDate)],
    }));

    const loadPriceBookIntoInvoice = () => {
        const lines = (activePriceBook?.items || []).map(item => toInvoiceLine(item, invoiceDraft.issueDate));
        setInvoiceDraft(prev => ({ ...prev, lineItems: lines.length ? lines : [blankInvoiceLine(prev.issueDate)] }));

    };

    const handleSaveMaster = async (event) => {
        event.preventDefault();
        if (!user?.orgId) return;
        const payload = { orgId: user.orgId, isMaster: true, name: masterDraft.name.trim() || 'Master Price Book', items: sanitizePriceItems(masterDraft.items), updatedAt: serverTimestamp() };
        try {
            if (masterPriceBook?.id) {
                await updateDoc(doc(db, 'priceBooks', masterPriceBook.id), payload);
            } else {
                await addDoc(collection(db, 'priceBooks'), { ...payload, createdAt: serverTimestamp() });
            }
            setMasterMessage({ type: 'success', message: 'Master price book saved.' });
        } catch (error) {
            console.error('Failed to save master price book', error);
            setMasterMessage({ type: 'error', message: 'Unable to save master price book.' });
        }
    };

    const handleCreateCustomer = async (event) => {
        event.preventDefault();
        if (!user?.orgId) return;
        const form = event.target;
        const name = form.customerName.value.trim();
        if (!name) {
            setCustomerMessage({ type: 'error', message: 'Customer name is required.' });
            return;
        }
        try {
            const docRef = await addDoc(collection(db, 'customers'), {
                orgId: user.orgId,
                name,
                email: form.customerEmail.value.trim(),
                paymentTerms: form.customerTerms.value.trim() || 'Net 30',
                billingAddress: form.customerAddress.value.trim(),
                priceBookId: masterPriceBook?.id || null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            form.reset();
            setSelectedCustomerId(docRef.id);
            setCustomerMessage({ type: 'success', message: 'Customer added and linked to master price book.' });
        } catch (error) {
            console.error('Failed to create customer', error);
            setCustomerMessage({ type: 'error', message: 'Unable to create customer.' });
        }
    };

    const handleSaveCustomerPricing = async () => {
        if (!selectedCustomer || !user?.orgId || !customerDraft) return;
        try {
            const items = sanitizePriceItems(customerDraft.items && customerDraft.items.length ? customerDraft.items : masterDraft.items);
            if (customerDraft.isCustom && customerDraft.id) {
                await updateDoc(doc(db, 'priceBooks', customerDraft.id), {
                    name: customerDraft.name || selectedCustomer.name + ' Price Book',
                    items,
                    updatedAt: serverTimestamp(),
                });
            } else {
                const newDoc = await addDoc(collection(db, 'priceBooks'), {
                    orgId: user.orgId,
                    name: customerDraft.name || selectedCustomer.name + ' Price Book',
                    customerId: selectedCustomer.id,
                    isMaster: false,
                    items,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                await updateDoc(doc(db, 'customers', selectedCustomer.id), {
                    priceBookId: newDoc.id,
                    updatedAt: serverTimestamp(),
                });
            }
            setCustomerMessage({ type: 'success', message: 'Customer price book saved.' });
        } catch (error) {
            console.error('Failed to save customer price book', error);
            setCustomerMessage({ type: 'error', message: 'Unable to save customer price book.' });
        }
    };

    const handleRevertToMaster = async () => {
        if (!selectedCustomer || !masterPriceBook) return;
        try {
            if (assignedPriceBook && !assignedPriceBook.isMaster) {
                await deleteDoc(doc(db, 'priceBooks', assignedPriceBook.id));
            }
            await updateDoc(doc(db, 'customers', selectedCustomer.id), {
                priceBookId: masterPriceBook.id,
                updatedAt: serverTimestamp(),
            });
            setCustomerMessage({ type: 'success', message: 'Customer now uses the master price book.' });
        } catch (error) {
            console.error('Failed to revert customer price book', error);
            setCustomerMessage({ type: 'error', message: 'Unable to revert to master price book.' });
        }
    };

    const handleInvoiceSubmit = async (event) => {
        event.preventDefault();
        if (!selectedCustomer || !user?.orgId) {
            setInvoiceMessage({ type: 'error', message: 'Select a customer first.' });
            return;
        }
        const sanitized = sanitizeInvoiceLines(invoiceDraft.lineItems, invoiceDraft.issueDate || todayISO()).filter(line => line.description && line.quantity > 0);
        if (!sanitized.length) {
            setInvoiceMessage({ type: 'error', message: 'Add at least one invoice line.' });
            return;
        }
        const totals = calculateTotals(sanitized);
        const payload = {
            orgId: user.orgId,
            customerId: selectedCustomer.id,
            reference: invoiceDraft.reference.trim(),
            issueDate: invoiceDraft.issueDate || todayISO(),
            dueDate: invoiceDraft.dueDate || null,
            currency: invoiceDraft.currency || 'GBP',
            notes: invoiceDraft.notes.trim(),
            lines: sanitized,
            totals,
            status: 'Draft',
            priceBookId: activePriceBook?.id || null,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        try {
            await addDoc(collection(db, 'invoices'), payload);
            setInvoiceMessage({ type: 'success', message: 'Invoice saved.' });
            setInvoiceDraft(prev => ({ ...prev, reference: '', lineItems: [blankInvoiceLine(prev.issueDate)] }));
        } catch (error) {
            console.error('Failed to save invoice', error);
            setInvoiceMessage({ type: 'error', message: 'Unable to save invoice.' });
        }
    };

    const handleSaveTemplate = async (event) => {
        event.preventDefault();
        if (!templateMeta.name.trim()) {
            setTemplateMessage({ type: 'error', message: 'Template name is required.' });
            return;
        }
        const sanitized = sanitizeInvoiceLines(invoiceDraft.lineItems, invoiceDraft.issueDate || todayISO()).filter(line => line.description && line.quantity > 0);
        try {
            await addDoc(collection(db, 'invoiceTemplates'), {
                orgId: user?.orgId,
                name: templateMeta.name.trim(),
                cadence: templateMeta.cadence,
                dueInDays: templateMeta.dueInDays ? Number(templateMeta.dueInDays) : null,
                currency: invoiceDraft.currency || 'GBP',
                notes: invoiceDraft.notes.trim(),
                customerId: selectedCustomer?.id || null,
                priceBookId: activePriceBook?.id || null,
                lines: sanitized,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            setTemplateMessage({ type: 'success', message: 'Template saved.' });
        } catch (error) {
            console.error('Failed to save template', error);
            setTemplateMessage({ type: 'error', message: 'Unable to save template.' });
        }
    };

    const applyTemplate = (template) => {
        if (!template) return;
        if (template.customerId) setSelectedCustomerId(template.customerId);
        const linesFromTemplate = (template.lines || []).map(item => toInvoiceLine(item, invoiceDraft.issueDate));
        const due = template.dueInDays ? addDays(template.dueInDays) : invoiceDraft.dueDate;
        setInvoiceDraft(prev => ({
            ...prev,
            reference: template.referencePrefix || prev.reference,
            currency: template.currency || prev.currency,
            notes: template.notes || prev.notes,
            issueDate: todayISO(),
            dueDate: due,
            lineItems: linesFromTemplate.length ? linesFromTemplate : prev.lineItems,
        }));
        setTemplateMessage({ type: 'success', message: 'Template loaded.' });
    };

    const deleteTemplate = async (id) => {
        try {
            await deleteDoc(doc(db, 'invoiceTemplates', id));
            setTemplateMessage({ type: 'success', message: 'Template deleted.' });
        } catch (error) {
            console.error('Failed to delete template', error);
            setTemplateMessage({ type: 'error', message: 'Unable to delete template.' });
        }
    };

    const recentInvoices = useMemo(() => {
        const sorted = [...invoices];
        sorted.sort((a, b) => {
            const aTime = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : new Date(a.createdAt || 0).getTime() / 1000;
            const bTime = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : new Date(b.createdAt || 0).getTime() / 1000;
            return bTime - aTime;
        });
        return sorted.slice(0, 5);
    }, [invoices]);

    if (loading) {
        return <Card>Loading billing data...</Card>;
    }

    if (!user?.orgId) {
        return <Card>Connect this console to an organisation to manage invoicing.</Card>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <form onSubmit={handleSaveMaster} className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-end gap-4">
                        <div className="md:flex-1">
                            <label className="text-xs uppercase text-red-300">Master Price Book Name</label>
                            <Input value={masterDraft.name} onChange={event => setMasterDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Master Price Book" />
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" className="w-auto" onClick={addMasterRow}>Add Item</Button>
                            <Button type="submit" className="w-auto">Save</Button>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {masterDraft.items.length === 0 && <p className="text-sm text-gray-500">Add catalogue entries to build the master price book.</p>}
                        {masterDraft.items.map(item => (
                            <div key={item.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-gray-900/60 border border-red-900 p-3">
                                <Input className="md:col-span-2" value={item.sku} onChange={event => updateMasterRow(item.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                <Input className="md:col-span-3" value={item.name} onChange={event => updateMasterRow(item.tempId, 'name', event.target.value)} placeholder="Item" />
                                <Input className="md:col-span-3" value={item.description} onChange={event => updateMasterRow(item.tempId, 'description', event.target.value)} placeholder="Description" />
                                <Input type="number" step="0.01" className="md:col-span-2" value={item.unitPrice} onChange={event => updateMasterRow(item.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                <Input type="number" step="0.01" className="md:col-span-1" value={item.taxRate} onChange={event => updateMasterRow(item.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                <Input type="number" className="md:col-span-1" value={item.defaultQuantity} onChange={event => updateMasterRow(item.tempId, 'defaultQuantity', event.target.value)} placeholder="Qty" />
                                <Button type="button" className="md:col-span-1 bg-gray-800" onClick={() => removeMasterRow(item.tempId)}>Remove</Button>
                            </div>
                        ))}
                    </div>
                    {masterMessage && <p className={masterMessage.type === 'success' ? 'text-green-400 text-sm' : 'text-yellow-300 text-sm'}>{masterMessage.message}</p>}
                </form>
            </Card>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="space-y-4">
                    <h3 className="text-lg text-red-400">Customers</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {customers.length === 0 && <p className="text-sm text-gray-500">No customers yet.</p>}
                        {customers.map(customer => (
                            <button
                                key={customer.id}
                                onClick={() => setSelectedCustomerId(customer.id)}
                                className={'w-full text-left border p-2 ' + (selectedCustomerId === customer.id ? 'border-red-500 bg-red-900/40' : 'border-red-900 bg-gray-900/40')}
                            >
                                <p className="font-semibold">{customer.name}</p>
                                {customer.email && <p className="text-xs text-gray-400">{customer.email}</p>}
                            </button>
                        ))}
                    </div>
                    <form onSubmit={handleCreateCustomer} className="space-y-2 border-t border-red-900 pt-3">
                        <Input name="customerName" placeholder="Customer name" required />
                        <Input name="customerEmail" type="email" placeholder="Email (optional)" />
                        <Input name="customerTerms" placeholder="Payment terms" defaultValue="Net 30" />
                        <TextArea name="customerAddress" rows={2} placeholder="Billing address" />
                        <Button type="submit">Add customer</Button>
                    </form>
                    {customerMessage && <p className={customerMessage.type === 'success' ? 'text-green-400 text-sm' : 'text-yellow-300 text-sm'}>{customerMessage.message}</p>}
                </Card>

                <Card className="lg:col-span-2 space-y-4">
                    <h3 className="text-lg text-red-400">Customer Price Book</h3>
                    {!selectedCustomer && <p className="text-sm text-gray-500">Select a customer to review their pricing.</p>}
                    {selectedCustomer && customerDraft && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2 items-center">
                                <span className="text-sm text-gray-400">{customerDraft.isCustom ? 'Custom price book' : 'Inheriting master price book'}</span>
                                {!customerDraft.isCustom && (
                                    <Button
                                        type="button"
                                        className="w-auto"
                                        onClick={() => setCustomerDraft({
                                            id: customerDraft.id || null,
                                            name: customerDraft.name || selectedCustomer.name + ' Price Book',
                                            items: (customerDraft.items && customerDraft.items.length ? customerDraft.items : (masterDraft.items || [])).map(toEditableItem),
                                            isCustom: true,
                                        })}
                                    >
                                        Create custom price book
                                    </Button>
                                )}
                                {customerDraft.isCustom && (
                                    <>
                                        <Button type="button" className="w-auto" onClick={handleSaveCustomerPricing}>Save</Button>
                                        <Button type="button" className="w-auto bg-gray-800" onClick={handleRevertToMaster}>Revert</Button>
                                        <Button type="button" className="w-auto" onClick={addCustomerRow}>Add item</Button>
                                    </>
                                )}
                            </div>
                            <div className="space-y-3">
                                <div className="hidden md:grid md:grid-cols-12 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                                    <span className="md:col-span-2">SKU</span>
                                    <span className="md:col-span-3">Item</span>
                                    <span className="md:col-span-3">Description</span>
                                    <span className="md:col-span-2">Unit price</span>
                                    <span className="md:col-span-1">Tax %</span>
                                    <span className="md:col-span-1">Qty</span>
                                    <span className="md:col-span-1">Actions</span>
                                </div>
                                {customerDraft.items.length === 0 && <p className="text-sm text-gray-500">No items in this price book.</p>}
                                {customerDraft.items.map(item => (
                                    <div key={item.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-gray-900/60 border border-red-900 p-3">
                                        <Input className="md:col-span-2" value={item.sku} onChange={event => updateCustomerRow(item.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                        <Input className="md:col-span-3" value={item.name} onChange={event => updateCustomerRow(item.tempId, 'name', event.target.value)} placeholder="Item" />
                                        <Input className="md:col-span-3" value={item.description} onChange={event => updateCustomerRow(item.tempId, 'description', event.target.value)} placeholder="Description" />
                                        <Input type="number" step="0.01" className="md:col-span-2" value={item.unitPrice} onChange={event => updateCustomerRow(item.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                        <Input type="number" step="0.01" className="md:col-span-1" value={item.taxRate} onChange={event => updateCustomerRow(item.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                        <Input type="number" className="md:col-span-1" value={item.defaultQuantity} onChange={event => updateCustomerRow(item.tempId, 'defaultQuantity', event.target.value)} placeholder="Qty" />
                                        <Button type="button" className="md:col-span-1 bg-gray-800" onClick={() => removeCustomerRow(item.tempId)}>Remove</Button>
                                    </div>
                                ))}
                            </div>
                            {customerMessage && <p className={customerMessage.type === 'success' ? 'text-green-400 text-sm' : 'text-yellow-300 text-sm'}>{customerMessage.message}</p>}
                        </div>
                    )}
                </Card>
            </div>

            <Card>
                <form onSubmit={handleInvoiceSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <Input className="md:col-span-2" value={invoiceDraft.reference} onChange={event => setInvoiceDraft(prev => ({ ...prev, reference: event.target.value }))} placeholder="Invoice reference" />
                        <Input
                            type="date"
                            className="md:col-span-1"
                            value={invoiceDraft.issueDate}
                            onChange={event => {
                                const nextIssueDate = event.target.value;
                                setInvoiceDraft(prev => {
                                    const fallbackDate = nextIssueDate || prev.issueDate || todayISO();
                                    const lineItems = prev.lineItems.map(line => {
                                        if (!line.lineDate || line.lineDate === prev.issueDate) {
                                            return {
                                                ...line,
                                                lineDate: fallbackDate,
                                                isoWeek: getISOWeek(fallbackDate),
                                            };
                                        }
                                        return line;
                                    });
                                    return { ...prev, issueDate: nextIssueDate, lineItems };
                                });
                            }}
                        />
                        <Input type="date" className="md:col-span-1" value={invoiceDraft.dueDate} onChange={event => setInvoiceDraft(prev => ({ ...prev, dueDate: event.target.value }))} />
                        <Select className="md:col-span-1" value={invoiceDraft.currency} onChange={event => setInvoiceDraft(prev => ({ ...prev, currency: event.target.value }))}>
                            {['GBP','USD','EUR','CAD','AUD'].map(code => (
                                <option key={code} value={code}>{code}</option>
                            ))}
                        </Select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" className="w-auto" onClick={addInvoiceLineRow}>Add line</Button>
                        <Button type="button" className="w-auto bg-gray-800" onClick={loadPriceBookIntoInvoice}>Load price book items</Button>
                    </div>
                    <div className="space-y-3">
                        <div className="hidden md:grid md:grid-cols-12 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                            <span className="md:col-span-1">SKU</span>
                            <span className="md:col-span-3">Description</span>
                            <span className="md:col-span-2">Line date</span>
                            <span className="md:col-span-1">ISO week</span>
                            <span className="md:col-span-2">Unit price</span>
                            <span className="md:col-span-1">Tax %</span>
                            <span className="md:col-span-1">Qty</span>
                            <span className="md:col-span-1 text-right">Total</span>
                        </div>
                        {invoiceDraft.lineItems.map(line => (
                            <div key={line.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-gray-900/60 border border-red-900 p-3">
                                <Input className="md:col-span-1" value={line.sku} onChange={event => updateInvoiceLine(line.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                <Input className="md:col-span-3" value={line.description} onChange={event => updateInvoiceLine(line.tempId, 'description', event.target.value)} placeholder="Description" />
                                <Input
                                    type="date"
                                    className="md:col-span-2"
                                    value={line.lineDate || invoiceDraft.issueDate || todayISO()}
                                    onChange={event => updateInvoiceLine(line.tempId, 'lineDate', event.target.value)}
                                />
                                <div className="md:col-span-1 flex items-center text-xs text-gray-400">
                                    {line.isoWeek || getISOWeek(line.lineDate || invoiceDraft.issueDate || todayISO()) || 'N/A'}
                                </div>
                                <Input type="number" step="0.01" className="md:col-span-2" value={line.unitPrice} onChange={event => updateInvoiceLine(line.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                <Input type="number" step="0.01" className="md:col-span-1" value={line.taxRate} onChange={event => updateInvoiceLine(line.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                <Input type="number" className="md:col-span-1" value={line.quantity} onChange={event => updateInvoiceLine(line.tempId, 'quantity', event.target.value)} placeholder="Qty" />
                                <div className="md:col-span-1 flex flex-col items-end gap-2">
                                    <span className="text-xs text-gray-400">{formatCurrency(line.quantity * line.unitPrice, invoiceDraft.currency)}</span>
                                    <Button type="button" className="w-auto bg-gray-800" onClick={() => removeInvoiceLine(line.tempId)}>Remove</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <TextArea rows={3} value={invoiceDraft.notes} onChange={event => setInvoiceDraft(prev => ({ ...prev, notes: event.target.value }))} placeholder="Notes or payment instructions" />
                    <div className="flex flex-wrap gap-4 items-center">
                        {(() => {
                            const totals = calculateTotals(invoiceDraft.lineItems);
                            return (
                                <div className="text-sm text-gray-300">
                                    <div>Net: {formatCurrency(totals.net, invoiceDraft.currency)}</div>
                                    <div>Tax: {formatCurrency(totals.tax, invoiceDraft.currency)}</div>
                                    <div className="font-semibold">Gross: {formatCurrency(totals.gross, invoiceDraft.currency)}</div>
                                </div>
                            );
                        })()}
                        <Button type="submit" className="w-auto">Save invoice</Button>
                    </div>
                    {invoiceMessage && <p className={invoiceMessage.type === 'success' ? 'text-green-400 text-sm' : 'text-yellow-300 text-sm'}>{invoiceMessage.message}</p>}
                </form>
            </Card>

            <Card className="space-y-4">
                <form onSubmit={handleSaveTemplate} className="flex flex-col md:flex-row md:items-end gap-3">
                    <Input className="md:w-1/3" value={templateMeta.name} onChange={event => setTemplateMeta(prev => ({ ...prev, name: event.target.value }))} placeholder="Template name" required />
                    <Select className="md:w-1/4" value={templateMeta.cadence} onChange={event => setTemplateMeta(prev => ({ ...prev, cadence: event.target.value }))}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                        <option value="custom">Custom</option>
                    </Select>
                    <Input className="md:w-1/4" type="number" value={templateMeta.dueInDays} onChange={event => setTemplateMeta(prev => ({ ...prev, dueInDays: event.target.value }))} placeholder="Due in days" />
                    <Button type="submit" className="w-auto">Save template</Button>
                </form>
                {templateMessage && <p className={templateMessage.type === 'success' ? 'text-green-400 text-sm' : 'text-yellow-300 text-sm'}>{templateMessage.message}</p>}
                <div className="space-y-2">
                    {invoiceTemplates.length === 0 && <p className="text-sm text-gray-500">No templates yet.</p>}
                    {invoiceTemplates.map(template => (
                        <div key={template.id} className="border border-red-900 bg-gray-900/60 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <p className="font-semibold">{template.name}</p>
                                <p className="text-xs text-gray-400">Cadence: {(template.cadence || 'custom') + (template.dueInDays ? ' - due in ' + template.dueInDays + ' days' : '')}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" className="w-auto" onClick={() => applyTemplate(template)}>Load</Button>
                                <Button type="button" className="w-auto bg-gray-800" onClick={() => deleteTemplate(template.id)}>Delete</Button>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            <Card className="space-y-3">
                <h3 className="text-lg text-red-400">Recent invoices</h3>
                {recentInvoices.length === 0 && <p className="text-sm text-gray-500">No invoices recorded yet.</p>}
                {recentInvoices.map(invoice => (
                    <div key={invoice.id} className="border border-red-900 bg-gray-900/60 p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div>
                            <p className="font-semibold">{invoice.reference || invoice.id}</p>
                            <p className="text-xs text-gray-400">{invoice.issueDate || ''}</p>
                        </div>
                        <div className="text-sm text-gray-300">{customers.find(c => c.id === invoice.customerId)?.name || 'Unknown customer'}</div>
                        <div className="text-sm text-gray-300">{formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP')}</div>
                        <div className="text-sm text-gray-300">{invoice.status || 'Draft'}</div>
                    </div>
                ))}
            </Card>
        </div>
    );
};

export default BillingConsole;









