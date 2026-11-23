// Contract smoke test for the extended LLCC DMS API used by the React frontend.
// Run with the backend listening on http://localhost:5000:
//   node tests/api-contract.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_URL || 'http://localhost:5000/api';
const tmp = path.join(__dirname, 'tmp');
fs.mkdirSync(tmp, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, condition, extra = '') => {
  if (condition) { passed += 1; console.log(`  PASS  ${name}${extra ? ` :: ${extra}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? ` :: ${extra}` : ''}`); }
};

async function request(method, url, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) { payload = raw; h['Content-Type'] = headers['Content-Type'] || 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const response = await fetch(url.startsWith('http') ? url : `${API}${url}`, { method, headers: h, body: payload });
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return { status: response.status, data: await response.json(), response };
  return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), response };
}

function multipart(fields, filePath, mime = 'application/pdf') {
  const boundary = `----llcc-contract-${Date.now()}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (filePath) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: ${mime}\r\n\r\n`));
    parts.push(fs.readFileSync(filePath), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const pdfPath = path.join(tmp, 'contract.pdf');
fs.writeFileSync(pdfPath, '%PDF-1.4\n% contract smoke test\ntrailer\n%%EOF');

console.log('\n=== AUTH / CATALOG / SETTINGS ===');
const adminLogin = await request('POST', '/auth/login', { body: { email: 'admin@llcc.edu', password: 'Admin@12345' } });
check('admin login', adminLogin.status === 200 && !!adminLogin.data?.token);
const token = adminLogin.data.token;

const profile = await request('GET', '/auth/profile', { token });
check('profile endpoint', profile.status === 200 && profile.data.user.email === 'admin@llcc.edu');

const roles = await request('GET', '/roles', { token });
check('roles catalog', roles.status === 200 && roles.data.roles.length >= 4);
const categories = await request('GET', '/categories', { token });
check('categories catalog', categories.status === 200 && categories.data.categories.length >= 5);
const settings = await request('GET', '/settings', { token });
check('settings defaults', settings.status === 200 && Array.isArray(settings.data.settings.expiryReminderDays));

const catName = `TEMP-CAT-${Date.now()}`;
const catCreate = await request('POST', '/categories', { token, body: { name: catName, description: 'contract test' } });
check('create category', catCreate.status === 201 && !!catCreate.data.category.id);
if (catCreate.data?.category?.id) {
  const deactivate = await request('DELETE', `/categories/${catCreate.data.category.id}`, { token });
  check('deactivate category', deactivate.status === 200);
}

const announcement = await request('POST', '/announcements', { token, body: { title: 'Contract test notice', body: 'Automated verification.', pinned: false } });
check('create announcement', announcement.status === 201 && !!announcement.data.announcement.id);
if (announcement.data?.announcement?.id) {
  const del = await request('DELETE', `/announcements/${announcement.data.announcement.id}`, { token });
  check('delete announcement', del.status === 200);
}

console.log('\n=== DOCUMENT METADATA / SEARCH / ARCHIVE ===');
const departments = await request('GET', '/departments?includeInactive=true', { token });
const dept = departments.data.departments.find((d) => d.code === 'IT') || departments.data.departments[0];
const referenceNumber = `LLCC-CONTRACT-${Date.now()}`;
const docFields = {
  title: 'Contract Verification Handbook',
  description: 'Automated test of extended metadata and filters.',
  category: 'Handbook',
  departmentId: dept.id,
  documentType: 'Handbook',
  referenceNumber,
  keywords: 'faculty, handbook, enrollment',
  status: 'PENDING',
  requiresFinalApproval: 'true',
};
const upload = multipart(docFields, pdfPath);
const created = await request('POST', '/documents', { token, raw: upload.body, headers: { 'Content-Type': upload.contentType } });
check('upload with extended metadata', created.status === 201 && created.data?.document?.referenceNumber === referenceNumber);
const docId = created.data?.document?.id;

if (docId) {
  const detail = await request('GET', `/documents/${docId}`, { token });
  check('detail exposes metadata', detail.status === 200 && detail.data.document.documentType === 'Handbook' && detail.data.document.keywords.includes('enrollment'));

  const byReference = await request('GET', `/documents?referenceNumber=${encodeURIComponent(referenceNumber)}`, { token });
  check('filter by reference number', byReference.status === 200 && byReference.data.documents.some((d) => d.id === docId));
  const byType = await request('GET', `/documents?documentType=Handbook`, { token });
  check('filter by document type', byType.status === 200 && byType.data.documents.some((d) => d.id === docId));
  const byKeyword = await request('GET', `/documents?keywords=enrollment`, { token });
  check('filter by keywords', byKeyword.status === 200 && byKeyword.data.documents.some((d) => d.id === docId));
  const byFileType = await request('GET', `/documents?fileType=pdf&limit=100`, { token });
  check('filter by file type', byFileType.status === 200 && byFileType.data.documents.some((d) => d.id === docId));

  const archive = await request('POST', `/documents/${docId}/archive`, { token, body: { reason: 'contract test' } });
  check('archive document', archive.status === 200 && archive.data.document.status === 'ARCHIVED');
  const archivedList = await request('GET', '/documents?status=ARCHIVED', { token });
  check('archived document listed', archivedList.data.documents.some((d) => d.id === docId));
  const unarchive = await request('POST', `/documents/${docId}/unarchive`, { token });
  check('unarchive document', unarchive.status === 200 && unarchive.data.document.status !== 'ARCHIVED');
}

console.log('\n=== TWO-STAGE APPROVAL ===');
const headEmail = `head.contract.${Date.now()}@llcc.edu`;
const headCreate = await request('POST', '/users', { token, body: { name: 'Contract Head', email: headEmail, password: 'Head@12345', role: 'DEPARTMENT_HEAD', departmentId: dept.id } });
check('create department head', headCreate.status === 201);
const headLogin = await request('POST', '/auth/login', { body: { email: headEmail, password: 'Head@12345' } });
const headToken = headLogin.data?.token;
check('department head login', headLogin.status === 200 && !!headToken);

if (docId && headToken) {
  // Unarchive restores a not-yet-approved document to DRAFT, so resubmit it first.
  const submit = await request('POST', `/documents/${docId}/submit`, { token });
  check('resubmit unarchived draft', submit.status === 200 && submit.data.document.status === 'PENDING');
  const stage1 = await request('POST', `/documents/${docId}/approval`, { token: headToken, body: { action: 'APPROVE_STAGE1', comments: 'Reviewed by department' } });
  check('stage-1 approval', stage1.status === 200 && stage1.data.status === 'FINAL_REVIEW', stage1.data?.status);
  const final = await request('POST', `/documents/${docId}/approval`, { token, body: { action: 'APPROVED', comments: 'Final sign-off' } });
  check('final approval', final.status === 200 && final.data.status === 'APPROVED' && !!final.data.verificationCode);
  if (final.data?.verificationCode) {
    const verify = await request('GET', `/verify/${final.data.verificationCode}`);
    check('public QR verification', verify.status === 200 && verify.data.valid === true);
  }
  const headFinalAttempt = await request('POST', `/documents/${docId}/approval`, { token: headToken, body: { action: 'APPROVED' } });
  check('head cannot give final approval', headFinalAttempt.status === 400 || headFinalAttempt.status === 403);
}

console.log('\n=== EXPIRED DOCUMENT NOT VALID ===');
const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
const expiredDoc = multipart({ title: 'Expired Policy', category: 'Policy', departmentId: dept.id, status: 'PENDING', expiresAt: past }, pdfPath);
const expCreated = await request('POST', '/documents', { token, raw: expiredDoc.body, headers: { 'Content-Type': expiredDoc.contentType } });
const expId = expCreated.data?.document?.id;
if (expId) {
  const approved = await request('POST', `/documents/${expId}/approval`, { token, body: { action: 'APPROVED' } });
  const code = approved.data?.verificationCode;
  const verify = await request('GET', `/verify/${code}`);
  check('expired approval reported invalid', verify.status === 200 && verify.data.valid === false && verify.data.result === 'EXPIRED', verify.data?.result);
}

console.log('\n=== REPORTS / AUDIT FILTERS ===');
const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const to = new Date().toISOString().slice(0, 10);
const analytics = await request('GET', `/reports/analytics?from=${from}&to=${to}&departmentId=${dept.id}`, { token });
check('analytics filters applied', analytics.status === 200 && !!analytics.data.analytics.filtersApplied && Array.isArray(analytics.data.analytics.byUploader) && Array.isArray(analytics.data.analytics.pendingDocuments));
const pdf = await request('GET', `/reports/export/pdf?from=${from}&to=${to}`, { token });
check('filtered PDF export', pdf.status === 200 && pdf.buffer?.slice(0, 5).toString() === '%PDF-');
const xlsx = await request('GET', `/reports/export/excel?from=${from}&to=${to}`, { token });
check('filtered XLSX export', xlsx.status === 200 && xlsx.buffer?.[0] === 0x50 && xlsx.buffer?.[1] === 0x4b);
const logs = await request('GET', `/audit-logs?from=${from}&to=${to}&limit=5`, { token });
check('audit date filter', logs.status === 200 && Array.isArray(logs.data.logs));

console.log('\n=== RBAC / FILE VALIDATION / LOGOUT ===');
const staffEmail = `staff.contract.${Date.now()}@llcc.edu`;
const staffCreate = await request('POST', '/users', { token, body: { name: 'Contract Staff', email: staffEmail, password: 'Staff@12345', role: 'STAFF', departmentId: dept.id } });
check('create staff user', staffCreate.status === 201);
const staffLogin = await request('POST', '/auth/login', { body: { email: staffEmail, password: 'Staff@12345' } });
const staffToken = staffLogin.data?.token;
check('staff login', staffLogin.status === 200 && !!staffToken);
if (staffToken) {
  const forbidden = await Promise.all([
    request('GET', '/backups', { token: staffToken }),
    request('GET', '/reports/export/pdf', { token: staffToken }),
    request('GET', '/verification-logs', { token: staffToken }),
  ]);
  check('staff denied admin endpoints', forbidden.every((r) => r.status === 403), forbidden.map((r) => r.status).join('/'));
  const createCat = await request('POST', '/categories', { token: staffToken, body: { name: 'FORBIDDEN' } });
  check('staff cannot create category', createCat.status === 403);
}

const exePath = path.join(tmp, 'malware.pdf');
fs.writeFileSync(exePath, 'MZ\x90\x00 this is not a pdf');
const badUpload = multipart({}, exePath);
const badResult = await request('POST', '/documents', { token, raw: badUpload.body, headers: { 'Content-Type': badUpload.contentType } });
check('executable disguised as PDF rejected', badResult.status === 400, badResult.data?.message);

const logoutToken = (await request('POST', '/auth/login', { body: { email: 'admin@llcc.edu', password: 'Admin@12345' } })).data?.token;
await request('POST', '/auth/logout', { token: logoutToken });
const afterLogout = await request('GET', '/documents', { token: logoutToken });
check('logout revokes token', afterLogout.status === 401);

console.log(`\n=== RESULT ===\npassed=${passed} failed=${failed}\n`);
if (failed) process.exitCode = 1;
