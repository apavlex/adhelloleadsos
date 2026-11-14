/**
 * SEO Directory — dashboard to curate Pipeline leads onto a public AI Studio directory.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const directoryStore = require('../services/directoryStore');
const {
  buildDirectoryPagePrompt,
  originFromPageUrl,
} = require('../services/directoryPagePrompt');
const { wantsJsonResponse } = require('../lib/httpRequest');

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function shellSettingsFromWorkspace(ws) {
  const raw = ws && ws.directory && typeof ws.directory === 'object' ? ws.directory : null;
  const settings = (raw && raw.settings && typeof raw.settings === 'object') ? { ...raw.settings } : {};
  const intake = ws && ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const seedName = String(intake.businessName || (ws && ws.name) || '').trim();
  settings.businessName = String(settings.businessName || '').trim() || seedName;
  settings.pathPrefix = String(settings.pathPrefix || '/directory').trim() || '/directory';
  return settings;
}

function isSqliteBusyError(err) {
  const msg = String((err && err.message) || err || '');
  const code = String((err && (err.code || err.name)) || '');
  return /SQLITE_BUSY|database is locked|busy|locked/i.test(`${code} ${msg}`);
}

function kickCategoryRepair(req, ws) {
  // Never await N×getLead + saveWorkspace on HTML/inbox — that left Loading stuck.
  if (req.session && req.session._dirRepairKick) return;
  if (req.session) req.session._dirRepairKick = 1;
  const wid = req.workspaceId;
  void (async () => {
    const bundle = await directoryStore.load(wid, { workspace: ws, normalize: false });
    await directoryStore.repairJobTypeCategories(wid, bundle);
  })().catch((e) => {
    console.warn('[directory] background category repair failed:', e && e.message);
  });
}

async function pageLocals(req, { shell = false } = {}) {
  const ws = req.workspace || (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  const origin = baseUrlFromReq(req);

  if (shell) {
    const settings = shellSettingsFromWorkspace(ws);
    const token = settings.publicToken;
    return {
      title: 'Directory',
      activePage: 'directory',
      settings,
      listings: [],
      summary: { total: 0, published: 0, draft: 0 },
      feedUrl: token ? `${origin}/api/public/directory/${encodeURIComponent(token)}/feed.json` : '',
      detailUrlTemplate: token
        ? `${origin}/api/public/directory/${encodeURIComponent(token)}/businesses/{slug}.json`
        : '',
      workspaceName: (ws && ws.name) || 'Your workspace',
      inboxPending: true,
    };
  }

  // Listings live on the workspace doc — no lead scan / category repair on the request path.
  const bundle = await directoryStore.load(req.workspaceId, { workspace: ws, normalize: false });
  const intake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const seedName = String(intake.businessName || ws.name || '').trim();
  const settings = {
    ...bundle.settings,
    businessName: String(bundle.settings.businessName || '').trim() || seedName,
    pathPrefix: String(bundle.settings.pathPrefix || '/directory').trim() || '/directory',
  };
  const summary = directoryStore.inboxSummary(bundle);
  const token = settings.publicToken;
  const feedUrl = token ? `${origin}/api/public/directory/${encodeURIComponent(token)}/feed.json` : '';
  const detailUrlTemplate = token
    ? `${origin}/api/public/directory/${encodeURIComponent(token)}/businesses/{slug}.json`
    : '';
  const listings = directoryStore.listListings(bundle);
  return {
    title: 'Directory',
    activePage: 'directory',
    settings,
    listings,
    summary,
    feedUrl,
    detailUrlTemplate,
    workspaceName: (ws && ws.name) || 'Your workspace',
    inboxPending: false,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // Prefer SSR from workspace.directory (same as Reviews/Q&A after 1.0.753).
    let locals;
    try {
      locals = await pageLocals(req, { shell: false });
      locals.inboxHydrate = false;
      kickCategoryRepair(req, req.workspace);
    } catch (e) {
      if (!isSqliteBusyError(e)) throw e;
      locals = await pageLocals(req, { shell: true });
      locals.inboxHydrate = true;
    }
    locals.pageBuilderPrompt = '';
    locals.pageBuilderPromptUrl = '/directory/page-prompt.txt';
    locals.flash = null;
    if (req.query.ok) {
      const ok = String(req.query.ok);
      const map = {
        saved: 'Settings saved.',
        added: 'Business added to the directory.',
        publish: 'Publish state updated.',
        removed: 'Listing removed.',
        refreshed: 'Listing refreshed from the lead.',
      };
      locals.flash = { ok: map[ok] || 'Done.' };
    }
    if (req.query.err) {
      locals.flash = { error: String(req.query.err).slice(0, 200) };
    }
    res.render('directory', locals);
  } catch (e) {
    next(e);
  }
});

router.get('/page-prompt.txt', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    const prompt = buildDirectoryPagePrompt({
      siteUrl: originFromPageUrl(locals.settings.pageUrl),
      pathPrefix: locals.settings.pathPrefix || '/directory',
      businessName: locals.settings.businessName || locals.workspaceName || '',
      pageTitle: locals.settings.pageTitle || 'Local Business Directory',
      feedUrl: locals.feedUrl,
      detailUrlTemplate: locals.detailUrlTemplate,
    });
    res.type('text/plain').send(prompt);
  } catch (e) {
    next(e);
  }
});

router.get('/inbox.json', async (req, res, next) => {
  try {
    const locals = await pageLocals(req);
    kickCategoryRepair(req, req.workspace);
    res.json({
      success: true,
      settings: locals.settings,
      summary: locals.summary,
      listings: locals.listings,
      feedUrl: locals.feedUrl,
      detailUrlTemplate: locals.detailUrlTemplate,
    });
  } catch (e) {
    if (isSqliteBusyError(e)) {
      return res.status(503).json({
        success: false,
        pending: true,
        error: 'Directory temporarily busy — retrying…',
      });
    }
    next(e);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const bundle = await directoryStore.load(req.workspaceId);
    const rotate = body.rotate_token === '1' || body.rotate_token === true || body.rotate_token === 'true';
    const saved = await directoryStore.save(req.workspaceId, {
      settings: {
        ...bundle.settings,
        pageUrl: body.pageUrl != null ? body.pageUrl : bundle.settings.pageUrl,
        pageTitle: body.pageTitle != null ? body.pageTitle : bundle.settings.pageTitle,
        businessName: body.businessName != null ? body.businessName : bundle.settings.businessName,
        pathPrefix: body.pathPrefix != null ? body.pathPrefix : bundle.settings.pathPrefix,
        showPhone:
          body.showPhone === undefined
            ? bundle.settings.showPhone !== false
            : body.showPhone === '1' || body.showPhone === true || body.showPhone === 'on',
        showWebsite:
          body.showWebsite === undefined
            ? bundle.settings.showWebsite !== false
            : body.showWebsite === '1' || body.showWebsite === true || body.showWebsite === 'on',
        showAddress:
          body.showAddress === undefined
            ? bundle.settings.showAddress !== false
            : body.showAddress === '1' || body.showAddress === true || body.showAddress === 'on',
        showRating:
          body.showRating === undefined
            ? bundle.settings.showRating !== false
            : body.showRating === '1' || body.showRating === true || body.showRating === 'on',
        showReviews:
          body.showReviews === undefined
            ? bundle.settings.showReviews !== false
            : body.showReviews === '1' || body.showReviews === true || body.showReviews === 'on',
        publicToken: rotate
          ? directoryStore.newPublicToken()
          : bundle.settings.publicToken || directoryStore.newPublicToken(),
      },
      listings: bundle.listings,
    });
    if (wantsJsonResponse(req)) {
      return res.json({ success: true, settings: saved.settings });
    }
    return res.redirect('/directory?ok=saved');
  } catch (e) {
    next(e);
  }
});

router.post('/listings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const leadKey = String(body.leadKey || body.key || '').trim();
    const row = await directoryStore.upsertFromLead(req.workspaceId, leadKey, {
      published: body.published === undefined ? true : body.published,
      blurb: body.blurb,
      slug: body.slug,
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, listing: row });
    return res.redirect('/directory?ok=added');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Add failed' });
    }
    return res.redirect(`/directory?err=${encodeURIComponent(e.message || 'Add failed')}`);
  }
});

/** Pipeline float-menu bulk add — keys stay in the active workspace directory only. */
router.post('/listings/bulk', async (req, res) => {
  try {
    const body = req.body || {};
    const rawKeys = Array.isArray(body.leadKeys)
      ? body.leadKeys
      : String(body.leadKeys || body.leadKey || '')
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
    const result = await directoryStore.upsertManyFromLeads(req.workspaceId, rawKeys, {
      published: body.published === undefined ? true : body.published,
    });
    return res.json({
      success: true,
      added: result.added,
      refreshed: result.refreshed,
      failed: result.failed,
      errors: result.errors,
      directoryUrl: '/directory',
    });
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: e.message || 'Bulk add failed',
      errors: e.details || [],
    });
  }
});

