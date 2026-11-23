import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Archive, BarChart3, Building2, CalendarClock, CheckCircle2,
  ClipboardCheck, Clock3, Download, FileEdit, FileSpreadsheet, FileText,
  Printer, RefreshCw, Repeat2, SlidersHorizontal, TrendingUp, XCircle,
} from 'lucide-react';
import api, { downloadBlob, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, EmptyState, Loading, ProgressBar, StatusBadge, useToast } from '../components/ui.jsx';
import { daysUntil, formatDate, formatDateTime, relativeTime } from '../utils/format.js';
import '../styles/advanced.css';

const EMPTY_FILTERS = { from: '', to: '', departmentId: '' };

const STAT_DEFS = [
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'approved', label: 'Approved', icon: CheckCircle2, tone: 'green' },
  { key: 'pending', label: 'Pending', icon: Clock3, tone: 'amber' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, tone: 'red' },
  { key: 'draft', label: 'Draft', icon: FileEdit },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'revisions', label: 'Revisions', icon: Repeat2, tone: 'purple' },
  { key: 'expiringSoon', label: 'Expiring soon', icon: CalendarClock, tone: 'amber' },
  { key: 'expired', label: 'Expired', icon: AlertCircle, tone: 'red' },
];

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') {
    return value.name || value.title || value.code || value.originalName || value.fileName || fallback;
  }
  return value;
}

function prettify(value) {
  return String(displayValue(value, 'Unknown'))
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toRows(raw, labelKeys = [], countKeys = []) {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (!item || typeof item !== 'object') return { name: String(item ?? 'Unknown'), count: 1 };
      const names = [...labelKeys, 'name', 'label', 'title', 'month', 'department', 'category', 'uploader', 'status', '_id'];
      const counts = [...countKeys, 'count', 'total', 'value', 'documents', 'uploads'];
      const name = names.map((key) => item[key]).find((v) => typeof v === 'string' && v.trim())
        || displayValue(item.department || item.category || item.uploader, 'Unknown');
      const count = counts.map((key) => item[key]).find((v) => typeof v === 'number' && Number.isFinite(v));
      return { name: String(name), count: Number(count ?? 0) };
    }).filter((row) => row.count > 0);
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([name, value]) => ({
      name,
      count: typeof value === 'number'
        ? value
        : Number(value?.count ?? value?.total ?? value?.value ?? 0),
    })).filter((row) => Number.isFinite(row.count) && row.count > 0);
  }
  return [];
}

function filterSummary(filtersApplied, departments = []) {
  if (!filtersApplied) return 'All dates · All departments';
  if (typeof filtersApplied === 'string') return filtersApplied;
  if (Array.isArray(filtersApplied)) return filtersApplied.join(' · ') || 'All dates · All departments';
  if (typeof filtersApplied === 'object') {
    const parts = [];
    if (filtersApplied.from) parts.push(`From ${formatDate(filtersApplied.from)}`);
    if (filtersApplied.to) parts.push(`To ${formatDate(filtersApplied.to)}`);
    if (filtersApplied.departmentId) {
      const department = departments.find((item) => String(item.id) === String(filtersApplied.departmentId));
      parts.push(`Department ${displayValue(department?.name, filtersApplied.departmentId)}`);
    }
    return parts.join(' · ') || 'All dates · All departments';
  }
  return 'All dates · All departments';
}

function docCell(doc) {
  return (
    <>
      <Link to={`/documents/${doc.id}`} className="cell-title">{displayValue(doc.title, 'Untitled document')}</Link>
      <div className="cell-sub">{displayValue(doc.referenceNumber || doc.category || doc.latestFileName, '—')}</div>
    </>
  );
}

function DaysCell({ doc }) {
  const raw = doc.daysLeft ?? daysUntil(doc.expiresAt);
  const days = Number(raw);
  if (!Number.isFinite(days)) return <span className="muted">—</span>;
  const tone = days < 0 ? 'chip--danger' : days <= 7 ? 'chip--warn' : 'chip--ok';
  return <span className={`chip ${tone}`}>{days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}</span>;
}

