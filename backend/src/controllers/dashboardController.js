import prisma from '../utils/prisma.js';

export async function getDashboard(req, res) {
  const user = req.user;
  const isAdminOrDean = ['SUPER_ADMIN', 'DEAN'].includes(user.role);
  const deptFilter = isAdminOrDean ? {} : { departmentId: user.departmentId || '__none__' };
  const docScope = isAdminOrDean ? {} : (user.role === 'STAFF'
    ? { departmentId: user.departmentId || '__none__', OR: [{ status: 'APPROVED' }, { uploaderId: user.id }] }
    : { departmentId: user.departmentId || '__none__' });
  // Recycle-bin entries never appear anywhere on the dashboard.
  const activeScope = { ...docScope, deletedAt: null };
  const activeDeptFilter = { ...deptFilter, deletedAt: null };

  const [totalDocuments, totalDepartments, totalUsers, pendingApprovals, byStatus, byDepartment,
    recentUploads, recentUpdates, recentActivity] = await Promise.all([
    prisma.document.count({ where: activeScope }),
    isAdminOrDean ? prisma.department.count() : prisma.department.count({ where: { id: user.departmentId || '__none__' } }),
    isAdminOrDean ? prisma.user.count() : prisma.user.count({ where: { departmentId: user.departmentId || '__none__' } }),
    prisma.document.count({ where: { ...activeDeptFilter, status: 'PENDING' } }),
    prisma.document.groupBy({ by: ['status'], where: activeScope, _count: true }),
    prisma.document.groupBy({ by: ['departmentId'], where: activeScope, _count: true }),
    prisma.document.findMany({ where: activeScope, orderBy: { createdAt: 'desc' }, take: 5, include: { department: true, uploader: { select: { id: true, name: true } } } }),
    prisma.document.findMany({ where: activeScope, orderBy: { updatedAt: 'desc' }, take: 5, include: { department: true, uploader: { select: { id: true, name: true } } } }),
    prisma.auditLog.findMany({
      where: isAdminOrDean
        ? { OR: [{ document: null }, { document: { deletedAt: null } }] }
        : { OR: [{ userId: user.id }, { document: { departmentId: user.departmentId || '__none__', deletedAt: null } }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { id: true, name: true, email: true } }, document: { select: { id: true, title: true } } },
    }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
  const deptNames = await prisma.department.findMany({ select: { id: true, name: true } });
  const departmentStats = byDepartment.map((r) => ({
    departmentId: r.departmentId,
    department: deptNames.find((d) => d.id === r.departmentId)?.name || 'Unknown',
    count: r._count,
  })).sort((a, b) => b.count - a.count);

  res.json({
    stats: {
      totalDocuments, totalDepartments, totalUsers, pendingApprovals,
      approved: statusMap.APPROVED || 0,
      rejected: statusMap.REJECTED || 0,
      archived: statusMap.ARCHIVED || 0,
      draft: statusMap.DRAFT || 0,
    },
    departmentStats,
    recentUploads,
    recentUpdates,
    recentActivity,
  });
}
