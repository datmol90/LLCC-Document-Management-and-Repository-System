import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAnalytics, exportPdf, exportExcel } from '../controllers/reportController.js';

const router = Router();
router.use(requireAuth);
router.get('/analytics', getAnalytics);
router.get('/export/pdf', exportPdf);
router.get('/export/excel', exportExcel);
export default router;
