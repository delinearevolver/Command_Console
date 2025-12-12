// Expense claim helpers and schema defaults
// HMRC-compliant structure with support for VAT, FX, approvals, and ledger sync metadata.

const STATUS = Object.freeze(['draft', 'submitted', 'approved', 'rejected', 'posted', 'paid']);
const CLAIMANT_TYPES = Object.freeze(['employee', 'director']);
const LINE_TYPES = Object.freeze(['receipt', 'mileage', 'perDiem', 'other']);
const PAYMENT_METHODS = Object.freeze(['reimbursable', 'companyCard']);

export const createEmptyClaim = (orgId, user) => ({
    orgId: orgId || '',
    claimantId: user?.uid || '',
    claimantType: 'employee',
    claimantName: user?.name || '',
    claimantEmail: user?.email || '',
    status: 'draft',
    period: '',
    taxYear: '',
    currency: 'GBP',
    accountingDate: '',
    lines: [],
    totals: { netTotal: 0, vatTotal: 0, grossTotal: 0 },
    approvals: [],
    ledgerEntryId: '',
    payrollRunId: '',
    paymentRef: '',
    paymentDate: '',
    syncStatus: '',
    syncMessage: '',
    createdAt: null,
    createdBy: user?.email || '',
    updatedAt: null,
    updatedBy: user?.email || '',
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    postedAt: null,
    paidAt: null,
});

export const createExpenseLine = (lineType = 'receipt', expenseAccount = '', currency = 'GBP') => ({
    lineType: LINE_TYPES.includes(lineType) ? lineType : 'receipt',
    receiptImageUrl: '',
    storagePath: '',
    contentType: '',
    fileSize: 0,
    extractedData: null,
    vendor: '',
    description: '',
    expenseDate: '',
    category: '',
    glAccountId: expenseAccount || '',
    projectId: '',
    costCenter: '',
    paymentMethod: 'reimbursable',
    netAmount: 0,
    vatAmount: 0,
    vatRate: 0,
    vatCode: '',
    supplyCountry: '',
    reclaimable: true,
    currency,
    fxRate: 1,
    fxSourceAmount: 0,
    confirmedByClaimant: false,
});

export const computeTotals = (claim) => {
    const currency = claim.currency || 'GBP';
    const lines = Array.isArray(claim.lines) ? claim.lines : [];
    let net = 0;
    let vat = 0;
    lines.forEach((line) => {
        const lineCurrency = line.currency || currency;
        const fx = Number(line.fxRate) || 1;
        const netLine = Number(line.netAmount) || 0;
        const vatLine = Number(line.vatAmount) || 0;
        if (lineCurrency === currency) {
            net += netLine;
            vat += vatLine;
        } else {
            net += netLine * fx;
            vat += vatLine * fx;
        }
    });
    const gross = net + vat;
    return {
        netTotal: round2(net),
        vatTotal: round2(vat),
        grossTotal: round2(gross),
    };
};

const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

export const validateClaim = (claim) => {
    const errors = [];
    if (!claim.orgId) errors.push('orgId required');
    if (!claim.claimantId) errors.push('claimantId required');
    if (!CLAIMANT_TYPES.includes(claim.claimantType)) errors.push('claimantType invalid');
    if (!STATUS.includes(claim.status)) errors.push('status invalid');
    if (!claim.currency) errors.push('currency required');
    const lines = Array.isArray(claim.lines) ? claim.lines : [];
    if (lines.length === 0) errors.push('At least one line required');
    lines.forEach((line, idx) => {
        if (!LINE_TYPES.includes(line.lineType || '')) errors.push(`line ${idx + 1}: invalid lineType`);
        if (!line.expenseDate) errors.push(`line ${idx + 1}: expenseDate required`);
        if (line.netAmount === undefined || line.netAmount === null) errors.push(`line ${idx + 1}: netAmount required`);
        if (line.vatAmount === undefined || line.vatAmount === null) errors.push(`line ${idx + 1}: vatAmount required`);
    });
    return errors;
};
