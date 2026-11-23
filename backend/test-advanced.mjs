// End-to-end backend test for the 7 advanced features.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:5000/api';
let token = '';
let failed = 0;
let passed = 0;

const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' :: ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`); }
};

async function req(method, url, { body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) { payload = raw; h['Content-Type'] = headers['Content-Type'] || 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(url.startsWith('http') ? url : API + url, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: res.status, json: await res.json(), res };
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json: null, buf, res };
}

function multipart(fields, fileField, filePath) {
  const boundary = '----llcc' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (filePath) {
    const name = path.basename(filePath);
    const data = fs.readFileSync(filePath);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`));
    parts.push(data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const tmp = path.join(__dirname, 'tmp-test');
fs.mkdirSync(tmp, { recursive: true });
const makePdf = (tag) => { const p = path.join(tmp, `${tag}.pdf`); fs.writeFileSync(p, `%PDF-1.4\n% ${tag} ${Date.now()}\ntrailer\n%%EOF`); return p; };

console.log('\n=== SETUP ===');
{
  const r = await req('POST', '/auth/login', { body: { email: 'admin@llcc.edu', password: 'Admin@12345' } });
  ok('admin login', r.status === 200 && !!r.json?.token);
  token = r.json.token;
}
let deptId, docId;
{
  const r = await req('GET', '/departments?includeInactive=true');
  const departments = r.json?.departments || [];
  deptId = (departments.find(d => d.code === 'IT') || departments.find(d => d.code === 'CCS') || departments[0])?.id;
  ok('departments listed', !!deptId);
}

console.log('\n=== 1) ANALYTICS + REPORTS ===');
let analytics;
{
  const r = await req('GET', '/reports/analytics');
  analytics = r.json?.analytics;
  ok('analytics endpoint 200', r.status === 200 && !!analytics);
  ok('analytics has totals', !!analytics?.totals && typeof analytics.totals.documents === 'number');
  ok('analytics has byDepartment array', Array.isArray(analytics?.byDepartment));
  ok('analytics has monthlyUploads (12)', analytics?.monthlyUploads?.length === 12);
  ok('analytics has expiringSoon array', Array.isArray(analytics?.expiringSoon));
}
{
  const r = await req('GET', '/reports/export/pdf');
  const isPdf = r.buf && r.buf.slice(0, 5).toString() === '%PDF-';
  ok('PDF report downloadable', r.status === 200 && isPdf, `bytes=${r.buf?.length}`);
  ok('PDF has disposition header', (r.res.headers.get('content-disposition') || '').includes('attachment'));
  if (isPdf) fs.writeFileSync(path.join(tmp, 'report.pdf'), r.buf);
}
{
  const r = await req('GET', '/reports/export/excel');
  // xlsx is a ZIP: starts with PK
  const isZip = r.buf && r.buf[0] === 0x50 && r.buf[1] === 0x4b;
  ok('Excel report downloadable', r.status === 200 && isZip, `bytes=${r.buf?.length}`);
  if (isZip) fs.writeFileSync(path.join(tmp, 'report.xlsx'), r.buf);
}

console.log('\n=== 2) QR CODE VERIFICATION ===');
let verifyCode;
{
  // create + approve a document so it gets a verification code
  const mp = multipart({ title: 'QR Test Policy', description: 'For QR verification', category: 'Policy', departmentId: deptId, status: 'PENDING' }, 'file', makePdf('qr-test'));
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  ok('document created for QR test', r.status === 201, `status=${r.status}`);
  docId = r.json?.document?.id;
  if (docId) {
    const a = await req('POST', `/documents/${docId}/approval`, { body: { action: 'APPROVED', comments: 'ok' } });
    ok('approved (triggers code)', a.status === 200, `code=${a.json?.verificationCode || 'none'}`);
    verifyCode = a.json?.verificationCode;
  }
}
{
  const r = await req('GET', `/documents/${docId}/verification`);
  ok('verification endpoint returns code', r.status === 200 && !!r.json?.code, r.json?.code);
  verifyCode = verifyCode || r.json?.code;
}
{
  const r = await req('GET', `/documents/${docId}/qr`);
  ok('QR PNG data URL', r.status === 200 && (r.json?.qr || '').startsWith('data:image/png'), `code=${r.json?.code}`);
}
{
  // public verify (no token)
  const saved = token; token = '';
  const r = await req('GET', `/verify/${encodeURIComponent(verifyCode)}`);
  token = saved;
  ok('public verify VALID', r.status === 200 && r.json?.valid === true, r.json?.message);
  ok('public verify exposes title', !!r.json?.document?.title, r.json?.document?.title);
}
{
  const saved = token; token = '';
  const r = await req('GET', '/verify/LLCC-AAAA-BBBB-CCCC');
  token = saved;
  ok('unknown code -> NOT_FOUND 404', r.status === 404 && r.json?.result === 'NOT_FOUND');
}
{
  const r = await req('GET', '/verification-logs');
  ok('verification logs listed', r.status === 200 && Array.isArray(r.json?.logs), `total=${r.json?.total}`);
}

console.log('\n=== 3) EXPIRATION + RENEWAL REMINDERS ===');
let expDocId;
{
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const mp = multipart({ title: 'Expiring Grant Doc', category: 'Grant', departmentId: deptId, status: 'DRAFT', expiresAt: soon }, 'file', makePdf('expiring'));
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  expDocId = r.json?.document?.id;
  ok('document with expiry created', r.status === 201 && !!expDocId, `expires=${soon}`);
  ok('expiresAt persisted', !!r.json?.document?.expiresAt, r.json?.document?.expiresAt);
}
{
  const r = await req('POST', '/documents/run-expiration-scan');
  ok('manual expiration scan runs', r.status === 200, JSON.stringify(r.json?.result?.expiring?.length ?? r.json));
}
{
  const r = await req('GET', '/documents/expiring');
  ok('expiring list returns doc', r.status === 200 && (r.json?.expiring || []).some(d => d.id === expDocId), `count=${r.json?.expiring?.length}`);
  ok('daysLeft computed', (r.json?.expiring || []).every(d => typeof d.daysLeft === 'number'));
}
{
  const r = await req('GET', '/notifications');
  const expNotifs = (r.json?.notifications || []).filter(n => n.type === 'EXPIRATION');
  ok('EXPIRATION notification created', expNotifs.length > 0, `count=${expNotifs.length}`);
  ok('notification has message', !!expNotifs[0]?.message, expNotifs[0]?.message?.slice(0, 70));
}

console.log('\n=== 4) DOCUMENT PREVIEW ===');
{
  const r = await req('GET', `/documents/${docId}/preview`);
  ok('PDF preview served inline', r.status === 200 && (r.res.headers.get('content-type') || '').includes('pdf'), r.res.headers.get('content-type'));
}
// Build a real .docx, .xlsx, .pptx using the installed libs
let officeIds = {};
{
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Budget');
  ws.addRow(['Item', 'Amount']);
  ws.addRow(['Supplies', 1200]);
  ws.addRow(['Travel', 450]);
  const xlsxPath = path.join(tmp, 'budget.xlsx');
  await wb.xlsx.writeFile(xlsxPath);
  const mp = multipart({ title: 'XLSX Preview Doc', category: 'Report', departmentId: deptId, status: 'DRAFT' }, 'file', xlsxPath);
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  officeIds.xlsx = r.json?.document?.id;
  ok('xlsx uploaded', r.status === 201, `status=${r.status}`);
}
{
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello from DOCX preview</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const docxPath = path.join(tmp, 'notes.docx');
  await zip.generateAsync({ type: 'nodebuffer' }).then(b => fs.writeFileSync(docxPath, b));
  const mp = multipart({ title: 'DOCX Preview Doc', category: 'Memo', departmentId: deptId, status: 'DRAFT' }, 'file', docxPath);
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  officeIds.docx = r.json?.document?.id;
  ok('docx uploaded', r.status === 201, `status=${r.status}`);
}
{
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
  zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One Title</a:t></a:r></a:p><a:r><a:rPr lang="en-US"/><a:t>Bullet point A</a:t></a:r></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  zip.file('ppt/slides/slide2.xml', '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const pptxPath = path.join(tmp, 'deck.pptx');
  await zip.generateAsync({ type: 'nodebuffer' }).then(b => fs.writeFileSync(pptxPath, b));
  const mp = multipart({ title: 'PPTX Preview Doc', category: 'Presentation', departmentId: deptId, status: 'DRAFT' }, 'file', pptxPath);
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  officeIds.pptx = r.json?.document?.id;
  ok('pptx uploaded', r.status === 201, `status=${r.status}`);
}
if (officeIds.xlsx) {
  const r = await req('GET', `/documents/${officeIds.xlsx}/preview`);
  ok('xlsx -> office HTML', r.status === 200 && r.json?.kind === 'office', r.json?.kind);
  ok('xlsx HTML contains cell data', (r.json?.html || '').includes('Supplies'), (r.json?.html || '').slice(0, 60));
}
if (officeIds.docx) {
  const r = await req('GET', `/documents/${officeIds.docx}/preview`);
  ok('docx -> office HTML', r.status === 200 && r.json?.kind === 'office', r.json?.kind);
  ok('docx HTML contains text', (r.json?.html || '').includes('Hello from DOCX preview'));
}
if (officeIds.pptx) {
  const r = await req('GET', `/documents/${officeIds.pptx}/preview`);
  ok('pptx -> office HTML', r.status === 200 && r.json?.kind === 'office', r.json?.kind);
  ok('pptx HTML has slide 1', (r.json?.html || '').includes('Slide One Title'));
  ok('pptx HTML has slide 2', (r.json?.html || '').includes('Slide Two Title'));
}

console.log('\n=== 5) RECYCLE BIN ===');
let trashDocId;
{
  const mp = multipart({ title: 'Trashable Doc', category: 'Memo', departmentId: deptId, status: 'DRAFT' }, 'file', makePdf('trash'));
  const r = await req('POST', '/documents', { raw: mp.body, headers: { 'Content-Type': mp.contentType } });
  trashDocId = r.json?.document?.id;
  ok('doc created for recycle bin', r.status === 201 && !!trashDocId);
}
{
  const r = await req('DELETE', `/documents/${trashDocId}`);
  ok('delete = soft delete (200)', r.status === 200, r.json?.message);
}
{
  const active = await req('GET', '/documents?limit=100');
  ok('deleted doc hidden from active list', !(active.json?.documents || []).some(d => d.id === trashDocId));
  const trash = await req('GET', '/documents?view=trash&limit=100');
  ok('deleted doc appears in trash view', (trash.json?.documents || []).some(d => d.id === trashDocId), `trashTotal=${trash.json?.total}`);
  ok('trash view flag returned', trash.json?.view === 'trash');
}
{
  const r = await req('POST', `/documents/${trashDocId}/restore`);
  ok('restore from recycle bin', r.status === 200, r.json?.message);
  const active = await req('GET', '/documents?limit=100');
  ok('restored doc back in active list', (active.json?.documents || []).some(d => d.id === trashDocId));
}
{
  // purge requires it be in the bin first
  const pre = await req('DELETE', `/documents/${trashDocId}/purge`);
  ok('purge blocked while not in bin', pre.status === 400, pre.json?.message);
  await req('DELETE', `/documents/${trashDocId}`);
  const r = await req('DELETE', `/documents/${trashDocId}/purge`);
  ok('permanent delete works from bin', r.status === 200, r.json?.message);
  const gone = await req('GET', `/documents/${trashDocId}`);
  ok('purged doc no longer fetchable', gone.status === 404 || gone.status === 403, `status=${gone.status}`);
}

console.log('\n=== 6) AI ASSISTANT (permission-aware NL search) ===');
{
  const r = await req('POST', '/assistant/ask', { body: { question: 'how many documents are pending approval' } });
  ok('count question answered', r.status === 200 && r.json?.intent === 'count', r.json?.answer?.slice(0, 80));
  ok('answer has a number', /\*\*\d+\*\*|\d+/.test(r.json?.answer || ''));
}
{
  const r = await req('POST', '/assistant/ask', { body: { question: 'give me an overview of the repository' } });
  ok('summary question answered', r.status === 200 && r.json?.intent === 'summary', r.json?.answer?.split('\n')[0]);
  ok('summary has stats', !!r.json?.stats && typeof r.json.stats.documents === 'number');
}
{
  const r = await req('POST', '/assistant/ask', { body: { question: 'show me QR test policy documents' } });
  ok('search question answered', r.status === 200 && r.json?.intent === 'search', `total=${r.json?.total}`);
  ok('search returned results', r.json?.total > 0, `total=${r.json?.total}`);
}
{
  const r = await req('POST', '/assistant/ask', { body: { question: 'which department has the most documents' } });
  ok('top question answered', r.status === 200 && r.json?.intent === 'top', r.json?.answer?.split('\n')[0]);
}
{
  const r = await req('POST', '/assistant/ask', { body: { question: 'documents uploaded in the last 30 days' } });
  ok('date-filter question works', r.status === 200, `total=${r.json?.total}`);
}
{
  const r = await req('POST', '/assistant/ask', { body: { question: '' } });
  ok('empty question rejected 400', r.status === 400, r.json?.message);
}

console.log('\n=== 6b) ASSISTANT PERMISSION CLAMP (Staff) ===');
let staffToken = '';
{
  const u = await req('POST', '/users', { body: { name: 'Test Staff', email: 'staff.test@llcc.edu', password: 'Staff@12345', role: 'STAFF', departmentId: deptId } });
  ok('staff user enrolled', u.status === 201 || u.status === 409, `status=${u.status}`);
  const l = await req('POST', '/auth/login', { body: { email: 'staff.test@llcc.edu', password: 'Staff@12345' } });
  staffToken = l.json?.token || '';
  ok('staff login', !!staffToken);
}
if (staffToken) {
  const saved = token; token = staffToken;
  const r = await req('POST', '/assistant/ask', { body: { question: 'show me all documents' } });
  ok('staff assistant scoped', r.status === 200, `scope=${r.json?.scope} total=${r.json?.total}`);
  const titles = (r.json?.results || []).map(d => d.title);
  ok('staff cannot see unapproved foreign docs', !titles.some(t => t === 'Trashable Doc' || t === 'XLSX Preview Doc'), titles.join(' | ').slice(0, 100));

  const rep = await req('GET', '/reports/export/pdf');
  ok('staff blocked from report export', rep.status === 403, `status=${rep.status}`);
  const bk = await req('GET', '/backups');
  ok('staff blocked from backups', bk.status === 403, `status=${bk.status}`);
  const trash = await req('GET', '/documents?view=trash');
  ok('staff blocked from recycle bin', trash.status === 403, `status=${trash.status}`);
  token = saved;
}

console.log('\n=== 7) BACKUP + RESTORE ===');
let backupId;
{
  const r = await req('POST', '/backups', { body: { kind: 'FULL' } });
  backupId = r.json?.backup?.id;
  ok('backup created', r.status === 201 && !!backupId, `bytes=${r.json?.backup?.fileSize}`);
  ok('backup has scope info', !!r.json?.backup?.scope, r.json?.backup?.scope);
}
{
  const r = await req('GET', '/backups');
  ok('backups listed', r.status === 200 && Array.isArray(r.json?.backups), `count=${r.json?.backups?.length}`);
  ok('backup exists on disk flag', (r.json?.backups || []).some(b => b.id === backupId && b.exists));
}
{
  const r = await req('GET', `/backups/${backupId}/download`);
  const isZip = r.buf && r.buf[0] === 0x50 && r.buf[1] === 0x4b;
  ok('backup downloadable zip', r.status === 200 && isZip, `bytes=${r.buf?.length}`);
  if (isZip) fs.writeFileSync(path.join(tmp, 'backup.zip'), r.buf);
}
{
  const r = await req('POST', `/backups/${backupId}/restore`, { body: { confirm: 'NOPE' } });
  ok('restore requires confirmation', r.status === 400, r.json?.message);
}
{
  // verify the zip actually contains db + manifest
  const { default: AdmZip } = await import('adm-zip');
  const z = new AdmZip(path.join(tmp, 'backup.zip'));
  const names = z.getEntries().map(e => e.entryName);
  ok('zip contains db/dev.db', names.includes('db/dev.db'));
  ok('zip contains manifest.json', names.includes('manifest.json'));
  const man = JSON.parse(z.getEntry('manifest.json').getData().toString('utf8'));
  ok('manifest has counts', typeof man.counts?.documents === 'number', JSON.stringify(man.counts));
  ok('zip contains uploaded files', names.filter(n => n.startsWith('uploads/')).length > 0, `${names.filter(n => n.startsWith('uploads/')).length} files`);
}

console.log('\n=== AUDIT TRAIL COVERAGE ===');
{
  const r = await req('GET', '/audit-logs?limit=100');
  const actions = new Set((r.json?.logs || []).map(l => l.action));
  const expected = ['EXPORT_REPORT_PDF', 'EXPORT_REPORT_EXCEL', 'APPROVAL_APPROVED', 'PREVIEW_DOCUMENT', 'DELETE_DOCUMENT', 'RESTORE_DOCUMENT', 'PURGE_DOCUMENT', 'CREATE_BACKUP', 'ASSISTANT_QUERY'];
  for (const a of expected) ok(`audit: ${a}`, actions.has(a));
  ok('audit lists verification code generation', actions.has('GENERATE_VERIFICATION_CODE'), [...actions].filter(a=>a.includes('VERIF')).join(','));
}

console.log('\n=== RESULT ===');
console.log(`passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
