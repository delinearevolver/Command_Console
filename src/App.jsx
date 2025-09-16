import React, { useState, useEffect, createContext, useContext, useMemo } from "react";

// --- Firebase SDK Imports ---
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  writeBatch,
  updateDoc,
  addDoc,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// --- Firebase Configuration ---
// (apiKey is fine to commit; do NOT commit service accounts)
const firebaseConfig = {
  apiKey: "AIzaSyBySosb9TmWEEDZsqwxO2FiKRxUKQLj7es",
  authDomain: "fearless-leader.firebaseapp.com",
  projectId: "fearless-leader",
  storageBucket: "fearless-leader.appspot.com", // usual bucket pattern
  messagingSenderId: "891476346781",
  appId: "1:891476346781:web:ac9faa21e1caa831101174",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app); // kept for future use

// --- CONTEXTS ---
const AuthContext = createContext();
const TerminologyContext = createContext();
const DataContext = createContext();

// --- TERMINOLOGY SETS ---
const terminologies = {
  standard: {
    program: "Program",
    programs: "Programs",
    project: "Project",
    projects: "Projects",
    process: "Process",
    processes: "Processes",
    milestone: "Milestone",
    task: "Task",
    tasks: "Tasks",
  },
  imperial: {
    program: "Operation",
    programs: "Operations",
    project: "Mission",
    projects: "Missions",
    process: "Protocol",
    processes: "Protocols",
    milestone: "Objective",
    task: "Checkpoint",
    tasks: "Checkpoints",
  },
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
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
};

const TerminologyProvider = ({ children }) => {
  const [terminology, setTerminology] = useState(terminologies.standard);
  const toggleTerminology = () =>
    setTerminology((prev) => (prev.program === "Program" ? terminologies.imperial : terminologies.standard));
  return <TerminologyContext.Provider value={{ terminology, toggleTerminology }}>{children}</TerminologyContext.Provider>;
};

const DataProvider = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [data, setData] = useState({
    programs: [],
    projects: [],
    processes: [],
    tasks: [],
    users: [],
    loading: true,
  });

  useEffect(() => {
    if (!user || !user.orgId) {
      setData((d) => ({ ...d, loading: false, programs: [], projects: [], processes: [], tasks: [], users: [] }));
      return;
    }

    const unsubscribes = [];
    setData((d) => ({ ...d, loading: true }));

    const collectionsToFetch = ["programs", "processes", "projects", "tasks", "users"];
    collectionsToFetch.forEach((col) => {
      const q = query(collection(db, col), where("orgId", "==", user.orgId));
      const unsub = onSnapshot(
        q,
        (snap) => {
          setData((prev) => ({ ...prev, [col]: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }));
        },
        (err) => console.error(`Error fetching ${col}:`, err)
      );
      unsubscribes.push(unsub);
    });

    const timer = setTimeout(() => setData((prev) => ({ ...prev, loading: false })), 1500);

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      clearTimeout(timer);
    };
  }, [user]);

  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
};

// --- HOOKS ---
const useAuth = () => useContext(AuthContext);
const useTerminology = () => useContext(TerminologyContext);
const useData = () => useContext(DataContext);

