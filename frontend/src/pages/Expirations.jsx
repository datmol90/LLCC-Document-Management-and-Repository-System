import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, Download, ExternalLink, FileText,
  Info, RefreshCw, ScanSearch,
} from 'lucide-react';
import api, { downloadBlob, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, Loading, StatusBadge, useToast } from '../components/ui.jsx';
import { daysUntil, formatDate, formatDateTime } from '../utils/format.js';
import '../styles/advanced.css';

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value.name || value.title || value.code || value.originalName || fallback;
  return value;
}

function prettify(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysChip(doc) {
  const raw = doc.daysLeft ?? daysUntil(doc.expiresAt);
  const days = Number(raw);
  if (!Number.isFinite(days)) return <span className="muted">—</span>;
  const expired = days < 0;
  return (
    <span className={`chip ${expired ? 'chip--danger' : days <= 7 ? 'chip--warn' : 'chip--ok'}`}>
      {expired ? `${Math.abs(days)}d overdue` : `${days}d left`}
    </span>
  );
}

export default function Expirations() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [scanning, setScanning] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await api.get('/documents/expiring');
      setData(payload || {});
    } catch (err) {
      const message = errorMessage(err, 'Unable to load expiration data.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    api.get('/settings').then(({ data: payload }) => {
      if (active) setSettings(payload?.settings || null);
    }).catch(() => { /* reminder windows are optional context */ });
    return () => { active = false; };
  }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const { data: payload } = await api.post('/documents/run-expiration-scan');
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
      const counts = Object.entries(result || {})
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        .map(([key, value]) => `${prettify(key)}: ${value}`);
      toast.success(counts.length
        ? `Expiration scan complete — ${counts.join(', ')}`
        : (payload?.message || 'Expiration scan completed.'));
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to run the expiration scan.'));
    } finally {
      setScanning(false);
    }
  };

  const download = async (doc) => {
    setDownloadingId(doc.id);
    try {
      await downloadBlob(`/documents/${doc.id}/download`, doc.latestFileName || `document-${doc.id}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to download this document.'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading && !data) return <Loading label="Loading expiration records…" />;
  if (error && !data) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><RefreshCw size={26} /></div>
        <h4>Couldn't load expiration records</h4>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
      </div>
    );
  }

  const expiring = Array.isArray(data?.expiring) ? data.expiring : [];
  const expired = Array.isArray(data?.expired) ? data.expired : [];
  const rows = tab === 'expired' ? expired : expiring;
  const reminders = Array.isArray(settings?.expiryReminderDays)
    ? settings.expiryReminderDays.join(', ')
    : '';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expirations</h1>
          <p>Monitor upcoming renewals and records whose validity has lapsed.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          {isAdmin && (
            <button type="button" className="btn btn--primary" onClick={runScan} disabled={scanning}>
              <ScanSearch size={16} /> {scanning ? 'Scanning…' : 'Run expiration scan'}
            </button>
          )}
        </div>
      </div>

      <div className="adv-notice adv-notice--info">
        <Info size={18} />
        <div>
          <strong>How reminders and expiry work</strong>
          <p>
            {reminders
              ? `Reminder notifications are sent at ${reminders} day${reminders.includes(',') ? 's' : ''} before expiry (as configured in Settings). `
              : 'Reminder windows are configured by your administrator in Settings. '}
            Once the expiry date passes, a document is expired — even an approved document is no longer treated as valid until it is renewed. Review expired records and upload a new version or submit them for approval again.
          </p>
        </div>
      </div>
      {error && data && (
        <div className="adv-notice adv-notice--danger">
          <AlertTriangle size={18} />
          <div><strong>Refresh failed</strong><p>{error} Showing the last loaded result.</p></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Retry</button>
        </div>
      )}

      <section className="card">
        <div className="card__head">
          <div className="adv-tabs" role="tablist" aria-label="Expiration status">
            <button type="button" role="tab" aria-selected={tab === 'upcoming'} className={`adv-tab ${tab === 'upcoming' ? 'adv-tab--active' : ''}`} onClick={() => setTab('upcoming')}>
              <CalendarClock size={14} /> Upcoming <span className="adv-tab__count">{expiring.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'expired'} className={`adv-tab ${tab === 'expired' ? 'adv-tab--active' : ''}`} onClick={() => setTab('expired')}>
              <AlertTriangle size={14} /> Expired <span className="adv-tab__count">{expired.length}</span>
            </button>
          </div>
          <span className="muted small">{tab === 'expired' ? 'Validity has lapsed' : 'Approaching expiry date'}</span>
        </div>
        <div className="card__body card__body--flush">
          {rows.length === 0 ? (
            <EmptyState
              icon={tab === 'expired' ? AlertTriangle : CalendarClock}
              title={tab === 'expired' ? 'No expired documents' : 'Nothing expiring soon'}
              message={tab === 'expired'
                ? 'Documents past their expiry date will be listed here.'
                : 'Documents approaching their expiry date will be listed here.'}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Department</th>
                    <th>Expires</th>
                    <th>Time left</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((doc) => {
                    const expiredRow = tab === 'expired' || Number(doc.daysLeft ?? daysUntil(doc.expiresAt)) < 0;
                    return (
                      <tr key={doc.id}>
                        <td>
                          <Link to={`/documents/${doc.id}`} className="cell-title">{displayValue(doc.title, 'Untitled document')}</Link>
                          <div className="cell-sub">{displayValue(doc.referenceNumber || doc.category || doc.latestFileName, '—')}</div>
                        </td>
                        <td>{displayValue(doc.department)}</td>
                        <td>
                          <span title={formatDateTime(doc.expiresAt)}>{formatDate(doc.expiresAt)}</span>
                          {expiredRow && <div className="cell-sub"><span className="chip chip--danger">Expired</span></div>}
                        </td>
                        <td>{daysChip(doc)}</td>
                        <td><StatusBadge status={doc.status} /></td>
                        <td>{displayValue(doc.uploader || doc.owner || doc.createdBy)}</td>
                        <td>
                          <div className="row-actions">
                            <Link className="icon-btn" to={`/documents/${doc.id}`} title="Open detail" aria-label="Open detail"><ExternalLink size={15} /></Link>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Download latest file"
                              aria-label="Download latest file"
                              disabled={downloadingId === doc.id}
                              onClick={() => download(doc)}
                            >
                              <Download size={15} />
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
        <FileText size={12} /> Times are calculated from the expiry date recorded on each document. Use Open detail to review or renew a record.
      </p>
    </>
  );
}
