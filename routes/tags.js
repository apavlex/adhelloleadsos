const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { triggerGhlProspectSync } = require('../services/ghlProspectSync');
const {
  tagNameMap,
  tagChangeSummary,
  nextTagKeysForMode,
  saveLeadTagChange,
  tagsWithLeadCounts,
  resolveLeadsForTagAssign,
  findMatchedLead,
  storageKeyForLead,
} = require('../services/leadTagAssign');
const teamActivity = require('../services/teamActivity');

router.get('/manage', async (req, res, next) => {
  try {
    const tags = await tagsWithLeadCounts(req);
    res.render('tags-manage', {
      title: 'Tags · Agency OS',
      activePage: 'tags',
      tags,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tags = await tagsWithLeadCounts(req);
    res.json({ success: true, tags });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Tag name is required.' });
    const color = req.body?.color;
    const tag = await dbService.createTag(req.workspaceId, name, color);
    teamActivity.record(req, { category: 'tags', action: 'tag_create', summary: `Created tag "${name}"` });
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

    const { matched } = await resolveLeadsForTagAssign(req, [leadKey]);
    const target = matched[0];
    if (!target) return res.status(404).json({ success: false, error: 'Lead not found.' });

    const fullKey = await storageKeyForLead(target, req.workspaceId);
    const existing = await dbService.getLead(fullKey, req.workspaceId);
    if (!existing) return res.status(404).json({ success: false, error: 'Lead not found.' });

    const prev = dbService.normalizeTagKeys(existing.tags);
    const nextTags = nextTagKeysForMode(prev, mode, tagKeys);
    const change = await saveLeadTagChange({ workspaceId: req.workspaceId, fullKey, prev, nextTags, mode });
    if (!change) return res.status(404).json({ success: false, error: 'Could not save tags on lead.' });
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'tag_assign' });
    if (change.added.length || change.removed.length) {
      const names = await tagNameMap(req.workspaceId);
      teamActivity.record(req, {
        category: 'tags',
        action: 'lead_tags',
        summary: tagChangeSummary(names, change.added, change.removed),
        leadKey: fullKey,
        leadTitle: existing.title,
      });
    }
    res.json({ success: true, lead: change.lead });
  } catch (e) {
    next(e);
  }
});

/** Body-based color update — tag keys contain colons (tag:uuid:ts). */
router.post('/set-color', async (req, res, next) => {
  try {
    const tagKey = String(req.body?.tagKey || '').trim();
    const color = String(req.body?.color || '').trim();
    if (!tagKey) return res.status(400).json({ success: false, error: 'tagKey is required.' });
    if (!color) return res.status(400).json({ success: false, error: 'Tag color is required.' });
    const tag = await dbService.setTagColor(req.workspaceId, tagKey, color);
    if (!tag) return res.status(404).json({ success: false, error: 'Tag not found.' });
    res.json({ success: true, tag });
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
    const { leadKeys, matched } = await resolveLeadsForTagAssign(req, leadKeysRaw);

    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }
    if (!tagKeys.length && mode !== 'remove') {
      return res.status(400).json({ success: false, error: 'tagKeys is required.' });
    }

    const updated = [];
    const missedKeys = [];

    for (const rawKey of leadKeys) {
      const target = findMatchedLead(matched, rawKey);
      if (!target) {
        missedKeys.push(rawKey);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const fullKey = await storageKeyForLead(target, req.workspaceId);
      // eslint-disable-next-line no-await-in-loop
      const existing = await dbService.getLead(fullKey, req.workspaceId);
      if (!existing) {
        missedKeys.push(rawKey);
        continue;
      }

      const prev = dbService.normalizeTagKeys(existing.tags);
      const nextTags = nextTagKeysForMode(prev, mode, tagKeys);
      // eslint-disable-next-line no-await-in-loop
      const change = await saveLeadTagChange({ workspaceId: req.workspaceId, fullKey, prev, nextTags, mode });
      if (change) updated.push(change.lead);
      else missedKeys.push(rawKey);
    }

    if (!updated.length) {
      return res.status(404).json({
        success: false,
        error: 'No matching leads were updated. Refresh the page and try again.',
        attempted: leadKeys.length,
        missedKeys,
      });
    }

    {
      const names = await tagNameMap(req.workspaceId);
      const label = tagKeys.map((k) => names.get(k) || 'tag').join(', ');
      const verb = mode === 'remove' ? 'Removed' : mode === 'add' ? 'Added' : 'Set tags';
      const count = updated.length;
      teamActivity.record(req, {
        category: 'tags',
        action: 'bulk_tags',
        summary: `${verb} ${label || 'tags'} ${mode === 'remove' ? 'from' : 'on'} ${count} lead${count === 1 ? '' : 's'}`,
        leadKeys: updated.map((l) => l.key),
        leadTitle: count === 1 ? updated[0].title : null,
      });
    }

    res.json({
      success: true,
      updatedKeys: updated.map((l) => l.key),
      leads: updated,
      missedKeys,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/active', async (req, res, next) => {
  try {
    const tagKey = req.params.tagKey;
    const raw = req.body && req.body.isActive;
    const isActive = raw === true || raw === 'true' || raw === 1 || raw === '1';
    const tag = await dbService.setTagActive(req.workspaceId, tagKey, isActive);
    if (!tag) return res.status(404).json({ success: false, error: 'Tag not found.' });
    res.json({ success: true, tag });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/color', async (req, res, next) => {
  try {
    const tagKey = req.params.tagKey;
    const color = String(req.body?.color || '').trim();
    if (!color) return res.status(400).json({ success: false, error: 'Tag color is required.' });
    const tag = await dbService.setTagColor(req.workspaceId, tagKey, color);
    if (!tag) return res.status(404).json({ success: false, error: 'Tag not found.' });
    res.json({ success: true, tag });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/rename', async (req, res, next) => {
  try {
    const tagKey = req.params.tagKey;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Tag name is required.' });
    const oldName = (await tagNameMap(req.workspaceId)).get(tagKey);
    const tag = await dbService.renameTag(req.workspaceId, tagKey, name);
    if (!tag) return res.status(404).json({ success: false, error: 'Tag not found.' });
    teamActivity.record(req, {
      category: 'tags',
      action: 'tag_rename',
      summary: oldName ? `Renamed tag "${oldName}" → "${name}"` : `Renamed tag to "${name}"`,
    });
    res.json({ success: true, tag });
  } catch (e) {
    next(e);
  }
});

router.post('/:tagKey/delete', async (req, res, next) => {
  try {
    const oldName = (await tagNameMap(req.workspaceId)).get(req.params.tagKey);
    await dbService.deleteTag(req.workspaceId, req.params.tagKey);
    teamActivity.record(req, {
      category: 'tags',
      action: 'tag_delete',
      summary: `Deleted tag "${oldName || 'tag'}"`,
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
