/**
 * SEO Q&A Pages — dashboard inbox to import, answer, publish website questions.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const seoQaStore = require('../services/seoQaStore');
const seoQaImport = require('../services/seoQaImport');
const { buildSeoQaPagePrompt } = require('../services/seoQaPagePrompt');
const { wantsJsonResponse } = require('../lib/httpRequest');

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

/**
 * HTML first paint: true empty shell (no ensurePublicToken / question walk).
 * Cards + KPIs hydrate from /inbox.json.
 */
const INBOX_JSON_LIMIT = 20;
const INBOX_HYDRATE_LIMIT = 20;

function slimQuestionForInbox(q) {
  if (!q || typeof q !== 'object') return q;
  const question = q.question != null ? String(q.question) : '';
  const answer = q.answer != null ? String(q.answer) : '';
  const context = q.context != null ? String(q.context) : '';
  return {
    id: q.id,
    status: q.status,
    published: !!q.published,
    category: q.category || 'General',
    author: q.author || 'Visitor',
    question: question.length > 500 ? question.slice(0, 500) : question,
    context: context.length > 400 ? context.slice(0, 400) : context,
    answer: answer.length > 2000 ? answer.slice(0, 2000) : answer,
    answerDetail: q.answerDetail ? String(q.answerDetail).slice(0, 500) : '',
    answerBy: q.answerBy || '',
  };
}

function shellSettingsFromWorkspace(ws) {
  const raw = ws && ws.seoQa && typeof ws.seoQa === 'object' ? ws.seoQa : null;
  const settings = (raw && raw.settings && typeof raw.settings === 'object') ? { ...raw.settings } : {};
  const intake = ws && ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const seedName = String(intake.businessName || (ws && ws.name) || '').trim();
  if (!Array.isArray(settings.categories) || !settings.categories.length) {
    settings.categories = ['General'];
  }
  settings.businessName = String(settings.businessName || '').trim() || seedName;
  return settings;
}

async function pageLocals(req, { inboxLimit = null, shell = false } = {}) {
  const ws = req.workspace || (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  const focusQuestionId = String(req.query.q || '').trim();
  const origin = baseUrlFromReq(req);

  if (shell) {
    // Paint immediately — no ensurePublicToken write, no question clone/sort.
    const settings = shellSettingsFromWorkspace(ws);
    const token = settings.publicToken;
    return {
      title: 'Q&A Pages',
      activePage: 'seo-qa',
      settings,
      questions: [],
      questionsTotal: 0,
      inboxTruncated: false,
      summary: { total: 0, open: 0, answered: 0, published: 0, hidden: 0 },
      feedUrl: token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/feed.json` : '',
      submitUrl: token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/questions` : '',
      focusQuestionId,
      workspaceName: (ws && ws.name) || 'Your workspace',
      inboxPending: true,
    };
  }

  // Reuse req.workspace + skip full normalize on read (writes still normalize).
  // Never ensurePublicToken on GET/hydrate — that rewrote the workspace and stalled inbox.json.
  const bundle = await seoQaStore.load(req.workspaceId, { workspace: ws, normalize: false });
  const intake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const seedName = String(intake.businessName || ws.name || '').trim();
  const settings = {
    ...bundle.settings,
    businessName: String(bundle.settings.businessName || '').trim() || seedName,
  };
  const summary = seoQaStore.inboxSummary(bundle);
  const token = settings.publicToken;
  const feedUrl = token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/feed.json` : '';
  const submitUrl = token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/questions` : '';
  let questions = [];
  let questionsTotal = summary.total;
  let inboxTruncated = false;
  if (inboxLimit === 0) {
    questions = [];
    inboxTruncated = summary.total > 0;
  } else {
    const allQuestions = seoQaStore.listQuestions(bundle);
    questionsTotal = allQuestions.length;
    questions = allQuestions;
    if (inboxLimit != null && Number.isFinite(inboxLimit) && allQuestions.length > inboxLimit) {
      questions = allQuestions.slice(0, inboxLimit);
      if (focusQuestionId && inboxLimit > 0) {
        const focused = allQuestions.find((q) => q && q.id === focusQuestionId);
        if (focused && !questions.some((q) => q.id === focusQuestionId)) {
          questions = [focused, ...questions].slice(0, inboxLimit);
        }
      }
      inboxTruncated = true;
    }
  }
  return {
    title: 'Q&A Pages',
    activePage: 'seo-qa',
    settings,
    questions,
    questionsTotal,
    inboxTruncated,
    summary,
    feedUrl,
    submitUrl,
    focusQuestionId,
    workspaceName: (ws && ws.name) || 'Your workspace',
    inboxPending: false,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // Prefer SSR from req.workspace.seoQa — no lead-scan soft-busy (that froze Loading).
    let locals;
    try {
      locals = await pageLocals(req, { inboxLimit: INBOX_HYDRATE_LIMIT });
      locals.inboxHydrate = false;
      locals.inboxHydrateLimit = INBOX_HYDRATE_LIMIT;
    } catch (e) {
      if (!isSqliteBusyError(e)) throw e;
      locals = await pageLocals(req, { shell: true });
      locals.inboxHydrate = true;
      locals.inboxHydrateLimit = INBOX_HYDRATE_LIMIT;
    }
    locals.pageBuilderPrompt = '';
    locals.pageBuilderPromptUrl = '/seo-qa/page-prompt.txt';
    res.render('seo_qa', locals);
  } catch (e) {
    next(e);
  }
});

