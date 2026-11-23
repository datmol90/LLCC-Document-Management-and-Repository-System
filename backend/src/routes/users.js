import { Router } from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import { listUsers, createUser, updateUser } from '../controllers/userController.js';

const router = Router();
router.use(requireAuth, authorize('SUPER_ADMIN'));
router.get('/', listUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
export default router;
