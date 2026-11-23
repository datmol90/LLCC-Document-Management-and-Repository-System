import { useEffect, useState } from 'react';
import { AlertCircle, FileUp, Loader2 } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { Modal, useToast } from './ui.jsx';
import { formatSize } from '../utils/format.js';

const DOCUMENT_TYPES = ['Policy', 'Handbook', 'Form', 'Memo', 'Report', 'Financial', 'Academic', 'HR', 'Enrollment', 'Other'];
const RENEWAL_STATUSES = ['NONE', 'PENDING', 'RENEWED', 'EXPIRED', 'UNDER_REVIEW'];
const OTHER = '__other__';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_FILES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png';
const COLLEGE_NAMES = ['College of Education', 'College of Technology', 'College of Hospitality and Tourism Management'];

const EMPTY_FORM = {
  title: '',
  description: '',
  departmentId: '',
  categoryOption: '',
  categoryText: '',
  documentType: '',
  documentTypeText: '',
  referenceNumber: '',
  keywords: '',
  expiresAt: '',
  reviewDate: '',
  renewalStatus: 'NONE',
  status: 'DRAFT',
  requiresFinalApproval: false,
  changeNotes: '',
};

function toDateInput(value) {
  if (!value) return '';
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.departments)) return value.departments;
  return [];
}

