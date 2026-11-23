import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listAuditLogs } from '../controllers/auditController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listAuditLogs);
export default router;
