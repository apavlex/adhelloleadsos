const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const { PIPELINE_STAGES } = require('../services/salesConstants');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { computeOutreachStreak, buildDailyChartSeries, buildDayRollup } = require('../services/trackerStats');
const { buildOutreachCoachSnapshot } = require('../services/outreachCoachSnapshot');

router.get('/', async (req, res, next) => {
  try {
    const tab = String(req.query.tab || 'queue').toLowerCase();
    const safeTab = ['queue', 'pipeline', 'touches', 'folders'].includes(tab) ? tab : 'queue';

    // Minimal data for tabs + coach header (reuse from tracker).
    const email = userEmail(req);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = await dbService.getDailyTracker(email, today);
    const history = await dbService.listDailyTrackers(email, 14);
    const history60 = await dbService.listDailyTrackers(email, 62);
    const chartSeries = buildDailyChartSeries(today, history, 14);
    const streak = computeOutreachStreak(history60, today);
    const checklistWeek = buildDayRollup(today, history60, 7);
    const checklistMonth = buildDayRollup(today, history60, 30);

    const all = await dbService.getAllLeads();
    const visible = filterLeadsForRequest(req, all);
    const outreachCoach = await buildOutreachCoachSnapshot(req);

    const folders = await dbService.listFolders(req.workspaceId || 'default');

    const sourceFilter = String(req.query.source || 'all').toLowerCase();
    let pipelineBoardLeads = visible;
    if (sourceFilter === 'inbound') {
      pipelineBoardLeads = visible.filter((l) => l.source && l.source.startsWith('adhello_'));
    } else if (sourceFilter === 'cold') {
      pipelineBoardLeads = visible.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    }

    const leadSourceCounts = {
      all: visible.length,
      cold: visible.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: visible.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

    res.render('outreach', {
      title: 'Outreach | Agency OS',
      activePage: 'outreach',
      tab: safeTab,
      trackerReturnTo: '/outreach?tab=touches',
      today,
      todayRow: todayRow || {
        coldEmails: 0,
        coldDms: 0,
        coldCalls: 0,
        upworkBids: 0,
        notes: '',
        callNotes: '',
      },
      chartSeries,
      streak,
      checklistWeek,
      checklistMonth,
      outreachCoach,
      leadCount: visible.length,
      folders,
      pipelineBoardLeads,
      pipelineStages: PIPELINE_STAGES,
      sourceFilter,
      leadSourceCounts,
      canManageWorkspace: req.canManageWorkspace,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

