import { useEffect, useState } from 'react';
import { Download, ZoomIn, ZoomOut, RotateCcw, FileWarning, RefreshCw } from 'lucide-react';
import api, { errorMessage, downloadBlob } from '../api/client.js';
import { Modal, Loading, EmptyState, FileIcon, useToast } from './ui.jsx';

/** Lightweight, dependency-free defence-in-depth for HTML from the preview endpoint. */
function sanitizeHtml(html) {
  return String(html || '')
    // Strip <script ...>...</script> blocks (including any attributes), case-insensitively.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    // Strip event-handler attributes: onclick=, ONMOUSEOVER=, onfocus=, etc.
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralise javascript: URLs, case-insensitively (JaVaScRiPt: etc.).
    .replace(/javascript:/gi, '');
}

export default function PreviewModal({ open, onClose, document, versionId }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: false, error: '', preview: null });
  const [blobUrl, setBlobUrl] = useState('');
  const [zoom, setZoom] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);

  const docId = document?.id;
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  const previewUrl = `/documents/${docId}/preview${query}`;
  const downloadUrl = `/documents/${docId}/download${query}`;

  const version = (document?.versions || []).find((v) => String(v.id) === String(versionId));
  const fileName = version?.originalName || document?.latestFileName || 'Document';
  const revision = version?.versionNumber ?? document?.currentVersion?.versionNumber;

  useEffect(() => {
    if (!open || !docId) return undefined;
    let cancelled = false;
    let createdUrl = '';
    setState({ loading: true, error: '', preview: null });
    setBlobUrl('');
    setZoom(100);

    (async () => {
      try {
        const response = await api.get(previewUrl, { responseType: 'blob' });
        if (cancelled) return;
        const contentType = String(response.headers?.['content-type'] || '').toLowerCase();

        if (contentType.includes('json') || contentType.includes('+json')) {
          const payload = typeof response.data === 'string'
            ? JSON.parse(response.data)
            : JSON.parse(await response.data.text());
          if (!cancelled) setState({ loading: false, error: '', preview: { type: 'json', ...payload } });
          return;
        }

        if (contentType.startsWith('application/pdf') || contentType.startsWith('image/')) {
          createdUrl = URL.createObjectURL(new Blob([response.data], { type: contentType }));
          if (cancelled) {
            URL.revokeObjectURL(createdUrl);
            return;
          }
          setBlobUrl(createdUrl);
          setState({
            loading: false,
            error: '',
            preview: { type: contentType.startsWith('image/') ? 'image' : 'pdf', contentType },
          });
          return;
        }

        // Some servers label office/text previews as octet-stream: try JSON, then fall back.
        const text = typeof response.data === 'string' ? response.data : await response.data.text();
        try {
          const payload = JSON.parse(text);
          if (!cancelled) setState({ loading: false, error: '', preview: { type: 'json', ...payload } });
        } catch {
          if (!cancelled) setState({ loading: false, error: '', preview: { type: 'unsupported', message: text.slice(0, 200) } });
        }
      } catch (err) {
        if (cancelled) return;
        const message = errorMessage(err, 'Unable to load the preview.');
        setState({ loading: false, error: message, preview: null });
        toast.error(message);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // `toast` is a stable memoised object; keep it out of the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId, previewUrl, reloadKey]);

  const handleDownload = async () => {
    try {
      await downloadBlob(downloadUrl, fileName);
    } catch (err) {
      toast.error(errorMessage(err, 'Download failed.'));
    }
  };

  let body;
  if (state.loading) {
    body = <Loading label="Preparing preview…" />;
  } else if (state.error) {
    body = (
      <EmptyState
        icon={FileWarning}
        title="Preview unavailable"
        message={state.error}
        action={<button type="button" className="btn btn--ghost btn--sm" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw size={14} /> Retry</button>}
      />
    );
  } else if (state.preview?.type === 'pdf') {
    body = (
      <div className="preview-scroll">
        <div style={{ width: `${zoom}%`, margin: '0 auto' }}>
          <iframe className="preview-frame" src={blobUrl} title={`Preview of ${fileName}`} />
        </div>
      </div>
    );
  } else if (state.preview?.type === 'image') {
    body = (
      <div className="preview-scroll">
        <div style={{ width: `${zoom}%`, margin: '0 auto' }}>
          <img className="preview-image" src={blobUrl} alt={fileName} />
        </div>
      </div>
    );
  } else if (state.preview?.type === 'json') {
    if (state.preview.kind === 'office' || state.preview.kind === 'text') {
      body = (
        <div className="preview-scroll">
          <div className="preview-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(state.preview.html) }} />
        </div>
      );
    } else {
      body = (
        <EmptyState
          icon={FileWarning}
          title="Preview not available"
          message={state.preview.message || 'This file format cannot be displayed in the browser. Download the file to view its contents.'}
          action={<button type="button" className="btn btn--primary btn--sm" onClick={handleDownload}><Download size={14} /> Download file</button>}
        />
      );
    }
  } else {
    body = (
      <EmptyState
        icon={FileWarning}
        title="Nothing to preview"
        message="The preview service returned no content for this file."
        action={<button type="button" className="btn btn--primary btn--sm" onClick={handleDownload}><Download size={14} /> Download file</button>}
      />
    );
  }

  const zoomable = state.preview?.type === 'pdf' || state.preview?.type === 'image';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Document preview"
      subtitle={`Rev ${revision ?? '—'} · ${fileName}`}
      footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}
    >
      <div className="preview-stage">
        <div className="preview-toolbar">
          <FileIcon name={fileName} size={17} />
          <strong>{fileName} <span className="muted" style={{ fontWeight: 500 }}>· Rev {revision ?? '—'}</span></strong>
          {zoomable && (
            <div className="preview-zoom">
              <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.max(50, z - 25))} aria-label="Zoom out"><ZoomOut size={15} /></button>
              <button type="button" className="link-btn" onClick={() => setZoom(100)} style={{ minWidth: 46, justifyContent: 'center' }}>{zoom}%</button>
              <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.min(250, z + 25))} aria-label="Zoom in"><ZoomIn size={15} /></button>
              <button type="button" className="icon-btn" onClick={() => setZoom(100)} aria-label="Reset zoom"><RotateCcw size={14} /></button>
            </div>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleDownload}><Download size={14} /> Download</button>
        </div>
        {body}
      </div>
    </Modal>
  );
}