export default function DocumentFormModal({ open, onClose, document, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(document?.id);

  const [form, setForm] = useState(EMPTY_FORM);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    Promise.all([api.get('/departments'), api.get('/categories')])
      .then(([departmentsRes, categoriesRes]) => {
        if (cancelled) return;
        setDepartments(asList(departmentsRes.data));
        setCategories(Array.isArray(categoriesRes.data?.categories) ? categoriesRes.data.categories : Array.isArray(categoriesRes.data) ? categoriesRes.data : []);
      })
      .catch(() => { /* catalogs are non-critical – the form still works */ });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError('');
    setFile(null);

    if (!document?.id) {
      setForm({ ...EMPTY_FORM, status: 'DRAFT' });
      return;
    }

    const matchedCategory = categories.find((category) => (
      String(category.id) === String(document.categoryId)
      || (document.category && category.name === document.category)
    ));
    const knownType = DOCUMENT_TYPES.includes(document.documentType);

    setForm({
      title: document.title || '',
      description: document.description || '',
      departmentId: document.departmentId ? String(document.departmentId) : '',
      categoryOption: matchedCategory ? String(matchedCategory.id) : (document.category || document.categoryId ? OTHER : ''),
      categoryText: matchedCategory ? '' : (document.category || ''),
      documentType: knownType ? document.documentType : (document.documentType ? OTHER : ''),
      documentTypeText: knownType ? '' : (document.documentType || ''),
      referenceNumber: document.referenceNumber || '',
      keywords: Array.isArray(document.keywords)
        ? document.keywords.join(', ')
        : (typeof document.keywords === 'string' ? document.keywords : ''),
      expiresAt: toDateInput(document.expiresAt),
      reviewDate: toDateInput(document.reviewDate),
      renewalStatus: RENEWAL_STATUSES.includes(document.renewalStatus) ? document.renewalStatus : 'NONE',
      status: '',
      requiresFinalApproval: Boolean(document.requiresFinalApproval),
      changeNotes: '',
    });
  }, [open, document, categories]);

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: '' }));
  };

  const validate = () => {
    const next = {};
    if (!form.title.trim()) next.title = 'Title is required.';
    if (!form.departmentId) next.department = 'Department is required.';
    if (!isEdit && !file) next.file = 'Choose a file to upload.';
    if (file && file.size > MAX_FILE_BYTES) next.file = 'File must be 20 MB or smaller.';
    if (form.categoryOption === OTHER && !form.categoryText.trim()) next.category = 'Enter a category name.';
    if (form.documentType === OTHER && !form.documentTypeText.trim()) next.documentType = 'Enter a document type.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildPayload = () => {
    const payload = new FormData();
    const append = (key, value) => {
      if (value === undefined || value === null) return;
      const text = String(value);
      if (text.trim() !== '') payload.append(key, text);
    };

    append('title', form.title.trim());
    append('description', form.description.trim());
    append('departmentId', form.departmentId);

    if (form.categoryOption === OTHER) {
      append('category', form.categoryText.trim());
    } else if (form.categoryOption) {
      const category = categories.find((item) => String(item.id) === String(form.categoryOption));
      append('categoryId', form.categoryOption);
      if (category?.name) append('category', category.name);
    }

    append('documentType', form.documentType === OTHER ? form.documentTypeText.trim() : form.documentType);
    append('referenceNumber', form.referenceNumber.trim());
    append('keywords', form.keywords.trim());
    append('expiresAt', form.expiresAt);
    append('reviewDate', form.reviewDate);
    append('renewalStatus', form.renewalStatus);
    append('status', form.status);
    payload.append('requiresFinalApproval', form.requiresFinalApproval ? 'true' : 'false');

    if (isEdit && form.changeNotes.trim()) append('changeNotes', form.changeNotes.trim());
    if (file) payload.append('file', file);

    return payload;
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (saving || !validate()) return;

    setSaving(true);
    setSubmitError('');
    try {
      const payload = buildPayload();
      const { data } = isEdit
        ? await api.put(`/documents/${document.id}`, payload)
        : await api.post('/documents', payload);
      toast.success(isEdit ? 'Document updated successfully.' : 'Document uploaded successfully.');
      onSaved?.(data?.document);
      onClose?.();
    } catch (err) {
      const message = errorMessage(err);
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const close = () => { if (!saving) onClose?.(); };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={isEdit ? 'Edit document' : 'Upload document'}
      subtitle={isEdit ? 'Update metadata or upload a new version.' : 'Add a new document to the institutional repository.'}
      footer={<>
        <button type="button" className="btn btn--ghost" onClick={close} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
          {saving && <Loader2 size={16} className="spin" />}
          {isEdit ? 'Save changes' : 'Upload document'}
        </button>
      </>}
    >
      <form id="document-form" onSubmit={handleSubmit}>
        {submitError && (
          <div className="form-error" role="alert">
            <AlertCircle size={16} />
            <span>{submitError}</span>
          </div>
        )}

        <section className="form-section">
          <h4>Document details</h4>
          <div className="field">
            <label htmlFor="doc-title">Title *</label>
            <input id="doc-title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="e.g. Student Handbook 2026" />
            {errors.title && <small className="field-error">{errors.title}</small>}
          </div>
          <div className="field">
            <label htmlFor="doc-description">Description</label>
            <textarea id="doc-description" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Short summary of the document…" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="doc-department">Department *</label>
              <select id="doc-department" value={form.departmentId} onChange={(e) => setField('departmentId', e.target.value)}>
                <option value="">Select college</option>
                {departments.map((department) => {
                  if (COLLEGE_NAMES.includes(department.name)) {
                    return <option key={department.id} value={department.id}>{department.name}</option>;
                  }
                  return null;
                })}
              </select>
              {errors.department && <small className="field-error">{errors.department}</small>}
            </div>
            <div className="field">
              <label htmlFor="doc-category">Category</label>
              <select id="doc-category" value={form.categoryOption} onChange={(e) => setField('categoryOption', e.target.value)}>
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
                <option value={OTHER}>Other</option>
              </select>
              {form.categoryOption === OTHER && <input value={form.categoryText} onChange={(e) => setField('categoryText', e.target.value)} placeholder="Enter category name" style={{ marginTop: 6 }} />}
              {errors.category && <small className="field-error">{errors.category}</small>}
            </div>
          </div>
        </section>

        <section className="form-section">
          <h4>Dates & review</h4>
          <div className="field-row">
            <div className="field">
              <label htmlFor="doc-expires">Expiry date</label>
              <input id="doc-expires" type="date" value={form.expiresAt} onChange={(e) => setField('expiresAt', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="doc-review">Review date</label>
              <input id="doc-review" type="date" value={form.reviewDate} onChange={(e) => setField('reviewDate', e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="doc-renewal">Renewal status</label>
              <select id="doc-renewal" value={form.renewalStatus} onChange={(e) => setField('renewalStatus', e.target.value)}>
                {RENEWAL_STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc-status">Status</label>
              <select id="doc-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {!isEdit && <option value="DRAFT">Draft</option>}
                {!isEdit && <option value="PENDING">Pending</option>}
                {isEdit && <option value="">Keep current status</option>}
                {isEdit && <option value="DRAFT">Draft</option>}
                {isEdit && <option value="ARCHIVED">Archived</option>}
              </select>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h4>File</h4>
          <div className="field">
            <label htmlFor="doc-file">{isEdit ? 'Replace file (optional)' : 'File *'}</label>
            <input
              id="doc-file"
              type="file"
              accept={ACCEPTED_FILES}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                if (errors.file) setErrors((current) => ({ ...current, file: '' }));
              }}
            />
            <small className="file-hint">PDF, Word, Excel, PowerPoint or images · Maximum 20 MB.</small>
            {errors.file && <small className="field-error">{errors.file}</small>}
            {file && (
              <small className="file-hint"><FileUp size={13} /> {file.name} · {formatSize(file.size)}</small>
            )}
            {isEdit && !file && document?.latestFileName && (
              <small className="file-hint">Current file: {document.latestFileName} · {formatSize(document.latestFileSize)}</small>
            )}
          </div>
          {isEdit && (
            <div className="field">
              <label htmlFor="doc-change-notes">Change notes</label>
              <textarea
                id="doc-change-notes"
                value={form.changeNotes}
                onChange={(e) => setField('changeNotes', e.target.value)}
                placeholder="Describe what changed in this version…"
              />
              <small className="file-hint">Included in the new version history when a file is attached.</small>
            </div>
          )}
        </section>
      </form>
    </Modal>
  );
}