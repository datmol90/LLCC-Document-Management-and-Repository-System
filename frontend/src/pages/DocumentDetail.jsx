import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Download, Eye, Pencil, Send, Archive, ArchiveRestore, Trash2,
  QrCode, History, FileText, AlertTriangle, CalendarClock, ShieldCheck,
  CheckCircle2, RefreshCw, ClipboardCheck,
} from 'lucide-react';
import api, { errorMessage, downloadBlob } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  StatusBadge, Card, EmptyState, Loading, FileIcon, ConfirmDialog, useToast,
} from '../components/ui.jsx';
import { formatDate, formatDateTime, formatSize, relativeTime, daysUntil } from '../utils/format.js';
import VersionHistoryModal from '../components/VersionHistoryModal.jsx';
import PreviewModal from '../components/PreviewModal.jsx';
import QRModal from '../components/QRModal.jsx';
import '../styles/detail.css';

function DetailItem({ label, value }) {
  return <div className="detail-item"><small>{label}</small><strong>{value ?? '—'}</strong></div>;
}

export default function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, canApprove, canUseTrash, hasRole } = useAuth();

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('overview');
  const [busyAction, setBusyAction] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/documents/${id}`)
      .then(({ data }) => { if (!cancelled) setDocument(data.document); })
      .catch((err) => {
        if (cancelled) return;
        setError({ status: err?.response?.status, message: errorMessage(err, 'Could not load this document.') });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  if (loading) return <Loading label="Loading document…" />;

  if (error) {
    const denied = error.status === 403;
    const missing = error.status === 404;
    return (
      <div className="page-head" style={{ display: 'block' }}>
        <Link to="/documents" className="back-link"><ArrowLeft size={15} /> Back to Documents</Link>
        <EmptyState
          icon={denied ? ShieldCheck : missing ? FileText : AlertTriangle}
          title={denied ? 'Access denied' : missing ? 'Document not found' : 'Unable to load document'}
          message={denied ? 'You do not have permission to view this document.' : missing ? 'This document may have been deleted or moved.' : error.message}
          action={<>
            <Link to="/documents" className="btn btn--ghost btn--sm">Back to Documents</Link>{' '}
            {!denied && !missing && <button type="button" className="btn btn--primary btn--sm" onClick={reload}><RefreshCw size={14} /> Retry</button>}
          </>}
        />
      </div>
    );
  }

  if (!document) return <EmptyState title="Document not found" message="No document was returned for this reference." />;

  const doc = document;
  const isUploader = Boolean(user && doc.uploader?.id && String(user.id) === String(doc.uploader.id));
  const canEdit = canApprove || isUploader;
  const canArchive = canApprove || isUploader;
  const canDelete = canUseTrash || isUploader;
  const canFinalAct = hasRole('DEAN', 'SUPER_ADMIN');
  const canSubmit = ['DRAFT', 'REJECTED', 'REVISION_REQUESTED'].includes(doc.status);
  const isArchived = doc.status === 'ARCHIVED';

  const days = daysUntil(doc.expiresAt);
  let expiryChip = null;
  if (doc.expiresAt) {
    if (doc.expired || (days !== null && days < 0)) {
      expiryChip = <span className="chip chip--danger"><AlertTriangle size={13} /> Expired · {formatDate(doc.expiresAt)}</span>;
    } else if (days !== null && days <= 30) {
      expiryChip = <span className="chip chip--warn"><CalendarClock size={13} /> Expires in {days} day{days === 1 ? '' : 's'}</span>;
    } else {
      expiryChip = <span className="chip chip--ok"><CheckCircle2 size={13} /> Valid until {formatDate(doc.expiresAt)}</span>;
    }
  }

  const renewalRaw = doc.renewalStatus && typeof doc.renewalStatus === 'object'
    ? (doc.renewalStatus.label || doc.renewalStatus.name || doc.renewalStatus.status)
    : doc.renewalStatus;
  const renewal = renewalRaw
    ? String(renewalRaw).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const keywords = Array.isArray(doc.keywords)
    ? doc.keywords
    : String(doc.keywords || '').split(',').map((k) => k.trim()).filter(Boolean);

  const versions = [...(doc.versions || [])].sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));

  const downloadCurrent = async () => {
    try {
      await downloadBlob(`/documents/${doc.id}/download`, doc.latestFileName || 'document');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not download the document.'));
    }
  };

  const submitForApproval = async () => {
    setBusyAction('submit');
    try {
      await api.post(`/documents/${doc.id}/submit`);
      toast.success('Document submitted for approval.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not submit this document.'));
    } finally {
      setBusyAction('');
    }
  };

  const toggleArchive = async () => {
    const action = isArchived ? 'unarchive' : 'archive';
    setBusyAction(action);
    try {
      await api.post(`/documents/${doc.id}/${action}`);
      toast.success(isArchived ? 'Document restored from archive.' : 'Document archived.');
      setBusyAction('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err, `Could not ${action} this document.`));
      setBusyAction('');
    }
  };

  const deleteDocument = async () => {
    setBusyAction('delete');
    try {
      await api.delete(`/documents/${doc.id}`);
      toast.success('Document moved to the recycle bin.');
      setConfirmDelete(false);
      navigate('/documents');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete this document.'));
    } finally {
      setBusyAction('');
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="detail-heading">
          <Link to="/documents" className="back-link"><ArrowLeft size={15} /> Back to Documents</Link>
          <h1>{doc.title}</h1>
          <div className="detail-heading__meta">
            <span className="muted">Ref. no. <strong>{doc.referenceNumber || '—'}</strong></span>
            <StatusBadge status={doc.status} />
            {expiryChip}
            {doc.renewalStatus && <span className="chip">Renewal: {renewal}</span>}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={downloadCurrent}><Download size={15} /> Download</button>
          <button type="button" className="btn btn--ghost" onClick={() => setShowPreview(true)}><Eye size={15} /> Preview</button>
          <button type="button" className="btn btn--ghost" onClick={() => setShowVersions(true)}><History size={15} /> Version history</button>
          {doc.status === 'APPROVED' && (
            <button type="button" className="btn btn--ghost" onClick={() => setShowQr(true)}><QrCode size={15} /> QR code</button>
          )}
          {canEdit && !isArchived && (
            <button type="button" className="btn btn--ghost" onClick={() => navigate(`/documents?edit=${doc.id}`)}><Pencil size={15} /> Edit</button>
          )}
          {canEdit && canSubmit && (
            <button type="button" className="btn btn--primary" disabled={Boolean(busyAction)} onClick={submitForApproval}>
              <Send size={15} /> {busyAction === 'submit' ? 'Submitting…' : 'Submit for approval'}
            </button>
          )}
          {canArchive && (
            <button type="button" className="btn btn--ghost" disabled={Boolean(busyAction)} onClick={toggleArchive}>
              {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              {busyAction === 'archive' || busyAction === 'unarchive' ? 'Working…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
          )}
        </div>
      </div>

      {doc.status === 'FINAL_REVIEW' && (
        <div className="notice notice--purple">
          <ShieldCheck size={19} />
          <div className="notice__body">
            <strong>Final review required</strong>
            <p>Department approval is complete. A Dean must give final approval before this document becomes effective.</p>
          </div>
          {canFinalAct && <Link className="btn btn--primary btn--sm" to="/approvals"><ClipboardCheck size={14} /> Go to approvals</Link>}
        </div>
      )}

      {isArchived && (
        <div className="notice notice--amber">
          <Archive size={18} />
          <div className="notice__body">
            <strong>This document is archived</strong>
            <p>Archived documents are read-only. Restore it to continue editing or submitting for approval.</p>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Document sections">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={`tab ${tab === 'overview' ? 'tab--active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" role="tab" aria-selected={tab === 'versions'} className={`tab ${tab === 'versions' ? 'tab--active' : ''}`} onClick={() => setTab('versions')}>
          Version history <span className="tab__count">{versions.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'approvals'} className={`tab ${tab === 'approvals' ? 'tab--active' : ''}`} onClick={() => setTab('approvals')}>
          Approval history <span className="tab__count">{doc.approvals?.length || 0}</span>
        </button>
      </div>

      {tab === 'overview' && (
        <div className="grid" style={{ gap: 18 }}>
          <Card title="Document information" subtitle="Metadata and lifecycle details">
            <div className="detail-grid">
              <DetailItem label="Department" value={doc.department?.name} />
              <DetailItem label="Category" value={doc.category} />
              <DetailItem label="Document type" value={doc.documentType} />
              <DetailItem label="Uploaded by" value={doc.uploader?.name} />
              <DetailItem label="Created" value={formatDateTime(doc.createdAt)} />
              <DetailItem label="Last modified" value={formatDateTime(doc.updatedAt)} />
              <DetailItem label="Revision" value={`Rev ${doc.currentVersion?.versionNumber ?? doc.revisionCount ?? '—'}`} />
              <DetailItem label="Expires" value={formatDate(doc.expiresAt)} />
              <DetailItem label="Review date" value={formatDate(doc.reviewDate)} />
              <DetailItem label="Renewal status" value={renewal} />
            </div>
          </Card>

          <div className="grid grid--2">
            <Card title="Keywords">
              {keywords.length ? (
                <div className="keyword-list">{keywords.map((keyword, index) => <span className="keyword" key={`${keyword}-${index}`}>{keyword}</span>)}</div>
              ) : <p className="muted" style={{ margin: 0 }}>No keywords recorded.</p>}
            </Card>
            <Card title="Current file">
              <div className="detail-file">
                <span className="detail-file__icon"><FileIcon name={doc.latestFileName} size={22} /></span>
                <div className="detail-file__meta">
                  <strong title={doc.latestFileName}>{doc.latestFileName || '—'}</strong>
                  <small>
                    {formatSize(doc.latestFileSize)}
                    {doc.latestMimeType ? ` · ${doc.latestMimeType}` : ''}
                    {doc.updatedAt ? ` · updated ${relativeTime(doc.updatedAt)}` : ''}
                  </small>
                </div>
              </div>
            </Card>
          </div>

          <Card title="Description">
            {doc.description ? <p className="description-text">{doc.description}</p> : <p className="muted" style={{ margin: 0 }}>No description provided.</p>}
          </Card>
        </div>
      )}

      {tab === 'versions' && (
        <Card
          title="Version history"
          subtitle={`${versions.length} saved revision${versions.length === 1 ? '' : 's'}, newest first`}
          action={<button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowVersions(true)}><History size={14} /> Open full history</button>}
        >
          {versions.length === 0 ? (
            <EmptyState icon={History} title="No versions recorded" message="Saved revisions of this document will appear here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Rev</th><th>File</th><th>Size</th><th>Change notes</th><th>Modified by</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td><span className="chip">Rev {version.versionNumber ?? '—'}</span></td>
                      <td><div className="file-cell"><span className="file-cell__icon"><FileIcon name={version.originalName} size={16} /></span><span className="file-cell__text"><strong title={version.originalName}>{version.originalName || '—'}</strong></span></div></td>
                      <td>{formatSize(version.fileSize)}</td>
                      <td className="muted">{version.changeNotes || '—'}</td>
                      <td>{version.createdBy?.name || '—'}</td>
                      <td>{formatDateTime(version.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'approvals' && (
        <Card title="Approval history" subtitle="Submitted reviews and decisions in order">
          {doc.approvals?.length ? (
            <div className="timeline">
              {doc.approvals.map((approval) => (
                <div className="timeline__item" key={approval.id}>
                  <strong><StatusBadge status={approval.status} /></strong>
                  <p>{approval.comments || 'No comments provided.'}</p>
                  <p className="small muted">
                    Submitted by <strong>{approval.submittedBy?.name || '—'}</strong>
                    {' · '}Reviewed by <strong>{approval.reviewedBy?.name || '—'}</strong>
                  </p>
                  <time>{formatDateTime(approval.createdAt)}{approval.reviewedAt ? ` · reviewed ${relativeTime(approval.reviewedAt)}` : ''}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={ClipboardCheck} title="No approval activity yet" message="Review decisions and comments will be shown here once the document is submitted." />
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteDocument}
        busy={busyAction === 'delete'}
        danger
        title="Delete this document?"
        confirmLabel="Delete document"
        message="This moves the document to the recycle bin. It can be restored later by an authorised user."
      />

      <VersionHistoryModal
        open={showVersions}
        onClose={() => setShowVersions(false)}
        document={doc}
        onRestored={(updated) => {
          if (!updated) { reload(); return; }
          setDocument((current) => ({ ...current, ...updated, versions: updated.versions || current.versions, approvals: updated.approvals || current.approvals }));
        }}
      />
      <PreviewModal open={showPreview} onClose={() => setShowPreview(false)} document={doc} />
      <QRModal open={showQr} onClose={() => setShowQr(false)} document={doc} />
    </>
  );
}
