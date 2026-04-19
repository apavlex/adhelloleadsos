const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');

const KIND_OPTIONS = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'drive', label: 'Google Drive / Docs' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'link', label: 'Other link' },
];

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

function detectResourceKind(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'youtube';
    if (h === 'drive.google.com' || h === 'docs.google.com') return 'drive';
    if (h === 'x.com' || h === 'twitter.com' || h === 'mobile.twitter.com') return 'x';
    return 'link';
  } catch {
    return 'link';
  }
}

function resolveKind(urlStr, requested) {
  const r = String(requested || 'auto').toLowerCase();
  if (r === 'auto') return detectResourceKind(urlStr);
  const allowed = new Set(['youtube', 'drive', 'x', 'link']);
  return allowed.has(r) ? r : detectResourceKind(urlStr);
}

function newResourceId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const filterKind = String(req.query.kind || 'all').toLowerCase();
    let resources = await dbService.listUserResources(req.workspaceId, email);
    const allowedFilters = new Set(['all', 'youtube', 'drive', 'x', 'link']);
    const fk = allowedFilters.has(filterKind) ? filterKind : 'all';
    if (fk !== 'all') {
      resources = resources.filter((r) => r.kind === fk);
    }
    res.render('resources', {
      title: 'Resources | Agency OS',
      activePage: 'resources',
      resources,
      kindFilter: fk,
      kindOptions: KIND_OPTIONS,
      saveError: req.query.error === 'invalid',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/add', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const url = normalizeUrl(req.body.url);
    if (!url || url.length > 2048) {
      return res.redirect(302, '/resources?error=invalid');
    }
    const titleIn = String(req.body.title || '').trim().slice(0, 200);
    const note = String(req.body.note || '').trim().slice(0, 2000);
    const kind = resolveKind(url, req.body.kind);
    const title = titleIn || url;
    const id = newResourceId();
    await dbService.saveUserResource(req.workspaceId, email, {
      id,
      url,
      title,
      note,
      kind,
    });
    res.redirect(302, '/resources');
  } catch (e) {
    next(e);
  }
});

router.post('/remove', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const id = String(req.body.id || '').trim();
    if (!id) return res.redirect(302, '/resources');
    const existing = await dbService.listUserResources(req.workspaceId, email);
    if (!existing.some((r) => r.id === id)) return res.redirect(302, '/resources');
    await dbService.deleteUserResource(req.workspaceId, email, id);
    res.redirect(302, '/resources');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
