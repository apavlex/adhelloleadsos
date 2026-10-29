/**
 * Business Reviews inbox — paid Outscraper Google reviews + AI reply drafts.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const trials = require('../services/trials');
const outscraper = require('../services/outscraperClient');
const businessReviews = require('../services/businessReviews');
const { wantsJsonResponse } = require('../lib/httpRequest');

async function pageLocals(req) {
  const ws = req.workspace || (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  const paid = businessReviews.isPaidWorkspace(ws);
  const settings = businessReviews.getSettings(req.workspaceId);
  const store = businessReviews.getStore(req.workspaceId);
  const summary = businessReviews.inboxSummary(store);
  const integrationEnv = await businessReviews.resolveReviewsOutscraperEnv();
  const contact = trials.contactInfo();
  const focusId = String(req.query.review || '').trim();
  return {
    title: 'Business Reviews',
    activePage: 'business-reviews',
    paid,
    trialStatus: trials.status(ws),
    contact,
    settings,
    store,
    summary,
    reviews: store.reviews,
    outscraperConfigured: outscraper.isConfigured(integrationEnv),
    focusReviewId: focusId,
    workspaceName: (ws && ws.name) || 'Your workspace',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    res.render('business_reviews', locals);
  } catch (e) {
    next(e);
  }
});

router.get('/inbox.json', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    res.json({
      success: true,
      paid: locals.paid,
      settings: locals.settings,
      summary: locals.summary,
      reviews: locals.paid ? locals.reviews : [],
      outscraperConfigured: locals.outscraperConfigured,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const ws = req.workspace;
    if (!businessReviews.isPaidWorkspace(ws)) {
      const error = 'Business Reviews settings are available on paid plans.';
      if (wantsJsonResponse(req)) return res.status(402).json({ success: false, error, paidOnly: true });
      return res.redirect('/business-reviews?err=paid');
    }
    const body = req.body || {};
    const settings = businessReviews.saveSettings(req.workspaceId, {
      query: body.query,
      businessName: body.businessName,
      autoSync: body.autoSync === '1' || body.autoSync === true || body.autoSync === 'true',
      reviewsLimit: body.reviewsLimit,
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, settings });
    return res.redirect('/business-reviews?ok=saved');
  } catch (e) {
    next(e);
  }
});

router.post('/sync', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.query != null || body.businessName != null || body.autoSync != null) {
      businessReviews.saveSettings(req.workspaceId, {
        query: body.query,
        businessName: body.businessName,
        autoSync:
          body.autoSync === undefined
            ? undefined
            : body.autoSync === true || body.autoSync === '1' || body.autoSync === 'true',
      });
    }
    const result = await businessReviews.syncWorkspace(req.workspaceId, {
      workspace: req.workspace,
      force: body.force === true || body.force === '1' || body.force === 'true',
      query: body.query,
    });
    if (wantsJsonResponse(req)) {
      return res.json({
        success: true,
        skipped: !!result.skipped,
        newCount: result.newCount || 0,
        summary: businessReviews.inboxSummary(result.store),
        reviews: result.store.reviews,
        settings: result.settings,
      });
    }
    const q = result.newCount ? `ok=synced&new=${result.newCount}` : 'ok=synced';
    return res.redirect(`/business-reviews?${q}`);
  } catch (e) {
    if (e.code === 'PAID_ONLY' || e.status === 402) {
      if (wantsJsonResponse(req)) return res.status(402).json({ success: false, error: e.message, paidOnly: true });
      return res.redirect('/business-reviews?err=paid');
    }
    if (wantsJsonResponse(req)) {
      return res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
    }
    return res.redirect(`/business-reviews?err=${encodeURIComponent(e.message.slice(0, 120))}`);
  }
});

router.post('/reviews/:id/draft-reply', async (req, res, next) => {
  try {
    const result = await businessReviews.draftReply(req.workspaceId, req.params.id, {
      workspace: req.workspace,
      businessName: req.body && req.body.businessName,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    if (e.code === 'PAID_ONLY' || e.status === 402) {
      return res.status(402).json({ success: false, error: e.message, paidOnly: true });
    }
    return res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
  }
});

router.post('/reviews/:id/seen', async (req, res, next) => {
  try {
    if (!businessReviews.isPaidWorkspace(req.workspace)) {
      return res.status(402).json({ success: false, error: 'Paid plan required.', paidOnly: true });
    }
    const review = businessReviews.markReviewSeen(req.workspaceId, req.params.id);
    if (!review) return res.status(404).json({ success: false, error: 'Review not found.' });
    return res.json({ success: true, review });
  } catch (e) {
    next(e);
  }
});

router.post('/mark-all-seen', async (req, res, next) => {
  try {
    if (!businessReviews.isPaidWorkspace(req.workspace)) {
      return res.status(402).json({ success: false, error: 'Paid plan required.', paidOnly: true });
    }
    const store = businessReviews.markAllSeen(req.workspaceId);
    return res.json({ success: true, summary: businessReviews.inboxSummary(store) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
