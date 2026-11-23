-- Extended functionality: catalogs, metadata, archive/delete history,
-- auth support tables, announcements, settings and backup verification.

-- AlterTable: Document metadata
ALTER TABLE "Document" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Document" ADD COLUMN "referenceNumber" TEXT;
ALTER TABLE "Document" ADD COLUMN "documentType" TEXT;
ALTER TABLE "Document" ADD COLUMN "keywords" TEXT;
ALTER TABLE "Document" ADD COLUMN "reviewDate" DATETIME;
ALTER TABLE "Document" ADD COLUMN "renewalStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Document" ADD COLUMN "requiresFinalApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: backup verification
ALTER TABLE "Backup" ADD COLUMN "checksum" TEXT;
ALTER TABLE "Backup" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "DocumentCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ArchivedDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "archivedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME,
    "restoredById" TEXT,
    CONSTRAINT "ArchivedDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ArchivedDocument_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArchivedDocument_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeletedDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "deletedById" TEXT NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "restoredAt" DATETIME,
    "restoredById" TEXT,
    CONSTRAINT "DeletedDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeletedDocument_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeletedDocument_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RevokedToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCategory_name_key" ON "DocumentCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_referenceNumber_key" ON "Document"("referenceNumber");

-- CreateIndex
CREATE INDEX "Document_categoryId_idx" ON "Document"("categoryId");

-- CreateIndex
CREATE INDEX "Document_documentType_idx" ON "Document"("documentType");

-- CreateIndex
CREATE INDEX "Document_renewalStatus_idx" ON "Document"("renewalStatus");

-- CreateIndex
CREATE INDEX "ArchivedDocument_documentId_idx" ON "ArchivedDocument"("documentId");

-- CreateIndex
CREATE INDEX "ArchivedDocument_archivedById_idx" ON "ArchivedDocument"("archivedById");

-- CreateIndex
CREATE INDEX "ArchivedDocument_createdAt_idx" ON "ArchivedDocument"("createdAt");

-- CreateIndex
CREATE INDEX "DeletedDocument_documentId_idx" ON "DeletedDocument"("documentId");

-- CreateIndex
CREATE INDEX "DeletedDocument_deletedById_idx" ON "DeletedDocument"("deletedById");

-- CreateIndex
CREATE INDEX "DeletedDocument_deletedAt_idx" ON "DeletedDocument"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "RevokedToken_userId_idx" ON "RevokedToken"("userId");

-- CreateIndex
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Announcement_pinned_idx" ON "Announcement"("pinned");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_documentId_idx" ON "AuditLog"("documentId");

-- CreateIndex
CREATE INDEX "VerificationLog_result_idx" ON "VerificationLog"("result");

-- Seed catalog rows (idempotent)
INSERT OR IGNORE INTO "Role" ("id", "name", "level", "description") VALUES
  ('role-super-admin', 'SUPER_ADMIN', 4, 'Full system access'),
  ('role-dean', 'DEAN', 3, 'College-wide oversight and final approval'),
  ('role-department-head', 'DEPARTMENT_HEAD', 2, 'Department-level management and stage 1 approval'),
  ('role-staff', 'STAFF', 1, 'Department staff');

INSERT OR IGNORE INTO "DocumentCategory" ("id", "name", "description", "isActive") VALUES
  ('cat-policy', 'Policy', 'Official policies', 1),
  ('cat-handbook', 'Handbook', 'Handbooks and guides', 1),
  ('cat-form', 'Form', 'Official forms', 1),
  ('cat-memo', 'Memo', 'Memoranda', 1),
  ('cat-report', 'Report', 'Reports and summaries', 1),
  ('cat-financial', 'Financial', 'Financial records', 1),
  ('cat-academic', 'Academic', 'Academic records', 1),
  ('cat-hr', 'HR', 'Human resources records', 1),
  ('cat-enrollment', 'Enrollment', 'Enrollment records', 1);
