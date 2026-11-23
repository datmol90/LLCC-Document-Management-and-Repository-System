import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createBackup, listBackups, downloadBackup, deleteBackup, restoreBackup } from '../controllers/backupController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listBackups);
router.post('/', createBackup);
router.get('/:id/download', downloadBackup);
router.post('/:id/restore', restoreBackup);
router.delete('/:id', deleteBackup);
export default router;
