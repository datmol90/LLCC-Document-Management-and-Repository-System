import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve SQLite path consistently regardless of process CWD.
const dbPath = path.resolve(__dirname, '../../prisma/dev.db').replace(/\\/g, '/');
const envUrl = process.env.DATABASE_URL;
if (!envUrl || envUrl === 'file:./dev.db' || envUrl === 'file:./prisma/dev.db') {
  process.env.DATABASE_URL = `file:${dbPath}`;
}

const prisma = new PrismaClient();

export default prisma;
