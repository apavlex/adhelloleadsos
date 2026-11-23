/**
 * SEO Directory — dashboard to curate Pipeline leads onto a public AI Studio directory.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const directoryStore = require('../services/directoryStore');
const withWorkspace = require('../middleware/withWorkspace');
const {
  buildDirectoryPagePrompt,
  originFromPageUrl,
} = require('../services/directoryPagePrompt');
const { wantsJsonResponse } = require('../lib/httpRequest');
const { isSqliteBusyError } = require('../lib/isSqliteBusyError');
const reviewHunt = require('../services/reviewHunt');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const outscraper = require('../services/outscraperClient');
const networkStore = require('../services/networkStore');
const directoryMemberLink = require('../services/directoryMemberLink');
const networkNotify = require('../services/networkNotify');

/** Cap per request — Outscraper is ~$0.08/business after free tier. */
const SCRAPE_REVIEWS_MAX = Math.min(
  25,
  Math.max(1, parseInt(process.env.DIRECTORY_SCRAPE_REVIEWS_MAX || '15', 10) || 15),
);
const SCRAPE_REVIEWS_GAP_MS = Math.min(
  5000,
  Math.max(250, parseInt(process.env.DIRECTORY_SCRAPE_REVIEWS_GAP_MS || '1200', 10) || 1200),
);

/** In-memory scrape jobs — never block the HTTP request (768 froze the app). */
const _scrapeJobs = new Map();
const _scrapeBusyByWs = new Set();
/** Wall-clock cap so a hung Outscraper/AI call cannot pin the workspace forever. */
const SCRAPE_JOB_MAX_MS = Math.min(
  20 * 60 * 1000,
  Math.max(60 * 1000, parseInt(process.env.DIRECTORY_SCRAPE_JOB_MAX_MS || String(12 * 60 * 1000), 10) || 12 * 60 * 1000),
);

function scrapeJobPublic(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    scraped: job.scraped,
    refreshed: job.refreshed,
    failed: job.failed,
    error: job.error || null,
    listingIds: Array.isArray(job.listingIds) ? job.listingIds.slice() : [],
    currentListingId: job.currentListingId || null,
    results: job.results || [],
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
}

/** Clear stale busy flags when a job vanished or ran too long (process kill / hang). */
function clearStaleScrapeBusy(workspaceId) {
  const wid = String(workspaceId || '');
  if (!wid || !_scrapeBusyByWs.has(wid)) return false;
  let running = null;
  for (const job of _scrapeJobs.values()) {
    if (String(job.workspaceId) === wid && job.status === 'running') {
      running = job;
      break;
    }
  }
  const started = running && running.startedAt ? Number(running.startedAt) : 0;
  const stale = !running || !started || Date.now() - started > SCRAPE_JOB_MAX_MS;
  if (!stale) return false;
  if (running) {
    running.status = 'error';
    running.error = running.error || 'Review scrape timed out. Try again.';
    running.finishedAt = Date.now();
    running.cancel = true;
  }
  _scrapeBusyByWs.delete(wid);
  return true;
}

