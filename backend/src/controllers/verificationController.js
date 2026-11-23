import prisma from '../utils/prisma.js';
import { generateVerificationCode, normalizeVerificationCode } from '../utils/verification.js';
import { logAudit } from '../utils/audit.js';
import { canViewDocument } from '../utils/permissions.js';

const FRONTEND_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

/** Returns (and lazily creates) the verification code for an approved document. */
export async function ensureVerificationCode(doc) {
  if (doc.verificationCode) return doc.verificationCode;
  // Retry on the (unlikely) unique-collision case.
  for (let i = 0; i < 5; i++) {
    const code = generateVerificationCode();
    try {
      const updated = await prisma.document.update({
        where: { id: doc.id },
        data: { verificationCode: code },
        select: { verificationCode: true },
      });
      return updated.verificationCode;
    } catch (e) {
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new Error('Unable to allocate a unique verification code');
}

/** GET /api/documents/:id/qr -> PNG data URL (auth + view permission). */
export async function getQr(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (doc.status !== 'APPROVED') {
    return res.status(400).json({ message: 'Only approved documents receive a verification code' });
  }
  const code = await ensureVerificationCode(doc);
  const url = `${FRONTEND_ORIGIN}/verify/${encodeURIComponent(code)}`;

  const { default: QRCode } = await import('qrcode');
  const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#0B2F5B', light: '#FFFFFF' } });
  res.json({ code, url, qr: dataUrl });
}

/**
 * GET /api/verify/:code  (PUBLIC - no auth, for scanning a printed QR)
 * Logs every scan for auditing.
 */
export async function verifyByCode(req, res) {
  const code = normalizeVerificationCode(req.params.code);
  const ip = req.ip || req.headers['x-forwarded-for'] || null;
  const ua = req.headers['user-agent'] || null;

  const doc = await prisma.document.findUnique({
    where: { verificationCode: code },
    include: {
      department: true,
      uploader: { select: { name: true } },
      currentVersion: true,
      approvals: { orderBy: { reviewedAt: 'desc' }, take: 3, include: { reviewedBy: { select: { name: true } } } },
    },
  });

  if (!doc || doc.deletedAt) {
    await prisma.verificationLog.create({ data: { code, result: 'NOT_FOUND', ipAddress: ip, userAgent: ua } });
    return res.status(404).json({ valid: false, result: 'NOT_FOUND', message: 'No document matches this verification code.' });
  }

  if (doc.status === 'ARCHIVED') {
    await prisma.verificationLog.create({ data: { code, documentId: doc.id, result: 'ARCHIVED', ipAddress: ip, userAgent: ua } });
    return res.json({
      valid: false,
      result: 'ARCHIVED',
      message: 'This document has been archived and is not an active approved record.',
      document: publicView(doc),
    });
  }

  if (doc.status !== 'APPROVED') {
    await prisma.verificationLog.create({ data: { code, documentId: doc.id, result: 'NOT_APPROVED', ipAddress: ip, userAgent: ua } });
    return res.json({
      valid: false,
      result: 'NOT_APPROVED',
      message: `This document is currently ${String(doc.status).toLowerCase().replace('_', ' ')} and is not an officially approved record.`,
      document: publicView(doc),
    });
  }

  if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
    await prisma.verificationLog.create({ data: { code, documentId: doc.id, result: 'EXPIRED', ipAddress: ip, userAgent: ua } });
    return res.json({
      valid: false,
      result: 'EXPIRED',
      message: 'This document has expired and is no longer a valid approved record.',
      document: publicView(doc),
    });
  }

  await prisma.verificationLog.create({ data: { code, documentId: doc.id, result: 'VALID', ipAddress: ip, userAgent: ua } });
  return res.json({
    valid: true,
    result: 'VALID',
    message: 'This document is authentic and currently approved.',
    verifiedAt: new Date().toISOString(),
    document: publicView(doc),
  });
}

/** Minimal, non-sensitive projection safe for public display. */
function publicView(doc) {
  const approval = doc.approvals.find((a) => a.status === 'APPROVED');
  const validity = doc.status === 'ARCHIVED' ? 'ARCHIVED'
    : doc.status !== 'APPROVED' ? 'NOT_APPROVED'
      : (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now() ? 'EXPIRED' : 'VALID');
  return {
    validity,
    title: doc.title,
    category: doc.category,
    department: doc.department?.name || null,
    status: doc.status,
    revisionCount: doc.revisionCount,
    approvedAt: approval?.reviewedAt || null,
    approvedBy: approval?.reviewedBy?.name || null,
    updatedOn: doc.updatedAt,
    file: doc.latestFileName,
    verificationCode: doc.verificationCode,
  };
}

/** GET /api/documents/:id/verification -> code + QR for the detail modal. */
export async function getVerification(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (doc.status !== 'APPROVED') {
    return res.json({ code: null, approved: false, message: 'Document must be approved to receive a verification code.' });
  }
  const code = await ensureVerificationCode(doc);
  await logAudit({ userId: req.user.id, action: 'GENERATE_VERIFICATION_CODE', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { code }, req });
  res.json({ code, approved: true, url: `${FRONTEND_ORIGIN}/verify/${encodeURIComponent(code)}` });
}

/** GET /api/verification-logs -> scan history (privileged). */
export async function listVerificationLogs(req, res) {
  const user = req.user;
  if (!['SUPER_ADMIN', 'DEAN'].includes(user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  const { page = '1', limit = '20' } = req.query;
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  const [logs, total, validCount, invalidCount] = await Promise.all([
    prisma.verificationLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (p - 1) * l,
      take: l,
      include: { document: { select: { id: true, title: true } } },
    }),
    prisma.verificationLog.count(),
    prisma.verificationLog.count({ where: { result: 'VALID' } }),
    prisma.verificationLog.count({ where: { result: { in: ['NOT_FOUND', 'NOT_APPROVED'] } } }),
  ]);
  res.json({ logs, total, page: p, limit: l, pages: Math.ceil(total / l), validCount, invalidCount });
}
