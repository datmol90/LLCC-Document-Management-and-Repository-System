import prisma from '../utils/prisma.js';
import { documentScopeWhere } from '../utils/permissions.js';
import { logAudit } from '../utils/audit.js';

/**
 * AI-Powered Document Assistant.
 *
 * Parses natural-language questions into a structured intent, executes it
 * against ONLY the documents the requesting user is allowed to see, and
 * returns a generated answer plus the underlying results.
 *
 * Every query is clamped by `documentScopeWhere(user)` so the assistant can
 * never leak documents outside the caller's permissions.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'that', 'this', 'these', 'those', 'it', 'its', 'with', 'from', 'by', 'at', 'as', 'we', 'our', 'my', 'me', 'i', 'you', 'your', 'show', 'find', 'list', 'get', 'give', 'tell', 'me', 'please', 'all', 'any', 'some', 'documents', 'document', 'docs', 'file', 'files', 'summarize', 'summary', 'compare', 'version', 'versions']);

function normalize(s) { return String(s || '').toLowerCase().trim(); }

/** Pulls status keywords out of the question. */
function detectStatuses(q) {
  const map = {
    pending: ['PENDING'], awaiting: ['PENDING'], approval: ['PENDING'], approvals: ['PENDING'], approve: ['APPROVED'],
    approved: ['APPROVED'], rejected: ['REJECTED'], reject: ['REJECTED'], denied: ['REJECTED'],
    draft: ['DRAFT'], drafts: ['DRAFT'], archived: ['ARCHIVED'], archive: ['ARCHIVED'],
    revision: ['REVISION_REQUESTED'], revisions: ['REVISION_REQUESTED'], revise: ['REVISION_REQUESTED'],
    expired: ['__EXPIRED__'], expiring: ['__EXPIRING__'],
  };
  const found = new Set();
  for (const [word, statuses] of Object.entries(map)) {
    if (new RegExp(`\\b${word}\\b`).test(q)) statuses.forEach((s) => found.add(s));
  }
  return [...found];
}

/** Detects "my", department names, categories, uploaders, and date ranges. */
async function detectFilters(q, user) {
  const filters = { departmentId: undefined, uploaderId: undefined, category: undefined, mine: false, days: undefined, month: undefined, year: undefined };

  if (/\b(my|mine|i (uploaded|added|created|submitted))\b/.test(q)) filters.uploaderId = user.id;

  // Department by name or code
  const departments = await prisma.department.findMany({ select: { id: true, name: true, code: true } });
  for (const d of departments) {
    const name = normalize(d.name);
    const code = normalize(d.code);
    if (q.includes(name) || (code.length >= 2 && new RegExp(`\\b${code}\\b`).test(q))) { filters.departmentId = d.id; break; }
  }

  // Relative dates
  if (/\b(last|past|previous)\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/.test(q)) {
    const m = q.match(/(\d+)\s+(day|days|week|weeks|month|months|year|years)/);
    const n = parseInt(m[1]);
    const unit = m[2].replace(/s$/, '');
    const mult = { day: 1, week: 7, month: 30, year: 365 }[unit] || 1;
    filters.days = n * mult;
  } else if (/\b(today|yesterday|this week|this month|this year)\b/.test(q)) {
    if (q.includes('today')) filters.days = 1;
    else if (q.includes('yesterday')) filters.days = 2;
    else if (q.includes('this week')) filters.days = 7;
    else if (q.includes('this month')) filters.days = 30;
    else if (q.includes('this year')) filters.days = 365;
  }

  const monthHit = MONTHS.find((m) => q.includes(m));
  if (monthHit) filters.month = MONTHS.indexOf(monthHit);
  const yearMatch = q.match(/\b(20\d{2})\b/);
  if (yearMatch) filters.year = parseInt(yearMatch[1]);

  return filters;
}

/** Extracts free-text search terms after removing detected intent words. */
function extractTerms(q, filters, statuses) {
  let s = q;
  // strip detected phrases (including the deterministic summarize/compare forms)
  s = s.replace(/^summarize\s+/g, ' ');
  s = s.replace(/\bcompare\s+version\s+\d+\s+and\s+\d+\s+of\s+/g, ' ');
  s = s.replace(/\bversion\s+\d+\b/g, ' ');
  s = s.replace(/\b(last|past|previous)\s+\d+\s+(days?|weeks?|months?|years?)\b/g, ' ');
  s = s.replace(/\b(today|yesterday|this week|this month|this year)\b/g, ' ');
  s = s.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, ' ');
  s = s.replace(/\b(20\d{2})\b/g, ' ');
  s = s.replace(/\b(pending|awaiting|approval|approvals|approved|rejected|reject|denied|draft|drafts|archived|archive|revision|revisions|revise|expired|expiring)\b/g, ' ');
  if (filters.mine || filters.uploaderId) s = s.replace(/\b(my|mine)\b/g, ' ');
  s = s.replace(/\b(in|from|of|by|uploaded|added|created|submitted|expired|expiring|soon)\b/g, ' ');

  const terms = normalize(s).split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

