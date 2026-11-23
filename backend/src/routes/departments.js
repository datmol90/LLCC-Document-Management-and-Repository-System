import { Router } from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import { listDepartments, createDepartment, updateDepartment } from '../controllers/departmentController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listDepartments);
router.post('/', authorize('SUPER_ADMIN'), createDepartment);
router.put('/:id', authorize('SUPER_ADMIN'), updateDepartment);
export default router;
