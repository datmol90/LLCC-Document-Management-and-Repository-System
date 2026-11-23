import { Router } from 'express';
import { login, me, logout, getProfile, updateProfile, forgotPassword, resetPassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/login', login);
router.post('/forgot', forgotPassword);
router.post('/reset', resetPassword);
router.get('/me', requireAuth, me);
router.get('/profile', requireAuth, getProfile);
router.put('/profile', requireAuth, updateProfile);
router.post('/logout', requireAuth, logout);
export default router;
