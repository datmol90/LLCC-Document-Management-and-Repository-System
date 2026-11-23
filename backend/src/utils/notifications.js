import prisma from './prisma.js';

export async function createNotification({ userId, actorId, documentId, type, title, message }) {
  if (!userId) return null;
  return prisma.notification.create({
    data: { userId, actorId: actorId || null, documentId: documentId || null, type, title, message },
  });
}

export async function notifyUsers(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  await prisma.notification.createMany({
    data: unique.map((userId) => ({ ...payload, userId })),
  });
}
