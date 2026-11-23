import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Eye, Check, X, RotateCcw, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { StatusBadge, Card, EmptyState, Loading, FileIcon, Modal, useToast } from '../components/ui.jsx';
import { formatDateTime, relativeTime } from '../utils/format.js';
import '../styles/detail.css';

const ACTION_LABELS = {
  APPROVED: 'approved',
  APPROVE_STAGE1: 'approved and sent to the Dean',
  REJECTED: 'rejected',
  REVISION_REQUESTED: 'sent back for revision',
};

export default function Approvals() {
  const toast = useToast();
  const { hasRole } = useAuth();
  const canFinalAct = hasRole('DEAN', 'SUPER_ADMIN');

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('pending');

  const [reviewTarget, setReviewTarget] = useState(null);
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/documents/approvals/pending')
      .then(({ data }) => { if (!cancelled) setDocuments(data.documents || []); })
      .catch((err) => {
        if (cancelled) return;
        const message = errorMessage(err, 'Could not load pending approvals.');
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  const approveAction = (doc) => (
    doc.status === 'PENDING' && hasRole('DEPARTMENT_HEAD') && doc.requiresFinalApproval
      ? 'APPROVE_STAGE1'
      : 'APPROVED'
  );
  const approveLabel = (doc) => (approveAction(doc) === 'APPROVE_STAGE1' ? 'Approve & send to Dean' : 'Approve');

  const canActOn = (doc) => doc.status !== 'FINAL_REVIEW' || canFinalAct;

  const submitAction = async (doc, action) => {
    setBusy(true);
    setActionError('');
    try {
      const { data } = await api.post(`/documents/${doc.id}/approval`, { action, comments: comment });
      toast.success(data?.message || `Document ${ACTION_LABELS[action] || 'updated'} successfully.`);
      setReviewTarget(null);
      setComment('');
      refresh();
    } catch (err) {
      const message = errorMessage(err, 'Could not submit your review.');
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const quickApprove = async (doc) => {
    const action = approveAction(doc);
    setBusyId(doc.id);
    try {
      const { data } = await api.post(`/documents/${doc.id}/approval`, { action, comments: '' });
      toast.success(data?.message || `Document ${ACTION_LABELS[action]} successfully.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not approve this document.'));
    } finally {
      setBusyId(null);
    }
  };

  const closeReview = () => {
    setReviewTarget(null);
    setComment('');
    setActionError('');
  };

  const pending = documents.filter((doc) => doc.status === 'PENDING');
  const finalReview = documents.filter((doc) => doc.status === 'FINAL_REVIEW');
  const visible = tab === 'pending' ? pending : finalReview;

  const renderTable = (rows) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Department</th>
            <th>Uploader</th>
            <th>Submitted</th>
            <th>Stage</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id}>
              <td>
                <div className="approval-doc">
                  <span className="approval-doc__icon"><FileIcon name={doc.latestFileName} size={17} /></span>
                  <div className="approval-doc__text">
                    <strong title={doc.title}>{doc.title}</strong>
                    <small>{doc.referenceNumber || '—'} · Rev {doc.currentVersion?.versionNumber ?? doc.revisionCount ?? '—'}</small>
                  </div>
                </div>
              </td>
              <td>{doc.department?.name || '—'}</td>
              <td>{doc.uploader?.name || '—'}</td>
              <td>
                <span title={formatDateTime(doc.submittedAt || doc.updatedAt)}>{formatDateTime(doc.submittedAt || doc.updatedAt)}</span>
                <div className="small muted">{relativeTime(doc.submittedAt || doc.updatedAt)}</div>
              </td>
              <td>
                {doc.status === 'FINAL_REVIEW'
                  ? <span className="stage-chip stage-chip--final"><ShieldCheck size={12} /> Final review</span>
                  : <span className="stage-chip stage-chip--pending"><ClipboardCheck size={12} /> Department review</span>}
              </td>
              <td>
                <div className="row-actions">
                  {canActOn(doc) && (
                    <button type="button" className="btn btn--success btn--sm" disabled={busyId === doc.id} onClick={() => quickApprove(doc)}>
                      <Check size={14} /> {busyId === doc.id ? 'Working…' : approveLabel(doc)}
                    </button>
                  )}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setReviewTarget(doc); setComment(''); setActionError(''); }}><Eye size={14} /> Review</button>
                  <Link className="btn btn--ghost btn--sm" to={`/documents/${doc.id}`} title="Open document detail"><ExternalLink size={14} /> Open</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  let content;
  if (loading) {
    content = <Loading label="Loading pending approvals…" />;
  } else if (error) {
    content = <EmptyState icon={RefreshCw} title="Could not load approvals" message={error} action={<button type="button" className="btn btn--primary btn--sm" onClick={refresh}><RefreshCw size={14} /> Retry</button>} />;
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={ClipboardCheck}
        title={tab === 'pending' ? 'No pending reviews' : 'No documents in final review'}
        message={tab === 'pending'
          ? 'Documents submitted for approval will appear here.'
          : 'Documents that cleared department approval and await the Dean will appear here.'}
      />
    );
  } else {
    content = renderTable(visible);
  }

  const reviewCanAct = reviewTarget && canActOn(reviewTarget);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Review documents awaiting department or final approval.</p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Approval queues">
        <button type="button" role="tab" aria-selected={tab === 'pending'} className={`tab ${tab === 'pending' ? 'tab--active' : ''}`} onClick={() => setTab('pending')}>
          Pending <span className="tab__count">{pending.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'final'} className={`tab ${tab === 'final' ? 'tab--active' : ''}`} onClick={() => setTab('final')}>
          Final review <span className="tab__count">{finalReview.length}</span>
        </button>
      </div>

      {tab === 'final' && !canFinalAct && (
        <div className="notice notice--purple">
          <ShieldCheck size={18} />
          <div className="notice__body">
            <strong>Read-only final review queue</strong>
            <p>Only the Dean or a Super Admin can approve, reject or request revisions at this stage. You can still inspect documents and open their details.</p>
          </div>
        </div>
      )}

      <Card>{content}</Card>

      <Modal
        open={Boolean(reviewTarget)}
        onClose={closeReview}
        size="lg"
        title="Review document"
        subtitle={reviewTarget?.title}
        footer={
          <div className="review-footer">
            <button type="button" className="btn btn--ghost" onClick={closeReview}>Cancel</button>
            {reviewCanAct && (
              <>
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => submitAction(reviewTarget, 'REVISION_REQUESTED')}><RotateCcw size={14} /> Request revision</button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => submitAction(reviewTarget, 'REJECTED')}><X size={14} /> Reject</button>
                <button type="button" className="btn btn--success" disabled={busy} onClick={() => submitAction(reviewTarget, approveAction(reviewTarget))}>
                  <Check size={14} /> {busy ? 'Working…' : approveLabel(reviewTarget)}
                </button>
              </>
            )}
          </div>
        }
      >
        {reviewTarget && (
          <>
            <div className="review-details">
              <div><small>Status</small><strong><StatusBadge status={reviewTarget.status} /></strong></div>
              <div><small>Department</small><strong>{reviewTarget.department?.name || '—'}</strong></div>
              <div><small>Uploaded by</small><strong>{reviewTarget.uploader?.name || '—'}</strong></div>
              <div><small>Revision</small><strong>Rev {reviewTarget.currentVersion?.versionNumber ?? reviewTarget.revisionCount ?? '—'}</strong></div>
              <div><small>Reference</small><strong>{reviewTarget.referenceNumber || '—'}</strong></div>
              <div><small>Submitted</small><strong>{formatDateTime(reviewTarget.submittedAt || reviewTarget.updatedAt)}</strong></div>
            </div>
            {reviewTarget.description && <p className="description-text" style={{ marginBottom: 16 }}>{reviewTarget.description}</p>}
            <Link to={`/documents/${reviewTarget.id}`} className="link-btn" style={{ marginBottom: 16 }}><ExternalLink size={14} /> Open full document details</Link>
            {reviewCanAct ? (
              <div className="field">
                <label htmlFor="review-comment">Comments {reviewTarget.status === 'FINAL_REVIEW' ? '(final review)' : ''}</label>
                <textarea id="review-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note for the uploader or reviewers…" disabled={busy} />
              </div>
            ) : (
              <div className="notice notice--purple" style={{ marginBottom: 0 }}>
                <ShieldCheck size={17} />
                <div className="notice__body"><strong>Dean approval required</strong><p>Only the Dean or a Super Admin can act on documents in final review.</p></div>
              </div>
            )}
            {actionError && <div className="inline-error">{actionError}</div>}
          </>
        )}
      </Modal>
    </>
  );
}