/** Edit curated listing fields (name, category, description, reviews, etc.). */
router.post('/listings/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const snippetsRaw = body.reviewSnippets;
    const reviewSnippets = Array.isArray(snippetsRaw)
      ? snippetsRaw
      : String(snippetsRaw || '')
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5);
    const row = await directoryStore.updateListing(req.workspaceId, req.params.id, {
      name: body.name,
      slug: body.slug,
      category: body.category,
      city: body.city,
      state: body.state,
      address: body.address,
      phone: body.phone,
      website: body.website,
      rating: body.rating === '' || body.rating == null ? null : body.rating,
      reviewCount: body.reviewCount === '' || body.reviewCount == null ? null : body.reviewCount,
      description: body.description,
      blurb: body.blurb,
      reviewSummary: body.reviewSummary,
      reviewSentiment: body.reviewSentiment,
      reviewSnippets,
      imageUrl: body.imageUrl,
      published: body.published,
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, listing: row });
    return res.redirect('/directory?ok=saved');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Save failed' });
    }
    next(e);
  }
});

router.get('/listings/:id.json', async (req, res, next) => {
  try {
    const bundle = await directoryStore.load(req.workspaceId);
    const id = String(req.params.id || '');
    const row = (directoryStore.listListings(bundle) || []).find((r) => r && r.id === id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Listing not found.' });
    }
    return res.json({ success: true, listing: row });
  } catch (e) {
    next(e);
  }
});

