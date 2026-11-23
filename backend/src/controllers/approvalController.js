import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { createNotification, notifyUsers } from '../utils/notifications.js';
import { canApprove, canModifyDocument } from '../utils/permissions.js';
import { ensureVerificationCode } from './verificationController.js';

export async function submitForApproval(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canModifyDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });
  if (!['DRAFT', 'REJECTED', 'REVISION_REQUESTED'].includes(doc.status)) {
    return res.status(400).json({ message: 'Document cannot be submitted in its current status' });
  }
  const [approval, updated] = await prisma.$transaction([
    prisma.approval.create({ data: { documentId: doc.id, status: 'PENDING', submittedById: req.user.id } }),
    prisma.document.update({ where: { id: doc.id }, data: { status: 'PENDING' } }),
  ]);

  const approvers = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: 'SUPER_ADMIN' }, { role: 'DEAN' }, { role: 'DEPARTMENT_HEAD', departmentId: doc.departmentId }] },
    select: { id: true },
  });
  await notifyUsers(approvers.map((a) => a.id).filter((id) => id !== req.user.id), {
    actorId: req.user.id, documentId: doc.id, type: 'APPROVAL', title: 'Approval requested',
    message: `"${doc.title}" was submitted for approval.`,
  });
  await logAudit({ userId: req.user.id, action: 'SUBMIT_APPROVAL', entityType: 'Document', entityId: doc.id, documentId: doc.id, req });
  res.json({ approval, document: updated });
}

/** Shared uploader notification for a decision. */
async function notifyDecision(doc, actor, action, comments) {
  const typeMap = { APPROVED: 'APPROVAL', REJECTED: 'REJECTION', REVISION_REQUESTED: 'REVISION_REQUESTED' };
  const titleMap = { APPROVED: 'Document approved', REJECTED: 'Document rejected', REVISION_REQUESTED: 'Revision requested' };
  await createNotification({
    userId: doc.uploaderId, actorId: actor.id, documentId: doc.id,
    type: typeMap[action], title: titleMap[action],
    message: `"${doc.title}" was ${action.toLowerCase().replace('_', ' ')}.${comments ? ` Comment: ${comments}` : ''}`,
  });
}

export async function actOnApproval(req, res) {
  if (!canApprove(req.user)) return res.status(403).json({ message: 'Access denied' });
  const { action, comments } = req.body; // APPROVED, REJECTED, REVISION_REQUESTED, APPROVE_STAGE1
  const valid = ['APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'APPROVE_STAGE1'];
  if (!valid.includes(action)) return res.status(400).json({ message: 'Invalid action' });
  const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { uploader: true } });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (req.user.role === 'DEPARTMENT_HEAD' && doc.departmentId !== req.user.departmentId) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const now = new Date();
  const note = comments?.trim() || null;

  /* ---------- Stage 1: department head (or dean) sends to final review ---------- */
  if (action === 'APPROVE_STAGE1') {
    if (doc.status !== 'PENDING') return res.status(400).json({ message: 'Document is not pending approval' });
    const pending = await prisma.approval.findFirst({ where: { documentId: doc.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    const [approval] = await prisma.$transaction([
      pending
        ? prisma.approval.update({ where: { id: pending.id }, data: { status: 'STAGE1_APPROVED', reviewedById: req.user.id, comments: note, reviewedAt: now } })
        : prisma.approval.create({ data: { documentId: doc.id, status: 'STAGE1_APPROVED', submittedById: doc.uploaderId, reviewedById: req.user.id, comments: note, reviewedAt: now } }),
      prisma.document.update({ where: { id: doc.id }, data: { status: 'FINAL_REVIEW' } }),
    ]);

    const reviewers = await prisma.user.findMany({ where: { isActive: true, OR: [{ role: 'DEAN' }, { role: 'SUPER_ADMIN' }] }, select: { id: true } });
    await notifyUsers([doc.uploaderId, ...reviewers.map((u) => u.id)], {
      actorId: req.user.id, documentId: doc.id, type: 'APPROVAL', title: 'Stage 1 approved - final review',
      message: `"${doc.title}" passed stage 1 review and is awaiting final approval.${note ? ` Comment: ${note}` : ''}`,
    });
    await logAudit({ userId: req.user.id, action: 'APPROVAL_STAGE1', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { comments: note }, req });
    return res.json({ approval, status: 'FINAL_REVIEW' });
  }

  /* ---------- Final review: only DEAN / SUPER_ADMIN may decide ---------- */
  if (doc.status === 'FINAL_REVIEW') {
    if (!['DEAN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only deans or administrators may complete final review' });
    }
    const latest = await prisma.approval.findFirst({ where: { documentId: doc.id }, orderBy: { createdAt: 'desc' } });
    const [approval] = await prisma.$transaction([
      latest
        ? prisma.approval.update({ where: { id: latest.id }, data: { status: action, reviewedById: req.user.id, comments: note, reviewedAt: now } })
        : prisma.approval.create({ data: { documentId: doc.id, status: action, submittedById: doc.uploaderId, reviewedById: req.user.id, comments: note, reviewedAt: now } }),
      prisma.document.update({ where: { id: doc.id }, data: { status: action } }),
    ]);
    await notifyDecision(doc, req.user, action, note);
    let verificationCode = null;
    if (action === 'APPROVED') {
      try { verificationCode = await ensureVerificationCode(doc); } catch (e) { console.error('verification code failed', e.message); }
    }
    await logAudit({ userId: req.user.id, action: `APPROVAL_${action}`, entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { comments: note, stage: 'FINAL' }, req });
    return res.json({ approval, status: action, verificationCode });
  }

  /* ---------- Legacy direct decision on a PENDING document ---------- */
  if (doc.status !== 'PENDING') return res.status(400).json({ message: 'Document is not pending approval' });

  const pending = await prisma.approval.findFirst({ where: { documentId: doc.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  const [approval] = await prisma.$transaction([
    pending
      ? prisma.approval.update({ where: { id: pending.id }, data: { status: action, reviewedById: req.user.id, comments: note, reviewedAt: now } })
      : prisma.approval.create({ data: { documentId: doc.id, status: action, submittedById: doc.uploaderId, reviewedById: req.user.id, comments: note, reviewedAt: now } }),
    prisma.document.update({ where: { id: doc.id }, data: { status: action } }),
  ]);

  await notifyDecision(doc, req.user, action, note);

  // Approved documents get a unique, permanent verification code for QR checks.
  let verificationCode = null;
  if (action === 'APPROVED') {
    try { verificationCode = await ensureVerificationCode(doc); } catch (e) { console.error('verification code failed', e.message); }
  }

  await logAudit({ userId: req.user.id, action: `APPROVAL_${action}`, entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { comments: note }, req });
  res.json({ approval, status: action, verificationCode });
}

export async function listPendingApprovals(req, res) {
  if (!canApprove(req.user)) return res.status(403).json({ message: 'Access denied' });
  const where = { status: { in: ['PENDING', 'FINAL_REVIEW'] } };
  if (req.user.role === 'DEPARTMENT_HEAD') where.departmentId = req.user.departmentId || '__none__';
  const docs = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { department: true, uploader: { select: { id: true, name: true, email: true } }, approvals: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  res.json({ documents: docs.map((d) => ({ ...d, stage: d.status === 'FINAL_REVIEW' ? 'FINAL' : 'STAGE1' })) });
}
