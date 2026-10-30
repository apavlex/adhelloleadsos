/**
 * SEO Q&A hub per workspace — source of truth for site Q&A pages.
 * Persists under workspace.seoQa; public sites read via publish token.
 */
const crypto = require('crypto');
const dbService = require('./database');

const TOKEN_KV_PREFIX = 'seoQaToken:';
const DEFAULT_CATEGORIES = [
  'General',
  'LVP & Vinyl',
  'Hardwood',
  'Pets',
  'Kitchens & Countertops',
  'Installation',
];

function newQuestionId() {
  return `qa_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function newPublicToken() {
  return `sqa_${crypto.randomBytes(18).toString('hex')}`;
}

function clean(v, max = 500) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function emptyBundle(workspaceId) {
  return {
    workspaceId: String(workspaceId || ''),
    settings: {
      pageUrl: '',
      pageTitle: 'Questions & Answers',
      businessName: '',
      categories: DEFAULT_CATEGORIES.slice(),
      publicToken: '',
      notifyOnSubmit: true,
    },
    questions: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeQuestion(raw, fallbackId) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const id = clean(q.id || fallbackId || newQuestionId(), 80) || newQuestionId();
  const status = ['open', 'answered', 'hidden'].includes(q.status) ? q.status : 'open';
  const answer = clean(q.answer, 4000);
  return {
    id,
    question: clean(q.question, 500),
    context: clean(q.context, 800),
    category: clean(q.category, 80) || 'General',
    author: clean(q.author, 120) || 'Visitor',
    answer,
    answerDetail: clean(q.answerDetail, 800),
    answerBy: clean(q.answerBy, 120),
    status: answer && status === 'open' ? 'answered' : status,
    published: q.published === true,
    upvotes: Math.max(0, Number(q.upvotes) || 0),
    source: clean(q.source, 40) || 'manual',
    importKey: clean(q.importKey, 200),
    linkText: clean(q.linkText, 120),
    linkUrl: clean(q.linkUrl, 500),
    createdAt: q.createdAt || new Date().toISOString(),
    answeredAt: q.answeredAt || (answer ? new Date().toISOString() : null),
    publishedAt: q.publishedAt || (q.published === true ? new Date().toISOString() : null),
    updatedAt: q.updatedAt || new Date().toISOString(),
  };
}

async function load(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return emptyBundle('');
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const raw = ws.seoQa && typeof ws.seoQa === 'object' ? ws.seoQa : null;
  const base = emptyBundle(wid);
  if (!raw) return { ...base, workspace: ws };
  const settings = {
    ...base.settings,
    ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
  };
  if (!Array.isArray(settings.categories) || !settings.categories.length) {
    settings.categories = DEFAULT_CATEGORIES.slice();
  } else {
    settings.categories = settings.categories.map((c) => clean(c, 80)).filter(Boolean).slice(0, 24);
  }
  const questions = {};
  const src = raw.questions && typeof raw.questions === 'object' ? raw.questions : {};
  for (const [id, row] of Object.entries(src)) {
    if (!row || typeof row !== 'object') continue;
    questions[id] = normalizeQuestion(row, id);
  }
  return {
    workspaceId: wid,
    settings,
    questions,
    updatedAt: raw.updatedAt || null,
    workspace: ws,
  };
}

async function save(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  const prev = await load(wid);
  const ws = prev.workspace || (await dbService.getWorkspace(wid)) || { id: wid };
  const nextSettings = {
    ...prev.settings,
    ...((patch && patch.settings) || {}),
  };
  if (Array.isArray(patch && patch.settings && patch.settings.categories)) {
    nextSettings.categories = patch.settings.categories
      .map((c) => clean(c, 80))
      .filter(Boolean)
      .slice(0, 24);
  }
  let questions = { ...prev.questions };
  if (patch && patch.questions && typeof patch.questions === 'object') {
    questions = {};
    for (const [id, row] of Object.entries(patch.questions)) {
      if (!row) continue;
      questions[id] = normalizeQuestion(row, id);
    }
  }
  const next = {
    workspaceId: wid,
    settings: nextSettings,
    questions,
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveWorkspace(wid, { ...ws, id: wid, seoQa: next });
  await indexPublicToken(wid, next.settings.publicToken, prev.settings.publicToken);
  return { ...next, workspace: { ...ws, seoQa: next } };
}

async function indexPublicToken(workspaceId, token, prevToken) {
  const wid = String(workspaceId || '').trim();
  const next = clean(token, 80);
  const prev = clean(prevToken, 80);
  if (prev && prev !== next) {
    try {
      dbService.deleteKvSync(TOKEN_KV_PREFIX + prev);
    } catch (_) {
      /* ignore */
    }
  }
  if (next) {
    dbService.setKvSync(TOKEN_KV_PREFIX + next, { workspaceId: wid, at: new Date().toISOString() });
  }
}

async function ensurePublicToken(workspaceId) {
  const bundle = await load(workspaceId);
  if (bundle.settings.publicToken) return bundle;
  return save(workspaceId, {
    settings: { ...bundle.settings, publicToken: newPublicToken() },
  });
}

async function resolveWorkspaceIdByToken(token) {
  const t = clean(token, 80);
  if (!t || !t.startsWith('sqa_')) return '';
  let raw = dbService.getKvSync(TOKEN_KV_PREFIX + t);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return '';
    if (s.startsWith('{')) {
      try {
        raw = JSON.parse(s);
      } catch {
        return s;
      }
    } else {
      return s;
    }
  }
  if (raw && typeof raw === 'object' && raw.workspaceId) return String(raw.workspaceId);
  return '';
}

function listQuestions(bundle, { status, published } = {}) {
  let rows = Object.values((bundle && bundle.questions) || {}).filter(Boolean);
  if (status) rows = rows.filter((q) => q.status === status);
  if (published === true) rows = rows.filter((q) => q.published === true);
  if (published === false) rows = rows.filter((q) => q.published !== true);
  return rows.sort((a, b) => {
    const ao = a.status === 'open' ? 0 : 1;
    const bo = b.status === 'open' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
}

function inboxSummary(bundle) {
  const rows = Object.values((bundle && bundle.questions) || {});
  return {
    total: rows.length,
    open: rows.filter((q) => q.status === 'open').length,
    answered: rows.filter((q) => q.status === 'answered').length,
    published: rows.filter((q) => q.published === true && q.status === 'answered').length,
    hidden: rows.filter((q) => q.status === 'hidden').length,
  };
}

async function upsertQuestion(workspaceId, question) {
  const bundle = await load(workspaceId);
  const next = normalizeQuestion(question, question && question.id);
  if (!next.question) {
    const err = new Error('Question text is required.');
    err.code = 'INVALID';
    throw err;
  }
  bundle.questions[next.id] = {
    ...bundle.questions[next.id],
    ...next,
    updatedAt: new Date().toISOString(),
  };
  const saved = await save(workspaceId, { questions: bundle.questions, settings: bundle.settings });
  return saved.questions[next.id];
}

async function answerQuestion(workspaceId, questionId, { answer, answerDetail, answerBy, publish } = {}) {
  const bundle = await load(workspaceId);
  const id = String(questionId || '');
  const prev = bundle.questions[id];
  if (!prev) {
    const err = new Error('Question not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const text = clean(answer, 4000);
  if (!text) {
    const err = new Error('Answer text is required.');
    err.code = 'INVALID';
    throw err;
  }
  const now = new Date().toISOString();
  const shouldPublish = publish === true || (publish !== false && prev.published === true);
  bundle.questions[id] = {
    ...prev,
    answer: text,
    answerDetail: clean(answerDetail != null ? answerDetail : prev.answerDetail, 800),
    answerBy: clean(answerBy != null ? answerBy : prev.answerBy || bundle.settings.businessName, 120),
    status: 'answered',
    published: shouldPublish,
    answeredAt: now,
    publishedAt: shouldPublish ? prev.publishedAt || now : null,
    updatedAt: now,
  };
  const saved = await save(workspaceId, { questions: bundle.questions, settings: bundle.settings });
  return saved.questions[id];
}

async function setPublished(workspaceId, questionId, published) {
  const bundle = await load(workspaceId);
  const id = String(questionId || '');
  const prev = bundle.questions[id];
  if (!prev) {
    const err = new Error('Question not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (published && (!prev.answer || prev.status === 'hidden')) {
    const err = new Error('Only answered questions can be published.');
    err.code = 'INVALID';
    throw err;
  }
  const now = new Date().toISOString();
  bundle.questions[id] = {
    ...prev,
    published: !!published,
    publishedAt: published ? prev.publishedAt || now : null,
    updatedAt: now,
  };
  const saved = await save(workspaceId, { questions: bundle.questions, settings: bundle.settings });
  return saved.questions[id];
}

async function hideQuestion(workspaceId, questionId) {
  const bundle = await load(workspaceId);
  const id = String(questionId || '');
  const prev = bundle.questions[id];
  if (!prev) {
    const err = new Error('Question not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  bundle.questions[id] = {
    ...prev,
    status: 'hidden',
    published: false,
    updatedAt: new Date().toISOString(),
  };
  const saved = await save(workspaceId, { questions: bundle.questions, settings: bundle.settings });
  return saved.questions[id];
}

/** Merge imported rows; match by importKey or normalized question text. */
async function mergeImported(workspaceId, rows, { publishImported = true } = {}) {
  const bundle = await load(workspaceId);
  const byKey = new Map();
  const byText = new Map();
  for (const q of Object.values(bundle.questions)) {
    if (q.importKey) byKey.set(q.importKey, q.id);
    byText.set(clean(q.question, 500).toLowerCase(), q.id);
  }
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();
  for (const row of Array.isArray(rows) ? rows : []) {
    const question = clean(row.question, 500);
    if (!question) continue;
    const importKey = clean(row.importKey || row.id, 200);
    const existingId =
      (importKey && byKey.get(importKey)) || byText.get(question.toLowerCase()) || null;
    const answer = clean(row.answer, 4000);
    const payload = {
      question,
      context: row.context,
      category: row.category,
      author: row.author,
      answer,
      answerDetail: row.answerDetail,
      answerBy: row.answerBy,
      upvotes: row.upvotes,
      linkText: row.linkText,
      linkUrl: row.linkUrl,
      source: row.source || 'import',
      importKey: importKey || `import:${question.toLowerCase().slice(0, 80)}`,
      status: answer ? 'answered' : 'open',
      published: !!(publishImported && answer),
    };
    if (existingId) {
      const prev = bundle.questions[existingId];
      bundle.questions[existingId] = normalizeQuestion(
        {
          ...prev,
          ...payload,
          id: existingId,
          createdAt: prev.createdAt,
          answeredAt: answer ? prev.answeredAt || now : prev.answeredAt,
          publishedAt: payload.published ? prev.publishedAt || now : prev.publishedAt,
          // Keep manual edits if already answered from dashboard and import has no stronger answer
          answer: answer || prev.answer,
          published: prev.published || payload.published,
        },
        existingId
      );
      updated += 1;
    } else {
      const id = newQuestionId();
      bundle.questions[id] = normalizeQuestion({ ...payload, id, createdAt: now }, id);
      byKey.set(payload.importKey, id);
      byText.set(question.toLowerCase(), id);
      added += 1;
    }
  }
  const cats = new Set(bundle.settings.categories || []);
  for (const q of Object.values(bundle.questions)) {
    if (q.category) cats.add(q.category);
  }
  bundle.settings.categories = [...cats].slice(0, 24);
  await save(workspaceId, { questions: bundle.questions, settings: bundle.settings });
  return { added, updated, total: Object.keys(bundle.questions).length };
}

module.exports = {
  TOKEN_KV_PREFIX,
  DEFAULT_CATEGORIES,
  newQuestionId,
  newPublicToken,
  emptyBundle,
  normalizeQuestion,
  load,
  save,
  ensurePublicToken,
  resolveWorkspaceIdByToken,
  listQuestions,
  inboxSummary,
  upsertQuestion,
  answerQuestion,
  setPublished,
  hideQuestion,
  mergeImported,
  clean,
};
