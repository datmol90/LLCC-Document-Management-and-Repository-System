import prisma from '../utils/prisma.js';
import { canExportReports, documentScopeWhere } from '../utils/permissions.js';
import { logAudit } from '../utils/audit.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** Builds the analytics payload for the requesting user, scoped by role and filters. */
export async function buildAnalytics(user, filters = {}) {
  const scope = documentScopeWhere(user);
  const where = { ...scope };
  const from = first(filters.from);
  const to = first(filters.to);
  const deptFilter = first(filters.departmentId);
  const filtersApplied = { from: from || null, to: to || null, departmentId: deptFilter || null };

  if (from || to) {
    const range = {};
    if (from) {
      const d = new Date(String(from));
      if (!Number.isNaN(d.getTime())) range.gte = d;
    }
    if (to) {
      const d = new Date(String(to));
      if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); range.lte = d; }
    }
    if (Object.keys(range).length) where.createdAt = range;
  }
  if (deptFilter) {
    // Never let a filter widen a department-scoped role's reach.
    where.departmentId = scope.departmentId ? (scope.departmentId === String(deptFilter) ? String(deptFilter) : '__none__') : String(deptFilter);
  }

  const scopedUserCount = user.role === 'SUPER_ADMIN' || user.role === 'DEAN'
    ? (deptFilter ? prisma.user.count({ where: { departmentId: String(deptFilter) } }) : prisma.user.count())
    : prisma.user.count({ where: { departmentId: user.departmentId || '__none__' } });
  const scopedDeptCount = user.role === 'SUPER_ADMIN' || user.role === 'DEAN'
    ? (deptFilter ? 1 : prisma.department.count())
    : 1;

  const [total, byStatus, byDepartment, byCategory, byUploader, recentUploads, recentUpdates, expiringSoon, expired, revisions, users, departments, pendingDocuments] =
    await Promise.all([
      prisma.document.count({ where }),
      prisma.document.groupBy({ by: ['status'], where, _count: true }),
      prisma.document.groupBy({ by: ['departmentId'], where, _count: true }),
      prisma.document.groupBy({ by: ['category'], where, _count: true }),
      prisma.document.groupBy({ by: ['uploaderId'], where, _count: true, orderBy: { _count: { uploaderId: 'desc' } }, take: 10 }),
      prisma.document.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10, include: { department: true, uploader: { select: { name: true } } } }),
      prisma.document.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 10, include: { department: true, uploader: { select: { name: true } } } }),
      prisma.document.findMany({
        where: { ...where, expiresAt: { not: null, gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) } },
        orderBy: { expiresAt: 'asc' }, take: 20, include: { department: true },
      }),
      prisma.document.findMany({ where: { ...where, expiresAt: { not: null, lt: new Date() } }, orderBy: { expiresAt: 'asc' }, take: 20, include: { department: true } }),
      prisma.document.aggregate({ where, _sum: { revisionCount: true }, _avg: { revisionCount: true } }),
      scopedUserCount,
      scopedDeptCount,
      prisma.document.findMany({
        where: { ...where, status: { in: ['PENDING', 'FINAL_REVIEW'] } },
        orderBy: { updatedAt: 'desc' }, take: 20,
        select: { id: true, title: true, status: true, updatedAt: true, department: { select: { name: true } } },
      }),
    ]);

  const deptNames = await prisma.department.findMany({ select: { id: true, name: true } });
  const nameOf = (id) => deptNames.find((d) => d.id === id)?.name || 'Unknown';
  const uploaderNames = await prisma.user.findMany({
    where: { id: { in: byUploader.map((r) => r.uploaderId) } },
    select: { id: true, name: true },
  });
  const uploaderNameOf = (id) => uploaderNames.find((u) => u.id === id)?.name || 'Unknown';

  // Keep a 12-month trend, anchored at the filter end date when supplied.
  const months = [];
  const anchor = to ? new Date(String(to)) : new Date();
  if (Number.isNaN(anchor.getTime())) anchor.setTime(Date.now());
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en', { month: 'short', year: '2-digit' }), count: 0 });
  }
  const allDocs = await prisma.document.findMany({ where, select: { createdAt: true } });
  for (const d of allDocs) {
    const key = `${d.createdAt.getFullYear()}-${String(d.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.count++;
  }

  const statusMap = {};
  for (const row of byStatus) statusMap[row.status] = row._count;
  const decided = (statusMap.APPROVED || 0) + (statusMap.REJECTED || 0) + (statusMap.REVISION_REQUESTED || 0);
  const approvalRate = decided ? Number((((statusMap.APPROVED || 0) / decided) * 100).toFixed(1)) : 0;

  return {
    generatedAt: new Date().toISOString(),
    scopeLabel: user.role === 'SUPER_ADMIN' || user.role === 'DEAN' ? 'All departments' : (user.department?.name || 'Your department'),
    totals: {
      documents: total,
      revisions: revisions._sum.revisionCount || 0,
      avgRevisions: Number((revisions._avg.revisionCount || 0).toFixed(2)),
      users,
      departments,
      pending: statusMap.PENDING || 0,
      approved: statusMap.APPROVED || 0,
      rejected: statusMap.REJECTED || 0,
      draft: statusMap.DRAFT || 0,
      revisionRequested: statusMap.REVISION_REQUESTED || 0,
      archived: statusMap.ARCHIVED || 0,
      finalReview: statusMap.FINAL_REVIEW || 0,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
    },
    byStatus: Object.entries(statusMap).map(([status, count]) => ({ status, count })),
    byDepartment: byDepartment.map((r) => ({ department: nameOf(r.departmentId), count: r._count })).sort((a, b) => b.count - a.count),
    byCategory: byCategory.map((r) => ({ category: r.category, count: r._count })).sort((a, b) => b.count - a.count),
    byUploader: byUploader.map((r) => ({ uploader: uploaderNameOf(r.uploaderId), count: r._count })),
    pendingDocuments: pendingDocuments.map((d) => ({
      id: d.id, title: d.title, department: d.department?.name || null, status: d.status, updatedAt: d.updatedAt,
    })),
    approvalRate,
    filtersApplied,
    monthlyUploads: months,
    recentUploads,
    recentUpdates,
    expiringSoon,
    expired,
  };
}

export async function getAnalytics(req, res) {
  const data = await buildAnalytics(req.user, req.query);
  res.json({ analytics: data });
}

/* ---------------- Excel export ---------------- */

/** Builds the workbook with exceljs (multi-sheet, styled headers). */
export async function buildWorkbook(sheets) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LLCC DMS';
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Sheet', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    for (const row of sheet.rows || []) ws.addRow(row);
    // Style the first row as a header band
    const headerRow = ws.getRow(1);
    if (headerRow) {
      headerRow.font = { bold: true, color: { argb: 'FF0B2F5B' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    }
    ws.columns = (sheet.rows?.[0] || []).map((_, i) => ({
      width: Math.min(46, Math.max(12, ...((sheet.rows || []).map((r) => String(r[i] ?? '').length + 2)))),
    }));
  }
  return wb.xlsx.writeBuffer();
}

function analyticsSheets(a) {
  const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  return [
    { name: 'Summary', rows: [
      ['LLCC Document Management - Analytics Report'],
      ['Generated', new Date(a.generatedAt).toLocaleString()],
      ['Scope', a.scopeLabel],
      ['Filters', JSON.stringify(a.filtersApplied)],
      [],
      ['Metric', 'Value'],
      ['Total Documents', a.totals.documents],
      ['Total Revisions', a.totals.revisions],
      ['Avg Revisions / Doc', a.totals.avgRevisions],
      ['Registered Users', a.totals.users],
      ['Departments', a.totals.departments],
      ['Pending Approval', a.totals.pending],
      ['Final Review', a.totals.finalReview],
      ['Approved', a.totals.approved],
      ['Rejected', a.totals.rejected],
      ['Draft', a.totals.draft],
      ['Revision Requested', a.totals.revisionRequested],
      ['Archived', a.totals.archived],
      ['Approval Rate (%)', a.approvalRate],
      ['Expiring Within 30 Days', a.totals.expiringSoon],
      ['Expired', a.totals.expired],
    ]},
    { name: 'By Department', rows: [['Department', 'Documents'], ...a.byDepartment.map((r) => [r.department, r.count])] },
    { name: 'By Category', rows: [['Category', 'Documents'], ...a.byCategory.map((r) => [r.category, r.count])] },
    { name: 'By Uploader', rows: [['Uploader', 'Documents'], ...a.byUploader.map((r) => [r.uploader, r.count])] },
    { name: 'By Status', rows: [['Status', 'Documents'], ...a.byStatus.map((r) => [r.status, r.count])] },
    { name: 'Monthly Uploads', rows: [['Month', 'Uploads'], ...a.monthlyUploads.map((m) => [m.label, m.count])] },
    { name: 'Pending Documents', rows: [
      ['Title', 'Department', 'Status', 'Updated'],
      ...a.pendingDocuments.map((d) => [d.title, d.department || '', d.status, iso(d.updatedAt)]),
    ] },
    { name: 'Documents', rows: [
      ['Title', 'Department', 'Category', 'Status', 'Revisions', 'Uploader', 'Created', 'Updated', 'Expires'],
      ...a.recentUploads.map((d) => [d.title, d.department?.name || '', d.category, d.status, d.revisionCount, d.uploader?.name || '', iso(d.createdAt), iso(d.updatedAt), iso(d.expiresAt)]),
    ]},
    { name: 'Expiring Soon', rows: [['Title', 'Department', 'Status', 'Expires'], ...a.expiringSoon.map((d) => [d.title, d.department?.name || '', d.status, iso(d.expiresAt)])] },
    { name: 'Expired', rows: [['Title', 'Department', 'Status', 'Expired On'], ...a.expired.map((d) => [d.title, d.department?.name || '', d.status, iso(d.expiresAt)])] },
    { name: 'Filters Applied', rows: [['Filter', 'Value'], ...Object.entries(a.filtersApplied).map(([k, v]) => [k, v ?? ''])] },
  ];
}

export async function exportExcel(req, res) {
  if (!canExportReports(req.user)) return res.status(403).json({ message: 'Insufficient permissions to export reports' });
  const a = await buildAnalytics(req.user, req.query);
  const buffer = Buffer.from(await buildWorkbook(analyticsSheets(a)));
  await logAudit({ userId: req.user.id, action: 'EXPORT_REPORT_EXCEL', entityType: 'Report', details: { bytes: buffer.length, filters: a.filtersApplied }, req });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="llcc-analytics-${Date.now()}.xlsx"`);
  res.send(buffer);
}