async function runDirectoryScrapeJob(job) {
  const wid = job.workspaceId;
  let listingsDirty = false;
  const watchdog = setTimeout(() => {
    if (job.status === 'running') {
      job.cancel = true;
      job.error = job.error || 'Review scrape timed out. Try again.';
    }
  }, SCRAPE_JOB_MAX_MS);
  if (watchdog.unref) watchdog.unref();
  try {
    const integrationEnv = await workspaceIntegrations
      .getResolvedIntegrationEnv(wid)
      .catch(() => ({}));
    if (!outscraper.isConfigured(integrationEnv)) {
      job.status = 'error';
      job.error = 'Outscraper is not configured for this workspace.';
      job.finishedAt = Date.now();
      return;
    }
    // One load + one directory save. Do NOT updateLead inside the Outscraper loop —
    // N× sync lead rewrites blocked Reviews/Q&A. Lead KV persists after the job finishes.
    const bundle = await directoryStore.load(wid);
    const byId = bundle && bundle.listings && typeof bundle.listings === 'object' ? bundle.listings : {};
    const deferredLeadPatches = [];
    for (let i = 0; i < job.listingIds.length; i++) {
      if (job.cancel) break;
      const id = job.listingIds[i];
      job.currentListingId = id;
      const prev = byId[id];
      if (!prev || !prev.leadKey) {
        job.failed += 1;
        job.done += 1;
        job.results.push({ id, ok: false, error: 'Listing not found.' });
        continue;
      }
      try {
        const lead = await dbService.getLead(prev.leadKey, wid);
        if (!lead) {
          job.failed += 1;
          job.done += 1;
          job.results.push({ id, leadKey: prev.leadKey, ok: false, error: 'Lead not found.' });
          continue;
        }
        // Yield so menu/session / Reviews/Q&A hops can run between Outscraper calls.
        await new Promise((r) => setTimeout(r, 0));
        if (job.cancel) break;
        const pack = await reviewHunt.runReviewHuntForLead(lead, integrationEnv, {
          skipAiSummary: true,
        });
        if (!pack || !pack.outscraperConfigured) {
          job.failed += 1;
          job.done += 1;
          job.results.push({
            id,
            leadKey: prev.leadKey,
            ok: false,
            error: 'Outscraper is not configured.',
          });
          continue;
        }
        await new Promise((r) => setTimeout(r, 0));
        if (pack.patch && Object.keys(pack.patch).length) {
          Object.assign(lead, pack.patch);
          deferredLeadPatches.push({
            leadKey: prev.leadKey,
            patch: { ...pack.patch, _skipPhoneLineRefresh: true },
          });
        }
        const { row } = directoryStore.applyLeadToBundle(bundle, lead, prev.leadKey, {
          published: prev.published,
          blurb: prev.blurb,
          slug: prev.slug,
        });
        listingsDirty = true;
        if (pack.used || pack.reviewsFetched) job.scraped += 1;
        job.refreshed += 1;
        job.done += 1;
        job.results.push({
          id,
          leadKey: prev.leadKey,
          ok: true,
          used: !!pack.used,
          reviewsFetched: !!pack.reviewsFetched,
          reviewError: pack.reviewError || null,
          rating: row && row.rating != null ? row.rating : null,
          reviewCount: row && row.reviewCount != null ? row.reviewCount : null,
          reviewSummary: row && row.reviewSummary ? row.reviewSummary : '',
        });
      } catch (e) {
        job.failed += 1;
        job.done += 1;
        job.results.push({
          id,
          leadKey: prev.leadKey,
          ok: false,
          error: (e && e.message) || 'Scrape failed',
        });
      }
      if (i < job.listingIds.length - 1 && SCRAPE_REVIEWS_GAP_MS > 0) {
        await new Promise((r) => setTimeout(r, SCRAPE_REVIEWS_GAP_MS));
      }
    }
    if (listingsDirty) {
      await new Promise((r) => setTimeout(r, 0));
      const saved = await directoryStore.save(wid, {
        listings: bundle.listings,
        settings: bundle.settings || {},
      });
      // Prime (do not invalidate): Reviews/Q&A inbox.json preferCache can serve
      // this doc while deferred lead KV writes run — invalidate forced cold reads
      // into SQLITE_BUSY → "Loading…" forever.
      try {
        if (typeof withWorkspace.primeWorkspaceDocCache === 'function' && saved && saved.workspace) {
          withWorkspace.primeWorkspaceDocCache(wid, saved.workspace);
        } else if (typeof withWorkspace.invalidateWorkspaceDocCache === 'function') {
          withWorkspace.invalidateWorkspaceDocCache(wid);
        }
      } catch (_) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    if (job.cancel && job.error) {
      job.status = 'error';
    } else {
      job.status = job.cancel ? 'cancelled' : 'done';
    }
    job.currentListingId = null;
    job.finishedAt = Date.now();
    // Persist lead patches AFTER the job is done so Reviews/Q&A are not locked behind N writes.
    if (deferredLeadPatches.length) {
      const patches = deferredLeadPatches.slice();
      setImmediate(() => {
        void (async () => {
          for (let pi = 0; pi < patches.length; pi++) {
            const item = patches[pi];
            try {
              // Gap so Reviews/Q&A / session can run between sync lead rewrites.
              await new Promise((r) => setTimeout(r, pi === 0 ? 0 : 40));
              await dbService.updateLead(item.leadKey, item.patch, wid);
            } catch (e) {
              console.warn(
                '[directory scrape] deferred lead update failed:',
                e && e.message ? e.message : e,
              );
            }
          }
        })();
      });
    }
  } catch (e) {
    job.status = 'error';
    job.error = (e && e.message) || 'Scrape failed';
    job.currentListingId = null;
    job.finishedAt = Date.now();
  } finally {
    clearTimeout(watchdog);
    _scrapeBusyByWs.delete(String(wid));
    setTimeout(() => _scrapeJobs.delete(job.id), 30 * 60 * 1000);
  }
}

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

/** In-memory only — never touch req.session (same SQLite as workspace writes). */
const _dirRepairInflight = new Set();

/**
 * Category repair does N×getLead + saveWorkspace on the app SQLite file.
 * Sessions use that same file — kicking repair in the same tick as res.render
 * blocked session save / HTML flush and left Directory looking dead after 756.
 * Only schedule after the response finishes, and never from inbox hydrate.
 */
function scheduleCategoryRepairAfterPaint(res, workspaceId, workspace) {
  const wid = String(workspaceId || '').trim();
  if (!wid || _dirRepairInflight.has(wid)) return;
  const ws = workspace && typeof workspace === 'object' ? workspace : null;
  let armed = false;
  const kick = () => {
    if (armed || _dirRepairInflight.has(wid)) return;
    armed = true;
    _dirRepairInflight.add(wid);
    void (async () => {
      try {
        // Yield so session save + other hops get the event loop first.
        await new Promise((r) => setTimeout(r, 2500));
        const bundle = await directoryStore.load(wid, { workspace: ws || undefined, normalize: false });
        await directoryStore.repairJobTypeCategories(wid, bundle);
      } catch (e) {
        console.warn('[directory] background category repair failed:', e && e.message);
      } finally {
        _dirRepairInflight.delete(wid);
      }
    })();
  };
  if (res && typeof res.once === 'function' && !res.writableEnded) {
    res.once('finish', kick);
    res.once('close', kick);
  } else {
    kick();
  }
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
      leadFormUrlTemplate: token
        ? `${origin}/api/public/directory/${encodeURIComponent(token)}/businesses/{slug}/leads`
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
  const leadFormUrlTemplate = token
    ? `${origin}/api/public/directory/${encodeURIComponent(token)}/businesses/{slug}/leads`
    : '';
  // Light list: skip re-normalize/toPublicReview* on every hydrate — that sync
  // work blocked the event loop and starved Reviews/Q&A inbox.json.
  const listings = directoryStore
    .listListings(bundle, { light: true })
    .map(slimListingForInbox)
    .filter(Boolean);
  return {
    title: 'Directory',
    activePage: 'directory',
    settings,
    listings,
    summary,
    feedUrl,
    detailUrlTemplate,
    leadFormUrlTemplate,
    workspaceName: (ws && ws.name) || 'Your workspace',
    inboxPending: false,
  };
}

/** Plain JSON fields for hydrate — never leak non-JSON or huge blobs into inbox.json. */
function slimListingForInbox(row) {
  if (!row || typeof row !== 'object') return null;
  const ratingRaw = row.rating != null && row.rating !== '' ? Number(row.rating) : NaN;
  const countRaw = row.reviewCount != null && row.reviewCount !== '' ? Number(row.reviewCount) : NaN;
  return {
    id: row.id || '',
    leadKey: row.leadKey || '',
    memberId: row.memberId || '',
    slug: row.slug || '',
    name: row.name || '',
    category: row.category || '',
    city: row.city || '',
    state: row.state || '',
    address: row.address || '',
    phone: row.phone || '',
    website: row.website || '',
    rating: Number.isFinite(ratingRaw) ? ratingRaw : null,
    reviewCount: Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : null,
    reviewSentiment: row.reviewSentiment || '',
    reviewSummary: row.reviewSummary || '',
    reviewSnippets: Array.isArray(row.reviewSnippets) ? row.reviewSnippets.slice(0, 5) : [],
    description: row.description || '',
    blurb: row.blurb || '',
    imageUrl: row.imageUrl || '',
    published: row.published === true,
  };
}

function slimNetworkMember(m) {
  if (!m || typeof m !== 'object') return null;
  const id = String(m.id || '').trim();
  if (!id) return null;
  return {
    id,
    companyName: String(m.companyName || '').trim(),
    contactName: String(m.contactName || '').trim(),
    phone: String(m.phone || '').trim(),
    email: String(m.email || '').trim(),
    leadKey: String(m.leadKey || '').trim(),
    status: String(m.status || '').trim() || 'active',
    label: directoryMemberLink.memberPickerLabel(m),
  };
}

async function listingPortalContext(req, listingId) {
  const bundle = await directoryStore.load(req.workspaceId, { normalize: false });
  const id = String(listingId || '').trim();
  const listing = (bundle.listings && bundle.listings[id]) || null;
  if (!listing) {
    const err = new Error('Listing not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const linked = await directoryMemberLink.resolveMemberForListing(req.workspaceId, listing);
  if (!linked || !linked.member) {
    const err = new Error('No Reviews app member linked to this listing yet.');
    err.code = 'NO_MEMBER';
    throw err;
  }
  return { listing, network: linked.network, member: linked.member, match: linked.match };
}

router.get('/', async (req, res, next) => {
  try {
    // Shell-first always: paint chrome from req.workspace, hydrate listings from
    // /inbox.json. Prefer-SSR + same-tick repair (756) contended SQLite with
    // express-session and could block the HTML response entirely.
    const locals = await pageLocals(req, { shell: true });
    locals.inboxHydrate = true;
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
        portal_sent: 'Reviews app login link sent.',
        portal_fail: 'Could not send Reviews app link.',
      };
      locals.flash = { ok: map[ok] || 'Done.' };
    }
    if (req.query.err) {
      locals.flash = { error: String(req.query.err).slice(0, 200) };
    }
    // Never schedule category repair on HTML hops. Even deferred saveWorkspace
    // of the directory blob locked SQLite and left Reviews/Q&A hydrate pending
    // until abort. Repair stays available for explicit admin/tests via store API.
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
      leadFormUrlTemplate: locals.leadFormUrlTemplate,
    });
    res.type('text/plain').send(prompt);
  } catch (e) {
    next(e);
  }
});

