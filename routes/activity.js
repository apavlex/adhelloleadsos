const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { buildWorkspaceActivityFeed } = require('../services/leadActivityFeed');

const FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'calls', label: 'Calls & SMS' },
  { id: 'status', label: 'Call outcomes' },
];

function buildTagMap(tags) {
  const map = Object.create(null);
  (tags || []).forEach((t) => {
    if (t && t.key) map[String(t.key).trim()] = t;
  });
  return map;
}

function enrichActivityGroup(group, folderMap, tagMap) {
  const tagKeys = Array.isArray(group.tags) ? group.tags.map(String).filter(Boolean) : [];
  const tagChips = tagKeys.slice(0, 4).map((key) => {
    const t = tagMap[String(key).trim()] || {};
    return {
      key,
      name: String(t.name || key).slice(0, 40),
      color: t.color || '#94a3b8',
    };
  });
  return {
    ...group,
    folderName: group.folderKey ? folderMap[group.folderKey] || '' : '',
    tags: tagKeys,
    tagChips,
    tagOverflow: tagKeys.length > 4 ? tagKeys.length - 4 : 0,
  };
}

async function loadActivityContext(req) {
  const allLeads = await dbService.getAllLeads(req.workspaceId);
  const leads = filterLeadsForRequest(req, allLeads);
  const [folders, tags, stageRows] = await Promise.all([
    dbService.listFolders(req.workspaceId),
    dbService.listTags(req.workspaceId),
    pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId),
  ]);
  const folderMap = Object.fromEntries(
    (folders || []).filter((f) => f && f.key).map((f) => [f.key, f.name || 'Folder']),
  );
  const tagMap = buildTagMap(tags);
  const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);
  return { leads, folders: folders || [], folderMap, tags: tags || [], tagMap, pipelineStages };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = String(req.query.filter || 'all').trim().toLowerCase();
    const safeFilter = FILTERS.some((f) => f.id === filter) ? filter : 'all';
    const { leads, folders, folderMap, tags, tagMap, pipelineStages } = await loadActivityContext(req);
    const feed = buildWorkspaceActivityFeed(leads, {
      filter: safeFilter,
      limit: 50,
      offset: 0,
    });
    const groups = feed.groups.map((group) => enrichActivityGroup(group, folderMap, tagMap));
    const shownEvents = groups.reduce(function (sum, g) {
      return sum + (g.eventCount || (g.events && g.events.length) || 0);
    }, 0);
    res.render('activity', {
      title: 'Recent Activity | Agency OS',
      activePage: 'activity',
      activityFilters: FILTERS,
      activeFilter: safeFilter,
      activityGroups: groups,
      activityTotal: feed.total,
      activityTotalEvents: feed.totalEvents,
      activityShownEvents: shownEvents,
      activitySinceDays: feed.sinceDays,
      folders,
      tags,
      pipelineStages,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/api', async (req, res, next) => {
  try {
    const filter = String(req.query.filter || 'all').trim().toLowerCase();
    const safeFilter = FILTERS.some((f) => f.id === filter) ? filter : 'all';
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const { leads, folders, folderMap, tagMap } = await loadActivityContext(req);
    const feed = buildWorkspaceActivityFeed(leads, {
      filter: safeFilter,
      limit,
      offset,
    });
    res.json({
      success: true,
      groups: feed.groups.map((group) => enrichActivityGroup(group, folderMap, tagMap)),
      total: feed.total,
      totalEvents: feed.totalEvents,
      filter: safeFilter,
      limit: feed.limit,
      offset: feed.offset,
      sinceDays: feed.sinceDays,
      folders,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
