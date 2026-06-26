const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { triggerGhlProspectSync } = require('../services/ghlProspectSync');

function resolveVisibleLeadKey(visible, rawKey) {
  const k = String(rawKey || '').trim();
  if (!k) return null;
  const visibleKeys = new Set(visible.map((l) => l.key));
  const candidates = [
    k,
    k.startsWith('lead:') ? k : `lead:${k}`,
    k.startsWith('lead:') ? k.slice(5) : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (visibleKeys.has(c)) return c;
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const tags = await dbService.listTags(req.workspaceId);
    res.json({ success: true, tags });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Tag name is required.' });
    const tag = await dbService.createTag(req.workspaceId, name);
    res.json({ success: true, tag });
  } catch (e) {
    next(e);
  }
});

router.post('/assign', async (req, res, next) => {
  try {
    const leadKey = String(req.body?.leadKey || '').trim();
    const mode = String(req.body?.mode || 'set').toLowerCase();
    const tagKeys = dbService.normalizeTagKeys(
      Array.isArray(req.body?.tagKeys) ? req.body.tagKeys : [],
    );
    if (!leadKey) return res.status(400).json({ success: false, error: 'leadKey is required.' });

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const fullKey = resolveVisibleLeadKey(visible, leadKey);
    if (!fullKey) return res.status(404).json({ success: false, error: 'Lead not found.' });

    const existing = await dbService.getLead(fullKey);
    const prev = dbService.normalizeTagKeys(existing && existing.tags);
    let nextTags = prev;
    if (mode === 'add') {
      nextTags = dbService.normalizeTagKeys([...prev, ...tagKeys]);
    } else if (mode === 'remove') {
      const remove = new Set(tagKeys);
      nextTags = prev.filter((t) => !remove.has(t));
    } else {
      nextTags = tagKeys;
    }

    const lead = await dbService.setLeadTags(fullKey, nextTags);
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'tag_assign' });
    res.json({ success: true, lead });
  } catch (e) {
    next(e);
  }
});

router.post('/assign-bulk', async (req, res, next) => {
  try {
    const mode = String(req.body?.mode || 'add').toLowerCase();
    const tagKeys = dbService.normalizeTagKeys(
      Array.isArray(req.body?.tagKeys) ? req.body.tagKeys : [],
    );
    const leadKeysRaw = Array.isArray(req.body?.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }
    if (!tagKeys.length && mode !== 'remove') {
      return res.status(400).json({ success: false, error: 'tagKeys is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const updated = [];

    for (const rawKey of leadKeys) {
      const fullKey = resolveVisibleLeadKey(visible, rawKey);
      if (!fullKey) continue;
      const existing = await dbService.getLead(fullKey);
      const prev = dbService.normalizeTagKeys(existing && existing.tags);
      let nextTags = prev;
      if (mode === 'add') {
        nextTags = dbService.normalizeTagKeys([...prev, ...tagKeys]);
      } else if (mode === 'remove') {
        const remove = new Set(tagKeys);
        nextTags = prev.filter((t) => !remove.has(t));
      } else {
        nextTags = tagKeys;
      }
      // eslint-disable-next-line no-await-in-loop
      const lead = await dbService.setLeadTags(fullKey, nextTags);
      if (lead) updated.push(lead);
    }

    res.json({ success: true, updatedKeys: updated.map((l) => l.key), leads: updated });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/rename', async (req, res, next) => {
  try {
    const tagKey = req.params.tagKey;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Tag name is required.' });
    const tag = await dbService.renameTag(req.workspaceId, tagKey, name);
    if (!tag) return res.status(404).json({ success: false, error: 'Tag not found.' });
    res.json({ success: true, tag });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/delete', async (req, res, next) => {
  try {
    await dbService.deleteTag(req.workspaceId, req.params.tagKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