router.post('/listings/:id/publish', async (req, res, next) => {
  try {
    const body = req.body || {};
    const published =
      body.published === undefined
        ? true
        : body.published === true || body.published === '1' || body.published === 'on';
    const row = await directoryStore.setPublished(req.workspaceId, req.params.id, published);
    if (wantsJsonResponse(req)) return res.json({ success: true, listing: row });
    return res.redirect('/directory?ok=publish');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Publish failed' });
    }
    next(e);
  }
});

router.post('/listings/:id/refresh', async (req, res, next) => {
  try {
    const bundle = await directoryStore.load(req.workspaceId);
    const prev = bundle.listings[String(req.params.id || '')];
    if (!prev || !prev.leadKey) {
      const err = new Error('Listing not found.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const row = await directoryStore.upsertFromLead(req.workspaceId, prev.leadKey, {
      published: prev.published,
      blurb: prev.blurb,
      slug: prev.slug,
    });
    if (wantsJsonResponse(req)) return res.json({ success: true, listing: row });
    return res.redirect('/directory?ok=refreshed');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Refresh failed' });
    }
    next(e);
  }
});

router.post('/listings/:id/remove', async (req, res, next) => {
  try {
    await directoryStore.removeListing(req.workspaceId, req.params.id);
    if (wantsJsonResponse(req)) return res.json({ success: true });
    return res.redirect('/directory?ok=removed');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message || 'Remove failed' });
    }
    next(e);
  }
});

module.exports = router;
