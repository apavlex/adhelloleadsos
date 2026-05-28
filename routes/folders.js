const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');

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
    const folder = await dbService.createFolder(wid, name);
    res.json({ success: true, folder });
  } catch (e) {
    next(e);
  }
});

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

router.post('/:folderKey/delete', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const folderKey = req.params.folderKey;
    await dbService.deleteFolder(wid, folderKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/assign', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const leadKey = String(req.body?.leadKey || '').trim();
    const folderKey = String(req.body?.folderKey || '').trim();
    if (!leadKey) return res.status(400).json({ success: false, error: 'leadKey is required.' });

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const lead = visible.find((l) => l.key === leadKey || `lead:${leadKey}` === l.key);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });

    const fullLeadKey = lead.key;
    const patch = { folderKey: folderKey || '' };
    const updated = await dbService.updateLead(fullLeadKey, patch);
    res.json({ success: true, lead: updated });
  } catch (e) {
    next(e);
  }
});

router.post('/assign-bulk', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
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

module.exports = router;

