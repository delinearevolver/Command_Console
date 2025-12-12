import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, useAuth } from '../App';
import { Card, Input, Select, Button } from './ui';

const TrainingConsole = () => {
    const { user } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [activeTab, setActiveTab] = useState('my');
    const isAdmin = ['master', 'owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase());

    useEffect(() => {
        if (!user?.orgId) {
            setEmployees([]);
            return;
        }
        const q = query(collection(db, 'employees'), where('orgId', '==', user.orgId));
        const unsub = onSnapshot(q, (snap) => {
            setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return unsub;
    }, [user?.orgId]);

    const meProfile = useMemo(() => employees.find((e) => e.userId === user?.uid), [employees, user?.uid]);

    const filtered = useMemo(() => {
        const term = filterText.toLowerCase();
        return employees.filter((e) => {
            if (!term) return true;
            return (
                e.name?.toLowerCase().includes(term) ||
                e.email?.toLowerCase().includes(term) ||
                e.department?.toLowerCase().includes(term)
            );
        });
    }, [employees, filterText]);

    const renderTrainingCards = (profile) => {
        const requirements = Array.isArray(profile?.trainingRequirements) ? profile.trainingRequirements : [];
        const records = Array.isArray(profile?.trainingRecords) ? profile.trainingRecords : [];
        return (
            <div className="space-y-3">
                <Card className="bg-black/50 border-gray-800">
                    <p className="text-xs text-gray-500 uppercase">Standards & Requirements</p>
                    {requirements.length === 0 && <p className="text-gray-400 text-sm">No assigned standards yet.</p>}
                    <div className="flex flex-wrap gap-2 mt-2">
                        {requirements.map((req, idx) => (
                            <span key={idx} className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-200">{req}</span>
                        ))}
                    </div>
                </Card>
                <Card className="bg-black/50 border-gray-800">
                    <p className="text-xs text-gray-500 uppercase">Training Records</p>
                    {records.length === 0 && <p className="text-gray-400 text-sm">No completions recorded.</p>}
                    <div className="space-y-2 mt-2">
                        {records.map((rec, idx) => (
                            <div key={idx} className="flex justify-between text-sm text-gray-200 border-b border-gray-800 pb-1">
                                <div>
                                    <p className="font-semibold text-red-200">{rec.course || 'Course'}</p>
                                    <p className="text-xs text-gray-500">{rec.standard || 'Standard'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-400">{rec.completedAt || ''}</p>
                                    {rec.evidenceUrl && <a className="text-xs text-red-300 underline" href={rec.evidenceUrl} target="_blank" rel="noreferrer">Evidence</a>}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Button className={activeTab === 'my' ? 'bg-red-700' : 'bg-gray-800'} onClick={() => setActiveTab('my')}>
                    My Training
                </Button>
                <Button className={activeTab === 'org' ? 'bg-red-700' : 'bg-gray-800'} onClick={() => setActiveTab('org')} disabled={!isAdmin}>
                    Org Training
                </Button>
            </div>

            {activeTab === 'my' && (
                <Card className="bg-gray-900 border-red-900 space-y-3">
                    <div>
                        <h3 className="text-xl font-bold text-red-300">My Training & Standards</h3>
                        <p className="text-gray-500 text-sm">Aligned to CMQUO standards; view your required and completed modules.</p>
                    </div>
                    {meProfile ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <Card className="bg-black/40 border-gray-800">
                                    <p className="text-xs text-gray-500 uppercase">Name</p>
                                    <p className="text-sm text-gray-200">{meProfile.name || user?.email}</p>
                                </Card>
                                <Card className="bg-black/40 border-gray-800">
                                    <p className="text-xs text-gray-500 uppercase">Department</p>
                                    <p className="text-sm text-gray-200">{meProfile.department || '—'}</p>
                                </Card>
                                <Card className="bg-black/40 border-gray-800">
                                    <p className="text-xs text-gray-500 uppercase">Cost Center</p>
                                    <p className="text-sm text-gray-200">{meProfile.costCenter || '—'}</p>
                                </Card>
                            </div>
                            {renderTrainingCards(meProfile)}
                        </>
                    ) : (
                        <p className="text-gray-400 text-sm">No employee profile found for your account.</p>
                    )}
                </Card>
            )}

            {activeTab === 'org' && isAdmin && (
                <Card className="bg-gray-900 border-red-900 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-xl font-bold text-red-300">Org Training</h3>
                            <p className="text-gray-500 text-sm">Review employees and their standards/training status.</p>
                        </div>
                        <div className="w-64">
                            <Input placeholder="Search name/email/department" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((emp) => (
                            <Card key={emp.id} className="bg-black/50 border-gray-800 space-y-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-sm font-semibold text-red-200">{emp.name || emp.email || 'Employee'}</p>
                                        <p className="text-xs text-gray-500">{emp.department || '—'} • {emp.costCenter || '—'}</p>
                                    </div>
                                    <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-200 uppercase">{emp.status || 'active'}</span>
                                </div>
                                <p className="text-xs text-gray-500">Currency: {emp.payrollCurrency || 'GBP'}</p>
                                <div className="flex flex-wrap gap-1 text-xs text-gray-400">
                                    {(emp.trainingRequirements || []).map((t, idx) => (
                                        <span key={idx} className="px-2 py-1 rounded bg-gray-900 text-gray-200 border border-gray-800">{t}</span>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500">Completed: {(emp.trainingRecords || []).length}</p>
                            </Card>
                        ))}
                        {filtered.length === 0 && <p className="text-gray-400 text-sm">No employees found.</p>}
                    </div>
                </Card>
            )}
        </div>
    );
};

export default TrainingConsole;
