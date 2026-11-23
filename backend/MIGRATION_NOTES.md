# LLCC DMS backend migration notes

## Applied migration

- Migration: **`20261121180000_extended_functionality`** (applied to `prisma/dev.db` with `npx prisma migrate deploy`).
- Prisma client regenerated with `npx prisma generate`.
- The migration adds the catalogs (`Role`, `DocumentCategory`), metadata-only `ArchivedDocument` / `DeletedDocument` history tables (nullable `documentId`, `ON DELETE SET NULL`), auth support tables (`PasswordResetToken`, `RevokedToken`), `Announcement`, `Setting`, new Document metadata columns, `Backup.checksum` / `Backup.verified`, new enum values (`FINAL_REVIEW`, `STAGE1_APPROVED`), supporting indexes, and idempotent catalog seed rows (`INSERT OR IGNORE`).
- Existing tables, columns, indexes, endpoints and response shapes are preserved.

## New endpoints

### Auth (`/api/auth`)
- `GET /profile` — profile projection.
- `PUT /profile` — name/email/password change (logs `UPDATE_PROFILE`).
- `POST /forgot` — hashed reset token (1h expiry); dev response/logging is gated by `NODE_ENV` / `RESET_TOKEN_IN_RESPONSE`.
- `POST /reset` — token consumption + password change (logs `PASSWORD_RESET`).
- `POST /logout` — now also revokes the token's `jti` in `RevokedToken`.

### Catalog (`/api`, mounted at app level)
- `GET /categories` (auth); `POST /categories`, `PUT /categories/:id`, `DELETE /categories/:id` (SUPER_ADMIN; DELETE deactivates).
- `GET /roles` (auth).
- `GET /settings` (auth); `PUT /settings` (SUPER_ADMIN, validated partial update).
- `GET /announcements` (auth, pinned-first latest 50); `POST /announcements`, `PUT /announcements/:id`, `DELETE /announcements/:id` (SUPER_ADMIN / DEAN; POST also raises `SYSTEM` notifications).

### Documents (`/api/documents`)
- `POST /:id/archive`, `POST /:id/unarchive`.
- Existing endpoints gained: metadata fields (`referenceNumber`, `documentType`, `keywords`, `categoryId`, `reviewDate`, `renewalStatus`, `requiresFinalApproval`), new list filters (`referenceNumber`, `documentType`, `keywords`, `fileType`, `modifiedFrom`, `modifiedTo`, `approvalStatus`, `sort`), archive/delete history records and audit entries.

### Existing endpoints extended
- `POST /documents/:id/approval` — new `APPROVE_STAGE1` action and final-review stage rules; direct `APPROVED` on `PENDING` is unchanged.
- `GET /documents/approvals/pending` — includes `FINAL_REVIEW` with a `stage` field.
- `GET /verify/:code` — `EXPIRED` / `ARCHIVED` results plus `document.validity`.
- `GET /reports/analytics`, `/reports/export/pdf`, `/reports/export/excel` — accept `from`, `to`, `departmentId` filters and expose `byUploader`, `pendingDocuments`, `approvalRate`, `filtersApplied`.
- `GET /audit-logs` — `from`, `to`, `userId` filters.
- `GET /dashboard` — `stats.approved/rejected/archived/draft` and `departmentStats`; trashed documents excluded.
- `POST /backups` — zip is reopened and verified with AdmZip; records store `verified: true` and a SHA-256 checksum only after verification.
- `POST /assistant/ask` — adds `source: 'ai' | 'fallback'`; optional OpenAI-compatible provider plus deterministic `summarize <title>` / `compare version N and M of <title>` handlers.

## Operational notes / minor deviations

- Prisma cannot declare a model and enum with the same name, so the roles catalog is exposed as **`RoleCatalog`** while mapped to the SQL table **`"Role"`** (`@@map("Role")`). `User.role` remains the original enum.
- The seed script was rewritten for fresh installs (7 departments, 4 roles, 9 categories, one bootstrap super admin `admin@llcc.edu` / `Admin@12345`; demo users only with `DEMO_SEED=true`). It has now also been run against the existing `dev.db`: the three legacy departments were renamed **in place** (`CCS` → `IT`, `CBA` → `BA`, `COE` → `EDUC`) so every document and user kept its department reference, and the remaining four repositories (`ADMIN`, `REG`, `FIN`, `HR`) were added. The live database now contains exactly the seven requested repositories. `test-advanced.mjs` resolves its test department by `IT` code with legacy/first-department fallbacks.
- Password reset updates the password and consumes the token, but an already-issued JWT cannot be enumerated by jti from stored data; those tokens expire naturally. Future logins always require the new password.
- `APPROVE_STAGE1` is also permitted for SUPER_ADMIN (in addition to DEPARTMENT_HEAD/DEAN), consistent with the existing `canApprove` policy.
- `expiryScanHours` is supported as an optional Setting (default 6) alongside `EXPIRY_SCAN_HOURS`; it is not included in the five documented default settings returned by `GET /settings` unless explicitly saved.
- `prisma/probe-new-models.mjs` is the verification script that wrote/read one record of every new model (plus both new enum values) and removed those probe records.

## Verification

- Baseline `node test-advanced.mjs`: **82 passed / 0 failed**.
- After changes, `node test-advanced.mjs`: **82 passed / 0 failed** (no new failures) — re-run after the department migration against the live `dev.db`.
- New-feature API sweep against an isolated database copy: **52 passed / 0 failed**.
- Frontend-facing contract sweep `node ../tests/api-contract.mjs` (`npm run test:contract`): **36 passed / 0 failed** — covers catalog/settings, extended metadata/search/archive, two-stage approval, expired verification, filtered reports, RBAC, upload validation and logout revocation.
- Fresh-database seed check: 7 departments, 4 roles, 9 categories, 1 super admin, 0 documents; `seed:demo` adds 3 demo users and still 0 documents.