function HBarList({ rows, emptyMessage }) {
  if (!rows.length) return <EmptyState icon={BarChart3} title="No data" message={emptyMessage} />;
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div>
      {rows.slice(0, 10).map((row, index) => (
        <div className="hbar" key={`${row.name}-${index}`}>
          <span className="hbar__label" title={row.name}>{prettify(row.name)}</span>
          <ProgressBar value={row.count} max={max} />
          <span className="hbar__count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function ReportTable({ title, subtitle, icon = FileText, rows, columns, emptyMessage }) {
  return (
    <Card title={title} subtitle={subtitle} className="adv-table-card">
      {rows.length === 0 ? (
        <EmptyState icon={icon} title="No records" message={emptyMessage} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{columns.map((column) => <th key={column.header}>{column.header}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id || `${title}-${index}`}>
                  {columns.map((column) => <td key={column.header}>{column.render(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Analytics() {
  const { canExport } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [departments, setDepartments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/departments').then(({ data }) => {
      if (!active) return;
      const list = Array.isArray(data) ? data : (data?.departments || []);
      setDepartments(list.filter((item) => item?.id && item.isActive !== false));
    }).catch(() => { /* the date-only report still works without departments */ });
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/reports/analytics', { params: applied });
      setAnalytics(data?.analytics || data || {});
    } catch (err) {
      const message = errorMessage(err, 'Unable to load analytics.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [applied, toast]);

  useEffect(() => { load(); }, [load]);

  const applyFilters = () => setApplied({ ...filters });
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); };

  const exportReport = async (format) => {
    if (!canExport || exporting) return;
    setExporting(format);
    try {
      await downloadBlob(`/reports/export/${format}${buildQuery(applied)}`, `llcc-analytics.${format}`);
      toast.success(`${format.toUpperCase()} report downloaded.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to export the report.'));
    } finally {
      setExporting('');
    }
  };

  if (loading && !analytics) return <Loading label="Generating analytics…" />;
  if (error && !analytics) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><RefreshCw size={26} /></div>
        <h4>Couldn't load analytics</h4>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
      </div>
    );
  }

  const totals = analytics?.totals || {};
  const rawRate = analytics?.approvalRate ?? totals.approvalRate;
  const parsedRate = typeof rawRate === 'string' && rawRate.trim().endsWith('%')
    ? Number.parseFloat(rawRate)
    : Number(rawRate);
  const approvalRate = Number.isFinite(parsedRate)
    ? (parsedRate > 0 && parsedRate <= 1 ? Math.round(parsedRate * 100) : Math.round(parsedRate))
    : 0;
  const monthlyUploads = toRows(analytics?.monthlyUploads, ['month', 'label', 'period'], ['uploads', 'count', 'total']).slice(-12);
  const maxMonthly = Math.max(1, ...monthlyUploads.map((row) => row.count));
  const departmentRows = toRows(analytics?.byDepartment, ['department', 'name'], ['documents', 'count', 'total']);
  const categoryRows = toRows(analytics?.byCategory, ['category', 'name'], ['documents', 'count', 'total']);
  const uploaderRows = toRows(analytics?.byUploader, ['uploader', 'name'], ['documents', 'count', 'total']);
  const statusRows = toRows(analytics?.byStatus, ['status', 'name'], ['documents', 'count', 'total']);

  const asArray = (value) => (Array.isArray(value) ? value : []);
  const recentUploads = asArray(analytics?.recentUploads);
  const recentUpdates = asArray(analytics?.recentUpdates);
  const expiringSoon = asArray(analytics?.expiringSoon);
  const expired = asArray(analytics?.expired);
  const pendingDocuments = asArray(analytics?.pendingDocuments);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics & Reports</h1>
          <p>Repository statistics calculated from live document records.</p>
          <div className="adv-filter-summary">
            <span><strong>Scope:</strong> {displayValue(analytics?.scopeLabel, 'Entire repository')}</span>
            <span title={JSON.stringify(analytics?.filtersApplied || {})}><strong>Filters:</strong> {filterSummary(analytics?.filtersApplied, departments)}</span>
            {analytics?.generatedAt && <span><strong>Generated:</strong> {formatDateTime(analytics.generatedAt)}</span>}
          </div>
        </div>
        <div className="page-actions adv-no-print">
          <button type="button" className="btn btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => exportReport('pdf')}
            disabled={!canExport || Boolean(exporting)}
            title={!canExport ? 'Export requires Super Admin, Dean or Department Head access' : 'Export PDF'}
          >
            <Download size={15} /> {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => exportReport('excel')}
            disabled={!canExport || Boolean(exporting)}
            title={!canExport ? 'Export requires Super Admin, Dean or Department Head access' : 'Export Excel'}
          >
            <FileSpreadsheet size={15} /> {exporting === 'excel' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {!canExport && (
        <div className="adv-notice adv-notice--amber adv-no-print">
          <SlidersHorizontal size={18} />
          <div><strong>Exports are restricted</strong><p>Staff accounts can view this report but cannot download PDF or Excel exports. Contact an administrator if you need an exported copy.</p></div>
        </div>
      )}
      {error && analytics && (
        <div className="adv-notice adv-notice--danger">
          <AlertCircle size={18} />
          <div><strong>The report could not be refreshed</strong><p>{error} Showing the last successful result.</p></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Retry</button>
        </div>
      )}

      <div className="adv-no-print" style={{ marginBottom: 18 }}>
        <Card title="Report filters" subtitle="Apply a date range or department to refresh every figure below.">
          <div className="filters" style={{ padding: 0, border: 0 }}>
            <div className="field">
              <label htmlFor="analytics-from">From</label>
              <input id="analytics-from" type="date" value={filters.from} onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="analytics-to">To</label>
              <input id="analytics-to" type="date" value={filters.to} onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="analytics-department">Department</label>
              <select id="analytics-department" value={filters.departmentId} onChange={(event) => setFilters((f) => ({ ...f, departmentId: event.target.value }))}>
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{displayValue(department.name, department.code)}</option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn--primary" onClick={applyFilters} disabled={loading}><SlidersHorizontal size={15} /> Apply</button>
            <button type="button" className="btn btn--ghost" onClick={resetFilters} disabled={loading}>Reset</button>
          </div>
        </Card>
      </div>

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        {STAT_DEFS.map(({ key, label, icon: Icon, tone }) => (
          <div className="stat-card" key={key}>
            <div className={`stat-card__icon ${tone ? `stat-card__icon--${tone}` : ''}`}><Icon size={20} /></div>
            <div>
              <div className="stat-card__label">{label}</div>
              <div className="stat-card__value">{Number(totals[key] || 0).toLocaleString()}</div>
            </div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--green"><TrendingUp size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="stat-card__label">Approval rate</div>
            <div className="stat-card__value">{approvalRate}%</div>
            <div className="adv-rate"><ProgressBar value={approvalRate} max={100} tone="green" /></div>
          </div>
        </div>
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title="Monthly uploads" subtitle="Last 12 months" className="adv-chart-card adv-span-2">
          {monthlyUploads.length === 0 ? (
            <EmptyState icon={BarChart3} title="No upload history" message="Monthly upload totals will appear here as documents are filed." />
          ) : (
            <div className="bar-chart">
              {monthlyUploads.map((row, index) => (
                <div className="bar-chart__col" key={`${row.name}-${index}`}>
                  <div
                    className="bar-chart__bar"
                    data-value={`${row.name}: ${row.count}`}
                    style={{ height: `${Math.max(3, Math.round((row.count / maxMonthly) * 82))}%` }}
                  />
                  <span className="bar-chart__label" title={row.name}>{row.name.length > 8 ? `${row.name.slice(0, 8)}…` : row.name}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Documents by department" subtitle="Repository distribution" className="adv-chart-card">
          <HBarList rows={departmentRows} emptyMessage="No department figures are available for this period." />
        </Card>
        <Card title="Documents by category" subtitle="Most used categories" className="adv-chart-card">
          <HBarList rows={categoryRows} emptyMessage="No category figures are available for this period." />
        </Card>
        <Card title="Documents by uploader" subtitle="Contributors in scope" className="adv-chart-card">
          <HBarList rows={uploaderRows} emptyMessage="No uploader figures are available for this period." />
        </Card>
        <Card title="Documents by status" subtitle="Current workflow states" className="adv-chart-card">
          <HBarList rows={statusRows} emptyMessage="No status figures are available for this period." />
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <ReportTable
          title="Recently uploaded"
          subtitle="Newest records in the selected scope"
          rows={recentUploads}
          emptyMessage="No uploads have been recorded for this report."
          columns={[
            { header: 'Document', render: (doc) => docCell(doc) },
            { header: 'Department', render: (doc) => displayValue(doc.department) },
            { header: 'Uploaded by', render: (doc) => displayValue(doc.uploader) },
            { header: 'Status', render: (doc) => <StatusBadge status={doc.status} /> },
            { header: 'When', render: (doc) => <span title={formatDateTime(doc.createdAt)}>{relativeTime(doc.createdAt)}</span> },
          ]}
        />
        <ReportTable
          title="Recently modified"
          subtitle="Latest revisions and metadata updates"
          rows={recentUpdates}
          emptyMessage="No recently modified documents were found."
          columns={[
            { header: 'Document', render: (doc) => docCell(doc) },
            { header: 'Revision', render: (doc) => (doc.currentVersion?.versionNumber ? `v${doc.currentVersion.versionNumber}` : `v${Number(doc.revisionCount || 1)}`) },
            { header: 'Department', render: (doc) => displayValue(doc.department) },
            { header: 'Updated', render: (doc) => <span title={formatDateTime(doc.updatedAt)}>{relativeTime(doc.updatedAt)}</span> },
          ]}
        />
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <ReportTable
          title="Expiring soon"
          subtitle="Approved records nearing their expiry date"
          icon={CalendarClock}
          rows={expiringSoon}
          emptyMessage="Nothing is approaching expiration in this scope."
          columns={[
            { header: 'Document', render: (doc) => docCell(doc) },
            { header: 'Department', render: (doc) => displayValue(doc.department) },
            { header: 'Expires', render: (doc) => formatDate(doc.expiresAt) },
            { header: 'Time left', render: (doc) => <DaysCell doc={doc} /> },
            { header: 'Status', render: (doc) => <StatusBadge status={doc.status} /> },
          ]}
        />
        <ReportTable
          title="Expired"
          subtitle="Records whose expiry date has passed"
          icon={AlertCircle}
          rows={expired}
          emptyMessage="There are no expired documents in this scope."
          columns={[
            { header: 'Document', render: (doc) => docCell(doc) },
            { header: 'Department', render: (doc) => displayValue(doc.department) },
            { header: 'Expired on', render: (doc) => formatDate(doc.expiresAt) },
            { header: 'Owner', render: (doc) => displayValue(doc.uploader || doc.owner) },
            { header: 'Status', render: (doc) => <StatusBadge status={doc.status} /> },
          ]}
        />
      </div>

      <ReportTable
        title="Pending approvals"
        subtitle="Documents awaiting a decision"
        icon={ClipboardCheck}
        rows={pendingDocuments}
        emptyMessage="There are no documents awaiting approval."
        columns={[
          { header: 'Document', render: (doc) => docCell(doc) },
          { header: 'Department', render: (doc) => displayValue(doc.department) },
          { header: 'Submitted by', render: (doc) => displayValue(doc.uploader || doc.submittedBy) },
          { header: 'Submitted', render: (doc) => <span title={formatDateTime(doc.createdAt || doc.updatedAt)}>{relativeTime(doc.createdAt || doc.updatedAt)}</span> },
          { header: 'Status', render: (doc) => <StatusBadge status={doc.status} /> },
        ]}
      />

      <p className="adv-subtle" style={{ marginTop: 16 }}>
        <Building2 size={12} /> Figures reflect the filters applied above. Exported files use the same scope.
      </p>
    </>
  );
}