router.get('/page-prompt.txt', async (req, res, next) => {
  try {
    const locals = await pageLocals(req, { inboxLimit: 1 });
    const prompt = buildSeoQaPagePrompt({
      siteUrl: 'https://adhello.io',
      pagePath: '/questions',
      businessName: locals.settings.businessName || locals.workspaceName || 'Your Business',
      pageTitle: locals.settings.pageTitle || 'Questions & Answers',
      categories: locals.settings.categories,
      feedUrl: locals.feedUrl,
      submitUrl: locals.submitUrl,
    });
    res.type('text/plain').send(prompt);
  } catch (e) {
    next(e);
  }
});

function isSqliteBusyError(err) {
  const msg = String((err && err.message) || err || '');
  const code = String((err && (err.code || err.name)) || '');
  return /SQLITE_BUSY|database is locked|busy|locked/i.test(`${code} ${msg}`);
}

router.get('/inbox.json', async (req, res, next) => {
  try {
    // Q&A lives on the workspace doc — never soft-busy just because a lead scan is running.
    const limitRaw = req.query && req.query.limit != null ? Number(req.query.limit) : INBOX_JSON_LIMIT;
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : INBOX_JSON_LIMIT;
    const locals = await pageLocals(req, { inboxLimit: limit });
    res.json({
      success: true,
      settings: locals.settings,
      summary: locals.summary,
      questions: (locals.questions || []).map(slimQuestionForInbox),
      questionsTotal: locals.questionsTotal,
      inboxTruncated: locals.inboxTruncated,
      feedUrl: locals.feedUrl,
      submitUrl: locals.submitUrl,
    });
  } catch (e) {
    if (isSqliteBusyError(e)) {
      return res.status(503).json({
        success: false,
        pending: true,
        error: 'Inbox temporarily busy — retrying…',
      });
    }
    next(e);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const bundle = await seoQaStore.load(req.workspaceId);
    const categories = String(body.categories || '')
      .split(/\n|,/)
      .map((c) => c.trim())
      .filter(Boolean);
    const rotate = body.rotate_token === '1' || body.rotate_token === true || body.rotate_token === 'true';
    const saved = await seoQaStore.save(req.workspaceId, {
      settings: {
        ...bundle.settings,
        pageUrl: body.pageUrl != null ? body.pageUrl : bundle.settings.pageUrl,
        pageTitle: body.pageTitle != null ? body.pageTitle : bundle.settings.pageTitle,
        businessName: body.businessName != null ? body.businessName : bundle.settings.businessName,
        categories: categories.length ? categories : bundle.settings.categories,
        notifyOnSubmit:
          body.notifyOnSubmit === undefined
            ? bundle.settings.notifyOnSubmit !== false
            : body.notifyOnSubmit === '1' ||
              body.notifyOnSubmit === true ||
              body.notifyOnSubmit === 'true' ||
              body.notifyOnSubmit === 'on',
        publicToken: rotate ? seoQaStore.newPublicToken() : bundle.settings.publicToken || seoQaStore.newPublicToken(),
      },
      questions: bundle.questions,
    });
    if (wantsJsonResponse(req)) {
      return res.json({ success: true, settings: saved.settings });
    }
    return res.redirect('/seo-qa?ok=saved');
  } catch (e) {
    next(e);
  }
});

