import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listCategories, createCategory, updateCategory, deleteCategory, listRoles,
  getSettingsHandler, putSettings,
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
} from '../controllers/catalogController.js';

const router = Router();
router.use(requireAuth);

router.get('/categories', listCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

router.get('/roles', listRoles);

router.get('/settings', getSettingsHandler);
router.put('/settings', putSettings);

router.get('/announcements', listAnnouncements);
router.post('/announcements', createAnnouncement);
router.put('/announcements/:id', updateAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);

export default router;
