import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, useAuth, storage, functions } from '../App';
import { Card, Input, Button, Select, Label, TextArea } from './ui';
import { createEmptyClaim, createExpenseLine, computeTotals } from '../utils/expenseClaims';

const STATUS_OPTIONS = ['draft', 'submitted', 'approved', 'rejected', 'posted', 'paid'];
const LINE_TYPES = ['receipt', 'mileage', 'perDiem', 'other'];

const PayrollConsole = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('expenses');
    const [claims, setClaims] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [selectedClaimId, setSelectedClaimId] = useState(null);
    const [draft, setDraft] = useState(() => createEmptyClaim('', user));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const [search, setSearch] = useState('');
    const canApprove = ['master', 'owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase());

    useEffect(() => {
        if (!user?.orgId) {
            setClaims([]);
            setLoading(false);
            return;
        }
        const q = query(collection(db, 'expenseClaims'), where('orgId', '==', user.orgId));
        const unsub = onSnapshot(q, (snap) => {
            setClaims(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, () => setLoading(false));
        const eq = query(collection(db, 'employees'), where('orgId', '==', user.orgId));
        const unsubEmployees = onSnapshot(eq, (snap) => {
            setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => {
            unsub();
            unsubEmployees();
        };
    }, [user?.orgId]);

    const meEmployee = useMemo(() => employees.find((e) => e.userId === user?.uid), [employees, user?.uid]);

    useEffect(() => {
        setDraft((prev) => ({
            ...prev,
            orgId: user?.orgId || '',
            claimantId: prev.claimantId || user?.uid || '',
            claimantEmail: prev.claimantEmail || user?.email || '',
            claimantName: prev.claimantName || user?.name || '',
            currency: prev.currency || meEmployee?.payrollCurrency || 'GBP',
            costCenter: prev.costCenter || meEmployee?.costCenter || '',
        }));
    }, [user?.orgId, user?.uid, user?.email, user?.name, meEmployee]);

const syncBadge = (syncStatus) => {
    const tone = {
        synced: 'bg-green-900 text-green-200',
        error: 'bg-red-900 text-red-200',
        blocked: 'bg-amber-900 text-amber-200',
        }[String(syncStatus || '').toLowerCase()] || 'bg-gray-800 text-gray-200';
        return (
            <span className={`text-[10px] px-2 py-1 rounded ${tone} uppercase`}>
                {syncStatus || 'unsynced'}
            </span>
        );
    };

    const filtered = useMemo(() => {
        const term = search.toLowerCase();
        return claims.filter((claim) => {
            if (statusFilter !== 'all' && claim.status !== statusFilter) return false;
            if (!term) return true;
            return (
                claim.claimantName?.toLowerCase().includes(term) ||
                claim.claimantEmail?.toLowerCase().includes(term) ||
                claim.period?.toLowerCase().includes(term) ||
                claim.id?.toLowerCase().includes(term)
            );
        });
    }, [claims, statusFilter, search]);

    const selectClaim = (claim) => {
        setSelectedClaimId(claim?.id || null);
        if (!claim) {
            setDraft(createEmptyClaim(user?.orgId || '', user));
            return;
        }
        setDraft({
            ...createEmptyClaim(user?.orgId || '', user),
            ...claim,
        });
    };

    const ensureTotals = (nextDraft) => ({
        ...nextDraft,
        totals: computeTotals(nextDraft),
    });

    const updateLine = (index, field, value) => {
        setDraft((prev) => {
            const lines = prev.lines.map((line, idx) => {
                if (idx !== index) return line;
                const updated = { ...line, [field]: value };
                if (field === 'netAmount' || field === 'vatAmount' || field === 'fxRate' || field === 'vatRate') {
                    updated.netAmount = Number(updated.netAmount) || 0;
                    updated.vatAmount = Number(updated.vatAmount) || 0;
                    updated.fxRate = Number(updated.fxRate) || 1;
                    updated.vatRate = Number(updated.vatRate) || 0;
                }
                return updated;
            });
            return ensureTotals({ ...prev, lines });
        });
    };

    const addLine = () => {
        setDraft((prev) => ensureTotals({ ...prev, lines: [...prev.lines, createExpenseLine('receipt', '', prev.currency || 'GBP')] }));
    };

    const removeLine = (index) => {
        setDraft((prev) => ensureTotals({ ...prev, lines: prev.lines.filter((_, idx) => idx !== index) }));
    };

    const handleReceiptUpload = async (index, file) => {
        if (!file) return;
        if (!selectedClaimId) {
            alert('Save the claim before attaching receipts.');
            return;
        }
        const path = `expenseClaims/${selectedClaimId}/receipts/${Date.now()}-${file.name}`;
        try {
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            let extractedData = null;
            try {
                const extract = httpsCallable(functions, 'extractReceipt');
                const response = await extract({ claimId: selectedClaimId, filePath: path, fileName: file.name, lineIndex: index });
                extractedData = response?.data?.extractedLine || null;
            } catch (err) {
                console.error('Extraction failed; keeping upload only', err);
            }

            setDraft((prev) => {
                const lines = prev.lines.map((line, idx) => {
                    if (idx !== index) return line;
                    const merged = {
                        ...line,
                        receiptImageUrl: downloadUrl,
                        storagePath: path,
                        extractedData: extractedData || line.extractedData || null,
                    };
                    if (extractedData) {
                        merged.vendor = merged.vendor || extractedData.vendor;
                        merged.description = merged.description || extractedData.description;
                        merged.expenseDate = merged.expenseDate || extractedData.expenseDate;
                        merged.netAmount = merged.netAmount || extractedData.netAmount || 0;
                        merged.vatAmount = merged.vatAmount || extractedData.vatAmount || 0;
                        merged.vatRate = merged.vatRate || extractedData.vatRate || 0;
                    }
                    return merged;
                });
                return ensureTotals({ ...prev, lines });
            });
        } catch (error) {
            console.error('Failed to upload receipt', error);
            alert(error.message || 'Failed to upload receipt');
        }
    };

    const setClaimant = (employeeId) => {
        const emp = employees.find((e) => e.id === employeeId || e.userId === employeeId);
        if (!emp) return;
        setDraft((prev) => ensureTotals({
            ...prev,
            claimantId: emp.userId || prev.claimantId,
            claimantName: emp.name || prev.claimantName,
            claimantEmail: emp.email || prev.claimantEmail,
            currency: emp.payrollCurrency || prev.currency || 'GBP',
            costCenter: emp.costCenter || prev.costCenter || '',
        }));
    };

    const saveClaim = async (nextStatus) => {
        if (!user?.orgId) return;
        setSaving(true);
        try {
            const payload = ensureTotals({
                ...draft,
                orgId: user.orgId,
                status: nextStatus || draft.status || 'draft',
                updatedAt: serverTimestamp(),
                updatedBy: user.email || user.uid || '',
            });

            if (selectedClaimId) {
                await updateDoc(doc(db, 'expenseClaims', selectedClaimId), payload);
            } else {
                const now = serverTimestamp();
                const docRef = await addDoc(collection(db, 'expenseClaims'), {
                    ...payload,
                    createdAt: now,
                    createdBy: user.email || user.uid || '',
                    status: payload.status || 'draft',
                });
                setSelectedClaimId(docRef.id);
                setDraft((prev) => ({ ...prev, id: docRef.id }));
            }
        } catch (error) {
            console.error('Failed to save claim', error);
            alert(error.message || 'Failed to save claim');
        } finally {
            setSaving(false);
        }
    };

    const statusAction = async (status) => {
        await saveClaim(status);
    };

    const myClaims = useMemo(() => claims.filter((c) => c.claimantId === user?.uid), [claims, user?.uid]);

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Button className={activeTab === 'expenses' ? 'bg-red-700' : 'bg-gray-800'} onClick={() => setActiveTab('expenses')}>
                    Expenses
                </Button>
                <Button className={activeTab === 'my-payroll' ? 'bg-red-700' : 'bg-gray-800'} onClick={() => setActiveTab('my-payroll')}>
                    My Payroll
                </Button>
            </div>

            {activeTab === 'expenses' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <Card className="lg:col-span-1 bg-gray-900 border-red-900 space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-red-300">Claims</h3>
                            <Button className="w-auto px-4 py-1" onClick={() => selectClaim(null)}>New Claim</Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                <option value="all">All statuses</option>
                                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Input placeholder="Search claimant/period" value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                        <div className="space-y-2 max-h-[70vh] overflow-auto">
                            {loading && <p className="text-gray-400 text-sm">Loading claims...</p>}
                            {!loading && filtered.length === 0 && <p className="text-gray-500 text-sm">No claims found.</p>}
                            {filtered.map((claim) => (
                                <Card
                                    key={claim.id}
                                    className={`cursor-pointer hover:border-red-500 ${selectedClaimId === claim.id ? 'border-red-500' : 'border-red-900'}`}
                                    onClick={() => selectClaim(claim)}
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <div>
                                            <p className="text-xs text-gray-500">{claim.id}</p>
                                            <p className="text-sm font-semibold text-red-200">{claim.claimantName || claim.claimantEmail || 'Claim'}</p>
                                            <p className="text-xs text-gray-400">{claim.period || 'Period not set'}</p>
                                        </div>
                                        <div className="text-right space-y-1">
                                            <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-200 capitalize">{claim.status || 'draft'}</span>
                                            <div>{syncBadge(claim.syncStatus)}</div>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-300 mt-1">
                                        {claim.currency || 'GBP'} {claim.totals?.grossTotal?.toFixed ? claim.totals.grossTotal.toFixed(2) : (claim.totals?.grossTotal || 0)}
                                    </p>
                                    {claim.syncMessage && <p className="text-[11px] text-gray-500 mt-1 truncate">{claim.syncMessage}</p>}
                                </Card>
                            ))}
                        </div>
                    </Card>

                    <Card className="lg:col-span-2 bg-gray-900 border-red-900 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-red-300">Claim Detail</h3>
                                <p className="text-gray-500 text-sm">Draft, submit, and approve expenses with receipt extraction stubs.</p>
                                <div className="flex items-center gap-2 mt-1">
                                    {syncBadge(draft.syncStatus)}
                                    {draft.syncMessage && <span className="text-[11px] text-gray-400">{draft.syncMessage}</span>}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button className="w-auto px-4 py-1" onClick={() => statusAction('draft')} disabled={saving}>Save Draft</Button>
                                <Button className="w-auto px-4 py-1" onClick={() => statusAction('submitted')} disabled={saving}>Submit</Button>
                                {canApprove && (
                                    <>
                                        <Button className="w-auto px-4 py-1 bg-green-800" onClick={() => statusAction('approved')} disabled={saving}>Approve</Button>
                                        <Button className="w-auto px-4 py-1 bg-red-900" onClick={() => statusAction('rejected')} disabled={saving}>Reject</Button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {canApprove && (
                                <div>
                                    <Label>Claimant</Label>
                                    <Select
                                        value={draft.claimantId || ''}
                                        onChange={(e) => setClaimant(e.target.value)}
                                    >
                                        <option value={user?.uid || ''}>Me ({user?.email})</option>
                                        {employees.map((emp) => (
                                            <option key={emp.id} value={emp.userId || emp.id}>
                                                {emp.name || emp.email || emp.id}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}
                            <div>
                                <Label>Period</Label>
                                <Input placeholder="e.g. Jan 2025" value={draft.period} onChange={(e) => setDraft((prev) => ({ ...prev, period: e.target.value }))} />
                            </div>
                            <div>
                                <Label>Accounting Date</Label>
                                <Input type="date" value={draft.accountingDate || ''} onChange={(e) => setDraft((prev) => ({ ...prev, accountingDate: e.target.value }))} />
                            </div>
                            <div>
                                <Label>Currency</Label>
                                <Select value={draft.currency || 'GBP'} onChange={(e) => setDraft((prev) => ensureTotals({ ...prev, currency: e.target.value }))}>
                                    <option value="GBP">GBP</option>
                                    <option value="EUR">EUR</option>
                                    <option value="USD">USD</option>
                                </Select>
                            </div>
                            <div>
                                <Label>Status</Label>
                                <Select value={draft.status || 'draft'} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}>
                                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                </Select>
                            </div>
                        </div>

                        <div>
                            <Label>Internal Notes</Label>
                            <TextArea rows={3} value={draft.internalNotes || ''} onChange={(e) => setDraft((prev) => ({ ...prev, internalNotes: e.target.value }))} />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-lg font-semibold text-red-300">Lines</h4>
                                <Button className="w-auto px-4 py-1" onClick={addLine}>Add line</Button>
                            </div>
                            {draft.lines.length === 0 && <p className="text-gray-500 text-sm">No lines yet.</p>}
                            <div className="space-y-3">
                                {draft.lines.map((line, idx) => (
                                    <Card key={idx} className="border-gray-800 bg-black/50 space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-400">Line {idx + 1}</span>
                                            <Button className="w-auto px-3 py-1 bg-gray-800" onClick={() => removeLine(idx)}>Remove</Button>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <Label>Type</Label>
                                                <Select value={line.lineType} onChange={(e) => updateLine(idx, 'lineType', e.target.value)}>
                                                    {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
                                                </Select>
                                            </div>
                                            <div>
                                                <Label>Date</Label>
                                                <Input type="date" value={line.expenseDate || ''} onChange={(e) => updateLine(idx, 'expenseDate', e.target.value)} />
                                            </div>
                                            <div>
                                                <Label>Vendor</Label>
                                                <Input value={line.vendor || ''} onChange={(e) => updateLine(idx, 'vendor', e.target.value)} placeholder="Merchant" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <Label>Description</Label>
                                                <Input value={line.description || ''} onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                                            </div>
                                            <div>
                                                <Label>GL Account</Label>
                                                <Input value={line.glAccountId || ''} onChange={(e) => updateLine(idx, 'glAccountId', e.target.value)} placeholder="e.g. 5000-Travel" />
                                            </div>
                                            <div>
                                                <Label>Payment Method</Label>
                                                <Select value={line.paymentMethod || 'reimbursable'} onChange={(e) => updateLine(idx, 'paymentMethod', e.target.value)}>
                                                    <option value="reimbursable">Reimbursable</option>
                                                    <option value="companyCard">Company Card</option>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <Label>Net</Label>
                                                <Input type="number" step="0.01" value={line.netAmount} onChange={(e) => updateLine(idx, 'netAmount', e.target.value)} />
                                            </div>
                                            <div>
                                                <Label>VAT</Label>
                                                <Input type="number" step="0.01" value={line.vatAmount} onChange={(e) => updateLine(idx, 'vatAmount', e.target.value)} />
                                            </div>
                                            <div>
                                                <Label>VAT Rate %</Label>
                                                <Input type="number" step="0.1" value={line.vatRate} onChange={(e) => updateLine(idx, 'vatRate', e.target.value)} />
                                            </div>
                                            <div>
                                                <Label>Currency</Label>
                                                <Input value={line.currency || draft.currency || 'GBP'} onChange={(e) => updateLine(idx, 'currency', e.target.value)} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <Label>Attach receipt (uploads + AI extract)</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="file" accept="image/*,application/pdf" onChange={(e) => handleReceiptUpload(idx, e.target.files?.[0])} />
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1">Uploads go to receipt bin and call the extractReceipt function.</p>
                                            </div>
                                            <div>
                                                <Label>FX Rate</Label>
                                                <Input type="number" step="0.0001" value={line.fxRate || 1} onChange={(e) => updateLine(idx, 'fxRate', e.target.value)} />
                                            </div>
                                        </div>
                                        {line.extractedData && (
                                            <div className="text-xs text-gray-400 border border-dashed border-gray-700 p-2 rounded">
                                                <p className="font-semibold text-red-200">Extraction (stub)</p>
                                                <p>Vendor: {line.extractedData.vendor}</p>
                                                <p>Description: {line.extractedData.description}</p>
                                                <p>Date: {line.extractedData.expenseDate}</p>
                                                <p>Net: {line.extractedData.netAmount} | VAT: {line.extractedData.vatAmount}</p>
                                            </div>
                                        )}
                                    </Card>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Card className="bg-black/40 border-gray-800">
                                <p className="text-sm text-gray-400">Net</p>
                                <p className="text-2xl font-bold text-red-200">{draft.currency || 'GBP'} {draft.totals?.netTotal?.toFixed ? draft.totals.netTotal.toFixed(2) : (draft.totals?.netTotal || 0)}</p>
                            </Card>
                            <Card className="bg-black/40 border-gray-800">
                                <p className="text-sm text-gray-400">VAT</p>
                                <p className="text-2xl font-bold text-red-200">{draft.currency || 'GBP'} {draft.totals?.vatTotal?.toFixed ? draft.totals.vatTotal.toFixed(2) : (draft.totals?.vatTotal || 0)}</p>
                            </Card>
                            <Card className="bg-black/40 border-gray-800">
                                <p className="text-sm text-gray-400">Gross</p>
                                <p className="text-2xl font-bold text-red-200">{draft.currency || 'GBP'} {draft.totals?.grossTotal?.toFixed ? draft.totals.grossTotal.toFixed(2) : (draft.totals?.grossTotal || 0)}</p>
                            </Card>
                        </div>
                    </Card>
                </div>
            )}

            {activeTab === 'my-payroll' && (
                <Card className="bg-gray-900 border-red-900 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-xl font-bold text-red-300">My Payroll</h3>
                            <p className="text-gray-500 text-sm">Employee-facing view of your own claims and pay runs (stubbed).</p>
                        </div>
                        <Button className="w-auto px-4 py-1" onClick={() => setActiveTab('expenses')}>Back to Expenses</Button>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm text-gray-400">This screen will surface your pay run summaries and payslips. For now, it lists your submitted claims.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {myClaims.map((claim) => (
                                <Card key={claim.id} className="bg-black/50 border-gray-800">
                                    <p className="text-xs text-gray-500">{claim.period || 'Period not set'}</p>
                                    <p className="text-sm font-semibold text-red-200">{claim.status || 'draft'}</p>
                                    <p className="text-sm text-gray-300">
                                        {claim.currency || 'GBP'} {claim.totals?.grossTotal?.toFixed ? claim.totals.grossTotal.toFixed(2) : (claim.totals?.grossTotal || 0)}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">Last updated: {claim.updatedAt?.toDate ? claim.updatedAt.toDate().toLocaleDateString() : '—'}</p>
                                </Card>
                            ))}
                            {myClaims.length === 0 && <p className="text-gray-500 text-sm">You have no claims yet.</p>}
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default PayrollConsole;
