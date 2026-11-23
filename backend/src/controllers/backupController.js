import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { canManageBackups } from '../utils/permissions.js';
import { getSettings } from '../utils/settings.js';
import { sha256 } from '../utils/verification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = () => path.resolve(process.env.BACKUP_DIR || './backups');
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');
const dbPath = () => path.resolve(__dirname, '../../prisma/dev.db');

function ensureDirs() { fs.mkdirSync(backupsDir(), { recursive: true }); }
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function requireAdmin(req, res) {
  if (!canManageBackups(req.user)) { res.status(403).json({ message: 'Only administrators can manage backups' }); return false; }
  return true;
}

/** Reopens the written zip and checks that all expected payloads are readable. */
function verifyBackupZip(storagePath, expectedFiles) {
  const AdmZip =admZipCtor();
  const zip = new AdmZip(storagePath);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Backup verification failed: missing manifest.json');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); }
  catch { throw new Error('Backup verification failed: unreadable manifest.json'); }
  if (!manifest || typeof manifest !== 'object') throw new Error('Backup verification failed: invalid manifest.json');

  const dbEntry = zip.getEntry('db/dev.db');
  if (!dbEntry || dbEntry.getData().length === 0) throw new Error('Backup verification failed: missing or empty db/dev.db');

  let checked = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('uploads/')) continue;
    try { entry.getData(); } catch { throw new Error(`Backup verification failed: unreadable entry ${entry.entryName}`); }
    checked++;
  }
  if (checked !== expectedFiles) throw new Error(`Backup verification failed: expected ${expectedFiles} uploaded files, found ${checked}`);
  return manifest;
}

// Loaded lazily so a missing optional dependency never breaks module import.
let _admZip = null;
function admZipCtor() {
  if (!_admZip) throw new Error('adm-zip is not available');
  return _admZip;
}

