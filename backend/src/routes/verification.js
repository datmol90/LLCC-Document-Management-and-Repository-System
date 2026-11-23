import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { verifyByCode, listVerificationLogs } from '../controllers/verificationController.js';

const router = Router();
// Public endpoint: reachable without a token so a scanned QR can be checked.
router.get('/verify/:code', verifyByCode);
// Privileged audit view of every scan.
router.get('/verification-logs', requireAuth, listVerificationLogs);
export default router;