// --- Simple UI Bits ---
const Card = ({ children, className = "" }) => (
  <div className={`p-4 sm:p-6 border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] bg-black bg-opacity-80 ${className}`}>
    {children}
  </div>
);
const Input = (props) => (
  <input {...props} className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none" />
);
const Button = ({ children, ...props }) => (
  <button
    {...props}
    className={`w-full p-2 bg-red-800 hover:bg-red-700 font-bold disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors ${
      props.className || ""
    }`}
  >
    {children}
  </button>
);
const Select = ({ children, ...props }) => (
  <select
    {...props}
    className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none appearance-none"
    style={{
      backgroundImage: `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="%23ff0000" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708 .708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>')`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 0.5rem center",
    }}
  >
    {children}
  </select>
);
const TextArea = (props) => (
  <textarea {...props} className="w-full p-2 bg-gray-900 border border-red-700 focus:border-red-500 focus:outline-none" />
);

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
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [userName, setUserName] = useState("");

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");
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
        batch.set(userRef, {
          name: userName,
          email: user.email,
          orgId: orgRef.id,
          role: "master",
          assignedProjects: [],
          assignedProcesses: [],
        });
        await batch.commit();
      }
    } catch (err) {
      setError(String(err.message || err).replace("Firebase: ", ""));
    }
  };

  return (
    <div className="flex justify-center items-center h-screen p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-3xl text-center text-red-500 mb-6">
          {isLogin ? "Command Console Login" : "Establish First Organization"}
        </h1>
        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && <Input type="text" placeholder="Your Name" value={userName} onChange={(e) => setUserName(e.target.value)} required />}
          {!isLogin && (
            <Input type="text" placeholder="Organization Name" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
          )}
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password (min. 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit">{isLogin ? "Login" : "Create Master Account"}</Button>
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
  const [view, setView] = useState("dashboard");
  const { terminology } = useTerminology();
  const canManage = user.role === "master" || user.role === "admin";

  return (
    <div className="p-4 sm:p-8">
      <header className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl text-red-500">Welcome, {user.name || user.email}</h1>
          <p className="text-red-300 text-sm">Role: {user.role.toUpperCase()}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => setView("dashboard")} className={`p-2 text-sm ${view === "dashboard" ? "bg-red-700" : "bg-gray-800"} border border-red-700`}>
            Dashboard
          </button>
          <button onClick={() => setView("kanban")} className={`p-2 text-sm ${view === "kanban" ? "bg-red-700" : "bg-gray-800"} border border-red-700`}>
            Kanban
          </button>
          <button onClick={() => setView("gantt")} className={`p-2 text-sm ${view === "gantt" ? "bg-red-700" : "bg-gray-800"} border border-red-700`}>
            Gantt
          </button>
          {canManage && (
            <button onClick={() => setView("admin")} className={`p-2 text-sm ${view === "admin" ? "bg-red-700" : "bg-gray-800"} border border-red-700`}>
              Admin
            </button>
          )}
          <button onClick={() => signOut(auth)} className="p-2 text-sm bg-gray-800 border border-red-700">
            Logout
          </button>
        </div>
      </header>

      {view === "dashboard" ? <HierarchyDashboard /> : view === "kanban" ? <KanbanDashboard /> : view === "gantt" ? <GanttDashboard /> : <AdminDashboard />}
    </div>
  );
};

// --- HIERARCHY DASHBOARD ---
const HierarchyDashboard = () => {
  const { user } = useAuth();
  const { programs, projects, tasks, loading } = useData();
  const { terminology } = useTerminology();
  const canManage = user.role === "master" || user.role === "admin";

  const visiblePrograms = useMemo(() => {
    if (user.role === "master" || user.role === "admin") return programs;
    const assignedProjectIds = user.assignedProjects || [];
    const programIds = new Set(projects.filter((p) => assignedProjectIds.includes(p.id)).map((p) => p.programId));
    return programs.filter((p) => programIds.has(p.id));
  }, [programs, projects, user]);

  if (loading) return <p className="text-center text-red-500">Loading Operational Data...</p>;

  return (
    <div className="space-y-6">
      {canManage && <ManagementPanel />}
      <Card>
        <h2 className="text-2xl text-red-400 mb-4">Organizational Dashboard</h2>
        {visiblePrograms.length === 0 && <p className="text-gray-500">No {terminology.programs} assigned or available.</p>}
        {visiblePrograms.map((program) => (
          <Program key={program.id} program={program} />
        ))}
      </Card>
    </div>
  );
};

