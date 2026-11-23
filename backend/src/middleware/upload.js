import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { getSetting } from '../utils/settings.js';

const MB = 1024 * 1024;
const DEFAULT_MAX_MB = Number(process.env.MAX_FILE_SIZE_MB || 20);

const allowed = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const allowedExt = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp']);

const uploadDir = process.env.UPLOAD_DIR || './uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uuid()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.has(file.mimetype) || allowedExt.has(ext)) return cb(null, true);
  cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, images.'));
}

/** First bytes that unambiguously mark a native executable. */
function looksExecutable(buf) {
  if (!buf || buf.length < 2) return false;
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true; // MZ (PE/DOS)
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true; // ELF
  return buf[0] === 0x23 && buf[1] === 0x21; // shebang (#!)
}

function makeMulter(maxBytes) {
  return multer({ storage, fileFilter, limits: { fileSize: maxBytes } });
}

/**
 * Drop-in replacement for multer's `upload.single(field)` that reads the
 * maxFileSizeMB setting per request and sniffs uploaded content for executables.
 */
export const upload = {
  single: (field) => async (req, res, next) => {
    let maxMB = DEFAULT_MAX_MB;
    try {
      const configured = Number(await getSetting('maxFileSizeMB', DEFAULT_MAX_MB));
      if (Number.isFinite(configured) && configured >= 1 && configured <= 1000) maxMB = configured;
    } catch { /* use default if settings are unavailable */ }
    const maxBytes = maxMB * MB;

    makeMulter(maxBytes).single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: `File too large (max ${maxMB}MB)` });
        return next(err);
      }
      if (req.file?.path) {
        try {
          const fd = fs.openSync(req.file.path, 'r');
          const head = Buffer.alloc(8);
          const read = fs.readSync(fd, head, 0, 8, 0);
          fs.closeSync(fd);
          if (looksExecutable(read ? head : null)) {
            fs.promises.unlink(req.file.path).catch(() => {});
            req.file = undefined;
            return res.status(400).json({ message: 'Executable files are not allowed' });
          }
        } catch { /* content check is best-effort; type/extension still enforced */ }
      }
      next();
    });
  },
};