/** Shared backup builder used by the endpoint and the scheduled runner. */
async function performBackup({ userId, kind = 'FULL', req = null, actor = null }) {
  ensureDirs();
  const fileName = `llcc-backup-${kind}-${stamp()}.zip`;
  const storagePath = path.join(backupsDir(), fileName);
  const { default: AdmZip } = await import('adm-zip');
  _admZip = AdmZip;

  const zip = new AdmZip();
  const dbFile = dbPath();
  if (!fs.existsSync(dbFile)) throw new Error('Database file not found');
  // Flush WAL so the copied DB is consistent.
  try { await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
  zip.addLocalFile(dbFile, 'db', 'dev.db');

  let fileCount = 0;
  if (kind === 'FULL' && fs.existsSync(uploadDir())) {
    for (const name of fs.readdirSync(uploadDir())) {
      const p = path.join(uploadDir(), name);
      if (fs.statSync(p).isFile()) { zip.addLocalFile(p, 'uploads'); fileCount++; }
    }
  }

  const manifest = {
    app: 'LLCC DMS',
    version: 1,
    createdAt: new Date().toISOString(),
    kind,
    database: 'db/dev.db',
    uploadedFiles: fileCount,
    counts: {
      documents: await prisma.document.count(),
      users: await prisma.user.count(),
      departments: await prisma.department.count(),
    },
    createdBy: { id: userId, email: actor?.email || null },
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  const buffer = zip.toBuffer();
  fs.writeFileSync(storagePath, buffer);

  // Only a verified archive is allowed to become a COMPLETED backup record.
  verifyBackupZip(storagePath, fileCount);
  const checksum = sha256(buffer);

  const record = await prisma.backup.create({
    data: {
      fileName, storagePath, fileSize: buffer.length, kind, status: 'COMPLETED', verified: true, checksum,
      scope: kind === 'FULL' ? `Database + ${fileCount} uploaded files` : 'Database only',
      notes: `Documents: ${manifest.counts.documents}, Users: ${manifest.counts.users}; verified, sha256=${checksum}`,
      createdById: userId,
    },
  });

  await logAudit({ userId, action: 'CREATE_BACKUP', entityType: 'Backup', entityId: record.id, details: { fileName, kind, bytes: buffer.length, verified: true, checksum }, req });
  return record;
}

/** POST /api/backups  -> creates a verified zip containing the DB and (optionally) all stored files. */
export async function createBackup(req, res) {
  if (!requireAdmin(req, res)) return;
  ensureDirs();
  const kind = req.body?.kind === 'DB_ONLY' ? 'DB_ONLY' : 'FULL';
  const fileName = `llcc-backup-${kind}-${stamp()}.zip`;
  const storagePath = path.join(backupsDir(), fileName);

  try {
    const record = await performBackup({ userId: req.user.id, kind, req, actor: req.user });
    return res.status(201).json({ backup: record });
  } catch (err) {
    console.error('backup failed', err);
    await prisma.backup.create({
      data: { fileName, storagePath: '', fileSize: 0, kind, status: 'FAILED', verified: false, notes: err.message, createdById: req.user.id },
    }).catch(() => {});
    await logAudit({ userId: req.user.id, action: 'CREATE_BACKUP_FAILED', entityType: 'Backup', details: { error: err.message }, req });
    return res.status(500).json({ message: `Backup failed: ${err.message}` });
  }
}

/** Scheduled backup runner; honours backupEnabled / backupIntervalHours settings. */
export async function runScheduledBackup() {
  const settings = await getSettings();
  if (!settings.backupEnabled) return { skipped: true, reason: 'Automatic backups are disabled', intervalHours: settings.backupIntervalHours };
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) return { skipped: true, reason: 'No active super admin to attribute the backup to', intervalHours: settings.backupIntervalHours };
  try {
    const backup = await performBackup({ userId: admin.id, kind: 'FULL', actor: admin });
    await logAudit({ userId: admin.id, action: 'SCHEDULED_BACKUP', entityType: 'Backup', entityId: backup.id, details: { fileName: backup.fileName, verified: backup.verified } });
    return { skipped: false, backup, intervalHours: settings.backupIntervalHours };
  } catch (err) {
    console.error('scheduled backup failed', err);
    await logAudit({ userId: admin.id, action: 'SCHEDULED_BACKUP_FAILED', entityType: 'Backup', details: { error: err.message } });
    return { skipped: false, error: err.message, intervalHours: settings.backupIntervalHours };
  }
}

/** GET /api/backups */
export async function listBackups(req, res) {
  if (!requireAdmin(req, res)) return;
  const backups = await prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  const items = backups.map((b) => ({
    ...b,
    exists: b.storagePath ? fs.existsSync(b.storagePath) : false,
  }));
  res.json({ backups: items, backupsDir: backupsDir() });
}

/** GET /api/backups/:id/download */
export async function downloadBackup(req, res) {
  if (!requireAdmin(req, res)) return;
  const b = await prisma.backup.findUnique({ where: { id: req.params.id } });
  if (!b || !b.storagePath || !fs.existsSync(b.storagePath)) return res.status(404).json({ message: 'Backup file not found' });
  await logAudit({ userId: req.user.id, action: 'DOWNLOAD_BACKUP', entityType: 'Backup', entityId: b.id, details: { fileName: b.fileName }, req });
  res.download(b.storagePath, b.fileName);
}

/** DELETE /api/backups/:id */
export async function deleteBackup(req, res) {
  if (!requireAdmin(req, res)) return;
  const b = await prisma.backup.findUnique({ where: { id: req.params.id } });
  if (!b) return res.status(404).json({ message: 'Backup not found' });
  if (b.storagePath && fs.existsSync(b.storagePath)) fs.promises.unlink(b.storagePath).catch(() => {});
  await prisma.backup.delete({ where: { id: b.id } });
  await logAudit({ userId: req.user.id, action: 'DELETE_BACKUP', entityType: 'Backup', entityId: b.id, details: { fileName: b.fileName }, req });
  res.json({ message: 'Backup deleted' });
}

/**
 * POST /api/backups/:id/restore
 * Restores the database (and uploaded files for FULL backups) from a backup zip.
 * A safety copy of the current DB is taken first.
 */
export async function restoreBackup(req, res) {
  if (!requireAdmin(req, res)) return;
  const confirm = String(req.body?.confirm || '');
  if (confirm !== 'RESTORE') {
    return res.status(400).json({ message: 'Type RESTORE in the confirmation field to proceed' });
  }

  const b = await prisma.backup.findUnique({ where: { id: req.params.id } });
  if (!b || !b.storagePath || !fs.existsSync(b.storagePath)) return res.status(404).json({ message: 'Backup file not found' });

  try {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(b.storagePath);

    const dbEntry = zip.getEntry('db/dev.db') || zip.getEntry('dev.db');
    if (!dbEntry) throw new Error('Backup does not contain a database');

    // Safety copy of the live DB before overwriting.
    ensureDirs();
    const liveDb = dbPath();
    const safety = path.join(backupsDir(), `pre-restore-${stamp()}.db`);
    if (fs.existsSync(liveDb)) fs.copyFileSync(liveDb, safety);

    // Close open connections before swapping the file.
    await prisma.$disconnect();

    const dbBuffer = dbEntry.getData();
    fs.writeFileSync(liveDb, dbBuffer);

    // Restore uploaded files (FULL backups only).
    let restoredFiles = 0;
    const uploadEntries = zip.getEntries().filter((e) => e.entryName.startsWith('uploads/') && !e.isDirectory);
    if (uploadEntries.length) {
      const ud = uploadDir();
      fs.mkdirSync(ud, { recursive: true });
      for (const e of uploadEntries) {
        const base = path.basename(e.entryName);
        if (!base) continue;
        fs.writeFileSync(path.join(ud, base), e.getData());
        restoredFiles++;
      }
    }

    let manifest = null;
    const manEntry = zip.getEntry('manifest.json');
    if (manEntry) { try { manifest = JSON.parse(manEntry.getData().toString('utf8')); } catch { /* ignore */ } }

    await logAudit({
      userId: req.user.id, action: 'RESTORE_BACKUP', entityType: 'Backup', entityId: b.id,
      details: { fileName: b.fileName, restoredFiles, safetyCopy: path.basename(safety) }, req,
    });

    // Restart is required for the new DB file to be picked up reliably.
    return res.json({
      message: 'Restore completed. The server will restart to load the restored database.',
      restartRequired: true,
      restoredFiles,
      safetyCopy: path.basename(safety),
      manifest,
    });
  } catch (err) {
    console.error('restore failed', err);
    await logAudit({ userId: req.user.id, action: 'RESTORE_BACKUP_FAILED', entityType: 'Backup', entityId: b.id, details: { error: err.message }, req });
    return res.status(500).json({ message: `Restore failed: ${err.message}` });
  }
}
