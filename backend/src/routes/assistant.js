import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { askAssistant } from '../controllers/assistantController.js';

const router = Router();
router.use(requireAuth);
router.post('/ask', askAssistant);
export default router;
