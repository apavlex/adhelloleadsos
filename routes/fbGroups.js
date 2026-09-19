const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const {
  FB_GROUP_SCRIPT_CATEGORIES,
  listFbGroupScriptsFlat,
} = require('../config/fbGroupScripts');
const { isChromeExtensionAvailable } = require('../services/chromeExtensionPack');

function chromeExtensionRenderLocals() {
  const base = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  const ingestKeyRaw = String(process.env.API_INGEST_KEY || '').trim();
  const apiIngestKeyConfigured = !!ingestKeyRaw;
  const apiIngestKeyMask =
    apiIngestKeyConfigured && ingestKeyRaw.length >= 4 ? `••••${ingestKeyRaw.slice(-4)}` : '';
  const apiIngestKeyPlain = apiIngestKeyConfigured ? ingestKeyRaw : '';
  const chromeExtensionRepoUrl = String(
    process.env.CHROME_EXTENSION_REPO_URL ||
      'https://github.com/apavlex/adhelloleadsos/tree/main/chrome-extension',
  ).trim();
  return {
    publicAppBaseUrl: base,
    apiIngestKeyConfigured,
    apiIngestKeyMask,
    apiIngestKeyPlain,
    chromeExtensionRepoUrl,
    chromeExtensionDownloadUrl: '/workspace/integrations/chrome-extension/download',
    chromeExtensionDownloadReady: isChromeExtensionAvailable(),
  };
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function isFacebookGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h !== 'facebook.com' && h !== 'm.facebook.com' && h !== 'web.facebook.com') {
      return false;
    }
    return /\/groups\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Prefer a clean https://www.facebook.com/groups/... URL for one-click open. */
function canonicalizeGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/groups\/([^/?#]+)/i);
    if (!m) return urlStr;
    const slug = m[1];
    return `https://www.facebook.com/groups/${slug}`;
  } catch {
    return urlStr;
  }
}

function titleFromGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/groups\/([^/?#]+)/i);
    if (!m) return '';
    const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
    if (/^\d+$/.test(slug)) return `Facebook Group ${slug}`;
    return slug.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

/** Strip tab noise like "(1) Name | Groups | Facebook" from document titles. */
function cleanFbGroupTitle(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/^\(\d+\)\s*/, '');
  t = t.replace(/\s*[|·•]\s*Groups\s*[|·•]\s*Facebook\s*$/i, '');
  t = t.replace(/\s*[|·•]\s*Facebook\s*$/i, '');
  t = t.replace(/\s*[|·•]\s*Groups\s*$/i, '');
  t = t.trim().slice(0, 200);
  if (isJunkFbGroupTitle(t)) return '';
  return t;
}

/** Facebook chrome titles that are not the group name. */
function isJunkFbGroupTitle(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\(\d+\)\s*/, '');
  if (!s) return true;
  return /^(notifications?|facebook|home|watch|marketplace|menu|friends|feeds?|groups?|search|reels|gaming|messages?|inbox|profile|settings|login|log in)$/i.test(
    s,
  );
}

/**
 * Prefer a real group name; never keep Notifications / Facebook chrome titles.
 */
function resolveFbGroupTitle({ titleIn, url, existingTitle } = {}) {
  const cleaned = cleanFbGroupTitle(titleIn);
  if (cleaned) return cleaned;
  const existing = cleanFbGroupTitle(existingTitle) || String(existingTitle || '').trim();
  if (existing && !isJunkFbGroupTitle(existing)) return existing.slice(0, 200);
  return titleFromGroupUrl(url) || url || 'Facebook Group';
}

/**
 * Accept "12345", "12,345", "12K members", etc.
 * @returns {{ memberCount: number|null, memberCountLabel: string }}
 */
function parseMemberCountInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return { memberCount: null, memberCountLabel: '' };
  const m = s.match(/([\d.,]+)\s*([KkMm])?/);
  if (!m) return { memberCount: null, memberCountLabel: s.slice(0, 40) };
  let n = Number(String(m[1]).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return { memberCount: null, memberCountLabel: s.slice(0, 40) };
  const suffix = m[2] || '';
  if (/k/i.test(suffix)) n *= 1000;
  if (/m/i.test(suffix)) n *= 1000000;
  const memberCount = Math.round(n);
  const memberCountLabel = memberCount >= 1000
    ? `${memberCount.toLocaleString()} members`
    : `${memberCount} member${memberCount === 1 ? '' : 's'}`;
  return { memberCount, memberCountLabel };
}

