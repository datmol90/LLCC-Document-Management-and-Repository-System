import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma.js';
import { canViewDocument } from '../utils/permissions.js';
import { logAudit } from '../utils/audit.js';

const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');

const OFFICE_EXT = new Set(['.docx', '.xlsx', '.pptx']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function extOf(name) { return path.extname(name || '').toLowerCase(); }

/**
 * GET /api/documents/:id/preview
 * Returns:
 *  - kind: 'pdf' | 'image' | 'office' | 'text' | 'unsupported'
 *  - pdf/image  -> serves the raw file inline (browser renders natively)
 *  - office     -> { kind:'office', format, html } server-rendered HTML
 *  - unsupported-> { kind:'unsupported', message, downloadUrl }
 */
export async function previewDocument(req, res) {
  const versionId = req.query.versionId;
  let doc = await prisma.document.findUnique({
    where: { id: req.params.id },
    include: { currentVersion: true, versions: true },
  });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ message: 'Access denied' });

  let version = doc.currentVersion;
  if (versionId) {
    version = doc.versions.find((v) => v.id === versionId) || null;
    if (!version) return res.status(404).json({ message: 'Version not found' });
  }
  if (!version) return res.status(404).json({ message: 'No file available to preview' });

  const filePath = path.join(uploadDir(), version.storagePath);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on server' });

  const ext = extOf(version.originalName || version.fileName);
  const mime = version.mimeType || '';

  await logAudit({
    userId: req.user.id, action: 'PREVIEW_DOCUMENT', entityType: 'Document',
    entityId: doc.id, documentId: doc.id, details: { version: version.versionNumber, ext }, req,
  });

  // Office documents are rendered to HTML first: extension is authoritative here,
  // because a mis-declared MIME type must not force a raw binary stream.
  if (OFFICE_EXT.has(ext) || mime.includes('wordprocessingml') || mime.includes('spreadsheetml') || mime.includes('presentationml')) {
    const officeExt = OFFICE_EXT.has(ext) ? ext : (mime.includes('wordprocessingml') ? '.docx' : mime.includes('spreadsheetml') ? '.xlsx' : '.pptx');
    try {
      const html = await renderOffice(filePath, officeExt);
      return res.json({ kind: 'office', format: officeExt.slice(1), html, version: version.versionNumber, originalName: version.originalName });
    } catch (e) {
      console.error('office preview failed', e);
      return res.json({
        kind: 'unsupported', format: officeExt.slice(1), version: version.versionNumber,
        message: 'This file could not be rendered in the browser. Download it to view.',
        downloadUrl: `/api/documents/${doc.id}/download${versionId ? `?versionId=${versionId}` : ''}`,
      });
    }
  }

  // Raw media previews
  if (mime === 'application/pdf' || ext === '.pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(version.originalName)}"`);
    return fs.createReadStream(filePath).pipe(res);
  }
  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) {
    res.setHeader('Content-Type', mime || `image/${ext.slice(1)}`);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(version.originalName)}"`);
    return fs.createReadStream(filePath).pipe(res);
  }
  if (mime === 'text/plain' || ext === '.txt' || ext === '.csv' || ext === '.md') {
    const text = fs.readFileSync(filePath, 'utf8');
    const html = `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;margin:0">${escapeHtml(text)}</pre>`;
    return res.json({ kind: 'text', format: ext.slice(1), html, version: version.versionNumber });
  }

  return res.json({
    kind: 'unsupported', format: ext.slice(1) || 'file', version: version.versionNumber,
    message: `Preview is not available for ${ext || 'this file type'}. Download it to view.`,
    downloadUrl: `/api/documents/${doc.id}/download${versionId ? `?versionId=${versionId}` : ''}`,
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function renderOffice(filePath, ext) {
  if (ext === '.docx') {
    const { default: mammoth } = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ path: filePath });
    return wrap(value || '<p>(empty document)</p>');
  }
  if (ext === '.xlsx') return wrap(await renderXlsx(filePath));
  if (ext === '.pptx') return wrap(await renderPptx(filePath));
  throw new Error('Unsupported office format');
}

async function renderXlsx(filePath) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const parts = [];
  for (const ws of wb.worksheets) {
    parts.push(`<h3 style="margin:18px 0 8px;color:#0b2f5b;font-size:15px">${escapeHtml(ws.name || 'Sheet')}</h3>`);
    parts.push('<div style="overflow:auto"><table style="border-collapse:collapse;font-size:13px;min-width:100%">');
    let hasRow = false;
    ws.eachRow((row, rn) => {
      hasRow = true;
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const v = cell.value;
        const text = v && typeof v === 'object' && 'result' in v ? String(v.result) : v instanceof Date ? v.toLocaleDateString() : String(v ?? '');
        const tag = rn === 1 ? 'th' : 'td';
        cells.push(`<${tag} style="border:1px solid #dbe7f3;padding:6px 9px;${rn === 1 ? 'background:#eaf3ff;color:#0b2f5b;font-weight:700;' : ''}white-space:nowrap">${escapeHtml(text)}</${tag}>`);
      });
      parts.push(`<tr>${cells.join('')}</tr>`);
    });
    parts.push('</table></div>');
    if (!hasRow) parts.push('<p style="color:#64748b;font-size:13px">Empty sheet</p>');
  }
  return parts.join('') || '<p style="color:#64748b">No sheets found</p>';
}

async function renderPptx(filePath) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1])));
  if (!slideFiles.length) return '<p style="color:#64748b">No slides found</p>';

  const parts = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    // Extract text runs: <a:t>...</a:t>
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    parts.push(`
      <div style="border:1px solid #dbe7f3;border-radius:10px;margin-bottom:14px;overflow:hidden">
        <div style="background:#0b2f5b;color:#fff;padding:7px 12px;font-size:12px;font-weight:700;letter-spacing:.03em">SLIDE ${i + 1} / ${slideFiles.length}</div>
        <div style="padding:14px 16px">
          ${runs.length
            ? runs.map((t) => `<p style="margin:0 0 7px;font-size:14px;line-height:1.55;color:#182230">${escapeHtml(t)}</p>`).join('')
            : '<p style="margin:0;color:#94a3b8;font-size:13px;font-style:italic">(no text on this slide)</p>'}
        </div>
      </div>`);
  }
  return parts.join('');
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, '&');
}

function wrap(inner) {
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#182230;line-height:1.65;font-size:14px">${inner}</div>`;
}
