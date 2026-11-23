import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, Archive, ArchiveRestore, Download, Eye, FileSearch, FolderOpen,
  Pencil, RefreshCw, Trash2, Upload, X,
} from 'lucide-react';
import api, { downloadBlob, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, ConfirmDialog, EmptyState, FileIcon, Loading, Pagination, StatusBadge, useToast } from '../components/ui.jsx';
import { formatDate, formatSize, queryString } from '../utils/format.js';
import DocumentFormModal from '../components/DocumentFormModal.jsx';
import '../styles/documents.css';

const DEFAULT_FILTERS = {
  q: '',
  departmentId: '',
  categoryId: '',
  status: 'ALL',
  fileType: 'ALL',
  from: '',
  to: '',
  modifiedFrom: '',
  modifiedTo: '',
  expiring: 'ALL',
};

const STATUSES = ['DRAFT', 'PENDING', 'FINAL_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'ARCHIVED'];
const STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  FINAL_REVIEW: 'Final review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUESTED: 'Revision requested',
  ARCHIVED: 'Archived',
};
const FILE_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'];
const EXPIRING_OPTIONS = [
  { value: 'ALL', label: 'All dates' },
  { value: 'soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
];

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.departments)) return value.departments;
  if (Array.isArray(value?.categories)) return value.categories;
  return [];
}

