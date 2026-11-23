import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import {
  listDocuments, getDocument, createDocument, updateDocument, deleteDocument,
  restoreDocument, purgeDocument, downloadDocument, restoreVersion,
  archiveDocument, unarchiveDocument,
} from '../controllers/documentController.js';
import { submitForApproval, actOnApproval, listPendingApprovals } from '../controllers/approvalController.js';
import { previewDocument } from '../controllers/previewController.js';
import { getQr, getVerification } from '../controllers/verificationController.js';
import { listExpiring, triggerScan } from '../utils/expirationScheduler.js';

const router = Router();
router.use(requireAuth);

router.get('/', listDocuments);
router.get('/approvals/pending', listPendingApprovals);
router.get('/expiring', listExpiring);
router.post('/run-expiration-scan', triggerScan);

router.get('/:id', getDocument);
router.post('/', upload.single('file'), createDocument);
router.put('/:id', upload.single('file'), updateDocument);
router.delete('/:id', deleteDocument);
router.post('/:id/restore', restoreDocument);
router.post('/:id/archive', archiveDocument);
router.post('/:id/unarchive', unarchiveDocument);
router.delete('/:id/purge', purgeDocument);
router.get('/:id/download', downloadDocument);
router.get('/:id/preview', previewDocument);
router.get('/:id/qr', getQr);
router.get('/:id/verification', getVerification);
router.post('/:id/versions/:versionId/restore', restoreVersion);
router.post('/:id/submit', submitForApproval);
router.post('/:id/approval', actOnApproval);

export default router;
