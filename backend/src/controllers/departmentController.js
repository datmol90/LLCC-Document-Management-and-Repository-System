import prisma from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';

export async function listDepartments(req, res) {
  const includeInactive = req.user.role === 'SUPER_ADMIN' && req.query.includeInactive === 'true';
  const where = includeInactive ? {} : { isActive: true };
  const departments = await prisma.department.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true, documents: true } } },
  });
  res.json({ departments });
}

export async function createDepartment(req, res) {
  const { name, code, description } = req.body;
  if (!name || !code) return res.status(400).json({ message: 'Name and code are required' });
  try {
    const dept = await prisma.department.create({ data: { name: name.trim(), code: code.trim().toUpperCase(), description: description?.trim() || null } });
    await logAudit({ userId: req.user.id, action: 'CREATE_DEPARTMENT', entityType: 'Department', entityId: dept.id, details: { name: dept.name }, req });
    res.status(201).json({ department: dept });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Department name or code already exists' });
    throw e;
  }
}

export async function updateDepartment(req, res) {
  const { id } = req.params;
  const { name, code, description, isActive } = req.body;
  try {
    const before = await prisma.department.findUnique({ where: { id }, select: { isActive: true } });
    const dept = await prisma.department.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(code !== undefined ? { code: code.trim().toUpperCase() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });
    await logAudit({ userId: req.user.id, action: 'UPDATE_DEPARTMENT', entityType: 'Department', entityId: dept.id, details: req.body, req });
    if (before?.isActive === true && dept.isActive === false) {
      // Explicit audit for deactivation; no records are deleted or cascaded.
      await logAudit({ userId: req.user.id, action: 'DEACTIVATE_DEPARTMENT', entityType: 'Department', entityId: dept.id, details: { name: dept.name, code: dept.code }, req });
    }
    res.json({ department: dept });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Department not found' });
    if (e.code === 'P2002') return res.status(409).json({ message: 'Department name or code already exists' });
    throw e;
  }
}
