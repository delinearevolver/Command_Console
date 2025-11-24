import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore';
import { db, useAuth, useData } from '../App';
import { Card, Input, Button, Select, TextArea } from './ui';
import { buildInvoicePdf, buildEmailDraftBlob } from '../utils/invoiceEmail';

const randomId = () => {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (error) {
        return Math.random().toString(36).slice(2);
    }
    return Math.random().toString(36).slice(2);
};

const normalizeSku = (value = '') => String(value || '').trim().toUpperCase();

const asNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const parseQuantityFromDuration = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const match = String(value).match(/[\d.,]+/);
    if (!match) return null;
    const numeric = Number.parseFloat(match[0].replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
};

const formatCurrency = (value, currency = 'GBP') => {
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value || 0);
    } catch (error) {
        return (value || 0).toFixed(2);
    }
};

const INVOICE_STATUS = Object.freeze({
    DRAFT: 'Draft',
    SENT: 'Sent',
    PARTIALLY_PAID: 'Partially Paid',
    PAID: 'Paid',
    OVERDUE: 'Overdue',
    VOID: 'Void',
});

const getStatusDisplay = (rawStatus = '') => {
    const normalized = String(rawStatus || '').toLowerCase();
    switch (normalized) {
        case 'sent':
            return INVOICE_STATUS.SENT;
        case 'partially paid':
        case 'partially_paid':
            return INVOICE_STATUS.PARTIALLY_PAID;
        case 'paid':
            return INVOICE_STATUS.PAID;
        case 'overdue':
            return INVOICE_STATUS.OVERDUE;
        case 'void':
            return INVOICE_STATUS.VOID;
        case 'draft':
        default:
            return INVOICE_STATUS.DRAFT;
    }
};

