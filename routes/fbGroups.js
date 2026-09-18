const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const {
  FB_GROUP_SCRIPT_CATEGORIES,
  listFbGroupScriptsFlat,
} = require('../config/fbGroupScripts');

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

function newGroupId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

router.get('/', async (req, res, next) => {
  try {
    const groups = await dbService.listWorkspaceFbGroups(req.workspaceId);
    res.render('fb-groups', {
      title: 'Facebook Groups | Agency OS',
      activePage: 'fb-groups',
      groups,
      scriptCategories: FB_GROUP_SCRIPT_CATEGORIES,
      saveError: req.query.error === 'invalid',
      notGroupError: req.query.error === 'not_group',
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
    const titleIn = String(req.body.title || '').trim().slice(0, 200);
    const note = String(req.body.note || '').trim().slice(0, 2000);
    const category = String(req.body.category || '').trim().slice(0, 80);
    const title = titleIn || titleFromGroupUrl(url) || url;
    const id = newGroupId();
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      id,
      url,
      title,
      note,
      category,
      addedBy: email,
    });
    res.redirect(302, '/fb-groups');
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
    const title = String(req.body.title || '').trim().slice(0, 200) || existing.title;
    const note = String(req.body.note || '').trim().slice(0, 2000);
    const category = String(req.body.category || '').trim().slice(0, 80);
    await dbService.saveWorkspaceFbGroup(req.workspaceId, {
      ...existing,
      title,
      note,
      category,
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
