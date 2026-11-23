import { useState } from 'react';
import { Download, Eye, RotateCcw, History } from 'lucide-react';
import api, { errorMessage, downloadBlob } from '../api/client.js';
import { Modal, ConfirmDialog, EmptyState, FileIcon, useToast } from './ui.jsx';
import { formatDateTime, formatSize } from '../utils/format.js';
import PreviewModal from './PreviewModal.jsx';

export default function VersionHistoryModal({ open, onClose, document, onRestored }) {
  const toast = useToast();
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const versions = [...(document?.versions || [])].sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));

  const downloadVersion = async (version) => {
    try {
      await downloadBlob(`/documents/${document.id}/download?versionId=${encodeURIComponent(version.id)}`, version.originalName || 'document');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not download this version.'));
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/documents/${document.id}/versions/${restoreTarget.id}/restore`);
      const updated = data?.document;
      toast.success(`Restored as revision ${updated?.currentVersion?.versionNumber ?? 'a new version'}.`);
      setRestoreTarget(null);
      onRestored?.(updated);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not restore this version.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title="Version history"
        subtitle={document?.title ? `${document.title} · ${versions.length} version${versions.length === 1 ? '' : 's'}` : undefined}
        footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}
      >
        {versions.length === 0 ? (
          <EmptyState icon={History} title="No versions recorded" message="Saved revisions of this document will appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table version-table">
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Change notes</th>
                  <th>Modified by</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td><span className="chip">Rev {version.versionNumber ?? '—'}</span></td>
                    <td>
                      <div className="file-cell">
                        <span className="file-cell__icon"><FileIcon name={version.originalName} size={17} /></span>
                        <span className="file-cell__text"><strong title={version.originalName}>{version.originalName || '—'}</strong></span>
                      </div>
                    </td>
                    <td>{formatSize(version.fileSize)}</td>
                    <td className="muted">{version.changeNotes || '—'}</td>
                    <td>{version.createdBy?.name || '—'}</td>
                    <td title={formatDateTime(version.createdAt)}>{formatDateTime(version.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="Download" aria-label="Download version" onClick={() => downloadVersion(version)}><Download size={15} /></button>
                        <button type="button" className="icon-btn" title="Preview" aria-label="Preview version" onClick={() => setPreviewTarget(version)}><Eye size={15} /></button>
                        <button type="button" className="icon-btn" title="Restore" aria-label="Restore version" onClick={() => setRestoreTarget(version)}><RotateCcw size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <PreviewModal
        open={Boolean(previewTarget)}
        onClose={() => setPreviewTarget(null)}
        document={document}
        versionId={previewTarget?.id}
      />

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={confirmRestore}
        busy={busy}
        title="Restore this version?"
        confirmLabel="Restore version"
        message={`Restoring Rev ${restoreTarget?.versionNumber ?? '—'} does not overwrite history. The server creates a new revision with this version's contents, keeping every previous version available.`}
      />
    </>
  );
}
