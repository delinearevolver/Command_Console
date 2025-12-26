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
    id: item.id || null,
    sku: item.sku || '',
    name: item.name || '',
    description: item.description || '',
    optionCode: item.optionCode || '',
    catalogueItemId: item.catalogueItemId || item.catalogueId || '',
    unitPrice: asNumber(item.unitPrice),
    taxRate: asNumber(item.taxRate),
    defaultQuantity: asNumber(item.defaultQuantity, 1) || 1,
});

const toInvoiceLine = (item = {}, invoiceDate = todayISO()) => ({
    tempId: randomId(),
    id: item.id || null,
    sku: item.sku || '',
    description: item.description || item.name || '',
    optionCode: item.optionCode || '',
    catalogueItemId: item.catalogueItemId || item.catalogueId || '',
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

const toCatalogueEditable = (item = {}) => ({
    tempId: item.tempId || item.id || item.sku || randomId(),
    id: item.id || null,
    sku: item.sku || '',
    name: item.name || '',
    description: item.description || '',
    optionsText: Array.isArray(item.options) ? item.options.join('\n') : (item.optionsText || ''),
    unitPrice: asNumber(item.unitPrice),
    taxRate: asNumber(item.taxRate),
    defaultQuantity: asNumber(item.defaultQuantity, 1) || 1,
});

const formatCatalogueSignature = (items = []) => {
    const simplified = items.map(item => ({
        id: item.id || '',
        sku: item.sku || '',
        name: item.name || '',
        description: item.description || '',
        options: Array.isArray(item.options) ? item.options : [],
        unitPrice: Number.parseFloat(item.unitPrice) || 0,
        taxRate: Number.parseFloat(item.taxRate) || 0,
        defaultQuantity: Number.parseFloat(item.defaultQuantity) || 1,
    }));
    return JSON.stringify(simplified);
};


const sanitizePriceItems = (items = []) => items.map(({ tempId, ...rest }) => ({
    catalogueItemId: (rest.catalogueItemId || '').trim() || null,
    sku: (rest.sku || '').trim(),
    name: (rest.name || '').trim(),
    description: (rest.description || '').trim(),
    optionCode: (rest.optionCode || '').trim(),
    unitPrice: Number.parseFloat(rest.unitPrice) || 0,
    taxRate: Number.parseFloat(rest.taxRate) || 0,
    defaultQuantity: Number.parseFloat(rest.defaultQuantity) || 1,
}));

const formatPriceBookSignature = (book) => {
    if (!book) return '';
    const items = Array.isArray(book.items) ? book.items : [];
    const simplified = items.map(item => ({
        catalogueItemId: item.catalogueItemId || '',
        sku: item.sku || '',
        name: item.name || '',
        description: item.description || '',
        optionCode: item.optionCode || '',
        unitPrice: Number.parseFloat(item.unitPrice) || 0,
        taxRate: Number.parseFloat(item.taxRate) || 0,
        defaultQuantity: Number.parseFloat(item.defaultQuantity) || 1,
    }));
    return JSON.stringify({ id: book.id || '', name: book.name || '', items: simplified });
};

const sanitizeInvoiceLines = (items = [], invoiceDate = todayISO()) => items.map(({ tempId, ...rest }) => {
    const lineDate = rest.lineDate || invoiceDate;
    const quantity = Number.parseFloat(rest.quantity);
    const unitPrice = Number.parseFloat(rest.unitPrice);
    const taxRate = Number.parseFloat(rest.taxRate);
    return {
        catalogueItemId: (rest.catalogueItemId || '').trim() || null,
        sku: (rest.sku || '').trim(),
        description: (rest.description || '').trim(),
        optionCode: (rest.optionCode || '').trim(),
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

const isValidDateParts = (year, month, day) => {
    const yyyy = Number(year);
    const mm = Number(month);
    const dd = Number(day);
    if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;
    const verifier = new Date(`${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
    return verifier.getFullYear() === yyyy && verifier.getMonth() + 1 === mm && verifier.getDate() === dd;
};

const normalizeDateInput = (rawValue = '') => {
    const trimmed = (rawValue || '').trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parts = trimmed.split(/[\/\-.]/).map(part => part.trim()).filter(Boolean);
    if (parts.length !== 3) return null;

    let year;
    let month;
    let day;

    if (parts[0].length === 4) {
        [year, month, day] = parts;
    } else if (parts[2].length === 4) {
        year = parts[2];
        const first = Number(parts[0]);
        const second = Number(parts[1]);
        if (first > 12 && second <= 12) {
            day = parts[0];
            month = parts[1];
        } else {
            month = parts[0];
            day = parts[1];
        }
    } else {
        return null;
    }

    if (!isValidDateParts(year, month, day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const getISOWeek = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const dayOfWeek = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dayOfWeek + 3);
    const firstThursday = new Date(date.getFullYear(), 0, 4);
    const weekNumber = Math.ceil(((date - firstThursday) / 86400000 + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

const defaultAccountingFilters = () => ({
    startDate: '',
    endDate: '',
    account: 'all',
    type: 'all',
    customerId: 'all',
    currency: 'all',
    search: '',
    document: 'all',
});

const BillingConsole = () => {
    const { user } = useAuth();
    const { customers = [], priceBooks = [], invoices = [], invoiceTemplates = [], catalogueItems = [], loading } = useData();
    const [activeView, setActiveView] = useState('invoices');
    const [catalogueDraft, setCatalogueDraft] = useState([]);
    const [catalogueRemovedIds, setCatalogueRemovedIds] = useState([]);
    const [catalogueHasUnsavedChanges, setCatalogueHasUnsavedChanges] = useState(false);
    const catalogueSnapshotRef = useRef('');
    const [catalogueMessage, setCatalogueMessage] = useState(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [masterDraft, setMasterDraft] = useState({ name: 'Master Price Book', items: [] });
    const [customerDraft, setCustomerDraft] = useState(null);
    const [masterHasUnsavedChanges, setMasterHasUnsavedChanges] = useState(false);
    const [customerHasUnsavedChanges, setCustomerHasUnsavedChanges] = useState(false);
    const masterSnapshotRef = useRef('');
    const customerSnapshotRef = useRef('');
    const [invoiceDraft, setInvoiceDraft] = useState({
        reference: '',
        kind: 'invoice',
        issueDate: todayISO(),
        dueDate: '',
        currency: 'GBP',
        notes: '',
        lineItems: [blankInvoiceLine(todayISO())]
    });
    const [invoiceLinesTouched, setInvoiceLinesTouched] = useState(false);
    const [invoiceDateInput, setInvoiceDateInput] = useState(todayISO());
    const [invoiceDateError, setInvoiceDateError] = useState('');
    const [templateMeta, setTemplateMeta] = useState({ name: '', cadence: 'monthly', dueInDays: '30' });
    const [masterMessage, setMasterMessage] = useState(null);
    const [customerMessage, setCustomerMessage] = useState(null);
    const [invoiceMessage, setInvoiceMessage] = useState(null);
    const [templateMessage, setTemplateMessage] = useState(null);
    const [accountingFilters, setAccountingFilters] = useState(() => defaultAccountingFilters());
    const lastCustomerRef = useRef('');

const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId) || null, [customers, selectedCustomerId]);
    const masterPriceBook = useMemo(() => priceBooks.find(pb => pb.isMaster) || null, [priceBooks]);
    const assignedPriceBook = useMemo(() => {
        if (!selectedCustomer) return null;
        return priceBooks.find(pb => pb.id === selectedCustomer.priceBookId) || null;
    }, [priceBooks, selectedCustomer]);
    const activePriceBook = assignedPriceBook || masterPriceBook;
    const activePriceBookBySku = useMemo(() => {
        const map = new Map();
        ((activePriceBook?.items) || []).forEach(item => {
            if (!item) return;
            const key = String(item.sku || '').trim().toUpperCase();
            if (key) map.set(key, item);
        });
        return map;
    }, [activePriceBook]);
    const catalogueBySku = useMemo(() => {
        const map = new Map();
        (catalogueItems || []).forEach(item => {
            if (!item) return;
            const key = String(item.sku || '').trim().toUpperCase();
            if (key) map.set(key, item);
        });
        return map;
    }, [catalogueItems]);
    const catalogueById = useMemo(() => {
        const map = new Map();
        (catalogueItems || []).forEach(item => {
            if (!item?.id) return;
            map.set(item.id, item);
        });
        return map;
    }, [catalogueItems]);
    const matchCatalogueBySku = (sku = '') => {
        const normalized = String(sku || '').trim().toUpperCase();
        if (!normalized) return null;
        return catalogueBySku.get(normalized) || null;
    };
    const catalogueOptionsFor = (catalogueItemId, fallbackSku) => {
        if (catalogueItemId && catalogueById.has(catalogueItemId)) {
            const found = catalogueById.get(catalogueItemId);
            return Array.isArray(found?.options) ? found.options : [];
        }
        const fromSku = matchCatalogueBySku(fallbackSku);
        if (fromSku) {
            return Array.isArray(fromSku.options) ? fromSku.options : [];
        }
        return [];
    };
    const updateAccountingFilter = (key, value) => {
        setAccountingFilters(prev => ({ ...prev, [key]: value }));
    };
    const resetAccountingFilters = () => {
        setAccountingFilters(defaultAccountingFilters());
    };

    const addCatalogueRow = () => {
        setCatalogueHasUnsavedChanges(true);
        setCatalogueDraft(prev => [...prev, toCatalogueEditable()]);
    };
    const updateCatalogueRow = (id, field, value) => {
        setCatalogueHasUnsavedChanges(true);
        setCatalogueDraft(prev => prev.map(item => {
            if (item.tempId !== id) return item;
            const next = { ...item, [field]: value };
            if (field === 'sku') {
                next.sku = String(value || '').trim().toUpperCase();
            }
            if (field === 'unitPrice' || field === 'taxRate' || field === 'defaultQuantity') {
                next[field] = value;
            }
            return next;
        }));
    };
    const removeCatalogueRow = (id) => {
        setCatalogueHasUnsavedChanges(true);
        setCatalogueDraft(prev => {
            const target = prev.find(item => item.tempId === id);
            if (target?.id) {
                setCatalogueRemovedIds(current => Array.from(new Set([...current, target.id])));
            }
            return prev.filter(item => item.tempId !== id);
        });
    };
    const handleSaveCatalogue = async (event) => {
        event?.preventDefault?.();
        if (!user?.orgId) return;
        const sanitized = [];
        const seenSkus = new Set();
        for (const row of catalogueDraft) {
            const sku = String(row.sku || '').trim().toUpperCase();
            if (!sku) {
                setCatalogueMessage({ type: 'error', message: 'Each catalogue item needs a SKU.' });
                return;
            }
            if (seenSkus.has(sku)) {
                setCatalogueMessage({ type: 'error', message: `Duplicate SKU detected: ${sku}.` });
                return;
            }
            seenSkus.add(sku);
            const options = String(row.optionsText || '')
                .split(/\r?\n|,/)
                .map(option => option.trim())
                .filter(Boolean);
            sanitized.push({
                id: row.id || null,
                sku,
                name: (row.name || '').trim(),
                description: (row.description || '').trim(),
                options,
                unitPrice: Number.parseFloat(row.unitPrice) || 0,
                taxRate: Number.parseFloat(row.taxRate) || 0,
                defaultQuantity: Number.parseFloat(row.defaultQuantity) || 1,
            });
        }
        if (!sanitized.length && catalogueRemovedIds.length === 0) {
            setCatalogueMessage({ type: 'error', message: 'Add catalogue rows before saving.' });
            return;
        }
        try {
            setCatalogueMessage(null);
            const operations = [];
            sanitized.forEach(row => {
                const payload = {
                    orgId: user.orgId,
                    sku: row.sku,
                    name: row.name,
                    description: row.description,
                    options: row.options,
                    unitPrice: row.unitPrice,
                    taxRate: row.taxRate,
                    defaultQuantity: row.defaultQuantity,
                    updatedAt: serverTimestamp(),
                };
                if (row.id) {
                    operations.push(updateDoc(doc(db, 'catalogueItems', row.id), payload));
                } else {
                    operations.push(addDoc(collection(db, 'catalogueItems'), { ...payload, createdAt: serverTimestamp() }));
                }
            });
            catalogueRemovedIds.forEach(itemId => {
                operations.push(deleteDoc(doc(db, 'catalogueItems', itemId)));
            });
            if (operations.length) {
                await Promise.all(operations);
            }
            setCatalogueMessage({ type: 'success', message: 'Product catalogue saved.' });
            setCatalogueHasUnsavedChanges(false);
            setCatalogueRemovedIds([]);
            catalogueSnapshotRef.current = formatCatalogueSignature(sanitized);
        } catch (error) {
            console.error('Failed to save catalogue', error);
            setCatalogueMessage({ type: 'error', message: 'Unable to save product catalogue.' });
        }
    };

    const addMasterRow = () => setMasterDraft(prev => {
        setMasterHasUnsavedChanges(true);
        return { ...prev, items: [...prev.items, toEditableItem()] };
    });
    const updateMasterRow = (id, field, value) => setMasterDraft(prev => {
        setMasterHasUnsavedChanges(true);
        return {
            ...prev,
            items: prev.items.map(item => {
                if (item.tempId !== id) return item;
                const next = { ...item, [field]: value };
                if (field === 'sku') {
                    const match = matchCatalogueBySku(value);
                    if (match) {
                        next.catalogueItemId = match.id || '';
                        next.sku = match.sku || value;
                        next.name = match.name || '';
                        next.description = match.description || '';
                        next.unitPrice = asNumber(match.unitPrice);
                        next.taxRate = asNumber(match.taxRate);
                        next.defaultQuantity = asNumber(match.defaultQuantity, 1) || 1;
                        const options = Array.isArray(match.options) ? match.options : [];
                        if (options.length) {
                            next.optionCode = options.includes(next.optionCode) ? next.optionCode : options[0];
                        } else {
                            next.optionCode = '';
                        }
                    } else {
                        next.catalogueItemId = '';
                        next.optionCode = '';
                    }
                    next.sku = String(next.sku || value).trim().toUpperCase();
                }
                if (field === 'catalogueItemId') {
                    const catalogued = catalogueById.get(value);
                    if (catalogued) {
                        next.catalogueItemId = catalogued.id;
                        next.sku = String(catalogued.sku || '').trim().toUpperCase();
                        next.name = catalogued.name || '';
                        next.description = catalogued.description || '';
                        next.unitPrice = asNumber(catalogued.unitPrice);
                        next.taxRate = asNumber(catalogued.taxRate);
                        next.defaultQuantity = asNumber(catalogued.defaultQuantity, 1) || 1;
                        const options = Array.isArray(catalogued.options) ? catalogued.options : [];
                        next.optionCode = options.length ? options[0] : '';
                    }
                }
                if (field === 'optionCode') {
                    const options = catalogueOptionsFor(next.catalogueItemId, next.sku);
                    if (next.optionCode && !options.includes(next.optionCode)) {
                        next.optionCode = '';
                    }
                    if (value && options.includes(value)) {
                        next.optionCode = value;
                    }
                }
                return next;
            }),
        };
    });
    const removeMasterRow = (id) => setMasterDraft(prev => {
        setMasterHasUnsavedChanges(true);
        return { ...prev, items: prev.items.filter(item => item.tempId !== id) };
    });

    const addCustomerRow = () => setCustomerDraft(prev => {
        if (!prev) return prev;
        const baseItems = Array.isArray(prev.items) ? prev.items : [];
        const fallbackName = prev.isCustom ? prev.name : `${selectedCustomer?.name || 'Customer'} Price Book`;
        const next = {
            ...prev,
            id: prev.isCustom ? prev.id : null,
            isCustom: true,
            name: fallbackName,
            items: [...baseItems, toEditableItem()],
        };
        setCustomerHasUnsavedChanges(true);
        return next;
    });
    const updateCustomerRow = (id, field, value) => setCustomerDraft(prev => {
        if (!prev || !prev.isCustom) return prev;
        setCustomerHasUnsavedChanges(true);
        return {
            ...prev,
            items: prev.items.map(item => {
                if (item.tempId !== id) return item;
                const next = { ...item, [field]: value };
                if (field === 'sku') {
                    const match = matchCatalogueBySku(value);
                    if (match) {
                        next.catalogueItemId = match.id || '';
                        next.sku = match.sku || value;
                        next.name = match.name || '';
                        next.description = match.description || '';
                        next.unitPrice = asNumber(match.unitPrice);
                        next.taxRate = asNumber(match.taxRate);
                        next.defaultQuantity = asNumber(match.defaultQuantity, 1) || 1;
                        const options = Array.isArray(match.options) ? match.options : [];
                        if (options.length) {
                            next.optionCode = options.includes(next.optionCode) ? next.optionCode : options[0];
                        } else {
                            next.optionCode = '';
                        }
                    } else {
                        next.catalogueItemId = '';
                        next.optionCode = '';
                    }
                    next.sku = String(next.sku || value).trim().toUpperCase();
                }
                if (field === 'catalogueItemId') {
                    const catalogued = catalogueById.get(value);
                    if (catalogued) {
                        next.catalogueItemId = catalogued.id;
                        next.sku = String(catalogued.sku || '').trim().toUpperCase();
                        next.name = catalogued.name || '';
                        next.description = catalogued.description || '';
                        next.unitPrice = asNumber(catalogued.unitPrice);
                        next.taxRate = asNumber(catalogued.taxRate);
                        next.defaultQuantity = asNumber(catalogued.defaultQuantity, 1) || 1;
                        const options = Array.isArray(catalogued.options) ? catalogued.options : [];
                        next.optionCode = options.length ? options[0] : '';
                    }
                }
                if (field === 'optionCode') {
                    const options = catalogueOptionsFor(next.catalogueItemId, next.sku);
                    if (next.optionCode && !options.includes(next.optionCode)) {
                        next.optionCode = '';
                    }
                    if (value && options.includes(value)) {
                        next.optionCode = value;
                    }
                }
                return next;
            }),
        };
    });
    const removeCustomerRow = (id) => setCustomerDraft(prev => {
        if (!prev || !prev.isCustom) return prev;
        setCustomerHasUnsavedChanges(true);
        return { ...prev, items: prev.items.filter(item => item.tempId !== id) };
    });

    const addInvoiceLineRow = () => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return { ...prev, lineItems: [...prev.lineItems, blankInvoiceLine(prev.issueDate || todayISO())] };
    });
    const updateInvoiceLine = (id, field, value) => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return {
            ...prev,
            lineItems: prev.lineItems.map(line => {
                if (line.tempId !== id) return line;
                const updated = { ...line, [field]: value };
                if (field === 'sku') {
                    const matchFromPriceBook = activePriceBookBySku.get(String(value || '').trim().toUpperCase());
                    const matchFromCatalogue = matchCatalogueBySku(value);
                    if (matchFromPriceBook) {
                        updated.catalogueItemId = matchFromPriceBook.catalogueItemId || '';
                        updated.description = matchFromPriceBook.description || matchFromPriceBook.name || '';
                        updated.unitPrice = asNumber(matchFromPriceBook.unitPrice);
                        updated.taxRate = asNumber(matchFromPriceBook.taxRate);
                        updated.quantity = asNumber(matchFromPriceBook.defaultQuantity, 1) || updated.quantity;
                        updated.optionCode = matchFromPriceBook.optionCode || '';
                        updated.sku = String(matchFromPriceBook.sku || value).trim().toUpperCase();
                    } else if (matchFromCatalogue) {
                        updated.catalogueItemId = matchFromCatalogue.id || '';
                        updated.description = matchFromCatalogue.description || matchFromCatalogue.name || '';
                        updated.unitPrice = asNumber(matchFromCatalogue.unitPrice);
                        updated.taxRate = asNumber(matchFromCatalogue.taxRate);
                        updated.quantity = asNumber(matchFromCatalogue.defaultQuantity, 1) || updated.quantity;
                        const options = Array.isArray(matchFromCatalogue.options) ? matchFromCatalogue.options : [];
                        updated.optionCode = options.length ? options[0] : '';
                        updated.sku = String(matchFromCatalogue.sku || value).trim().toUpperCase();
                    } else {
                        updated.catalogueItemId = '';
                        updated.optionCode = '';
                        updated.sku = String(value || '').trim().toUpperCase();
                    }
                }
                if (field === 'optionCode') {
                    const options = catalogueOptionsFor(updated.catalogueItemId, updated.sku);
                    if (value && options.includes(value)) {
                        updated.optionCode = value;
                    } else if (value) {
                        updated.optionCode = value;
                    } else {
                        updated.optionCode = '';
                    }
                }
                if (field === 'lineDate') {
                    const lineDate = value || prev.issueDate || todayISO();
                    updated.lineDate = lineDate;
                    updated.isoWeek = getISOWeek(lineDate);
                }
                if (field === 'quantity' || field === 'unitPrice') {
                    updated[field] = value;
                }
                return updated;
            }),
        };
    });
    const removeInvoiceLine = (id) => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return {
            ...prev,
            lineItems: prev.lineItems.length > 1
                ? prev.lineItems.filter(line => line.tempId !== id)
                : [blankInvoiceLine(prev.issueDate || todayISO())],
        };
    });

    const resetInvoiceLines = () => {
        setInvoiceLinesTouched(false);
        setInvoiceDraft(prev => ({
            ...prev,
            lineItems: [blankInvoiceLine(prev.issueDate || todayISO())],
        }));
    };

    const loadPriceBookIntoInvoice = () => {
        const fallbackDate = normalizeDateInput(invoiceDateInput) || invoiceDraft.issueDate || todayISO();
        const lines = (activePriceBook?.items || []).map(item => toInvoiceLine(item, fallbackDate));
        setInvoiceDraft(prev => {
            const nextIssueDate = prev.issueDate || fallbackDate;
            return {
                ...prev,
                issueDate: nextIssueDate,
                lineItems: lines.length ? lines : [blankInvoiceLine(nextIssueDate)],
            };
        });
        setInvoiceDateInput(fallbackDate);
        setInvoiceLinesTouched(true);
        setInvoiceDateError('');
    };

    const handleIssueDateInputChange = (rawValue = '') => {
        setInvoiceLinesTouched(true);
        const trimmed = rawValue.trim();
        const normalised = normalizeDateInput(rawValue);
        if (normalised === null) {
            setInvoiceDateInput(rawValue);
            if (trimmed.length >= 8) {
                setInvoiceDateError('Use YYYY-MM-DD or MM/DD/YYYY format.');
            } else {
                setInvoiceDateError('');
            }
            return;
        }
        if (normalised === '') {
            setInvoiceDateInput('');
            setInvoiceDateError('');
            setInvoiceDraft(prev => ({ ...prev, issueDate: '' }));
            return;
        }
        setInvoiceDateError('');
        setInvoiceDraft(prev => {
            const nextIssueDate = normalised;
            const lineItems = prev.lineItems.map(line => {
                if (!line.lineDate || line.lineDate === prev.issueDate) {
                    return {
                        ...line,
                        lineDate: nextIssueDate,
                        isoWeek: getISOWeek(nextIssueDate),
                    };
                }
                return line;
            });
            return { ...prev, issueDate: nextIssueDate, lineItems };
        });
        setInvoiceDateInput(normalised);
    };

    const handleSaveMaster = async (event) => {
        event.preventDefault();
        if (!user?.orgId) return;
        const normalizedItems = sanitizePriceItems(masterDraft.items);
        const payload = { orgId: user.orgId, isMaster: true, name: masterDraft.name.trim() || 'Master Price Book', items: normalizedItems, updatedAt: serverTimestamp() };
        try {
            if (masterPriceBook?.id) {
                await updateDoc(doc(db, 'priceBooks', masterPriceBook.id), payload);
                masterSnapshotRef.current = JSON.stringify({ id: masterPriceBook.id, name: payload.name, items: normalizedItems });
                setMasterDraft(prev => ({
                    ...prev,
                    id: masterPriceBook.id,
                    items: normalizedItems.map(toEditableItem),
                }));
            } else {
                const docRef = await addDoc(collection(db, 'priceBooks'), { ...payload, createdAt: serverTimestamp() });
                masterSnapshotRef.current = JSON.stringify({ id: docRef.id, name: payload.name, items: normalizedItems });
                setMasterDraft(prev => ({
                    ...prev,
                    id: docRef.id,
                    items: normalizedItems.map(toEditableItem),
                }));
            }
            setMasterMessage({ type: 'success', message: 'Master price book saved.' });
            setMasterHasUnsavedChanges(false);
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
            const draftNameRaw = customerDraft.name || `${selectedCustomer.name} Price Book`;
            const draftName = draftNameRaw.trim() || `${selectedCustomer.name} Price Book`;
            const itemsSource = customerDraft.items && customerDraft.items.length ? customerDraft.items : masterDraft.items;
            const items = sanitizePriceItems(itemsSource);
            if (customerDraft.isCustom && customerDraft.id) {
                await updateDoc(doc(db, 'priceBooks', customerDraft.id), {
                    name: draftName,
                    items,
                    updatedAt: serverTimestamp(),
                });
                customerSnapshotRef.current = JSON.stringify({ id: customerDraft.id, name: draftName, items });
                setCustomerDraft(prev => prev ? {
                    ...prev,
                    name: draftName,
                    items: items.map(toEditableItem),
                } : prev);
            } else {
                const newDoc = await addDoc(collection(db, 'priceBooks'), {
                    orgId: user.orgId,
                    name: draftName,
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
                customerSnapshotRef.current = JSON.stringify({ id: newDoc.id, name: draftName, items });
                setCustomerDraft(prev => prev ? {
                    ...prev,
                    id: newDoc.id,
                    isCustom: true,
                    name: draftName,
                    items: items.map(toEditableItem),
                } : prev);
            }
            setCustomerHasUnsavedChanges(false);
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
            customerSnapshotRef.current = formatPriceBookSignature(masterPriceBook);
            setCustomerDraft({
                id: masterPriceBook.id,
                name: masterPriceBook.name || `${selectedCustomer.name} Price Book`,
                items: (masterPriceBook.items || []).map(toEditableItem),
                isCustom: false,
            });
            setCustomerHasUnsavedChanges(false);
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
        const effectiveIssueDate = invoiceDraft.issueDate || normalizeDateInput(invoiceDateInput) || todayISO();
        const sanitized = sanitizeInvoiceLines(invoiceDraft.lineItems, effectiveIssueDate).filter(line => line.description && line.quantity > 0);
        if (!sanitized.length) {
            setInvoiceMessage({ type: 'error', message: 'Add at least one invoice line.' });
            return;
        }
        const isCredit = invoiceDraft.kind === 'credit';
        const preparedLines = isCredit ? sanitized.map(line => ({ ...line, quantity: line.quantity * -1 })) : sanitized;
        const totals = calculateTotals(preparedLines);
        const payload = {
            orgId: user.orgId,
            customerId: selectedCustomer.id,
            reference: invoiceDraft.reference.trim(),
            issueDate: effectiveIssueDate,
            dueDate: invoiceDraft.dueDate || null,
            currency: invoiceDraft.currency || 'GBP',
            notes: invoiceDraft.notes.trim(),
            lines: preparedLines,
            totals,
            status: 'Draft',
            documentType: isCredit ? 'CreditNote' : 'Invoice',
            ublVersion: '2.1',
            priceBookId: activePriceBook?.id || null,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        try {
            await addDoc(collection(db, 'invoices'), payload);
            setInvoiceMessage({ type: 'success', message: 'Invoice saved.' });
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            setInvoiceDraft(prev => ({
                ...prev,
                reference: '',
                lineItems: [blankInvoiceLine(prev.issueDate || todayISO())],
            }));
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
        const effectiveIssueDate = invoiceDraft.issueDate || normalizeDateInput(invoiceDateInput) || todayISO();
        const sanitized = sanitizeInvoiceLines(invoiceDraft.lineItems, effectiveIssueDate).filter(line => line.description && line.quantity > 0);
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
    const isCreditDocument = invoiceDraft.kind === 'credit';
    const invoicePreviewTotals = useMemo(() => {
        const totals = calculateTotals(invoiceDraft.lineItems);
        if (!isCreditDocument) return totals;
        return {
            net: -totals.net,
            tax: -totals.tax,
            gross: -totals.gross,
        };
    }, [invoiceDraft.lineItems, isCreditDocument]);
    const viewTabs = [
        { id: 'invoices', label: 'Current Invoice & Credit' },
        { id: 'priceLists', label: 'Customer Price Lists' },
        { id: 'history', label: 'Historic Invoices & Payments' },
        { id: 'accounts', label: 'Accounts (GAAP Ledger)' },
    ];
    const customerNameById = useMemo(() => {
        const map = new Map();
        (customers || []).forEach(customer => {
            if (!customer?.id) return;
            map.set(customer.id, customer.name || 'Customer');
        });
        return map;
    }, [customers]);
    const historySummaries = useMemo(() => {
        const summaries = new Map();
        (invoices || []).forEach(invoice => {
            if (!invoice) return;
            const customerKey = invoice.customerId || '__unassigned__';
            const entry = summaries.get(customerKey) || {
                customerId: customerKey,
                totalGross: 0,
                totalPaid: 0,
                latestIssueDate: '',
                invoices: [],
                currency: invoice.currency || 'GBP'
            };
            if (!entry.currency && invoice.currency) {
                entry.currency = invoice.currency;
            }
            const rawGross = Number(invoice.totals?.gross || 0);
            const gross = invoice.documentType === 'CreditNote' ? -rawGross : rawGross;
            const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
            const paidRaw = payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0);
            const paid = invoice.documentType === 'CreditNote' ? -paidRaw : paidRaw;
            const outstanding = gross - paid;
            entry.totalGross += gross;
            entry.totalPaid += paid;
            if (invoice.issueDate && (!entry.latestIssueDate || invoice.issueDate > entry.latestIssueDate)) {
                entry.latestIssueDate = invoice.issueDate;
            }
            entry.invoices.push({
                id: invoice.id,
                reference: invoice.reference || invoice.id,
                issueDate: invoice.issueDate || '',
                gross,
                paid,
                outstanding,
                status: invoice.status || 'Draft',
                currency: invoice.currency || entry.currency || 'GBP'
            });
            summaries.set(customerKey, entry);
        });
        return Array.from(summaries.values()).map(entry => ({
            ...entry,
            customerName: customerNameById.get(entry.customerId) || (entry.customerId === '__unassigned__' ? 'Unassigned' : 'Unknown customer'),
            balance: Number(entry.totalGross - entry.totalPaid),
            invoices: entry.invoices.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
        })).sort((a, b) => b.balance - a.balance);
    }, [invoices, customerNameById]);
    const invoiceLedger = useMemo(() => {
        return (invoices || []).map(invoice => {
            const rawGross = Number(invoice.totals?.gross || 0);
            const gross = invoice.documentType === 'CreditNote' ? -rawGross : rawGross;
            const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
            const paidRaw = payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0);
            const paid = invoice.documentType === 'CreditNote' ? -paidRaw : paidRaw;
            const outstanding = gross - paid;
            return {
                id: invoice.id,
                reference: invoice.reference || invoice.id,
                issueDate: invoice.issueDate || '',
                customerName: customerNameById.get(invoice.customerId) || 'Unassigned',
                gross,
                paid,
                outstanding,
                status: invoice.status || 'Draft',
                documentType: invoice.documentType || 'Invoice',
                currency: invoice.currency || 'GBP'
            };
        }).sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
    }, [invoices, customerNameById]);
    const paymentHistory = useMemo(() => {
        const entries = [];
        (invoices || []).forEach(invoice => {
            const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
            payments.forEach((payment, index) => {
                entries.push({
                    id: payment?.id || `${invoice.id || randomId()}-${index}`,
                    invoiceReference: invoice.reference || invoice.id,
                    customerName: customerNameById.get(invoice.customerId) || 'Unassigned',
                    date: payment?.date || '',
                    amount: Number(payment?.amount || 0),
                    method: payment?.method || payment?.type || '',
                    note: payment?.note || payment?.reference || '',
                    currency: invoice.currency || 'GBP'
                });
            });
        });
        return entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [invoices, customerNameById]);
    const accountingLedger = useMemo(() => {
        const entries = [];
        (invoices || []).forEach(invoice => {
            if (!invoice) return;
            const isCredit = (invoice.documentType || '').toLowerCase() === 'creditnote';
            const direction = isCredit ? -1 : 1;
            const currency = invoice.currency || 'GBP';
            const issueDate = invoice.issueDate || (invoice.createdAt?.seconds ? new Date(invoice.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
            const reference = invoice.reference || invoice.id;
            const customerId = invoice.customerId || '';
            const counterparty = customerNameById.get(customerId) || (customerId ? 'Customer' : 'Unassigned');
            const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
            let netAccumulator = 0;
            let taxAccumulator = 0;
            if (lines.length) {
                lines.forEach((line, idx) => {
                    const net = asNumber(line.quantity, 0) * asNumber(line.unitPrice, 0) * direction;
                    const tax = net * (asNumber(line.taxRate, 0) / 100);
                    netAccumulator += net;
                    taxAccumulator += tax;
                    const memo = `${line.sku ? `${line.sku} - ` : ''}${line.description || 'Line item'}`.trim();
                    entries.push({
                        id: `inv-${invoice.id || randomId()}-rev-${idx}`,
                        date: line.lineDate || issueDate,
                        accountCode: '4000',
                        accountName: 'Sales Revenue',
                        type: 'revenue',
                        debit: net < 0 ? Math.abs(net) : 0,
                        credit: net > 0 ? net : 0,
                        memo,
                        documentRef: reference,
                        documentType: invoice.documentType || 'Invoice',
                        counterparty,
                        customerId,
                        currency,
                        source: 'Invoice',
                        status: invoice.status || 'Draft',
                    });
                });
            } else {
                const net = Number(invoice.totals?.net || 0) * direction;
                netAccumulator = net;
                if (net) {
                    entries.push({
                        id: `inv-${invoice.id || randomId()}-rev`,
                        date: issueDate,
                        accountCode: '4000',
                        accountName: 'Sales Revenue',
                        type: 'revenue',
                        debit: net < 0 ? Math.abs(net) : 0,
                        credit: net > 0 ? net : 0,
                        memo: `Invoice ${reference}`,
                        documentRef: reference,
                        documentType: invoice.documentType || 'Invoice',
                        counterparty,
                        customerId,
                        currency,
                        source: 'Invoice',
                        status: invoice.status || 'Draft',
                    });
                }
                taxAccumulator = Number(invoice.totals?.tax || 0) * direction;
            }
            const effectiveTax = lines.length ? taxAccumulator : Number(invoice.totals?.tax || 0) * direction;
            if (effectiveTax) {
                entries.push({
                    id: `inv-${invoice.id || randomId()}-tax`,
                    date: issueDate,
                    accountCode: '2100',
                    accountName: 'Sales Tax Payable',
                    type: 'liability',
                    debit: effectiveTax < 0 ? Math.abs(effectiveTax) : 0,
                    credit: effectiveTax > 0 ? effectiveTax : 0,
                    memo: `Tax on ${reference}`,
                    documentRef: reference,
                    documentType: invoice.documentType || 'Invoice',
                    counterparty,
                    customerId,
                    currency,
                    source: 'Invoice',
                    status: invoice.status || 'Draft',
                });
            }
            const grossFromTotals = Number(invoice.totals?.gross || 0) * direction;
            const effectiveGross = lines.length ? netAccumulator + effectiveTax : grossFromTotals;
            if (effectiveGross) {
                entries.push({
                    id: `inv-${invoice.id || randomId()}-ar`,
                    date: issueDate,
                    accountCode: '1100',
                    accountName: 'Accounts Receivable',
                    type: 'asset',
                    debit: effectiveGross > 0 ? Math.abs(effectiveGross) : 0,
                    credit: effectiveGross < 0 ? Math.abs(effectiveGross) : 0,
                    memo: `${isCredit ? 'Credit note' : 'Invoice'} ${reference}`,
                    documentRef: reference,
                    documentType: invoice.documentType || 'Invoice',
                    counterparty,
                    customerId,
                    currency,
                    source: 'Invoice',
                    status: invoice.status || 'Draft',
                });
            }
            const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
            payments.forEach((payment, idx) => {
                const rawAmount = Number(payment?.amount || 0) * direction;
                if (!rawAmount) return;
                const paymentDate = payment?.date || issueDate;
                const note = payment?.note || payment?.reference || '';
                const method = payment?.method || payment?.type || 'Payment';
                const memo = `${method}${note ? ' - ' + note : ''}`;
                entries.push({
                    id: `pay-${invoice.id || randomId()}-${idx}-cash`,
                    date: paymentDate,
                    accountCode: '1000',
                    accountName: 'Cash & Bank',
                    type: 'asset',
                    debit: rawAmount > 0 ? rawAmount : 0,
                    credit: rawAmount < 0 ? Math.abs(rawAmount) : 0,
                    memo,
                    documentRef: reference,
                    documentType: 'Payment',
                    counterparty,
                    customerId,
                    currency,
                    source: 'Payment receipt',
                    status: invoice.status || 'Draft',
                });
                entries.push({
                    id: `pay-${invoice.id || randomId()}-${idx}-ar`,
                    date: paymentDate,
                    accountCode: '1100',
                    accountName: 'Accounts Receivable',
                    type: 'asset',
                    debit: rawAmount < 0 ? Math.abs(rawAmount) : 0,
                    credit: rawAmount > 0 ? rawAmount : 0,
                    memo: `Settlement for ${reference}`,
                    documentRef: reference,
                    documentType: 'Payment',
                    counterparty,
                    customerId,
                    currency,
                    source: 'Payment receipt',
                    status: invoice.status || 'Draft',
                });
            });
        });
        return entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.documentRef || '').localeCompare(a.documentRef || ''));
    }, [invoices, customerNameById]);
    const normalizeAccountAmount = (entry) => {
        const debit = Number(entry.debit || 0);
        const credit = Number(entry.credit || 0);
        const diff = debit - credit;
        if (entry.type === 'asset' || entry.type === 'expense') return diff;
        return -diff;
    };
    const accountingAccountOptions = useMemo(() => {
        const map = new Map();
        accountingLedger.forEach(entry => {
            if (!entry?.accountCode) return;
            map.set(entry.accountCode, entry.accountName || entry.accountCode);
        });
        return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
    }, [accountingLedger]);
    const accountingCurrencies = useMemo(() => Array.from(new Set(accountingLedger.map(entry => entry.currency || 'GBP'))), [accountingLedger]);
    const filteredLedger = useMemo(() => {
        const search = (accountingFilters.search || '').trim().toLowerCase();
        return accountingLedger.filter(entry => {
            if (accountingFilters.account !== 'all' && entry.accountCode !== accountingFilters.account) return false;
            if (accountingFilters.type !== 'all' && entry.type !== accountingFilters.type) return false;
            if (accountingFilters.customerId !== 'all' && entry.customerId !== accountingFilters.customerId) return false;
            if (accountingFilters.currency !== 'all' && entry.currency !== accountingFilters.currency) return false;
            if (accountingFilters.startDate && entry.date && entry.date < accountingFilters.startDate) return false;
            if (accountingFilters.endDate && entry.date && entry.date > accountingFilters.endDate) return false;
            if (accountingFilters.document !== 'all') {
                const docType = (entry.documentType || '').toLowerCase();
                if (accountingFilters.document === 'invoice' && docType === 'payment') return false;
                if (accountingFilters.document === 'payment' && docType !== 'payment') return false;
                if (accountingFilters.document === 'credit' && docType !== 'creditnote') return false;
            }
            if (search) {
                const haystack = `${entry.memo || ''} ${entry.accountName || ''} ${entry.documentRef || ''} ${entry.documentType || ''} ${entry.counterparty || ''}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });
    }, [accountingLedger, accountingFilters]);
    const ledgerTotals = useMemo(() => {
        const debit = filteredLedger.reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
        const credit = filteredLedger.reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
        return {
            debit: Number(debit.toFixed(2)),
            credit: Number(credit.toFixed(2)),
            imbalance: Number((debit - credit).toFixed(2)),
        };
    }, [filteredLedger]);
    const accountBalances = useMemo(() => {
        const balances = new Map();
        filteredLedger.forEach(entry => {
            const key = entry.accountCode || entry.accountName || entry.accountId || 'uncategorized';
            const current = balances.get(key) || {
                accountCode: entry.accountCode || key,
                accountName: entry.accountName || key,
                type: entry.type || 'asset',
                balance: 0,
                currency: entry.currency || 'GBP',
            };
            current.balance += normalizeAccountAmount(entry);
            current.currency = entry.currency || current.currency;
            balances.set(key, current);
        });
        return Array.from(balances.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    }, [filteredLedger]);
    const profitAndLoss = useMemo(() => {
        let revenue = 0;
        let expenses = 0;
        filteredLedger.forEach(entry => {
            if (entry.type === 'revenue') {
                revenue += normalizeAccountAmount(entry);
            }
            if (entry.type === 'expense') {
                expenses += normalizeAccountAmount(entry);
            }
        });
        return {
            revenue: Number(revenue.toFixed(2)),
            expenses: Number(expenses.toFixed(2)),
            net: Number((revenue - expenses).toFixed(2)),
        };
    }, [filteredLedger]);
    const balanceSheet = useMemo(() => {
        let assets = 0;
        let liabilities = 0;
        let equity = 0;
        filteredLedger.forEach(entry => {
            const amount = normalizeAccountAmount(entry);
            if (entry.type === 'asset') assets += amount;
            if (entry.type === 'liability') liabilities += amount;
            if (entry.type === 'equity') equity += amount;
        });
        const equityWithIncome = equity + profitAndLoss.net;
        const balanceGap = Number((assets - liabilities - equityWithIncome).toFixed(2));
        return {
            assets: Number(assets.toFixed(2)),
            liabilities: Number(liabilities.toFixed(2)),
            equity: Number(equityWithIncome.toFixed(2)),
            balanceGap,
        };
    }, [filteredLedger, profitAndLoss]);
    const reportingCurrency = accountingFilters.currency !== 'all'
        ? accountingFilters.currency
        : (accountingCurrencies[0] || 'GBP');
    const multiCurrency = accountingFilters.currency === 'all' && accountingCurrencies.length > 1;

    useEffect(() => {
        const signature = formatCatalogueSignature(catalogueItems);
        if (!catalogueHasUnsavedChanges && catalogueSnapshotRef.current === signature) {
            return;
        }
        if (!catalogueHasUnsavedChanges || catalogueSnapshotRef.current !== signature) {
            setCatalogueDraft((catalogueItems || []).map(toCatalogueEditable));
            setCatalogueRemovedIds([]);
            catalogueSnapshotRef.current = signature;
            setCatalogueHasUnsavedChanges(false);
        }
    }, [catalogueItems, catalogueHasUnsavedChanges]);

    useEffect(() => {
        const signature = formatPriceBookSignature(masterPriceBook);
        if (!masterPriceBook) {
            if (!masterHasUnsavedChanges && masterSnapshotRef.current === '') {
                return;
            }
            if (!masterHasUnsavedChanges) {
                setMasterDraft(prev => ({
                    id: null,
                    name: prev.name || 'Master Price Book',
                    items: prev.items || [],
                }));
            }
            masterSnapshotRef.current = '';
            return;
        }
        if (!masterHasUnsavedChanges && masterSnapshotRef.current === signature) {
            return;
        }
        if (!masterHasUnsavedChanges || masterSnapshotRef.current !== signature) {
            setMasterDraft({
                id: masterPriceBook.id,
                name: masterPriceBook.name || 'Master Price Book',
                items: (masterPriceBook.items || []).map(toEditableItem),
            });
            masterSnapshotRef.current = signature;
            setMasterHasUnsavedChanges(false);
        }
    }, [masterPriceBook, masterHasUnsavedChanges]);

    useEffect(() => {
        if (!selectedCustomer) {
            setCustomerDraft(null);
            setCustomerHasUnsavedChanges(false);
            customerSnapshotRef.current = '';
            return;
        }
        const basePriceBook = assignedPriceBook && !assignedPriceBook.isMaster ? assignedPriceBook : activePriceBook;
        const signature = formatPriceBookSignature(basePriceBook);
        if (!customerHasUnsavedChanges && customerSnapshotRef.current === signature) {
            return;
        }
        if (!customerHasUnsavedChanges || customerSnapshotRef.current !== signature || !customerDraft) {
            const isCustom = !!(basePriceBook && !basePriceBook.isMaster);
            setCustomerDraft({
                id: basePriceBook?.id || null,
                name: basePriceBook?.name || `${selectedCustomer?.name || 'Customer'} Price Book`,
                items: (basePriceBook?.items || []).map(toEditableItem),
                isCustom,
            });
            customerSnapshotRef.current = signature;
            setCustomerHasUnsavedChanges(false);
        }
    }, [selectedCustomer, assignedPriceBook, activePriceBook, customerHasUnsavedChanges]);

    useEffect(() => {
        if (!selectedCustomerId) {
            lastCustomerRef.current = '';
            setInvoiceDraft(prev => ({
                ...prev,
                lineItems: [blankInvoiceLine(prev.issueDate || todayISO())],
            }));
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            return;
        }
        if (lastCustomerRef.current !== selectedCustomerId) {
            lastCustomerRef.current = selectedCustomerId;
            setInvoiceDraft(prev => ({
                ...prev,
                currency: prev.currency || selectedCustomer?.currency || 'GBP',
                lineItems: [blankInvoiceLine(prev.issueDate || todayISO())],
            }));
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
        }
    }, [selectedCustomerId, selectedCustomer]);

    if (loading) {
        return <Card>Loading billing data...</Card>;
    }

    if (!user?.orgId) {
        return <Card>Connect this console to an organisation to manage invoicing.</Card>;
    }

    return (
        <div className="space-y-6">
            <Card className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-semibold text-red-300">Billing Console</h2>
                        <p className="text-sm text-gray-400">Manage invoices, catalogue-driven price lists, and account history.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {viewTabs.map(tab => (
                            <Button
                                key={tab.id}
                                type="button"
                                className={'w-auto ' + (activeView === tab.id ? '' : 'bg-gray-800 hover:bg-gray-700')}
                                onClick={() => setActiveView(tab.id)}
                                aria-pressed={activeView === tab.id}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Dates output in ISO 8601 (UBL compliant) format.</p>
            </Card>

            {activeView === 'priceLists' && (
                <div className="space-y-6">
                    <Card className="space-y-4">
                        <form onSubmit={handleSaveCatalogue} className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h3 className="text-lg text-red-400">Product Catalogue</h3>
                                    <p className="text-sm text-gray-400">SKUs drive descriptions, prices, and option sets for every document.</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button type="button" className="w-auto" onClick={addCatalogueRow}>Add product</Button>
                                    <Button type="submit" className="w-auto" disabled={!catalogueHasUnsavedChanges && catalogueRemovedIds.length === 0}>Save catalogue</Button>
                                </div>
                            </div>
                            {catalogueHasUnsavedChanges && (
                                <p className="text-xs text-yellow-300">Unsaved catalogue changes detected.</p>
                            )}
                            <div className="space-y-3">
                                {catalogueDraft.length === 0 && (
                                    <p className="text-sm text-gray-500">Add catalogue entries to seed the master price book.</p>
                                )}
                                {catalogueDraft.map(item => (
                                    <div key={item.tempId} className="space-y-3 border border-red-900 bg-gray-900/60 p-3">
                                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                            <Input className="md:col-span-2" value={item.sku} onChange={event => updateCatalogueRow(item.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                            <Input className="md:col-span-3" value={item.name} onChange={event => updateCatalogueRow(item.tempId, 'name', event.target.value)} placeholder="Product name" />
                                            <Input className="md:col-span-3" value={item.description} onChange={event => updateCatalogueRow(item.tempId, 'description', event.target.value)} placeholder="Description" />
                                            <Input type="number" step="0.01" className="md:col-span-2" value={item.unitPrice} onChange={event => updateCatalogueRow(item.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                            <Input type="number" step="0.01" className="md:col-span-1" value={item.taxRate} onChange={event => updateCatalogueRow(item.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                            <Input type="number" className="md:col-span-1" value={item.defaultQuantity} onChange={event => updateCatalogueRow(item.tempId, 'defaultQuantity', event.target.value)} placeholder="Qty" />
                                            <TextArea rows={2} className="md:col-span-12" value={item.optionsText} onChange={event => updateCatalogueRow(item.tempId, 'optionsText', event.target.value)} placeholder="Options (one per line)" />
                                            <div className="md:col-span-12 flex justify-end">
                                                <Button type="button" className="w-auto bg-gray-800" onClick={() => removeCatalogueRow(item.tempId)}>Remove</Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {catalogueMessage && (
                                <div
                                    role="status"
                                    className={'rounded border-l-4 px-3 py-2 text-sm ' + (catalogueMessage.type === 'success'
                                        ? 'border-green-500 bg-green-900/20 text-green-200'
                                        : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                                >
                                    {catalogueMessage.message}
                                </div>
                            )}
                        </form>
                    </Card>

                    <Card className="space-y-4">
                        <form onSubmit={handleSaveMaster} className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div className="md:flex-1">
                                    <label className="text-xs uppercase text-red-300">Master price book name</label>
                                    <Input
                                        value={masterDraft.name}
                                        onChange={event => {
                                            const value = event.target.value;
                                            setMasterHasUnsavedChanges(true);
                                            setMasterDraft(prev => ({ ...prev, name: value }));
                                        }}
                                        placeholder="Master Price Book"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <Button type="button" className="w-auto" onClick={addMasterRow}>Add item</Button>
                                    <Button type="submit" className="w-auto" disabled={!masterHasUnsavedChanges}>Save master</Button>
                                </div>
                            </div>
                            {masterDraft.items.length === 0 && (
                                <p className="text-sm text-gray-500">Link catalogue items to build the master price book.</p>
                            )}
                            <div className="space-y-3">
                                {masterDraft.items.map(item => {
                                    const rowOptions = catalogueOptionsFor(item.catalogueItemId, item.sku);
                                    return (
                                        <div key={item.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 border border-red-900 bg-gray-900/60 p-3">
                                            <Select
                                                className="md:col-span-3"
                                                value={item.catalogueItemId || ''}
                                                onChange={event => updateMasterRow(item.tempId, 'catalogueItemId', event.target.value)}
                                            >
                                                <option value="">Link to catalogue...</option>
                                                {catalogueItems.map(product => (
                                                    <option key={product.id} value={product.id}>{(product.sku || '') + ' - ' + (product.name || 'Unnamed product')}</option>
                                                ))}
                                            </Select>
                                            <Input className="md:col-span-2" value={item.sku} onChange={event => updateMasterRow(item.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                            {rowOptions.length > 0 ? (
                                                <Select
                                                    className="md:col-span-2"
                                                    value={item.optionCode || ''}
                                                    onChange={event => updateMasterRow(item.tempId, 'optionCode', event.target.value)}
                                                >
                                                    <option value="">Select option...</option>
                                                    {rowOptions.map(option => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <div className="md:col-span-2 text-xs text-gray-500 flex items-center">No catalogue options</div>
                                            )}
                                            <Input type="number" step="0.01" className="md:col-span-2" value={item.unitPrice} onChange={event => updateMasterRow(item.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                            <Input type="number" step="0.01" className="md:col-span-1" value={item.taxRate} onChange={event => updateMasterRow(item.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                            <Input type="number" className="md:col-span-1" value={item.defaultQuantity} onChange={event => updateMasterRow(item.tempId, 'defaultQuantity', event.target.value)} placeholder="Qty" />
                                            <Button type="button" className="md:col-span-1 bg-gray-800" onClick={() => removeMasterRow(item.tempId)}>Remove</Button>
                                            <Input className="md:col-span-3" value={item.name} onChange={event => updateMasterRow(item.tempId, 'name', event.target.value)} placeholder="Catalogue name" />
                                            <Input className="md:col-span-9" value={item.description} onChange={event => updateMasterRow(item.tempId, 'description', event.target.value)} placeholder="Description" />
                                        </div>
                                    );
                                })}
                            </div>
                            {masterMessage && (
                                <div
                                    role="status"
                                    className={'rounded border-l-4 px-3 py-2 text-sm ' + (masterMessage.type === 'success'
                                        ? 'border-green-500 bg-green-900/20 text-green-200'
                                        : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                                >
                                    {masterMessage.message}
                                </div>
                            )}
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
                                        type="button"
                                        onClick={() => setSelectedCustomerId(customer.id)}
                                        className={'w-full text-left border p-2 ' + (selectedCustomerId === customer.id ? 'border-red-500 bg-red-900/40' : 'border-red-900 bg-gray-900/40')}
                                    >
                                        <p className="font-semibold">{customer.name}</p>
                                        {customer.email && <p className="text-xs text-gray-400">{customer.email}</p>}
                                    </button>
                                ))}
                            </div>
                            <form onSubmit={handleCreateCustomer} className="space-y-2">
                                <Input name="customerName" placeholder="Customer name" required />
                                <Input name="customerEmail" type="email" placeholder="Email (optional)" />
                                <Input name="customerTerms" placeholder="Payment terms (e.g. Net 30)" />
                                <TextArea name="customerAddress" rows={2} placeholder="Billing address" />
                                <Button type="submit">Add customer</Button>
                            </form>
                            {customerMessage && (
                                <div
                                    role="status"
                                    className={'rounded border-l-4 px-3 py-2 text-sm ' + (customerMessage.type === 'success'
                                        ? 'border-green-500 bg-green-900/20 text-green-200'
                                        : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                                >
                                    {customerMessage.message}
                                </div>
                            )}
                        </Card>
                        <Card className="lg:col-span-2 space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <h3 className="text-lg text-red-400">Customer Price Book</h3>
                                {selectedCustomer && (
                                    <span className="text-sm text-gray-400">
                                        {selectedCustomer.name} ? {customerDraft?.isCustom ? 'Custom pricing' : 'Using master'}
                                    </span>
                                )}
                            </div>
                            {!selectedCustomer && <p className="text-sm text-gray-500">Select a customer to view their price list.</p>}
                            {selectedCustomer && customerDraft && (
                                <div className="space-y-4">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                        <Input
                                            className="md:w-1/2"
                                            value={customerDraft.name}
                                            onChange={event => {
                                                const value = event.target.value;
                                                setCustomerHasUnsavedChanges(true);
                                                setCustomerDraft(prev => prev ? { ...prev, name: value } : prev);
                                            }}
                                            placeholder="Price book name"
                                            disabled={!customerDraft.isCustom}
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            {!customerDraft.isCustom && (
                                                <Button type="button" className="w-auto" onClick={addCustomerRow}>Create custom price book</Button>
                                            )}
                                            {customerDraft.isCustom && (
                                                <>
                                                    <Button type="button" className="w-auto" onClick={handleSaveCustomerPricing} disabled={!customerHasUnsavedChanges}>Save</Button>
                                                    <Button type="button" className="w-auto bg-gray-800" onClick={handleRevertToMaster}>Revert</Button>
                                                    <Button type="button" className="w-auto" onClick={addCustomerRow}>Add item</Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {customerDraft.items.length === 0 && <p className="text-sm text-gray-500">No items in this price book.</p>}
                                        {customerDraft.items.map(item => {
                                            const rowOptions = catalogueOptionsFor(item.catalogueItemId, item.sku);
                                            const isEditable = !!customerDraft.isCustom;
                                            return (
                                                <div key={item.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 border border-red-900 bg-gray-900/60 p-3">
                                                    <Select
                                                        className="md:col-span-3"
                                                        value={item.catalogueItemId || ''}
                                                        onChange={event => updateCustomerRow(item.tempId, 'catalogueItemId', event.target.value)}
                                                        disabled={!isEditable}
                                                    >
                                                        <option value="">Link to catalogue...</option>
                                                        {catalogueItems.map(product => (
                                                            <option key={product.id} value={product.id}>{(product.sku || '') + ' - ' + (product.name || 'Unnamed product')}</option>
                                                        ))}
                                                    </Select>
                                                    <Input className="md:col-span-2" value={item.sku} onChange={event => updateCustomerRow(item.tempId, 'sku', event.target.value)} placeholder="SKU" disabled={!isEditable} />
                                                    {rowOptions.length > 0 ? (
                                                        <Select
                                                            className="md:col-span-2"
                                                            value={item.optionCode || ''}
                                                            onChange={event => updateCustomerRow(item.tempId, 'optionCode', event.target.value)}
                                                            disabled={!isEditable}
                                                        >
                                                            <option value="">Select option...</option>
                                                            {rowOptions.map(option => (
                                                                <option key={option} value={option}>{option}</option>
                                                            ))}
                                                        </Select>
                                                    ) : (
                                                        <div className="md:col-span-2 text-xs text-gray-500 flex items-center">No catalogue options</div>
                                                    )}
                                                    <Input type="number" step="0.01" className="md:col-span-2" value={item.unitPrice} onChange={event => updateCustomerRow(item.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" disabled={!isEditable} />
                                                    <Input type="number" step="0.01" className="md:col-span-1" value={item.taxRate} onChange={event => updateCustomerRow(item.tempId, 'taxRate', event.target.value)} placeholder="Tax %" disabled={!isEditable} />
                                                    <Input type="number" className="md:col-span-1" value={item.defaultQuantity} onChange={event => updateCustomerRow(item.tempId, 'defaultQuantity', event.target.value)} placeholder="Qty" disabled={!isEditable} />
                                                    <Button type="button" className="md:col-span-1 bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => removeCustomerRow(item.tempId)} disabled={!isEditable}>Remove</Button>
                                                    <Input className="md:col-span-3" value={item.name} onChange={event => updateCustomerRow(item.tempId, 'name', event.target.value)} placeholder="Catalogue name" disabled={!isEditable} />
                                                    <Input className="md:col-span-9" value={item.description} onChange={event => updateCustomerRow(item.tempId, 'description', event.target.value)} placeholder="Description" disabled={!isEditable} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {customerMessage && selectedCustomer && (
                                <div
                                    role="status"
                                    className={'rounded border-l-4 px-3 py-2 text-sm ' + (customerMessage.type === 'success'
                                        ? 'border-green-500 bg-green-900/20 text-green-200'
                                        : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                                >
                                    {customerMessage.message}
                                </div>
                            )}
                        </Card>
                    </div>
                </div>
            )}

            {activeView === 'invoices' && (
                <div className="space-y-6">
                    <Card>
                        <form onSubmit={handleInvoiceSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                                <Select
                                    className="md:col-span-1"
                                    value={invoiceDraft.kind}
                                    onChange={event => setInvoiceDraft(prev => ({ ...prev, kind: event.target.value }))}
                                >
                                    <option value="invoice">Invoice</option>
                                    <option value="credit">Credit note</option>
                                </Select>
                                <Input
                                    className="md:col-span-2 focus-visible:ring-2 focus-visible:ring-red-500"
                                    value={invoiceDraft.reference}
                                    onChange={event => setInvoiceDraft(prev => ({ ...prev, reference: event.target.value }))}
                                    placeholder="Document reference"
                                />
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    className="md:col-span-1"
                                    value={invoiceDateInput}
                                    placeholder="YYYY-MM-DD"
                                    onChange={event => handleIssueDateInputChange(event.target.value)}
                                    onBlur={event => handleIssueDateInputChange(event.target.value)}
                                />
                                <Input type="date" className="md:col-span-1" value={invoiceDraft.dueDate || ''} onChange={event => setInvoiceDraft(prev => ({ ...prev, dueDate: event.target.value }))} />
                                <Select className="md:col-span-1" value={invoiceDraft.currency} onChange={event => setInvoiceDraft(prev => ({ ...prev, currency: event.target.value }))}>
                                    {['GBP', 'USD', 'EUR', 'CAD', 'AUD'].map(code => (
                                        <option key={code} value={code}>{code}</option>
                                    ))}
                                </Select>
                            </div>
                            {invoiceDateError && <p className="text-xs text-yellow-300">Issue date must be ISO 8601 (YYYY-MM-DD).</p>}
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" className="w-auto" onClick={addInvoiceLineRow}>Add line</Button>
                                <Button type="button" className="w-auto bg-gray-800" onClick={resetInvoiceLines}>Start blank</Button>
                                <Button type="button" className="w-auto bg-gray-800" onClick={loadPriceBookIntoInvoice} disabled={!activePriceBook?.items?.length}>Load price book items</Button>
                            </div>
                            <div className="space-y-3">
                                {invoiceDraft.lineItems.map(line => {
                                    const rowOptions = catalogueOptionsFor(line.catalogueItemId, line.sku);
                                    return (
                                        <div key={line.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-3 border border-red-900 bg-gray-900/60 p-3">
                                            <Input className="md:col-span-1" value={line.sku} onChange={event => updateInvoiceLine(line.tempId, 'sku', event.target.value)} placeholder="SKU" />
                                            <Input className="md:col-span-3" value={line.description} onChange={event => updateInvoiceLine(line.tempId, 'description', event.target.value)} placeholder="Description" />
                                            {rowOptions.length > 0 ? (
                                                <Select className="md:col-span-2" value={line.optionCode || ''} onChange={event => updateInvoiceLine(line.tempId, 'optionCode', event.target.value)}>
                                                    <option value="">Select option...</option>
                                                    {rowOptions.map(option => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <div className="md:col-span-2 text-xs text-gray-500 flex items-center">No catalogue options</div>
                                            )}
                                            <div className="md:col-span-2 space-y-1">
                                                <Input
                                                    type="date"
                                                    value={line.lineDate || invoiceDraft.issueDate || todayISO()}
                                                    onChange={event => updateInvoiceLine(line.tempId, 'lineDate', event.target.value)}
                                                />
                                                <div className="text-[10px] uppercase tracking-wide text-gray-400">
                                                    ISO week: {line.isoWeek || getISOWeek(line.lineDate || invoiceDraft.issueDate || todayISO()) || 'N/A'}
                                                </div>
                                            </div>
                                            <Input type="number" step="0.01" className="md:col-span-1" value={line.unitPrice} onChange={event => updateInvoiceLine(line.tempId, 'unitPrice', event.target.value)} placeholder="Unit price" />
                                            <Input type="number" step="0.01" className="md:col-span-1" value={line.taxRate} onChange={event => updateInvoiceLine(line.tempId, 'taxRate', event.target.value)} placeholder="Tax %" />
                                            <div className="md:col-span-1 space-y-1">
                                                <Input type="number" value={line.quantity} onChange={event => updateInvoiceLine(line.tempId, 'quantity', event.target.value)} placeholder="Qty" />
                                                <span className="text-xs text-gray-400">Line total: {formatCurrency(asNumber(line.quantity) * asNumber(line.unitPrice), invoiceDraft.currency)}</span>
                                            </div>
                                            <div className="md:col-span-1 flex items-center justify-end">
                                                <Button type="button" className="w-auto bg-gray-800" onClick={() => removeInvoiceLine(line.tempId)}>Remove</Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <TextArea rows={3} value={invoiceDraft.notes} onChange={event => setInvoiceDraft(prev => ({ ...prev, notes: event.target.value }))} placeholder="Notes or payment instructions" />
                            <div className="text-sm text-gray-300">
                                <div>Net: {formatCurrency(invoicePreviewTotals.net, invoiceDraft.currency)}</div>
                                <div>Tax: {formatCurrency(invoicePreviewTotals.tax, invoiceDraft.currency)}</div>
                                <div className="font-semibold">Gross: {formatCurrency(invoicePreviewTotals.gross, invoiceDraft.currency)}</div>
                            </div>
                            <div className="flex flex-wrap gap-4 items-center">
                                <Button type="submit" className="w-auto">Save {invoiceDraft.kind === 'credit' ? 'credit note' : 'invoice'}</Button>
                            </div>
                            {invoiceMessage && (
                                <div
                                    role="status"
                                    className={'rounded border-l-4 px-3 py-2 text-sm ' + (invoiceMessage.type === 'success'
                                        ? 'border-green-500 bg-green-900/20 text-green-200'
                                        : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                                >
                                    {invoiceMessage.message}
                                </div>
                            )}
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
                        {templateMessage && (
                            <div
                                role="status"
                                className={'rounded border-l-4 px-3 py-2 text-sm ' + (templateMessage.type === 'success'
                                    ? 'border-green-500 bg-green-900/20 text-green-200'
                                    : 'border-yellow-500 bg-yellow-900/30 text-yellow-200')}
                            >
                                {templateMessage.message}
                            </div>
                        )}
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
                            <div key={invoice.id} className="border border-red-900 bg-gray-900/60 p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
                                <div>
                                    <p className="font-semibold">{invoice.reference || invoice.id}</p>
                                    <p className="text-xs text-gray-400">{invoice.issueDate || ''}</p>
                                </div>
                                <div className="text-sm text-gray-300">{customers.find(c => c.id === invoice.customerId)?.name || 'Unknown customer'}</div>
                                <div className="text-sm text-gray-300">{formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP')}</div>
                                <div className="text-sm text-gray-300">{invoice.documentType || 'Invoice'}</div>
                                <div className="text-sm text-gray-300">{invoice.status || 'Draft'}</div>
                            </div>
                        ))}
                    </Card>
                </div>
            )}

            {activeView === 'accounts' && (
                <div className="space-y-6">
                    <Card className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h3 className="text-lg text-red-400">General ledger</h3>
                                <p className="text-sm text-gray-400">GAAP-style debit and credit lines for every invoice, credit note, and payment.</p>
                                {multiCurrency && (
                                    <p className="text-xs text-yellow-300">Totals mix currencies — set a currency filter to review in a single currency.</p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" className="w-auto bg-gray-800" onClick={resetAccountingFilters}>Reset filters</Button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <Input type="date" value={accountingFilters.startDate} onChange={event => updateAccountingFilter('startDate', event.target.value)} placeholder="Start date" />
                            <Input type="date" value={accountingFilters.endDate} onChange={event => updateAccountingFilter('endDate', event.target.value)} placeholder="End date" />
                            <Select value={accountingFilters.account} onChange={event => updateAccountingFilter('account', event.target.value)}>
                                <option value="all">All accounts</option>
                                {accountingAccountOptions.map(option => (
                                    <option key={option.code} value={option.code}>{`${option.code} - ${option.name}`}</option>
                                ))}
                            </Select>
                            <Select value={accountingFilters.type} onChange={event => updateAccountingFilter('type', event.target.value)}>
                                <option value="all">All account types</option>
                                <option value="asset">Assets</option>
                                <option value="liability">Liabilities</option>
                                <option value="equity">Equity</option>
                                <option value="revenue">Revenue</option>
                                <option value="expense">Expenses</option>
                            </Select>
                            <Select value={accountingFilters.document} onChange={event => updateAccountingFilter('document', event.target.value)}>
                                <option value="all">All sources</option>
                                <option value="invoice">Invoices & credits</option>
                                <option value="credit">Credit notes only</option>
                                <option value="payment">Payments only</option>
                            </Select>
                            <Select value={accountingFilters.currency} onChange={event => updateAccountingFilter('currency', event.target.value)}>
                                <option value="all">All currencies</option>
                                {accountingCurrencies.map(code => (
                                    <option key={code} value={code}>{code}</option>
                                ))}
                            </Select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <Select value={accountingFilters.customerId} onChange={event => updateAccountingFilter('customerId', event.target.value)}>
                                <option value="all">All customers</option>
                                {customers.map(customer => (
                                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                                ))}
                            </Select>
                            <Input className="md:col-span-2 lg:col-span-3" value={accountingFilters.search} onChange={event => updateAccountingFilter('search', event.target.value)} placeholder="Search memo, reference, or counterparty" />
                            <div className="md:col-span-3 lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-300">
                                <div className="border border-red-900 bg-gray-900/60 p-2 rounded">
                                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Entries</p>
                                    <p className="text-lg font-semibold text-red-200">{filteredLedger.length}</p>
                                </div>
                                <div className="border border-red-900 bg-gray-900/60 p-2 rounded">
                                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Debits</p>
                                    <p className="text-lg font-semibold text-red-200">{formatCurrency(ledgerTotals.debit, reportingCurrency)}</p>
                                </div>
                                <div className="border border-red-900 bg-gray-900/60 p-2 rounded">
                                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Credits</p>
                                    <p className="text-lg font-semibold text-red-200">{formatCurrency(ledgerTotals.credit, reportingCurrency)}</p>
                                </div>
                                <div className={'border border-red-900 bg-gray-900/60 p-2 rounded ' + (ledgerTotals.imbalance === 0 ? '' : 'text-yellow-200')}>
                                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Balance check</p>
                                    <p className="text-lg font-semibold">{formatCurrency(ledgerTotals.imbalance, reportingCurrency)}</p>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <Card className="space-y-3">
                        <div className="hidden md:grid md:grid-cols-9 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                            <span>Date</span>
                            <span>Account</span>
                            <span>Type</span>
                            <span className="text-right">Debit</span>
                            <span className="text-right">Credit</span>
                            <span>Currency</span>
                            <span>Counterparty</span>
                            <span>Source</span>
                            <span>Memo</span>
                        </div>
                        {filteredLedger.length === 0 && (
                            <p className="text-sm text-gray-500">No ledger entries match the current filters.</p>
                        )}
                        {filteredLedger.map(entry => (
                            <div key={entry.id} className="grid grid-cols-1 md:grid-cols-9 gap-3 border border-red-900 bg-gray-900/60 p-3">
                                <div>
                                    <p className="font-semibold">{entry.date || '-'}</p>
                                    <p className="text-xs text-gray-400">{entry.documentRef || ''}</p>
                                </div>
                                <div className="text-sm text-gray-300">{`${entry.accountCode || ''} ${entry.accountName || ''}`.trim()}</div>
                                <div className="text-sm text-gray-300 capitalize">{entry.type || '-'}</div>
                                <div className="md:text-right text-sm text-gray-300">{formatCurrency(entry.debit || 0, entry.currency || reportingCurrency)}</div>
                                <div className="md:text-right text-sm text-gray-300">{formatCurrency(entry.credit || 0, entry.currency || reportingCurrency)}</div>
                                <div className="text-sm text-gray-300">{entry.currency || reportingCurrency}</div>
                                <div className="text-sm text-gray-300">{entry.counterparty || 'Unassigned'}</div>
                                <div className="text-sm text-gray-300">{entry.documentType || entry.source || 'Invoice'}</div>
                                <div className="text-sm text-gray-300">{entry.memo || entry.source || '-'}</div>
                            </div>
                        ))}
                    </Card>

                    <Card className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h4 className="text-lg text-red-400">Profit & Loss ({reportingCurrency})</h4>
                                <div className="flex items-center justify-between text-sm text-gray-300">
                                    <span>Revenue</span>
                                    <span>{formatCurrency(profitAndLoss.revenue, reportingCurrency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-gray-300">
                                    <span>Expenses</span>
                                    <span>{formatCurrency(profitAndLoss.expenses, reportingCurrency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm font-semibold text-red-200">
                                    <span>Net income</span>
                                    <span>{formatCurrency(profitAndLoss.net, reportingCurrency)}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-lg text-red-400">Balance sheet ({reportingCurrency})</h4>
                                <div className="flex items-center justify-between text-sm text-gray-300">
                                    <span>Assets</span>
                                    <span>{formatCurrency(balanceSheet.assets, reportingCurrency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-gray-300">
                                    <span>Liabilities</span>
                                    <span>{formatCurrency(balanceSheet.liabilities, reportingCurrency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-gray-300">
                                    <span>Equity (incl. P&L)</span>
                                    <span>{formatCurrency(balanceSheet.equity, reportingCurrency)}</span>
                                </div>
                                <div className={'flex items-center justify-between text-sm ' + (Math.abs(balanceSheet.balanceGap) < 0.01 ? 'text-gray-400' : 'text-yellow-200')}>
                                    <span>Balance check</span>
                                    <span>{formatCurrency(balanceSheet.balanceGap, reportingCurrency)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <h4 className="text-sm text-red-400">Account balances</h4>
                            <div className="hidden md:grid md:grid-cols-4 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                                <span>Account</span>
                                <span>Type</span>
                                <span className="text-right">Balance</span>
                                <span>Currency</span>
                            </div>
                            {accountBalances.length === 0 && <p className="text-sm text-gray-500">No balances to show.</p>}
                            {accountBalances.map(balance => (
                                <div key={balance.accountCode} className="grid grid-cols-1 md:grid-cols-4 gap-3 border border-red-900 bg-gray-900/60 p-3">
                                    <div className="text-sm text-gray-300 font-semibold">{`${balance.accountCode} ${balance.accountName}`.trim()}</div>
                                    <div className="text-sm text-gray-300 capitalize">{balance.type}</div>
                                    <div className="md:text-right text-sm text-gray-300">{formatCurrency(balance.balance, balance.currency || reportingCurrency)}</div>
                                    <div className="text-sm text-gray-300">{balance.currency || reportingCurrency}</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            )}

        {activeView === 'history' && (
            <div className="space-y-6">
                <Card className="space-y-4">
                    <h3 className="text-lg text-red-400">Outstanding balances</h3>
                    <div className="hidden md:grid md:grid-cols-5 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                        <span>Customer</span>
                        <span className="text-right">Billed</span>
                        <span className="text-right">Paid</span>
                        <span className="text-right">Balance</span>
                        <span>Last activity</span>
                    </div>
                    {historySummaries.length === 0 && (
                        <p className="text-sm text-gray-500">No invoice history recorded yet.</p>
                    )}
                    {historySummaries.map(summary => (
                        <div key={summary.customerId} className="grid grid-cols-1 md:grid-cols-5 gap-3 border border-red-900 bg-gray-900/60 p-3">
                            <div>
                                <p className="font-semibold">{summary.customerName}</p>
                                <p className="text-xs text-gray-500">{summary.invoices.length} {summary.invoices.length === 1 ? 'invoice' : 'invoices'}</p>
                            </div>
                            <div className="md:text-right text-sm text-gray-300">{formatCurrency(summary.totalGross, summary.currency || 'GBP')}</div>
                            <div className="md:text-right text-sm text-gray-300">{formatCurrency(summary.totalPaid, summary.currency || 'GBP')}</div>
                            <div className={`md:text-right text-sm ${summary.balance > 0 ? 'text-red-300' : 'text-gray-300'}`}>
                                {formatCurrency(summary.balance, summary.currency || 'GBP')}
                            </div>
                            <div className="text-sm text-gray-300">{summary.latestIssueDate || '-'}</div>
                        </div>
                    ))}
                </Card>

                <Card className="space-y-4">
                    <h3 className="text-lg text-red-400">Invoice ledger</h3>
                    <div className="hidden md:grid md:grid-cols-6 gap-3 px-3 text-[10px] uppercase tracking-wide text-red-300">
                        <span>Invoice</span>
                        <span>Customer</span>
                        <span className="text-right">Issued</span>
                        <span className="text-right">Paid</span>
                        <span className="text-right">Outstanding</span>
                        <span>Status</span>
                    </div>
                    {invoiceLedger.length === 0 && (
                        <p className="text-sm text-gray-500">No invoices recorded.</p>
                    )}
                    {invoiceLedger.map(record => (
                        <div key={record.id} className="grid grid-cols-1 md:grid-cols-6 gap-3 border border-red-900 bg-gray-900/60 p-3">
                            <div>
                                <p className="font-semibold">{record.reference}</p>
                                <p className="text-xs text-gray-400">{record.issueDate || '—'}</p>
                            </div>
                            <div className="text-sm text-gray-300">{record.customerName}</div>
                            <div className="md:text-right text-sm text-gray-300">{formatCurrency(record.gross, record.currency || 'GBP')}</div>
                            <div className="md:text-right text-sm text-gray-300">{formatCurrency(record.paid, record.currency || 'GBP')}</div>
                            <div className={`md:text-right text-sm ${record.outstanding > 0 ? 'text-red-300' : 'text-gray-300'}`}>
                                {formatCurrency(record.outstanding, record.currency || 'GBP')}
                            </div>
                            <div className="text-sm text-gray-300">{record.status}</div>
                        </div>
                    ))}
                </Card>

                <Card className="space-y-4">
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

};

export default BillingConsole;
