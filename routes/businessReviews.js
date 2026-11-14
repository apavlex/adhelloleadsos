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

/**
 * HTML first paint: true empty shell (no store JSON.parse). Cards + KPIs hydrate from /inbox.json.
 */
const INBOX_JSON_LIMIT = 20;
const INBOX_HYDRATE_LIMIT = 20;

/** Slim cards for hydrate — drop oversized draft/response blobs from the JSON payload. */
function slimReviewForInbox(r) {
  if (!r || typeof r !== 'object') return r;
  const text = r.text != null ? String(r.text) : '';
  const draft = r.replyDraft != null ? String(r.replyDraft) : '';
  const owner = r.ownerResponse != null ? String(r.ownerResponse) : '';
  return {
    id: r.id,
    author: r.author || '',
    rating: r.rating,
    reviewedAt: r.reviewedAt || null,
    isNew: !!r.isNew,
    reviewLink: r.reviewLink || '',
    text: text.length > 1200 ? text.slice(0, 1200) : text,
    replyDraft: draft.length > 2000 ? draft.slice(0, 2000) : draft,
    ownerResponse: owner.length > 800 ? owner.slice(0, 800) : owner,
  };
}

function emptySummary() {
  return {
    total: 0,
    newCount: 0,
    unreplied: 0,
    withDraft: 0,
    placeRating: null,
    placeReviewsCount: null,
    placeName: '',
    lastSyncedAt: null,
    lastError: null,
    syncState: businessReviews.emptySyncState(),
  };
}

async function pageLocals(req, { inboxLimit = null, resolveOutscraper = true, shell = false } = {}) {
  const ws = req.workspace || (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  const paid = businessReviews.isPaidWorkspace(ws);
  const contact = trials.contactInfo();
  const focusId = String(req.query.review || '').trim();

  if (shell) {
    // Paint immediately — no settings/store KV reads (those contended with Reports lead scans).
    return {
      title: 'Business Reviews',
      activePage: 'business-reviews',
      paid,
      trialStatus: trials.status(ws),
      contact,
      settings: {
        query: '',
        yelpQuery: '',
        businessName: '',
        autoSync: true,
        reviewsLimit: 20,
        updatedAt: null,
      },
      store: { reviews: [], syncState: businessReviews.emptySyncState() },
      summary: emptySummary(),
      reviews: [],
      reviewsTotal: 0,
      inboxTruncated: false,
      outscraperConfigured: paid ? outscraper.isConfigured(null) : false,
      focusReviewId: focusId,
      workspaceName: (ws && ws.name) || 'Your workspace',
      syncState: businessReviews.emptySyncState(),
      inboxPending: true,
    };
  }

  // failFast: never sit on busy_timeout=5s during hydrate — return pending instead.
  const settings = businessReviews.getSettings(req.workspaceId, { failFast: true });
  // Unpaid: skip reading the full reviews JSON.
  const store = paid
    ? businessReviews.getStore(req.workspaceId, { failFast: true })
    : { reviews: [], syncState: businessReviews.emptySyncState() };
  const summary = businessReviews.inboxSummary(store);
  let outscraperConfigured = false;
  if (paid) {
    if (resolveOutscraper) {
      const integrationEnv = await businessReviews.resolveReviewsOutscraperEnv();
      outscraperConfigured = outscraper.isConfigured(integrationEnv);
    } else {
      outscraperConfigured = outscraper.isConfigured(null);
    }
  }
  const allReviews = Array.isArray(store.reviews) ? store.reviews : [];
  let reviews = allReviews;
  let inboxTruncated = false;
  if (inboxLimit != null && Number.isFinite(inboxLimit) && inboxLimit >= 0 && allReviews.length > inboxLimit) {
    reviews = allReviews.slice(0, inboxLimit);
    if (focusId && inboxLimit > 0) {
      const focused = allReviews.find((r) => r && r.id === focusId);
      if (focused && !reviews.some((r) => r.id === focusId)) {
        reviews = [focused, ...reviews].slice(0, inboxLimit);
      }
    }
    inboxTruncated = true;
  }
  return {
    title: 'Business Reviews',
    activePage: 'business-reviews',
    paid,
    trialStatus: trials.status(ws),
    contact,
    settings,
    store,
    summary,
    reviews,
    reviewsTotal: allReviews.length,
    inboxTruncated,
    outscraperConfigured,
    focusReviewId: focusId,
    workspaceName: (ws && ws.name) || 'Your workspace',
    syncState: (store && store.syncState) || businessReviews.emptySyncState(),
    inboxPending: false,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // Prefer SSR with fail-fast KV. Do NOT soft-busy on lead-list inflight — reviews
    // KV does not need the lead scan, and that gate left Loading stuck during searches.
    let locals;
    try {
      locals = await pageLocals(req, {
        inboxLimit: INBOX_HYDRATE_LIMIT,
        resolveOutscraper: false,
      });
      locals.inboxHydrate = false;
      locals.inboxHydrateLimit = INBOX_HYDRATE_LIMIT;
    } catch (e) {
      if (!isSqliteBusyError(e)) throw e;
      locals = await pageLocals(req, { shell: true });
      locals.inboxHydrate = true;
      locals.inboxHydrateLimit = INBOX_HYDRATE_LIMIT;
    }
    res.render('business_reviews', locals);
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
    // No lead-scan / switcher soft-busy — those blocked hydrate while reviews KV was free.
    // failFast getStore throws SQLITE_BUSY → pending below.
    const limitRaw = req.query && req.query.limit != null ? Number(req.query.limit) : INBOX_JSON_LIMIT;
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : INBOX_JSON_LIMIT;
    // Skip agency Outscraper resolve — Sync re-checks; hydrate uses env/configured flag.
    const locals = await pageLocals(req, { inboxLimit: limit, resolveOutscraper: false });
    res.json({
      success: true,
      paid: locals.paid,
      settings: locals.settings,
      summary: locals.summary,
      reviews: locals.paid ? (locals.reviews || []).map(slimReviewForInbox) : [],
      reviewsTotal: locals.reviewsTotal,
      inboxTruncated: locals.inboxTruncated,
      outscraperConfigured: locals.outscraperConfigured,
      syncState: locals.syncState,
    });
  } catch (e) {
    // Soft-busy: let the client retry instead of hanging behind busy_timeout until abort.
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

router.get('/sync-status', async (req, res) => {
  try {
    if (!businessReviews.isPaidWorkspace(req.workspace)) {
      return res.status(402).json({ success: false, error: 'Paid plan required.', paidOnly: true });
    }
    const status = businessReviews.getSyncStatus(req.workspaceId);
    return res.json({ success: true, ...status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Status failed' });
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

    // Default JSON clients to async+poll so Render/proxy timeouts don't kill Outscraper.
    const preferAsync =
      wantsJsonResponse(req) && body.async !== false && body.wait !== true && body.wait !== '1';

    if (preferAsync) {
      try {
        const kicked = businessReviews.startWorkspaceSyncAsync(req.workspaceId, {
          workspace: req.workspace,
          force: body.force === true || body.force === '1' || body.force === 'true' || body.force == null,
          query: body.query,
        });
        return res.json({
          success: true,
          started: !!kicked.started,
          alreadyRunning: !!kicked.alreadyRunning,
          async: true,
          syncState: kicked.syncState,
        });
      } catch (e) {
        if (e.code === 'PAID_ONLY' || e.status === 402) {
          return res.status(402).json({ success: false, error: e.message, paidOnly: true });
        }
        return res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
      }
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
