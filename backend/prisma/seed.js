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

const prisma = new PrismaClient;

// **EXACTLY THREE ACADEMIC COLLEGES** (per official LLCC organizational structure)
const colleges = [
  { name: 'College of Education', code: 'CED', description: 'Teacher education and programs' },
  { name: 'College of Technology', code: 'CT', description: 'Technology and industrial programs' },
  { name: 'College of Hospitality and Tourism Management', code: 'CHTM', description: 'Hospitality and tourism management programs' },
];

// **SUPPORT OFFICES** (separate from academic colleges - configurable)
const supportOffices = [
  { name: 'Office of the College Administrator', code: 'ADMIN', description: 'College-wide administrative oversight' },
  { name: "Registrar's Office", code: 'REG', description: 'Registration and student records' },
  { name: 'Student Affairs and Services Office (SASO)', code: 'SASO', description: 'Student services and organizations' },
  { name: 'Library Services', code: 'LIB', description: 'Library and academic resources' },
  { name: 'Administrative Services', code: 'ADM', description: 'General administration and facilities' },
  { name: 'Finance and Accounting', code: 'FIN', description: 'Finance and accounting services' },
  { name: 'Human Resources', code: 'HR', description: 'Human resources management' },
  { name: 'Information Technology Services', code: 'IT', description: 'IT infrastructure and support' },
  { name: 'Records Management', code: 'RM', description: 'Records and documentation' },
  { name: 'Quality Assurance', code: 'QA', description: 'Quality assurance and research' },
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
  // **Upload the exact 3 colleges first** - create them as new records
  for (const c of colleges) {
    await prisma.department.upsert({ where: { code: c.code }, update: { name: c.name, description: c.description, isActive: true }, create: c });
  }

  // **Upload support offices** - separate from academic colleges
  for (const s of supportOffices) {
    await prisma.department.upsert({ where: { code: s.code }, update: { name: s.name, description: s.description, isActive: true }, create: s });
  }

  // **MIGRATE EXISTING DEPARTMENTS** - map old department codes to new college/support codes
  // Now that colleges and support offices exist, remap old department records
  // and update all foreign keys (documents, users) to point to the new departments
  const legacyDepartmentMap = [
    { from: 'EDUC', to: 'CED' },   // Education -> College of Education
    { from: 'BA', to: 'CT' },      // Business Administration -> College of Technology
    { from: 'IT', to: 'CT' },      // Information Technology -> College of Technology
  ];

  for (const legacy of legacyDepartmentMap) {
    const source = await prisma.department.findUnique({ where: { code: legacy.from } });
    const target = await prisma.department.findUnique({ where: { code: legacy.to } });
    if (source && target && source.id !== target.id) {
      // Remap all documents from source department to target department
      await prisma.document.updateMany({
        where: { departmentId: source.id },
        data: { departmentId: target.id }
      });
      // Remap all users from source department to target department
      await prisma.user.updateMany({
        where: { departmentId: source.id },
        data: { departmentId: target.id }
      });
      // Mark the old department as inactive instead of reassigning its code
      await prisma.department.update({ where: { id: source.id }, data: { isActive: false } });
      console.log(`Remapped legacy department ${legacy.from} -> ${legacy.to} (documents and users preserved).`);
    }
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
    const it = await prisma.department.findUnique({ where: { code: 'CT' } });
    const demoHash = await bcrypt.hash('Demo@12345', 10);
    const demoUsers = [
      { name: 'Demo Dean', email: 'dean@llcc.edu', role: 'DEAN', departmentId: null },
      { name: 'Demo IT Head', email: 'head.ct@llcc.edu', role: 'DEPARTMENT_HEAD', departmentId: it?.id || null },
      { name: 'Demo IT Staff', email: 'staff.ct@llcc.edu', role: 'STAFF', departmentId: it?.id || null },
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