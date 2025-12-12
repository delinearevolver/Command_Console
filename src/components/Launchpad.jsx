import React, { useState, useEffect } from 'react';

const SystemStatus = () => {
    const [status, setStatus] = useState('initializing');
    const [stats, setStats] = useState({ success: 0, errors: 0 });
    const [lastCheck, setLastCheck] = useState(null);

    useEffect(() => {
        const API_URL = "https://cmquo-api-891476346781.europe-west2.run.app/health";
        const checkHealth = async () => {
            try {
                const res = await fetch(API_URL);
                const data = await res.json();
                if (res.ok && data.ok) {
                    setStatus('operational');
                    if (data.activity) setStats(data.activity);
                } else {
                    setStatus('degraded');
                }
            } catch (e) {
                setStatus('offline');
            }
            setLastCheck(new Date().toLocaleTimeString());
        };
        checkHealth();
        const interval = setInterval(checkHealth, 15000);
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = () => {
        if (status === 'operational') return 'text-green-500';
        if (status === 'offline') return 'text-red-500 animate-pulse';
        if (status === 'degraded') return 'text-yellow-500';
        return 'text-gray-500';
    };

    return (
        <div className="mx-auto max-w-4xl p-3 border border-gray-800 bg-gray-900/80 mb-8 flex justify-between items-center shadow-[0_0_10px_rgba(0,255,0,0.1)] rounded-md">
            <div className="flex items-center gap-6">
                <div className="flex flex-col">
                    <h3 className="font-bold text-gray-400 text-[10px] uppercase tracking-wider">Ledger Uplink</h3>
                    <span className={`text-xl font-mono font-bold ${getStatusColor()}`}>
                        {status.toUpperCase()}
                    </span>
                </div>
                {status === 'operational' && (
                    <div className="flex gap-6 ml-2 border-l border-gray-700 pl-6">
                        <div className="text-center">
                            <span className="block text-[10px] text-gray-500">SUCCESS</span>
                            <span className="text-green-400 font-mono text-lg">{stats.success}</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-[10px] text-gray-500">ERRORS</span>
                            <span className={`font-mono text-lg ${stats.errors > 0 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                {stats.errors}
                            </span>
                        </div>
                    </div>
                )}
            </div>
            <div className="text-right hidden sm:block">
                <p className="text-[10px] text-gray-500 uppercase">Last Heartbeat</p>
                <p className="text-gray-400 font-mono text-xs">{lastCheck || '...'}</p>
            </div>
        </div>
    );
};

const LaunchpadCard = ({ children, className = '', ...props }) => (
    <div
        {...props}
        className={`p-4 sm:p-6 border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] bg-black bg-opacity-80 ${className}`}
    >
        {children}
    </div>
);

const LaunchpadButton = ({ children, className = '', ...props }) => (
    <button
        {...props}
        className={`w-full p-2 bg-red-800 hover:bg-red-700 font-bold disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors ${className}`}
    >
        {children}
    </button>
);

const Launchpad = ({ setActiveConsole, onSignOut }) => (
    <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-end">
                <div className="w-full sm:w-auto sm:min-w-[180px]">
                    <LaunchpadButton
                        type="button"
                        className="bg-gray-800"
                        onClick={onSignOut}
                    >
                        Sign out
                    </LaunchpadButton>
                </div>
            </div>

            <LaunchpadCard className="text-center bg-black bg-opacity-90">
                <h1 className="text-3xl font-bold text-red-300">Command Console</h1>
                <p className="text-gray-400 mt-2">Business management platform</p>
                <SystemStatus />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <LaunchpadCard
                        className="hover:border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('catalogue')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">CATALOG</div>
                            <h2 className="text-2xl font-bold text-red-300">Catalogue</h2>
                            <p className="text-gray-400">Manage products, services, and marketplace listings</p>
                            <LaunchpadButton className="w-full">Open Catalogue</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard
                        className="hover:border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('billing')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">BILLING</div>
                            <h2 className="text-2xl font-bold text-red-300">Billing</h2>
                            <p className="text-gray-400">Create invoices, manage customers, track payments</p>
                            <LaunchpadButton className="w-full">Open Billing</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard
                        className="hover:border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('customers')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">CUSTOMERS</div>
                            <h2 className="text-2xl font-bold text-red-300">Customers</h2>
                            <p className="text-gray-400">CRM, contacts, billing addresses, price books</p>
                            <LaunchpadButton className="w-full">Open Customers</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard
                        className="hover:border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('crm')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">CRM</div>
                            <h2 className="text-2xl font-bold text-red-300">CRM Overview</h2>
                            <p className="text-gray-400">Combined customers & suppliers directory with sites</p>
                            <LaunchpadButton className="w-full">Open CRM</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard
                        className="hover;border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('suppliers')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">SUPPLIERS</div>
                            <h2 className="text-2xl font-bold text-red-300">Suppliers</h2>
                            <p className="text-gray-400">AP directory, bank terms, default expense accounts</p>
                            <LaunchpadButton className="w-full">Open Suppliers</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard
                        className="hover:border-red-500 transition-colors cursor-pointer"
                        onClick={() => setActiveConsole('purchase-orders')}
                    >
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-red-300">AP</div>
                            <h2 className="text-2xl font-bold text-red-300">Purchase Orders</h2>
                            <p className="text-gray-400">Supplier POs, receipts, and three-way matching</p>
                            <LaunchpadButton className="w-full">Open Purchase Orders</LaunchpadButton>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard className="hover:border-red-500 transition-colors opacity-50">
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-gray-500">PROJECTS</div>
                            <h2 className="text-2xl font-bold text-gray-500">Projects</h2>
                            <p className="text-gray-400">Coming soon</p>
                        </div>
                    </LaunchpadCard>

                    <LaunchpadCard className="hover:border-red-500 transition-colors opacity-50">
                        <div className="text-center space-y-4 p-6">
                            <div className="text-2xl font-mono text-gray-500">PROCESSES</div>
                            <h2 className="text-2xl font-bold text-gray-500">Processes</h2>
                            <p className="text-gray-400">Coming soon</p>
                        </div>
                    </LaunchpadCard>
                </div>
            </LaunchpadCard>
        </div>
    </div>
);

export default Launchpad;
