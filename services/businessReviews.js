/**
 * Paid Business Reviews inbox — pull Google reviews via Outscraper, notify on
 * new ones, and draft AI owner replies for copy/paste into Google.
 */
const crypto = require('crypto');
const dbService = require('./database');
const outscraper = require('./outscraperClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const notificationLog = require('./notificationLog');
const trials = require('./trials');
const { reviewDateFromRow } = require('./reviewFreshness');
const { chatCompletion, parseLlmJson } = require('./llmClient');

const SETTINGS_PREFIX = 'businessReviews:settings:';
const STORE_PREFIX = 'businessReviews:store:';
const MAX_STORED = 200;
const DEFAULT_LIMIT = 40;
const MIN_SYNC_GAP_MS = Math.max(
  5 * 60 * 1000,
  parseInt(process.env.BUSINESS_REVIEWS_MIN_SYNC_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000
);

function settingsKey(wid) {
  return `${SETTINGS_PREFIX}${String(wid || '').trim()}`;
}

function storeKey(wid) {
  return `${STORE_PREFIX}${String(wid || '').trim()}`;
}

function readJson(key, fallback) {
  let raw = dbService.getKvSync(key);
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return raw && typeof raw === 'object' ? raw : fallback;
}

function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Paid / activated workspaces (and legacy workspaces that never had a trial). */
function isPaidWorkspace(ws) {
  return !trials.isRestricted(ws);
}

function defaultSettings() {
  return {
    query: '',
    businessName: '',
    autoSync: true,
    reviewsLimit: DEFAULT_LIMIT,
    updatedAt: null,
  };
}

function getSettings(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return defaultSettings();
  const raw = readJson(settingsKey(wid), null);
  const base = defaultSettings();
  if (!raw) return base;
  return {
    query: clean(raw.query, 500),
    businessName: clean(raw.businessName, 160),
    autoSync: raw.autoSync !== false,
    reviewsLimit: Math.min(100, Math.max(5, parseInt(raw.reviewsLimit, 10) || DEFAULT_LIMIT)),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

function saveSettings(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('Workspace required');
  const prev = getSettings(wid);
  const next = {
    query: patch.query != null ? clean(patch.query, 500) : prev.query,
    businessName: patch.businessName != null ? clean(patch.businessName, 160) : prev.businessName,
    autoSync: patch.autoSync != null ? !!patch.autoSync : prev.autoSync,
    reviewsLimit: patch.reviewsLimit != null
      ? Math.min(100, Math.max(5, parseInt(patch.reviewsLimit, 10) || DEFAULT_LIMIT))
      : prev.reviewsLimit,
    updatedAt: new Date().toISOString(),
  };
  dbService.setKvSync(settingsKey(wid), next);
  return next;
}

function emptyStore() {
  return {
    reviews: [],
    placeRating: null,
    placeReviewsCount: null,
    placeName: '',
    lastSyncedAt: null,
    lastError: null,
    knownIds: [],
  };
}

function getStore(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return emptyStore();
  const raw = readJson(storeKey(wid), null);
  if (!raw) return emptyStore();
  return {
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    placeRating: raw.placeRating != null && Number.isFinite(Number(raw.placeRating)) ? Number(raw.placeRating) : null,
    placeReviewsCount:
      raw.placeReviewsCount != null && Number.isFinite(Number(raw.placeReviewsCount))
        ? Number(raw.placeReviewsCount)
        : null,
    placeName: clean(raw.placeName, 200),
    lastSyncedAt: raw.lastSyncedAt ? String(raw.lastSyncedAt) : null,
    lastError: raw.lastError ? clean(raw.lastError, 400) : null,
    knownIds: Array.isArray(raw.knownIds) ? raw.knownIds.map(String) : [],
  };
}

function saveStore(workspaceId, store) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return;
  dbService.setKvSync(storeKey(wid), {
    reviews: (store.reviews || []).slice(0, MAX_STORED),
    placeRating: store.placeRating,
    placeReviewsCount: store.placeReviewsCount,
    placeName: clean(store.placeName, 200),
    lastSyncedAt: store.lastSyncedAt || null,
    lastError: store.lastError || null,
    knownIds: (store.knownIds || []).slice(0, MAX_STORED * 2),
  });
}

function reviewFingerprint(raw) {
  const id =
    raw.review_id ||
    raw.reviewId ||
    raw.google_id ||
    raw.review_link ||
    raw.reviewLink ||
    '';
  if (id && String(id).trim()) return `id:${String(id).trim().slice(0, 200)}`;
  const author = String(raw.author_title || raw.author_name || raw.author || raw.user_name || '').trim();
  const text = String(raw.review_text || raw.text || raw.reviewText || '').trim().slice(0, 240);
  const ts = String(
    raw.review_timestamp || raw.review_datetime_utc || raw.reviewedAt || raw.time || ''
  ).trim();
  const h = crypto.createHash('sha1').update(`${author}|${text}|${ts}`).digest('hex').slice(0, 16);
  return `h:${h}`;
}

function normalizeStoredReview(raw, { isNew = false, seenAt = null } = {}) {
  const base = {
    rating: null,
    text: '',
    author: '',
    reviewedAt: null,
  };
  if (!raw || typeof raw !== 'object') {
    return {
      ...base,
      id: reviewFingerprint({}),
      ownerResponse: '',
      reviewLink: '',
      isNew: !!isNew,
      seenAt: seenAt || new Date().toISOString(),
      replyDraft: '',
      replyDraftAt: null,
    };
  }
  const ratingRaw =
    raw.review_rating != null ? raw.review_rating
    : raw.rating != null ? raw.rating
    : raw.stars != null ? raw.stars
    : null;
  const rating = ratingRaw != null ? Number(ratingRaw) : null;
  const text = clean(raw.review_text || raw.text || raw.reviewText || raw.snippet || '', 4000);
  const author = clean(raw.author_title || raw.author_name || raw.author || raw.user_name || '', 120);
  const reviewed = reviewDateFromRow(raw);
  const ownerResponse = clean(
    raw.owner_answer || raw.ownerAnswer || raw.owner_response || raw.ownerResponse || '',
    4000
  );
  const reviewLink = clean(raw.review_link || raw.reviewLink || raw.link || '', 500);
  return {
    id: reviewFingerprint(raw),
    rating: Number.isFinite(rating) ? rating : null,
    text,
    author,
    reviewedAt: reviewed ? reviewed.toISOString() : null,
    ownerResponse,
    reviewLink: reviewLink.startsWith('http') ? reviewLink : '',
    isNew: !!isNew,
    seenAt: seenAt || new Date().toISOString(),
    replyDraft: typeof raw.replyDraft === 'string' ? raw.replyDraft : '',
    replyDraftAt: raw.replyDraftAt || null,
  };
}

function mergeReviews(existing, incoming, { markNew = true } = {}) {
  const byId = new Map();
  for (const r of existing || []) {
    if (r && r.id) byId.set(r.id, r);
  }
  const known = new Set((existing || []).map((r) => r && r.id).filter(Boolean));
  const newOnes = [];
  const now = new Date().toISOString();

  for (const raw of incoming || []) {
    const next = normalizeStoredReview(raw, { isNew: false, seenAt: now });
    const prev = byId.get(next.id);
    if (prev) {
      byId.set(next.id, {
        ...prev,
        rating: next.rating != null ? next.rating : prev.rating,
        text: next.text || prev.text,
        author: next.author || prev.author,
        reviewedAt: next.reviewedAt || prev.reviewedAt,
        ownerResponse: next.ownerResponse || prev.ownerResponse,
        reviewLink: next.reviewLink || prev.reviewLink,
        // keep draft + isNew flags
        replyDraft: prev.replyDraft || '',
        replyDraftAt: prev.replyDraftAt || null,
        isNew: !!prev.isNew,
        seenAt: prev.seenAt || now,
      });
    } else {
      const isNew = markNew && known.size > 0;
      const row = { ...next, isNew, seenAt: now };
      byId.set(next.id, row);
      if (isNew) newOnes.push(row);
    }
  }

  const reviews = Array.from(byId.values()).sort((a, b) => {
    const ta = Date.parse(a.reviewedAt || a.seenAt || '') || 0;
    const tb = Date.parse(b.reviewedAt || b.seenAt || '') || 0;
    return tb - ta;
  });

  return { reviews: reviews.slice(0, MAX_STORED), newOnes };
}

function notifyNewReviews(workspaceId, newOnes, businessName) {
  if (!newOnes.length) return [];
  const wid = String(workspaceId || '').trim();
  const biz = clean(businessName, 80) || 'your business';
  const entries = [];
  const top = newOnes.slice(0, 5);
  for (const r of top) {
    const stars = r.rating != null ? `${r.rating}★` : 'New';
    const who = r.author || 'a customer';
    const snippet = r.text ? clean(r.text, 120) : 'No written comment';
    const entry = notificationLog.add(
      wid,
      {
        title: `${stars} Google review from ${who}`,
        body: `${biz}: ${snippet}`,
        href: `/business-reviews?review=${encodeURIComponent(r.id)}`,
        linkLabel: 'Reply',
      },
      ''
    );
    if (entry) entries.push(entry);
  }
  if (newOnes.length > top.length) {
    const more = notificationLog.add(
      wid,
      {
        title: `${newOnes.length - top.length} more new Google reviews`,
        body: `Open Business Reviews to draft replies for ${biz}.`,
        href: '/business-reviews',
        linkLabel: 'Open inbox',
      },
      ''
    );
    if (more) entries.push(more);
  }
  return entries;
}

/**
 * Sync Google reviews for a workspace via Outscraper.
 * @returns {Promise<object>}
 */
async function syncWorkspace(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('Workspace required');

  const ws = opts.workspace || (await dbService.getWorkspace(wid));
  if (!isPaidWorkspace(ws)) {
    const err = new Error('Business Reviews is available on paid plans. Contact us to upgrade.');
    err.code = 'PAID_ONLY';
    err.status = 402;
    throw err;
  }

  const settings = getSettings(wid);
  const query = clean(opts.query != null ? opts.query : settings.query, 500);
  if (!query) {
    const err = new Error('Add a Google Maps place ID, Maps URL, or business name to sync reviews.');
    err.code = 'QUERY_REQUIRED';
    err.status = 400;
    throw err;
  }

  const store = getStore(wid);
  if (!opts.force && store.lastSyncedAt) {
    const last = Date.parse(store.lastSyncedAt) || 0;
    if (last && Date.now() - last < MIN_SYNC_GAP_MS && store.reviews.length) {
      return {
        ok: true,
        skipped: true,
        reason: 'recently_synced',
        settings,
        store,
        newCount: 0,
      };
    }
  }

  const integrationEnv =
    opts.integrationEnv || (await workspaceIntegrations.getResolvedIntegrationEnv(wid));
  if (!outscraper.isConfigured(integrationEnv)) {
    const err = new Error('Connect Outscraper under Workspace → Integrations to sync Google reviews.');
    err.code = 'OUTSCRAPER_NOT_CONFIGURED';
    err.status = 400;
    throw err;
  }

  if (opts.query != null && clean(opts.query, 500) !== settings.query) {
    saveSettings(wid, { query });
  }

  let pack;
  try {
    pack = await trials.runMetered(ws, () =>
      outscraper.fetchGoogleMapsReviews({
        query,
        reviewsLimit: settings.reviewsLimit,
        sort: 'newest',
        integrationEnv,
      })
    );
  } catch (e) {
    const next = {
      ...store,
      lastError: e.message || 'Outscraper sync failed',
      lastSyncedAt: store.lastSyncedAt,
    };
    saveStore(wid, next);
    throw e;
  }

  const markNew = store.knownIds.length > 0 || store.reviews.length > 0;
  const { reviews, newOnes } = mergeReviews(store.reviews, pack.reviews || [], { markNew });
  const placeName =
    clean((pack.place && (pack.place.name || pack.place.title)) || settings.businessName, 200) ||
    settings.businessName;
  const nextStore = {
    reviews,
    placeRating: pack.placeRating != null ? pack.placeRating : store.placeRating,
    placeReviewsCount:
      pack.placeReviewsCount != null ? pack.placeReviewsCount : store.placeReviewsCount,
    placeName,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    knownIds: reviews.map((r) => r.id),
  };
  saveStore(wid, nextStore);

  if (settings.query !== query || (!settings.businessName && placeName)) {
    saveSettings(wid, {
      query,
      businessName: settings.businessName || placeName,
    });
  }

  const notifications = opts.notify === false
    ? []
    : notifyNewReviews(wid, newOnes, placeName || settings.businessName);

  return {
    ok: true,
    skipped: false,
    settings: getSettings(wid),
    store: nextStore,
    newCount: newOnes.length,
    newOnes,
    notifications,
  };
}

function getReview(workspaceId, reviewId) {
  const id = String(reviewId || '').trim();
  if (!id) return null;
  return getStore(workspaceId).reviews.find((r) => r.id === id) || null;
}

function markReviewSeen(workspaceId, reviewId) {
  const store = getStore(workspaceId);
  let changed = false;
  store.reviews = store.reviews.map((r) => {
    if (r.id !== reviewId) return r;
    if (!r.isNew) return r;
    changed = true;
    return { ...r, isNew: false };
  });
  if (changed) saveStore(workspaceId, store);
  return getReview(workspaceId, reviewId);
}

function markAllSeen(workspaceId) {
  const store = getStore(workspaceId);
  store.reviews = store.reviews.map((r) => ({ ...r, isNew: false }));
  saveStore(workspaceId, store);
  return store;
}

/**
 * AI draft owner reply for a Google review (copy/paste into Google).
 */
async function draftReply(workspaceId, reviewId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const ws = opts.workspace || (await dbService.getWorkspace(wid));
  if (!isPaidWorkspace(ws)) {
    const err = new Error('AI review replies are available on paid plans.');
    err.code = 'PAID_ONLY';
    err.status = 402;
    throw err;
  }

  const store = getStore(wid);
  const settings = getSettings(wid);
  const review = store.reviews.find((r) => r.id === reviewId);
  if (!review) {
    const err = new Error('Review not found. Sync reviews first.');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const businessName =
    clean(opts.businessName || settings.businessName || store.placeName || (ws && ws.name), 120) ||
    'our team';

  const ai = await trials.runMetered(ws, () =>
    chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You write short Google Business Profile owner replies that a business can copy and paste.

Rules:
- Sound human, warm, and professional. No emojis unless the review used them.
- 2–5 sentences. No markdown, no quotes around the whole reply, no "Subject:".
- Thank the reviewer by first name when the author looks like a real name; otherwise say "thanks for the review".
- For 4–5★: reinforce what they praised and invite them back.
- For 3★: acknowledge mixed feedback, note what you'll improve, stay gracious.
- For 1–2★: apologize sincerely, take ownership without admitting legal liability, invite them to contact the business privately, do not argue.
- Never invent facts, discounts, or promises not implied by the review.
- Sign off with the business name only (no "Best regards," fluff stacks).

Return JSON only: {"reply":"the full reply text"}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            businessName,
            rating: review.rating,
            author: review.author,
            reviewText: review.text,
            reviewedAt: review.reviewedAt,
          }),
        },
      ],
      jsonObject: true,
      max_tokens: 400,
      temperature: 0.45,
    })
  );

  if (!ai.content || ai.error) {
    const err = new Error(
      ai.detail || 'No AI provider configured (set OPENROUTER_API_KEY) or the request failed.'
    );
    err.code = 'AI_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  const parsed = parseLlmJson(ai.content);
  let reply =
    parsed && typeof parsed.reply === 'string'
      ? parsed.reply.trim()
      : parsed && typeof parsed.text === 'string'
        ? parsed.text.trim()
        : '';
  if (!reply && typeof ai.content === 'string') {
    reply = ai.content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  if (!reply) {
    const err = new Error('AI returned an empty reply. Try again.');
    err.code = 'AI_EMPTY';
    err.status = 502;
    throw err;
  }
  reply = reply.slice(0, 3500);

  const now = new Date().toISOString();
  store.reviews = store.reviews.map((r) =>
    r.id === reviewId
      ? { ...r, replyDraft: reply, replyDraftAt: now, isNew: false }
      : r
  );
  saveStore(wid, store);

  return {
    reviewId,
    reply,
    replyDraftAt: now,
    review: getReview(wid, reviewId),
  };
}

/**
 * Background sync for paid workspaces with autoSync + a query configured.
 */
async function syncDueWorkspaces(opts = {}) {
  const ids = opts.workspaceIds || (await dbService.listWorkspaceIds());
  const results = [];
  for (const wid of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const ws = await dbService.getWorkspace(wid);
      if (!ws || ws.archivedAt || ws.isDemo) continue;
      if (!isPaidWorkspace(ws)) continue;
      const settings = getSettings(wid);
      if (!settings.autoSync || !settings.query) continue;
      // eslint-disable-next-line no-await-in-loop
      const r = await syncWorkspace(wid, { workspace: ws, force: !!opts.force });
      results.push({
        workspaceId: wid,
        ok: true,
        skipped: !!r.skipped,
        newCount: r.newCount || 0,
      });
    } catch (e) {
      console.warn('[businessReviews] sync %s failed: %s', wid, e && e.message);
      results.push({ workspaceId: wid, ok: false, error: e.message });
    }
  }
  return results;
}

function inboxSummary(store) {
  const reviews = (store && store.reviews) || [];
  const newCount = reviews.filter((r) => r.isNew).length;
  const unreplied = reviews.filter((r) => !r.ownerResponse).length;
  const withDraft = reviews.filter((r) => r.replyDraft).length;
  return {
    total: reviews.length,
    newCount,
    unreplied,
    withDraft,
    placeRating: store.placeRating,
    placeReviewsCount: store.placeReviewsCount,
    placeName: store.placeName || '',
    lastSyncedAt: store.lastSyncedAt,
    lastError: store.lastError,
  };
}

module.exports = {
  SETTINGS_PREFIX,
  STORE_PREFIX,
  MIN_SYNC_GAP_MS,
  isPaidWorkspace,
  getSettings,
  saveSettings,
  getStore,
  getReview,
  syncWorkspace,
  syncDueWorkspaces,
  draftReply,
  markReviewSeen,
  markAllSeen,
  normalizeStoredReview,
  reviewFingerprint,
  mergeReviews,
  inboxSummary,
  notifyNewReviews,
};
