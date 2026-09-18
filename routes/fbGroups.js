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
  return t.trim().slice(0, 200);
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

function normalizeLastPosted(raw) {
  return String(raw || '').trim().slice(0, 80);
}

function normalizeAdminContact(raw) {
  return String(raw || '').trim().slice(0, 200);
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
  };
}

router.get('/', async (req, res, next) => {
  try {
    const groups = await dbService.listWorkspaceFbGroups(req.workspaceId);
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
    const titleIn = cleanFbGroupTitle(String(req.body.title || '').trim().slice(0, 200));
    const meta = metaFromBody(req.body);
    const title = titleIn || titleFromGroupUrl(url) || url;
    const id = newGroupId();
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      id,
      url,
      title,
      ...meta,
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
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
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
    const title =
      cleanFbGroupTitle(String(req.body.title || '').trim().slice(0, 200)) || existing.title;
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
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      title,
      note: meta.note,
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
    });
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
module.exports.parseMemberCountInput = parseMemberCountInput;
module.exports.normalizePrivacy = normalizePrivacy;
module.exports.normalizeLastPosted = normalizeLastPosted;
module.exports.normalizeAdminContact = normalizeAdminContact;
module.exports.normalizeLastVisited = normalizeLastVisited;
