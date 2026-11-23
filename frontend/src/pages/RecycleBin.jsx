import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Download, FileText, History, RefreshCw, RotateCcw, Trash2,
} from 'lucide-react';
import api, { downloadBlob, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  ConfirmDialog, EmptyState, FileIcon, Loading, Pagination, StatusBadge, useToast,
} from '../components/ui.jsx';
import { formatDate, formatDateTime } from '../utils/format.js';
import '../styles/advanced.css';

const LIMIT = 20;

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value.name || value.title || value.code || value.originalName || fallback;
  return value;
}

export default function RecycleBin() {
  const { canUseTrash } = useAuth();
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/documents', { params: { view: 'trash', page, limit: LIMIT } });
      const pages = Number(data?.pages || 1);
      if (page > pages) {
        setPage(pages);
        return;
      }
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
      setMeta({
        total: Number(data?.total || 0),
        page: Number(data?.page || page),
        pages,
      });
    } catch (err) {
      const message = errorMessage(err, 'Unable to load the recycle bin.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { load(); }, [load]);

  const restore = async (doc) => {
    setBusyId(doc.id);
    try {
      const { data } = await api.post(`/documents/${doc.id}/restore`);
      toast.success(data?.message || `“${displayValue(doc.title, 'Document')}” has been restored.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to restore this document.'));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    const doc = purgeTarget;
    if (!doc) return;
    setPurgeTarget(null);
    setBusyId(doc.id);
    try {
      const { data } = await api.delete(`/documents/${doc.id}/purge?confirm=true`);
      toast.success(data?.message || 'Document permanently deleted.');
      if (documents.length === 1 && page > 1) setPage((current) => current - 1);
      else await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to permanently delete this document.'));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const download = async (doc) => {
    setBusyId(doc.id);
    try {
      await downloadBlob(`/documents/${doc.id}/download`, doc.latestFileName || `document-${doc.id}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to download this document.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!canUseTrash) {
    return (
      <EmptyState
        icon={History}
        title="Recycle bin unavailable"
        message="Only Super Administrators and Department Heads can manage deleted documents."
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recycle Bin</h1>
          <p>Deleted documents are held here until restored or permanently removed.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="adv-notice adv-notice--danger">
        <AlertTriangle size={18} />
        <div>
          <strong>Permanent deletion cannot be undone</strong>
          <p>Restore a document if it is still needed. Purging removes the record and its files permanently, but audit logs are preserved for accountability.</p>
        </div>
      </div>
      {error && documents.length > 0 && (
        <div className="adv-notice adv-notice--danger">
          <AlertTriangle size={18} />
          <div><strong>Could not refresh the recycle bin</strong><p>{error}</p></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Retry</button>
        </div>
      )}

      <section className="card">
        <div className="card__head">
          <div><h3>Deleted documents</h3><p>{meta.total} record{meta.total === 1 ? '' : 's'} in the recycle bin</p></div>
        </div>
        <div className="card__body card__body--flush">
          {loading && !documents.length && !error ? (
            <Loading label="Loading deleted documents…" />
          ) : error && !documents.length ? (
            <div className="empty-state">
              <div className="empty-state__icon"><RefreshCw size={26} /></div>
              <h4>Couldn't load the recycle bin</h4>
              <p>{error}</p>
              <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
            </div>
          ) : documents.length === 0 ? (
            <EmptyState icon={FileText} title="Recycle bin is empty" message="Deleted documents will appear here until they are restored or purged." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Department</th>
                    <th>Deleted</th>
                    <th>Deleted by</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => {
                    const deletedAt = doc.deletedAt || doc.deletedOn || doc.updatedAt;
                    const reason = doc.deleteReason || doc.deletionReason || doc.reason;
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div className="file-cell">
                            <span className="file-cell__icon"><FileIcon name={doc.latestFileName || doc.title} size={16} /></span>
                            <span className="file-cell__text">
                              <strong title={displayValue(doc.title)}>{displayValue(doc.title, 'Untitled document')}</strong>
                              <small>{displayValue(doc.referenceNumber || doc.latestFileName, '—')}</small>
                            </span>
                          </div>
                        </td>
                        <td>{displayValue(doc.department)}</td>
                        <td><span title={formatDateTime(deletedAt)}>{formatDate(deletedAt, { withTime: true })}</span></td>
                        <td>{displayValue(doc.deletedBy || doc.deletedByName || doc.deletedByUser)}</td>
                        <td><span className="adv-delete-reason" title={displayValue(reason, '')}>{displayValue(reason)}</span></td>
                        <td><StatusBadge status={doc.status} /></td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title="Restore document"
                              aria-label="Restore document"
                              disabled={busyId === doc.id}
                              onClick={() => restore(doc)}
                            >
                              <RotateCcw size={15} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Download file"
                              aria-label="Download file"
                              disabled={busyId === doc.id}
                              onClick={() => download(doc)}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Permanently delete"
                              aria-label="Permanently delete"
                              disabled={busyId === doc.id}
                              onClick={() => setPurgeTarget(doc)}
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
        {documents.length > 0 && (
          <Pagination
            page={meta.page || page}
            pages={meta.pages}
            total={meta.total}
            limit={LIMIT}
            onChange={setPage}
          />
        )}
      </section>

      <ConfirmDialog
        open={Boolean(purgeTarget)}
        onClose={() => setPurgeTarget(null)}
        onConfirm={purge}
        title="Permanently delete document"
        message={`This will permanently delete “${displayValue(purgeTarget?.title, 'this document')}” and all of its files. This action cannot be undone, although the audit log entry will be preserved.`}
        confirmLabel="Delete permanently"
        danger
        requiresText="DELETE"
        busy={Boolean(busyId && purgeTarget)}
      />
    </>
  );
}
