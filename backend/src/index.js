import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import departmentRoutes from './routes/departments.js';
import documentRoutes from './routes/documents.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import reportRoutes from './routes/reports.js';
import verificationRoutes from './routes/verification.js';
import assistantRoutes from './routes/assistant.js';
import backupRoutes from './routes/backups.js';
import catalogRoutes from './routes/catalog.js';
import { startExpirationScheduler } from './utils/expirationScheduler.js';
import { runScheduledBackup } from './controllers/backupController.js';
import { getSettings } from './utils/settings.js';

const app = express();
const PORT = process.env.PORT || 5000;
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// NOTE: no CSP/frame-ancestors restriction so office previews can render inline.
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', verificationRoutes);        // /api/verify/:code (public) + /api/verification-logs
app.use('/api/assistant', assistantRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api', catalogRoutes);         // /api/categories, /api/roles, /api/settings, /api/announcements

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.message?.includes('Unsupported file type')) return res.status(400).json({ message: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File too large (max 20MB)' });
  res.status(500).json({ message: 'Internal server error', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

app.listen(PORT, async () => {
  console.log(`LLCC DMS backend running on http://localhost:${PORT}`);
  startExpirationScheduler();

  // Settings-backed scheduled backups (disabled by default).
  try {
    const settings = await getSettings();
    const hours = Number(settings.backupIntervalHours) || 24;
    const timer = setInterval(() => {
      runScheduledBackup().catch((e) => console.error('[backup] scheduled run failed', e.message));
    }, Math.max(1, hours) * 3600000);
    timer.unref?.();
    console.log(`[backup] scheduler ready (every ${hours}h, enabled=${settings.backupEnabled})`);
  } catch (e) {
    console.error('[backup] scheduler setup failed', e.message);
  }
});