function normalizePrivacy(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'public' || s === 'private') return s;
  return '';
}

function formatLocalShortDate(d) {
  const date = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function startOfLocalDay(d = new Date()) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return out;
}

function parseLocalCalendarDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
  );
  if (!m) return null;
  const monKey = m[1].toLowerCase().slice(0, 3);
  const months = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = months[monKey];
  if (month == null) return null;
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize last-activity labels. Uses the local calendar (not UTC) so
 * evening saves don't show as "tomorrow", and future dates are clamped to today.
 */
function normalizeLastPosted(raw) {
  const s = String(raw || '').trim().slice(0, 80);
  if (!s) return '';
  const lower = s.toLowerCase();

  if (lower === 'today' || lower === 'just now' || /^today\b/i.test(s)) {
    return formatLocalShortDate(new Date());
  }
  if (lower === 'yesterday' || /^yesterday\b/i.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatLocalShortDate(d);
  }

  const ago = lower.match(
    /^(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|d|day|days|w|week|weeks)\s*ago$/,
  );
  if (ago) {
    const n = Math.max(0, Number(ago[1]) || 0);
    const unit = ago[2];
    const d = new Date();
    if (/^d$|^day/.test(unit)) d.setDate(d.getDate() - n);
    else if (/^w$|^week/.test(unit)) d.setDate(d.getDate() - n * 7);
    // minutes/hours → same local calendar day
    return formatLocalShortDate(d);
  }

  const cal = parseLocalCalendarDate(s);
  if (cal) {
    const today = startOfLocalDay();
    if (startOfLocalDay(cal).getTime() > today.getTime()) {
      // Last activity cannot be in the future (UTC bleed / bad scrape).
      return formatLocalShortDate(today);
    }
    return formatLocalShortDate(cal);
  }

  return s;
}

function normalizeAdminContact(raw) {
  return String(raw || '').trim().slice(0, 200);
}

function normalizeFbGroupTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,#]+/)
        .map((t) => t.trim());
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t || '')
      .trim()
      .replace(/^#/, '')
      .slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function mergeFbGroupTags(existing, incoming) {
  return normalizeFbGroupTags([...(normalizeFbGroupTags(existing) || []), ...(normalizeFbGroupTags(incoming) || [])]);
}

function listFbGroupNotes(group) {
  const notes = Array.isArray(group && group.notes) ? group.notes.filter((n) => n && String(n.text || '').trim()) : [];
  if (notes.length) return notes;
  const legacy = String((group && group.note) || '').trim();
  if (!legacy) return [];
  return [
    {
      id: 'legacy',
      text: legacy.slice(0, 4000),
      createdAt: String((group && (group.updatedAt || group.createdAt)) || '').slice(0, 40),
    },
  ];
}

function appendFbGroupNote(existingNotes, text) {
  const body = String(text || '').trim().slice(0, 4000);
  if (!body) return existingNotes || [];
  const now = new Date().toISOString();
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: body,
    createdAt: now,
  };
  return [entry, ...(Array.isArray(existingNotes) ? existingNotes : [])].slice(0, 40);
}

/** Optional ISO / date-ish string for last visited. Empty clears; invalid ignored when keepExisting. */
function normalizeLastVisited(raw, { keepExisting } = {}) {
  const s = String(raw || '').trim();
  if (!s) return keepExisting ? undefined : '';
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return s.slice(0, 40);
}