router.get('/inbox.json', async (req, res, next) => {
  try {
    // Never kick category repair here — hydrate must stay free of getLead/saveWorkspace.
    const locals = await pageLocals(req);
    res.json({
      success: true,
      settings: locals.settings,
      summary: locals.summary,
      listings: locals.listings,
      feedUrl: locals.feedUrl,
      detailUrlTemplate: locals.detailUrlTemplate,
      leadFormUrlTemplate: locals.leadFormUrlTemplate,
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
      omitted: result.omitted || 0,
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

/**
 * Pull Google reviews for selected Directory listings (Outscraper + optional AI summary).
 * Returns immediately and runs in the background — the sync 768 path froze the whole app
 * while Outscraper polled (up to minutes) and saveWorkspace locked SQLite.
 * Registered before /listings/:id so "scrape-reviews" is not captured as an id.
 */
router.post('/listings/scrape-reviews', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const wid = String(req.workspaceId || '');
    if (_scrapeBusyByWs.has(wid)) {
      clearStaleScrapeBusy(wid);
    }
    if (_scrapeBusyByWs.has(wid)) {
      return res.status(409).json({
        success: false,
        pending: true,
        error: 'A review scrape is already running for this workspace. Wait for it to finish.',
      });
    }
    const body = req.body || {};
    const rawIds = Array.isArray(body.listingIds)
      ? body.listingIds
      : Array.isArray(body.ids)
        ? body.ids
        : String(body.listingIds || body.ids || body.id || '')
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    const listingIds = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!listingIds.length) {
      return res.status(400).json({ success: false, error: 'Select at least one listing.' });
    }
    if (listingIds.length > SCRAPE_REVIEWS_MAX) {
      return res.status(400).json({
        success: false,
        error: `Select at most ${SCRAPE_REVIEWS_MAX} listings per run (Outscraper cost).`,
        max: SCRAPE_REVIEWS_MAX,
      });
    }

    const integrationEnv = await workspaceIntegrations
      .getResolvedIntegrationEnv(wid)
      .catch(() => ({}));
    if (!outscraper.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Outscraper is not configured for this workspace. Add an API key under Integrations.',
      });
    }

    const jobId = `dirrev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id: jobId,
      workspaceId: wid,
      listingIds,
      status: 'running',
      total: listingIds.length,
      done: 0,
      scraped: 0,
      refreshed: 0,
      failed: 0,
      results: [],
      error: null,
      currentListingId: null,
      startedAt: Date.now(),
      finishedAt: null,
      cancel: false,
    };
    _scrapeJobs.set(jobId, job);
    _scrapeBusyByWs.add(wid);
    setImmediate(() => {
      void runDirectoryScrapeJob(job);
    });

    return res.status(202).json({
      success: true,
      pending: true,
      jobId,
      max: SCRAPE_REVIEWS_MAX,
      job: scrapeJobPublic(job),
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: (e && e.message) || 'Scrape failed',
    });
  }
});

router.get('/listings/scrape-reviews/:jobId.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const job = _scrapeJobs.get(String(req.params.jobId || ''));
  if (!job || String(job.workspaceId) !== String(req.workspaceId || '')) {
    return res.status(404).json({ success: false, error: 'Job not found.' });
  }
  return res.json({ success: true, job: scrapeJobPublic(job) });
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
    const patch = {
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
    };
    // Explicit Reviews member link (empty string clears).
    if (Object.prototype.hasOwnProperty.call(body, 'memberId')) {
      patch.memberId = body.memberId == null ? '' : String(body.memberId).trim();
    }
    const row = await directoryStore.updateListing(req.workspaceId, req.params.id, patch);
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

/** Reviews-app members for the Directory → member picker. */
router.get('/reviews-members.json', async (req, res, next) => {
  try {
    const network = await networkStore.getNetworkForWorkspace(req.workspaceId);
    if (!network) {
      return res.json({ success: true, networkId: null, members: [] });
    }
    const members = (await networkStore.listMembers(network.id))
      .filter((m) => m && m.status !== 'paused')
      .map(slimNetworkMember)
      .filter(Boolean)
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
    return res.json({ success: true, networkId: network.id, members });
  } catch (e) {
    next(e);
  }
});

router.get('/listings/:id/portal-link', async (req, res, next) => {
  try {
    const ctx = await listingPortalContext(req, req.params.id);
    const baseUrl = baseUrlFromReq(req);
    const url = await networkNotify.memberPortalShortLink(baseUrl, ctx.network, ctx.member);
    const fullUrl = networkNotify.memberPortalLink(baseUrl, ctx.network, ctx.member);
    return res.json({
      success: true,
      url,
      fullUrl,
      memberId: ctx.member.id,
      companyName: ctx.member.companyName || '',
      match: ctx.match || '',
      listingId: ctx.listing.id,
    });
  } catch (e) {
    if (e.code === 'NOT_FOUND' || e.code === 'NO_MEMBER') {
      return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({
        success: false,
        error: e.message || 'No Reviews app link',
      });
    }
    next(e);
  }
});

router.post('/listings/:id/send-portal-link', async (req, res, next) => {
  try {
    const ctx = await listingPortalContext(req, req.params.id);
    const sent = await networkNotify.sendMemberPortalLink({
      network: ctx.network,
      member: ctx.member,
      baseUrl: baseUrlFromReq(req),
      welcome: !!(req.body && (req.body.welcome === true || req.body.welcome === '1')),
    });
    if (wantsJsonResponse(req)) {
      return res.json({
        success: !!sent.ok,
        ok: !!sent.ok,
        channel: sent.channel || null,
        error: sent.ok ? null : sent.error || 'Could not send',
        memberId: ctx.member.id,
        companyName: ctx.member.companyName || '',
      });
    }
    return res.redirect(sent.ok ? '/directory?ok=portal_sent' : '/directory?ok=portal_fail');
  } catch (e) {
    if (wantsJsonResponse(req)) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'NO_MEMBER' ? 400 : 500;
      return res.status(status).json({ success: false, error: e.message || 'Send failed' });
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
