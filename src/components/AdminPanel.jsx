import React, { useState, useMemo } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Card } from './ui';
import { useData, useAuth } from '../App';
import { AccountsView } from './AccountsView';
import { db } from '../App';

// Import all other dependencies...

const AdminPanel = () => {
    const { users, projects, processes } = useData();
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [adminMessage, setAdminMessage] = useState(null);
    const [adminView, setAdminView] = useState('users');

    const selectedUser = users.find(u => u.id === selectedUserId);

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
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl text-red-400">Admin Control Panel</h2>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setAdminView('users')} 
                        className={`p-2 text-sm ${adminView === 'users' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}
                    >
                        User Management
                    </button>
                    <button 
                        onClick={() => setAdminView('organizations')} 
                        className={`p-2 text-sm ${adminView === 'organizations' ? 'bg-red-700' : 'bg-gray-800'} border border-red-700`}
                    >
                        Organizations
                    </button>
                </div>
            </div>

            {adminView === 'organizations' ? (
                <AccountsView />
            ) : (
                <div>
                    <h3 className="text-xl text-red-400 mb-2">Access Control</h3>
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
                                            <p className="text-xs text-gray-500 mt-1">{(user.assignedProjects || []).length} projects • {(user.assignedProcesses || []).length} processes</p>
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
                </div>
            )}
        </Card>
    );
};

export default AdminPanel;