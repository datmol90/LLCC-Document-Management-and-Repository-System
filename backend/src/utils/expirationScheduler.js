import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { getSetting } from '../utils/settings.js';

const DAY = 86400000;
/** Default windows; can be overridden by the `expiryReminderDays` setting. */
const DEFAULT_REMINDER_WINDOWS = [30, 14, 7, 3, 1];

async function reminderWindows() {
  const configured = await getSetting('expiryReminderDays', DEFAULT_REMINDER_WINDOWS);
  const windows = Array.isArray(configured) ? configured.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
  return windows.length ? windows : DEFAULT_REMINDER_WINDOWS;
}

function daysBetween(fromMs, toMs) {
  return Math.ceil((toMs - fromMs) / DAY);
}

/**
 * Scans for expiring/expired documents and raises notifications exactly once
 * per reminder window per document (tracked with expiredNotifiedAt).
 */
export async function runExpirationScan({ dryRun = false } = {}) {
  const now = Date.now();
  const windows = await reminderWindows();
  const soon = new Date(now + Math.max(...windows) * DAY);

  const candidates = await prisma.document.findMany({
    where: { deletedAt: null, expiresAt: { not: null }, status: { not: 'ARCHIVED' } },
    select: {
      id: true, title: true, expiresAt: true, expiredNotifiedAt: true, status: true,
      departmentId: true, uploaderId: true,
    },
  });

  const created = [];
  const expiredCreated = [];

  for (const doc of candidates) {
    const exp = new Date(doc.expiresAt).getTime();
    const daysLeft = daysBetween(now, exp);

    // ---- Expired ----
    if (exp < now) {
      if (doc.expiredNotifiedAt && new Date(doc.expiredNotifiedAt).getTime() >= exp) continue; // already notified post-expiry
      const recipients = await approverIdsFor(doc);
      if (!dryRun && recipients.length) {
        await prisma.notification.createMany({
          data: recipients.map((userId) => ({
            userId,
            documentId: doc.id,
            type: 'EXPIRATION',
            title: 'Document expired',
            message: `"${doc.title}" expired on ${new Date(doc.expiresAt).toLocaleDateString()} and requires renewal.`,
          })),
        });
        await prisma.document.update({ where: { id: doc.id }, data: { expiredNotifiedAt: new Date() } });
        await logAudit({ userId: null, action: 'EXPIRATION_REMINDER', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { kind: 'expired', daysLeft }, req: null });
      }
      expiredCreated.push({ id: doc.id, title: doc.title, daysLeft });
      continue;
    }

    // ---- Expiring soon ----
    if (exp > soon.getTime()) continue;
    const matchedWindow = windows.find((w) => daysLeft <= w && daysLeft > 0);
    if (!matchedWindow) continue;

    const alreadySent = doc.expiredNotifiedAt && daysBetween(new Date(doc.expiredNotifiedAt).getTime(), exp) >= matchedWindow;
    if (alreadySent) continue;

    const recipients = await approverIdsFor(doc);
    if (!dryRun && recipients.length) {
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          documentId: doc.id,
          type: 'EXPIRATION',
          title: daysLeft <= 3 ? 'Document expiring soon' : 'Document renewal reminder',
          message: `"${doc.title}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${new Date(doc.expiresAt).toLocaleDateString()}). Please renew or archive it.`,
        })),
      });
      await prisma.document.update({ where: { id: doc.id }, data: { expiredNotifiedAt: new Date() } });
      await logAudit({ userId: null, action: 'EXPIRATION_REMINDER', entityType: 'Document', entityId: doc.id, documentId: doc.id, details: { kind: 'expiring', daysLeft, window: matchedWindow }, req: null });
    }
    created.push({ id: doc.id, title: doc.title, daysLeft });
  }

  return { expiring: created, expired: expiredCreated, scanned: candidates.length };
}

/** Document owner + approvers in their department + deans/super admins. */
async function approverIdsFor(doc) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { id: doc.uploaderId },
        { role: 'SUPER_ADMIN' },
        { role: 'DEAN' },
        { role: 'DEPARTMENT_HEAD', departmentId: doc.departmentId },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** GET /api/documents/expiring -> documents needing attention (scoped by role). */
export async function listExpiring(req, res) {
  const windows = await reminderWindows();
  const soon = new Date(Date.now() + Math.max(...windows) * DAY);
  const where = { deletedAt: null, expiresAt: { not: null } };
  if (req.user.role === 'STAFF') {
    where.departmentId = req.user.departmentId || '__none__';
    where.OR = [{ status: 'APPROVED' }, { uploaderId: req.user.id }];
  } else if (req.user.role === 'DEPARTMENT_HEAD') {
    where.departmentId = req.user.departmentId || '__none__';
  }
  const [expiring, expired] = await Promise.all([
    prisma.document.findMany({
      where: { ...where, expiresAt: { gte: new Date(), lte: soon } },
      orderBy: { expiresAt: 'asc' }, include: { department: true, uploader: { select: { name: true } } },
    }),
    prisma.document.findMany({
      where: { ...where, expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: 'asc' }, include: { department: true, uploader: { select: { name: true } } },
    }),
  ]);
  const withFlags = (d) => ({
    ...d,
    daysLeft: daysBetween(Date.now(), new Date(d.expiresAt).getTime()),
    expired: new Date(d.expiresAt).getTime() < Date.now(),
  });
  res.json({ expiring: expiring.map(withFlags), expired: expired.map(withFlags) });
}

/** POST /api/admin/run-expiration-scan (admin trigger for demo/testing). */
export async function triggerScan(req, res) {
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Access denied' });
  const result = await runExpirationScan();
  await logAudit({ userId: req.user.id, action: 'RUN_EXPIRATION_SCAN', entityType: 'System', details: result, req });
  res.json({ message: 'Expiration scan completed', result });
}

let timer = null;

/** Starts the periodic reminder scheduler (every 6 hours by default). */
export async function startExpirationScheduler() {
  const configured = await getSetting('expiryScanHours', Number(process.env.EXPIRY_SCAN_HOURS || 6));
  const hours = Number.isFinite(Number(configured)) ? Number(configured) : 6;
  const run = async () => {
    try {
      const r = await runExpirationScan();
      if (r.expiring.length || r.expired.length) console.log(`[expiry] sent ${r.expiring.length + r.expired.length} reminder(s)`);
    } catch (e) { console.error('[expiry] scan failed', e); }
  };
  // Initial pass shortly after boot so an idle install still works.
  setTimeout(run, 15000);
  timer = setInterval(run, Math.max(1, hours) * 3600000);
  timer.unref?.();
  console.log(`[expiry] renewal reminder scheduler started (every ${hours}h)`);
  return timer;
}

export function stopExpirationScheduler() { if (timer) clearInterval(timer); timer = null; }