function buildAnswer({ intent, result, terms, statuses, filters, user }) {
  const scope = user.role === 'SUPER_ADMIN' || user.role === 'DEAN'
    ? 'across all departments'
    : `within ${user.department?.name || 'your department'}`;

  if (intent === 'count') {
    const what = statuses.length ? statuses.filter((s) => !s.startsWith('__')).map((s) => s.toLowerCase().replace('_', ' ')).join('/') : 'documents';
    const when = filters.days ? ` from the last ${filters.days} day(s)` : '';
    const where = filters.departmentId ? ' in that department' : (filters.uploaderId ? ' that you uploaded' : scope);
    return `You have **${result.total}** ${what} document${result.total === 1 ? '' : 's'}${when}${where}.`;
  }

  if (intent === 'summary') {
    const t = result.stats;
    return [
      `Here's the overview ${scope}:`,
      `• **${t.documents}** total documents`,
      `• **${t.approved}** approved, **${t.pending}** pending approval, **${t.draft}** draft`,
      `• **${t.rejected}** rejected, **${t.archived}** archived`,
      `• **${t.revisions}** cumulative revisions (avg ${t.avgRevisions}/doc)`,
      t.expiringSoon ? `• **${t.expiringSoon}** expiring within 30 days` : '',
    ].filter(Boolean).join('\n');
  }

  if (intent === 'top') {
    if (!result.rows.length) return `I couldn't find any documents ${scope}${terms.length ? ` matching "${terms.join(' ')}"` : ''}.`;
    const label = result.groupBy === 'department' ? 'departments' : result.groupBy === 'category' ? 'categories' : 'uploaders';
    return `Top ${label} by document count ${scope}:\n` +
      result.rows.map((r, i) => `${i + 1}. **${r.label}** — ${r.count} document${r.count === 1 ? '' : 's'}`).join('\n');
  }

  // search
  if (!result.documents.length) {
    return `I couldn't find any documents ${scope}${terms.length ? ` matching "${terms.join(' ')}"` : ''}. Try different keywords, or clear the status filter.`;
  }
  const head = terms.length
    ? `Found **${result.total}** document${result.total === 1 ? '' : 's'} for "${terms.join(' ')}"${statuses.length ? ` with status ${statuses.filter((s) => !s.startsWith('__')).join(', ')}` : ''} ${scope}:`
    : `Found **${result.total}** document${result.total === 1 ? '' : 's'} ${scope}:`;
  const list = result.documents.slice(0, 8)
    .map((d) => `• **${d.title}** — ${d.department?.name || '—'} · ${d.status.replace('_', ' ').toLowerCase()} · Rev ${d.revisionCount} · updated ${new Date(d.updatedAt).toLocaleDateString()}`)
    .join('\n');
  const more = result.total > 8 ? `\n…and ${result.total - 8} more.` : '';
  return `${head}\n${list}${more}`;
}

function classify(q) {
  if (/\b(how many|count|number of|total of|what is the total)\b/.test(q)) return 'count';
  if (/\b(overview|summary|statistics|stats|dashboard|analytic|breakdown)\b/.test(q)) return 'summary';
  if (/\b(top|most|busiest|which department|which category|which staff|highest)\b/.test(q)) return 'top';
  return 'search';
}

/* ---------------- Optional OpenAI-compatible provider ---------------- */

const AI_SYSTEM_PROMPT = `You are the LLCC document assistant. Use ONLY the documents supplied in the context, which are already permission-scoped for the requesting user. Cite document titles and revision numbers for every claim. If the answer is not present in the supplied documents, reply exactly "I don't know". Never invent titles, revisions, or content. Keep answers concise.`;

