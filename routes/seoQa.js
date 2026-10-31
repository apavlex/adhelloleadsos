/**
 * SEO Q&A Pages — dashboard inbox to import, answer, publish website questions.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const seoQaStore = require('../services/seoQaStore');
const seoQaImport = require('../services/seoQaImport');
const seoQaPublic = require('../services/seoQaPublic');
const { buildSeoQaPagePrompt } = require('../services/seoQaPagePrompt');
const { wantsJsonResponse } = require('../lib/httpRequest');

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function pageLocals(req) {
  const ws = req.workspace || (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  let bundle = await seoQaStore.ensurePublicToken(req.workspaceId);
  if (!bundle.settings.businessName) {
    const intake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
    bundle = await seoQaStore.save(req.workspaceId, {
      settings: {
        ...bundle.settings,
        businessName: intake.businessName || ws.name || '',
      },
      questions: bundle.questions,
    });
  }
  const questions = seoQaStore.listQuestions(bundle);
  const summary = seoQaStore.inboxSummary(bundle);
  const token = bundle.settings.publicToken;
  const origin = baseUrlFromReq(req);
  const feedUrl = token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/feed.json` : '';
  const submitUrl = token ? `${origin}/api/public/seo-qa/${encodeURIComponent(token)}/questions` : '';
  return {
    title: 'Q&A Pages',
    activePage: 'seo-qa',
    settings: bundle.settings,
    questions,
    summary,
    feedUrl,
    submitUrl,
    focusQuestionId: String(req.query.q || '').trim(),
    workspaceName: (ws && ws.name) || 'Your workspace',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    locals.pageBuilderPrompt = buildSeoQaPagePrompt({
      siteUrl: 'https://adhello.io',
      pagePath: '/questions',
      businessName: locals.settings.businessName || locals.workspaceName || 'Your Business',
      pageTitle: locals.settings.pageTitle || 'Questions & Answers',
      categories: locals.settings.categories,
      feedUrl: locals.feedUrl,
      submitUrl: locals.submitUrl,
    });
    locals.faqPreview = seoQaPublic.buildFaqSchema(
      locals.questions.filter((q) => q.published && q.status === 'answered'),
      locals.settings.pageUrl
    );
    res.render('seo_qa', locals);
  } catch (e) {
    next(e);
  }
});

router.get('/inbox.json', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    res.json({
      success: true,
      settings: locals.settings,
      summary: locals.summary,
      questions: locals.questions,
      feedUrl: locals.feedUrl,
      submitUrl: locals.submitUrl,
    });
  } catch (e) {
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
