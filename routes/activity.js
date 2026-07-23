const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { buildWorkspaceActivityFeed } = require('../services/leadActivityFeed');

const FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'calls', label: 'Calls & SMS' },
  { id: 'status', label: 'Status & dispositions' },
];

async function loadActivityContext(req) {
  const allLeads = await dbService.getAllLeads(req.workspaceId);
  const leads = filterLeadsForRequest(req, allLeads);
  const folders = await dbService.listFolders(req.workspaceId);
  const folderMap = Object.fromEntries(
    (folders || []).filter((f) => f && f.key).map((f) => [f.key, f.name || 'Folder']),
  );
  return { leads, folders: folders || [], folderMap };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = String(req.query.filter || 'all').trim().toLowerCase();
    const safeFilter = FILTERS.some((f) => f.id === filter) ? filter : 'all';
    const { leads, folders, folderMap } = await loadActivityContext(req);
    const feed = buildWorkspaceActivityFeed(leads, {
      filter: safeFilter,
      limit: 50,
      offset: 0,
    });
    const items = feed.items.map((item) => ({
      ...item,
      folderName: item.folderKey ? folderMap[item.folderKey] || '' : '',
    }));
    res.render('activity', {
      title: 'Recent Activity | Agency OS',
      activePage: 'activity',
      activityFilters: FILTERS,
      activeFilter: safeFilter,
      activityItems: items,
      activityTotal: feed.total,
      activitySinceDays: feed.sinceDays,
      folders,
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
    const { leads, folders, folderMap } = await loadActivityContext(req);
    const feed = buildWorkspaceActivityFeed(leads, {
      filter: safeFilter,
      limit,
      offset,
    });
    res.json({
      success: true,
      items: feed.items.map((item) => ({
        ...item,
        folderName: item.folderKey ? folderMap[item.folderKey] || '' : '',
      })),
      total: feed.total,
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
