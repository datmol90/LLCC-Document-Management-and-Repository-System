import { useEffect, useState } from 'react';
import { Copy, Download, Printer, QrCode, ShieldCheck, ExternalLink, RefreshCw } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { Modal, Loading, EmptyState, useToast } from './ui.jsx';

export default function QRModal({ open, onClose, document }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qr, setQr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const docId = document?.id;

  useEffect(() => {
    if (!open || !docId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setQr(null);

    api.get(`/documents/${docId}/qr`)
      .then(({ data }) => { if (!cancelled) setQr(data); })
      .catch((err) => {
        if (cancelled) return;
        const message = errorMessage(err, 'Could not load the verification code.');
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId, reloadKey]);

  const code = qr?.code || document?.verificationCode || '';
  const verificationUrl = qr?.url || (code ? `${window.location.origin}/verify/${code}` : '');

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Verification code copied.');
    } catch {
      toast.error('Could not copy the code. Select it and copy manually.');
    }
  };

  const openVerificationPage = () => {
    if (!code) return;
    window.open(`/verify/${code}`, '_blank', 'noopener,noreferrer');
  };

  let body;
  if (loading) {
    body = <Loading label="Generating verification code…" />;
  } else if (error || !qr?.qr) {
    body = (
      <EmptyState
        icon={QrCode}
        title="QR code unavailable"
        message={error || 'No verification code was returned for this document.'}
        action={<button type="button" className="btn btn--ghost btn--sm" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw size={14} /> Retry</button>}
      />
    );
  } else {
    body = (
      <div className="qr-layout">
        <div className="qr-card">
          <img src={qr.qr} alt={`Verification QR code for ${document?.title || 'document'}`} className="qr-image" />
          <p className="qr-code">{code}</p>
          <a className="btn btn--ghost btn--sm" href={qr.qr} download={`${code || 'document'}-qr.png`}>
            <Download size={14} /> Download QR
          </a>
        </div>
        <div className="qr-info">
          <h4>Verify this document</h4>
          <p className="muted">Anyone with this code can confirm the document's authenticity on the public verification page.</p>
          <div className="field">
            <label>Verification code</label>
            <div className="qr-copy">
              <input readOnly value={code} onFocus={(e) => e.target.select()} aria-label="Verification code" />
              <button type="button" className="btn btn--ghost btn--sm" onClick={copyCode}><Copy size={14} /> Copy</button>
            </div>
          </div>
          <div className="field">
            <label>Verification URL</label>
            <a className="qr-url" href={verificationUrl} target="_blank" rel="noopener noreferrer">
              {verificationUrl} <ExternalLink size={13} />
            </a>
          </div>
          <button type="button" className="btn btn--primary btn--block" onClick={openVerificationPage}>
            <Printer size={15} /> Print verification page
          </button>
          <p className="small muted qr-note">The verification page has its own print button. The QR code exposes only a verification token — never the private document file.</p>
          <div className="qr-privacy"><ShieldCheck size={16} /> <span>Shares no file contents or personal data.</span></div>
        </div>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Verification QR code"
      subtitle={document?.title}
      footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}
    >
      {body}
    </Modal>
  );
}