async function askExternalAi(question, context) {
  if (!process.env.AI_API_URL || !process.env.AI_API_KEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(process.env.AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Question: ${question}\nContext (JSON): ${JSON.stringify(context)}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (err) {
    console.error('assistant AI provider failed', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Deterministic handlers for "summarize X" and "compare version N and M of X". */
async function specialQuestionAnswer(question, payload) {
  const q = normalize(question);
  const summarize = q.match(/^summarize\s+(.+)$/);
  const compare = q.match(/^compare\s+version\s+(\d+)\s+and\s+(\d+)\s+of\s+(.+)$/);
  if (!summarize && !compare) return null;
  const docs = payload.documents || [];
  if (!docs.length) return `I don't have an authorized document matching that title, so I can't answer that.`;
  const needle = normalize(summarize ? summarize[1] : compare[3]);
  const best = docs.find((d) => normalize(d.title) === needle)
    || docs.find((d) => normalize(d.title).includes(needle))
    || docs.find((d) => needle.includes(normalize(d.title)))
    || docs[0];
  if (summarize) {
    const full = await prisma.document.findUnique({
      where: { id: best.id },
      include: { department: true, versions: { orderBy: { versionNumber: 'desc' }, take: 3 } },
    });
    if (!full) return `I don't have an authorized document matching that title, so I can't answer that.`;
    const latest = full.versions[0];
    return `Summary of **${full.title}** (Rev ${full.revisionCount}, ${full.status.replace('_', ' ').toLowerCase()}, ${full.department?.name || 'no department'}):\n` +
      `${full.description ? full.description + '\n' : ''}` +
      (latest ? `Latest revision ${latest.versionNumber} (${new Date(latest.createdAt).toLocaleDateString()}): ${latest.changeNotes || 'No change notes supplied.'}` : 'No revision history is available.');
  }
  const v1 = Number(compare[1]);
  const v2 = Number(compare[2]);
  const versions = await prisma.documentVersion.findMany({
    where: { documentId: best.id, versionNumber: { in: [v1, v2] } },
    orderBy: { versionNumber: 'asc' },
  });
  if (versions.length < 2) {
    return `I can only compare versions that exist for documents you're authorized to view; one of the requested versions of **${best.title}** was not found.`;
  }
  return `Comparison of authorized versions of **${best.title}**:\n` + versions.map((v) =>
    `• Rev ${v.versionNumber} — ${v.originalName}, ${v.fileSize} bytes, ${new Date(v.createdAt).toLocaleDateString()}; notes: ${v.changeNotes || 'none'}`
  ).join('\n');
}

export async function askAssistant(req, res) {
  const question = String(req.body?.question || '').slice(0, 500).trim();
  if (!question) return res.status(400).json({ message: 'Please enter a question' });

  const user = req.user;
  const q = normalize(question);
  const intent = classify(q);
  const statuses = detectStatuses(q);
  const filters = await detectFilters(q, user);
  const terms = extractTerms(q, filters, statuses);
  const startedAt = Date.now();

  // PERMISSION CLAMP: every query starts from the caller's allowed scope.
  // The scope may itself contain an OR (e.g. Staff: approved OR own). We lift it
  // out and re-apply it as a nested AND so later filters can never widen access.
  const scope = documentScopeWhere(user);
  const scopeOr = scope.OR;
  const where = { ...scope };
  delete where.OR;

  // status / expiry predicates
  const realStatuses = statuses.filter((s) => !s.startsWith('__'));
  const wantsExpired = statuses.includes('__EXPIRED__');
  const wantsExpiring = statuses.includes('__EXPIRING__');

  if (realStatuses.length) {
    where.AND = [...(where.AND || []), { OR: realStatuses.map((status) => ({ status })) }];
  }
  if (wantsExpired) {
    where.expiresAt = { not: null, lt: new Date() };
  } else if (wantsExpiring) {
    where.expiresAt = { not: null, gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) };
  }

  if (filters.departmentId) {
    // An explicit department request still cannot exceed the caller's scope.
    if (scope.departmentId && scope.departmentId !== filters.departmentId) {
      return res.json({
        answer: `You don't have permission to view documents in that department.`,
        intent, results: [], total: 0, elapsedMs: Date.now() - startedAt, scope: 'restricted',
      });
    }
    where.departmentId = filters.departmentId;
  }
  if (filters.uploaderId) where.uploaderId = filters.uploaderId;
  if (filters.category) where.category = { contains: filters.category };

  if (filters.days) {
    const since = new Date(Date.now() - filters.days * 86400000);
    where.createdAt = { gte: since };
  } else if (filters.month !== undefined || filters.year !== undefined) {
    // Prisma can't express month/year on SQLite directly; approximate with a range.
    const y = filters.year ?? new Date().getFullYear();
    const m = filters.month ?? 0;
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 1);
    where.createdAt = { gte: from, lt: to };
  }

  // Free-text terms -> Prisma `contains` on the permission-scoped set.
  if (terms.length && intent !== 'top') {
    const termClauses = terms.map((t) => ({
      OR: [
        { title: { contains: t } },
        { description: { contains: t } },
        { category: { contains: t } },
        { latestFileName: { contains: t } },
      ],
    }));
    // AND all terms together (each term must match somewhere).
    where.AND = [...(where.AND || []), ...termClauses];
  }

  // Re-apply the caller's own scope OR as a top-level AND constraint.
  if (scopeOr) where.AND = [...(where.AND || []), { OR: scopeOr }];

  let payload;
  try {
    if (intent === 'summary') {
      const [documents, grouped, revAgg, expiring] = await Promise.all([
        prisma.document.count({ where: scope }),
        prisma.document.groupBy({ by: ['status'], where: scope, _count: true }),
        prisma.document.aggregate({ where: scope, _sum: { revisionCount: true }, _avg: { revisionCount: true } }),
        prisma.document.count({ where: { ...scope, expiresAt: { not: null, gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) } } }),
      ]);
      const m = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
      payload = {
        stats: {
          documents,
          approved: m.APPROVED || 0, pending: m.PENDING || 0, draft: m.DRAFT || 0,
          rejected: m.REJECTED || 0, archived: m.ARCHIVED || 0, revisionRequested: m.REVISION_REQUESTED || 0,
          revisions: revAgg._sum.revisionCount || 0,
          avgRevisions: Number((revAgg._avg.revisionCount || 0).toFixed(1)),
          expiringSoon: expiring,
        },
        documents: [], total: documents,
      };
    } else if (intent === 'top') {
      const groupBy = /category/.test(q) ? 'category' : /staff|user|uploader|person|who/.test(q) ? 'uploader' : 'department';
      let rows;
      if (groupBy === 'uploader') {
        const grouped = await prisma.document.groupBy({ by: ['uploaderId'], where: scope, _count: true, orderBy: { _count: { uploaderId: 'desc' } }, take: 5 });
        const users = await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.uploaderId) } }, select: { id: true, name: true } });
        rows = grouped.map((g) => ({ label: users.find((u) => u.id === g.uploaderId)?.name || 'Unknown', count: g._count }));
      } else if (groupBy === 'category') {
        const grouped = await prisma.document.groupBy({ by: ['category'], where: scope, _count: true, orderBy: { _count: { category: 'desc' } }, take: 5 });
        rows = grouped.map((g) => ({ label: g.category, count: g._count }));
      } else {
        const grouped = await prisma.document.groupBy({ by: ['departmentId'], where: scope, _count: true, orderBy: { _count: { departmentId: 'desc' } }, take: 5 });
        const depts = await prisma.department.findMany({ where: { id: { in: grouped.map((g) => g.departmentId) } }, select: { id: true, name: true } });
        rows = grouped.map((g) => ({ label: depts.find((d) => d.id === g.departmentId)?.name || 'Unknown', count: g._count }));
      }
      payload = { rows, groupBy, documents: [], total: rows.reduce((s, r) => s + r.count, 0) };
    } else {
      const total = await prisma.document.count({ where });
      const documents = await prisma.document.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: 30,
        include: { department: { select: { name: true } }, uploader: { select: { name: true } } },
      });
      payload = { documents, total };
    }
  } catch (err) {
    console.error('assistant query failed', err);
    return res.status(500).json({ message: 'The assistant could not process that question.' });
  }

  let answer = buildAnswer({ intent, result: payload, terms, statuses, filters, user });
  let source = 'fallback';
  const special = await specialQuestionAnswer(question, payload);
  if (special) answer = special;

  // Context is limited to the documents already returned by the scoped query.
  const context = {
    stats: payload.stats || null,
    rows: payload.rows || null,
    documents: (payload.documents || []).slice(0, 10).map((d) => ({
      title: d.title, department: d.department?.name || null, status: d.status,
      revisionCount: d.revisionCount, referenceNumber: d.referenceNumber || null,
      documentType: d.documentType || null, keywords: d.keywords || null,
      updatedAt: d.updatedAt, description: d.description || null,
    })),
  };
  const aiAnswer = await askExternalAi(question, context);
  if (aiAnswer) { answer = aiAnswer; source = 'ai'; }

  await logAudit({
    userId: user.id, action: 'ASSISTANT_QUERY', entityType: 'Assistant', entityId: null,
    details: { question, intent, results: payload.total ?? 0, source }, req,
  });
  await logAudit({
    userId: user.id, action: source === 'ai' ? 'ASSISTANT_AI_USED' : 'ASSISTANT_FALLBACK', entityType: 'Assistant', entityId: null,
    details: { question, source }, req,
  });

  res.json({
    answer,
    intent,
    total: payload.total ?? 0,
    results: payload.documents || [],
    stats: payload.stats || null,
    rows: payload.rows || null,
    elapsedMs: Date.now() - startedAt,
    scope: user.role === 'SUPER_ADMIN' || user.role === 'DEAN' ? 'all' : 'department',
    source,
  });
}
