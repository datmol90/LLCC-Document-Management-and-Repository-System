import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notifications.js';
import { canAccessDepartment, canViewDocument, canModifyDocument, canDeleteDocument, canRestoreDocument, canApprove } from '../utils/permissions.js';

/** Accepts 'YYYY-MM-DD' or ISO string; '' / null / undefined => null. Returns false when invalid. */
function parseExpiry(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d;
}

function docInclude() {
  return {
    department: true,
    documentCategory: { select: { id: true, name: true } },
    uploader: { select: { id: true, name: true, email: true, role: true } },
    currentVersion: { include: { createdBy: { select: { id: true, name: true, email: true } } } },
    versions: { orderBy: { versionNumber: 'desc' }, include: { createdBy: { select: { id: true, name: true, email: true } } } },
    approvals: { orderBy: { createdAt: 'desc' }, include: { reviewedBy: { select: { id: true, name: true, email: true } } } },
  };
}

function searchScore(doc, q) {
  if (!q) return 0;
  const needle = q.toLowerCase();
  let score = 0;
  const title = (doc.title || '').toLowerCase();
  const desc = (doc.description || '').toLowerCase();
  const cat = (doc.category || '').toLowerCase();
  const dept = (doc.department?.name || '').toLowerCase();
  const file = (doc.latestFileName || '').toLowerCase();
  if (title === needle) score += 100;
  if (title.includes(needle)) score += 40;
  if (desc.includes(needle)) score += 20;
  if (cat.includes(needle)) score += 15;
  if ((doc.referenceNumber || '').toLowerCase().includes(needle)) score += 30;
  if ((doc.documentType || '').toLowerCase().includes(needle)) score += 15;
  if ((doc.keywords || '').toLowerCase().includes(needle)) score += 12;
  if (dept.includes(needle)) score += 10;
  if (file.includes(needle)) score += 10;
  // content-aware fallback: also boost if any term matches
  for (const term of needle.split(/\s+/).filter(Boolean)) {
    if (title.includes(term)) score += 5;
    if (desc.includes(term)) score += 3;
    if (file.includes(term)) score += 2;
    if ((doc.keywords || '').toLowerCase().includes(term)) score += 2;
  }
  return score;
}

/** Adds a from/to range to a where field without clobbering other constraints. */
function addDateRange(where, field, from, to) {
  const fromDate = from ? new Date(String(from)) : null;
  const toDate = to ? new Date(String(to)) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) return false;
  if (toDate && Number.isNaN(toDate.getTime())) return false;
  if (!fromDate && !toDate) return true;
  const range = { ...(where[field] || {}) };
  if (fromDate) range.gte = fromDate;
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  where[field] = range;
  return true;
}

const DOC_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'ARCHIVED', 'FINAL_REVIEW'];

/** approvalStatus filter maps to the underlying document status. */
function mapApprovalStatus(value) {
  const raw = String(value).toUpperCase();
  return raw === 'STAGE1_APPROVED' ? 'FINAL_REVIEW' : raw;
}

