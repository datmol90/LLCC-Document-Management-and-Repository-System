import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, X, Info, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

/* ------------------------------- Toast ---------------------------------- */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);
  const api = useMemo(() => ({
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
    info: (message) => push(message, 'info'),
  }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            {toast.tone === 'success' ? <CheckCircle2 size={18} /> : toast.tone === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToasts((c) => c.filter((t) => t.id !== toast.id))} aria-label="Dismiss"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* ------------------------------- Badges --------------------------------- */
const STATUS_LABELS = {
  APPROVED: 'Approved',
  PENDING: 'Pending',
  FINAL_REVIEW: 'Final review',
  DRAFT: 'Draft',
  REJECTED: 'Rejected',
  REVISION_REQUESTED: 'Revision requested',
  ARCHIVED: 'Archived',
};

export function StatusBadge({ status }) {
  const key = String(status || 'DRAFT').toLowerCase();
  return <span className={`badge badge--${key}`}>{STATUS_LABELS[status] || status}</span>;
}

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  DEAN: 'Dean',
  DEPARTMENT_HEAD: 'Dept Head',
  STAFF: 'Staff',
};

export function RoleBadge({ role }) {
  return <span className={`role-badge role-badge--${String(role || '').toLowerCase()}`}>{ROLE_LABELS[role] || role}</span>;
}

/* -------------------------------- Modal --------------------------------- */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false, requiresText, busy }) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  const allowed = !requiresText || text === requiresText;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={!allowed || busy} onClick={() => onConfirm()}>
          {busy && <Loader2 size={16} className="spin" />}{confirmLabel}
        </button>
      </>}>
      <p className="muted">{message}</p>
      {requiresText && (
        <div className="field" style={{ marginTop: 16 }}>
          <label>Type <strong>{requiresText}</strong> to confirm</label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={requiresText} />
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Data pieces ------------------------------ */
export function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon = FileText, title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon size={26} /></div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><Loader2 className="spin" size={22} /><span>{label}</span></div>;
}

export function Pagination({ page, pages, total, limit, onChange }) {
  if (!pages || pages <= 1) return <div className="pagination-note">{total ? `${total} record${total === 1 ? '' : 's'}` : ''}</div>;
  return (
    <div className="pagination">
      <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <div className="pagination__buttons">
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous"><ChevronLeft size={17} /></button>
        <span>Page {page} of {pages}</span>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next"><ChevronRight size={17} /></button>
      </div>
    </div>
  );
}

export function FileIcon({ name, size = 18 }) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  const props = { size, 'aria-hidden': true };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return <ImageIcon {...props} />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet {...props} />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation {...props} />;
  return <FileText {...props} />;
}

export function ProgressBar({ value, max = 100, tone = 'primary' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="progress"><div className={`progress__fill progress__fill--${tone}`} style={{ width: `${pct}%` }} /></div>;
}