router.post('/import', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pageUrl = String(body.pageUrl || body.url || '').trim();
    const result = await seoQaImport.importFromUrl(req.workspaceId, pageUrl, {
      publishImported: body.publish !== '0' && body.publish !== false,
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, ...result });
    return res.redirect(
      `/seo-qa?ok=imported&added=${result.added}&updated=${result.updated}`
    );
  } catch (e) {
    if (wantsJsonResponse(req)) {
      return res.status(400).json({ success: false, error: e.message || 'Import failed' });
    }
    return res.redirect(`/seo-qa?err=${encodeURIComponent(e.message || 'Import failed')}`);
  }
});

router.post('/questions', async (req, res, next) => {
  try {
    const body = req.body || {};
    const row = await seoQaStore.upsertQuestion(req.workspaceId, {
      id: body.id,
      question: body.question,
      context: body.context,
      category: body.category,
      author: body.author || 'Team',
      answer: body.answer,
      answerDetail: body.answerDetail,
      answerBy: body.answerBy,
      status: body.answer ? 'answered' : 'open',
      published: body.published === true || body.published === '1' || body.published === 'on',
      source: 'manual',
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, question: row });
    return res.redirect(`/seo-qa?q=${encodeURIComponent(row.id)}&ok=created`);
  } catch (e) {
    if (wantsJsonResponse(req)) {
      return res.status(400).json({ success: false, error: e.message || 'Save failed' });
    }
    next(e);
  }
});

router.post('/questions/:id/answer', async (req, res, next) => {
  try {
    const body = req.body || {};
    const ws = req.workspace || {};
    const row = await seoQaStore.answerQuestion(req.workspaceId, req.params.id, {
      answer: body.answer,
      answerDetail: body.answerDetail,
      answerBy: body.answerBy || (ws.salesIntake && ws.salesIntake.businessName) || ws.name,
      publish: body.publish === undefined ? true : body.publish === true || body.publish === '1' || body.publish === 'on',
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, question: row });
    return res.redirect(`/seo-qa?q=${encodeURIComponent(row.id)}&ok=answered`);
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Answer failed' });
    }
    next(e);
  }
});

router.post('/questions/:id/publish', async (req, res, next) => {
  try {
    const body = req.body || {};
    const published =
      body.published === undefined
        ? true
        : body.published === true || body.published === '1' || body.published === 'on';
    const row = await seoQaStore.setPublished(req.workspaceId, req.params.id, published);
    if (wantsJsonResponse(req)) return res.json({ success: true, question: row });
    return res.redirect(`/seo-qa?q=${encodeURIComponent(row.id)}&ok=publish`);
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Publish failed' });
    }
    next(e);
  }
});

router.post('/questions/:id/hide', async (req, res, next) => {
  try {
    const row = await seoQaStore.hideQuestion(req.workspaceId, req.params.id);
    if (wantsJsonResponse(req)) return res.json({ success: true, question: row });
    return res.redirect('/seo-qa?ok=hidden');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Hide failed' });
    }
    next(e);
  }
});

module.exports = router;