function newGroupId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function metaFromBody(body) {
  const b = body || {};
  const { memberCount, memberCountLabel } = parseMemberCountInput(b.memberCount || b.members);
  return {
    note: String(b.note || '').trim().slice(0, 2000),
    category: String(b.category || '').trim().slice(0, 80),
    location: String(b.location || '').trim().slice(0, 120),
    privacy: normalizePrivacy(b.privacy),
    memberCount,
    memberCountLabel,
    lastPosted: normalizeLastPosted(b.lastPosted),
    adminContact: normalizeAdminContact(b.adminContact || b.admin || b.ownerContact),
    lastVisited: normalizeLastVisited(b.lastVisited, { keepExisting: true }),
    tags: normalizeFbGroupTags(b.tags || b.tagNames),
  };
}

router.get('/', async (req, res, next) => {
  try {
    let groups = await dbService.listWorkspaceFbGroups(req.workspaceId);
    // Repair junk titles and future lastPosted labels (UTC / scrape off-by-one).
    groups = await Promise.all(
      (groups || []).map(async (g) => {
        if (!g) return g;
        let next = g;
        if (isJunkFbGroupTitle(g.title)) {
          const fixed = resolveFbGroupTitle({ titleIn: '', url: g.url, existingTitle: g.title });
          if (fixed && fixed !== g.title) next = { ...next, title: fixed };
        }
        const posted = normalizeLastPosted(g.lastPosted);
        if (posted && posted !== String(g.lastPosted || '').trim()) {
          next = { ...next, lastPosted: posted };
        }
        if (next === g) return g;
        try {
          return await dbService.saveWorkspaceFbGroup(req.workspaceId, next);
        } catch (_) {
          return next;
        }
      }),
    );
    res.render('fb-groups', {
      title: 'Facebook Groups | Agency OS',
      activePage: 'fb-groups',
      groups,
      saveError: req.query.error === 'invalid',
      notGroupError: req.query.error === 'not_group',
      ...chromeExtensionRenderLocals(),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/add', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const urlRaw = normalizeUrl(req.body.url);
    if (!urlRaw || urlRaw.length > 2048) {
      return res.redirect(302, '/fb-groups?error=invalid');
    }
    if (!isFacebookGroupUrl(urlRaw)) {
      return res.redirect(302, '/fb-groups?error=not_group');
    }
    const url = canonicalizeGroupUrl(urlRaw);
    const meta = metaFromBody(req.body);
    const title = resolveFbGroupTitle({
      titleIn: req.body.title,
      url,
    });
    const id = newGroupId();
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      id,
      url,
      title,
      ...meta,
      posts: [],
      notes: meta.note
        ? [{ id: `${Date.now()}_n`, text: meta.note, createdAt: new Date().toISOString() }]
        : [],
      tags: meta.tags || [],
      lastVisited: meta.lastVisited || new Date().toISOString(),
      addedBy: email,
    });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.get('/:id/open', async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing || !existing.url) return res.redirect(302, '/fb-groups');
    const fixedTitle = resolveFbGroupTitle({
      titleIn: existing.title,
      url: existing.url,
      existingTitle: existing.title,
    });
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      title: fixedTitle,
      lastVisited: new Date().toISOString(),
    });
    res.redirect(302, existing.url);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/delete', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    await dbService.deleteWorkspaceFbGroup(req.workspaceId, req.params.id);
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/update', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing) return res.redirect(302, '/fb-groups');
    const title = resolveFbGroupTitle({
      titleIn: req.body.title,
      url: existing.url,
      existingTitle: existing.title,
    });
    const meta = metaFromBody(req.body);
    const membersRaw = String(req.body.memberCount || req.body.members || '').trim();
    let memberCount = existing.memberCount ?? null;
    let memberCountLabel = existing.memberCountLabel || '';
    if (!membersRaw) {
      memberCount = null;
      memberCountLabel = '';
    } else {
      memberCount = meta.memberCount;
      memberCountLabel = meta.memberCountLabel;
    }
    const lastVisitedRaw = String(req.body.lastVisited || '').trim();
    let notes = listFbGroupNotes(existing);
    const nextNote = meta.note;
    const latestText = notes[0] && notes[0].text ? String(notes[0].text).trim() : '';
    if (nextNote && nextNote !== latestText) {
      notes = appendFbGroupNote(notes, nextNote);
    }
    const tags = mergeFbGroupTags(existing.tags, meta.tags);
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      title,
      note: nextNote || (notes[0] && notes[0].text) || '',
      category: meta.category,
      location: meta.location,
      privacy: meta.privacy || existing.privacy || '',
      memberCount,
      memberCountLabel,
      lastPosted: meta.lastPosted,
      adminContact: meta.adminContact,
      lastVisited: lastVisitedRaw
        ? normalizeLastVisited(lastVisitedRaw) || existing.lastVisited || ''
        : existing.lastVisited || '',
      posts: Array.isArray(existing.posts) ? existing.posts : [],
      notes,
      tags,
    });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/notes', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing) return res.redirect(302, '/fb-groups');
    const text = String(req.body.noteText || req.body.text || '').trim().slice(0, 4000);
    if (!text) return res.redirect(302, '/fb-groups');
    const notes = appendFbGroupNote(listFbGroupNotes(existing), text);
    const tags = mergeFbGroupTags(existing.tags, req.body.tags);
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      notes,
      tags,
      note: notes[0] ? notes[0].text : existing.note || '',
    });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/notes/:noteId/delete', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing) return res.redirect(302, '/fb-groups');
    const noteId = String(req.params.noteId || '').trim();
    const notes = listFbGroupNotes(existing).filter((n) => n && String(n.id) !== noteId);
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      notes,
      note: notes[0] ? notes[0].text : '',
    });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/posts', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing) return res.redirect(302, '/fb-groups');
    const text = String(req.body.postText || req.body.text || '').trim().slice(0, 4000);
    if (!text) return res.redirect(302, '/fb-groups');
    const postedAtRaw = String(req.body.postedAt || '').trim().slice(0, 40);
    const now = new Date();
    const localYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      postedAt: postedAtRaw || localYmd,
      createdAt: now.toISOString(),
    };
    const posts = [entry, ...(Array.isArray(existing.posts) ? existing.posts : [])].slice(0, 40);
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      posts,
      lastPosted:
        normalizeLastPosted(postedAtRaw || existing.lastPosted || 'today') || existing.lastPosted,
    });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/posts/:postId/delete', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const existing = await dbService.getWorkspaceFbGroup(req.workspaceId, req.params.id);
    if (!existing) return res.redirect(302, '/fb-groups');
    const postId = String(req.params.postId || '').trim();
    const posts = (Array.isArray(existing.posts) ? existing.posts : []).filter(
      (p) => p && String(p.id) !== postId,
    );
    await dbService.saveWorkspaceFbGroup(req.workspaceId, { ...existing, posts });
    res.redirect(302, '/fb-groups');
  } catch (e) {
    next(e);
  }
});

