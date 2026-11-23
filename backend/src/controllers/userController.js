import prisma from '../utils/prisma.js';
import { hashPassword } from '../utils/auth.js';
import { logAudit } from '../utils/audit.js';

const roles = ['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD', 'STAFF'];

export async function listUsers(req, res) {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { department: true },
  });
  res.json({ users: users.map(safe) });
}

export async function createUser(req, res) {
  const { name, email, password, role, departmentId, isActive } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: 'Name, email, password, and role are required' });
  if (!roles.includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  if (role !== 'SUPER_ADMIN' && role !== 'DEAN' && !departmentId) return res.status(400).json({ message: 'Department is required for this role' });
  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: String(email).toLowerCase().trim(),
        passwordHash: await hashPassword(password),
        role,
        departmentId: departmentId || null,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      include: { department: true },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE_USER', entityType: 'User', entityId: user.id, details: { email: user.email, role: user.role }, req });
    res.status(201).json({ user: safe(user) });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Email already exists' });
    throw e;
  }
}

export async function updateUser(req, res) {
  const { id } = req.params;
  const { name, email, password, role, departmentId, isActive } = req.body;
  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = String(email).toLowerCase().trim();
  if (role !== undefined) {
    if (!roles.includes(role)) return res.status(400).json({ message: 'Invalid role' });
    data.role = role;
  }
  if (departmentId !== undefined) data.departmentId = departmentId || null;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (password) {
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    data.passwordHash = await hashPassword(password);
  }
  try {
    const before = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
    const user = await prisma.user.update({ where: { id }, data, include: { department: true } });
    await logAudit({ userId: req.user.id, action: 'UPDATE_USER', entityType: 'User', entityId: user.id, details: { ...data, passwordHash: password ? '[updated]' : undefined }, req });
    if (before && ((data.role !== undefined && data.role !== before.role) || (data.isActive !== undefined && data.isActive !== before.isActive))) {
      await logAudit({
        userId: req.user.id, action: 'PERMISSION_CHANGE', entityType: 'User', entityId: user.id,
        details: {
          role: data.role !== undefined && data.role !== before.role ? { old: before.role, new: data.role } : undefined,
          isActive: data.isActive !== undefined && data.isActive !== before.isActive ? { old: before.isActive, new: data.isActive } : undefined,
        },
        req,
      });
    }
    res.json({ user: safe(user) });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    if (e.code === 'P2002') return res.status(409).json({ message: 'Email already exists' });
    throw e;
  }
}

function safe(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, departmentId: u.departmentId, department: u.department, isActive: u.isActive, createdAt: u.createdAt };
}
