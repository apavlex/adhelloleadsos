const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
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

const RESOURCE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'resources');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

function safeBaseName(name) {
  return String(name || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 120) || 'resource';
}

function safeWorkspaceId(wid) {
  return String(wid || 'default')
    .trim()
    .replace(/[^\w-]+/g, '_')
    .slice(0, 64) || 'default';
}

async function removeResourceFileMaybe(resource) {
  const p = String((resource && resource.storagePath) || '').trim();
  if (!p) return;
  const resolved = path.resolve(p);
  if (!resolved.startsWith(`${RESOURCE_UPLOAD_DIR}${path.sep}`)) return;
  try {
    await fs.unlink(resolved);
  } catch {
    // ignore missing file cleanup errors
  }
}

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    await dbService.mergeUserResourcesIntoWorkspace(req.workspaceId, email);
    const filterKind = String(req.query.kind || 'all').toLowerCase();
    const resourcesAll = await dbService.listWorkspaceResources(req.workspaceId);
    const allowedFilters = new Set(['all', 'youtube', 'drive', 'x', 'link']);
    const fk = allowedFilters.has(filterKind) ? filterKind : 'all';
    const resourceKindCounts = {
      all: resourcesAll.length,
      youtube: 0,
      drive: 0,
      x: 0,
      link: 0,
    };
    for (const r of resourcesAll) {
      const k = String(r.kind || 'link').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(resourceKindCounts, k)) resourceKindCounts[k] += 1;
    }
    const resources = fk === 'all' ? resourcesAll : resourcesAll.filter((r) => r.kind === fk);
    res.render('resources', {
      title: 'Resources | Agency OS',
      activePage: 'resources',
      resources,
      kindFilter: fk,
      kindOptions: KIND_OPTIONS,
      resourceKindCounts,
      saveError: req.query.error === 'invalid',
      uploadError: req.query.error === 'invalid_upload',
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
    await dbService.saveWorkspaceResource(req.workspaceId, {
      id,
      url,
      title,
      note,
      kind,
      addedBy: email,
    });
    res.redirect(302, '/resources');
  } catch (e) {
    next(e);
  }
});

router.post('/upload', upload.single('resourceFile'), async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!req.file || !req.file.buffer) return res.redirect(302, '/resources?error=invalid_upload');
    const fileSize = Number(req.file.size || req.file.buffer.length || 0);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return res.redirect(302, '/resources?error=invalid_upload');
    }
    const id = newResourceId();
    const ext = path.extname(String(req.file.originalname || '')).slice(0, 16).toLowerCase();
    const base = safeBaseName(path.basename(String(req.file.originalname || ''), ext));
    const widSafe = safeWorkspaceId(req.workspaceId);
    await fs.mkdir(RESOURCE_UPLOAD_DIR, { recursive: true });
    const fileNameOnDisk = `${widSafe}__${id}__${base}${ext}`;
    const absPath = path.join(RESOURCE_UPLOAD_DIR, fileNameOnDisk);
    await fs.writeFile(absPath, req.file.buffer);

    const titleIn = String(req.body.title || '').trim().slice(0, 200);
    const note = String(req.body.note || '').trim().slice(0, 2000);
    const title = titleIn || String(req.file.originalname || `${base}${ext || ''}`);
    await dbService.saveWorkspaceResource(req.workspaceId, {
      id,
      url: `/resources/file/${encodeURIComponent(id)}`,
      title,
      note,
      kind: 'link',
      addedBy: email,
      sourceType: 'upload',
      fileName: String(req.file.originalname || `${base}${ext || ''}`),
      mimeType: String(req.file.mimetype || '').slice(0, 160),
      storagePath: absPath,
      sizeBytes: fileSize,
    });
    return res.redirect(302, '/resources');
  } catch (e) {
    if (e instanceof multer.MulterError) {
      return res.redirect(302, '/resources?error=invalid_upload');
    }
    return next(e);
  }
});

router.get('/file/:id', async (req, res, next) => {
  try {
    const id = String((req.params && req.params.id) || '').trim();
    if (!id) return res.status(404).render('error', { message: 'Resource not found.', activePage: 'resources' });
    const existing = await dbService.listWorkspaceResources(req.workspaceId);
    const resource = existing.find((r) => r && String(r.id || '') === id);
    if (!resource) return res.status(404).render('error', { message: 'Resource not found.', activePage: 'resources' });
    const p = String(resource.storagePath || '').trim();
    if (!p) {
      return res.redirect(302, resource.url || '/resources');
    }
    const resolved = path.resolve(p);
    if (!resolved.startsWith(`${RESOURCE_UPLOAD_DIR}${path.sep}`)) {
      return res.status(403).render('error', { message: 'Resource path is invalid.', activePage: 'resources' });
    }
    if (resource.mimeType) res.type(String(resource.mimeType));
    return res.sendFile(resolved);
  } catch (e) {
    return next(e);
  }
});

router.post('/remove', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const id = String(req.body.id || '').trim();
    if (!id) return res.redirect(302, '/resources');
    const existing = await dbService.listWorkspaceResources(req.workspaceId);
    const resource = existing.find((r) => r && r.id === id);
    if (!resource) return res.redirect(302, '/resources');
    await dbService.deleteWorkspaceResource(req.workspaceId, id);
    await removeResourceFileMaybe(resource);
    res.redirect(302, '/resources');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
