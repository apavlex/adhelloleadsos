const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { triggerGhlProspectSync } = require('../services/ghlProspectSync');
const { resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');
const {
  enrollLeadInAutoOutreach,
  AUTO_OUTREACH_TAG_NAME,
} = require('../services/prospectingEnroll');
const { buildPipelineAdvancePatch } = require('../services/pipelineAdvance');
const teamActivity = require('../services/teamActivity');

async function tagNameMap(workspaceId) {
  const tags = await dbService.listTags(workspaceId);
  return new Map(tags.map((t) => [t.key, t.name || 'tag']));
}

function tagChangeSummary(names, added, removed) {
  const parts = [];
  if (added.length) parts.push(`Added ${added.map((k) => names.get(k) || 'tag').join(', ')}`);
  if (removed.length) parts.push(`Removed ${removed.map((k) => names.get(k) || 'tag').join(', ')}`);
  return parts.join(' · ');
}

async function maybeAdvanceOnTagAdd(workspaceId, lead) {
  if (!lead || !lead.key || !workspaceId) return lead;
  const patch = await buildPipelineAdvancePatch(lead, 'ADD_TAG', workspaceId);
  if (!patch || !Object.keys(patch).length) return lead;
  const updated = await dbService.updateLead(lead.key, patch, workspaceId);
  return updated || { ...lead, ...patch };
}

async function maybeEnrollAutoOutreachOnTagAdd(workspaceId, lead, addedTagKeys) {
  if (!lead || !lead.key || !Array.isArray(addedTagKeys) || !addedTagKeys.length) return null;
  const tags = await dbService.listTags(workspaceId);
  const autoTag = tags.find(
    (t) => String(t.name || '').trim().toLowerCase() === AUTO_OUTREACH_TAG_NAME,
  );
  if (!autoTag || !addedTagKeys.includes(autoTag.key)) return null;
  try {
    return await enrollLeadInAutoOutreach({
      leadKey: lead.key,
      workspaceId,
      reEnroll: false,
      tagLead: false,
    });
  } catch (e) {
    console.warn('[tags] auto-outreach enroll failed:', e && e.message);
    return null;
  }
}

function addedTagKeys(prev, next) {
  const before = new Set(dbService.normalizeTagKeys(prev));
  return dbService.normalizeTagKeys(next).filter((k) => !before.has(k));
}

async function tagsWithLeadCounts(req) {
  const tags = await dbService.listTags(req.workspaceId);
  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  const counts = new Map();
  visible.forEach((lead) => {
    dbService.normalizeTagKeys(lead && lead.tags).forEach((key) => {
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return tags.map((tag) => ({
    ...tag,
    leadCount: counts.get(tag.key) || 0,
  }));
}

async function resolveLeadsForTagAssign(req, leadKeysRaw) {
  const leadKeys = (Array.isArray(leadKeysRaw) ? leadKeysRaw : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (!leadKeys.length) return { leadKeys, matched: [] };

  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  const matched = await resolveLeadsBySelectedKeys({
    dbService,
    workspaceId: req.workspaceId,
    visibleLeads: visible,
    keyOrder: leadKeys,
  });
  return { leadKeys, matched };
}

async function storageKeyForLead(lead, workspaceId) {
  const raw = String((lead && lead.key) || '').trim();
  if (!raw) return '';
  return (await dbService.resolveLeadStorageKey(raw, workspaceId)) || raw;
}

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
    let nextTags = prev;
    if (mode === 'add') {
      nextTags = dbService.normalizeTagKeys([...prev, ...tagKeys]);
    } else if (mode === 'remove') {
      const remove = new Set(tagKeys);
      nextTags = prev.filter((t) => !remove.has(t));
    } else {
      nextTags = tagKeys;
    }

    let lead = await dbService.setLeadTags(fullKey, nextTags, req.workspaceId);
    if (!lead) return res.status(404).json({ success: false, error: 'Could not save tags on lead.' });
    const added = addedTagKeys(prev, nextTags);
    if (added.length) {
      lead = await maybeAdvanceOnTagAdd(req.workspaceId, lead);
    }
    if (mode === 'add' || added.length) {
      await maybeEnrollAutoOutreachOnTagAdd(req.workspaceId, lead, added);
      const refreshed = await dbService.getLead(fullKey, req.workspaceId);
      if (refreshed) lead = refreshed;
    }
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'tag_assign' });
    const removedTags = prev.filter((t) => !nextTags.includes(t));
    if (added.length || removedTags.length) {
      const names = await tagNameMap(req.workspaceId);
      teamActivity.record(req, {
        category: 'tags',
        action: 'lead_tags',
        summary: tagChangeSummary(names, added, removedTags),
        leadKey: fullKey,
        leadTitle: existing.title,
      });
    }
    res.json({ success: true, lead });
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
      const target =
        matched.find((l) => {
          const k = String(l.key || '').trim();
          const norm = k.replace(/^lead:/i, '');
          const rawNorm = rawKey.replace(/^lead:/i, '');
          return k === rawKey || norm === rawNorm || `lead:${norm}` === rawKey || k === `lead:${rawNorm}`;
        }) || null;
      if (!target) {
        missedKeys.push(rawKey);
        continue;
      }

      const fullKey = await storageKeyForLead(target, req.workspaceId);
      const existing = await dbService.getLead(fullKey, req.workspaceId);
      if (!existing) {
        missedKeys.push(rawKey);
        continue;
      }

      const prev = dbService.normalizeTagKeys(existing.tags);
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
      let lead = await dbService.setLeadTags(fullKey, nextTags, req.workspaceId);
      if (lead) {
        const added = addedTagKeys(prev, nextTags);
        if (added.length) {
          // eslint-disable-next-line no-await-in-loop
          lead = await maybeAdvanceOnTagAdd(req.workspaceId, lead);
        }
        if (mode === 'add' || added.length) {
          // eslint-disable-next-line no-await-in-loop
          await maybeEnrollAutoOutreachOnTagAdd(req.workspaceId, lead, added);
          // eslint-disable-next-line no-await-in-loop
          const refreshed = await dbService.getLead(fullKey, req.workspaceId);
          if (refreshed) lead = refreshed;
        }
        updated.push(lead);
      } else missedKeys.push(rawKey);
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
