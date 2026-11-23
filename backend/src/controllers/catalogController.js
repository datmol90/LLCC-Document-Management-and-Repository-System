import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notifications.js';
import { getSettings, setSettings, SETTING_RULES } from '../utils/settings.js';

const isAdmin = (user) => user.role === 'SUPER_ADMIN';
const canManageAnnouncements = (user) => ['SUPER_ADMIN', 'DEAN'].includes(user.role);

/* --------------------------- Categories --------------------------- */

export async function listCategories(req, res) {
  const categories = await prisma.documentCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json({ categories });
}

export async function createCategory(req, res) {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Only administrators can manage categories' });
  const { name, description, isActive } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ message: 'Category name is required' });
  try {
    const category = await prisma.documentCategory.create({
      data: { name: String(name).trim(), description: description?.trim() || null, isActive: isActive === undefined ? true : Boolean(isActive) },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE_CATEGORY', entityType: 'DocumentCategory', entityId: category.id, details: { name: category.name }, req });
    res.status(201).json({ category });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Category name already exists' });
    throw e;
  }
}

export async function updateCategory(req, res) {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Only administrators can manage categories' });
  const { name, description, isActive } = req.body || {};
  const data = {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ message: 'Category name cannot be empty' });
    data.name = String(name).trim();
  }
  if (description !== undefined) data.description = description?.trim() || null;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  try {
    const category = await prisma.documentCategory.update({ where: { id: req.params.id }, data });
    await logAudit({ userId: req.user.id, action: 'UPDATE_CATEGORY', entityType: 'DocumentCategory', entityId: category.id, details: data, req });
    res.json({ category });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Category not found' });
    if (e.code === 'P2002') return res.status(409).json({ message: 'Category name already exists' });
    throw e;
  }
}

/** DELETE = deactivate; catalog history is preserved. */
export async function deleteCategory(req, res) {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Only administrators can manage categories' });
  try {
    const category = await prisma.documentCategory.update({ where: { id: req.params.id }, data: { isActive: false } });
    await logAudit({ userId: req.user.id, action: 'DELETE_CATEGORY', entityType: 'DocumentCategory', entityId: category.id, details: { name: category.name, mode: 'deactivate' }, req });
    res.json({ message: 'Category deactivated', category });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Category not found' });
    throw e;
  }
}

/* ------------------------------ Roles ------------------------------ */

export async function listRoles(req, res) {
  const roles = await prisma.roleCatalog.findMany({ orderBy: [{ level: 'desc' }, { name: 'asc' }] });
  res.json({ roles });
}

/* ---------------------------- Settings ----------------------------- */

export async function getSettingsHandler(req, res) {
  res.json({ settings: await getSettings() });
}

export async function putSettings(req, res) {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Only administrators can change settings' });
  const input = req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)
    ? req.body.settings
    : req.body || {};
  const keys = Object.keys(input);
  if (!keys.length) return res.status(400).json({ message: 'No settings supplied' });
  for (const key of keys) {
    const rule = SETTING_RULES[key];
    if (!rule) return res.status(400).json({ message: `Unknown setting: ${key}` });
    if (!rule.validate(input[key])) return res.status(400).json({ message: rule.message });
  }
  const settings = await setSettings(input);
  await logAudit({ userId: req.user.id, action: 'UPDATE_SETTINGS', entityType: 'Setting', details: { keys }, req });
  res.json({ settings });
}

/* -------------------------- Announcements -------------------------- */

const announcementInclude = { createdBy: { select: { id: true, name: true, email: true } } };

export async function listAnnouncements(req, res) {
  const announcements = await prisma.announcement.findMany({
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    include: announcementInclude,
  });
  res.json({ announcements });
}

export async function createAnnouncement(req, res) {
  if (!canManageAnnouncements(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
  const { title, body, pinned } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ message: 'Announcement title is required' });
  if (!body || !String(body).trim()) return res.status(400).json({ message: 'Announcement body is required' });
  const announcement = await prisma.announcement.create({
    data: { title: String(title).trim(), body: String(body).trim(), pinned: Boolean(pinned), createdById: req.user.id },
    include: announcementInclude,
  });
  const activeUsers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  await notifyUsers(activeUsers.map((u) => u.id), {
    actorId: req.user.id, type: 'SYSTEM', title: announcement.title,
    message: announcement.body.length > 300 ? `${announcement.body.slice(0, 300)}…` : announcement.body,
  });
  await logAudit({ userId: req.user.id, action: 'CREATE_ANNOUNCEMENT', entityType: 'Announcement', entityId: announcement.id, details: { title: announcement.title, notified: activeUsers.length }, req });
  res.status(201).json({ announcement });
}

export async function updateAnnouncement(req, res) {
  if (!canManageAnnouncements(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
  const { title, body, pinned } = req.body || {};
  const data = {};
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ message: 'Announcement title cannot be empty' });
    data.title = String(title).trim();
  }
  if (body !== undefined) {
    if (!String(body).trim()) return res.status(400).json({ message: 'Announcement body cannot be empty' });
    data.body = String(body).trim();
  }
  if (pinned !== undefined) data.pinned = Boolean(pinned);
  try {
    const announcement = await prisma.announcement.update({ where: { id: req.params.id }, data, include: announcementInclude });
    await logAudit({ userId: req.user.id, action: 'UPDATE_ANNOUNCEMENT', entityType: 'Announcement', entityId: announcement.id, details: data, req });
    res.json({ announcement });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Announcement not found' });
    throw e;
  }
}

export async function deleteAnnouncement(req, res) {
  if (!canManageAnnouncements(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    await logAudit({ userId: req.user.id, action: 'DELETE_ANNOUNCEMENT', entityType: 'Announcement', entityId: req.params.id, req });
    res.json({ message: 'Announcement deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Announcement not found' });
    throw e;
  }
}
