import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, './dev.db').replace(/\\/g, '/');
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:./')) {
  process.env.DATABASE_URL = `file:${dbPath}`;
}

const prisma = new PrismaClient();

const departments = [
  { name: 'College Administration', code: 'ADMIN', description: 'College-wide administration' },
  { name: 'Information Technology', code: 'IT', description: 'Information technology programs and services' },
  { name: 'Education', code: 'EDUC', description: 'Teacher education programs' },
  { name: 'Business Administration', code: 'BA', description: 'Business and management programs' },
  { name: 'Registrar', code: 'REG', description: 'Registration and student records' },
  { name: 'Finance', code: 'FIN', description: 'Finance and accounting' },
  { name: 'Human Resources', code: 'HR', description: 'Human resources' },
];

// Existing installations seeded with the original three colleges are migrated
// in place so documents and users keep their department references.
const legacyDepartmentMap = [
  { from: 'CCS', to: 'IT' },
  { from: 'CBA', to: 'BA' },
  { from: 'COE', to: 'EDUC' },
];

const roles = [
  { name: 'SUPER_ADMIN', level: 4, description: 'Full system access' },
  { name: 'DEAN', level: 3, description: 'College-wide oversight and final approval' },
  { name: 'DEPARTMENT_HEAD', level: 2, description: 'Department management and stage 1 approval' },
  { name: 'STAFF', level: 1, description: 'Department staff' },
];

const categories = [
  { name: 'Policy', description: 'Official policies' },
  { name: 'Handbook', description: 'Handbooks and guides' },
  { name: 'Form', description: 'Official forms' },
  { name: 'Memo', description: 'Memoranda' },
  { name: 'Report', description: 'Reports and summaries' },
  { name: 'Financial', description: 'Financial records' },
  { name: 'Academic', description: 'Academic records' },
  { name: 'HR', description: 'Human resources records' },
  { name: 'Enrollment', description: 'Enrollment records' },
];

async function main() {
  for (const legacy of legacyDepartmentMap) {
    const source = await prisma.department.findUnique({ where: { code: legacy.from } });
    const target = await prisma.department.findUnique({ where: { code: legacy.to } });
    if (source && !target) {
      const definition = departments.find((d) => d.code === legacy.to);
      await prisma.department.update({ where: { id: source.id }, data: definition });
      console.log(`Migrated legacy department ${legacy.from} -> ${legacy.to} (records preserved).`);
    }
  }
  for (const d of departments) {
    await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name, description: d.description, isActive: true }, create: d });
  }
  for (const r of roles) {
    await prisma.roleCatalog.upsert({ where: { name: r.name }, update: { level: r.level, description: r.description }, create: r });
  }
  for (const c of categories) {
    await prisma.documentCategory.upsert({ where: { name: c.name }, update: { description: c.description, isActive: true }, create: c });
  }

  const adminDept = await prisma.department.findUnique({ where: { code: 'ADMIN' } });
  const adminHash = await bcrypt.hash('Admin@12345', 10);
  await prisma.user.upsert({
    where: { email: 'admin@llcc.edu' },
    update: { name: 'System Administrator', role: 'SUPER_ADMIN' },
    create: {
      name: 'System Administrator',
      email: 'admin@llcc.edu',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      departmentId: adminDept?.id || null,
    },
  });
  console.log('Bootstrap super admin: admin@llcc.edu / Admin@12345 (change this password after first login).');

  if (process.env.DEMO_SEED === 'true') {
    const it = await prisma.department.findUnique({ where: { code: 'IT' } });
    const demoHash = await bcrypt.hash('Demo@12345', 10);
    const demoUsers = [
      { name: 'Demo Dean', email: 'dean@llcc.edu', role: 'DEAN', departmentId: null },
      { name: 'Demo IT Head', email: 'head.it@llcc.edu', role: 'DEPARTMENT_HEAD', departmentId: it?.id || null },
      { name: 'Demo IT Staff', email: 'staff.it@llcc.edu', role: 'STAFF', departmentId: it?.id || null },
    ];
    for (const u of demoUsers) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, departmentId: u.departmentId, isActive: true },
        create: { ...u, passwordHash: demoHash },
      });
    }
    console.log('Demo users created (password Demo@12345). No demo documents are seeded.');
  }

  console.log('Seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
