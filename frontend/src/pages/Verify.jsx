import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, FileSearch, GraduationCap, Home, LogIn,
  Printer, QrCode, RefreshCw, ShieldCheck,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, StatusBadge } from '../components/ui.jsx';
import { formatDateTime } from '../utils/format.js';
import '../styles/advanced.css';

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') {
    return value.name || value.title || value.code || value.originalName || value.fileName || fallback;
  }
  return value;
}

function statusInfo(payload) {
  const validity = String(payload?.document?.validity || payload?.validity || '').toUpperCase();
  const result = String(payload?.result || '').toUpperCase();
  const valid = payload?.valid === true || result === 'VALID' || result === 'APPROVED';
  const message = payload?.message;

  if (result === 'NOT_FOUND' || !payload?.document) {
    return {
      tone: 'invalid',
      title: 'Record not found',
      detail: message || 'No document matches this verification code. Check the code and try again.',
    };
  }
  if (!valid || ['EXPIRED', 'REVOKED', 'REJECTED', 'ARCHIVED'].includes(validity)) {
    return {
      tone: 'warn',
      title: validity === 'EXPIRED' ? 'Record has expired' : 'Record could not be confirmed as valid',
      detail: message || 'This verification code does not correspond to a currently valid approved record.',
    };
  }
  return {
    tone: 'valid',
    title: 'Verified document record',
    detail: message || 'The metadata shown below matches an approved record in the LLCC repository.',
  };
}

export default function Verify() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const checkedAt = useRef(new Date().toISOString()).current;
  const scanInputRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState('');

  useEffect(() => {
    if (scanOpen) scanInputRef.current?.focus();
  }, [scanOpen]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get(`/verify/${encodeURIComponent(code || '')}`)
      .then(({ data: payload }) => {
        if (active) setData(payload || {});
      })
      .catch((err) => {
        if (!active) return;
        const payload = err?.response?.data;
        if (payload && typeof payload === 'object' && ('valid' in payload || 'result' in payload || 'document' in payload)) {
          setData({ ...payload, valid: payload.valid === true });
        } else {
          setError(errorMessage(err, 'Unable to verify this document right now.'));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  const submitScan = (event) => {
    event.preventDefault();
    const next = String(scanCode || '').trim();
    if (!next) return;
    setScanOpen(false);
    setScanCode('');
    navigate(`/verify/${encodeURIComponent(next)}`);
  };

  const status = statusInfo(data);
  const doc = data?.document || {};
  const details = [
    { label: 'Document title', value: displayValue(doc.title) },
    { label: 'Reference code', value: displayValue(doc.verificationCode || data?.code || code), mono: true },
    { label: 'Department', value: displayValue(doc.department) },
    { label: 'Category', value: displayValue(doc.category) },
    { label: 'Status', value: doc.status ? <StatusBadge status={doc.status} /> : '—' },
    { label: 'Revision count', value: doc.revisionCount ?? doc.revisions ?? doc.versionCount ?? '—' },
    { label: 'Approved by', value: displayValue(doc.approvedBy) },
    { label: 'Approved at', value: formatDateTime(doc.approvedAt) },
    { label: 'Last updated', value: formatDateTime(doc.updatedOn || doc.updatedAt) },
    { label: 'File name', value: displayValue(doc.file || doc.fileName || doc.latestFileName) },
    { label: 'Verification date/time', value: formatDateTime(data?.verifiedAt || checkedAt) },
  ];

  return (
    <div className="verify-page">
      <div className="verify-card">
        <div className="verify-card__top">
          <span className="adv-verify-icon"><GraduationCap size={24} /></span>
          <div className="adv-verify-card__brand">
            <h1>LLCC Document Management System</h1>
            <p>Laguna College · Official verification record</p>
          </div>
          <QrCode size={26} style={{ marginLeft: 'auto', opacity: .8 }} />
        </div>

        <div className="verify-result">
          {loading && !data ? (
            <Loading label="Verifying document code…" />
          ) : error && !data ? (
            <>
              <div className="verify-status verify-status--invalid">
                <AlertTriangle size={24} className="adv-verify-result-icon" />
                <div><strong>Verification unavailable</strong><small>{error}</small></div>
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
                <RefreshCw size={15} /> Try again
              </button>
            </>
          ) : (
            <>
              <div className={`verify-status verify-status--${status.tone}`}>
                {status.tone === 'valid' ? <CheckCircle2 size={26} className="adv-verify-result-icon" /> : <AlertTriangle size={26} className="adv-verify-result-icon" />}
                <div><strong>{status.title}</strong><small>{status.detail}</small></div>
              </div>

              <div className="detail-grid">
                {details.map((item) => (
                  <div className="detail-item" key={item.label}>
                    <small>{item.label}</small>
                    <strong className={item.mono ? 'adv-mono' : ''}>{item.value}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          <form className="adv-code-form adv-no-print" style={{ display: scanOpen ? 'flex' : 'none' }} onSubmit={submitScan}>
            <input
              ref={scanInputRef}
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setScanOpen(false); }}
              placeholder="Enter a verification code"
              aria-label="Verification code"
            />
            <button type="submit" className="btn btn--primary"><FileSearch size={15} /> Verify</button>
          </form>
        </div>

        <div className="adv-verify-actions adv-no-print">
          <button type="button" className="btn btn--ghost" onClick={() => window.print()}><Printer size={15} /> Print verification page</button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => (scanOpen ? setScanOpen(false) : setScanOpen(true))}
          >
            <FileSearch size={15} /> Scan another
          </button>
          <Link to="/" className="btn btn--ghost"><Home size={15} /> Home</Link>
          {!user && <Link to="/login" className="btn btn--primary"><LogIn size={15} /> Back to login</Link>}
        </div>

        <div className="adv-verify-foot">
          <ShieldCheck size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          This page confirms the record metadata only. Private files are never exposed through public verification links.
        </div>
      </div>
    </div>
  );
}
