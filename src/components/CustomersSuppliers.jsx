import React, { useEffect, useMemo, useState } from 'react';
import {
    addDoc,
    collection,
    doc,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import { db, useAuth } from '../App';
import { Card, Input, Button, Select, TextArea, Label } from './ui';

const CUSTOMER_STATUSES = ['Active', 'Inactive', 'Prospect', 'Lead'];
const SUPPLIER_STATUSES = ['Active', 'Inactive', 'Preferred', 'Blacklisted'];
const PAYMENT_TERMS = ['Net 30', 'Net 60', 'Net 90', 'Cash on Delivery'];
const CURRENCIES = ['GBP', 'EUR', 'USD'];

const statusColor = (status) => ({
    Active: 'bg-green-800 text-green-200',
    Inactive: 'bg-gray-700 text-gray-200',
    Prospect: 'bg-blue-800 text-blue-200',
    Lead: 'bg-purple-800 text-purple-200',
    Preferred: 'bg-emerald-800 text-emerald-200',
    Blacklisted: 'bg-red-900 text-red-200',
})[status] || 'bg-gray-700 text-gray-200';

export default function CustomersSuppliers({ initialTab = 'customers', lockTab = false }) {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState(initialTab === 'suppliers' ? 'suppliers' : 'customers');
    const [customers, setCustomers] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [showCustomerModal, setShowCustomerModal] = useState(false);
    const [showSupplierModal, setShowSupplierModal] = useState(false);
    const [viewingDetails, setViewingDetails] = useState(null);

    useEffect(() => {
        if (!user?.orgId) {
            setCustomers([]);
            setSuppliers([]);
            setLoading(false);
            return;
        }
        const unsubscribers = [];

        const customerQuery = query(collection(db, 'customers'), where('orgId', '==', user.orgId));
        unsubscribers.push(onSnapshot(customerQuery, (snap) => {
            setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }));

        const supplierQuery = query(collection(db, 'suppliers'), where('orgId', '==', user.orgId));
        unsubscribers.push(onSnapshot(supplierQuery, (snap) => {
            setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }));

        return () => unsubscribers.forEach((unsub) => unsub());
    }, [user?.orgId]);

    const filteredCustomers = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return customers.filter((c) => {
            if (filterStatus !== 'all' && c.status !== filterStatus) return false;
            if (!term) return true;
            return (
                c.name?.toLowerCase().includes(term) ||
                c.email?.toLowerCase().includes(term) ||
                c.companyNumber?.toLowerCase().includes(term)
            );
        });
    }, [customers, filterStatus, searchTerm]);

    const filteredSuppliers = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return suppliers.filter((s) => {
            if (filterStatus !== 'all' && s.status !== filterStatus) return false;
            if (!term) return true;
            return (
                s.name?.toLowerCase().includes(term) ||
                s.email?.toLowerCase().includes(term) ||
                s.category?.toLowerCase().includes(term)
            );
        });
    }, [suppliers, filterStatus, searchTerm]);

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <p className="text-red-400 text-xl">Loading CRM...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <Card className="bg-black bg-opacity-90">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-red-300">Customers &amp; Suppliers</h1>
                        <p className="text-gray-400 mt-2">CRM and contact management</p>
                    </div>
                    <Button
                        onClick={() => activeTab === 'customers' ? setShowCustomerModal(true) : setShowSupplierModal(true)}
                        className="w-full sm:w-auto px-6"
                    >
                        + Add {activeTab === 'customers' ? 'Customer' : 'Supplier'}
                    </Button>
                </div>
            </Card>

            <Card className="p-0 overflow-hidden">
                {!lockTab && (
                    <div className="flex flex-wrap border-b border-red-900">
                        <TabButton
                            active={activeTab === 'customers'}
                            onClick={() => {
                                setActiveTab('customers');
                                setSearchTerm('');
                                setFilterStatus('all');
                            }}
                        >
                            Customers ({customers.length})
                        </TabButton>
                        <TabButton
                            active={activeTab === 'suppliers'}
                            onClick={() => {
                                setActiveTab('suppliers');
                                setSearchTerm('');
                                setFilterStatus('all');
                            }}
                        >
                            Suppliers ({suppliers.length})
                        </TabButton>
                    </div>
                )}

                <div className="p-4 bg-gray-900 border-b border-red-900">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <Input
                                type="text"
                                placeholder={`Search ${activeTab}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div>
                            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                                <option value="all">All Statuses</option>
                                {activeTab === 'customers'
                                    ? CUSTOMER_STATUSES.map((status) => (
                                        <option key={status} value={status}>{status}</option>
                                    ))
                                    : SUPPLIER_STATUSES.map((status) => (
                                        <option key={status} value={status}>{status}</option>
                                    ))
                                }
                            </Select>
                        </div>
                    </div>
                </div>

                <div className="p-6">
            {activeTab === 'customers' ? (
                <CustomersList
                    customers={filteredCustomers}
                    onEdit={setEditingCustomer}
                    onView={(customer) => setViewingDetails({ ...customer, entityType: 'Customer' })}
                    onConvert={async (customer) => {
                        if (!customer?.id || !user?.email) return;
                        try {
                            await updateDoc(doc(db, 'customers', customer.id), {
                                status: 'Active',
                                customerSince: new Date().toISOString().split('T')[0],
                                updatedAt: serverTimestamp(),
                                lastModifiedBy: user.email,
                                lastModifiedFrom: 'CRM Console',
                            });
                        } catch (error) {
                            console.error('Failed to convert prospect', error);
                            alert('Unable to convert prospect to customer');
                        }
                    }}
                />
            ) : (
                <SuppliersList
                    suppliers={filteredSuppliers}
                    onEdit={setEditingSupplier}
                            onView={(supplier) => setViewingDetails({ ...supplier, entityType: 'Supplier' })}
                        />
                    )}
                </div>
            </Card>

            {(showCustomerModal || editingCustomer) && (
                <CustomerModal
                    customer={editingCustomer}
                    onClose={() => {
                        setShowCustomerModal(false);
                        setEditingCustomer(null);
                    }}
                    orgId={user?.orgId}
                    userEmail={user?.email || ''}
                />
            )}

            {(showSupplierModal || editingSupplier) && (
                <SupplierModal
                    supplier={editingSupplier}
                    onClose={() => {
                        setShowSupplierModal(false);
                        setEditingSupplier(null);
                    }}
                    orgId={user?.orgId}
                    userEmail={user?.email || ''}
                />
            )}

            {viewingDetails && (
                <EntityDetailsModal
                    entity={viewingDetails}
                    onClose={() => setViewingDetails(null)}
                    onEdit={() => {
                        if (viewingDetails.entityType === 'Customer') {
                            setEditingCustomer(viewingDetails);
                        } else {
                            setEditingSupplier(viewingDetails);
                        }
                        setViewingDetails(null);
                    }}
                />
            )}
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

function StatusBadge({ status }) {
    return (
        <span className={`px-2 py-1 text-xs rounded ${statusColor(status)}`}>
            {status || 'Unknown'}
        </span>
    );
}

function CustomersList({ customers, onEdit, onView, onConvert }) {
    if (!customers.length) {
        return (
            <Card>
                <p className="text-center text-gray-400 py-6">No customers found.</p>
            </Card>
        );
    }
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customers.map((customer) => (
                <CustomerCard
                    key={customer.id}
                    customer={customer}
                    onEdit={() => onEdit(customer)}
                    onView={() => onView(customer)}
                    onConvert={onConvert}
                />
            ))}
        </div>
    );
}

function CustomerCard({ customer, onEdit, onView, onConvert }) {
    return (
        <Card className="hover:border-red-500 cursor-pointer transition-colors" onClick={onView}>
            <div className="space-y-3">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-lg font-bold text-red-400">{customer.name || 'Customer'}</h3>
                        <p className="text-sm text-gray-400">{customer.email || 'No email'}</p>
                    </div>
                    <StatusBadge status={customer.status} />
                </div>
                {customer.phone && <p className="text-sm text-gray-400">Phone: {customer.phone}</p>}
                {customer.industry && <p className="text-sm text-gray-400">Industry: {customer.industry}</p>}
                {customer.accountManagerName && (
                    <p className="text-xs text-gray-500">Account mgr: {customer.accountManagerName}</p>
                )}
                <div className="flex gap-2 pt-2">
                    {(customer.status === 'Prospect' || customer.status === 'Lead') && (
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                onConvert && onConvert(customer);
                            }}
                            className="w-auto flex-1 py-1 text-sm bg-green-800 hover:bg-green-700"
                        >
                            Convert to Customer
                        </Button>
                    )}
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className="w-auto flex-1 py-1 text-sm bg-gray-700 hover:bg-gray-600"
                    >
                        Edit
                    </Button>
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            onView();
                        }}
                        className="w-auto flex-1 py-1 text-sm"
                    >
                        Details
                    </Button>
                </div>
            </div>
        </Card>
    );
}

function SuppliersList({ suppliers, onEdit, onView }) {
    if (!suppliers.length) {
        return (
            <Card>
                <p className="text-center text-gray-400 py-6">No suppliers found.</p>
            </Card>
        );
    }
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map((supplier) => (
                <SupplierCard
                    key={supplier.id}
                    supplier={supplier}
                    onEdit={() => onEdit(supplier)}
                    onView={() => onView(supplier)}
                />
            ))}
        </div>
    );
}

function SupplierCard({ supplier, onEdit, onView }) {
    return (
        <Card className="hover:border-red-500 cursor-pointer transition-colors" onClick={onView}>
            <div className="space-y-3">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-lg font-bold text-red-400">{supplier.name || 'Supplier'}</h3>
                        <p className="text-sm text-gray-400">{supplier.email || 'No email'}</p>
                    </div>
                    <StatusBadge status={supplier.status} />
                </div>
                {supplier.phone && <p className="text-sm text-gray-400">Phone: {supplier.phone}</p>}
                {supplier.category && <p className="text-sm text-gray-400">Category: {supplier.category}</p>}
                {supplier.rating ? (
                    <p className="text-xs text-gray-500">Rating: {supplier.rating}/5</p>
                ) : null}
                <div className="flex gap-2 pt-2">
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className="w-auto flex-1 py-1 text-sm bg-gray-700 hover:bg-gray-600"
                    >
                        Edit
                    </Button>
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            onView();
                        }}
                        className="w-auto flex-1 py-1 text-sm"
                    >
                        Details
                    </Button>
                </div>
            </div>
        </Card>
    );
}

function CustomerModal({ customer, onClose, orgId, userEmail }) {
    const isEdit = Boolean(customer?.id);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState([]);
    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        ledgerCustomerId: '',
        ledgerControlAccountId: '',
        companyNumber: '',
        vatNumber: '',
        currency: 'GBP',
        paymentTerms: 'Net 30',
        paymentTermsDays: 30,
        status: 'Active',
        industry: '',
        accountManagerName: '',
        notes: '',
    });

    useEffect(() => {
        if (customer) {
            setForm({
                name: customer.name || '',
                email: customer.email || '',
                phone: customer.phone || '',
                ledgerCustomerId: customer.ledgerCustomerId || '',
                ledgerControlAccountId: customer.ledgerControlAccountId || '',
                companyNumber: customer.companyNumber || '',
                vatNumber: customer.vatNumber || '',
                currency: customer.currency || 'GBP',
                paymentTerms: customer.paymentTerms || 'Net 30',
                paymentTermsDays: customer.paymentTermsDays || 30,
                status: customer.status || 'Active',
                industry: customer.industry || '',
                accountManagerName: customer.accountManagerName || '',
                notes: customer.notes || '',
            });
        }
    }, [customer]);

    const validate = () => {
        const errs = [];
        if (!form.name.trim()) errs.push('Name is required');
        if (!form.email.trim()) errs.push('Email is required');
        if (form.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(form.email)) errs.push('Invalid email format');
        setErrors(errs);
        return errs.length === 0;
    };

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        if (!orgId) {
            setErrors(['Organization missing.']);
            return;
        }
        if (!validate()) return;
        setSaving(true);
        try {
            const payload = {
                ...form,
                orgId,
                ledgerCustomerId: form.ledgerCustomerId?.trim() || '',
                ledgerControlAccountId: form.ledgerControlAccountId?.trim() || '',
                paymentTermsDays: Number(form.paymentTermsDays) || 0,
                updatedAt: serverTimestamp(),
                lastModifiedBy: userEmail || '',
                lastModifiedFrom: 'CRM Console',
            };
            if (isEdit) {
                await updateDoc(doc(db, 'customers', customer.id), payload);
            } else {
                await addDoc(collection(db, 'customers'), {
                    ...payload,
                    createdAt: serverTimestamp(),
                    createdBy: userEmail || '',
                });
            }
            onClose();
        } catch (error) {
            setErrors([error.message || 'Unable to save customer']);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell title={isEdit ? 'Edit Customer' : 'Add Customer'} onClose={onClose}>
            {errors.length > 0 && (
                <Card className="bg-red-900/30 border-red-700 text-red-200 text-sm">
                    <ul className="list-disc list-inside space-y-1">
                        {errors.map((err) => <li key={err}>{err}</li>)}
                    </ul>
                </Card>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name">
                    <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
                </Field>
                <Field label="Email">
                    <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
                </Field>
                <Field label="Phone">
                    <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
                </Field>
                <Field label="Industry">
                    <Input value={form.industry} onChange={(e) => setField('industry', e.target.value)} />
                </Field>
                <Field label="Company Number">
                    <Input value={form.companyNumber} onChange={(e) => setField('companyNumber', e.target.value)} />
                </Field>
                <Field label="VAT Number">
                    <Input value={form.vatNumber} onChange={(e) => setField('vatNumber', e.target.value)} />
                </Field>
                <Field label="Ledger Customer ID">
                    <Input value={form.ledgerCustomerId} onChange={(e) => setField('ledgerCustomerId', e.target.value)} />
                </Field>
                <Field label="Ledger Control Account ID">
                    <Input value={form.ledgerControlAccountId} onChange={(e) => setField('ledgerControlAccountId', e.target.value)} />
                </Field>
                <Field label="Currency">
                    <Select value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                </Field>
                <Field label="Payment Terms">
                    <Select value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)}>
                        {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                </Field>
                <Field label="Payment Terms (days)">
                    <Input
                        type="number"
                        value={form.paymentTermsDays}
                        onChange={(e) => setField('paymentTermsDays', e.target.value)}
                    />
                </Field>
                <Field label="Status">
                    <Select value={form.status} onChange={(e) => setField('status', e.target.value)}>
                        {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                </Field>
                <Field label="Account Manager">
                    <Input
                        value={form.accountManagerName}
                        onChange={(e) => setField('accountManagerName', e.target.value)}
                    />
                </Field>
                <Field label="Notes" full>
                    <TextArea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
                </Field>
            </div>
            <ModalActions onClose={onClose} onSave={handleSave} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Customer'} />
        </ModalShell>
    );
}

function SupplierModal({ supplier, onClose, orgId, userEmail }) {
    const isEdit = Boolean(supplier?.id);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState([]);
    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        ledgerSupplierId: '',
        ledgerControlAccountId: '',
        defaultExpenseAccount: '',
        category: '',
        supplierType: 'Products',
        companyNumber: '',
        vatNumber: '',
        currency: 'GBP',
        paymentTerms: 'Net 30',
        paymentTermsDays: 30,
        status: 'Active',
        rating: '',
        notes: '',
    });

    useEffect(() => {
        if (supplier) {
            setForm({
                name: supplier.name || '',
                email: supplier.email || '',
                phone: supplier.phone || '',
                ledgerSupplierId: supplier.ledgerSupplierId || '',
                ledgerControlAccountId: supplier.ledgerControlAccountId || '',
                defaultExpenseAccount: supplier.defaultExpenseAccount || '',
                category: supplier.category || '',
                supplierType: supplier.supplierType || 'Products',
                companyNumber: supplier.companyNumber || '',
                vatNumber: supplier.vatNumber || '',
                currency: supplier.currency || 'GBP',
                paymentTerms: supplier.paymentTerms || 'Net 30',
                paymentTermsDays: supplier.paymentTermsDays || 30,
                status: supplier.status || 'Active',
                rating: supplier.rating || '',
                notes: supplier.notes || '',
            });
        }
    }, [supplier]);

    const validate = () => {
        const errs = [];
        if (!form.name.trim()) errs.push('Name is required');
        if (!form.email.trim()) errs.push('Email is required');
        if (form.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(form.email)) errs.push('Invalid email format');
        setErrors(errs);
        return errs.length === 0;
    };

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        if (!orgId) {
            setErrors(['Organization missing.']);
            return;
        }
        if (!validate()) return;
        setSaving(true);
        try {
            const payload = {
                ...form,
                orgId,
                ledgerSupplierId: form.ledgerSupplierId?.trim() || '',
                ledgerControlAccountId: form.ledgerControlAccountId?.trim() || '',
                defaultExpenseAccount: form.defaultExpenseAccount?.trim() || '',
                paymentTermsDays: Number(form.paymentTermsDays) || 0,
                rating: form.rating === '' ? null : Number(form.rating),
                updatedAt: serverTimestamp(),
                lastModifiedBy: userEmail || '',
                lastModifiedFrom: 'CRM Console',
            };
            if (isEdit) {
                await updateDoc(doc(db, 'suppliers', supplier.id), payload);
            } else {
                await addDoc(collection(db, 'suppliers'), {
                    ...payload,
                    createdAt: serverTimestamp(),
                    createdBy: userEmail || '',
                });
            }
            onClose();
        } catch (error) {
            setErrors([error.message || 'Unable to save supplier']);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell title={isEdit ? 'Edit Supplier' : 'Add Supplier'} onClose={onClose}>
            {errors.length > 0 && (
                <Card className="bg-red-900/30 border-red-700 text-red-200 text-sm">
                    <ul className="list-disc list-inside space-y-1">
                        {errors.map((err) => <li key={err}>{err}</li>)}
                    </ul>
                </Card>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name">
                    <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
                </Field>
                <Field label="Email">
                    <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
                </Field>
                <Field label="Phone">
                    <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
                </Field>
                <Field label="Category">
                    <Input value={form.category} onChange={(e) => setField('category', e.target.value)} />
                </Field>
                <Field label="Supplier Type">
                    <Select value={form.supplierType} onChange={(e) => setField('supplierType', e.target.value)}>
                        <option value="Products">Products</option>
                        <option value="Services">Services</option>
                        <option value="Both">Both</option>
                    </Select>
                </Field>
                <Field label="Company Number">
                    <Input value={form.companyNumber} onChange={(e) => setField('companyNumber', e.target.value)} />
                </Field>
                <Field label="VAT Number">
                    <Input value={form.vatNumber} onChange={(e) => setField('vatNumber', e.target.value)} />
                </Field>
                <Field label="Ledger Supplier ID">
                    <Input value={form.ledgerSupplierId} onChange={(e) => setField('ledgerSupplierId', e.target.value)} />
                </Field>
                <Field label="Ledger Control Account ID">
                    <Input value={form.ledgerControlAccountId} onChange={(e) => setField('ledgerControlAccountId', e.target.value)} />
                </Field>
                <Field label="Default Expense Account">
                    <Input value={form.defaultExpenseAccount} onChange={(e) => setField('defaultExpenseAccount', e.target.value)} />
                </Field>
                <Field label="Currency">
                    <Select value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                </Field>
                <Field label="Payment Terms">
                    <Select value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)}>
                        {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                </Field>
                <Field label="Payment Terms (days)">
                    <Input
                        type="number"
                        value={form.paymentTermsDays}
                        onChange={(e) => setField('paymentTermsDays', e.target.value)}
                    />
                </Field>
                <Field label="Status">
                    <Select value={form.status} onChange={(e) => setField('status', e.target.value)}>
                        {SUPPLIER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                </Field>
                <Field label="Rating (1-5)">
                    <Input
                        type="number"
                        min="1"
                        max="5"
                        value={form.rating}
                        onChange={(e) => setField('rating', e.target.value)}
                    />
                </Field>
                <Field label="Notes" full>
                    <TextArea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
                </Field>
            </div>
            <ModalActions onClose={onClose} onSave={handleSave} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Supplier'} />
        </ModalShell>
    );
}

function EntityDetailsModal({ entity, onClose, onEdit }) {
    if (!entity) return null;
    const entries = Object.entries(entity).filter(([key]) => !['id', 'orgId', 'entityType', 'createdAt', 'updatedAt', 'lastModifiedBy', 'lastModifiedFrom', 'createdBy'].includes(key));
    return (
        <ModalShell title={entity.name || entity.entityType} onClose={onClose} onEdit={onEdit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-200">
                {entries.map(([key, value]) => (
                    <div key={key} className="border border-red-900 bg-gray-900/60 p-3 rounded">
                        <p className="text-xs uppercase text-gray-500">{key}</p>
                        <p className="text-gray-100 whitespace-pre-line">{String(value ?? '')}</p>
                    </div>
                ))}
            </div>
        </ModalShell>
    );
}

function Field({ label, children, full = false }) {
    return (
        <div className={full ? 'md:col-span-2' : ''}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

function ModalShell({ title, children, onClose, onEdit }) {
    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <Card className="max-w-4xl w-full space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-red-300">{title}</h3>
                    <div className="flex gap-2">
                        {onEdit && (
                            <Button className="w-auto bg-gray-700 hover:bg-gray-600" onClick={onEdit}>
                                Edit
                            </Button>
                        )}
                        <button onClick={onClose} className="text-gray-400 hover:text-red-300">Close</button>
                    </div>
                </div>
                {children}
            </Card>
        </div>
    );
}

function ModalActions({ onClose, onSave, saving, saveLabel }) {
    return (
        <div className="flex gap-3 justify-end pt-2">
            <Button className="w-auto bg-gray-700 hover:bg-gray-600" onClick={onClose}>
                Cancel
            </Button>
            <Button className="w-auto px-6" onClick={onSave} disabled={saving}>
                {saving ? 'Saving...' : saveLabel}
            </Button>
        </div>
    );
}
