import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, KeyRound, Pencil, Plus, RefreshCw, Search, UserCheck, UserX, UserRoundCog,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  useToast, Card, Modal, ConfirmDialog, Loading, EmptyState, RoleBadge,
} from '../components/ui.jsx';
import { formatDateTime, initials } from '../utils/format.js';
import '../styles/admin.css';

const ROLES = ['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD', 'STAFF'];
const DEPARTMENT_ROLES = ['DEPARTMENT_HEAD', 'STAFF'];
const EMPTY_FORM = {
  name: '', email: '', password: '', role: 'STAFF', departmentId: '', isActive: true,
};

const asList = (data, key) => (Array.isArray(data) ? data : (data?.[key] || []));
const asDeptId = (value) => (/^\d+$/.test(String(value)) ? Number(value) : value);

export default function Users() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);

  const [toggleTarget, setToggleTarget] = useState(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get('/users'),
      api.get('/departments?includeInactive=true'),
    ]).then(([userRes, deptRes]) => {
      if (!active) return;
      setUsers(asList(userRes.data, 'users'));
      setDepartments(asList(deptRes.data, 'departments'));
    }).catch((error) => {
      if (active) setLoadError(errorMessage(error, 'Could not load users.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText = !needle || `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(needle);
      const matchesRole = !roleFilter || user.role === roleFilter;
      const matchesStatus = !statusFilter
        || (statusFilter === 'active' ? user.isActive !== false : user.isActive === false);
      return matchesText && matchesRole && matchesStatus;
    });
  }, [users, query, roleFilter, statusFilter]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (user) => {
    setEditing(user);
    setForm({
      name: user.name || '',
      email: user.email || '',
      password: '',
      role: user.role || 'STAFF',
      departmentId: user.departmentId ?? user.department?.id ?? '',
      isActive: user.isActive !== false,
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    setFormError('');
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) return setFormError('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setFormError('Enter a valid email address.');
    if (!editing && !form.password) return setFormError('Password is required for a new user.');
    if (form.password && form.password.length < 6) return setFormError('Password must be at least 6 characters.');
    if (!ROLES.includes(form.role)) return setFormError('Select a valid role.');
    if (DEPARTMENT_ROLES.includes(form.role) && !form.departmentId) {
      return setFormError('Department is required for this role.');
    }

    const payload = {
      name,
      email,
      role: form.role,
      departmentId: DEPARTMENT_ROLES.includes(form.role) ? asDeptId(form.departmentId) : null,
      isActive: form.isActive,
    };
    if (form.password) payload.password = form.password;

    try {
      setSaving(true);
      if (editing) await api.put(`/users/${editing.id}`, payload);
      else await api.post('/users', payload);
      toast.success(editing ? 'User updated successfully.' : 'User created successfully.');
      setFormOpen(false);
      setReloadKey((value) => value + 1);
    } catch (error) {
      const message = error?.response?.status === 409
        ? 'A user with this email already exists.'
        : errorMessage(error, 'Could not save user.');
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const openReset = (user) => {
    setResetTarget(user);
    setNewPassword('');
    setResetError('');
    setResetOpen(true);
  };

  const submitReset = async (event) => {
    event.preventDefault();
    setResetError('');
    if (newPassword.length < 6) return setResetError('Password must be at least 6 characters.');
    try {
      setResetting(true);
      await api.put(`/users/${resetTarget.id}`, { password: newPassword });
      toast.success(`Password reset for ${resetTarget.name}.`);
      setResetOpen(false);
    } catch (error) {
      setResetError(errorMessage(error, 'Could not reset password.'));
    } finally {
      setResetting(false);
    }
  };

  const confirmToggle = async () => {
    if (!toggleTarget) return;
    try {
      setToggling(true);
      const next = toggleTarget.isActive === false;
      await api.put(`/users/${toggleTarget.id}`, { isActive: next });
      toast.success(next ? 'User activated.' : 'User deactivated.');
      setToggleTarget(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update user status.'));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Manage accounts, roles, department access and account status.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={openCreate}>
            <Plus size={16} /> Add user
          </button>
        </div>
      </div>

      {loadError && (
        <div className="page-error" role="alert">
          <AlertCircle size={18} />
          <span>{loadError}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
        </div>
      )}

      <Card className="card--flush">
        <div className="filters">
          <div className="field field--search">
            <label htmlFor="user-search">Search</label>
            <div className="input-with-icon">
              <Search size={16} />
              <input id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email…" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="user-role">Role</label>
            <select id="user-role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              {ROLES.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="user-status">Status</label>
            <select id="user-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {loading ? (
          <Loading label="Loading users…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserRoundCog}
            title={users.length ? 'No matching users' : 'No users yet'}
            message={users.length ? 'Try adjusting your search or filters.' : 'Add the first account to get started.'}
            action={!users.length && <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}><Plus size={14} /> Add user</button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="file-cell">
                        <span className="avatar avatar--sm">{initials(user.name)}</span>
                        <div className="file-cell__text">
                          <strong>{user.name || '—'}</strong>
                          <small>{user.email || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td><RoleBadge role={user.role} /></td>
                    <td>{user.department?.name || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`chip ${user.isActive === false ? 'chip--danger' : 'chip--ok'}`}>
                        {user.isActive === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td className="muted">{formatDateTime(user.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="Edit user" aria-label={`Edit ${user.name}`} onClick={() => openEdit(user)}><Pencil size={15} /></button>
                        <button
                          type="button"
                          className="icon-btn"
                          title={user.isActive === false ? 'Activate user' : 'Deactivate user'}
                          aria-label={user.isActive === false ? `Activate ${user.name}` : `Deactivate ${user.name}`}
                          disabled={user.id === currentUser?.id}
                          onClick={() => setToggleTarget(user)}
                        >
                          {user.isActive === false ? <UserCheck size={15} /> : <UserX size={15} />}
                        </button>
                        <button type="button" className="icon-btn" title="Reset password" aria-label={`Reset password for ${user.name}`} onClick={() => openReset(user)}><KeyRound size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit user' : 'Add user'}
        subtitle={editing ? `Update ${editing.name}'s account details.` : 'Create a new account and assign access.'}
        footer={<>
          <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button type="submit" form="user-form" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create user')}</button>
        </>}
      >
        <form id="user-form" onSubmit={submitForm}>
          {formError && <div className="inline-error" role="alert">{formError}</div>}
          <div className="field-row">
            <div className="field">
              <label htmlFor="u-name">Full name</label>
              <input id="u-name" value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Juan Dela Cruz" required />
            </div>
            <div className="field">
              <label htmlFor="u-email">Email address</label>
              <input id="u-email" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="name@llcc.edu.ph" required />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="u-password">Password {editing && <span className="muted">(leave blank to keep current)</span>}</label>
              <input id="u-password" type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} placeholder={editing ? 'Optional' : 'At least 6 characters'} autoComplete="new-password" required={!editing} />
            </div>
            <div className="field">
              <label htmlFor="u-role">Role</label>
              <select id="u-role" value={form.role} onChange={(event) => setField('role', event.target.value)}>
                {ROLES.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="u-department">Department {DEPARTMENT_ROLES.includes(form.role) && <span className="muted">(required)</span>}</label>
            <select id="u-department" value={form.departmentId} onChange={(event) => setField('departmentId', event.target.value)} required={DEPARTMENT_ROLES.includes(form.role)}>
              <option value="">No department</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.code ? ` (${department.code})` : ''}</option>)}
            </select>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setField('isActive', event.target.checked)} />
            Account active
          </label>
        </form>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset password"
        subtitle={resetTarget ? `Set a new password for ${resetTarget.name}.` : ''}
        size="sm"
        footer={<>
          <button type="button" className="btn btn--ghost" onClick={() => setResetOpen(false)}>Cancel</button>
          <button type="submit" form="reset-password-form" className="btn btn--primary" disabled={resetting}>{resetting ? 'Resetting…' : 'Reset password'}</button>
        </>}
      >
        <form id="reset-password-form" onSubmit={submitReset}>
          {resetError && <div className="inline-error" role="alert">{resetError}</div>}
          <div className="field">
            <label htmlFor="reset-password">New password</label>
            <input id="reset-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 6 characters" autoComplete="new-password" required />
          </div>
          <p className="muted small">The user will need to sign in again with the new password.</p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        onConfirm={confirmToggle}
        title={toggleTarget?.isActive === false ? 'Activate this user?' : 'Deactivate this user?'}
        message={toggleTarget?.isActive === false
          ? `${toggleTarget?.name} will be able to sign in again.`
          : `${toggleTarget?.name} will no longer be able to sign in until reactivated.`}
        confirmLabel={toggleTarget?.isActive === false ? 'Activate' : 'Deactivate'}
        danger={toggleTarget?.isActive !== false}
        busy={toggling}
      />
    </div>
  );
}
