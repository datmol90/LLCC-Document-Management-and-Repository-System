import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Building2, FileText, Info, Pencil, Plus, RefreshCw, Search, Users,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast, Card, Modal, ConfirmDialog, Loading, EmptyState } from '../components/ui.jsx';
import '../styles/admin.css';

const EMPTY_FORM = { name: '', code: '', description: '', isActive: true };
const asList = (data, key) => (Array.isArray(data) ? data : (data?.[key] || []));
const countOf = (value) => {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return countOf(value.count ?? value.total);
  return Number(value) || 0;
};

// **EXACTLY THREE ACADEMIC COLLEGES** (per official LLCC structure)
const COLLEGE_NAMES = ['College of Education', 'College of Technology', 'College of Hospitality and Tourism Management'];
const SUPPORT_OFFICE_NAMES = [
  'Office of the College Administrator',
  "Registrar's Office",
  'Student Affairs and Services Office (SASO)',
  'Library Services',
  'Administrative Services',
  'Finance and Accounting',
  'Human Resources',
  'Information Technology Services',
  'Records Management',
  'Quality Assurance',
];

export default function Departments() {
  const { isAdmin } = useAuth();
  const toast = useToast();

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
      .then(({ data }) => {
        if (active) {
          const allDepts = asList(data, 'departments');
          setDepartments(allDepts);
        }
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error, 'Could not load departments.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  // Filtered departments: only the 3 colleges + support offices
  const visibleDepts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter((dep) => {
      const name = dep.name || '';
      const code = dep.code || '';
      const desc = dep.description || '';
      return name.toLowerCase().includes(needle) ||
        code.toLowerCase().includes(needle) ||
        desc.toLowerCase().includes(needle);
    });
  }, [departments, query]);

  const activeCount = departments.filter((dep) => dep.isActive !== false).length;

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

  // Separate colleges and support offices
  const collegeDepartments = useMemo(() => 
    departments.filter(d => COLLEGE_NAMES.includes(d.name)), [departments]
  );
  const supportDepartments = useMemo(() => 
    departments.filter(d => SUPPORT_OFFICE_NAMES.includes(d.name)), [departments]
  );
  const otherDepartments = useMemo(() => 
    departments.filter(d => !COLLEGE_NAMES.includes(d.name) && !SUPPORT_OFFICE_NAMES.includes(d.name)), [departments]
  );

  // Determine the content to render
  let content;
  if (loading) {
    content = <Card><Loading label="Loading departments…" /></Card>;
  } else if (!loadError && departments.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={Building2}
          title={departments.length ? 'No matching departments' : 'No departments yet'}
          message={departments.length ? 'Try a different search term.' : 'Departments will appear here once created.'}
        />
      </Card>
    );
  } else {
    content = (
      <div className="grid grid--3">
        {/* Academic Colleges Section */}
        {collegeDepartments.length > 0 && (
          <div className="grid--1" style={{ marginBottom: 12 }}>
            <h3>Academic Colleges</h3>
            {collegeDepartments.map((department) => {
              const userCount = countOf(department.userCount ?? department.usersCount ?? department.users?.length ?? department._count?.users);
              const documentCount = countOf(department.documentCount ?? department.documentsCount ?? department.documents?.length ?? department._count?.documents);
              const isActive = department.isActive !== false;
              return (
                <Card key={department.id} title={
                  <span className="dept-card__name">{department.name || 'Untitled department'}</span>
                } subtitle={department.code ? `Code: ${department.code}` : undefined}>
                  <p className="dept-card__description">{department.description || <span className="muted">No description provided.</span>}</p>
                  <div className="dept-card__stats">
                    <span className="dept-card__stat"><Users size={15} /> <strong>{userCount}</strong> users</span>
                    <span className="dept-card__stat"><FileText size={15} /> <strong>{documentCount}</strong> documents</span>
                  </div>
                  <div className="dept-card__foot">
                    <span className={`chip ${isActive ? 'chip--ok' : 'chip--danger'}`}>{isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Support Offices Section */}
        {supportDepartments.length > 0 && (
          <div className="grid--1" style={{ marginBottom: 12 }}>
            <h3>Support Offices</h3>
            {supportDepartments.map((department) => {
              const userCount = countOf(department.userCount ?? department.usersCount ?? department.users?.length ?? department._count?.users);
              const documentCount = countOf(department.documentCount ?? department.documentsCount ?? department.documents?.length ?? department._count?.users);
              const isActive = department.isActive !== false;
              return (
                <Card key={department.id} title={
                  <span className="dept-card__name">{department.name || 'Untitled department'}</span>
                } subtitle={department.code ? `Code: ${department.code}` : undefined}>
                  <p className="dept-card__description">{department.description || <span className="muted">No description provided.</span>}</p>
                  <div className="dept-card__stats">
                    <span className="dept-card__stat"><Users size={15} /> <strong>{userCount}</strong> users</span>
                    <span className="dept-card__stat"><FileText size={15} /> <strong>{documentCount}</strong> documents</span>
                  </div>
                  <div className="dept-card__foot">
                    <span className={`chip ${isActive ? 'chip--ok' : 'chip--danger'}`}>{isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

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

      {content}

      {/* Empty state - no matching departments */}
      {visibleDepts.length === 0 && (
        <Card>
          <EmptyState
            icon={Building2}
            title={departments.length ? 'No matching departments' : 'No departments yet'}
            message={departments.length ? 'Try adjusting or clearing your filters.' : 'Upload your first document to start building the institutional repository.'}
          />
        </Card>
      )}
    </div>
  );
}