/** JSON helpers for page scripts / future chrome use while logged in */
router.get('/api/scripts', (req, res) => {
  res.json({
    success: true,
    categories: FB_GROUP_SCRIPT_CATEGORIES,
    scripts: listFbGroupScriptsFlat(),
  });
});

router.get('/api/list', async (req, res, next) => {
  try {
    const groups = await dbService.listWorkspaceFbGroups(req.workspaceId);
    res.json({ success: true, groups });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.isFacebookGroupUrl = isFacebookGroupUrl;
module.exports.canonicalizeGroupUrl = canonicalizeGroupUrl;
module.exports.normalizeUrl = normalizeUrl;
module.exports.titleFromGroupUrl = titleFromGroupUrl;
module.exports.cleanFbGroupTitle = cleanFbGroupTitle;
module.exports.isJunkFbGroupTitle = isJunkFbGroupTitle;
module.exports.resolveFbGroupTitle = resolveFbGroupTitle;
module.exports.parseMemberCountInput = parseMemberCountInput;
module.exports.normalizePrivacy = normalizePrivacy;
module.exports.normalizeLastPosted = normalizeLastPosted;
module.exports.normalizeAdminContact = normalizeAdminContact;
module.exports.normalizeLastVisited = normalizeLastVisited;
module.exports.normalizeFbGroupTags = normalizeFbGroupTags;
module.exports.mergeFbGroupTags = mergeFbGroupTags;
module.exports.listFbGroupNotes = listFbGroupNotes;
module.exports.appendFbGroupNote = appendFbGroupNote;
