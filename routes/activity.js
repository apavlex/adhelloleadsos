const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { buildWorkspaceActivityFeed } = require('../services/leadActivityFeed');
const teamActivity = require('../services/teamActivity');

/* A team-activity row this close to a lead timeline entry is the teammate who made it. */
const BY_MATCH_WINDOW_MS = 3 * 60 * 1000;
const INBOUND_TYPES = new Set(['sms_inbound', 'email_inbound', 'engagement_signal']);

router.use('/push', require('./push'));

const FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'calls', label: 'Calls & SMS' },
  { id: 'engagement', label: 'Engagement' },
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

/** Stamp each event with the teammate who made it, and each card with who last worked the lead. */
function attachTeammates(req, groups) {
  const wid = req.workspaceId;
  if (!wid || !groups.length) return groups;
  const members = teamActivity.memberDirectory(req.workspace, []);
  const me = String(userEmail(req) || '').trim().toLowerCase();
  const nameOf = (email, fallbackName) => {
    const em = String(email || '').trim().toLowerCase();
    if (!em) return '';
    if (em === me) return 'You';
    const m = members.find((x) => x.email === em) || { email: em, name: fallbackName || '' };
    return teamActivity.displayName(m);
  };
  let attrs = {};
  try {
    attrs = dbService.getLeadAttributions(
      wid,
      groups.map((g) => teamActivity.normalizeLeadKey(g.leadKey)),
    );
  } catch (err) {
    console.warn('[activity] attribution lookup failed:', err && err.message);
  }
  return groups.map((group) => {
    const key = teamActivity.normalizeLeadKey(group.leadKey);
    const events = Array.isArray(group.events) ? group.events : [];
    const times = events.map((e) => e.tsMs).filter((ms) => ms > 0);
    let rows = [];
    try {
      rows = dbService.listTeamActivity({
        workspaceId: wid,
        leadKey: key,
        since: times.length ? Math.min(...times) - BY_MATCH_WINDOW_MS : undefined,
        limit: 200,
      });
    } catch (err) {
      console.warn('[activity] team activity lookup failed:', err && err.message);
    }
    const stamped = events.map((ev) => {
      if (INBOUND_TYPES.has(ev.type)) return ev;
      if (ev.byLabel) {
        /* Notes stamp "Name (email)" or a bare email. */
        const m = /\(([^()\s]+@[^()\s]+)\)\s*$/.exec(ev.byLabel);
        const email = m ? m[1] : /@/.test(ev.byLabel) ? ev.byLabel : '';
        return { ...ev, by: email ? nameOf(email, ev.byLabel.replace(/\s*\([^()]*\)\s*$/, '')) : ev.byLabel };
      }
      if (!ev.tsMs) return ev;
      let best = null;
      rows.forEach((r) => {
        const d = Math.abs(Number(r.created_at) - ev.tsMs);
        if (d <= BY_MATCH_WINDOW_MS && (!best || d < best.d)) best = { d, r };
      });
      return best ? { ...ev, by: nameOf(best.r.actor_email, best.r.actor_name) } : ev;
    });
    const attr = attrs[key];
    const withBy = stamped.find((e) => e.by);
    return {
      ...group,
      events: stamped,
      lastBy: attr && attr.last_by ? nameOf(attr.last_by) : withBy ? withBy.by : '',
      lastByAt: attr && attr.last_at ? new Date(Number(attr.last_at)).toISOString() : '',
    };
  });
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
    const groups = attachTeammates(req, feed.groups).map((group) => enrichActivityGroup(group, folderMap, tagMap));
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
      groups: attachTeammates(req, feed.groups).map((group) => enrichActivityGroup(group, folderMap, tagMap)),
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