/** Uniqueness-safe reference number: LLCC-DOC-YYYY-####. */
async function generateReferenceNumber() {
  const prefix = `LLCC-DOC-${new Date().getFullYear()}-`;
  const used = await prisma.document.findMany({
    where: { referenceNumber: { startsWith: prefix } },
    select: { referenceNumber: true },
  });
  const taken = new Set(used.map((d) => d.referenceNumber));
  for (let i = 1; i < 10000; i++) {
    const candidate = `${prefix}${String(i).padStart(4, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback: keep the format but avoid an infinite search.
  return `${prefix}${randomBytes(3).toString('hex').slice(0, 4).toUpperCase()}`;
}

/** Resolves categoryId -> display name and category name -> categoryId. */
async function resolveCategory(category, categoryId) {
  let id = categoryId === undefined || categoryId === null || categoryId === '' ? null : String(categoryId);
  let name = category === undefined || category === null ? undefined : String(category).trim() || undefined;
  if (id) {
    const cat = await prisma.documentCategory.findUnique({ where: { id } });
    if (!cat) return { error: 'Category not found' };
    name = cat.name; // resolved catalog name wins for backwards compatibility
  } else if (name) {
    const cat = await prisma.documentCategory.findFirst({ where: { name } });
    if (cat) id = cat.id;
  }
  return { categoryId: id, category: name };
}

async function metadataFields(body, { creating = false } = {}) {
  const data = {};
  const refRaw = body.referenceNumber;
  const requestedRef = refRaw === undefined || refRaw === null ? '' : String(refRaw).trim();
  if (creating || refRaw !== undefined) {
    const candidate = requestedRef || await generateReferenceNumber();
    const clash = await prisma.document.findFirst({ where: { referenceNumber: candidate, ...(creating ? {} : { id: { not: body.__docId } }) } });
    if (clash) return { error: 'duplicateReference' };
    data.referenceNumber = candidate;
  }
  if (body.documentType !== undefined) data.documentType = String(body.documentType).trim() || null;
  if (body.keywords !== undefined) data.keywords = String(body.keywords).trim() || null;
  if (body.renewalStatus !== undefined) data.renewalStatus = String(body.renewalStatus).trim() || 'NONE';
  if (body.requiresFinalApproval !== undefined) data.requiresFinalApproval = Boolean(body.requiresFinalApproval);
  if (body.reviewDate !== undefined) {
    const date = parseExpiry(body.reviewDate);
    if (date === false) return { error: 'Invalid review date' };
    data.reviewDate = date;
  }
  if (body.categoryId !== undefined || body.category !== undefined) {
    const resolved = await resolveCategory(body.category, body.categoryId);
    if (resolved.error) return { error: resolved.error };
    if (resolved.category !== undefined) data.category = resolved.category;
    if (creating || body.categoryId !== undefined) data.categoryId = resolved.categoryId;
  }
  return { data };
}

export async function listDocuments(req, res) {
  const {
    q, departmentId, category, status, from, to, page = '1', limit = '10', sort, view, expiring,
    referenceNumber, referenceMatch, referenceExact, documentType, keywords, fileType,
    modifiedFrom, modifiedTo, approvalStatus,
  } = req.query;
  const inRecycleBin = view === 'trash';
  const where = {};
  // Recycle bin lists only soft-deleted docs; the normal list excludes them.
  where.deletedAt = inRecycleBin ? { not: null } : null;
  if (departmentId) where.departmentId = String(departmentId);
  if (category) where.category = { contains: String(category) };
  if (status) where.status = String(status);
  if (!addDateRange(where, 'updatedAt', from, to) || !addDateRange(where, 'updatedAt', modifiedFrom, modifiedTo)) {
    return res.status(400).json({ message: 'Invalid date filter' });
  }
  if (referenceNumber) {
    const exact = String(referenceMatch || referenceExact || '').toLowerCase() === 'exact';
    where.referenceNumber = exact ? String(referenceNumber) : { contains: String(referenceNumber) };
  }
  if (documentType) where.documentType = { contains: String(documentType) };
  if (keywords) where.keywords = { contains: String(keywords) };
  if (fileType) {
    const ext = String(fileType).replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(ext)) return res.status(400).json({ message: 'Invalid file type filter' });
    where.latestFileName = { endsWith: `.${ext}` };
  }
  if (approvalStatus && !status) {
    const mapped = mapApprovalStatus(approvalStatus);
    if (!DOC_STATUSES.includes(mapped)) return res.status(400).json({ message: 'Invalid approval status filter' });
    where.status = mapped;
  }
  if (expiring === 'soon') {
    // expires within the next 30 days (and not already expired)
    const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    where.expiresAt = { not: null, lte: soon, gte: new Date() };
  } else if (expiring === 'expired') {
    where.expiresAt = { not: null, lt: new Date() };
  }

  // Role-based scope
  if (req.user.role === 'STAFF') {
    where.departmentId = req.user.departmentId || '__none__';
    where.OR = [{ status: 'APPROVED' }, { uploaderId: req.user.id }];
  } else if (req.user.role === 'DEPARTMENT_HEAD') {
    where.departmentId = req.user.departmentId || '__none__';
  } else if (departmentId && !canAccessDepartment(req.user, String(departmentId))) {
    return res.status(403).json({ message: 'No access to this department' });
  }

  // Recycle bin is limited to users who may delete.
  if (inRecycleBin && !['SUPER_ADMIN', 'DEPARTMENT_HEAD'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  let docs = await prisma.document.findMany({
    where,
    include: { department: true, uploader: { select: { id: true, name: true } }, currentVersion: true },
  });

  const query = (q || '').trim();
  if (query) {
    const needle = query.toLowerCase();
    docs = docs.filter((d) => {
      const searchable = [
        d.title, d.description, d.category, d.department?.name, d.latestFileName,
        d.referenceNumber, d.keywords, d.documentType,
        d.currentVersion?.originalName, // parsed text where available
      ].filter(Boolean);
      return searchable.some((v) => String(v).toLowerCase().includes(needle)) ||
        needle.split(/\s+/).filter(Boolean).every((t) => searchable.some((v) => String(v).toLowerCase().includes(t)));
    });
  }

  docs = docs.map((d) => ({ ...d, _score: searchScore(d, query) }));
  docs.sort((a, b) => {
    if (query || sort === 'relevance') {
      if (b._score !== a._score) return b._score - a._score;
      if (b.revisionCount !== a.revisionCount) return b.revisionCount - a.revisionCount;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    }
    if (sort === 'updatedAsc') return new Date(a.updatedAt) - new Date(b.updatedAt);
    if (sort === 'revisions') {
      if (b.revisionCount !== a.revisionCount) return b.revisionCount - a.revisionCount;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    }
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  const total = docs.length;
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  const now = Date.now();
  const items = docs.slice((p - 1) * l, p * l).map(({ _score, ...d }) => ({
    ...d,
    expired: d.expiresAt ? new Date(d.expiresAt).getTime() < now : false,
    expiringSoon: d.expiresAt ? (() => {
      const t = new Date(d.expiresAt).getTime();
      return t >= now && t - now <= 30 * 24 * 3600 * 1000;
    })() : false,
  }));
  res.json({ documents: items, total, page: p, limit: l, pages: Math.ceil(total / l), view: inRecycleBin ? 'trash' : 'active' });
}

export async function getDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: docInclude() });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  res.json({ document: doc });
}

export async function createDocument(req, res) {
  const { title, description, category, departmentId, status, expiresAt } = req.body;
  const file = req.file;
  if (!title || (!category && !req.body.categoryId) || !departmentId) return res.status(400).json({ message: 'Title, category, and department are required' });
  if (!file) return res.status(400).json({ message: 'File is required' });
  if (!canAccessDepartment(req.user, departmentId)) return res.status(403).json({ message: 'No access to this department' });
  const expiry = parseExpiry(expiresAt);
  if (expiry === false) return res.status(400).json({ message: 'Invalid expiration date' });

  const extra = await metadataFields(req.body, { creating: true });
  if (extra.error === 'duplicateReference') return res.status(409).json({ message: 'Reference number already exists' });
  if (extra.error) return res.status(400).json({ message: extra.error });

  const initialStatus = status && ['DRAFT', 'PENDING'].includes(status) ? status : 'DRAFT';
  let doc;
  try {
    doc = await prisma.document.create({
      data: {
        title: title.trim(), description: description?.trim() || null,
        category: extra.data.category || String(category || '').trim(),
        categoryId: extra.data.categoryId || null,
        referenceNumber: extra.data.referenceNumber,
        documentType: extra.data.documentType || null,
        keywords: extra.data.keywords || null,
        reviewDate: extra.data.reviewDate || null,
        renewalStatus: extra.data.renewalStatus || 'NONE',
        requiresFinalApproval: extra.data.requiresFinalApproval || false,
        departmentId, uploaderId: req.user.id, status: initialStatus, revisionCount: 1,
        latestFileName: file.originalname, latestMimeType: file.mimetype, latestFileSize: file.size, latestStoragePath: file.filename,
        expiresAt: expiry,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Reference number already exists' });
    throw e;
  }
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id, versionNumber: 1, fileName: file.filename, originalName: file.originalname,
      mimeType: file.mimetype, fileSize: file.size, storagePath: file.filename, changeNotes: 'Initial upload', createdById: req.user.id, isCurrent: true,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });

  if (initialStatus === 'PENDING') {
    await prisma.approval.create({ data: { documentId: doc.id, status: 'PENDING', submittedById: req.user.id } });
    await notifyApprovers(doc, req.user, 'Document submitted for approval', `"${doc.title}" was submitted for approval.`);
  }

  await logAudit({ userId: req.user.id, action: 'UPLOAD_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { title: doc.title, referenceNumber: doc.referenceNumber }, req });
  const full = await prisma.document.findUnique({ where: { id: doc.id }, include: docInclude() });
  res.status(201).json({ document: full });
}

export async function updateDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { department: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canModifyDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });

  const { title, description, category, expiresAt } = req.body;
  const file = req.file;
  const data = {};
  if (title !== undefined) data.title = title.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (expiresAt !== undefined) {
    const expiry = parseExpiry(expiresAt);
    if (expiry === false) return res.status(400).json({ message: 'Invalid expiration date' });
    data.expiresAt = expiry;
    if (expiry) data.expiredNotifiedAt = null; // re-arm reminder after date changes
  }
  if (req.body.departmentId !== undefined) {
    if (!canAccessDepartment(req.user, req.body.departmentId)) return res.status(400).json({ message: 'No access to target department' });
    data.departmentId = req.body.departmentId;
  }
  if (req.body.status !== undefined && ['DRAFT', 'ARCHIVED'].includes(req.body.status) && canModifyDocument(req.user, doc)) data.status = req.body.status;

  const extra = await metadataFields({ ...req.body, __docId: doc.id });
  if (extra.error === 'duplicateReference') return res.status(409).json({ message: 'Reference number already exists' });
  if (extra.error) return res.status(400).json({ message: extra.error });
  Object.assign(data, extra.data);

  let newVersion = null;
  if (file) {
    const nextVersion = doc.revisionCount + 1;
    await prisma.documentVersion.updateMany({ where: { documentId: doc.id, isCurrent: true }, data: { isCurrent: false } });
    newVersion = await prisma.documentVersion.create({
      data: {
        documentId: doc.id, versionNumber: nextVersion, fileName: file.filename, originalName: file.originalname,
        mimeType: file.mimetype, fileSize: file.size, storagePath: file.filename, changeNotes: req.body.changeNotes?.trim() || `Revision ${nextVersion}`, createdById: req.user.id, isCurrent: true,
      },
    });
    data.revisionCount = nextVersion;
    data.latestFileName = file.originalname;
    data.latestMimeType = file.mimetype;
    data.latestFileSize = file.size;
    data.latestStoragePath = file.filename;
    data.currentVersionId = newVersion.id;
    if (doc.status === 'APPROVED') data.status = 'DRAFT'; // re-approval needed after content change
  }

  let updated;
  try {
    updated = await prisma.document.update({ where: { id: doc.id }, data, include: docInclude() });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Reference number already exists' });
    throw e;
  }
  await logAudit({ userId: req.user.id, action: file ? 'UPDATE_DOCUMENT_VERSION' : 'UPDATE_DOCUMENT_METADATA', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { title: updated.title, version: updated.revisionCount }, req });
  res.json({ document: updated });
}

export async function archiveDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canModifyDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (doc.status === 'ARCHIVED') return res.status(400).json({ message: 'Document is already archived' });
  const reason = String(req.body?.reason || req.query.reason || '').trim() || null;
  const [updated] = await prisma.$transaction([
    prisma.document.update({ where: { id: doc.id }, data: { status: 'ARCHIVED' } }),
    prisma.archivedDocument.create({ data: { documentId: doc.id, archivedById: req.user.id, reason } }),
  ]);
  await logAudit({ userId: req.user.id, action: 'ARCHIVE_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { reason }, req });
  res.json({ document: updated, message: 'Document archived' });
}

export async function unarchiveDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canModifyDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (doc.status !== 'ARCHIVED') return res.status(400).json({ message: 'Document is not archived' });
  const restoredStatus = doc.verificationCode ? 'APPROVED' : 'DRAFT';
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.document.update({ where: { id: doc.id }, data: { status: restoredStatus } }),
    prisma.archivedDocument.updateMany({
      where: { documentId: doc.id, restoredAt: null },
      data: { restoredAt: now, restoredById: req.user.id },
    }),
  ]);
  await logAudit({ userId: req.user.id, action: 'UNARCHIVE_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { status: restoredStatus }, req });
  res.json({ document: updated, message: 'Document unarchived' });
}

export async function deleteDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { versions: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canDeleteDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (doc.deletedAt) return res.status(400).json({ message: 'Document is already in the recycle bin' });
  const reason = String(req.body?.reason || req.query.reason || '').trim() || null;
  // Soft delete: move to recycle bin. Files and rows are preserved.
  const [updated] = await prisma.$transaction([
    prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } }),
    prisma.deletedDocument.create({ data: { documentId: doc.id, deletedById: req.user.id, reason } }),
  ]);
  await logAudit({ userId: req.user.id, action: 'DELETE_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { title: doc.title, mode: 'soft', reason }, req });
  res.json({ message: 'Document moved to recycle bin', document: updated });
}

export async function restoreDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canRestoreDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (!doc.deletedAt) return res.status(400).json({ message: 'Document is not in the recycle bin' });
  const [updated] = await prisma.$transaction([
    prisma.document.update({ where: { id: doc.id }, data: { deletedAt: null } }),
    prisma.deletedDocument.updateMany({
      where: { documentId: doc.id, restoredAt: null },
      data: { restoredAt: new Date(), restoredById: req.user.id },
    }),
  ]);
  await logAudit({ userId: req.user.id, action: 'RESTORE_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { title: doc.title }, req });
  res.json({ message: 'Document restored', document: updated });
}

export async function purgeDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { versions: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canDeleteDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (!doc.deletedAt && req.query.force !== 'true') {
    return res.status(400).json({ message: 'Document must be in the recycle bin before permanent deletion' });
  }
  await prisma.$transaction([
    prisma.verificationLog.deleteMany({ where: { documentId: doc.id } }),
    prisma.notification.deleteMany({ where: { documentId: doc.id } }),
    prisma.approval.deleteMany({ where: { documentId: doc.id } }),
    // History rows stay, with documentId nulled, so purge does not erase the audit trail.
    prisma.archivedDocument.updateMany({ where: { documentId: doc.id }, data: { documentId: null } }),
    prisma.deletedDocument.updateMany({ where: { documentId: doc.id }, data: { documentId: null } }),
    prisma.documentVersion.deleteMany({ where: { documentId: doc.id } }),
    prisma.document.delete({ where: { id: doc.id } }),
  ]);
  for (const v of doc.versions) {
    const p = path.resolve(process.env.UPLOAD_DIR || './uploads', v.storagePath);
    fs.promises.unlink(p).catch(() => {});
  }
  await logAudit({ userId: req.user.id, action: 'PURGE_DOCUMENT', entityType: 'Document', entityId: doc.id, details: { title: doc.title }, req });
  res.json({ message: 'Document permanently deleted' });
}

export async function downloadDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { currentVersion: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  const versionId = req.query.versionId;
  let version = doc.currentVersion;
  if (versionId) {
    version = await prisma.documentVersion.findUnique({ where: { id: String(versionId) } });
    if (!version || version.documentId !== doc.id) return res.status(404).json({ message: 'Version not found' });
  }
  if (!version) return res.status(404).json({ message: 'No file available' });
  const filePath = path.resolve(process.env.UPLOAD_DIR || './uploads', version.storagePath);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on server' });
  // Archived documents remain downloadable; the access is explicitly audited.
  await logAudit({ userId: req.user.id, action: 'DOWNLOAD_DOCUMENT', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { version: version.versionNumber, archived: doc.status === 'ARCHIVED' }, req });
  res.download(filePath, version.originalName);
}

export async function restoreVersion(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { versions: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canModifyDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  const version = doc.versions.find((v) => v.id === req.params.versionId);
  if (!version) return res.status(404).json({ message: 'Version not found' });

  await prisma.documentVersion.updateMany({ where: { documentId: doc.id, isCurrent: true }, data: { isCurrent: false } });
  const nextVersion = doc.revisionCount + 1;
  const restored = await prisma.documentVersion.create({
    data: {
      documentId: doc.id, versionNumber: nextVersion, fileName: version.fileName, originalName: version.originalName,
      mimeType: version.mimeType, fileSize: version.fileSize, storagePath: version.storagePath,
      changeNotes: `Restored from Rev ${version.versionNumber}`, createdById: req.user.id, isCurrent: true,
    },
  });
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      currentVersionId: restored.id, revisionCount: nextVersion, latestFileName: restored.originalName,
      latestMimeType: restored.mimeType, latestFileSize: restored.fileSize, latestStoragePath: restored.storagePath, status: 'DRAFT',
    },
    include: docInclude(),
  });
  await logAudit({ userId: req.user.id, action: 'RESTORE_DOCUMENT_VERSION', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { restoredFrom: version.versionNumber, newVersion: nextVersion }, req });
  res.json({ document: updated });
}

async function notifyApprovers(doc, actor, title, message) {
  const approvers = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'SUPER_ADMIN' },
        { role: 'DEAN' },
        { role: 'DEPARTMENT_HEAD', departmentId: doc.departmentId },
      ],
    },
    select: { id: true },
  });
  await notifyUsers(approvers.map((a) => a.id).filter((id) => id !== actor.id), {
    actorId: actor.id, documentId: doc.id, type: 'APPROVAL', title, message,
  });
}
