import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, Archive, Building2, CheckCircle2, ClipboardCheck, DatabaseBackup,
  FileEdit, FileText, RefreshCw, Upload, Users, XCircle,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, Loading, StatusBadge, useToast } from '../components/ui.jsx';
import { formatDateTime, queryString, relativeTime } from '../utils/format.js';
import '../styles/dashboard.css';

const STAT_DEFS = [
  { key: 'totalDocuments', label: 'Total Documents', icon: FileText, tone: '' },
  { key: 'pendingApprovals', label: 'Pending Approvals', icon: ClipboardCheck, tone: 'amber' },
  { key: 'approved', label: 'Approved', icon: CheckCircle2, tone: 'green' },
  { key: 'totalDepartments', label: 'Departments', icon: Building2, tone: 'purple' },
  { key: 'totalUsers', label: 'Users', icon: Users, tone: 'purple' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, tone: 'red' },
  { key: 'archived', label: 'Archived', icon: Archive, tone: '' },
  { key: 'draft', label: 'Draft', icon: FileEdit, tone: '' },
];

function prettifyAction(action) {
  return String(action || 'updated')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function activityParts(item) {
  const actor = item.user?.name || item.actor?.name || item.userName
    || item.performedBy?.name || 'System';
  const action = prettifyAction(item.action || item.type || 'updated');
  const title = item.document?.title || item.documentTitle || item.title || 'a document';
  const time = item.createdAt || item.timestamp || item.at;
  return { actor, action, title, time };
}

function normalizeDepartmentStats(raw, docs) {
  const list = Array.isArray(raw) ? raw : (raw?.departments || []);
  let rows = list.map((item) => ({
    name: item.department?.name || item.name || item.departmentName || item._id || 'Unknown',
    count: Number(item.count ?? item.total ?? item.documents ?? item.value ?? 0),
  }));
  if (!rows.length && docs.length) {
    const grouped = {};
    docs.forEach((doc) => {
      const name = doc.department?.name || 'Unassigned';
      grouped[name] = (grouped[name] || 0) + 1;
    });
    rows = Object.entries(grouped).map(([name, count]) => ({ name, count }));
  }
  return rows
    .filter((row) => row.name && row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function RecentTable({ title, subtitle, headers, rows, emptyMessage, renderRow }) {
  return (
    <section className="card">
      <div className="card__head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      <div className="card__body card__body--flush">
        {rows.length === 0 ? (
          <EmptyState icon={FileText} title="Nothing to show" message={emptyMessage} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { user, roleLabel, canApprove, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: payload } = await api.get('/dashboard');
      setData(payload || {});
    } catch (err) {
      const message = errorMessage(err, 'Unable to load the dashboard.');
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const stats = data?.stats || {};
  const recentUploads = data?.recentUploads || [];
  const recentUpdates = data?.recentUpdates || [];
  const recentActivity = data?.recentActivity || [];
  const departmentStats = normalizeDepartmentStats(data?.departmentStats, recentUploads);
  const maxDept = Math.max(1, ...departmentStats.map((row) => row.count));

  const visibleStats = STAT_DEFS.filter((stat) => {
    if (user?.role === 'STAFF' && ['totalUsers', 'totalDepartments'].includes(stat.key) && !Number(stats[stat.key])) {
      return false;
    }
    return true;
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = String(user?.name || 'there').split(/\s+/)[0];
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  if (loading && !data) return <Loading label="Loading dashboard…" />;

  if (loadError && !data) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><RefreshCw size={26} /></div>
        <h4>Couldn't load the dashboard</h4>
        <p>{loadError}</p>
        <button type="button" className="btn btn--primary" onClick={load}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting}, {firstName}</h1>
          <p>
            {roleLabel && <>{roleLabel} · </>}{today}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate(`/documents${queryString({ new: 1 })}`)}>
            <Upload size={16} /> Upload document
          </button>
          {canApprove && (
            <button type="button" className="btn btn--primary" onClick={() => navigate('/approvals')}>
              <ClipboardCheck size={16} /> Review pending
            </button>
          )}
          {isAdmin && (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => navigate('/users')}>
                <Users size={16} /> Manage users
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => navigate('/backups')}>
                <DatabaseBackup size={16} /> Backups
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        {visibleStats.map(({ key, label, icon: Icon, tone }) => (
          <div className="stat-card" key={key}>
            <div className={`stat-card__icon ${tone ? `stat-card__icon--${tone}` : ''}`}>
              <Icon size={20} />
            </div>
            <div>
              <div className="stat-card__label">{label}</div>
              <div className="stat-card__value">{Number(stats[key] || 0).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <RecentTable
          title="Recent uploads"
          subtitle="Newest documents added to the repository"
          headers={['Document', 'Department', 'Uploaded by', 'Status', 'Updated']}
          rows={recentUploads}
          emptyMessage="Documents that are uploaded will appear here."
          renderRow={(doc) => (
            <tr key={doc.id}>
              <td>
                <Link to={`/documents/${doc.id}`} className="cell-title">{doc.title}</Link>
                <div className="cell-sub">{doc.referenceNumber || doc.category || doc.latestFileName || '—'}</div>
              </td>
              <td>{doc.department?.name || '—'}</td>
              <td>{doc.uploader?.name || '—'}</td>
              <td><StatusBadge status={doc.status} /></td>
              <td title={formatDateTime(doc.updatedAt)}>{relativeTime(doc.updatedAt)}</td>
            </tr>
          )}
        />
        <RecentTable
          title="Recently modified"
          subtitle="Documents with the latest revisions"
          headers={['Document', 'Revision', 'Department', 'Updated']}
          rows={recentUpdates}
          emptyMessage="Document revisions will appear here."
          renderRow={(doc) => (
            <tr key={doc.id}>
              <td>
                <Link to={`/documents/${doc.id}`} className="cell-title">{doc.title}</Link>
                <div className="cell-sub">{doc.latestFileName || doc.referenceNumber || '—'}</div>
              </td>
              <td>{doc.currentVersion?.versionNumber ? `v${doc.currentVersion.versionNumber}` : `v${doc.revisionCount || 1}`}</td>
              <td>{doc.department?.name || '—'}</td>
              <td title={formatDateTime(doc.updatedAt)}>{relativeTime(doc.updatedAt)}</td>
            </tr>
          )}
        />
      </div>

      <div className="grid grid--2">
        <section className="card">
          <div className="card__head"><div><h3>Documents by department</h3><p>Share of the repository by department</p></div></div>
          <div className="card__body">
            {departmentStats.length === 0 ? (
              <EmptyState icon={Building2} title="No department data" message="Department statistics will appear once documents are filed." />
            ) : departmentStats.map((row) => (
              <div className="hbar" key={`${row.name}-${row.count}`}>
                <span className="hbar__label" title={row.name}>{row.name}</span>
                <div className="progress">
                  <div className="progress__fill" style={{ width: `${Math.round((row.count / maxDept) * 100)}%` }} />
                </div>
                <span className="hbar__count">{row.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card__head"><div><h3>Recent system activity</h3><p>Latest actions across the workspace</p></div></div>
          <div className="card__body">
            {recentActivity.length === 0 ? (
              <EmptyState icon={Activity} title="No activity yet" message="Audited actions will be shown here as they happen." />
            ) : (
              <div className="activity-list">
                {recentActivity.map((item, index) => {
                  const { actor, action, title, time } = activityParts(item);
                  return (
                    <div className="activity-item" key={item.id || `${actor}-${index}`}>
                      <span className="activity-item__icon"><Activity size={15} /></span>
                      <div>
                        <p><strong>{actor}</strong> {action} <span>{title}</span></p>
                        <time title={formatDateTime(time)}>{relativeTime(time)}</time>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
