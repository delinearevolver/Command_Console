import React, { useState, useEffect, createContext, useContext, useMemo, useCallback } from 'react';

// --- Firebase SDK Imports ---
// IMPORTANT: You must install firebase in your project: npm install firebase
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot, doc, getDoc, writeBatch, updateDoc, serverTimestamp, addDoc, setDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import BillingConsole from './components/BillingConsole.jsx';

// --- Firebase Configuration ---
// IMPORTANT: Replace with your actual Firebase config from your project settings.
const firebaseConfig = {
        apiKey: "AIzaSyBySosb9TmWEEDZsqwxO2FiKRxUKQLj7es",
    authDomain: "fearless-leader.firebaseapp.com",
    projectId: "fearless-leader",
    storageBucket: "fearless-leader.firebasestorage.app",
    messagingSenderId: "891476346781",
    appId: "1:891476346781:web:ac9faa21e1caa831101174"
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// --- CONTEXTS ---
const AuthContext = createContext();
const TerminologyContext = createContext();
const DataContext = createContext();

// --- TERMINOLOGY SETS ---
const terminologies = {
    standard: { program: "Program", programs: "Programs", project: "Project", projects: "Projects", process: "Process", processes: "Processes", milestone: "Milestone", task: "Task", tasks: "Tasks" },
    imperial: { program: "Operation", programs: "Operations", project: "Mission", projects: "Missions", process: "Protocol", processes: "Protocols", milestone: "Objective", task: "Checkpoint", tasks: "Checkpoints" }
};

// --- PROVIDERS ---
const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                if (userDoc.exists()) {
                    setUser({ uid: firebaseUser.uid, email: firebaseUser.email, ...userDoc.data() });
                } else { setUser(null); }
            } else { setUser(null); }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
};

const TerminologyProvider = ({ children }) => {
    const [terminology, setTerminology] = useState(terminologies.standard);
    const toggleTerminology = () => setTerminology(prev => prev.program === 'Program' ? terminologies.imperial : terminologies.standard);
    return <TerminologyContext.Provider value={{ terminology, toggleTerminology }}>{children}</TerminologyContext.Provider>;
};

const DataProvider = ({ children }) => {
    const { user } = useContext(AuthContext);
    const [data, setData] = useState({ programs: [], projects: [], processes: [], tasks: [], users: [], customers: [], priceBooks: [], invoices: [], invoiceTemplates: [], loading: true });

    useEffect(() => {
        if (!user || !user.orgId) {
            setData(d => ({ ...d, loading: false, programs: [], projects: [], processes: [], tasks: [], users: [], customers: [], priceBooks: [], invoices: [], invoiceTemplates: [] }));
            return;
        }

        const unsubscribes = [];
        setData(d => ({ ...d, loading: true }));

        const collectionsToFetch = ['programs', 'processes', 'projects', 'tasks', 'users', 'customers', 'priceBooks', 'invoices', 'invoiceTemplates'];
        collectionsToFetch.forEach(col => {
            const q = query(collection(db, col), where("orgId", "==", user.orgId));
            unsubscribes.push(onSnapshot(q, snap => {
                setData(prev => ({ ...prev, [col]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
            }, err => console.error(`Error fetching ${col}:`, err)));
        });
        
        const timer = setTimeout(() => setData(prev => ({...prev, loading: false})), 1500);

        return () => unsubscribes.forEach(unsub => unsub());
    }, [user]);

    return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
};


// --- HOOKS ---
const useAuth = () => useContext(AuthContext);
const useTerminology = () => useContext(TerminologyContext);
const useData = () => useContext(DataContext);

const isBillingTask = (task) => {
    if (!task || typeof task !== 'object') return false;
    if (task.billing === true || task.isBilling === true) return true;
    if (typeof task.billing === 'string' && task.billing.toLowerCase().includes('billing')) return true;
    const normalize = (value) => typeof value === 'string' && value.toLowerCase().includes('billing');
    if (Array.isArray(task.tags) && task.tags.some(tag => normalize(tag))) return true;
    if (Array.isArray(task.labels) && task.labels.some(label => normalize(label))) return true;
    const fields = [
        task.category,
        task.type,
        task.kind,
        task.segment,
        task.bucket,
        task.workflow,
        task.title,
        task.name,
        task.description,
    ];
    return fields.some(normalize);
};

// --- STYLED COMPONENTS ---
const Card = ({ children, className = '' }) => <div className={`p-4 sm:p-6 border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] bg-black bg-opacity-80 ${className}`}>{children}</div>;
const Input = (props) => <input {...props} className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none" />;
const Button = ({ children, ...props }) => <button {...props} className={`w-full p-2 bg-red-800 hover:bg-red-700 font-bold disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors ${props.className}`}>{children}</button>;
const Select = ({ children, ...props }) => <select {...props} className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none appearance-none" style={{backgroundImage: `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="%23ff0000" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708 .708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center'}}>{children}</select>;
const Label = ({ className = '', children, ...props }) => (<label {...props} className={`block text-xs uppercase tracking-wide text-gray-400 ${className}`}>{children}</label>);
const TextArea = (props) => <textarea {...props} className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none" />;

// --- Main App & Router ---
export default function App() {
    return (
        <AuthProvider>
            <TerminologyProvider>
                <DataProvider>
                    <div className="bg-black text-gray-200 min-h-screen" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                        <MainRouter />
                    </div>
                </DataProvider>
            </TerminologyProvider>
        </AuthProvider>
    );
}

const MainRouter = () => {
    const { user, loading } = useAuth();
    if (loading) return <div className="flex justify-center items-center h-screen text-red-500 text-2xl">Initializing Systems...</div>;
    return user ? <OrgDashboard /> : <AuthScreen />;
};

// --- AUTHENTICATION SCREEN ---
const AuthScreen = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [orgName, setOrgName] = useState('');
    const [userName, setUserName] = useState('');

    const handleAuth = async (e) => {
        e.preventDefault(); setError('');
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                const user = cred.user;
                const orgRef = doc(collection(db, "orgs"));
                const userRef = doc(db, "users", user.uid);
                const batch = writeBatch(db);
                batch.set(orgRef, { name: orgName, ownerId: user.uid });
                batch.set(userRef, { name: userName, email: user.email, orgId: orgRef.id, role: 'master', assignedProjects: [], assignedProcesses: [] });
                await batch.commit();
            }
        } catch (err) { setError(err.message.replace('Firebase: ', '')); }
    };

    return (
        <div className="flex justify-center items-center h-screen p-4">
            <Card className="w-full max-w-md">
                <h1 className="text-3xl text-center text-red-500 mb-6">{isLogin ? "Command Console Login" : "Establish First Organization"}</h1>
                <form onSubmit={handleAuth} className="space-y-4">
                    {!isLogin && <Input type="text" placeholder="Your Name" value={userName} onChange={e => setUserName(e.target.value)} required />}
                    {!isLogin && <Input type="text" placeholder="Organization Name" value={orgName} onChange={e => setOrgName(e.target.value)} required />}
                    <Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
                    <Input type="password" placeholder="Password (min. 6 chars)" value={password} onChange={e => setPassword(e.target.value)} required />
                    <Button type="submit">{isLogin ? 'Login' : 'Create Master Account'}</Button>
                    {error && <p className="text-yellow-400 text-sm text-center">{error}</p>}
                </form>
                <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-4 text-red-400 text-sm hover:underline">
                    {isLogin ? "Need to create an Organization?" : "Already have an account?"}
                </button>
            </Card>
        </div>
    );
};