export default function Documents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { user } = useAuth();

  const initialEditId = useRef(searchParams.get('edit')).current;
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    q: searchParams.get('q') || '',
  }));
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const [page, setPage] = useState(1);
  const [documents, setDocuments] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modalOpen, setModalOpen] = useState(() => searchParams.get('new') === '1' && !searchParams.get('edit'));
  const [editingDoc, setEditingDoc] = useState(null);
  const [deepLinkEdit, setDeepLinkEdit] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(filters.q.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/departments'), api.get('/categories')])
      .then(([departmentsRes, categoriesRes]) => {
        if (cancelled) return;
        setDepartments(asList(departmentsRes.data));
        setCategories(asList(categoriesRes.data));
      })
      .catch(() => { /* catalogs are non-critical for filtering */ });
    return () => { cancelled = true; };
  }, []);

  // Deep link from DocumentDetail: /documents?edit=<id>
  useEffect(() => {
    if (!initialEditId) return undefined;
    let cancelled = false;
    api.get(`/documents/${initialEditId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setEditingDoc(data?.document || null);
        setDeepLinkEdit(true);
        setModalOpen(true);
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err, 'Could not open that document.'));
      });
    return () => { cancelled = true; };
  }, [initialEditId, toast]);

  const {
    departmentId, categoryId, status, fileType, from, to, modifiedFrom, modifiedTo, expiring,
  } = filters;

  useEffect(() => {
    let cancelled = false;
    const params = queryString({
      q: debouncedQ,
      departmentId,
      categoryId,
      status: status === 'ALL' ? '' : status,
      fileType: fileType === 'ALL' ? '' : fileType,
      from,
      to,
      modifiedFrom,
      modifiedTo,
      expiring: expiring === 'ALL' ? '' : expiring,
      page,
      limit: 10,
    });
    setLoading(true);
    setError('');
    api.get(`/documents${params}`)
      .then(({ data }) => {
        if (cancelled) return;
        setDocuments(Array.isArray(data?.documents) ? data.documents : []);
        setMeta({
          total: data?.total ?? 0,
          page: data?.page ?? page,
          pages: data?.pages ?? 1,
          limit: data?.limit ?? 10,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setDocuments([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ, departmentId, categoryId, status, fileType, from, to, modifiedFrom, modifiedTo, expiring, page, refreshKey]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setDebouncedQ('');
    setPage(1);
    setSearchParams({}, { replace: true });
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.q.trim()) chips.push({ key: 'q', label: `Search: ${filters.q.trim()}` });
    if (departmentId) {
      const name = departments.find((item) => String(item.id) === String(departmentId))?.name;
      chips.push({ key: 'departmentId', label: `Department: ${name || 'Selected'}` });
    }
    if (categoryId) {
      const name = categories.find((item) => String(item.id) === String(categoryId))?.name;
      chips.push({ key: 'categoryId', label: `Category: ${name || 'Selected'}` });
    }
    if (status !== 'ALL') chips.push({ key: 'status', label: STATUS_LABELS[status] || status });
    if (fileType !== 'ALL') chips.push({ key: 'fileType', label: fileType.toUpperCase() });
    if (from || to) chips.push({ key: 'uploadDate', label: `Uploaded: ${from || '…'} – ${to || '…'}` });
    if (modifiedFrom || modifiedTo) chips.push({ key: 'modifiedDate', label: `Modified: ${modifiedFrom || '…'} – ${modifiedTo || '…'}` });
    if (expiring !== 'ALL') {
      chips.push({ key: 'expiring', label: EXPIRING_OPTIONS.find((option) => option.value === expiring)?.label || expiring });
    }
    return chips;
  }, [filters.q, departmentId, categoryId, status, fileType, from, to, modifiedFrom, modifiedTo, expiring, departments, categories]);

  const clearChip = (key) => {
    if (key === 'uploadDate') setFilters((current) => ({ ...current, from: '', to: '' }));
    else if (key === 'modifiedDate') setFilters((current) => ({ ...current, modifiedFrom: '', modifiedTo: '' }));
    else if (key === 'q') {
      setFilters((current) => ({ ...current, q: '' }));
      setSearchParams({}, { replace: true });
    } else {
      const reset = ['status', 'fileType', 'expiring'].includes(key) ? 'ALL' : '';
      setFilters((current) => ({ ...current, [key]: reset }));
    }
    setPage(1);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingDoc(null);
    if (deepLinkEdit) {
      setDeepLinkEdit(false);
      navigate('/documents', { replace: true });
    }
  };

  const openCreate = () => {
    if (!user) return;
    setEditingDoc(null);
    setDeepLinkEdit(false);
    setModalOpen(true);
  };

  const openEdit = (doc) => {
    setEditingDoc(doc);
    setDeepLinkEdit(false);
    setModalOpen(true);
  };

  const handleSaved = () => setRefreshKey((key) => key + 1);

  const handleDownload = async (doc) => {
    setDownloadingId(doc.id);
    try {
      await downloadBlob(`/documents/${doc.id}/download`, doc.latestFileName || 'document');
    } catch (err) {
      toast.error(errorMessage(err, 'Download failed.'));
    } finally {
      setDownloadingId(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === 'delete') {
        await api.delete(`/documents/${confirm.doc.id}`);
        toast.success('Document moved to the recycle bin.');
      } else if (confirm.type === 'archive') {
        await api.post(`/documents/${confirm.doc.id}/archive`);
        toast.success('Document archived.');
      } else {
        await api.post(`/documents/${confirm.doc.id}/unarchive`);
        toast.success('Document unarchived.');
      }
      setConfirm(null);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = confirm
    ? ({
      delete: {
        title: 'Delete document?',
        message: `“${confirm.doc.title}” will be moved to the recycle bin. You can restore it later.`,
        confirmLabel: 'Delete',
        danger: true,
      },
      archive: {
        title: 'Archive document?',
        message: `“${confirm.doc.title}” will be marked as archived and hidden from active documents.`,
        confirmLabel: 'Archive',
        danger: false,
      },
      unarchive: {
        title: 'Unarchive document?',
        message: `“${confirm.doc.title}” will be restored to the active document list.`,
        confirmLabel: 'Unarchive',
        danger: false,
      },
    }[confirm.type])
    : { title: 'Are you sure?', message: '', confirmLabel: 'Confirm', danger: false };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p>Browse, manage and track every document in the LLCC repository.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={openCreate}>
            <Upload size={16} /> Upload document
          </button>
        </div>
      </div>

      <Card className="docs-card">
        <div className="filters">
          <div className="field field--search">
            <label htmlFor="doc-search">Search</label>
            <input
              id="doc-search"
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Title, description, reference or keywords…"
            />
          </div>
          <div className="field">
            <label htmlFor="filter-department">Department</label>
            <select id="filter-department" value={departmentId} onChange={(event) => updateFilter('departmentId', event.target.value)}>
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-category">Category</label>
            <select id="filter-category" value={categoryId} onChange={(event) => updateFilter('categoryId', event.target.value)}>
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-status">Status</label>
            <select id="filter-status" value={status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="ALL">All statuses</option>
              {STATUSES.map((option) => <option key={option} value={option}>{STATUS_LABELS[option]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-filetype">File type</label>
            <select id="filter-filetype" value={fileType} onChange={(event) => updateFilter('fileType', event.target.value)}>
              <option value="ALL">All file types</option>
              {FILE_TYPES.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-from">Uploaded from</label>
            <input id="filter-from" type="date" value={from} onChange={(event) => updateFilter('from', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="filter-to">Uploaded to</label>
            <input id="filter-to" type="date" value={to} onChange={(event) => updateFilter('to', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="filter-modified-from">Modified from</label>
            <input id="filter-modified-from" type="date" value={modifiedFrom} onChange={(event) => updateFilter('modifiedFrom', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="filter-modified-to">Modified to</label>
            <input id="filter-modified-to" type="date" value={modifiedTo} onChange={(event) => updateFilter('modifiedTo', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="filter-expiring">Expiring</label>
            <select id="filter-expiring" value={expiring} onChange={(event) => updateFilter('expiring', event.target.value)}>
              {EXPIRING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn--ghost" onClick={clearFilters}>
            <X size={15} /> Clear filters
          </button>
        </div>

        {(activeChips.length > 0 || (!loading && !error)) && (
          <div className="docs-summary">
            <span className="docs-count">
              <strong>{meta.total}</strong> document{meta.total === 1 ? '' : 's'} found
            </span>
            {activeChips.length > 0 && (
              <div className="docs-chips">
                {activeChips.map((chip) => (
                  <button type="button" className="chip" key={chip.key} onClick={() => clearChip(chip.key)} title={`Remove ${chip.label} filter`}>
                    {chip.label} <X size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <Loading label="Loading documents…" />
        ) : error ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load documents"
            message={error}
            action={<button type="button" className="btn btn--ghost" onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>}
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={activeChips.length ? 'No matching documents' : 'No documents yet'}
            message={activeChips.length ? 'Try adjusting or clearing your filters.' : 'Upload your first document to start building the institutional repository.'}
            action={<div className="docs-empty-actions">
              {activeChips.length > 0 && <button type="button" className="btn btn--ghost" onClick={clearFilters}>Clear filters</button>}
              <button type="button" className="btn btn--primary" onClick={openCreate}><Upload size={16} /> Upload document</button>
            </div>}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--documents">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Reference</th>
                    <th>Department</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Revision</th>
                    <th>Uploaded by</th>
                    <th>Updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <div className="file-cell">
                          <span className="file-cell__icon"><FileIcon name={doc.latestFileName} size={17} /></span>
                          <div className="file-cell__text">
                            <button type="button" className="doc-title" onClick={() => navigate(`/documents/${doc.id}`)}>
                              {doc.title || 'Untitled document'}
                            </button>
                            <small>
                              {doc.latestFileName || 'No file attached'}
                              {doc.latestFileSize !== undefined && doc.latestFileSize !== null && ` · ${formatSize(doc.latestFileSize)}`}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td><span className="doc-ref">{doc.referenceNumber || '—'}</span></td>
                      <td>{doc.department?.name || '—'}</td>
                      <td>{doc.category || '—'}</td>
                      <td>
                        <div className="status-cell">
                          <StatusBadge status={doc.status} />
                          {doc.expired && <span className="chip chip--danger" title="This document has expired">Expired</span>}
                          {doc.expiringSoon && !doc.expired && <span className="chip chip--warn" title="This document is expiring soon">Expiring soon</span>}
                        </div>
                      </td>
                      <td><span className="chip">v{doc.revisionCount || 1}</span></td>
                      <td><span className="cell-sub">{doc.uploader?.name || '—'}</span></td>
                      <td><span className="cell-sub">{formatDate(doc.updatedAt)}</span></td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="View" onClick={() => navigate(`/documents/${doc.id}`)}><Eye size={16} /></button>
                          <button type="button" className="icon-btn" title="Preview" onClick={() => navigate(`/documents/${doc.id}?preview=1`)}><FileSearch size={16} /></button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Download"
                            disabled={downloadingId === doc.id}
                            onClick={() => handleDownload(doc)}
                          >
                            <Download size={16} />
                          </button>
                          <button type="button" className="icon-btn" title="Edit" onClick={() => openEdit(doc)}><Pencil size={16} /></button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={doc.status === 'ARCHIVED' ? 'Unarchive' : 'Archive'}
                            onClick={() => setConfirm({ type: doc.status === 'ARCHIVED' ? 'unarchive' : 'archive', doc })}
                          >
                            {doc.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                          </button>
                          <button type="button" className="icon-btn" title="Delete" onClick={() => setConfirm({ type: 'delete', doc })}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={meta.page}
              pages={meta.pages}
              total={meta.total}
              limit={meta.limit}
              onChange={(nextPage) => {
                setPage(nextPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </>
        )}
      </Card>

      <DocumentFormModal
        open={modalOpen}
        onClose={closeModal}
        document={editingDoc}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.confirmLabel}
        danger={confirmCopy.danger}
        busy={busy}
      />
    </>
  );
}
