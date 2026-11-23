# LLCC Document Management and Repository System

A complete full-stack document management system for college operations: secure authentication, department repositories, version control, approval workflows, permission-aware search, QR verification, audit logging, analytics, backups, and an optional AI assistant.

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 5, React Router 6, Axios, Lucide icons |
| Backend | Node.js, Express 5, REST JSON API, JWT auth, Multer uploads |
| Database | SQLite via Prisma 6 (migrations in `backend/prisma/migrations`) |
| File storage | Local disk (`backend/uploads`) — never served directly; all access is authenticated |
| Reports | PDFKit (PDF), ExcelJS (XLSX) |
| QR codes | `qrcode` library; public verification by opaque token only |

The Vite dev server proxies `/api` to `http://localhost:5000`, so the browser only talks to one origin.

## Features

- **Authentication & RBAC** – bcrypt password hashing, JWT sessions with revocation on logout, four roles (Super Administrator, Dean, Department Head, Staff), department assignment, activation/deactivation, profile management, token-based password reset.
- **Departments** – seven seeded college repositories plus full CRUD for administrators.
- **Documents** – upload, download, metadata editing, replacement with automatic revisions, archive/restore, soft delete, reference numbers, categories, types, keywords, expiry and review dates.
- **Search** – ranked by relevance, revision count and recency; filters for department, category, status, dates, file type, expiry and more; always scoped by permissions.
- **Version control** – Rev 1, Rev 2… with author, timestamp and change notes; download or restore any prior version without overwriting files.
- **Approval workflow** – Draft → Pending → optional Department Head stage → Dean/Admin final decision → Approved/Rejected/Revision Requested; notifications and complete approval history.
- **Audit logs** – login/logout, uploads, downloads, edits, approvals, deletions, permission changes, department changes, backup/restore and more.
- **Notifications** – in-app center with read/unread state, expiry reminders, approval decisions and administrative announcements.
- **Analytics** – department/category/user/status statistics, monthly trends, approval rate, pending reports, date/department filters, real-data PDF/XLSX export and print view.
- **QR verification** – unique token per approved document; public page shows metadata only and never exposes the private file.
- **Expiration & renewal** – configurable reminder windows, upcoming/expired lists, expired documents no longer reported as valid.
- **Secure preview** – PDF/images streamed inline through authenticated endpoints; DOCX/XLSX/PPTX rendered server-side to HTML; no static public file URLs.
- **Recycle bin** – soft delete with actor/date/reason, restore, and confirmed permanent deletion. Audit history survives deletion.
- **AI assistant** – permission-aware deterministic assistant by default; optional OpenAI-compatible external API when configured, with automatic fallback.
- **Backups** – verified ZIP archives of the database and uploaded files, manual creation, configurable scheduling, download, and confirmed restore with a safety copy.

## Prerequisites

- Windows 10/11 (or any OS with Node.js)
- Node.js 20 or newer (Node 24 works)
- npm 10 or newer
- No external database installation required — SQLite is a local file

## Installation (Windows)

Open PowerShell in the project root:

```powershell
# 1. Backend dependencies
cd backend
npm install
Copy-Item .env.example .env
npm run setup          # prisma generate + migrate deploy + seed

# 2. Frontend dependencies
cd ..\frontend
npm install
```

Edit `backend\.env` before first production use:

```env
PORT=5000
JWT_SECRET=replace_with_a_long_random_value
DATABASE_URL="file:./dev.db"
CLIENT_ORIGIN=http://localhost:5173
UPLOAD_DIR=./uploads
BACKUP_DIR=./backups
NODE_ENV=development
RESET_TOKEN_IN_RESPONSE=true
```

### Bootstrap administrator

`npm run setup` creates the initial administrator:

| Email | Password |
| --- | --- |
| `admin@llcc.edu` | `Admin@12345` |

Change this password immediately after first login via **Profile → Change password**.

Optional demo users (clearly identified as demo data) can be added with:

```powershell
cd backend
npm run seed:demo
```

This creates `dean@llcc.edu`, `head.it@llcc.edu`, and `staff.it@llcc.edu` with password `Demo@12345`. No demo documents are created.

## Running the application

### Development (two terminals)

