import prisma from '../utils/prisma.js';

export async function listAuditLogs(req, res) {
  const user = req.user;
  const { page = '1', limit = '20', action, entityType, from, to, userId } = req.query;
  const where = {};
  if (action) where.action = { contains: String(action) };
  if (entityType) where.entityType = String(entityType);
  if (userId) where.userId = String(userId);
  if (from || to) {
    where.createdAt = {};
    if (from) {
      const d = new Date(String(from));
      if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
    }
    if (to) {
      const d = new Date(String(to));
      if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
    }
  }
  if (!['SUPER_ADMIN', 'DEAN'].includes(user.role)) {
    where.OR = [{ userId: user.id }, { document: { departmentId: user.departmentId || '__none__' } }];
  }
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * l, take: l,
      include: { user: { select: { id: true, name: true, email: true, role: true } }, document: { select: { id: true, title: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ logs, total, page: p, limit: l, pages: Math.ceil(total / l) });
}