function StatusBadge({ status }) {
    const resolvedStatus = getStatusDisplay(status);
    const config = {
        [INVOICE_STATUS.DRAFT]: { icon: "\u{1F4DD}", classes: 'bg-gray-800 text-gray-200 border border-gray-600' },
        [INVOICE_STATUS.SENT]: { icon: "\u2705", classes: 'bg-blue-900/60 text-blue-200 border border-blue-500/60' },
        [INVOICE_STATUS.PARTIALLY_PAID]: { icon: "\u{1F4B5}", classes: 'bg-amber-900/60 text-amber-200 border border-amber-500/60' },
        [INVOICE_STATUS.PAID]: { icon: "\u{1F4B5}", classes: 'bg-green-900/60 text-green-200 border border-green-500/60' },
        [INVOICE_STATUS.OVERDUE]: { icon: "\u26A0\uFE0F", classes: 'bg-red-900/70 text-red-200 border border-red-500/60' },
        [INVOICE_STATUS.VOID]: { icon: "\u26D4", classes: 'bg-gray-900 text-gray-400 border border-gray-600 line-through decoration-red-500/70' },
    }[resolvedStatus] || { icon: "\u{1F4DD}", classes: 'bg-gray-800 text-gray-200 border border-gray-600' };

    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${config.classes}`}>
            <span>{config.icon}</span>
            <span>{resolvedStatus}</span>
        </span>
    );
}

function SendInvoiceModal({ open, invoice, customerName, onDownloadDraft, onMarkSent, onCancel, markDisabled }) {
    if (!open || !invoice) return null;
    const amount = formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP');
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
            <div className="w-full max-w-lg space-y-4 rounded border border-red-700 bg-gray-950 p-6 shadow-xl">
                <h3 className="text-lg font-semibold text-red-300">Send Invoice</h3>
                <p className="text-sm text-gray-300">
                    You are about to send <span className="font-semibold">{invoice.reference || invoice.id}</span> to{' '}
                    <span className="font-semibold">{customerName || 'Customer'}</span>.
                </p>
                <div className="space-y-2 rounded border border-red-900/60 bg-gray-900/60 p-3 text-sm text-gray-200">
                    <div className="flex justify-between">
                        <span>Invoice reference</span>
                        <span className="font-semibold">{invoice.reference || invoice.id}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Total amount</span>
                        <span className="font-semibold">{amount}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Issue date</span>
                        <span>{invoice.issueDate || 'N/A'}</span>
                    </div>
                </div>
                <div className="space-y-2 text-sm text-gray-300">
                    <p className="text-yellow-300">
                        Sending marks this invoice as immutable. You will not be able to edit line items once it is sent.
                    </p>
                    <p>
                        We will download an email draft file (.eml) that includes the PDF attachment. Open the file in your mail
                        client to review, send, or discard the email. After sending the email, return here and mark the invoice as sent.
                    </p>
                </div>
                <div className="flex justify-end gap-3">
                    <Button type="button" className="w-auto bg-gray-800 hover:bg-gray-700" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="button" className="w-auto bg-blue-700 hover:bg-blue-600" onClick={onDownloadDraft}>
                        Download Email Draft
                    </Button>
                    <Button type="button" className="w-auto bg-green-700 hover:bg-green-600 disabled:bg-green-900/60 disabled:cursor-not-allowed" onClick={onMarkSent} disabled={markDisabled}>
                        Mark as Sent
                    </Button>
                </div>
            </div>
        </div>
    );
}

function ViewInvoiceModal({ invoice, customerName, onClose }) {
    if (!invoice) return null;
    const amount = formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP');
    const status = getStatusDisplay(invoice.status);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
            <div className="w-full max-w-2xl space-y-4 rounded border border-red-700 bg-gray-950 p-6 shadow-xl">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-red-300">Invoice Details</h3>
                    <StatusBadge status={status} />
                </div>
                <div className="grid gap-3 rounded border border-red-900/60 bg-gray-900/60 p-4 text-sm text-gray-200">
                    <div className="flex justify-between">
                        <span>Reference</span>
                        <span className="font-semibold">{invoice.reference || invoice.id}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Customer</span>
                        <span className="font-semibold">{customerName || 'Customer'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Issue Date</span>
                        <span>{invoice.issueDate || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Due Date</span>
                        <span>{invoice.dueDate || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Total Amount</span>
                        <span className="font-semibold">{amount}</span>
                    </div>
                </div>
                <div className="space-y-2 text-sm text-gray-200">
                    <h4 className="text-sm font-semibold text-red-200">Line Items</h4>
                    <div className="space-y-2 rounded border border-red-900/60 bg-gray-900/60 p-3">
                        {(invoice.lines || []).map((line, index) => (
                            <div key={line.id || index} className="flex justify-between text-xs text-gray-300">
                                <span>{line.description || line.sku || 'Line item'}</span>
                                <span>{formatCurrency(asNumber(line.quantity) * asNumber(line.unitPrice), invoice.currency || 'GBP')}</span>
                            </div>
                        ))}
                        {(invoice.lines || []).length === 0 && <p className="text-xs text-gray-400">No line items recorded.</p>}
                    </div>
                </div>
                <div className="space-y-2 text-sm text-gray-200">
                    <h4 className="text-sm font-semibold text-red-200">Customer details</h4>
                    <div className="space-y-1 rounded border border-red-900/60 bg-gray-900/60 p-3 text-xs text-gray-300">
                        <div className="flex justify-between gap-3">
                            <span>Contact name</span>
                            <span className="font-medium text-gray-100">{(invoice.customerName || '').trim() || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span>Contact email</span>
                            <span className="font-medium text-gray-100">{(invoice.customerEmail || '').trim() || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span>Contact phone</span>
                            <span className="font-medium text-gray-100">{(invoice.customerPhone || '').trim() || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span>Customer reference</span>
                            <span className="font-medium text-gray-100">{(invoice.customerReference || '').trim() || '-'}</span>
                        </div>
                        <div>
                            <span className="block text-gray-400">Billing address / notes</span>
                            <span className="mt-1 block whitespace-pre-line text-gray-100">{(invoice.customerAddress || '').trim() || '-'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="button" className="w-auto bg-gray-800 hover:bg-gray-700" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}

const formatInvoiceLineDescription = (service = {}, quantity = 0, unitPrice = 0, currency = 'GBP') => {
    const pricingType = String(service.pricingType || '').toLowerCase();
    const name = service.name || service.description || '';
    const fallback = service.description || service.name || '';
    if (pricingType === 'hourly' || pricingType === 'daily') {
        const unitLabel = pricingType === 'hourly' ? 'hour' : 'day';
        const shortLabel = pricingType === 'hourly' ? 'hr' : 'day';
        const qtyNumber = Number(quantity);
        const hasQuantity = Number.isFinite(qtyNumber) && qtyNumber > 0;
        const quantityLabel = hasQuantity ? `${qtyNumber} ${unitLabel}${qtyNumber === 1 ? '' : 's'}` : '';
        const ratePart = `${formatCurrency(unitPrice, currency)}/${shortLabel}`;
        if (quantityLabel) {
            return `${name} (${quantityLabel} @ ${ratePart})`;
        }
        return `${name} (@ ${ratePart})`;
    }
    return name || fallback || '';
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

const DEFAULT_SELLER = Object.freeze({
    companyName: 'CMQUO LTD',
    companyId: '08636231',
    vatId: 'Not Registered',
    lei: 'Not Registered',
    addressStreet: '9 Chatsworth Court, Bawtry Road',
    addressCity: 'Doncaster',
    addressPostal: 'DN4 7AT',
    addressCountry: 'GB',
    contactEmail: 'accounts@cmquo.co.uk',
    contactPhone: '+44 7733 330865',
});

const DEFAULT_PAYMENT = Object.freeze({
    accountName: 'CMQUO LTD',
    bankName: 'Tide',
    bankAddress: '4th Floor, The Featherstone Building, 66 City Road, London EC1Y 2AL',
    sortCode: '04-06-05',
    accountNumber: '28497341',
    iban: 'GB82WEST12345698765432',
    bic: 'NWBKGB2L',
    paymentTerms: 'NET 15',
    paymentReference: '',
    endToEndId: '',
});

const getCustomerCompanyNumber = (customer) => {
    if (!customer) return '';
    const candidates = [
        customer.companyId,
        customer.companyNumber,
        customer.companyNo,
        customer.companyRegistrationNumber,
        customer.registrationNumber,
        customer.registeredNumber,
        customer.companiesHouseNumber,
        customer.companies_house_number,
        customer.chNumber,
    ];
    for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue;
        if (typeof candidate === 'number') return String(candidate);
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed) return trimmed;
        }
    }
    return '';
};

const PAYMENT_TERM_OPTIONS = Object.freeze([
    { label: 'NET 15', value: 'NET 15', days: 15 },
    { label: 'NET 30', value: 'NET 30', days: 30 },
    { label: 'NET 90', value: 'NET 90', days: 90 },
]);

const getPaymentTermDays = (terms) => {
    if (!terms) return null;
    const normalized = String(terms).trim().toUpperCase();
    if (!normalized) return null;
    const direct = PAYMENT_TERM_OPTIONS.find(option => option.value === normalized);
    if (direct) return direct.days;
    const match = normalized.match(/NET\s*(\d+)/);
    if (match) {
        const parsed = Number.parseInt(match[1], 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const numeric = Number.parseInt(normalized, 10);
    return Number.isFinite(numeric) ? numeric : null;
};

const toInvoiceLine = (item = {}, invoiceDate = todayISO(), currency = 'GBP') => {
    const pricingTypeRaw = String(item.pricingType || '').toLowerCase();
    const recognizedPricingType = ['hourly', 'daily'].includes(pricingTypeRaw) ? pricingTypeRaw : (pricingTypeRaw === 'fixed' ? 'fixed' : '');
    const quantityFromDuration = parseQuantityFromDuration(item.estimatedDuration);
    const baseQuantity = asNumber(item.quantity ?? item.defaultQuantity, 1) || 1;
    const quantity = (['hourly', 'daily'].includes(recognizedPricingType) && Number.isFinite(quantityFromDuration) && quantityFromDuration > 0)
        ? quantityFromDuration
        : baseQuantity;
    const keepDescription = item.keepDescription === true;
    const baseDescription = item.description || item.name || '';
    return {
        tempId: randomId(),
        id: item.id || null,
        sku: normalizeSku(item.sku),
        description: (recognizedPricingType && (!keepDescription || !baseDescription))
            ? formatInvoiceLineDescription({
                name: item.name,
                description: baseDescription,
                pricingType: recognizedPricingType,
            }, quantity, asNumber(item.unitPrice), currency)
            : baseDescription,
        optionCode: item.optionCode || '',
        catalogueItemId: item.catalogueItemId || item.catalogueId || '',
        quantity,
        unitPrice: asNumber(item.unitPrice),
        taxRate: asNumber(item.taxRate),
        lineDate: item.lineDate || invoiceDate,
        isoWeek: item.isoWeek || getISOWeek(item.lineDate || invoiceDate),
        pricingType: recognizedPricingType,
        serviceId: item.serviceId || null,
        unitCode: item.unitCode || (recognizedPricingType === 'hourly' ? 'HUR' : recognizedPricingType === 'daily' ? 'DAY' : 'EA'),
    };
};

const blankInvoiceLine = (invoiceDate = todayISO(), currency = 'GBP') => toInvoiceLine({
    description: '',
    quantity: 1,
    unitPrice: 0,
    taxRate: 0,
    pricingType: '',
    serviceId: null,
    unitCode: 'EA',
}, invoiceDate, currency);

const createInitialInvoiceDraft = () => {
    const issueDate = todayISO();
    const currency = 'GBP';
    const defaultTerms = DEFAULT_PAYMENT.paymentTerms;
    return {
        reference: '',
        buyerReference: '',
        kind: 'invoice',
        issueDate,
        dueDate: computeDueDateFromTerms(issueDate, defaultTerms),
        currency,
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        customerAddress: '',
        customerReference: '',
        seller: { ...DEFAULT_SELLER },
        payment: { ...DEFAULT_PAYMENT },
        buyerIdentifiers: {
            companyId: '',
            vatId: '',
            lei: '',
        },
        notes: '',
        lineItems: [blankInvoiceLine(issueDate, currency)],
    };
};

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
    const serviceId = rest.serviceId ? String(rest.serviceId).trim() : '';
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
        pricingType: String(rest.pricingType || '').trim(),
        serviceId: serviceId || null,
        unitCode: String(rest.unitCode || '').trim() || 'EA',
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

const addDays = (days = 0, baseDate) => {
    const value = Number(days);
    if (!Number.isFinite(value)) return '';
    const base = baseDate
        ? new Date(`${baseDate}T00:00:00Z`)
        : new Date();
    if (Number.isNaN(base.getTime())) return '';
    if (baseDate) {
        base.setUTCDate(base.getUTCDate() + value);
    } else {
        base.setDate(base.getDate() + value);
    }
    return base.toISOString().slice(0, 10);
};

const computeDueDateFromTerms = (issueDate, paymentTerms, fallback = '') => {
    if (!issueDate) return fallback || '';
    const days = getPaymentTermDays(paymentTerms);
    if (typeof days === 'number' && Number.isFinite(days)) {
        return addDays(days, issueDate);
    }
    return fallback || '';
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
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return '';
    const date = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

const BillingConsole = () => {
    const { user } = useAuth();
    const {
        customers = [],
        priceBooks = [],
        invoices = [],
        invoiceTemplates = [],
        catalogueItems = [],
        products = [],
        services = [],
        servicePriceBooks = [],
        productPriceBooks = [],
        loading
    } = useData();

    // STATE HOOKS
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
    const [invoiceDraft, setInvoiceDraft] = useState(() => createInitialInvoiceDraft());
    const [invoiceMode, setInvoiceMode] = useState('new');
    const [editingInvoiceId, setEditingInvoiceId] = useState(null);
    const [invoiceLinesTouched, setInvoiceLinesTouched] = useState(false);
    const [invoiceDateInput, setInvoiceDateInput] = useState(invoiceDraft.issueDate);
    const [invoiceDateError, setInvoiceDateError] = useState('');
    const [templateMeta, setTemplateMeta] = useState({ name: '', cadence: 'monthly', dueInDays: '30' });
    const [masterMessage, setMasterMessage] = useState(null);
    const [customerMessage, setCustomerMessage] = useState(null);
    const [invoiceMessage, setInvoiceMessage] = useState(null);
    const [templateMessage, setTemplateMessage] = useState(null);
    const [sendModalOpen, setSendModalOpen] = useState(false);
    const [sendModalInvoiceId, setSendModalInvoiceId] = useState(null);
    const [viewModalInvoiceId, setViewModalInvoiceId] = useState(null);
    const [sendModalDraftReady, setSendModalDraftReady] = useState(false);
    const [skuLookupQuery, setSkuLookupQuery] = useState('');
    const lastCustomerRef = useRef('');

    // MEMOIZED VALUES
    const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId) || null, [customers, selectedCustomerId]);
    const masterPriceBook = useMemo(() => priceBooks.find(pb => pb.isMaster) || null, [priceBooks]);
    const assignedPriceBook = useMemo(() => {
        if (!selectedCustomer) return null;
        return priceBooks.find(pb => pb.id === selectedCustomer.priceBookId) || null;
    }, [priceBooks, selectedCustomer]);
    const activePriceBook = useMemo(() => assignedPriceBook || masterPriceBook, [assignedPriceBook, masterPriceBook]);
    const masterProductPriceBook = useMemo(() => productPriceBooks.find(pb => pb.isMaster) || null, [productPriceBooks]);
    const assignedProductPriceBook = useMemo(() => {
        if (!selectedCustomer) return null;
        if (selectedCustomer.priceBookId) {
            const byId = productPriceBooks.find(pb => pb.id === selectedCustomer.priceBookId);
            if (byId) return byId;
        }
        return productPriceBooks.find(pb => pb.customerId === selectedCustomer.id) || null;
    }, [productPriceBooks, selectedCustomer]);
    const activeProductPriceBook = useMemo(() => assignedProductPriceBook || masterProductPriceBook || activePriceBook, [assignedProductPriceBook, masterProductPriceBook, activePriceBook]);
    const activeProductPriceBookBySku = useMemo(() => {
        const map = new Map();
        ((activeProductPriceBook?.items) || []).forEach(item => {
            if (!item) return;
            const key = normalizeSku(item.sku);
            if (key) map.set(key, item);
        });
        return map;
    }, [activeProductPriceBook]);
    const masterServicePriceBook = useMemo(() =>
        servicePriceBooks.find(pb => pb.isMaster) || null,
        [servicePriceBooks]
    );
    const assignedServicePriceBook = useMemo(() => {
        if (!selectedCustomer) return null;
        if (selectedCustomer.servicePriceBookId) {
            return servicePriceBooks.find(pb => pb.id === selectedCustomer.servicePriceBookId) || null;
        }
        return servicePriceBooks.find(pb => pb.customerId === selectedCustomer.id) || null;
    }, [servicePriceBooks, selectedCustomer]);
    const activeServicePriceBook = useMemo(() => assignedServicePriceBook || masterServicePriceBook, [assignedServicePriceBook, masterServicePriceBook]);
    const activeServicePriceBookBySku = useMemo(() => {
        const map = new Map();
        ((activeServicePriceBook?.items) || []).forEach(item => {
            if (!item) return;
            const key = normalizeSku(item.sku);
            if (key) map.set(key, item);
        });
        return map;
    }, [activeServicePriceBook]);
    const servicesBySku = useMemo(() => {
        const map = new Map();
        (services || []).forEach(service => {
            if (!service) return;
            const key = normalizeSku(service.sku);
            if (key) map.set(key, service);
        });
        return map;
    }, [services]);
    const servicesById = useMemo(() => {
        const map = new Map();
        (services || []).forEach(service => {
            if (!service?.id) return;
            map.set(service.id, service);
        });
        return map;
    }, [services]);
    const catalogueBySku = useMemo(() => {
        const map = new Map();
        (catalogueItems || []).forEach(item => {
            if (!item) return;
            const key = normalizeSku(item.sku);
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
    const productsBySku = useMemo(() => {
        const map = new Map();
        (products || []).forEach(product => {
            if (!product) return;
            const key = normalizeSku(product.sku);
            if (key) map.set(key, product);
        });
        return map;
    }, [products]);
    const skuLookupItems = useMemo(() => {
        const seen = new Set();
        const results = [];
        const addItem = (item = {}, source = '') => {
            const sku = normalizeSku(item.sku);
            if (!sku || seen.has(sku)) return;
            seen.add(sku);
            results.push({
                sku,
                name: item.name || item.description || 'Unnamed',
                description: item.description || '',
                source,
                payload: item,
            });
        };
        (activeProductPriceBook?.items || []).forEach(item => addItem(item, 'Price book'));
        (catalogueItems || []).forEach(item => addItem(item, 'Catalogue'));
        (products || []).forEach(item => addItem(item, 'Products'));
        (activeServicePriceBook?.items || []).forEach(item => addItem(item, 'Service book'));
        const query = skuLookupQuery.trim().toLowerCase();
        const filtered = query
            ? results.filter(item =>
                item.sku.toLowerCase().includes(query) ||
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query)
            )
            : results;
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        const limit = 50;
        const sliced = filtered.slice(0, limit);
        return {
            items: sliced,
            total: filtered.length,
            limited: filtered.length > limit,
        };
    }, [activeProductPriceBook?.items, catalogueItems, products, activeServicePriceBook?.items, skuLookupQuery]);
    const draftInvoices = useMemo(() => {
        const list = (invoices || []).filter(invoice => getStatusDisplay(invoice.status) === INVOICE_STATUS.DRAFT);
        list.sort((a, b) => {
            const aTime = a.lastModifiedAt?.seconds ?? a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0;
            const bTime = b.lastModifiedAt?.seconds ?? b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0;
            return bTime - aTime;
        });
        return list;
    }, [invoices]);
    const recentInvoices = useMemo(() => {
        const sorted = [...(invoices || [])];
        sorted.sort((a, b) => {
            const aStatus = getStatusDisplay(a.status);
            const bStatus = getStatusDisplay(b.status);
            const aIsDraft = aStatus === INVOICE_STATUS.DRAFT ? 1 : 0;
            const bIsDraft = bStatus === INVOICE_STATUS.DRAFT ? 1 : 0;
            if (aIsDraft !== bIsDraft) {
                return bIsDraft - aIsDraft;
            }
            const getTime = (invoice) => invoice.lastModifiedAt?.seconds
                ?? invoice.updatedAt?.seconds
                ?? invoice.createdAt?.seconds
                ?? (invoice.createdAt ? new Date(invoice.createdAt).getTime() / 1000 : 0);
            const aTime = getTime(a);
            const bTime = getTime(b);
            return bTime - aTime;
        });
        return sorted.slice(0, 5);
    }, [invoices]);
    const isCreditDocument = useMemo(() => invoiceDraft.kind === 'credit', [invoiceDraft.kind]);
    const invoicePreviewTotals = useMemo(() => {
        const totals = calculateTotals(invoiceDraft.lineItems);
        if (!isCreditDocument) return totals;
        return {
            net: -totals.net,
            tax: -totals.tax,
            gross: -totals.gross,
        };
    }, [invoiceDraft.lineItems, isCreditDocument]);
    const viewTabs = useMemo(() => [
        { id: 'invoices', label: 'Current Invoice & Credit' },
        { id: 'priceLists', label: 'Customer Price Lists' },
        { id: 'history', label: 'Historic Invoices & Accounts' },
    ], []);
    const customerNameById = useMemo(() => {
        const map = new Map();
        (customers || []).forEach(customer => {
            if (!customer?.id) return;
            map.set(customer.id, customer.name || 'Customer');
        });
        return map;
    }, [customers]);
    const customersById = useMemo(() => {
        const map = new Map();
        (customers || []).forEach(customer => {
            if (!customer?.id) return;
            map.set(customer.id, customer);
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
    const editingDraftInvoice = useMemo(() => {
        if (invoiceMode !== 'edit' || !editingInvoiceId) return null;
        return (invoices || []).find(invoice => invoice.id === editingInvoiceId) || null;
    }, [invoiceMode, editingInvoiceId, invoices]);
    const invoiceForSendModal = useMemo(() => {
        if (!sendModalOpen || !sendModalInvoiceId) return null;
        return (invoices || []).find(invoice => invoice.id === sendModalInvoiceId) || null;
    }, [sendModalOpen, sendModalInvoiceId, invoices]);
    const invoiceForViewModal = useMemo(() => {
        if (!viewModalInvoiceId) return null;
        return (invoices || []).find(invoice => invoice.id === viewModalInvoiceId) || null;
    }, [viewModalInvoiceId, invoices]);


    // HELPER FUNCTIONS & CALLBACKS
    const matchCatalogueBySku = useCallback((sku = '') => {
        const normalized = normalizeSku(sku);
        if (!normalized) return null;
        return catalogueBySku.get(normalized) || productsBySku.get(normalized) || null;
    }, [catalogueBySku, productsBySku]);

    const catalogueOptionsFor = useCallback((catalogueItemId, fallbackSku) => {
        if (catalogueItemId && catalogueById.has(catalogueItemId)) {
            const found = catalogueById.get(catalogueItemId);
            return Array.isArray(found?.options) ? found.options : [];
        }
        const fromSku = matchCatalogueBySku(fallbackSku);
        if (fromSku) {
            return Array.isArray(fromSku.options) ? fromSku.options : [];
        }
        return [];
    }, [catalogueById, matchCatalogueBySku]);

    const addCatalogueRow = useCallback(() => {
        setCatalogueHasUnsavedChanges(true);
        setCatalogueDraft(prev => [...prev, toCatalogueEditable()]);
    }, []);

    const updateSellerField = useCallback((field, value) => {
        setInvoiceDraft(prev => ({
            ...prev,
            seller: {
                ...(prev.seller || {}),
                [field]: value,
            },
        }));
    }, []);

    const updatePaymentField = useCallback((field, value) => {
        setInvoiceDraft(prev => {
            const nextPayment = {
                ...(prev.payment || {}),
                [field]: value,
            };
            if (field === 'paymentTerms') {
                const fallbackDueDate = value ? prev.dueDate : '';
                const nextDueDate = computeDueDateFromTerms(prev.issueDate, value, fallbackDueDate);
                return {
                    ...prev,
                    payment: nextPayment,
                    dueDate: nextDueDate,
                };
            }
            return {
                ...prev,
                payment: nextPayment,
            };
        });
    }, []);

    const updateBuyerIdentifierField = useCallback((field, value) => {
        setInvoiceDraft(prev => ({
            ...prev,
            buyerIdentifiers: {
                ...(prev.buyerIdentifiers || {}),
                [field]: value,
            },
        }));
    }, []);

    const updateCatalogueRow = useCallback((id, field, value) => {
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
    }, []);

    const removeCatalogueRow = useCallback((id) => {
        setCatalogueHasUnsavedChanges(true);
        setCatalogueDraft(prev => {
            const target = prev.find(item => item.tempId === id);
            if (target?.id) {
                setCatalogueRemovedIds(current => Array.from(new Set([...current, target.id])));
            }
            return prev.filter(item => item.tempId !== id);
        });
    }, []);

    const handleSaveCatalogue = useCallback(async (event) => {
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
    }, [user, catalogueDraft, catalogueRemovedIds]);

    const addMasterRow = useCallback(() => setMasterDraft(prev => {
        setMasterHasUnsavedChanges(true);
        return { ...prev, items: [...prev.items, toEditableItem()] };
    }), []);

    const updateMasterRow = useCallback((id, field, value) => setMasterDraft(prev => {
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
                if (field === 'unitCode') {
                    next.unitCode = String(value || '').trim().toUpperCase();
                }
                return next;
            }),
        };
    }), [matchCatalogueBySku, catalogueById, catalogueOptionsFor]);

    const removeMasterRow = useCallback((id) => setMasterDraft(prev => {
        setMasterHasUnsavedChanges(true);
        return { ...prev, items: prev.items.filter(item => item.tempId !== id) };
    }), []);

    const addCustomerRow = useCallback(() => setCustomerDraft(prev => {
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
    }), [selectedCustomer]);

    const updateCustomerRow = useCallback((id, field, value) => setCustomerDraft(prev => {
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
    }), [matchCatalogueBySku, catalogueById, catalogueOptionsFor]);

    const removeCustomerRow = useCallback((id) => setCustomerDraft(prev => {
        if (!prev || !prev.isCustom) return prev;
        setCustomerHasUnsavedChanges(true);
        return { ...prev, items: prev.items.filter(item => item.tempId !== id) };
    }), []);

    const addInvoiceLineRow = useCallback(() => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return {
            ...prev,
            lineItems: [
                ...prev.lineItems,
                blankInvoiceLine(prev.issueDate || todayISO(), prev.currency || 'GBP')
            ]
        };
    }), []);

    const updateInvoiceLine = useCallback((id, field, value) => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return {
            ...prev,
            lineItems: prev.lineItems.map(line => {
                if (line.tempId !== id) return line;
                const updated = { ...line, [field]: value };
                if (field === 'sku') {
                    const normalizedSku = normalizeSku(value);
                    updated.sku = normalizedSku;
                    const servicePriceItem = activeServicePriceBookBySku.get(normalizedSku);
                    const serviceFromId = servicePriceItem?.serviceId ? servicesById.get(servicePriceItem.serviceId) : null;
                    const serviceFromSku = servicesBySku.get(normalizedSku);
                    if (servicePriceItem || serviceFromId || serviceFromSku) {
                        const resolvedServiceId = servicePriceItem?.serviceId || serviceFromId?.id || serviceFromSku?.id || null;
                        const effectiveService = {
                            ...(serviceFromId || {}),
                            ...(serviceFromSku || {}),
                            ...(servicePriceItem || {}),
                        };
                        const pricingTypeRaw = String(effectiveService.pricingType || '').toLowerCase();
                        const pricingType = ['hourly', 'daily'].includes(pricingTypeRaw)
                            ? pricingTypeRaw
                            : (pricingTypeRaw === 'fixed' ? 'fixed' : '');
                        const durationValue = parseQuantityFromDuration(servicePriceItem?.estimatedDuration ?? effectiveService.estimatedDuration);
                        let quantity = asNumber(servicePriceItem?.defaultQuantity ?? effectiveService.defaultQuantity, 1) || 1;
                        if (Number.isFinite(durationValue) && durationValue > 0) {
                            quantity = durationValue;
                        }
                        const unitPrice = asNumber(servicePriceItem?.unitPrice ?? effectiveService.unitPrice);
                        const taxRate = asNumber(servicePriceItem?.taxRate ?? effectiveService.taxRate);
                        const currency = prev.currency || 'GBP';
                        updated.catalogueItemId = '';
                        updated.optionCode = '';
                        updated.serviceId = resolvedServiceId;
                        updated.pricingType = pricingType;
                        updated.unitPrice = unitPrice;
                        updated.taxRate = taxRate;
                        updated.quantity = quantity;
                        const derivedUnit = pricingType === 'hourly'
                            ? 'HUR'
                            : (pricingType === 'daily' ? 'DAY' : (servicePriceItem?.unitCode || serviceFromId?.unitCode || serviceFromSku?.unitCode || updated.unitCode || 'EA'));
                        updated.unitCode = String(derivedUnit || 'EA').toUpperCase();
                        updated.description = pricingType
                            ? formatInvoiceLineDescription({
                                name: effectiveService.name,
                                description: effectiveService.description,
                                pricingType,
                            }, quantity, unitPrice, currency)
                            : (effectiveService.description || effectiveService.name || updated.description || '');
                        return updated;
                    }
                    const matchFromPriceBook = activeProductPriceBookBySku.get(normalizedSku);
                    const matchFromCatalogue = matchCatalogueBySku(value);
                    if (matchFromPriceBook) {
                        updated.catalogueItemId = matchFromPriceBook.catalogueItemId || '';
                        updated.description = matchFromPriceBook.description || matchFromPriceBook.name || '';
                        updated.unitPrice = asNumber(matchFromPriceBook.unitPrice);
                        updated.taxRate = asNumber(matchFromPriceBook.taxRate);
                        updated.quantity = asNumber(matchFromPriceBook.defaultQuantity, 1) || updated.quantity;
                        updated.optionCode = matchFromPriceBook.optionCode || '';
                        updated.unitCode = String(matchFromPriceBook.unitCode || updated.unitCode || 'EA').toUpperCase();
                        updated.sku = normalizeSku(matchFromPriceBook.sku || value);
                        updated.serviceId = null;
                        updated.pricingType = '';
                    } else if (matchFromCatalogue) {
                        updated.catalogueItemId = matchFromCatalogue.id || '';
                        updated.description = matchFromCatalogue.description || matchFromCatalogue.name || '';
                        updated.unitPrice = asNumber(matchFromCatalogue.unitPrice);
                        updated.taxRate = asNumber(matchFromCatalogue.taxRate);
                        updated.quantity = asNumber(matchFromCatalogue.defaultQuantity, 1) || updated.quantity;
                        const options = Array.isArray(matchFromCatalogue.options) ? matchFromCatalogue.options : [];
                        updated.optionCode = options.length ? options[0] : '';
                        updated.unitCode = String(matchFromCatalogue.unitCode || updated.unitCode || 'EA').toUpperCase();
                        updated.sku = normalizeSku(matchFromCatalogue.sku || value);
                        updated.serviceId = null;
                        updated.pricingType = '';
                    } else {
                        updated.catalogueItemId = '';
                        updated.optionCode = '';
                        updated.sku = normalizedSku;
                        updated.serviceId = null;
                        updated.pricingType = '';
                        updated.unitCode = String(updated.unitCode || 'EA').toUpperCase();
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
    }), [activeServicePriceBookBySku, servicesById, servicesBySku, activeProductPriceBookBySku, matchCatalogueBySku, catalogueOptionsFor]);

    const addInvoiceLineFromSku = useCallback((sku, payload) => {
        const normalizedSku = normalizeSku(sku);
        if (!normalizedSku) return;
        setInvoiceLinesTouched(true);
        setInvoiceDraft(prev => {
            const currency = prev.currency || 'GBP';
            const issueDate = prev.issueDate || todayISO();
            let newLine = { ...blankInvoiceLine(issueDate, currency), sku: normalizedSku };
            const servicePriceItem = activeServicePriceBookBySku.get(normalizedSku);
            const serviceFromId = servicePriceItem?.serviceId ? servicesById.get(servicePriceItem.serviceId) : null;
            const serviceFromSku = servicesBySku.get(normalizedSku);
            if (servicePriceItem || serviceFromId || serviceFromSku) {
                const resolvedServiceId = servicePriceItem?.serviceId || serviceFromId?.id || serviceFromSku?.id || null;
                const effectiveService = {
                    ...(serviceFromId || {}),
                    ...(serviceFromSku || {}),
                    ...(servicePriceItem || {}),
                };
                const pricingTypeRaw = String(effectiveService.pricingType || '').toLowerCase();
                const pricingType = ['hourly', 'daily'].includes(pricingTypeRaw)
                    ? pricingTypeRaw
                    : (pricingTypeRaw === 'fixed' ? 'fixed' : '');
                const durationValue = parseQuantityFromDuration(servicePriceItem?.estimatedDuration ?? effectiveService.estimatedDuration);
                let quantity = asNumber(servicePriceItem?.defaultQuantity ?? effectiveService.defaultQuantity, 1) || 1;
                if (Number.isFinite(durationValue) && durationValue > 0) {
                    quantity = durationValue;
                }
                const unitPrice = asNumber(servicePriceItem?.unitPrice ?? effectiveService.unitPrice);
                const taxRate = asNumber(servicePriceItem?.taxRate ?? effectiveService.taxRate);
                newLine = {
                    ...newLine,
                    catalogueItemId: '',
                    optionCode: '',
                    serviceId: resolvedServiceId,
                    pricingType,
                    unitPrice,
                    taxRate,
                    quantity,
                    unitCode: String(pricingType === 'hourly'
                        ? 'HUR'
                        : (pricingType === 'daily' ? 'DAY' : servicePriceItem?.unitCode || effectiveService.unitCode || 'EA')).toUpperCase(),
                    description: pricingType
                        ? formatInvoiceLineDescription({
                            name: effectiveService.name,
                            description: effectiveService.description,
                            pricingType,
                        }, quantity, unitPrice, currency)
                        : (effectiveService.description || effectiveService.name || newLine.description || ''),
                };
            } else {
                const matchFromPriceBook = activeProductPriceBookBySku.get(normalizedSku);
                const matchFromCatalogue = matchCatalogueBySku(normalizedSku);
                if (matchFromPriceBook) {
                    const options = Array.isArray(matchFromPriceBook.options) ? matchFromPriceBook.options : [];
                    newLine = {
                        ...newLine,
                        catalogueItemId: matchFromPriceBook.catalogueItemId || '',
                        description: matchFromPriceBook.description || matchFromPriceBook.name || '',
                        unitPrice: asNumber(matchFromPriceBook.unitPrice),
                        taxRate: asNumber(matchFromPriceBook.taxRate),
                        quantity: asNumber(matchFromPriceBook.defaultQuantity, 1) || newLine.quantity,
                        optionCode: matchFromPriceBook.optionCode || (options.length ? options[0] : ''),
                        unitCode: String(matchFromPriceBook.unitCode || newLine.unitCode || 'EA').toUpperCase(),
                        pricingType: '',
                        serviceId: null,
                    };
                } else if (matchFromCatalogue) {
                    const options = Array.isArray(matchFromCatalogue.options) ? matchFromCatalogue.options : [];
                    newLine = {
                        ...newLine,
                        catalogueItemId: matchFromCatalogue.id || '',
                        description: matchFromCatalogue.description || matchFromCatalogue.name || '',
                        unitPrice: asNumber(matchFromCatalogue.unitPrice),
                        taxRate: asNumber(matchFromCatalogue.taxRate),
                        quantity: asNumber(matchFromCatalogue.defaultQuantity, 1) || newLine.quantity,
                        optionCode: options.length ? options[0] : '',
                        unitCode: String(matchFromCatalogue.unitCode || newLine.unitCode || 'EA').toUpperCase(),
                        pricingType: '',
                        serviceId: null,
                    };
                } else if (payload) {
                    newLine = {
                        ...newLine,
                        description: payload.description || payload.name || newLine.description,
                        unitPrice: asNumber(payload.unitPrice, newLine.unitPrice),
                        taxRate: asNumber(payload.taxRate, newLine.taxRate),
                        quantity: asNumber(payload.defaultQuantity, newLine.quantity),
                        optionCode: payload.optionCode || '',
                        unitCode: String(payload.unitCode || payload.uom || newLine.unitCode || 'EA').toUpperCase(),
                        pricingType: '',
                        serviceId: null,
                    };
                } else {
                    newLine.unitCode = String(newLine.unitCode || 'EA').toUpperCase();
                }
            }
            return {
                ...prev,
                lineItems: [...prev.lineItems, newLine],
            };
        });
    }, [activeServicePriceBookBySku, servicesById, servicesBySku, activeProductPriceBookBySku, matchCatalogueBySku]);

    const composeInvoiceEmail = useCallback(async (invoice) => {
        if (!invoice) return false;
        try {
            const customer = customersById.get(invoice.customerId || '') || {};
            const lines = Array.isArray(invoice.lines) && invoice.lines.length
                ? invoice.lines
                : Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
            const pdf = await buildInvoicePdf({
                invoice: { ...invoice, lines },
                organization: {
                    name: user?.companyName || user?.orgName || 'Billing Console',
                    email: user?.email,
                },
                customer: {
                    name: invoice.customerName || customer.name,
                    email: invoice.customerEmail || customer.email,
                    phone: invoice.customerPhone || customer.phone,
                    address: invoice.customerAddress || customer.billingAddress,
                },
            });
            const emailTo = invoice.customerEmail || customer.email || '';
            const subjectBase = invoice.reference || invoice.invoiceId || invoice.id || 'Invoice';
            const payment = invoice.payment || {};
            const subjectReference = (invoice.reference && invoice.reference.trim())
                || (payment.paymentReference && payment.paymentReference.trim())
                || subjectBase;
            const remittanceReference = (payment.paymentReference && payment.paymentReference.trim()) || subjectReference;
            const subjectRecipient = invoice.customerName || customer.name || '';
            const emailSubject = subjectRecipient
                ? `Invoice ${subjectReference} - ${subjectRecipient}`
                : `Invoice ${subjectReference}`;
            const messageLines = [
                `Hi ${invoice.customerName || customer.name || 'there'},`,
                '',
                `Please find attached invoice ${subjectReference}.`,
                `Total due: ${formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP')}.`,
                payment.paymentTerms ? `Payment terms: ${payment.paymentTerms}` : null,
                `Please use reference ${remittanceReference} when making payment.`,
                payment.accountName ? `Account name: ${payment.accountName}` : null,
                payment.sortCode && payment.accountNumber ? `Sort code: ${payment.sortCode} - Account number: ${payment.accountNumber}` : null,
                '',
                'Kind regards,',
                user?.displayName || user?.name || user?.email || 'Accounts Team',
            ].filter(Boolean);
            const emlBlob = buildEmailDraftBlob({
                from: user?.email || 'billing@command-console.local',
                to: emailTo,
                subject: emailSubject.trim(),
                body: messageLines.join('\n'),
                attachment: {
                    base64: pdf.base64,
                    filename: pdf.filename,
                },
            });
            const url = URL.createObjectURL(emlBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${pdf.filename.replace(/\.pdf$/i, '') || 'invoice'}.eml`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 500);
            setInvoiceMessage({
                type: 'success',
                message: 'Email draft downloaded. Open it in your mail client to review and send.',
            });
            return true;
        } catch (error) {
            console.error('Failed to compose invoice email', error);
            setInvoiceMessage({ type: 'error', message: 'Unable to prepare email draft.' });
            return false;
        }
    }, [customersById, user]);

    const removeInvoiceLine = useCallback((id) => setInvoiceDraft(prev => {
        setInvoiceLinesTouched(true);
        return {
            ...prev,
            lineItems: prev.lineItems.length > 1
                ? prev.lineItems.filter(line => line.tempId !== id)
                : [blankInvoiceLine(prev.issueDate || todayISO(), prev.currency || 'GBP')],
        };
    }), []);

    const resetInvoiceLines = useCallback(() => {
        setInvoiceLinesTouched(false);
        setInvoiceDraft(prev => ({
            ...prev,
            lineItems: [blankInvoiceLine(prev.issueDate || todayISO(), prev.currency || 'GBP')],
        }));
    }, []);

    const loadPriceBookIntoInvoice = useCallback(() => {
        const fallbackDate = normalizeDateInput(invoiceDateInput) || invoiceDraft.issueDate || todayISO();
        const lines = (activePriceBook?.items || []).map(item => toInvoiceLine(item, fallbackDate, invoiceDraft.currency || 'GBP'));
        setInvoiceDraft(prev => {
            const nextIssueDate = prev.issueDate || fallbackDate;
            return {
                ...prev,
                issueDate: nextIssueDate,
                lineItems: lines.length
                    ? lines
                    : [blankInvoiceLine(nextIssueDate, prev.currency || 'GBP')],
            };
        });
        setInvoiceDateInput(fallbackDate);
        setInvoiceLinesTouched(true);
        setInvoiceDateError('');
    }, [invoiceDateInput, invoiceDraft.issueDate, invoiceDraft.currency, activePriceBook]);

    const loadDraftForEditing = useCallback((invoiceId) => {
        if (!invoiceId) {
            setEditingInvoiceId(null);
            return;
        }
        const draft = (invoices || []).find(invoice => invoice.id === invoiceId);
        if (!draft) {
            setInvoiceMessage({ type: 'error', message: 'Draft invoice not found.' });
            return;
        }
        const currency = draft.currency || 'GBP';
        const issueDate = draft.issueDate || todayISO();
        const lines = (draft.lines || []).map(line => {
            const numericQuantity = Number(line.quantity);
            const positiveQuantity = Number.isFinite(numericQuantity) ? Math.abs(numericQuantity) : null;
            return toInvoiceLine({
                ...line,
                id: line.id || null,
                sku: line.sku,
                catalogueItemId: line.catalogueItemId,
                catalogueId: line.catalogueItemId,
                optionCode: line.optionCode,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate,
                quantity: positiveQuantity ?? line.quantity,
                defaultQuantity: positiveQuantity ?? line.quantity,
                name: line.description,
                description: line.description,
                lineDate: line.lineDate,
                isoWeek: line.isoWeek,
                pricingType: line.pricingType,
                serviceId: line.serviceId,
                keepDescription: true,
            }, line.lineDate || issueDate, currency);
        });
        const isCredit = String(draft.documentType || '').toLowerCase() === 'creditnote';
        if (draft.customerId) {
            lastCustomerRef.current = draft.customerId;
            setSelectedCustomerId(draft.customerId);
        } else {
            lastCustomerRef.current = '';
            setSelectedCustomerId('');
        }
        setInvoiceDraft({
            reference: draft.reference || '',
            buyerReference: draft.buyerReference || '',
            kind: isCredit ? 'credit' : 'invoice',
            issueDate,
            dueDate: draft.dueDate || '',
            currency,
            customerName: draft.customerName || '',
            customerEmail: draft.customerEmail || '',
            customerPhone: draft.customerPhone || '',
            customerAddress: draft.customerAddress || '',
            customerReference: draft.customerReference || '',
            seller: {
                companyName: draft.seller?.companyName || DEFAULT_SELLER.companyName,
                companyId: draft.seller?.companyId || DEFAULT_SELLER.companyId,
                vatId: draft.seller?.vatId ?? DEFAULT_SELLER.vatId,
                lei: draft.seller?.lei ?? DEFAULT_SELLER.lei,
                addressStreet: draft.seller?.addressStreet || DEFAULT_SELLER.addressStreet,
                addressCity: draft.seller?.addressCity || DEFAULT_SELLER.addressCity,
                addressPostal: draft.seller?.addressPostal || DEFAULT_SELLER.addressPostal,
                addressCountry: draft.seller?.addressCountry || DEFAULT_SELLER.addressCountry,
                contactEmail: draft.seller?.contactEmail || DEFAULT_SELLER.contactEmail,
                contactPhone: draft.seller?.contactPhone || DEFAULT_SELLER.contactPhone,
            },
            payment: {
                accountName: draft.payment?.accountName || DEFAULT_PAYMENT.accountName,
                bankName: draft.payment?.bankName || DEFAULT_PAYMENT.bankName,
                bankAddress: draft.payment?.bankAddress || DEFAULT_PAYMENT.bankAddress,
                sortCode: draft.payment?.sortCode || DEFAULT_PAYMENT.sortCode,
                accountNumber: draft.payment?.accountNumber || DEFAULT_PAYMENT.accountNumber,
                iban: draft.payment?.iban ?? DEFAULT_PAYMENT.iban,
                bic: draft.payment?.bic ?? DEFAULT_PAYMENT.bic,
                paymentTerms: draft.payment?.paymentTerms || DEFAULT_PAYMENT.paymentTerms,
                paymentReference: draft.payment?.paymentReference || DEFAULT_PAYMENT.paymentReference,
                endToEndId: draft.payment?.endToEndId || DEFAULT_PAYMENT.endToEndId,
            },
            buyerIdentifiers: {
                companyId: draft.buyerIdentifiers?.companyId || '',
                vatId: draft.buyerIdentifiers?.vatId || '',
                lei: draft.buyerIdentifiers?.lei || '',
            },
            notes: draft.notes || '',
            lineItems: lines.length ? lines : [blankInvoiceLine(issueDate, currency)],
        });
        setInvoiceDateInput(issueDate);
        setInvoiceLinesTouched(false);
        setInvoiceDateError('');
        setInvoiceMode('edit');
        setEditingInvoiceId(invoiceId);
        setInvoiceMessage(null);
    }, [invoices]);

    const sendInvoice = useCallback(async (invoiceId) => {
        if (!invoiceId) {
            setInvoiceMessage({ type: 'error', message: 'Select a draft invoice to send.' });
            return false;
        }
        if (!user?.uid) {
            setInvoiceMessage({ type: 'error', message: 'You must be signed in to send invoices.' });
            return false;
        }
        const targetInvoice = (invoices || []).find(invoice => invoice.id === invoiceId);
        if (!targetInvoice) {
            setInvoiceMessage({ type: 'error', message: 'Draft invoice not found.' });
            return false;
        }
        if (getStatusDisplay(targetInvoice.status) !== INVOICE_STATUS.DRAFT) {
            setInvoiceMessage({ type: 'error', message: 'Only draft invoices can be sent.' });
            return false;
        }
        if (!targetInvoice.customerId) {
            setInvoiceMessage({ type: 'error', message: 'Assign a customer before sending the invoice.' });
            return false;
        }
        const sanitizedLines = sanitizeInvoiceLines(targetInvoice.lines || [], targetInvoice.issueDate || todayISO())
            .filter(line => line.description && Number.isFinite(line.quantity) && line.quantity > 0);
        if (!sanitizedLines.length) {
            setInvoiceMessage({ type: 'error', message: 'Add at least one invoice line before sending.' });
            return false;
        }
        const statusEntry = {
            id: randomId(),
            status: INVOICE_STATUS.SENT,
            changedAt: Timestamp.now(),
            changedBy: user.uid,
        };
        try {
            await updateDoc(doc(db, 'invoices', invoiceId), {
                status: INVOICE_STATUS.SENT,
                sentAt: serverTimestamp(),
                sentBy: user.uid,
                statusHistory: arrayUnion(statusEntry),
                updatedAt: serverTimestamp(),
                lastModifiedAt: serverTimestamp(),
                lastModifiedBy: user.uid,
            });
            setInvoiceMessage({ type: 'success', message: 'Invoice sent successfully.' });
            return true;
        } catch (error) {
            console.error('Failed to send invoice', error);
            setInvoiceMessage({ type: 'error', message: 'Unable to send invoice.' });
            return false;
        }
    }, [invoices, user?.uid]);

    const openSendModal = useCallback((invoiceId) => {
        const targetId = invoiceId || editingInvoiceId;
        if (!targetId) return;
        setSendModalInvoiceId(targetId);
        setSendModalOpen(true);
        setSendModalDraftReady(false);
    }, [editingInvoiceId]);

    const closeSendModal = useCallback(() => {
        setSendModalOpen(false);
        setSendModalInvoiceId(null);
        setSendModalDraftReady(false);
    }, []);

    const openViewModal = useCallback((invoiceId) => {
        if (!invoiceId) return;
        setViewModalInvoiceId(invoiceId);
    }, []);

    const closeViewModal = useCallback(() => {
        setViewModalInvoiceId(null);
    }, []);

    const resetInvoiceForm = useCallback(() => {
        const baseDraft = createInitialInvoiceDraft();
        setInvoiceDraft(baseDraft);
        setInvoiceDateInput(baseDraft.issueDate);
        setInvoiceLinesTouched(false);
        setInvoiceDateError('');
        setInvoiceMode('new');
        setEditingInvoiceId(null);
        setSelectedCustomerId('');
        lastCustomerRef.current = '';
        setSendModalOpen(false);
        setSendModalInvoiceId(null);
        setViewModalInvoiceId(null);
    }, []);

    const handleDownloadInvoiceDraft = useCallback(async () => {
        if (!sendModalInvoiceId) return;
        const invoice = (invoices || []).find(item => item.id === sendModalInvoiceId);
        if (!invoice) {
            setInvoiceMessage({ type: 'error', message: 'Invoice not found for sending.' });
            return;
        }
        const emailPrepared = await composeInvoiceEmail(invoice);
        if (emailPrepared) {
            setSendModalDraftReady(true);
        }
    }, [sendModalInvoiceId, invoices, composeInvoiceEmail]);

    const handleMarkInvoiceSent = useCallback(async () => {
        if (!sendModalInvoiceId) return;
        const success = await sendInvoice(sendModalInvoiceId);
        if (success) {
            closeSendModal();
            resetInvoiceForm();
        }
    }, [sendModalInvoiceId, sendInvoice, closeSendModal, resetInvoiceForm]);

    const deleteDraftInvoice = useCallback(async (invoiceId) => {
        if (!invoiceId) return;
        const targetInvoice = (invoices || []).find(invoice => invoice.id === invoiceId);
        if (!targetInvoice) {
            setInvoiceMessage({ type: 'error', message: 'Draft invoice not found.' });
            return;
        }
        if (getStatusDisplay(targetInvoice.status) !== INVOICE_STATUS.DRAFT) {
            setInvoiceMessage({ type: 'error', message: 'Only draft invoices can be deleted.' });
            return;
        }
        const confirmed = window.confirm(`Delete draft invoice ${targetInvoice.reference || targetInvoice.id}?`);
        if (!confirmed) return;
        try {
            await deleteDoc(doc(db, 'invoices', invoiceId));
            setInvoiceMessage({ type: 'success', message: 'Draft invoice deleted.' });
            if (invoiceMode === 'edit' && editingInvoiceId === invoiceId) {
                resetInvoiceForm();
            }
        } catch (error) {
            console.error('Failed to delete draft invoice', error);
            setInvoiceMessage({ type: 'error', message: 'Unable to delete draft invoice.' });
        }
    }, [invoices, invoiceMode, editingInvoiceId, resetInvoiceForm]);

    const voidInvoice = useCallback(async (invoiceId) => {
        if (!invoiceId) return;
        if (!user?.uid) {
            setInvoiceMessage({ type: 'error', message: 'You must be signed in to void invoices.' });
            return;
        }
        const targetInvoice = (invoices || []).find(invoice => invoice.id === invoiceId);
        if (!targetInvoice) {
            setInvoiceMessage({ type: 'error', message: 'Invoice not found.' });
            return;
        }
        const status = getStatusDisplay(targetInvoice.status);
        if (status === INVOICE_STATUS.VOID) {
            setInvoiceMessage({ type: 'error', message: 'Invoice is already void.' });
            return;
        }
        if (status !== INVOICE_STATUS.SENT) {
            setInvoiceMessage({ type: 'error', message: 'Only sent invoices can be voided.' });
            return;
        }
        const reason = window.prompt('Provide a reason for voiding this invoice:');
        if (!reason || !reason.trim()) {
            setInvoiceMessage({ type: 'error', message: 'Void reason is required.' });
            return;
        }
        const statusEntry = {
            id: randomId(),
            status: INVOICE_STATUS.VOID,
            changedAt: Timestamp.now(),
            changedBy: user.uid,
            note: reason.trim(),
        };
        try {
            await updateDoc(doc(db, 'invoices', invoiceId), {
                status: INVOICE_STATUS.VOID,
                voidedAt: serverTimestamp(),
                voidedBy: user.uid,
                voidReason: reason.trim(),
                statusHistory: arrayUnion(statusEntry),
                updatedAt: serverTimestamp(),
                lastModifiedAt: serverTimestamp(),
                lastModifiedBy: user.uid,
            });
            setInvoiceMessage({ type: 'success', message: 'Invoice voided.' });
            closeViewModal();
        } catch (error) {
            console.error('Failed to void invoice', error);
            setInvoiceMessage({ type: 'error', message: 'Unable to void invoice.' });
        }
    }, [invoices, user?.uid, closeViewModal]);

    const handleInvoiceModeChange = useCallback((mode) => {
        if (mode === 'edit' && draftInvoices.length === 0) {
            return;
        }
        if (mode === invoiceMode) {
            return;
        }
        closeSendModal();
        closeViewModal();
        setInvoiceMode(mode);
        if (mode === 'new') {
            const initialDraft = createInitialInvoiceDraft();
            const nextCurrency = invoiceDraft.currency || selectedCustomer?.currency || initialDraft.currency;
            initialDraft.currency = nextCurrency;
            initialDraft.lineItems = [blankInvoiceLine(initialDraft.issueDate, nextCurrency)];
            setInvoiceDraft(initialDraft);
            setInvoiceDateInput(initialDraft.issueDate);
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            setEditingInvoiceId(null);
            lastCustomerRef.current = selectedCustomerId || '';
        } else if (mode === 'edit') {
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            if (!draftInvoices.find(invoice => invoice.id === editingInvoiceId)) {
                setEditingInvoiceId(null);
            }
        }
    }, [draftInvoices, editingInvoiceId, invoiceMode, invoiceDraft.currency, selectedCustomer, selectedCustomerId, closeSendModal, closeViewModal]);

    const handleIssueDateInputChange = useCallback((rawValue = '') => {
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
            setInvoiceDraft(prev => ({ ...prev, issueDate: '', dueDate: '' }));
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
            const nextDueDate = computeDueDateFromTerms(nextIssueDate, prev.payment?.paymentTerms, prev.dueDate);
            return { ...prev, issueDate: nextIssueDate, dueDate: nextDueDate, lineItems };
        });
        setInvoiceDateInput(normalised);
    }, []);

    const handleSaveMaster = useCallback(async (event) => {
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
    }, [user, masterDraft, masterPriceBook]);

    const handleCreateCustomer = useCallback(async (event) => {
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
    }, [user, masterPriceBook]);

    const handleSaveCustomerPricing = useCallback(async () => {
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
    }, [selectedCustomer, user, customerDraft, masterDraft]);

    const handleRevertToMaster = useCallback(async () => {
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
    }, [selectedCustomer, masterPriceBook, assignedPriceBook]);

    const handleInvoiceSubmit = useCallback(async (event) => {
        event.preventDefault();
        if (!selectedCustomer || !user?.orgId) {
            setInvoiceMessage({ type: 'error', message: 'Select a customer first.' });
            return;
        }
        const missing = [];
        if (!invoiceDraft.reference.trim()) missing.push('Document reference');
        if (!invoiceDraft.buyerReference.trim()) missing.push('Buyer reference');
        if (!invoiceDraft.customerName.trim()) missing.push('Customer name');
        if (!invoiceDraft.customerAddress.trim()) missing.push('Customer address');
        const seller = invoiceDraft.seller || {};
        const payment = invoiceDraft.payment || {};
        const sellerFieldLabels = {
            companyName: 'Supplier name',
            companyId: 'Supplier company ID',
            addressStreet: 'Supplier address street',
            addressCity: 'Supplier address city',
            addressPostal: 'Supplier address postal code',
            addressCountry: 'Supplier address country',
            contactEmail: 'Supplier contact email',
            contactPhone: 'Supplier contact phone',
        };
        Object.entries(sellerFieldLabels).forEach(([field, label]) => {
            if (!String(seller[field] || '').trim()) missing.push(label);
        });
        const paymentFieldLabels = {
            accountName: 'Payment account name',
            bankName: 'Bank name',
            bankAddress: 'Bank address',
            sortCode: 'Sort code',
            accountNumber: 'Account number',
            iban: 'IBAN',
            bic: 'BIC',
            paymentTerms: 'Payment terms',
            paymentReference: 'Payment reference',
        };
        Object.entries(paymentFieldLabels).forEach(([field, label]) => {
            if (!String(payment[field] || '').trim()) missing.push(label);
        });
        const effectiveIssueDate = invoiceDraft.issueDate || normalizeDateInput(invoiceDateInput) || todayISO();
        const sanitized = sanitizeInvoiceLines(invoiceDraft.lineItems, effectiveIssueDate).filter(line => line.description && line.quantity > 0);
        if (!sanitized.length) {
            setInvoiceMessage({ type: 'error', message: 'Add at least one invoice line.' });
            return;
        }
        const missingLineDates = sanitized.some(line => !line.lineDate);
        if (missingLineDates) {
            missing.push('Line item service date');
        }
        if (missing.length) {
            setInvoiceMessage({ type: 'error', message: `Please complete the following fields: ${Array.from(new Set(missing)).join(', ')}.` });
            return;
        }
        if (invoiceMode === 'edit' && !editingInvoiceId) {
            setInvoiceMessage({ type: 'error', message: 'Select a draft invoice to update.' });
            return;
        }
        const isCredit = invoiceDraft.kind === 'credit';
        const documentType = isCredit ? 'CreditNote' : 'Invoice';
        const preparedLines = isCredit ? sanitized.map(line => ({ ...line, quantity: line.quantity * -1 })) : sanitized;
        const totals = calculateTotals(preparedLines);
        try {
            if (invoiceMode === 'edit' && editingInvoiceId) {
                const existingInvoice = (invoices || []).find(invoice => invoice.id === editingInvoiceId);
                if (!existingInvoice) {
                    setInvoiceMessage({ type: 'error', message: 'Draft invoice not found.' });
                    return;
                }
                const existingStatus = existingInvoice.status || INVOICE_STATUS.DRAFT;
                const existingHistory = Array.isArray(existingInvoice.statusHistory)
                    ? existingInvoice.statusHistory.map(entry => ({ ...entry }))
                    : [];
                existingHistory.push({
                    id: randomId(),
                    status: existingStatus,
                    changedAt: Timestamp.now(),
                    changedBy: user.uid,
                });
                await updateDoc(doc(db, 'invoices', editingInvoiceId), {
                    reference: invoiceDraft.reference.trim(),
                    buyerReference: invoiceDraft.buyerReference.trim(),
                    issueDate: effectiveIssueDate,
                    dueDate: invoiceDraft.dueDate || null,
                    currency: invoiceDraft.currency || 'GBP',
                    customerName: invoiceDraft.customerName.trim(),
                    customerEmail: invoiceDraft.customerEmail.trim(),
                    customerPhone: invoiceDraft.customerPhone.trim(),
                    customerAddress: invoiceDraft.customerAddress.trim(),
                    customerReference: invoiceDraft.customerReference.trim(),
                    seller: {
                        companyName: seller.companyName.trim(),
                        companyId: seller.companyId.trim(),
                        vatId: seller.vatId.trim(),
                        lei: seller.lei.trim(),
                        addressStreet: seller.addressStreet.trim(),
                        addressCity: seller.addressCity.trim(),
                        addressPostal: seller.addressPostal.trim(),
                        addressCountry: seller.addressCountry.trim().toUpperCase(),
                        contactEmail: (seller.contactEmail || '').trim(),
                        contactPhone: (seller.contactPhone || '').trim(),
                    },
                    payment: {
                        accountName: payment.accountName.trim(),
                        bankName: payment.bankName.trim(),
                        bankAddress: payment.bankAddress.trim(),
                        sortCode: payment.sortCode.trim(),
                        accountNumber: payment.accountNumber.trim(),
                        iban: payment.iban.trim(),
                        bic: payment.bic.trim(),
                        paymentTerms: payment.paymentTerms.trim(),
                        paymentReference: payment.paymentReference.trim(),
                        endToEndId: (payment.endToEndId || '').trim(),
                    },
                    buyerIdentifiers: {
                        companyId: invoiceDraft.buyerIdentifiers?.companyId || '',
                        vatId: invoiceDraft.buyerIdentifiers?.vatId || '',
                        lei: invoiceDraft.buyerIdentifiers?.lei || '',
                    },
                    notes: invoiceDraft.notes.trim(),
                    lines: preparedLines,
                    totals,
                    priceBookId: activePriceBook?.id || existingInvoice.priceBookId || null,
                    documentType,
                    status: existingStatus,
                statusHistory: existingHistory,
                    updatedAt: serverTimestamp(),
                    lastModifiedAt: serverTimestamp(),
                    lastModifiedBy: user.uid,
                });
                setInvoiceMessage({ type: 'success', message: 'Draft invoice updated.' });
                setInvoiceLinesTouched(false);
                setInvoiceDateError('');
                return;
            }

            const statusValue = INVOICE_STATUS.DRAFT;
            const payload = {
                orgId: user.orgId,
                customerId: selectedCustomer.id,
                reference: invoiceDraft.reference.trim(),
                buyerReference: invoiceDraft.buyerReference.trim(),
                issueDate: effectiveIssueDate,
                dueDate: invoiceDraft.dueDate || null,
                currency: invoiceDraft.currency || 'GBP',
                customerName: invoiceDraft.customerName.trim(),
                customerEmail: invoiceDraft.customerEmail.trim(),
                customerPhone: invoiceDraft.customerPhone.trim(),
                customerAddress: invoiceDraft.customerAddress.trim(),
                customerReference: invoiceDraft.customerReference.trim(),
                seller: {
                    companyName: seller.companyName.trim(),
                    companyId: seller.companyId.trim(),
                    vatId: seller.vatId.trim(),
                    lei: seller.lei.trim(),
                    addressStreet: seller.addressStreet.trim(),
                    addressCity: seller.addressCity.trim(),
                    addressPostal: seller.addressPostal.trim(),
                    addressCountry: seller.addressCountry.trim().toUpperCase(),
                    contactEmail: (seller.contactEmail || '').trim(),
                    contactPhone: (seller.contactPhone || '').trim(),
                },
                payment: {
                    accountName: payment.accountName.trim(),
                    bankName: payment.bankName.trim(),
                    bankAddress: payment.bankAddress.trim(),
                    sortCode: payment.sortCode.trim(),
                    accountNumber: payment.accountNumber.trim(),
                    iban: payment.iban.trim(),
                    bic: payment.bic.trim(),
                    paymentTerms: payment.paymentTerms.trim(),
                    paymentReference: payment.paymentReference.trim(),
                    endToEndId: (payment.endToEndId || '').trim(),
                },
                buyerIdentifiers: {
                    companyId: invoiceDraft.buyerIdentifiers?.companyId || '',
                    vatId: invoiceDraft.buyerIdentifiers?.vatId || '',
                    lei: invoiceDraft.buyerIdentifiers?.lei || '',
                },
                notes: invoiceDraft.notes.trim(),
                lines: preparedLines,
                totals,
                status: statusValue,
                statusHistory: [{
                    id: randomId(),
                    status: statusValue,
                    changedAt: Timestamp.now(),
                    changedBy: user.uid,
                }],
                documentType,
                ublVersion: '2.1',
                priceBookId: activePriceBook?.id || null,
                createdBy: user.uid,
                createdAt: serverTimestamp(),
                lastModifiedAt: serverTimestamp(),
                lastModifiedBy: user.uid,
                updatedAt: serverTimestamp(),
            };
            await addDoc(collection(db, 'invoices'), payload);
            setInvoiceMessage({ type: 'success', message: 'Draft invoice saved.' });
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            const resetDraft = createInitialInvoiceDraft();
            resetDraft.currency = invoiceDraft.currency || 'GBP';
            setInvoiceDraft(resetDraft);
            setEditingInvoiceId(null);
        } catch (error) {
            console.error('Failed to save invoice', error);
            setInvoiceMessage({
                type: 'error',
                message: invoiceMode === 'edit' ? 'Unable to update draft invoice.' : 'Unable to save draft invoice.',
            });
        }
    }, [selectedCustomer, user, invoiceDraft, invoiceDateInput, invoiceMode, editingInvoiceId, invoices, activePriceBook]);

    const handleSaveTemplate = useCallback(async (event) => {
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
    }, [user, templateMeta, invoiceDraft, invoiceDateInput, selectedCustomer, activePriceBook]);

    const applyTemplate = useCallback((template) => {
        if (!template) return;
        if (template.customerId) setSelectedCustomerId(template.customerId);
        const issueForTemplate = todayISO();
        const templateCurrency = template.currency || invoiceDraft.currency || 'GBP';
        const linesFromTemplate = (template.lines || []).map(item => toInvoiceLine(item, issueForTemplate, templateCurrency));
        setInvoiceDraft(prev => {
            const paymentTerms = prev.payment?.paymentTerms;
            const dueFromTemplate = typeof template.dueInDays === 'number' && Number.isFinite(template.dueInDays)
                ? addDays(template.dueInDays, issueForTemplate)
                : computeDueDateFromTerms(issueForTemplate, paymentTerms, prev.dueDate);
            return {
                ...prev,
                reference: template.referencePrefix || prev.reference,
                currency: template.currency || prev.currency,
                notes: template.notes || prev.notes,
                issueDate: issueForTemplate,
                dueDate: dueFromTemplate,
                lineItems: linesFromTemplate.length ? linesFromTemplate : prev.lineItems,
            };
        });
        setTemplateMessage({ type: 'success', message: 'Template loaded.' });
    }, [invoiceDraft.currency]);

    const deleteTemplate = useCallback(async (id) => {
        try {
            await deleteDoc(doc(db, 'invoiceTemplates', id));
            setTemplateMessage({ type: 'success', message: 'Template deleted.' });
        } catch (error) {
            console.error('Failed to delete template', error);
            setTemplateMessage({ type: 'error', message: 'Unable to delete template.' });
        }
    }, []);


    // EFFECT HOOKS
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
    }, [selectedCustomer, assignedPriceBook, activePriceBook, customerHasUnsavedChanges, customerDraft]);

    useEffect(() => {
        if (!selectedCustomerId) {
            lastCustomerRef.current = '';
            setInvoiceDraft(prev => ({
                ...prev,
                customerName: '',
                customerEmail: '',
                customerPhone: '',
                customerAddress: '',
                customerReference: '',
                buyerIdentifiers: {
                    ...(prev.buyerIdentifiers || {}),
                    companyId: '',
                },
                lineItems: [blankInvoiceLine(prev.issueDate || todayISO(), prev.currency || 'GBP')],
            }));
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            return;
        }
        if (!selectedCustomer) return;
        const companyNumber = getCustomerCompanyNumber(selectedCustomer);
        if (lastCustomerRef.current !== selectedCustomerId) {
            lastCustomerRef.current = selectedCustomerId;
            setInvoiceDraft(prev => ({
                ...prev,
                currency: prev.currency || selectedCustomer.currency || 'GBP',
                customerName: '',
                customerEmail: '',
                customerPhone: '',
                customerAddress: '',
                customerReference: '',
                buyerIdentifiers: {
                    ...(prev.buyerIdentifiers || {}),
                    companyId: companyNumber || '',
                },
                lineItems: [blankInvoiceLine(
                    prev.issueDate || todayISO(),
                    selectedCustomer.currency || prev.currency || 'GBP'
                )],
            }));
            setInvoiceLinesTouched(false);
            setInvoiceDateError('');
            return;
        }
        setInvoiceDraft(prev => {
            const currentCompanyId = (prev.buyerIdentifiers?.companyId || '').trim();
            const nextCompanyId = companyNumber;
            if ((nextCompanyId || '') === currentCompanyId) return prev;
            return {
                ...prev,
                buyerIdentifiers: {
                    ...(prev.buyerIdentifiers || {}),
                    companyId: nextCompanyId || '',
                },
            };
        });
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
                                <span className="flex items-center gap-2">
                                    {tab.label}
                                    {tab.id === 'invoices' && draftInvoices.length > 0 && (
                                        <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">
                                            {draftInvoices.length}
                                        </span>
                                    )}
                                </span>
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
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-4 text-sm text-gray-200">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="invoiceMode"
                                            value="new"
                                            className="accent-red-500"
                                            checked={invoiceMode === 'new'}
                                            onChange={() => handleInvoiceModeChange('new')}
                                        />
                                        <span>New invoice</span>
                                    </label>
                                    <label className={`flex items-center gap-2 ${draftInvoices.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                        <input
                                            type="radio"
                                            name="invoiceMode"
                                            value="edit"
                                            className="accent-red-500"
                                            checked={invoiceMode === 'edit'}
                                            onChange={() => handleInvoiceModeChange('edit')}
                                            disabled={draftInvoices.length === 0}
                                        />
                                        <span>Edit draft</span>
                                    </label>
                                </div>
                                {invoiceMode === 'edit' && (
                                    <Select
                                        className="md:w-1/3"
                                        value={editingInvoiceId || ''}
                                        onChange={event => {
                                            const invoiceId = event.target.value || '';
                                            if (!invoiceId) {
                                                setEditingInvoiceId(null);
                                                return;
                                            }
                                            loadDraftForEditing(invoiceId);
                                        }}
                                    >
                                        <option value="">Select draft invoice...</option>
                                        {draftInvoices.map(invoice => (
                                            <option key={invoice.id} value={invoice.id}>
                                                {(invoice.reference || invoice.id) + '  -  ' + (invoice.issueDate || 'No date')}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </div>
                            {invoiceMode === 'edit' && draftInvoices.length === 0 && (
                                <p className="text-xs text-yellow-300">No draft invoices available for editing.</p>
                            )}
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="text-sm font-semibold text-red-200">Customer details</h4>
                                    {selectedCustomer && (
                                        <span className="text-xs text-gray-400">Linked customer: {selectedCustomer.name}</span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500">
                                    Capture invoice contact information manually for now; these stay blank until CRM sync is ready.
                                </p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                                    <Select
                                        className="md:col-span-2"
                                        value={selectedCustomerId || ''}
                                        onChange={event => setSelectedCustomerId(event.target.value)}
                                    >
                                        <option value="">Select customer...</option>
                                        {customers.map(customer => (
                                            <option key={customer.id} value={customer.id}>{customer.name || 'Unnamed customer'}</option>
                                        ))}
                                    </Select>
                                    <Input
                                        className="md:col-span-2"
                                        value={invoiceDraft.customerName}
                                        onChange={event => setInvoiceDraft(prev => ({ ...prev, customerName: event.target.value }))}
                                        placeholder="Billing contact name"
                                    />
                                    <Input
                                        type="email"
                                        className="md:col-span-2"
                                        value={invoiceDraft.customerEmail}
                                        onChange={event => setInvoiceDraft(prev => ({ ...prev, customerEmail: event.target.value }))}
                                        placeholder="Billing email"
                                    />
                                    <Input
                                        className="md:col-span-2"
                                        value={invoiceDraft.customerPhone}
                                        onChange={event => setInvoiceDraft(prev => ({ ...prev, customerPhone: event.target.value }))}
                                        placeholder="Billing phone"
                                    />
                                    <Input
                                        className="md:col-span-2"
                                        value={invoiceDraft.customerReference}
                                        onChange={event => setInvoiceDraft(prev => ({ ...prev, customerReference: event.target.value }))}
                                        placeholder="Customer reference / PO"
                                    />
                                    <TextArea
                                        rows={2}
                                        className="md:col-span-6"
                                        value={invoiceDraft.customerAddress}
                                        onChange={event => setInvoiceDraft(prev => ({ ...prev, customerAddress: event.target.value }))}
                                        placeholder="Billing address or customer notes"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
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
                                    className="md:col-span-2"
                                    value={invoiceDraft.buyerReference}
                                    onChange={event => setInvoiceDraft(prev => ({ ...prev, buyerReference: event.target.value }))}
                                    placeholder="Buyer reference / PO"
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
                                <Input
                                    type="date"
                                    className="md:col-span-1 text-gray-400"
                                    value={invoiceDraft.dueDate || ''}
                                    disabled
                                    title="Due date is calculated from the invoice date and payment terms."
                                />
                                <Select className="md:col-span-1" value={invoiceDraft.currency} onChange={event => setInvoiceDraft(prev => ({ ...prev, currency: event.target.value }))}>
                                    {['GBP', 'USD', 'EUR', 'CAD', 'AUD'].map(code => (
                                        <option key={code} value={code}>{code}</option>
                                    ))}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold text-red-200">Supplier details</h4>
                                <p className="text-xs text-gray-500">These fields are required for compliant invoices.</p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                                    <Input className="md:col-span-2" value={invoiceDraft.seller?.companyName || ''} onChange={event => updateSellerField('companyName', event.target.value)} placeholder="Supplier name" />
                                    <Input className="md:col-span-2" value={invoiceDraft.seller?.companyId || ''} onChange={event => updateSellerField('companyId', event.target.value)} placeholder="Company registration number" />
                                    <Input className="md:col-span-1" value={invoiceDraft.seller?.vatId ?? 'Not Registered'} onChange={event => updateSellerField('vatId', event.target.value)} placeholder="VAT ID" />
                                    <Input className="md:col-span-1 text-gray-500" value={invoiceDraft.seller?.lei || ''} onChange={event => updateSellerField('lei', event.target.value)} placeholder="LEI" disabled />
                                    <Input className="md:col-span-3" value={invoiceDraft.seller?.addressStreet || ''} onChange={event => updateSellerField('addressStreet', event.target.value)} placeholder="Supplier address line" />
                                    <Input className="md:col-span-2" value={invoiceDraft.seller?.addressCity || ''} onChange={event => updateSellerField('addressCity', event.target.value)} placeholder="City" />
                                    <Input className="md:col-span-1" value={invoiceDraft.seller?.addressPostal || ''} onChange={event => updateSellerField('addressPostal', event.target.value)} placeholder="Postal code" />
                                    <Input className="md:col-span-2" value={invoiceDraft.seller?.addressCountry || ''} onChange={event => updateSellerField('addressCountry', event.target.value)} placeholder="Country (ISO 3166-1 alpha-2)" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold text-red-200">Payment details</h4>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.accountName || ''} onChange={event => updatePaymentField('accountName', event.target.value)} placeholder="Account name" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.bankName || ''} onChange={event => updatePaymentField('bankName', event.target.value)} placeholder="Bank name" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.bankAddress || ''} onChange={event => updatePaymentField('bankAddress', event.target.value)} placeholder="Bank address" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.sortCode || ''} onChange={event => updatePaymentField('sortCode', event.target.value)} placeholder="Sort code" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.accountNumber || ''} onChange={event => updatePaymentField('accountNumber', event.target.value)} placeholder="Account number" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.paymentReference || ''} onChange={event => updatePaymentField('paymentReference', event.target.value)} placeholder="Payment reference" />
                                    <Input className="md:col-span-3" value={invoiceDraft.payment?.iban || ''} onChange={event => updatePaymentField('iban', event.target.value)} placeholder="IBAN" />
                                    <Input className="md:col-span-2" value={invoiceDraft.payment?.bic || ''} onChange={event => updatePaymentField('bic', event.target.value)} placeholder="BIC" />
                                    <Select className="md:col-span-1" value={invoiceDraft.payment?.paymentTerms || ''} onChange={event => updatePaymentField('paymentTerms', event.target.value)}>
                                        <option value="">Select terms...</option>
                                        {PAYMENT_TERM_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2 pointer-events-none opacity-60">
                                <h4 className="text-sm font-semibold text-red-200">Customer company identifiers (placeholder)</h4>
                                <p className="text-xs text-gray-500">These ISO identifiers will sync from the CRM in a future update.</p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    <Input disabled value={invoiceDraft.buyerIdentifiers?.companyId || ''} onChange={event => updateBuyerIdentifierField('companyId', event.target.value)} placeholder="Company ID (coming soon)" />
                                    <Input disabled value={invoiceDraft.buyerIdentifiers?.vatId || ''} onChange={event => updateBuyerIdentifierField('vatId', event.target.value)} placeholder="VAT ID (coming soon)" />
                                    <Input disabled value={invoiceDraft.buyerIdentifiers?.lei || ''} onChange={event => updateBuyerIdentifierField('lei', event.target.value)} placeholder="LEI (coming soon)" />
                                </div>
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
                                            <Input
                                                className="md:col-span-1 uppercase"
                                                value={line.unitCode || 'EA'}
                                                onChange={event => updateInvoiceLine(line.tempId, 'unitCode', event.target.value)}
                                                placeholder="UoM"
                                            />
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
                            <div className="space-y-2 rounded border border-red-900 bg-gray-900/60 p-4">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <h4 className="text-sm font-semibold text-red-200">Quick SKU lookup</h4>
                                    <Input
                                        className="md:w-64"
                                        value={skuLookupQuery}
                                        onChange={event => setSkuLookupQuery(event.target.value)}
                                        placeholder="Search SKU, product name, or description"
                                    />
                                </div>
                                <p className="text-xs text-gray-500">
                                    Browse catalogue and product SKUs without leaving the billing screen. Matches honour any price book links first.
                                </p>
                                <div className="max-h-48 overflow-y-auto rounded border border-red-900/60">
                                    {skuLookupItems.items.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-gray-500">
                                            {skuLookupQuery.trim()
                                                ? 'No products match your search.'
                                                : 'Add products or catalogue items to populate the lookup.'}
                                        </div>
                                    ) : (
                                        skuLookupItems.items.map(item => (
                                            <button
                                                key={item.sku}
                                                type="button"
                                                onClick={() => addInvoiceLineFromSku(item.sku, item.payload)}
                                                className="grid w-full grid-cols-1 gap-2 border-b border-red-900/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-red-900/20 md:grid-cols-5 md:items-center"
                                            >
                                                <div className="md:col-span-3 text-sm text-gray-100">
                                                    {item.name}
                                                    {item.description && (
                                                        <span className="block text-xs text-gray-500">{item.description}</span>
                                                    )}
                                                </div>
                                                <div className="md:col-span-2 flex flex-col items-start gap-1 md:items-end">
                                                    <span className="font-mono text-sm text-red-200">{item.sku}</span>
                                                    <span className="text-[10px] uppercase tracking-wide text-gray-500">{item.source}</span>
                                                </div>
                                            </button>
                                        ))
                                    )}
                                </div>
                                {skuLookupItems.limited && (
                                    <p className="text-[10px] uppercase tracking-wide text-gray-500">
                                        Showing first 50 matches. Narrow your search to refine results.
                                    </p>
                                )}
                                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                                    Total matches: {skuLookupItems.total}
                                </p>
                            </div>
                            <TextArea rows={3} value={invoiceDraft.notes} onChange={event => setInvoiceDraft(prev => ({ ...prev, notes: event.target.value }))} placeholder="Notes or payment instructions" />
                            <div className="text-sm text-gray-300">
                                <div>Net: {formatCurrency(invoicePreviewTotals.net, invoiceDraft.currency)}</div>
                                <div>Tax: {formatCurrency(invoicePreviewTotals.tax, invoiceDraft.currency)}</div>
                                <div className="font-semibold">Gross: {formatCurrency(invoicePreviewTotals.gross, invoiceDraft.currency)}</div>
                            </div>
                            <div className="flex flex-wrap gap-4 items-center">
                                <Button
                                    type="submit"
                                    className="w-auto"
                                    disabled={invoiceMode === 'edit' && !editingInvoiceId}
                                >
                                    {invoiceMode === 'edit' ? 'Update Draft' : 'Save as Draft'}
                                </Button>
                                {invoiceMode === 'edit' && editingDraftInvoice && getStatusDisplay(editingDraftInvoice.status) === INVOICE_STATUS.DRAFT && (
                                    <Button
                                        type="button"
                                        className="w-auto bg-green-700 hover:bg-green-600"
                                        onClick={() => openSendModal()}
                                    >
                                        Send Invoice
                                    </Button>
                                )}
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
                        {recentInvoices.map(invoice => {
                            const status = getStatusDisplay(invoice.status);
                            const customerName = customerNameById.get(invoice.customerId) || 'Unknown customer';
                            return (
                                <div key={invoice.id} className="border border-red-900 bg-gray-900/60 p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-center">
                                    <div>
                                        <p className="font-semibold">{invoice.reference || invoice.id}</p>
                                        <p className="text-xs text-gray-400">{invoice.issueDate || ''}</p>
                                    </div>
                                    <div className="text-sm text-gray-300">{customerName}</div>
                                    <div className="text-sm text-gray-300">{formatCurrency(invoice.totals?.gross || 0, invoice.currency || 'GBP')}</div>
                                    <div className="text-sm text-gray-300">{invoice.documentType || 'Invoice'}</div>
                                    <div className="text-sm text-gray-300"><StatusBadge status={invoice.status} /></div>
                                    <div className="flex flex-wrap gap-2 justify-end">
                                        {status === INVOICE_STATUS.DRAFT ? (
                                            <>
                                                <Button
                                                    type="button"
                                                    className="w-auto bg-gray-800 hover:bg-gray-700"
                                                    onClick={() => loadDraftForEditing(invoice.id)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    type="button"
                                                    className="w-auto bg-green-700 hover:bg-green-600"
                                                    onClick={() => openSendModal(invoice.id)}
                                                >
                                                    Send
                                                </Button>
                                                <Button
                                                    type="button"
                                                    className="w-auto bg-red-800 hover:bg-red-700"
                                                    onClick={() => deleteDraftInvoice(invoice.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </>
                                        ) : status === INVOICE_STATUS.SENT ? (
                                            <>
                                                <Button
                                                    type="button"
                                                    className="w-auto bg-gray-800 hover:bg-gray-700"
                                                    onClick={() => openViewModal(invoice.id)}
                                                >
                                                    View
                                                </Button>
                                                <Button
                                                    type="button"
                                                    className="w-auto bg-red-800 hover:bg-red-700"
                                                    onClick={() => voidInvoice(invoice.id)}
                                                >
                                                    Void
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                type="button"
                                                className="w-auto bg-gray-800 hover:bg-gray-700"
                                                onClick={() => openViewModal(invoice.id)}
                                            >
                                                View
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
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
                                    <p className="text-xs text-gray-400">{record.issueDate || '-'}</p>
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

            <SendInvoiceModal
                open={sendModalOpen}
                invoice={invoiceForSendModal}
                customerName={invoiceForSendModal ? (customerNameById.get(invoiceForSendModal.customerId) || 'Customer') : ''}
                onDownloadDraft={handleDownloadInvoiceDraft}
                onMarkSent={handleMarkInvoiceSent}
                markDisabled={!sendModalDraftReady}
                onCancel={closeSendModal}
            />
            <ViewInvoiceModal
                invoice={invoiceForViewModal}
                customerName={invoiceForViewModal ? (customerNameById.get(invoiceForViewModal.customerId) || 'Customer') : ''}
                onClose={closeViewModal}
            />
        </div>
    );
};

export default BillingConsole;
