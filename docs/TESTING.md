# Testing Guide

This guide assumes the backend is running on `http://localhost:5000` and the frontend on `http://localhost:5173`.

## 1. Automated API suite

```powershell
cd backend
npm run test:api
```

The suite verifies:

| Area | Checks |
| --- | --- |
| Analytics | endpoint payload, PDF starts `%PDF-`, XLSX starts `PK`, filters applied |
| QR verification | code generation, public verification, invalid code handling, scan log |
| Expiration | expiry persisted, scan runs, reminder notification created, daysLeft computed |
| Preview | inline PDF, DOCX/XLSX/PPTX converted to HTML |
| Recycle bin | soft delete hidden from active list, restore, purge confirmation |
| Assistant | permission-aware count/search, restricted scope answers |
| Versioning | new revision created, old version downloadable, restore creates next revision |
| Approval | submit, approve, reject, revision request, notifications |
| RBAC | staff forbidden from admin endpoints, cross-department denial |
| Backups | real ZIP created, listed with size/status, restore confirmation required |

All tests use real HTTP requests against the running server. A failure in one section does not stop later sections; review the `PASS`/`FAIL` summary at the end.

### Extended frontend-facing contract suite

```powershell
cd backend
npm run test:contract
```

This second suite (36 checks) verifies the endpoints the React UI depends on: auth profile, role/category/settings catalogs, announcements, document metadata and all new search filters, archive/unarchive, the two-stage approval flow (`APPROVE_STAGE1` → `FINAL_REVIEW` → final decision), expired-document verification, filtered PDF/XLSX reports, audit filters, staff RBAC denials, executable-upload rejection and JWT revocation on logout. It runs against the same live server and can be repeated safely.

## 2. Manual UI test matrix

Run each workflow while logged in as the specified role.

### Super Administrator

1. **Login/logout** — sign in with `admin@llcc.edu / Admin@12345`; confirm dashboard cards show real counts; sign out and confirm protected pages redirect to login.
2. **Users** — create a Staff user in IT, change role to Department Head, deactivate/reactivate, reset password, attempt duplicate email and confirm error.
3. **Departments** — create a temporary department, edit it, deactivate it, reactivate it; verify audit entries.
4. **Documents** — upload a PDF with reference number, keywords, category and expiry; edit metadata; replace file and confirm Rev 2; restore Rev 1 and confirm Rev 3 (no silent overwrite).
5. **Approvals** — approve a pending document; reject another; request revision on a third; confirm uploader notifications.
6. **QR** — open QR modal on an approved document; visit public URL in a logged-out browser; confirm no file download option is exposed.
7. **Expirations** — set expiry 5 days out, run scan, confirm notification and presence in expiring list.
8. **Preview** — preview PDF inline, image inline, DOCX/XLSX/PPTX as HTML; zoom and download.
9. **Recycle bin** — soft delete, restore, permanent delete with `DELETE` confirmation; confirm audit log retains the action after purge.
10. **Analytics** — filter by date range and department; export PDF and XLSX; print report.
11. **Backups** — create FULL backup, confirm `verified`/checksum, download ZIP, inspect that it contains `db/dev.db`, `manifest.json` and `uploads/`; test restore on a disposable copy.
12. **Settings** — change reminder days and backup interval; create announcement; deactivate a category.

### Dean

- Dashboard scoped to all departments; final approval stage for documents with `requiresFinalApproval`; analytics and audit access; cannot manage users, backups or settings (UI hides and API returns 403).

### Department Head

- Sees only own department documents; stage-1 approval; recycle bin for own department; analytics scoped to own department; cannot approve a `FINAL_REVIEW` document; cross-department document URL returns 403.

### Staff

- Uploads documents, edits only own drafts; sees approved documents in own department plus own drafts; cannot open approvals, analytics, audit, recycle bin, users or backups; AI answers never include documents from another department.

## 3. Unauthorized action probes

With a Staff token (`<TOKEN>`), each command below must return **403**:

```powershell
$headers = @{ Authorization = 'Bearer <TOKEN>' }
Invoke-WebRequest -Headers $headers http://localhost:5000/api/users
Invoke-WebRequest -Headers $headers http://localhost:5000/api/backups
Invoke-WebRequest -Headers $headers http://localhost:5000/api/reports/export/pdf
Invoke-WebRequest -Headers $headers -Method Post http://localhost:5000/api/documents/run-expiration-scan
Invoke-WebRequest -Headers $headers http://localhost:5000/api/verification-logs
```

Requests with no token must return **401**:

```powershell
Invoke-WebRequest http://localhost:5000/api/documents
```

The public verification endpoint is the deliberate exception:

```powershell
Invoke-WebRequest http://localhost:5000/api/verify/LLCC-XXXX-XXXX-XXXX
```

## 4. File validation probes

- Upload `.exe` renamed to `.pdf` → rejected (binary signature check).
- Upload a 21 MB file → rejected with size error.
- Upload `.xls` and `.ppt` → accepted (legacy Office formats).
- Download a document from another department as Staff → 403.

## 5. Data integrity checks after tests

```powershell
cd backend
node --input-type=module -e "import prisma from './src/utils/prisma.js'; console.log({users:await prisma.user.count(),docs:await prisma.document.count(),trash:await prisma.document.count({where:{deletedAt:{not:null}}}),audit:await prisma.auditLog.count()});"
```

Confirm that audit log count never decreases, even after permanent document deletion.