/* ---------------- PDF export ---------------- */

async function buildPdf(a) {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'LLCC Analytics Report', Author: 'LLCC DMS' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const NAVY = '#0B2F5B';
    const LIGHT = '#EAF3FF';
    const GREY = '#64748B';

    const heading = (t) => { doc.moveDown(0.6).fontSize(13).fillColor(NAVY).text(t, { underline: false }); doc.moveDown(0.3).fontSize(9.5).fillColor('#182230'); };
    const table = (headers, rows, widths) => {
      const startY = doc.y;
      const rowH = 16;
      let y = startY;
      // header
      doc.rect(48, y, 500, rowH).fill(LIGHT);
      let x = 52;
      doc.fillColor(NAVY).fontSize(8.5);
      headers.forEach((h, i) => { doc.text(String(h), x, y + 4, { width: widths[i] - 6, ellipsis: true, lineBreak: false }); x += widths[i]; });
      y += rowH;
      doc.fillColor('#182230').fontSize(8.5);
      rows.forEach((r, ri) => {
        if (y > 760) { doc.addPage(); y = 60; }
        if (ri % 2 === 1) { doc.rect(48, y, 500, rowH).fill('#F7FBFF'); doc.fillColor('#182230'); }
        x = 52;
        r.forEach((c, i) => { doc.text(String(c ?? ''), x, y + 4, { width: widths[i] - 6, ellipsis: true, lineBreak: false }); x += widths[i]; });
        y += rowH;
      });
      doc.y = y + 6;
    };

    // Header band
    doc.rect(0, 0, 595, 84).fill(NAVY);
    doc.fillColor('#FFFFFF').fontSize(20).text('LLCC Document Management', 48, 26, { lineBreak: false });
    doc.fontSize(10).fillColor('#9FD0FF').text('Analytics & Reports', 48, 52, { lineBreak: false });
    doc.fillColor('#FFFFFF').fontSize(8.5).text(`Generated ${new Date(a.generatedAt).toLocaleString()}  |  Scope: ${a.scopeLabel}`, 48, 66, { lineBreak: false, width: 500 });
    if (a.filtersApplied.from || a.filtersApplied.to || a.filtersApplied.departmentId) {
      doc.fontSize(7.5).fillColor('#9FD0FF').text(`Filters: ${JSON.stringify(a.filtersApplied)}`, 48, 78, { lineBreak: false, width: 500 });
    }
    doc.y = 100;

    doc.fillColor(NAVY).fontSize(14).text('Summary');
    doc.moveDown(0.3);
    const t = a.totals;
    table(['Metric', 'Value'], [
      ['Total Documents', t.documents], ['Total Revisions', t.revisions], ['Avg Revisions / Document', t.avgRevisions],
      ['Registered Users', t.users], ['Departments', t.departments], ['Pending Approval', t.pending],
      ['Final Review', t.finalReview], ['Approved', t.approved], ['Rejected', t.rejected], ['Draft', t.draft],
      ['Revision Requested', t.revisionRequested], ['Archived', t.archived], ['Approval Rate (%)', a.approvalRate],
      ['Expiring Within 30 Days', t.expiringSoon], ['Expired', t.expired],
    ], [330, 170]);

    heading('Documents by Department');
    table(['Department', 'Documents'], a.byDepartment.map((r) => [r.department, r.count]), [380, 120]);

    heading('Documents by Category');
    table(['Category', 'Documents'], a.byCategory.map((r) => [r.category, r.count]), [380, 120]);

    heading('Documents by Uploader (top 10)');
    table(['Uploader', 'Documents'], a.byUploader.map((r) => [r.uploader, r.count]), [380, 120]);

    heading('Documents by Status');
    table(['Status', 'Documents'], a.byStatus.map((r) => [r.status, r.count]), [380, 120]);

    heading('Monthly Uploads (last 12 months)');
    table(['Month', 'Uploads'], a.monthlyUploads.map((m) => [m.label, m.count]), [380, 120]);

    heading('Pending / Final Review Documents');
    if (a.pendingDocuments.length) {
      table(['Title', 'Department', 'Status', 'Updated'],
        a.pendingDocuments.map((d) => [d.title, d.department || '', d.status, new Date(d.updatedAt).toLocaleDateString()]),
        [200, 130, 95, 75]);
    } else { doc.fillColor(GREY).text('No documents awaiting approval.'); doc.fillColor('#182230'); }

    heading('Recently Uploaded Documents');
    table(['Title', 'Department', 'Status', 'Rev', 'Updated'],
      a.recentUploads.map((d) => [d.title, d.department?.name || '', d.status, d.revisionCount, new Date(d.updatedAt).toLocaleDateString()]),
      [190, 130, 80, 40, 60]);

    heading('Expiring Within 30 Days');
    if (a.expiringSoon.length) {
      table(['Title', 'Department', 'Expires'], a.expiringSoon.map((d) => [d.title, d.department?.name || '', new Date(d.expiresAt).toLocaleDateString()]), [240, 160, 100]);
    } else { doc.fillColor(GREY).text('No documents expiring in the next 30 days.'); doc.fillColor('#182230'); }

    heading('Expired Documents');
    if (a.expired.length) {
      table(['Title', 'Department', 'Expired On'], a.expired.map((d) => [d.title, d.department?.name || '', new Date(d.expiresAt).toLocaleDateString()]), [240, 160, 100]);
    } else { doc.fillColor(GREY).text('No expired documents.'); doc.fillColor('#182230'); }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(GREY).fontSize(7.5)
        .text(`LLCC DMS - Analytics Report - Page ${i + 1} of ${range.count}`, 48, 812, { width: 500, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

export async function exportPdf(req, res) {
  if (!canExportReports(req.user)) return res.status(403).json({ message: 'Insufficient permissions to export reports' });
  const a = await buildAnalytics(req.user, req.query);
  const buffer = await buildPdf(a);
  await logAudit({ userId: req.user.id, action: 'EXPORT_REPORT_PDF', entityType: 'Report', details: { bytes: buffer.length, filters: a.filtersApplied }, req });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="llcc-analytics-${Date.now()}.pdf"`);
  res.send(buffer);
}