const Program = ({ program }) => {
  const { user } = useAuth();
  const { projects } = useData();
  const { terminology } = useTerminology();
  const [isExpanded, setIsExpanded] = useState(true);

  const visibleProjects = useMemo(() => {
    const programProjects = projects.filter((p) => p.programId === program.id);
    if (user.role === "master" || user.role === "admin") return programProjects;
    const assignedProjectIds = user.assignedProjects || [];
    return programProjects.filter((p) => assignedProjectIds.includes(p.id));
  }, [projects, program.id, user]);

  return (
    <div className="p-4 border border-red-800 bg-gray-900/50 mb-4">
      <div onClick={() => setIsExpanded(!isExpanded)} className="flex justify-between items-center cursor-pointer">
        <h3 className="font-bold text-xl text-red-500">{program.name}</h3>
        <span className={`transform transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
      </div>
      {isExpanded && (
        <div className="mt-4 pl-4 border-l-2 border-red-700 space-y-3">
          {visibleProjects.length > 0 ? (
            visibleProjects.map((project) => <Project key={project.id} project={project} />)
          ) : (
            <p className="text-sm text-gray-500">
              No {terminology.projects} assigned in this {terminology.program}.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const Project = ({ project }) => {
  const { tasks } = useData();
  const { terminology } = useTerminology();

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === project.id), [tasks, project.id]);

  return (
    <div>
      <h4 className="font-semibold text-red-400">{project.name}</h4>
      <ul className="list-disc pl-5 text-sm my-2">
        {projectTasks.map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </div>
  );
};

// --- KANBAN DASHBOARD ---
const KanbanDashboard = () => {
  const { tasks, loading } = useData();

  const columns = useMemo(
    () => ({
      todo: { name: "To Do", items: tasks.filter((t) => t.status === "todo") },
      inprogress: { name: "In Progress", items: tasks.filter((t) => t.status === "inprogress") },
      done: { name: "Done", items: tasks.filter((t) => t.status === "done") },
    }),
    [tasks]
  );

  if (loading) return <p className="text-center text-red-500">Loading Tasks...</p>;

  return (
    <Card>
      <h2 className="text-2xl text-red-400 mb-4">Kanban Board</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(columns).map(([id, column]) => (
          <div key={id} className="p-3 bg-gray-900 border border-red-900 min-h-[200px]">
            <h3 className="font-bold text-red-500 mb-2">{column.name}</h3>
            <div className="space-y-2">
              {column.items.map((task) => (
                <div key={task.id} className="p-2 bg-gray-800 border border-red-700">
                  <p>{task.title}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// --- GANTT & ADMIN DASHBOARDS ---
const GanttDashboard = () => (
  <Card>
    <h2 className="text-2xl text-red-400">Gantt Chart</h2>
    <p className="text-center mt-4">Gantt Chart Visualization Area</p>
  </Card>
);

const AdminDashboard = () => {
  const { users, projects } = useData();
  const [selectedUser, setSelectedUser] = useState(null);

  const handleAssignProject = async (userId, projectId) => {
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);
    const currentProjects = userDoc.data().assignedProjects || [];
    const newProjects = currentProjects.includes(projectId)
      ? currentProjects.filter((id) => id !== projectId)
      : [...currentProjects, projectId];
    await updateDoc(userRef, { assignedProjects: newProjects });
  };

  return (
    <Card>
      <h2 className="text-2xl text-red-400 mb-4">Admin: User & Project Assignments</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-bold text-red-500 mb-2">User Roster</h3>
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className={`p-3 cursor-pointer ${selectedUser?.id === u.id ? "bg-red-900/50" : "bg-gray-900"} border border-red-900`}
              >
                <p>
                  {u.name} ({u.email})
                </p>
                <p className="font-bold text-red-400 text-sm">{u.role.toUpperCase()}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-bold text-red-500 mb-2">Project Assignments for {selectedUser ? selectedUser.name : "..."}</h3>
          {selectedUser ? (
            <div className="space-y-2">
              {projects.map((p) => (
                <div key={p.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(selectedUser.assignedProjects || []).includes(p.id)}
                      onChange={() => handleAssignProject(selectedUser.id, p.id)}
                    />
                    {p.name}
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">Select a user to manage their project access.</p>
          )}
        </div>
      </div>
    </Card>
  );
};

// --- MANAGEMENT PANEL ---
const ManagementPanel = () => {
  const { user } = useAuth();
  const { programs } = useData();

  const handleCreate = async (collectionName, data) => {
    try {
      await addDoc(collection(db, collectionName), { ...data, orgId: user.orgId });
    } catch (e) {
      console.error("Create error:", e);
    }
  };

  return (
    <Card className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate("programs", { name: e.target.programName.value });
          e.target.reset();
        }}
        className="space-y-3"
      >
        <h3 className="font-bold text-red-500">Define Program</h3>
        <Input name="programName" placeholder="New Program Name" required />
        <Button type="submit">Create Program</Button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate("projects", { name: e.target.projectName.value, programId: e.target.programId.value });
          e.target.reset();
        }}
        className="space-y-3"
      >
        <h3 className="font-bold text-red-500">Deploy Project</h3>
        <Input name="projectName" placeholder="New Project Name" required />
        <Select name="programId" required>
          <option value="">Assign to Program...</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button type="submit">Deploy Project</Button>
      </form>
    </Card>
  );
};
