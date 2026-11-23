import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CloudDownload, Database, DatabaseBackup,
  Download, Info, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2,
} from 'lucide-react';
import api, { downloadBlob, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ConfirmDialog, EmptyState, FileIcon, Loading, useToast } from '../components/ui.jsx';
import { formatDateTime, formatSize } from '../utils/format.js';
import '../styles/advanced.css';

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value.name || value.title || value.code || value.originalName || fallback;
  return value;
}

function statusTone(status) {
  const key = String(status || '').toUpperCase();
  if (['COMPLETE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'VERIFIED', 'READY'].includes(key)) return 'chip--ok';
  if (['FAILED', 'ERROR', 'CORRUPT', 'INVALID'].includes(key)) return 'chip--danger';
  return 'chip--warn';
}

export default function Backups() {
  const { canManageBackups } = useAuth();
  const toast = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restartNotice, setRestartNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/backups');
      setBackups(Array.isArray(data) ? data : (data?.backups || []));
    } catch (err) {
      const message = errorMessage(err, 'Unable to load backups.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!restartNotice) return undefined;
    const timer = window.setTimeout(() => {
      setRestartNotice((current) => (current ? { ...current, ready: true } : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [restartNotice?.token]);

  const create = async (kind) => {
    setCreating(kind);
    try {
      const { data } = await api.post('/backups', { kind });
      toast.success(data?.message || `${kind === 'DB_ONLY' ? 'Database' : 'Full'} backup started.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to create the backup.'));
    } finally {
      setCreating('');
    }
  };

  const download = async (backup) => {
    setBusyId(backup.id);
    try {
      await downloadBlob(`/backups/${backup.id}/download`, backup.fileName || `backup-${backup.id}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to download this backup.'));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async () => {
    const target = restoreTarget;
    if (!target) return;
    setRestoreTarget(null);
    setBusyId(target.id);
    try {
      const { data } = await api.post(`/backups/${target.id}/restore`, { confirm: 'RESTORE' });
      toast.success(data?.message || 'Restore request accepted.');
      if (data?.restartRequired) {
        setRestartNotice({ token: Date.now(), fileName: target.fileName || `backup-${target.id}`, ready: false });
      }
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to restore this backup.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      const { data } = await api.delete(`/backups/${target.id}`);
      toast.success(data?.message || 'Backup deleted.');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to delete this backup.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!canManageBackups) {
    return (
      <EmptyState
        icon={DatabaseBackup}
        title="Backup management restricted"
        message="Only Super Administrators can view, create, restore or delete backups."
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backups</h1>
          <p>Create and manage verified snapshots of the repository.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => create('DB_ONLY')} disabled={Boolean(creating)}>
            {creating === 'DB_ONLY' ? <Loader2 size={15} className="spin" /> : <Database size={15} />} Database only
          </button>
          <button type="button" className="btn btn--primary" onClick={() => create('FULL')} disabled={Boolean(creating)}>
            {creating === 'FULL' ? <Loader2 size={15} className="spin" /> : <DatabaseBackup size={15} />} Create backup
          </button>
        </div>
      </div>

      <div className="adv-notice adv-notice--info">
        <ShieldCheck size={18} />
        <div>
          <strong>Verified snapshots</strong>
          <p>Full backups include the real database and all uploaded files. Each archive is verified with a checksum before it is marked complete; only completed backups should be used for a restore.</p>
        </div>
      </div>
      {restartNotice && (
        <div className="adv-notice adv-notice--amber">
          <AlertTriangle size={18} />
          <div>
            <strong>Restart required</strong>
            <p>
              The restore of <span className="adv-mono">{restartNotice.fileName}</span> requires the application service to restart.
              {restartNotice.ready
                ? ' The service should now be available — reload to continue.'
                : ' Wait a few seconds for the service to come back before reloading.'}
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" disabled={!restartNotice.ready} onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> {restartNotice.ready ? 'Reload now' : 'Reloading…'}
          </button>
        </div>
      )}
      {error && backups.length > 0 && (
        <div className="adv-notice adv-notice--danger">
          <AlertTriangle size={18} />
          <div><strong>Could not refresh backups</strong><p>{error}</p></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Retry</button>
        </div>
      )}

      <section className="card">
        <div className="card__head">
          <div><h3>Backup history</h3><p>{backups.length} snapshot{backups.length === 1 ? '' : 's'} on record</p></div>
        </div>
        <div className="card__body card__body--flush">
          {loading && !backups.length && !error ? (
            <Loading label="Loading backups…" />
          ) : error && !backups.length ? (
            <div className="empty-state">
              <div className="empty-state__icon"><RefreshCw size={26} /></div>
              <h4>Couldn't load backups</h4>
              <p>{error}</p>
              <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
            </div>
          ) : backups.length === 0 ? (
            <EmptyState icon={DatabaseBackup} title="No backups yet" message="Create a full backup or a database-only snapshot to get started." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>File name</th>
                    <th>Kind</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Scope</th>
                    <th>Verified / checksum</th>
                    <th>Created by</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => {
                    const checksum = backup.checksum || backup.sha256 || backup.hash;
                    const verified = backup.verified ?? backup.checksumVerified ?? backup.isVerified;
                    const size = backup.fileSize ?? backup.size ?? backup.bytes;
                    const createdAt = backup.createdAt || backup.createdOn;
                    return (
                      <tr key={backup.id}>
                        <td>
                          <div className="file-cell">
                            <span className="file-cell__icon"><FileIcon name={backup.fileName} size={16} /></span>
                            <span className="file-cell__text">
                              <strong title={displayValue(backup.fileName)}>{displayValue(backup.fileName, `backup-${backup.id}`)}</strong>
                              <small className="adv-mono" title={displayValue(checksum, '')}>{displayValue(backup.originalName, '') || 'Archive'}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="chip">{String(backup.kind || 'FULL').replace('_', ' ')}</span>
                        </td>
                        <td><span title={formatDateTime(createdAt)}>{formatDateTime(createdAt)}</span></td>
                        <td>{formatSize(size)}</td>
                        <td>
                          <span className={`chip ${statusTone(backup.status)}`}>{displayValue(backup.status, 'PENDING')}</span>
                        </td>
                        <td>{displayValue(backup.scope || backup.scopeLabel, backup.kind === 'DB_ONLY' ? 'Database' : 'Database and files')}</td>
                        <td>
                          {checksum || verified !== undefined ? (
                            <span title={displayValue(checksum, '')}>
                              {verified ? <CheckCircle2 size={14} color="var(--green)" style={{ verticalAlign: '-2px' }} /> : <Info size={14} color="var(--slate-400)" style={{ verticalAlign: '-2px' }} />}
                              {checksum && <span className="adv-mono adv-checksum" style={{ marginLeft: 6 }}>{displayValue(checksum)}</span>}
                              {!checksum && <span className="muted small" style={{ marginLeft: 5 }}>{verified ? 'Verified' : 'Unverified'}</span>}
                            </span>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td>{displayValue(backup.createdBy || backup.createdByUser)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title="Download backup"
                              aria-label="Download backup"
                              disabled={busyId === backup.id}
                              onClick={() => download(backup)}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Restore backup"
                              aria-label="Restore backup"
                              disabled={busyId === backup.id}
                              onClick={() => setRestoreTarget(backup)}
                            >
                              <RotateCcw size={15} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Delete backup"
                              aria-label="Delete backup"
                              disabled={busyId === backup.id}
                              onClick={() => setDeleteTarget(backup)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <p className="adv-subtle" style={{ marginTop: 14 }}>
        <CloudDownload size={12} /> Restoring a backup replaces current repository data. Audit history and user accounts are handled according to the restore policy.
      </p>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete backup"
        message={`Delete “${displayValue(deleteTarget?.fileName, 'this backup')}”? The stored archive will be removed permanently.`}
        confirmLabel="Delete backup"
        danger
        busy={busyId === deleteTarget?.id}
      />
      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={restore}
        title="Restore from backup"
        message={`Restore “${displayValue(restoreTarget?.fileName, 'this backup')}”? Current repository data will be replaced and the service may need to restart. Type RESTORE to continue.`}
        confirmLabel="Restore backup"
        requiresText="RESTORE"
        busy={Boolean(busyId)}
      />
    </>
  );
}
