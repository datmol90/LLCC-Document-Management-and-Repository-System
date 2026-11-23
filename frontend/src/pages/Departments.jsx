import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Building2, FileText, Info, Pencil, Plus, RefreshCw, Search, Users,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  useToast, Card, Modal, ConfirmDialog, Loading, EmptyState,
} from '../components/ui.jsx';
import '../styles/admin.css';

const EMPTY_FORM = { name: '', code: '', description: '', isActive: true };
const asList = (data, key) => (Array.isArray(data) ? data : (data?.[key] || []));
const countOf = (value) => {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return countOf(value.count ?? value.total);
  return Number(value) || 0;
};

export default function Departments() {
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    api.get('/departments?includeInactive=true')
      .then(({ data }) => { if (active) setDepartments(asList(data, 'departments')); })
      .catch((error) => { if (active) setLoadError(errorMessage(error, 'Could not load departments.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter((dep) => `${dep.name || ''} ${dep.code || ''} ${dep.description || ''}`.toLowerCase().includes(needle));
  }, [departments, query]);

  const activeCount = departments.filter((dep) => dep.isActive !== false).length;
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (department) => {
    setEditing(department);
    setForm({
      name: department.name || '',
      code: department.code || '',
      description: department.description || '',
      isActive: department.isActive !== false,
    });
    setFormError('');
    setFormOpen(true);
  };

  const performSave = async () => {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
    };
    if (editing) payload.isActive = form.isActive;
    try {
      setSaving(true);
      if (editing) await api.put(`/departments/${editing.id}`, payload);
      else await api.post('/departments', payload);
      toast.success(editing ? 'Department updated successfully.' : 'Department created successfully.');
      setFormOpen(false);
      setReloadKey((value) => value + 1);
    } catch (error) {
      const message = error?.response?.status === 409
        ? 'A department with this code already exists.'
        : errorMessage(error, 'Could not save department.');
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const submitForm = (event) => {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim()) return setFormError('Department name is required.');
    if (!form.code.trim()) return setFormError('Department code is required.');
    if (editing && editing.isActive !== false && !form.isActive) {
      setConfirm({
        title: 'Deactivate this department?',
        message: `${editing.name} will be marked inactive. Existing documents remain accessible according to current permissions.`,
        confirmLabel: 'Deactivate',
        action: performSave,
      });
      return;
    }
    return performSave();
  };

  const requestDeactivate = (department) => {
    setConfirm({
      title: 'Deactivate this department?',
      message: `${department.name} will be marked inactive. You can reactivate it later from the edit dialog.`,
      confirmLabel: 'Deactivate',
      action: async () => {
        await api.put(`/departments/${department.id}`, { isActive: false });
        toast.success('Department deactivated.');
        setReloadKey((value) => value + 1);
      },
    });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      setConfirming(true);
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not complete the action.'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Departments</h1>
          <p>Organizational units and their document repositories.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          {isAdmin && <button type="button" className="btn btn--primary" onClick={openCreate}><Plus size={16} /> Add department</button>}
        </div>
      </div>

      <div className="admin-note" role="note">
        <Info size={17} />
        <span>Each department has its own authorized repository. Access to its documents is governed by your role and department assignment.</span>
      </div>

      {loadError && (
        <div className="page-error" role="alert">
          <AlertCircle size={18} />
          <span>{loadError}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
        </div>
      )}

      {!loading && !loadError && departments.length > 0 && (
        <p className="settings-hint">{departments.length} department{departments.length === 1 ? '' : 's'} · {activeCount} active</p>
      )}

      <div className="filters card" style={{ marginBottom: 18 }}>
        <div className="field field--search" style={{ margin: 0 }}>
          <label htmlFor="dept-search">Search</label>
          <div className="input-with-icon">
            <Search size={16} />
            <input id="dept-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, code or description…" />
          </div>
        </div>
      </div>

      {loading ? (
        <Card><Loading label="Loading departments…" /></Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={departments.length ? 'No matching departments' : 'No departments yet'}
            message={departments.length ? 'Try a different search term.' : 'Departments will appear here once created.'}
          />
        </Card>
      ) : (
        <div className="grid grid--3">
          {visible.map((department) => {
            const userCount = countOf(department.userCount ?? department.usersCount ?? department.users?.length ?? department._count?.users);
            const documentCount = countOf(department.documentCount ?? department.documentsCount ?? department.documents?.length ?? department._count?.documents);
            const isActive = department.isActive !== false;
            return (
              <Card key={department.id} title={
                <span className="dept-card__name">{department.name || 'Untitled department'}</span>
              } subtitle={department.code ? `Code: ${department.code}` : undefined}
                action={isAdmin && <button type="button" className="btn btn--sm btn--ghost" onClick={() => openEdit(department)}><Pencil size={14} /> Edit</button>}
              >
                <p className="dept-card__description">{department.description || <span className="muted">No description provided.</span>}</p>
                <div className="dept-card__stats">
                  <span className="dept-card__stat"><Users size={15} /> <strong>{userCount}</strong> users</span>
                  <span className="dept-card__stat"><FileText size={15} /> <strong>{documentCount}</strong> documents</span>
                </div>
                <div className="dept-card__foot">
                  <span className={`chip ${isActive ? 'chip--ok' : 'chip--danger'}`}>{isActive ? 'Active' : 'Inactive'}</span>
                  {isAdmin && isActive && (
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => requestDeactivate(department)}>Deactivate</button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit department' : 'Add department'}
        subtitle={editing ? 'Update department information.' : 'Create a department and its authorized repository.'}
        footer={<>
          <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button type="submit" form="department-form" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create department')}</button>
        </>}
      >
        <form id="department-form" onSubmit={submitForm}>
          {formError && <div className="inline-error" role="alert">{formError}</div>}
          <div className="field-row">
            <div className="field">
              <label htmlFor="dept-name">Name</label>
              <input id="dept-name" value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="College of Engineering" required />
            </div>
            <div className="field">
              <label htmlFor="dept-code">Code</label>
              <input id="dept-code" value={form.code} onChange={(event) => setField('code', event.target.value)} placeholder="COE" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="dept-description">Description</label>
            <textarea id="dept-description" value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Brief description of this department…" />
          </div>
          {editing && (
            <label className="checkbox">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setField('isActive', event.target.checked)} />
              Department active
            </label>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={confirm?.title || 'Are you sure?'}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel || 'Confirm'}
        danger
        busy={confirming}
      />
    </div>
  );
}
