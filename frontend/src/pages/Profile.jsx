import { useCallback, useEffect, useState } from 'react';
import {
  Building2, CalendarDays, Check, KeyRound, LockKeyhole, Mail,
  RefreshCw, ShieldCheck, UserRound, X,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, RoleBadge, useToast } from '../components/ui.jsx';
import { formatDate, initials } from '../utils/format.js';
import '../styles/profile.css';

export default function Profile() {
  const {
    user: authUser, roleLabel, canApprove, canViewAdmin, isAdmin, updateProfile,
  } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get('/auth/profile');
      const loaded = data.user || null;
      setProfile(loaded);
      setForm((current) => ({
        ...current,
        name: loaded?.name || '',
        email: loaded?.email || '',
      }));
    } catch (err) {
      const message = errorMessage(err, 'Unable to load your profile.');
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Name is required.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';

    const wantsPassword = form.currentPassword || form.newPassword || form.confirmPassword;
    if (wantsPassword) {
      if (!form.currentPassword) nextErrors.currentPassword = 'Current password is required.';
      if (form.newPassword.length < 8) nextErrors.newPassword = 'New password must be at least 8 characters.';
      if (form.newPassword !== form.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const payload = { name: form.name.trim(), email: form.email.trim() };
    if (form.currentPassword) {
      payload.currentPassword = form.currentPassword;
      payload.newPassword = form.newPassword;
    }

    setSaving(true);
    setErrors({});
    try {
      const updated = await updateProfile(payload);
      setProfile(updated || { ...profile, ...payload });
      setForm((current) => ({ ...current, currentPassword: '', newPassword: '', confirmPassword: '' }));
      toast.success('Profile updated successfully.');
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to update your profile.'));
    } finally {
      setSaving(false);
    }
  };

  const view = profile || authUser || {};

  const permissions = [
    { label: 'Search and view documents', allowed: true },
    { label: 'Upload and revise documents', allowed: true },
    { label: 'Approve or reject documents', allowed: canApprove },
    { label: 'View administrative reports', allowed: canViewAdmin },
    { label: 'Manage users and departments', allowed: isAdmin },
    { label: 'Manage system backups', allowed: isAdmin },
  ];

  if (loading && !profile) return <Loading label="Loading profile…" />;

  if (loadError && !profile) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><RefreshCw size={26} /></div>
        <h4>Couldn't load your profile</h4>
        <p>{loadError}</p>
        <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <p>Manage your account details and password.</p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card__body">
          <div className="profile-hero">
            <span className="avatar avatar--xl">{initials(view.name)}</span>
            <div className="profile-hero__info">
              <h2>{view.name || '—'}</h2>
              <p>{view.email || '—'}</p>
              <div className="profile-hero__badges">
                <RoleBadge role={view.role} />
                {roleLabel && <span className="chip">{roleLabel}</span>}
              </div>
              <div className="profile-hero__meta">
                <div><Building2 size={15} /> {view.department?.name || 'No department assigned'}</div>
                <div><CalendarDays size={15} /> Member since {formatDate(view.createdAt)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid--2">
        <section className="card">
          <div className="card__head"><div><h3>Account settings</h3><p>Update your personal details or change your password</p></div></div>
          <form className="card__body" onSubmit={handleSubmit} noValidate>
            <div className="form-section">
              <h4>Personal information</h4>
              <div className="field">
                <label htmlFor="profile-name">Full name</label>
                <div className="input-with-icon">
                  <UserRound size={16} />
                  <input id="profile-name" value={form.name} onChange={update('name')} placeholder="Your full name" autoComplete="name" />
                </div>
                {errors.name && <small className="field-error">{errors.name}</small>}
              </div>
              <div className="field">
                <label htmlFor="profile-email">Email address</label>
                <div className="input-with-icon">
                  <Mail size={16} />
                  <input id="profile-email" type="email" value={form.email} onChange={update('email')} placeholder="name@llcc.edu" autoComplete="email" />
                </div>
                {errors.email && <small className="field-error">{errors.email}</small>}
              </div>
            </div>

            <div className="form-section">
              <h4>Change password</h4>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Leave these blank to keep your current password.
              </p>
              <div className="field">
                <label htmlFor="current-password">Current password</label>
                <div className="input-with-icon">
                  <LockKeyhole size={16} />
                  <input id="current-password" type="password" value={form.currentPassword} onChange={update('currentPassword')} placeholder="Current password" autoComplete="current-password" />
                </div>
                {errors.currentPassword && <small className="field-error">{errors.currentPassword}</small>}
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="new-password">New password</label>
                  <div className="input-with-icon">
                    <KeyRound size={16} />
                    <input id="new-password" type="password" value={form.newPassword} onChange={update('newPassword')} placeholder="At least 8 characters" autoComplete="new-password" />
                  </div>
                  {errors.newPassword && <small className="field-error">{errors.newPassword}</small>}
                </div>
                <div className="field">
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <div className="input-with-icon">
                    <KeyRound size={16} />
                    <input id="confirm-password" type="password" value={form.confirmPassword} onChange={update('confirmPassword')} placeholder="Repeat new password" autoComplete="new-password" />
                  </div>
                  {errors.confirmPassword && <small className="field-error">{errors.confirmPassword}</small>}
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <><RefreshCw size={15} className="spin" /> Saving…</> : <><Check size={16} /> Save changes</>}
            </button>
          </form>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="card">
            <div className="card__head"><div><h3>Account security</h3><p>Keeping your account safe</p></div></div>
            <div className="card__body">
              <div className="security-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>Protect your credentials</strong>
                  <p>Use a unique password of at least 8 characters and never share your account. All document actions are recorded in the audit log.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head"><div><h3>Role permissions</h3><p>Access granted to your role</p></div></div>
            <div className="card__body">
              <div className="perm-list">
                {permissions.map((permission) => (
                  <div className={`perm-item perm-item--${permission.allowed ? 'yes' : 'no'}`} key={permission.label}>
                    <span className="perm-item__icon">{permission.allowed ? <Check size={12} /> : <X size={12} />}</span>
                    {permission.label}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
