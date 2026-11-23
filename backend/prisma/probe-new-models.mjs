// Temporary verification script: writes and reads one record of every new model,
// then removes all probe records. Run with: node prisma/probe-new-models.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, './dev.db').replace(/\\/g, '/');
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:./')) {
  process.env.DATABASE_URL = `file:${dbPath}`;
}
const prisma = new PrismaClient();

const marker = `__PROBE_${Date.now()}__`;

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const dept = await prisma.department.findFirst();
  if (!admin || !dept) throw new Error('Need an existing admin and department to probe');

  const role = await prisma.roleCatalog.create({ data: { name: `${marker}_ROLE`, level: 0, description: 'probe' } });
  const category = await prisma.documentCategory.create({ data: { name: `${marker}_CATEGORY`, description: 'probe', isActive: true } });
  const doc = await prisma.document.create({
    data: {
      title: `${marker}_DOC`, category: category.name, categoryId: category.id,
      departmentId: dept.id, uploaderId: admin.id, status: 'FINAL_REVIEW',
      referenceNumber: `${marker}-REF`, documentType: 'PROBE', keywords: 'probe,verification',
      reviewDate: new Date(), renewalStatus: 'RENEWAL_DUE', requiresFinalApproval: true,
    },
  });
  const approval = await prisma.approval.create({
    data: { documentId: doc.id, status: 'STAGE1_APPROVED', submittedById: admin.id },
  });
  const archived = await prisma.archivedDocument.create({
    data: { documentId: doc.id, archivedById: admin.id, reason: 'probe' },
  });
  const deleted = await prisma.deletedDocument.create({
    data: { documentId: doc.id, deletedById: admin.id, reason: 'probe' },
  });
  const reset = await prisma.passwordResetToken.create({
    data: { userId: admin.id, tokenHash: `${marker}_HASH`, expiresAt: new Date(Date.now() + 3600000) },
  });
  const revoked = await prisma.revokedToken.create({
    data: { id: `${marker}_JTI`, userId: admin.id, expiresAt: new Date(Date.now() + 3600000) },
  });
  const announcement = await prisma.announcement.create({
    data: { title: `${marker}_ANNOUNCEMENT`, body: 'probe', createdById: admin.id, pinned: true },
  });
  const setting = await prisma.setting.create({ data: { key: `${marker}_SETTING`, value: '"probe"' } });

  const checks = [
    ['RoleCatalog', (await prisma.roleCatalog.findUnique({ where: { id: role.id } }))?.name === role.name],
    ['DocumentCategory', (await prisma.documentCategory.findUnique({ where: { id: category.id } }))?.name === category.name],
    ['Document new fields', (await prisma.document.findUnique({ where: { id: doc.id } }))?.referenceNumber === `${marker}-REF`],
    ['ApprovalStatus.STAGE1_APPROVED', approval.status === 'STAGE1_APPROVED'],
    ['DocumentStatus.FINAL_REVIEW', doc.status === 'FINAL_REVIEW'],
    ['ArchivedDocument', (await prisma.archivedDocument.findUnique({ where: { id: archived.id } }))?.documentId === doc.id],
    ['DeletedDocument', (await prisma.deletedDocument.findUnique({ where: { id: deleted.id } }))?.documentId === doc.id],
    ['PasswordResetToken', (await prisma.passwordResetToken.findUnique({ where: { id: reset.id } }))?.tokenHash === `${marker}_HASH`],
    ['RevokedToken', (await prisma.revokedToken.findUnique({ where: { id: revoked.id } }))?.id === revoked.id],
    ['Announcement', (await prisma.announcement.findUnique({ where: { id: announcement.id } }))?.title === announcement.title],
    ['Setting', (await prisma.setting.findUnique({ where: { key: setting.key } }))?.value === '"probe"'],
  ];
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) process.exitCode = 1;
  }

  // Cleanup every probe row (no existing data is touched).
  await prisma.approval.deleteMany({ where: { documentId: doc.id } });
  await prisma.archivedDocument.deleteMany({ where: { id: archived.id } });
  await prisma.deletedDocument.deleteMany({ where: { id: deleted.id } });
  await prisma.passwordResetToken.deleteMany({ where: { id: reset.id } });
  await prisma.revokedToken.deleteMany({ where: { id: revoked.id } });
  await prisma.announcement.deleteMany({ where: { id: announcement.id } });
  await prisma.setting.deleteMany({ where: { key: setting.key } });
  await prisma.document.deleteMany({ where: { id: doc.id } });
  await prisma.documentCategory.deleteMany({ where: { id: category.id } });
  await prisma.roleCatalog.deleteMany({ where: { id: role.id } });
  console.log('Probe records cleaned up.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