```powershell
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

Open <http://localhost:5173>. API health check: <http://localhost:5000/api/health>.

### Production-style build

```powershell
cd frontend
npm run build
```

Serve `frontend/dist` with any static server (or `npm run preview`) and set `CLIENT_ORIGIN` in `backend\.env` to that origin. Keep the backend running for all API calls.

A convenience script is provided:

```powershell
.\start-dev.ps1
```

## Database migrations

Migrations are versioned in `backend/prisma/migrations`.

```powershell
cd backend
npx prisma generate
npx prisma migrate deploy
npm run seed
```

For a fresh development database, delete `backend/prisma/dev.db`, then run `npm run setup:fresh`. This destroys all records — use only for development.

## Role permissions

| Capability | Super Admin | Dean | Dept Head | Staff |
| --- | --- | --- | --- | --- |
| View all departments | ✅ | ✅ | own | own |
| Upload documents | ✅ | ✅ | ✅ | ✅ |
| Edit documents | ✅ | own dept | own dept | own uploads |
| Approve / reject | ✅ | ✅ | own dept (stage 1) | ❌ |
| Final approval | ✅ | ✅ | ❌ | ❌ |
| Analytics & reports | ✅ | ✅ | ✅ | ❌ |
| Audit logs | ✅ | ✅ | own dept | own actions |
| Recycle bin | ✅ | ✅ | own dept | ❌ |
| Manage users/departments/backups/settings | ✅ | ❌ | ❌ | ❌ |
| Public QR verification page | 🌐 | 🌐 | 🌐 | 🌐 |

## Testing

### Automated backend API suite

With the backend running:

```powershell
cd backend
npm run test:api
```

The suite exercises analytics exports, QR verification, expiration reminders, previews, recycle bin, assistant, versioning, approvals, RBAC, backups and report filters. It creates temporary documents and cleans up what it can; run it against a development database.

A second suite covers the endpoints used by the React UI (catalog, settings, extended metadata/search, two-stage approval, expired verification, filtered exports and logout revocation):

```powershell
cd backend
npm run test:contract
```

Both suites currently pass with **82/82** and **36/36** checks respectively.

### Manual UI checks

1. Log in as each role and confirm navigation differs correctly.
2. Upload a PDF, edit its metadata, replace the file, and confirm Rev 2 appears with author/date.
3. Restore Rev 1 and confirm a new revision is created (original file never silently overwritten).
4. Submit a document, approve/reject it as Department Head and Dean, and check the uploader's notifications.
5. Search by title, reference number and keyword; apply every filter.
6. Preview PDF/image/Office files; download a prior version.
7. Open the QR code of an approved document, scan/visit the public URL, and confirm no file is exposed.
8. Set an expiry date, run an expiration scan as admin, and verify reminders.
9. Soft-delete a document, restore it, then permanently delete another one after typing `DELETE`.
10. Generate PDF and Excel reports with a date filter; print the analytics page.
11. Create a verified backup, download it, and test restore in a disposable environment.
12. Try unauthorized actions while logged in as Staff and confirm HTTP 403 / hidden controls.

## Optional AI configuration

The assistant works offline using deterministic, permission-aware queries. To use an external OpenAI-compatible provider, add to `backend\.env`:

```env
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=your_key_here
AI_MODEL=gpt-4o-mini
```

If the API is unavailable, misconfigured, or returns an empty answer, the system automatically falls back to ordinary search. Core functionality never depends on a paid service.

## Backup & restore notes

- A backup ZIP contains `db/dev.db`, every file in `uploads/`, and a `manifest.json`.
- Backups are reopened and verified before the database record is marked `COMPLETED`; a checksum is stored.
- Restore requires typing `RESTORE`, creates a `pre-restore-*.db` safety copy, and asks the server to reload.
- Test restores against a copy of the installation before using them in production.

## Security notes

- Passwords are bcrypt-hashed; no plaintext credentials are stored.
- JWTs expire after 8 hours and are revoked on logout.
- All document bytes flow through authenticated controllers; uploads are never placed in a public static folder.
- Uploads are restricted by extension, MIME type and basic binary signature checks; maximum size is 20 MB by default.
- Prisma parameterized queries prevent SQL injection; React escapes rendered text and Office preview HTML is escaped server-side.
- Authentication uses bearer tokens rather than cookies, so CSRF tokens are not required for the API; CORS is restricted to `CLIENT_ORIGIN`.
- Sensitive actions are recorded in `AuditLog` with user, IP, timestamp and details.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `P1001` / database errors | Confirm `DATABASE_URL` in `backend\.env` and run `npx prisma migrate deploy`. |
| Login returns 401 | Confirm the seeded admin credentials and that the account is active. |
| Frontend shows network errors | Ensure backend is on port 5000 and `CLIENT_ORIGIN` matches the frontend URL. |
| PDF preview blank | Use the browser's built-in PDF viewer; zoom controls are in the preview toolbar. |
| Office preview says unsupported | Download the file; complex legacy `.doc`/`.ppt`/`.xls` files are not rendered inline. |
| QR page says not found | Only approved documents have codes; regenerate from the document detail page. |

## Project structure

```
backend/
  prisma/            schema, migrations, seed
  src/controllers/   REST handlers
  src/routes/        endpoint definitions
  src/middleware/    auth + upload validation
  src/utils/         permissions, audit, verification, scheduler
  uploads/           private file storage
  backups/           verified backup archives
frontend/
  src/api/           axios client
  src/components/    layout + shared UI
  src/context/       auth state
  src/pages/         feature screens
  src/styles/        design system
docs/API_CONTRACT.md
```
