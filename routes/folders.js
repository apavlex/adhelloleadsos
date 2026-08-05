const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { wantsJsonResponse } = require('../lib/httpRequest');
const { migrateUnfiledLeadsToPipelineFolders, deleteFolderComplete } = require('../services/pipelineFolders');
const { moveFolder } = require('../services/folderMove');
const { isInOutreachFolder } = require('../services/leadListFilters');
const { parseSearchPresetFromForm, normalizeSearchPreset } = require('../services/folderSearchPreset');
const { parseInfoPackFromBody, normalizeInfoPack } = require('../services/infoPack');

router.get('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folders = await dbService.listFolders(wid);
    res.json({ success: true, folders });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Folder name is required.' });
    const meta = {};
    if (req.body && req.body.jobType) meta.jobType = String(req.body.jobType).trim();
    if (req.body && req.body.parentFolderKey) {
      meta.parentFolderKey = String(req.body.parentFolderKey).trim();
    }
    const folder = await dbService.createFolder(wid, name, meta);
    res.json({ success: true, folder });
  } catch (e) {
    next(e);
  }
});

/** Body-based delete — folder keys contain colons (folder:uuid:ts). */
router.post('/delete', async (req, res, next) => {
  try {
    const folderKey = String(req.body?.folderKey || '').trim();
    if (!folderKey) {
      return res.status(400).json({ success: false, error: 'folderKey is required.' });
    }
    const result = await deleteFolderComplete(req.workspaceId, folderKey);
    if (!result.deleted) {
      return res.status(404).json({ success: false, error: result.error || 'Folder not found.' });
    }
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.get('/:folderKey/info-pack', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = String(req.params.folderKey || '').trim();
    if (!folderKey) {
      return res.status(400).json({ success: false, error: 'folderKey is required.' });
    }
    const folder = await dbService.getFolder(wid, folderKey);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }
    const infoPack = folder.infoPack ? normalizeInfoPack(folder.infoPack) : null;
    res.json({ success: true, folderKey, infoPack, folder });
  } catch (e) {
    next(e);
  }
});

router.post('/save-info-pack', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = String(req.body?.folderKey || '').trim();
    if (!folderKey) {
      return res.status(400).json({ success: false, error: 'folderKey is required.' });
    }
    const existing = await dbService.getFolder(wid, folderKey);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }
    const infoPack = req.body && req.body.clearInfoPack ? null : parseInfoPackFromBody(req.body);
    const folder = await dbService.updateFolder(wid, folderKey, { infoPack });
    res.json({ success: true, folder, infoPack });
  } catch (e) {
    next(e);
  }
});

router.post('/save-search-preset', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = String(req.body?.folderKey || '').trim();
    if (!folderKey) {
      return res.status(400).json({ success: false, error: 'folderKey is required.' });
    }
    const existing = await dbService.getFolder(wid, folderKey);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }
    const searchPreset = parseSearchPresetFromForm(req.body);
    const folder = await dbService.updateFolder(wid, folderKey, { searchPreset });
    res.json({ success: true, folder, searchPreset });
  } catch (e) {
    next(e);
  }
});

router.post('/migrate-pipelines', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const unfiled = visible.filter((l) => !isInOutreachFolder(l));
    const stats = await migrateUnfiledLeadsToPipelineFolders(req.workspaceId, unfiled);

    if (wantsJsonResponse(req)) {
      return res.json({ success: true, stats });
    }

    const params = new URLSearchParams({
      tab: 'pipeline',
      pipelineMigrate: '1',
      migrated: String(stats.total || 0),
      maps: String(stats.maps_business || 0),
      mh: String(stats.mobile_homes || 0),
      re: String(stats.real_estate || 0),
      skipped: String(stats.skipped || 0),
    });
    return res.redirect(`/prospecting?${params.toString()}`);
  } catch (e) {
    next(e);
  }
});

router.post('/assign', async (req, res, next) => {
  try {
    const leadKey = String(req.body?.leadKey || '').trim();
    const folderKey = String(req.body?.folderKey || '').trim();
    if (!leadKey) return res.status(400).json({ success: false, error: 'leadKey is required.' });

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const lead = visible.find((l) => l.key === leadKey || `lead:${leadKey}` === l.key);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });

    const updated = await dbService.updateLead(lead.key, { folderKey: folderKey || '' });
    res.json({ success: true, lead: updated });
  } catch (e) {
    next(e);
  }
});

router.post('/assign-bulk', async (req, res, next) => {
  try {
    const folderKey = String(req.body?.folderKey || '').trim();
    const leadKeysRaw = Array.isArray(req.body?.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw
      .map((k) => String(k || '').trim())
      .filter(Boolean);

    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const visibleKeys = new Set(visible.map((l) => l.key));

    const resolveVisibleLeadKey = (rawKey) => {
      const k = String(rawKey || '').trim();
      if (!k) return null;
      const candidates = [
        k,
        k.startsWith('lead:') ? k : `lead:${k}`,
        k.startsWith('lead:') ? k.slice(5) : null,
      ].filter(Boolean);
      for (const c of candidates) {
        if (visibleKeys.has(c)) return c;
      }
      return null;
    };

    const updated = [];
    for (const key of leadKeys) {
      const fullKey = resolveVisibleLeadKey(key);
      if (!fullKey) continue;
      // eslint-disable-next-line no-await-in-loop
      const lead = await dbService.updateLead(fullKey, { folderKey: folderKey || '' });
      if (lead) updated.push(lead.key);
    }

    res.json({ success: true, updatedKeys: updated });
  } catch (e) {
    next(e);
  }
});

router.post('/rename', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = String(req.body?.folderKey || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!folderKey) return res.status(400).json({ success: false, error: 'folderKey is required.' });
    if (!name) return res.status(400).json({ success: false, error: 'Folder name is required.' });
    const folder = await dbService.renameFolder(wid, folderKey, name);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found.' });
    res.json({ success: true, folder });
  } catch (e) {
    next(e);
  }
});

router.post('/move', async (req, res, next) => {
  try {
    const folderKey = String(req.body?.folderKey || '').trim();
    const parentFolderKey =
      req.body?.parentFolderKey != null ? String(req.body.parentFolderKey).trim() : '';
    if (!folderKey) {
      return res.status(400).json({ success: false, error: 'folderKey is required.' });
    }
    const result = await moveFolder(req.workspaceId, folderKey, parentFolderKey);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error || 'Could not move folder.' });
    }
    res.json({ success: true, folder: result.folder });
  } catch (e) {
    next(e);
  }
});

/** @deprecated Prefer POST /folders/delete with body.folderKey */
router.post('/:folderKey/rename', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = req.params.folderKey;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Folder name is required.' });
    const folder = await dbService.renameFolder(wid, folderKey, name);
    res.json({ success: true, folder });
  } catch (e) {
    next(e);
  }
});

/** @deprecated Prefer POST /folders/delete with body.folderKey */
router.post('/:folderKey/delete', async (req, res, next) => {
  try {
    const folderKey = req.params.folderKey;
    const result = await deleteFolderComplete(req.workspaceId, folderKey);
    if (!result.deleted) {
      return res.status(404).json({ success: false, error: result.error || 'Folder not found.' });
    }
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
