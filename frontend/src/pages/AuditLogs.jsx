import { useEffect, useState } from 'react';
import { AlertCircle, Download, FilterX, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useToast, Card, Loading, EmptyState, Pagination } from '../components/ui.jsx';
import { formatDateTime, relativeTime, initials } from '../utils/format.js';
import '../styles/admin.css';

const LIMIT = 25;
const EMPTY_FILTERS = { action: '', entityType: '', from: '', to: '', userId: '' };
const ACTIONS = [
  'LOGIN', 'LOGOUT', 'UPLOAD_DOCUMENT', 'DOWNLOAD_DOCUMENT', 'UPDATE_DOCUMENT_VERSION',
  'DELETE_DOCUMENT', 'RESTORE_DOCUMENT', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED',
  'APPROVAL_REVISION_REQUESTED', 'PERMISSION_CHANGE', 'CREATE_USER', 'UPDATE_USER',
  'CREATE_DEPARTMENT', 'UPDATE_DEPARTMENT', 'CREATE_CATEGORY', 'UPDATE_CATEGORY',
  'CREATE_BACKUP', 'RESTORE_BACKUP', 'DELETE_BACKUP', 'CREATE_ANNOUNCEMENT',
  'UPDATE_SETTINGS', 'PREVIEW_DOCUMENT', 'ARCHIVE_DOCUMENT', 'UNARCHIVE_DOCUMENT',
];

const asList = (data, key) => (Array.isArray(data) ? data : (data?.[key] || []));
const prettify = (value) => String(value || '—')
  .toLowerCase().split('_').filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

const toIso = (date, endOfDay) => {
  if (!date) return '';
  const suffix = endOfDay ? 'T23:59:59' : 'T00:00:00';
  const parsed = new Date(`${date}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
};

const detailsOf = (log) => log.details ?? log.metadata ?? log.meta ?? log.data ?? null;
const documentTitleOf = (log) => log.documentTitle || log.entityTitle
  || log.document?.title || log.entity?.title || log.target?.title || '';
const userOf = (log) => log.user?.name || log.actor?.name || log.userName
  || (log.userId ? `User #${log.userId}` : 'System');

export default function AuditLogs() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: LIMIT });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (applied.action) params.set('action', applied.action);
    if (applied.entityType.trim()) params.set('entityType', applied.entityType.trim());
    if (applied.userId.trim()) params.set('userId', applied.userId.trim());
    const from = toIso(applied.from, false);
    const to = toIso(applied.to, true);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    api.get(`/audit-logs?${params.toString()}`)
      .then(({ data }) => {
        if (!active) return;
        setLogs(asList(data, 'logs'));
        setPagination({
          total: Number(data?.total) || 0,
          pages: Number(data?.pages) || 1,
          limit: Number(data?.limit) || LIMIT,
        });
      })
      .catch((err) => { if (active) setError(errorMessage(err, 'Could not load audit logs.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, applied, reloadKey]);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const applyFilters = (event) => {
    event?.preventDefault();
    setApplied({ ...filters });
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const exportCsv = () => {
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Timestamp', 'User', 'Action', 'Entity type', 'Document title', 'Details', 'IP address'],
      ...logs.map((log) => {
        const details = detailsOf(log);
        return [
          log.createdAt || log.timestamp || '',
          userOf(log),
          log.action || '',
          log.entityType || '',
          documentTitleOf(log),
          details ? (typeof details === 'string' ? details : JSON.stringify(details)) : '',
          log.ip || log.ipAddress || '',
        ];
      }),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`;
    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-page-${page}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    toast.success(`Exported ${logs.length} audit log${logs.length === 1 ? '' : 's'} to CSV.`);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Audit logs</h1>
          <p>Trace sign-ins, document changes and administrative activity.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={exportCsv} disabled={loading || logs.length === 0}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <Card className="card--flush">
        <form className="filters" onSubmit={applyFilters}>
          <div className="field">
            <label htmlFor="audit-action">Action</label>
            <select id="audit-action" value={filters.action} onChange={(event) => setFilter('action', event.target.value)}>
              <option value="">All actions</option>
              {ACTIONS.map((action) => <option key={action} value={action}>{prettify(action)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-entity">Entity type</label>
            <input id="audit-entity" value={filters.entityType} onChange={(event) => setFilter('entityType', event.target.value)} placeholder="e.g. Document" />
          </div>
          <div className="field">
            <label htmlFor="audit-from">From</label>
            <input id="audit-from" type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="audit-to">To</label>
            <input id="audit-to" type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="audit-user">User ID</label>
            <input id="audit-user" value={filters.userId} onChange={(event) => setFilter('userId', event.target.value)} placeholder="User ID" />
          </div>
          <button type="submit" className="btn btn--primary"><Search size={15} /> Apply</button>
          <button type="button" className="btn btn--ghost" onClick={resetFilters}><FilterX size={15} /> Reset</button>
        </form>

        {error ? (
          <div className="loading" style={{ flexDirection: 'column', gap: 10 }}>
            <div className="page-error" style={{ width: '100%', maxWidth: 600 }} role="alert">
              <AlertCircle size={18} /><span>{error}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
            </div>
          </div>
        ) : loading ? (
          <Loading label="Loading audit logs…" />
        ) : logs.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No audit logs found" message="Try widening your date range or clearing the filters." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Entity type</th>
                    <th>Document</th>
                    <th>Details</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => {
                    const details = detailsOf(log);
                    const preview = details
                      ? (typeof details === 'string' ? details : JSON.stringify(details))
                      : '';
                    const timestamp = log.createdAt || log.timestamp;
                    return (
                      <tr key={log.id || `${timestamp}-${index}`}>
                        <td className="audit-time">
                          {formatDateTime(timestamp)}
                          <small>{relativeTime(timestamp)}</small>
                        </td>
                        <td>
                          <div className="file-cell">
                            <span className="avatar avatar--sm">{initials(userOf(log))}</span>
                            <div className="file-cell__text"><strong>{userOf(log)}</strong></div>
                          </div>
                        </td>
                        <td><span className="audit-action">{prettify(log.action)}</span></td>
                        <td>{log.entityType || <span className="muted">—</span>}</td>
                        <td>{documentTitleOf(log) || <span className="muted">—</span>}</td>
                        <td>
                          {details ? (
                            <details className="audit-details">
                              <summary title={preview}>{preview.slice(0, 80) || 'View details'}</summary>
                              <pre>{typeof details === 'string' ? details : JSON.stringify(details, null, 2)}</pre>
                            </details>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td className="muted">{log.ip || log.ipAddress || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pages={pagination.pages}
              total={pagination.total}
              limit={pagination.limit}
              onChange={(value) => setPage(value)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
