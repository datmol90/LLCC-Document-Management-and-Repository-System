import prisma from './prisma.js';

export async function logAudit({ userId, action, entityType, entityId, documentId, details, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entityType,
        entityId: entityId || null,
        documentId: documentId || null,
        details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
      },
    });
  } catch (err) {
    console.error('Audit log failed', err.message);
  }
}