// --- ORGANIZATIONAL DASHBOARD ---
const OrgDashboard = () => {
    const { user } = useAuth();
    const [view, setView] = useState('dashboard');
    const { terminology, toggleTerminology } = useTerminology();
    const canManage = user.role === 'master' || user.role === 'admin';
    const isStandardLexicon = terminology.program === 'Program';
    const nextLexicon = isStandardLexicon ? 'Imperial' : 'Standard';

    const changeView = useCallback((nextView) => {
        setView(nextView);
        if (nextView === 'dashboard') {
            const { pathname, search } = window.location;
            const newUrl = pathname + search;
            window.history.replaceState(null, '', newUrl);
        } else {
            const targetHash = '#' + nextView;
            if (window.location.hash !== targetHash) {
                window.location.hash = targetHash;
            }
        }
    }, [setView]);

    const navigateToBilling = useCallback(() => changeView('billing'), [changeView]);

    useEffect(() => {
        const applyHashView = () => {
            const hash = window.location.hash.replace('#', '');
            if (!hash) {
                return;
            }
            const allowed = new Set(['dashboard', 'kanban', 'gantt', 'billing', 'admin']);
            if (allowed.has(hash)) {
                setView(hash);
            }
        };
        applyHashView();
        window.addEventListener('hashchange', applyHashView);
        return () => window.removeEventListener('hashchange', applyHashView);
    }, [setView]);

    return (
        <div className="p-4 sm:p-8">
            <header className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl text-red-500">Welcome, {user.name || user.email}</h1>
                    <p className="text-red-300 text-sm">Role: {user.role.toUpperCase()}</p>
                    <p className="text-red-300 text-xs mt-1">Lexicon: {isStandardLexicon ? 'Standard' : 'Imperial'}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    <button onClick={() => changeView('dashboard')} className={`p-2 text-sm ${view === 'dashboard' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}>Dashboard</button>
                    <button onClick={() => changeView('kanban')} className={`p-2 text-sm ${view === 'kanban' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}>Kanban</button>
                    <button onClick={() => changeView('gantt')} className={`p-2 text-sm ${view === 'gantt' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}>Gantt</button>
                    <button onClick={() => changeView('billing')} className={`p-2 text-sm ${view === 'billing' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}>Billing</button>
                    {canManage && <button onClick={() => changeView('admin')} className={`p-2 text-sm ${view === 'admin' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}>Admin</button>}
                    <button onClick={toggleTerminology} className="p-2 text-sm bg-gray-800 border border-red-700">
                        Switch to {nextLexicon} Terminology
                    </button>
                    <button onClick={() => signOut(auth)} className="p-2 text-sm bg-gray-800 border border-red-700">Logout</button>
                </div>
            </header>

            {view === 'dashboard' ? <HierarchyDashboard onNavigateToBilling={navigateToBilling} /> :
             view === 'kanban' ? <KanbanDashboard onNavigateToBilling={navigateToBilling} /> :
             view === 'gantt' ? <GanttDashboard onNavigateToBilling={navigateToBilling} /> :
             view === 'billing' ? <BillingConsole /> :
             <AdminDashboard />}
        </div>
    );
};


// --- HIERARCHY DASHBOARD ---
const HierarchyDashboard = ({ onNavigateToBilling = null }) => {
    const { user } = useAuth();
    const { programs, projects, tasks, loading } = useData();
    const { terminology } = useTerminology();
    const canManage = user.role === 'master' || user.role === 'admin';

    const visiblePrograms = useMemo(() => {
        if (user.role === 'master' || user.role === 'admin') return programs;
        const assignedProjectIds = user.assignedProjects || [];
        const programIds = new Set(projects.filter(p => assignedProjectIds.includes(p.id)).map(p => p.programId));
        return programs.filter(p => programIds.has(p.id));
    }, [programs, projects, user]);
    
    if (loading) return <p className="text-center text-red-500">Loading Operational Data...</p>;

    return (
        <div className="space-y-6">
            {canManage && <ManagementPanel />}
            <Card>
                <h2 className="text-2xl text-red-400 mb-4">Organizational Dashboard</h2>
                {visiblePrograms.length === 0 && <p className="text-gray-500">No {terminology.programs} assigned or available.</p>}
                {visiblePrograms.map(program => <Program key={program.id} program={program} onNavigateToBilling={onNavigateToBilling} />)}
            </Card>
        </div>
    );
};

const Program = ({ program, onNavigateToBilling = null }) => {
    const { user } = useAuth();
    const { projects } = useData();
    const { terminology } = useTerminology();
    const [isExpanded, setIsExpanded] = useState(true);

    const visibleProjects = useMemo(() => {
         const programProjects = projects.filter(p => p.programId === program.id);
        if (user.role === 'master' || user.role === 'admin') return programProjects;
        const assignedProjectIds = user.assignedProjects || [];
        return programProjects.filter(p => assignedProjectIds.includes(p.id));
    }, [projects, program.id, user]);

    return (
        <div className="p-4 border border-red-800 bg-gray-900/50 mb-4">
            <div onClick={() => setIsExpanded(!isExpanded)} className="flex justify-between items-center cursor-pointer">
                <h3 className="font-bold text-xl text-red-500">{program.name}</h3>
                <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>v</span>
            </div>
            {isExpanded && (
                <div className="mt-4 pl-4 border-l-2 border-red-700 space-y-3">
                    {visibleProjects.length > 0 ? visibleProjects.map(project => <Project key={project.id} project={project} onNavigateToBilling={onNavigateToBilling} />)
                     : <p className="text-sm text-gray-500">No {terminology.projects} assigned in this {terminology.program}.</p>}
                </div>
            )}
        </div>
    );
};

const Project = ({ project, onNavigateToBilling = null }) => {
    const { processes, tasks } = useData();
    const { terminology } = useTerminology();

    const projectProcesses = useMemo(() => processes.filter(proc => proc.projectId === project.id), [processes, project.id]);
    const projectTasks = useMemo(() => tasks.filter(t => t.projectId === project.id), [tasks, project.id]);
    const unassignedTasks = useMemo(() => projectTasks.filter(task => !task.processId), [projectTasks]);

    return (
         <div className="mt-3">
            <h4 className="font-semibold text-red-400">{project.name}</h4>
            {projectProcesses.length > 0 && (
                <div className="mt-2 space-y-3">
                    {projectProcesses.map(process => (
                        <Process key={process.id} process={process} tasks={projectTasks} onNavigateToBilling={onNavigateToBilling} />
                    ))}
                </div>
            )}
            {unassignedTasks.length > 0 && (
                <div className="mt-3">
                    <p className="text-sm text-red-300 font-semibold">{terminology.tasks} without an active {terminology.process}:</p>
                    <ul className="list-disc pl-5 text-xs mt-1 space-y-1">
                        {unassignedTasks.map(task => (
                            <li key={task.id} className="flex items-center justify-between gap-2">
                                <span>{task.title}</span>
                                {isBillingTask(task) && (
                                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-300">
                                        <span>Billing</span>
                                        {typeof onNavigateToBilling === 'function' && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.preventDefault(); onNavigateToBilling(); }}
                                                className="text-red-300 underline hover:text-red-200"
                                            >
                                                Open
                                            </button>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {projectProcesses.length === 0 && unassignedTasks.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">No {terminology.processes} or {terminology.tasks} logged for this {terminology.project} yet.</p>
            )}
        </div>
    )
};

const Process = ({ process, tasks, onNavigateToBilling = null }) => {
    const { terminology } = useTerminology();
    const processLead = process.lead || process.owner || process.pointOfContact;
    const processTasks = useMemo(() => tasks.filter(task => task.processId === process.id), [tasks, process.id]);

    return (
        <div className="border border-red-900 bg-gray-900/60 p-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h5 className="text-red-300 font-semibold">{process.name}</h5>
                <div className="flex flex-wrap items-center gap-3 text-xs text-red-400 uppercase tracking-wide">
                    {process.status && <span>Status: {process.status}</span>}
                    {processLead && <span>Lead: {processLead}</span>}
                </div>
            </div>
            {process.description && <p className="text-xs text-gray-400 mt-1">{process.description}</p>}
            <ul className="list-disc pl-5 text-xs mt-2 space-y-1">
                {processTasks.length > 0 ? (
                    processTasks.map(task => (
                        <li key={task.id} className="flex items-center justify-between gap-2">
                            <span>{task.title}</span>
                            {isBillingTask(task) && (
                                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-300">
                                    <span>Billing</span>
                                    {typeof onNavigateToBilling === 'function' && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); onNavigateToBilling(); }}
                                            className="text-red-300 underline hover:text-red-200"
                                        >
                                            Open
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    ))
                ) : (
                    <li className="list-none text-gray-500">No {terminology.tasks} assigned.</li>
                )}
            </ul>
        </div>
    );
};


// --- KANBAN DASHBOARD ---
const KanbanDashboard = ({ onNavigateToBilling = null }) => {
    const { tasks, loading } = useData();
    const [draggedTaskId, setDraggedTaskId] = useState(null);
    const [activeColumn, setActiveColumn] = useState('');
    const [kanbanMessage, setKanbanMessage] = useState(null);
    const [nowTick, setNowTick] = useState(Date.now());

    useEffect(() => {
        const intervalId = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(intervalId);
    }, []);

    const columns = useMemo(() => ({
        todo: { name: 'To Do', items: tasks.filter(t => (t.status || 'todo') === 'todo') },
        inprogress: { name: 'In Progress', items: tasks.filter(t => t.status === 'inprogress') },
        done: { name: 'Done', items: tasks.filter(t => t.status === 'done') },
    }), [tasks]);

    const dependencyOptions = useMemo(() => {
        const options = [
            { value: '', label: 'No dependency' },
            { value: '__other__', label: 'Other (external blocker)' },
        ];

        tasks
            .filter(task => task.id && (task.status || 'todo') !== 'done')
            .forEach(task => {
                const label = task.title || task.name || `Task ${task.id}`;
                options.push({ value: task.id, label });
            });

        return options;
    }, [tasks]);

    const formatDate = (value) => {
        if (!value) return null;
        try {
            if (typeof value.toDate === 'function') return value.toDate().toLocaleDateString();
            if (value.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
        } catch (err) {
            return null;
        }
    };

    const parseTimestamp = (value) => {
        if (!value) return null;
        try {
            if (typeof value.toDate === 'function') return value.toDate();
            if (value.seconds) return new Date(value.seconds * 1000);
            if (value instanceof Date) return value;
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        } catch (err) {
            return null;
        }
    };

    const formatDuration = (totalSeconds) => {
        if (typeof totalSeconds !== 'number' || Number.isNaN(totalSeconds) || totalSeconds < 0) {
            return null;
        }
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts = [];
        if (hours) parts.push(`${hours}h`);
        if (minutes || hours) parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);
        return parts.join(' ');
    };

    const getDurationSeconds = (task, status, referenceMs = Date.now()) => {
        const startDate = parseTimestamp(task.timerStartedAt)
            || parseTimestamp(task.startDate)
            || parseTimestamp(task.beginDate)
            || parseTimestamp(task.createdAt);
        if (!startDate) return null;

        if (status === 'done') {
            if (typeof task.timeSpentSeconds === 'number') {
                return Math.max(0, Math.round(task.timeSpentSeconds));
            }
            const stopDate = parseTimestamp(task.timerStoppedAt)
                || parseTimestamp(task.completedAt)
                || parseTimestamp(task.dueDate)
                || parseTimestamp(task.endDate);
            const stopMs = stopDate ? stopDate.getTime() : referenceMs;
            return Math.max(0, Math.round((stopMs - startDate.getTime()) / 1000));
        }

        return Math.max(0, Math.round((referenceMs - startDate.getTime()) / 1000));
    };

    const handleDrop = async (columnId) => {
        if (!draggedTaskId) return;

        const task = tasks.find(t => t.id === draggedTaskId);
        if (!task) {
            setDraggedTaskId(null);
            setActiveColumn('');
            return;
        }

        try {
            const updates = {
                status: columnId,
                updatedAt: serverTimestamp(),
            };

            if (columnId === 'inprogress') {
                updates.timerStartedAt = serverTimestamp();
                updates.timerStoppedAt = deleteField();
                updates.timeSpentSeconds = deleteField();
            }

            if (columnId === 'todo') {
                updates.timerStartedAt = deleteField();
                updates.timerStoppedAt = deleteField();
                updates.timeSpentSeconds = deleteField();
            }

            if (columnId === 'done') {
                const elapsedSeconds = getDurationSeconds(task, 'done', Date.now());
                updates.timerStoppedAt = serverTimestamp();
                if (elapsedSeconds !== null) {
                    updates.timeSpentSeconds = elapsedSeconds;
                }
            }

            await updateDoc(doc(db, 'tasks', draggedTaskId), updates);
            const destination = columns[columnId]?.name || columnId;
            setKanbanMessage({ type: 'success', text: `Task redeployed to ${destination}.` });
        } catch (error) {
            console.error('Failed to update task status:', error);
            setKanbanMessage({ type: 'error', text: 'Unable to reposition task. Please try again.' });
        } finally {
            setDraggedTaskId(null);
            setActiveColumn('');
        }
    };

    const handleDragStart = (taskId) => {
        setKanbanMessage(null);
        setDraggedTaskId(taskId);
    };

    const handleDependencyChange = async (task, selectedValue) => {
        if (!task?.id) return;
        setKanbanMessage(null);

        try {
            const taskRef = doc(db, 'tasks', task.id);

            if (!selectedValue) {
                await updateDoc(taskRef, {
                    awaitingTaskId: deleteField(),
                    awaitingExternalReference: deleteField(),
                });
                return;
            }

            if (selectedValue === '__other__') {
                const existing = typeof task.awaitingExternalReference === 'string' ? task.awaitingExternalReference : '';
                const external = window.prompt('Describe the dependency or paste a link:', existing);
                if (external === null) return;

                const trimmed = external.trim();
                if (!trimmed) {
                    await updateDoc(taskRef, {
                        awaitingTaskId: '__other__',
                        awaitingExternalReference: deleteField(),
                    });
                } else {
                    await updateDoc(taskRef, {
                        awaitingTaskId: '__other__',
                        awaitingExternalReference: trimmed,
                    });
                }
                setKanbanMessage({ type: 'success', text: 'Awaiting dependency recorded.' });
                return;
            }

            await updateDoc(taskRef, {
                awaitingTaskId: selectedValue,
                awaitingExternalReference: deleteField(),
            });
            setKanbanMessage({ type: 'success', text: 'Awaiting dependency recorded.' });
        } catch (error) {
            console.error('Failed to update dependency:', error);
            setKanbanMessage({ type: 'error', text: 'Unable to update dependency. Please try again.' });
        }
    };

    const resolveDependencyDetails = (task) => {
        if (!task?.awaitingTaskId) return null;

        if (task.awaitingTaskId === '__other__') {
            const label = task.awaitingExternalReference || 'External dependency';
            const href = label.startsWith('http://') || label.startsWith('https://') ? label : null;
            return { label, href, external: true };
        }

        const referenced = tasks.find(t => t.id === task.awaitingTaskId);
        if (!referenced) {
            return { label: 'Awaiting unknown task', href: null, external: false };
        }

        const label = referenced.title || referenced.name || `Task ${referenced.id}`;
        return { label, href: `#task-${referenced.id}`, external: false };
    };

    if (loading) return <p className="text-center text-red-500">Loading Tasks...</p>;

    return (
        <Card>
            <h2 className="text-2xl text-red-400 mb-2">Kanban Board</h2>
            <p className="text-xs text-gray-400 mb-4">Drag and drop tasks between phases to update their operational status.</p>
            {kanbanMessage && (
                <p className={`text-xs mb-4 ${kanbanMessage.type === 'error' ? 'text-yellow-300' : 'text-green-400'}`}>
                    {kanbanMessage.text}
                </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(columns).map(([id, column]) => {
                    const isActive = activeColumn === id;
                    return (
                        <div
                            key={id}
                            className={`p-3 bg-gray-900 border ${isActive ? 'border-red-500 shadow-[0_0_12px_rgba(255,0,0,0.45)]' : 'border-red-900'} min-h-[240px] transition-all`}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnter={() => draggedTaskId && setActiveColumn(id)}
                            onDragLeave={() => setActiveColumn(prev => (prev === id ? '' : prev))}
                            onDrop={() => handleDrop(id)}
                        >
                            <h3 className="font-bold text-red-500 mb-2">{column.name}</h3>
                            <div className="space-y-2 min-h-[180px]">
                                {column.items.map(task => {
                                    const startLabel = formatDate(task.startDate || task.start);
                                    const dueLabel = formatDate(task.dueDate || task.endDate || task.targetDate);
                                    const taskOwner = task.assignedTo || task.owner || task.pointOfContact;
                                    const durationSeconds = getDurationSeconds(task, id, nowTick);
                                    const durationLabel = durationSeconds !== null ? formatDuration(durationSeconds) : null;
                                    const durationText = durationLabel ? (id === 'done' ? `Cycle time: ${durationLabel}` : id === 'inprogress' ? `Elapsed: ${durationLabel}` : `Aging: ${durationLabel}`) : null;
                                    const timerStartDate = parseTimestamp(task.timerStartedAt);
                                    const timerStopDate = parseTimestamp(task.timerStoppedAt);
                                    const dependencyInfo = resolveDependencyDetails(task);
                                    const availableDependencies = dependencyOptions.filter(option => option.value === '' || option.value === '__other__' || option.value !== task.id);
                                    const billingFlag = isBillingTask(task);
                                    return (
                                        <div
                                            key={task.id}
                                            id={`task-${task.id}`}
                                            draggable
                                            onDragStart={() => handleDragStart(task.id)}
                                            onDragEnd={() => setDraggedTaskId(null)}
                                            className={`p-3 bg-gray-800 border ${draggedTaskId === task.id ? 'border-red-500' : 'border-red-700'} cursor-move transition-colors`}
                                        >
                                            <p className="font-semibold">{task.title}</p>
                                            {billingFlag && (
                                                <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-amber-300">
                                                    <span>Billing</span>
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (typeof onNavigateToBilling === 'function') onNavigateToBilling(); }}
                                                        className="text-red-300 underline hover:text-red-200"
                                                    >
                                                        Open Console
                                                    </button>
                                                </div>
                                            )}
                                            {task.description && <p className="text-xs text-gray-400 mt-1 line-clamp-3">{task.description}</p>}
                                            {taskOwner && <p className="text-xs text-gray-300 mt-2">Assigned to {taskOwner}</p>}
                                            {durationText && (
                                                <p className="text-xs text-gray-300 mt-2">{durationText}</p>
                                            )}
                                            {id === 'inprogress' && timerStartDate && (
                                                <p className="text-[10px] text-gray-500">Started {timerStartDate.toLocaleString()}</p>
                                            )}
                                            {id === 'done' && timerStopDate && (
                                                <p className="text-[10px] text-gray-500">Finished {timerStopDate.toLocaleString()}</p>
                                            )}
                                            <div className="mt-2">
                                                <Label className="text-[10px] uppercase tracking-wide text-gray-500">Awaiting</Label>
                                                <Select
                                                    value={task.awaitingTaskId || ''}
                                                    onChange={(event) => handleDependencyChange(task, event.target.value)}
                                                >
                                                    {availableDependencies.filter(option => option.value !== task.id).map(option => (
                                                        <option key={option.value || 'none'} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </div>
                                            {dependencyInfo && (
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <span className="text-[10px] uppercase tracking-wide text-gray-500">Awaiting:</span>
                                                    {dependencyInfo.href ? (
                                                        <a
                                                            className="text-xs text-blue-300 hover:underline"
                                                            href={dependencyInfo.href}
                                                            target={dependencyInfo.external ? '_blank' : undefined}
                                                            rel={dependencyInfo.external ? 'noreferrer' : undefined}
                                                        >
                                                            {dependencyInfo.label}
                                                        </a>
                                                    ) : (
                                                        <span className="text-xs text-gray-300">{dependencyInfo.label}</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="text-[10px] text-red-300 hover:underline"
                                                        onClick={() => handleDependencyChange(task, '')}
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            )}
                                            {(startLabel || dueLabel) && (
                                                <p className="text-xs text-red-300 mt-2">
                                                    {startLabel && `Start ${startLabel}`}
                                                    {startLabel && dueLabel && ' -> '}
                                                    {dueLabel && `Due ${dueLabel}`}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                                {column.items.length === 0 && (
                                    <div className="flex items-center justify-center h-full text-xs text-gray-500 italic">
                                        Drop tasks here to populate {column.name}.
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
};

// --- GANTT & ADMIN DASHBOARDS ---
const GanttDashboard = ({ onNavigateToBilling = null }) => {
    const { tasks, loading } = useData();

    const timeline = useMemo(() => {
        const parseDate = (value) => {
            if (!value) return null;
            try {
                if (typeof value.toDate === 'function') return value.toDate();
                if (value.seconds) return new Date(value.seconds * 1000);
                const parsed = new Date(value);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            } catch (err) {
                return null;
            }
        };

        let unscheduled = 0;
        const scheduled = tasks.map(task => {
            const start = parseDate(task.startDate || task.start || task.beginDate || task.createdAt);
            const end = parseDate(task.dueDate || task.endDate || task.targetDate || task.completionDate);
            if (!start && !end) {
                unscheduled += 1;
                return null;
            }
            const safeStart = start || end;
            const safeEnd = end && end >= safeStart ? end : safeStart;
            return {
                id: task.id,
                title: task.title || 'Untitled Task',
                start: safeStart,
                end: safeEnd,
                owner: task.assignedTo || task.owner || task.pointOfContact || '',
                billing: isBillingTask(task),
            };
        }).filter(Boolean);

        if (!scheduled.length) {
            return { start: null, end: null, items: [], unscheduled };
        }

        scheduled.sort((a, b) => a.start - b.start);
        const rangeStart = scheduled.reduce((min, item) => (item.start < min ? item.start : min), scheduled[0].start);
        const rangeEnd = scheduled.reduce((max, item) => (item.end > max ? item.end : max), scheduled[0].end);
        const totalMs = Math.max(rangeEnd.getTime() - rangeStart.getTime(), 1);
        const now = Date.now();
        const nowOffset = now >= rangeStart.getTime() && now <= rangeEnd.getTime()
            ? ((now - rangeStart.getTime()) / totalMs) * 100
            : null;

        return {
            start: rangeStart,
            end: rangeEnd,
            items: scheduled.map(item => ({
                ...item,
                offset: ((item.start.getTime() - rangeStart.getTime()) / totalMs) * 100,
                width: Math.max(((item.end.getTime() - item.start.getTime()) / totalMs) * 100, 2),
            })),
            unscheduled,
            nowOffset,
        };
    }, [tasks]);

    if (loading) {
        return <p className="text-center text-red-500">Loading scheduling data...</p>;
    }

    return (
        <Card>
            <h2 className="text-2xl text-red-400 mb-2">Gantt Chart</h2>
            <p className="text-xs text-gray-400 mb-4">Visualize mission checkpoints across their operational timelines.</p>
            {timeline.items.length === 0 ? (
                <p className="text-gray-500 text-sm">No tasks currently have scheduling metadata. Add start and due dates to see them plotted here.</p>
            ) : (
                <div className="space-y-4">
                    {timeline.items.map(item => (
                        <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3 items-center">
                            <div>
                                <p className="text-sm font-semibold text-red-300">{item.title}</p>
                                <p className="text-xs text-gray-400">{item.start.toLocaleDateString()} &rarr; {item.end.toLocaleDateString()}</p>
                                {item.owner && <p className="text-xs text-gray-500 mt-1">Owner: {item.owner}</p>}
                                {item.billing && (
                                    <div className="text-[10px] uppercase tracking-wide text-amber-300 mt-1">
                                        Billing
                                        <button
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); if (typeof onNavigateToBilling === 'function') onNavigateToBilling(); }}
                                            className="ml-2 text-red-300 underline hover:text-red-200"
                                        >
                                            Open Console
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="relative h-8 bg-gray-950 border border-red-900 overflow-hidden">
                                {timeline.nowOffset !== null && (
                                    <div className="absolute top-0 bottom-0 w-[2px] bg-red-500/40" style={{ left: `${timeline.nowOffset}%` }} />
                                )}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 h-3 bg-gradient-to-r from-red-600 to-red-400 rounded"
                                    style={{ left: `${item.offset}%`, width: `${item.width}%` }}
                                />
                            </div>
                        </div>
                    ))}
                    {timeline.start && timeline.end && (
                        <div className="text-xs text-gray-500 flex justify-between">
                            <span>{timeline.start.toLocaleDateString()}</span>
                            <span>{timeline.end.toLocaleDateString()}</span>
                        </div>
                    )}
                </div>
            )}
            {timeline.unscheduled > 0 && (
                <p className="text-xs text-gray-400 mt-4">{timeline.unscheduled} {timeline.unscheduled === 1 ? 'task is' : 'tasks are'} awaiting scheduling data.</p>
            )}
        </Card>
    );
};
const AdminDashboard = () => {
    const { users, projects, processes } = useData();
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [adminMessage, setAdminMessage] = useState(null);

    const selectedUser = useMemo(() => users.find(u => u.id === selectedUserId) || null, [users, selectedUserId]);

    const toggleAssignment = async (userId, field, itemId, label) => {
        try {
            const userRef = doc(db, 'users', userId);
            const snapshot = await getDoc(userRef);
            if (!snapshot.exists()) {
                setAdminMessage({ type: 'error', text: 'User record not found.' });
                return;
            }
            const current = snapshot.data()[field] || [];
            const updated = current.includes(itemId)
                ? current.filter(id => id !== itemId)
                : [...current, itemId];
            await updateDoc(userRef, { [field]: updated });
            setAdminMessage({ type: 'success', text: `${label} access updated.` });
        } catch (error) {
            console.error('Failed to update assignments:', error);
            setAdminMessage({ type: 'error', text: 'Unable to update assignments. Please try again.' });
        }
    };

    const handleAssignProject = (userId, projectId) => {
        const projectName = projects.find(p => p.id === projectId)?.name || 'Project';
        toggleAssignment(userId, 'assignedProjects', projectId, `${projectName} project`);
    };

    const handleAssignProcess = (userId, processId) => {
        const processRecord = processes.find(p => p.id === processId);
        const label = processRecord ? `${processRecord.name} process` : 'Process';
        toggleAssignment(userId, 'assignedProcesses', processId, label);
    };

    const getProjectName = (projectId) => projects.find(p => p.id === projectId)?.name || 'Unassigned Project';

    return (
        <Card>
            <h2 className="text-2xl text-red-400 mb-2">Admin: Access Control</h2>
            <p className="text-xs text-gray-400 mb-4">Assign {`project`} and process permissions to each operator.</p>
            {adminMessage && (
                <p className={`text-xs mb-4 ${adminMessage.type === 'error' ? 'text-yellow-300' : 'text-green-400'}`}>
                    {adminMessage.text}
                </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 className="font-bold text-red-500 mb-2">User Roster</h3>
                    <div className="space-y-2">
                        {users.map(user => {
                            const isActive = selectedUserId === user.id;
                            return (
                                <div
                                    key={user.id}
                                    onClick={() => { setSelectedUserId(user.id); setAdminMessage(null); }}
                                    className={`p-3 cursor-pointer border transition-colors ${isActive ? 'bg-red-900/50 border-red-500' : 'bg-gray-900 border-red-900'}`}
                                >
                                    <div className="flex justify-between items-center">
                                        <p>{user.name || user.email}</p>
                                        <span className="text-xs text-gray-400 uppercase tracking-wide">{user.role}</span>
                                    </div>
                                    <p className="text-xs text-gray-500">{user.email}</p>
                                    <p className="text-xs text-gray-500 mt-1">{(user.assignedProjects || []).length} projects | {(user.assignedProcesses || []).length} processes</p>
                                </div>
                            );
                        })}
                        {users.length === 0 && <p className="text-sm text-gray-500">No users registered.</p>}
                    </div>
                </div>
                <div>
                    <h3 className="font-bold text-red-500 mb-2">Access Controls for {selectedUser ? (selectedUser.name || selectedUser.email) : '...'}</h3>
                    {selectedUser ? (
                        <div className="space-y-5">
                            <div>
                                <h4 className="text-sm font-semibold text-red-400 mb-2">Project Clearance</h4>
                                {projects.length ? (
                                    <div className="space-y-2">
                                        {projects.map(project => (
                                            <label key={project.id} className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={(selectedUser.assignedProjects || []).includes(project.id)}
                                                    onChange={() => handleAssignProject(selectedUser.id, project.id)}
                                                />
                                                {project.name}
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">No projects defined for this organization.</p>
                                )}
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-red-400 mb-2">Process Clearance</h4>
                                {processes.length ? (
                                    <div className="space-y-2">
                                        {processes.map(process => (
                                            <div key={process.id} className="border border-red-900 bg-gray-900/60 p-2">
                                                <label className="flex items-center gap-2 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={(selectedUser.assignedProcesses || []).includes(process.id)}
                                                        onChange={() => handleAssignProcess(selectedUser.id, process.id)}
                                                    />
                                                    {process.name}
                                                </label>
                                                <p className="text-xs text-gray-500 ml-6">{getProjectName(process.projectId)}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">No processes defined. Create processes from the management panel.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-500">Select a user to manage their project and process access.</p>
                    )}
                </div>
            </div>
        </Card>
    );
};

// --- MANAGEMENT PANEL ---
const ManagementPanel = () => {
    const { user } = useAuth();
    const { programs, projects, processes } = useData();
    const { terminology } = useTerminology();
    const [feedback, setFeedback] = useState(null);
    const [processProjectId, setProcessProjectId] = useState('');
    const [taskProjectId, setTaskProjectId] = useState('');
    const [taskProcessId, setTaskProcessId] = useState('');

    const handleCreate = async (collectionName, data, resetCallback, successMessage) => {
        setFeedback(null);
        try {
            await addDoc(collection(db, collectionName), {
                ...data,
                orgId: user.orgId,
                createdBy: user.uid,
                createdAt: serverTimestamp(),
            });
            resetCallback?.();
            setFeedback({ type: 'success', text: successMessage });
        } catch (e) {
            console.error('Create error:', e);
            setFeedback({ type: 'error', text: 'Unable to complete the request. Verify the fields and try again.' });
        }
    };

    return (
        <Card className="mb-8">
            <h2 className="text-xl text-red-400 mb-2">Operations Management</h2>
            <p className="text-xs text-gray-400">Stand up new {terminology.programs.toLowerCase()}, {terminology.projects.toLowerCase()}, {terminology.processes.toLowerCase()} and {terminology.tasks.toLowerCase()} from a single console.</p>
            {feedback && (
                <p className={`text-xs mt-4 ${feedback.type === 'error' ? 'text-yellow-300' : 'text-green-400'}`}>
                    {feedback.text}
                </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <form
                    onSubmit={async e => {
                        e.preventDefault();
                        const name = e.target.programName.value.trim();
                        if (!name) return;
                        const description = e.target.programDescription.value.trim();
                        const payload = { name };
                        if (description) payload.description = description;
                        await handleCreate('programs', payload, () => e.target.reset(), `${terminology.program} created.`);
                    }}
                    className="space-y-3"
                >
                    <h3 className="font-bold text-red-500">Define {terminology.program}</h3>
                    <Input name="programName" placeholder={`New ${terminology.program} Name`} required />
                    <TextArea name="programDescription" placeholder="Optional description" rows={3} />
                    <Button type="submit">Create {terminology.program}</Button>
                </form>
                <form
                    onSubmit={async e => {
                        e.preventDefault();
                        if (!programs.length) {
                            setFeedback({ type: 'error', text: `Create a ${terminology.program.toLowerCase()} before deploying a ${terminology.project.toLowerCase()}.` });
                            return;
                        }
                        const name = e.target.projectName.value.trim();
                        const programId = e.target.programId.value;
                        if (!programId) {
                            setFeedback({ type: 'error', text: `Select a ${terminology.program.toLowerCase()} for the new ${terminology.project.toLowerCase()}.` });
                            return;
                        }
                        const description = e.target.projectDescription.value.trim();
                        const payload = { name, programId };
                        if (description) payload.description = description;
                        await handleCreate('projects', payload, () => e.target.reset(), `${terminology.project} deployed.`);
                    }}
                    className="space-y-3"
                >
                    <h3 className="font-bold text-red-500">Deploy {terminology.project}</h3>
                    <Input name="projectName" placeholder={`New ${terminology.project} Name`} required />
                    <TextArea name="projectDescription" placeholder="Optional description" rows={3} />
                    <Select name="programId" defaultValue="" required disabled={!programs.length}>
                        <option value="">{programs.length ? `Assign to ${terminology.program}...` : `Create a ${terminology.program} first`}</option>
                        {programs.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </Select>
                    <Button type="submit">Deploy {terminology.project}</Button>
                </form>
                <form
                    onSubmit={async e => {
                        e.preventDefault();
                        if (!projects.length) {
                            setFeedback({ type: 'error', text: `Deploy a ${terminology.project.toLowerCase()} before establishing a ${terminology.process.toLowerCase()}.` });
                            return;
                        }
                        const name = e.target.processName.value.trim();
                        const projectId = processProjectId;
                        if (!projectId) {
                            setFeedback({ type: 'error', text: `Select a ${terminology.project.toLowerCase()} for the new ${terminology.process.toLowerCase()}.` });
                            return;
                        }
                        const description = e.target.processDescription.value.trim();
                        const status = e.target.processStatus.value;
                        const project = projects.find(p => p.id === projectId);
                        const payload = {
                            name,
                            projectId,
                            status,
                        };
                        if (project?.programId) payload.programId = project.programId;
                        if (description) payload.description = description;
                        await handleCreate('processes', payload, () => {
                            e.target.reset();
                            setProcessProjectId('');
                        }, `${terminology.process} established.`);
                    }}
                    className="space-y-3"
                >
                    <h3 className="font-bold text-red-500">Establish {terminology.process}</h3>
                    <Input name="processName" placeholder={`New ${terminology.process} Name`} required />
                    <TextArea name="processDescription" placeholder="Optional description" rows={3} />
                    <Select
                        name="processProjectId"
                        value={processProjectId}
                        onChange={e => setProcessProjectId(e.target.value)}
                        required
                        disabled={!projects.length}
                    >
                        <option value="">{projects.length ? `Anchor to ${terminology.project}...` : `Deploy a ${terminology.project} first`}</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                    </Select>
                    <Select name="processStatus" defaultValue="planning">
                        <option value="planning">Planning</option>
                        <option value="active">Active</option>
                        <option value="review">Review</option>
                        <option value="complete">Complete</option>
                    </Select>
                    <Button type="submit">Create {terminology.process}</Button>
                </form>
                <form
                    onSubmit={async e => {
                        e.preventDefault();
                        if (!projects.length) {
                            setFeedback({ type: 'error', text: `Deploy a ${terminology.project.toLowerCase()} before scheduling a ${terminology.task.toLowerCase()}.` });
                            return;
                        }
                        const title = e.target.taskTitle.value.trim();
                        const details = e.target.taskDetails.value.trim();
                        const status = e.target.taskStatus.value;
                        const startValue = e.target.taskStart.value;
                        const dueValue = e.target.taskDue.value;
                        const billingPreference = e.target.taskBilling.value;
                        const startDate = startValue ? new Date(startValue) : null;
                        const dueDate = dueValue ? new Date(dueValue) : null;
                        if (!taskProjectId) {
                            setFeedback({ type: 'error', text: `Select a ${terminology.project.toLowerCase()} for the ${terminology.task.toLowerCase()}.` });
                            return;
                        }
                        if (startDate && dueDate && dueDate < startDate) {
                            setFeedback({ type: 'error', text: 'Due date cannot be earlier than the start date.' });
                            return;
                        }
                        const project = projects.find(p => p.id === taskProjectId);
                        const payload = {
                            title,
                            projectId: taskProjectId,
                            status,
                            programId: project?.programId || '',
                        };
                        if (details) payload.description = details;
                        if (billingPreference === 'billing') payload.billing = true;
                        if (taskProcessId) payload.processId = taskProcessId;
                        if (startDate) payload.startDate = startDate;
                        if (dueDate) payload.dueDate = dueDate;
                        await handleCreate('tasks', payload, () => {
                            e.target.reset();
                            setTaskProjectId('');
                            setTaskProcessId('');
                        }, `${terminology.task} scheduled.`);
                    }}
                    className="md:col-span-2 space-y-3"
                >
                    <h3 className="font-bold text-red-500">Schedule {terminology.task}</h3>
                    <Input name="taskTitle" placeholder={`${terminology.task} Title`} required />
                    <TextArea name="taskDetails" placeholder="Optional details" rows={3} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Select
                            name="taskProjectId"
                            value={taskProjectId}
                            onChange={e => {
                                setTaskProjectId(e.target.value);
                                setTaskProcessId('');
                            }}
                            required
                            disabled={!projects.length}
                        >
                            <option value="">{projects.length ? `Assign to ${terminology.project}...` : `Deploy a ${terminology.project} first`}</option>
                            {projects.map(project => (
                                <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                        </Select>
                        <Select
                            name="taskProcessId"
                            value={taskProcessId}
                            onChange={e => setTaskProcessId(e.target.value)}
                            disabled={!taskProjectId || !processes.length}
                        >
                            <option value="">{taskProjectId ? `Link to ${terminology.process} (optional)` : 'Select a project first'}</option>
                            {processes
                                .filter(process => process.projectId === taskProjectId)
                                .map(process => (
                                    <option key={process.id} value={process.id}>{process.name}</option>
                                ))}
                        </Select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Input type="date" name="taskStart" />
                        <Input type="date" name="taskDue" />
                    </div>
                    <Select name="taskBilling" defaultValue="">
                        <option value="">General Task</option>
                        <option value="billing">Billing Task</option>
                    </Select>
                    <Select name="taskStatus" defaultValue="todo">
                        <option value="todo">To Do</option>
                        <option value="inprogress">In Progress</option>
                        <option value="done">Done</option>
                    </Select>
                    <Button type="submit">Schedule {terminology.task}</Button>
                </form>
            </div>
        </Card>
    );
};

export { useAuth, useTerminology, useData };
