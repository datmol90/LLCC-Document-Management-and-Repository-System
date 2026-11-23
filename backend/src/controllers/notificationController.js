import prisma from '../utils/prisma.js';

export async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { id: true, name: true } }, document: { select: { id: true, title: true } } },
  });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  res.json({ notifications, unreadCount });
}

export async function markRead(req, res) {
  const { id } = req.params;
  await prisma.notification.updateMany({ where: { id, userId: req.user.id }, data: { isRead: true } });
  res.json({ message: 'Marked as read' });
}

export async function markAllRead(req, res) {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  res.json({ message: 'All marked as read' });
}
