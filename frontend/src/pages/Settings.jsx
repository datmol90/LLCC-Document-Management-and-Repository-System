import { useEffect, useState } from 'react';
import {
  AlertCircle, CalendarClock, Database, Pin, Plus, RefreshCw, Save, ShieldCheck, Trash2,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useToast, Card, ConfirmDialog, Loading, EmptyState } from '../components/ui.jsx';
import { formatDateTime, relativeTime } from '../utils/format.js';
import '../styles/admin.css';

const asList = (data, key) => (Array.isArray(data) ? data : (data?.[key] || []));

const toSettingsForm = (settings = {}) => ({
  expiryReminderDays: Array.isArray(settings.expiryReminderDays)
    ? settings.expiryReminderDays.join(', ')
    : (settings.expiryReminderDays ?? '7, 30'),
  backupEnabled: Boolean(settings.backupEnabled),
  backupIntervalHours: settings.backupIntervalHours ?? 24,
  maxFileSizeMB: settings.maxFileSizeMB ?? 20,
  expiryScanHours: settings.expiryScanHours ?? 6,
  aiEnabled: Boolean(settings.aiEnabled),
});

export default function Settings() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [originalSettings, setOriginalSettings] = useState({});
  const [settingsForm, setSettingsForm] = useState(() => toSettingsForm());
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [categories, setCategories] = useState([]);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [categoryError, setCategoryError] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '', pinned: false });
  const [announcementError, setAnnouncementError] = useState('');
  const [addingAnnouncement, setAddingAnnouncement] = useState(false);

  const [roles, setRoles] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get('/settings'), api.get('/categories'), api.get('/announcements'), api.get('/roles'),
    ]).then(([settingsRes, categoriesRes, announcementsRes, rolesRes]) => {
      if (!active) return;
      const settings = settingsRes.data?.settings || {};
      setOriginalSettings(settings);
      setSettingsForm(toSettingsForm(settings));
      setCategories(asList(categoriesRes.data, 'categories'));
      setAnnouncements(asList(announcementsRes.data, 'announcements'));
      setRoles(asList(rolesRes.data, 'roles'));
    }).catch((error) => {
      if (active) setLoadError(errorMessage(error, 'Could not load system settings.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reloadKey]);

  const setSetting = (key, value) => setSettingsForm((current) => ({ ...current, [key]: value }));

  const saveSettings = async (event) => {
    event.preventDefault();
    setSettingsError('');
    const days = String(settingsForm.expiryReminderDays || '')
      .split(',').map((item) => item.trim()).filter(Boolean).map(Number);
    if (!days.length || days.some((value) => !Number.isInteger(value) || value < 1 || value > 365)) {
      return setSettingsError('Expiry reminder days must be comma-separated numbers between 1 and 365.');
    }
    const backupIntervalHours = Number(settingsForm.backupIntervalHours);
    if (!Number.isInteger(backupIntervalHours) || backupIntervalHours < 1 || backupIntervalHours > 720) {
      return setSettingsError('Backup interval must be a whole number between 1 and 720 hours.');
    }
    const maxFileSizeMB = Number(settingsForm.maxFileSizeMB);
    if (!Number.isInteger(maxFileSizeMB) || maxFileSizeMB < 1 || maxFileSizeMB > 100) {
      return setSettingsError('Maximum file size must be a whole number between 1 and 100 MB.');
    }
    const expiryScanHours = Number(settingsForm.expiryScanHours);
    if (!Number.isInteger(expiryScanHours) || expiryScanHours < 1 || expiryScanHours > 720) {
      return setSettingsError('Expiry scan interval must be a whole number between 1 and 720 hours.');
    }

    const payload = {
      settings: {
        ...originalSettings,
        expiryReminderDays: [...new Set(days)].sort((a, b) => a - b),
        backupEnabled: settingsForm.backupEnabled,
        backupIntervalHours,
        maxFileSizeMB,
        expiryScanHours,
        aiEnabled: settingsForm.aiEnabled,
      },
    };
    try {
      setSavingSettings(true);
      const { data } = await api.put('/settings', payload);
      const saved = data?.settings || payload.settings;
      setOriginalSettings(saved);
      setSettingsForm(toSettingsForm(saved));
      toast.success('System settings saved.');
    } catch (error) {
      setSettingsError(errorMessage(error, 'Could not save system settings.'));
      toast.error(errorMessage(error, 'Could not save system settings.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const refreshCategories = async () => {
    const { data } = await api.get('/categories');
    setCategories(asList(data, 'categories'));
  };

  const addCategory = async (event) => {
    event.preventDefault();
    setCategoryError('');
    if (!categoryForm.name.trim()) return setCategoryError('Category name is required.');
    try {
      setAddingCategory(true);
      await api.post('/categories', {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim(),
      });
      setCategoryForm({ name: '', description: '' });
      await refreshCategories();
      toast.success('Category added.');
    } catch (error) {
      const message = errorMessage(error, 'Could not add category.');
      setCategoryError(message);
      toast.error(message);
    } finally {
      setAddingCategory(false);
    }
  };

  const refreshAnnouncements = async () => {
    const { data } = await api.get('/announcements');
    setAnnouncements(asList(data, 'announcements'));
  };

  const addAnnouncement = async (event) => {
    event.preventDefault();
    setAnnouncementError('');
    if (!announcementForm.title.trim()) return setAnnouncementError('Title is required.');
    if (!announcementForm.body.trim()) return setAnnouncementError('Message body is required.');
    try {
      setAddingAnnouncement(true);
      await api.post('/announcements', {
        title: announcementForm.title.trim(),
        body: announcementForm.body.trim(),
        pinned: announcementForm.pinned,
      });
      setAnnouncementForm({ title: '', body: '', pinned: false });
      await refreshAnnouncements();
      toast.success('Announcement published.');
    } catch (error) {
      const message = errorMessage(error, 'Could not publish announcement.');
      setAnnouncementError(message);
      toast.error(message);
    } finally {
      setAddingAnnouncement(false);
    }
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
          <h1>Settings</h1>
          <p>System preferences, categories, announcements and role definitions.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
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

      {loading ? (
        <Card><Loading label="Loading settings…" /></Card>
      ) : (
        <>
          <Card
            className="settings-section"
            title="System settings"
            subtitle="Expiration reminders, backups, upload limits and AI features"
            action={<ShieldCheck size={20} color="var(--navy-700)" />}
          >
            <form onSubmit={saveSettings}>
              {settingsError && <div className="inline-error" role="alert">{settingsError}</div>}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="set-expiry-days">Expiry reminder days</label>
                  <input id="set-expiry-days" value={settingsForm.expiryReminderDays} onChange={(event) => setSetting('expiryReminderDays', event.target.value)} placeholder="7, 30, 60" />
                  <span className="muted small">Comma-separated days (1–365)</span>
                </div>
                <div className="field">
                  <label htmlFor="set-scan-hours">Expiry scan interval (hours)</label>
                  <input id="set-scan-hours" type="number" min="1" max="720" value={settingsForm.expiryScanHours} onChange={(event) => setSetting('expiryScanHours', event.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="set-backup-hours">Backup interval (hours)</label>
                  <input id="set-backup-hours" type="number" min="1" max="720" value={settingsForm.backupIntervalHours} onChange={(event) => setSetting('backupIntervalHours', event.target.value)} disabled={!settingsForm.backupEnabled} />
                </div>
                <div className="field">
                  <label htmlFor="set-max-size">Maximum file size (MB)</label>
                  <input id="set-max-size" type="number" min="1" max="100" value={settingsForm.maxFileSizeMB} onChange={(event) => setSetting('maxFileSizeMB', event.target.value)} />
                </div>
              </div>
              <div className="form-section">
                <label className="checkbox" style={{ marginBottom: 8 }}>
                  <input type="checkbox" checked={settingsForm.backupEnabled} onChange={(event) => setSetting('backupEnabled', event.target.checked)} />
                  Enable scheduled backups
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={settingsForm.aiEnabled} onChange={(event) => setSetting('aiEnabled', event.target.checked)} />
                  Enable AI assistant
                </label>
              </div>
              <button type="submit" className="btn btn--primary" disabled={savingSettings}>
                {savingSettings ? 'Saving…' : <><Save size={15} /> Save settings</>}
              </button>
            </form>
          </Card>

          <div className="grid grid--2">
            <Card className="settings-section" title="Document categories" subtitle="Classify documents for search and reporting">
              {categories.length === 0 ? (
                <EmptyState icon={Database} title="No categories" message="Add a category to organize documents." />
              ) : (
                <div className="admin-list">
                  {categories.map((category) => (
                    <div className="admin-list__item" key={category.id}>
                      <div className="admin-list__row">
                        <div>
                          <div className="admin-list__title">
                            {category.name}
                            <span className={`chip ${category.isActive === false ? 'chip--danger' : 'chip--ok'}`}>
                              {category.isActive === false ? 'Inactive' : 'Active'}
                            </span>
                          </div>
                          {category.description && <p className="admin-list__body">{category.description}</p>}
                        </div>
                        {category.isActive !== false && (
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => setConfirm({
                              title: 'Deactivate category?',
                              message: `${category.name} will no longer be available for new documents.`,
                              confirmLabel: 'Deactivate',
                              action: async () => {
                                await api.delete(`/categories/${category.id}`);
                                await refreshCategories();
                                toast.success('Category deactivated.');
                              },
                            })}
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <form className="admin-form" onSubmit={addCategory}>
                <h5>Add category</h5>
                {categoryError && <div className="inline-error" role="alert">{categoryError}</div>}
                <div className="field">
                  <label htmlFor="cat-name">Name</label>
                  <input id="cat-name" value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} placeholder="Policy" required />
                </div>
                <div className="field">
                  <label htmlFor="cat-description">Description</label>
                  <input id="cat-description" value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional description" />
                </div>
                <button type="submit" className="btn btn--primary btn--sm" disabled={addingCategory}>
                  {addingCategory ? 'Adding…' : <><Plus size={14} /> Add category</>}
                </button>
              </form>
            </Card>

            <Card className="settings-section" title="Announcements" subtitle="Messages shown to users across the workspace">
              {announcements.length === 0 ? (
                <EmptyState icon={CalendarClock} title="No announcements" message="Publish the first announcement below." />
              ) : (
                <div className="admin-list">
                  {announcements.map((announcement) => (
                    <div className="admin-list__item" key={announcement.id}>
                      <div className="admin-list__row">
                        <div style={{ minWidth: 0 }}>
                          <div className="admin-list__title">
                            {announcement.pinned && <Pin size={13} color="var(--amber)" />}
                            {announcement.title}
                          </div>
                          <p className="admin-list__body">{String(announcement.body || '').slice(0, 240)}{String(announcement.body || '').length > 240 ? '…' : ''}</p>
                          <div className="admin-list__meta">
                            {formatDateTime(announcement.createdAt)} · {relativeTime(announcement.createdAt)}
                            {announcement.createdBy?.name ? ` · ${announcement.createdBy.name}` : ''}
                          </div>
                        </div>
                        <div className="admin-list__actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title="Delete announcement"
                            aria-label={`Delete ${announcement.title}`}
                            onClick={() => setConfirm({
                              title: 'Delete announcement?',
                              message: `${announcement.title} will be permanently removed.`,
                              confirmLabel: 'Delete',
                              action: async () => {
                                await api.delete(`/announcements/${announcement.id}`);
                                await refreshAnnouncements();
                                toast.success('Announcement deleted.');
                              },
                            })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <form className="admin-form" onSubmit={addAnnouncement}>
                <h5>New announcement</h5>
                {announcementError && <div className="inline-error" role="alert">{announcementError}</div>}
                <div className="field">
                  <label htmlFor="ann-title">Title</label>
                  <input id="ann-title" value={announcementForm.title} onChange={(event) => setAnnouncementForm((current) => ({ ...current, title: event.target.value }))} placeholder="Scheduled maintenance" required />
                </div>
                <div className="field">
                  <label htmlFor="ann-body">Message</label>
                  <textarea id="ann-body" value={announcementForm.body} onChange={(event) => setAnnouncementForm((current) => ({ ...current, body: event.target.value }))} placeholder="Write the announcement…" required />
                </div>
                <label className="checkbox" style={{ marginBottom: 14 }}>
                  <input type="checkbox" checked={announcementForm.pinned} onChange={(event) => setAnnouncementForm((current) => ({ ...current, pinned: event.target.checked }))} />
                  Pin to top
                </label>
                <button type="submit" className="btn btn--primary btn--sm" disabled={addingAnnouncement}>
                  {addingAnnouncement ? 'Publishing…' : <><Plus size={14} /> Publish announcement</>}
                </button>
              </form>
            </Card>
          </div>

          <Card className="settings-section" title="Roles catalog" subtitle="Access levels defined by the system (read-only)">
            {roles.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No roles defined" message="Role definitions will appear here." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Role</th><th>Level</th><th>Description</th></tr></thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id || role.name}>
                        <td className="cell-title">{role.name || role.code || '—'}</td>
                        <td>{role.level ?? '—'}</td>
                        <td className="muted">{role.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

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
