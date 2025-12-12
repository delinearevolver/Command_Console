import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { Card, Input, Button, Select } from './ui';

const AccountsView = () => {
    const functions = getFunctions();
    const auth = getAuth();
    const [organizations, setOrganizations] = useState([]);
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState('');
    const [selectedOrg, setSelectedOrg] = useState('');
    const [newOrgName, setNewOrgName] = useState('');
    const [newOrgDesc, setNewOrgDesc] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    // Check if current user is allowed to create orgs
    const canCreateOrg = auth.currentUser?.email === 'delinearevolver@gmail.com';

    const createOrganization = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const createOrgFunction = httpsCallable(functions, 'createOrganization');
            await createOrgFunction({ 
                name: newOrgName, 
                description: newOrgDesc 
            });
            
            setSuccess('Organization created successfully!');
            setNewOrgName('');
            setNewOrgDesc('');
            // Refresh organizations list
            await fetchOrganizations();
        } catch (error) {
            setError(error.message || 'Failed to create organization');
        } finally {
            setLoading(false);
        }
    };

    const assignOrganization = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const assignOrgFunction = httpsCallable(functions, 'assignOrganization');
            await assignOrgFunction({
                userId: selectedUser,
                organizationId: selectedOrg
            });
            
            setSuccess('Organization assigned successfully!');
            setSelectedUser('');
            setSelectedOrg('');
        } catch (error) {
            setError(error.message || 'Failed to assign organization');
        } finally {
            setLoading(false);
        }
    };

    const fetchOrganizations = async () => {
        try {
            const db = getFirestore();
            const organizationsSnapshot = await getDocs(collection(db, 'organizations'));
            const orgs = [];
            organizationsSnapshot.forEach((doc) => {
                const orgData = doc.data();
                // Only include organizations where current user is an admin
                if (orgData.admins && orgData.admins.includes(auth.currentUser.uid)) {
                    orgs.push({ id: doc.id, ...orgData });
                }
            });
            setOrganizations(orgs);
        } catch (error) {
            console.error('Error fetching organizations:', error);
            setError('Failed to load organizations');
        }
    };

    const fetchUsers = async () => {
        try {
            const db = getFirestore();
            const usersSnapshot = await getDocs(collection(db, 'users'));
            const usersList = [];
            usersSnapshot.forEach((doc) => {
                const userData = doc.data();
                if (userData.email) { // Only include users with email addresses
                    usersList.push({ id: doc.id, ...userData });
                }
            });
            setUsers(usersList);
        } catch (error) {
            console.error('Error fetching users:', error);
            setError('Failed to load users');
        }
    };

    useEffect(() => {
        fetchOrganizations();
        fetchUsers();
    }, []);

    return (
        <div className="flex flex-col gap-6">
            {/* Organization Creation (Admin Only) */}
            {canCreateOrg && (
                <Card className="max-w-2xl mx-auto">
                    <h2 className="text-xl font-bold mb-4 text-red-400">Create Organization</h2>
                    <form onSubmit={createOrganization} className="flex flex-col gap-4">
                        <div>
                            <Input
                                type="text"
                                value={newOrgName}
                                onChange={(e) => setNewOrgName(e.target.value)}
                                placeholder="Organization Name"
                                required
                            />
                        </div>
                        <div>
                            <Input
                                type="text"
                                value={newOrgDesc}
                                onChange={(e) => setNewOrgDesc(e.target.value)}
                                placeholder="Description (optional)"
                            />
                        </div>
                        <Button type="submit" disabled={loading || !newOrgName}>
                            {loading ? 'Creating...' : 'Create Organization'}
                        </Button>
                    </form>
                </Card>
            )}

            {/* Organization Assignment (Admin Only) */}
            <Card className="max-w-2xl mx-auto">
                <h2 className="text-xl font-bold mb-4 text-red-400">Assign Organization</h2>
                {organizations.length === 0 ? (
                    <div className="text-gray-400 text-center mb-4">
                        You must be an organization administrator to assign users
                    </div>
                ) : null}
                <form onSubmit={assignOrganization} className="flex flex-col gap-4">
                    <div>
                        <Select
                            value={selectedUser}
                            onChange={(e) => setSelectedUser(e.target.value)}
                            required
                        >
                            <option value="">Select User</option>
                            {users.map((user) => (
                                <option key={user.id} value={user.id}>
                                    {user.email}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Select
                            value={selectedOrg}
                            onChange={(e) => setSelectedOrg(e.target.value)}
                            required
                        >
                            <option value="">Select Organization</option>
                            {organizations.map((org) => (
                                <option key={org.id} value={org.id}>
                                    {org.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <Button type="submit" disabled={loading || !selectedUser || !selectedOrg}>
                        {loading ? 'Assigning...' : 'Assign Organization'}
                    </Button>
                </form>
            </Card>

            {/* Error and Success Messages */}
            {error && (
                <div className="text-red-500 text-center mt-2">
                    {error}
                </div>
            )}
            {success && (
                <div className="text-green-500 text-center mt-2">
                    {success}
                </div>
            )}
        </div>
    );
};

export default AccountsView;