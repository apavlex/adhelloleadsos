const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const activationService = require('../services/activationService');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');
const { buildConversionSnapshot } = require('../services/conversionMetrics');
const { loadSalesTrackerLocals } = require('../services/salesTrackerLocals');
const { computeCategoryBreakdown } = require('../services/auditReportModel');

function buildSiteAuditReportLocals(req, leads) {
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return buildSiteAuditReportLocalsFromViews(req, leads, since24);
}

function buildSiteAuditReportLocalsFromViews(req, leads, sinceIso) {
  const leadByKey = Object.fromEntries((leads || []).map((l) => [l.key, l]));
  return dbService.listReportViewsForWorkspaceSince(req.workspaceId, sinceIso, 600).then((raw) => {
    const rows = (raw || []).map((rv) => {
      const lead = leadByKey[rv.lead_id] || null;
      const title = lead
        ? String(lead.title || lead.company || rv.lead_id).slice(0, 120)
        : String(rv.lead_id || '').replace(/^lead:/i, '') || 'Lead';
      let categories = null;
      if (lead && lead.aiWebsiteAnalysis && typeof lead.aiWebsiteAnalysis === 'object') {
        try {
          categories = computeCategoryBreakdown(lead.aiWebsiteAnalysis, lead);
        } catch (_) {
          categories = null;
        }
      }
      return {
        id: rv.id,
        lead_id: rv.lead_id,
        leadTitle: title,
        viewed_at: rv.viewed_at,
        ip_hash: rv.ip_hash,
        user_agent: rv.user_agent,
        duration_seconds: Number(rv.duration_seconds) || 0,
        categories,
      };
    });
    const uniqLeads = new Set(rows.map((r) => r.lead_id)).size;
    const durSum = rows.reduce((a, r) => a + (Number(r.duration_seconds) || 0), 0);
    const avgDuration =
      rows.length > 0 ? Math.round((durSum / rows.length) * 10) / 10 : 0;
    const rubricLegend = [
      { name: 'Findability', max: 25 },
      { name: 'Conversion', max: 25 },
      { name: 'Trust', max: 20 },
      { name: 'Performance', max: 20 },
      { name: 'Technical', max: 10 },
    ];
    return {
      reportAuditViews: rows.slice(0, 150),
      reportAuditViews24h: rows.length,
      reportAuditUniqueLeads24h: uniqLeads,
      reportAuditAvgDuration24h: avgDuration,
      reportAuditRubricLegend: rubricLegend,
    };
  });
}

/**
 * GET /reports (legacy GET /analytics redirects in iaRedirects.js)
 * Renders the dashboard with visit data
 */
function buildDemoAnalytics(visits, leads) {
  const totalVisits = 842;
  const uniqueIPs = 318;
  const leadCount = leads.length;
  const topRegions = [
    { name: 'Los Angeles, California', count: 124 },
    { name: 'New York, New York', count: 98 },
    { name: 'Austin, Texas', count: 76 },
    { name: 'Chicago, Illinois', count: 61 },
    { name: 'Denver, Colorado', count: 44 },
  ];
  const now = new Date();
  const dailyVisits = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dailyVisits[key] = 12 + Math.round(8 * Math.sin(i / 4) + (i % 7) * 2);
  }
  const chartData = {
    labels: Object.keys(dailyVisits),
    values: Object.values(dailyVisits),
  };
  const recentVisits = [
    { city: 'Phoenix', region: 'Arizona', ip: '•••', path: '/audit', timestamp: Date.now() - 120000 },
    { city: 'Miami', region: 'Florida', ip: '•••', path: '/', timestamp: Date.now() - 340000 },
    { city: 'Seattle', region: 'Washington', ip: '•••', path: '/pricing', timestamp: Date.now() - 900000 },
  ];
  return {
    totalVisits,
    uniqueIPs,
    topRegions,
    chartData,
    recentVisits,
    leadCount,
    isDemo: true,
  };
}

router.get('/', async (req, res) => {
  try {
    const tabQ = String(req.query.tab || 'tracker').toLowerCase();
    let reportsTab = 'tracker';
    if (tabQ === 'analytics') reportsTab = 'analytics';
    else if (tabQ === 'site-audit' || tabQ === 'audit') reportsTab = 'site-audit';
    const analyticsMetric = String(req.query.metric || '').trim();
    const analyticsRange = String(req.query.range || '').trim();

    const visits = await dbService.getAllVisits();
    const reportsScope = String(req.query.scope || 'workspace').toLowerCase() === 'all' ? 'all' : 'workspace';
    const leads = await dbService.getAllLeads(req.workspaceId);

    let workspaceCompare = [];
    if (reportsScope === 'all') {
      const em = userEmail(req);
      const ids = await dbService.getUserWorkspaceIds(em);
      for (const id of ids) {
        const ws = await dbService.getWorkspace(id);
        const ls = await dbService.getAllLeads(id);
        workspaceCompare.push({
          id,
          name: (ws && ws.name) || 'Workspace',
          accentColor: (ws && ws.accentColor) || '#CA8A04',
          snapshot: buildConversionSnapshot(ls, ws || {}),
        });
      }
    }

    const demoMode =
      (process.env.ANALYTICS_UI_DEMO === '1' || req.query.preview === '1') && visits.length === 0;

    if (demoMode) {
      const d = buildDemoAnalytics(visits, leads);
      const trackerLocals = await loadSalesTrackerLocals(req);
      const siteAuditLocals =
        reportsTab === 'site-audit'
          ? await buildSiteAuditReportLocals(req, leads)
          : {
              reportAuditViews: [],
              reportAuditViews24h: 0,
              reportAuditUniqueLeads24h: 0,
              reportAuditAvgDuration24h: 0,
              reportAuditRubricLegend: [
                { name: 'Findability', max: 25 },
                { name: 'Conversion', max: 25 },
                { name: 'Trust', max: 20 },
                { name: 'Performance', max: 20 },
                { name: 'Technical', max: 10 },
              ],
            };
      await activationService.recordEvent(userEmail(req), 'analytics_visit');
      return res.render('analytics', {
        user: req.user,
        reportsTab,
        analyticsMetric: String(req.query.metric || '').trim(),
        analyticsRange: String(req.query.range || '').trim(),
        reportsScope,
        workspaceCompare,
        ...d,
        ...trackerLocals,
        ...siteAuditLocals,
        trackerSavedNotice: req.query.trackerSaved === '1',
      });
    }

    // Simple aggregations
    const totalVisits = visits.length;
    const uniqueIPs = new Set(visits.map(v => v.ip)).size;
    
    // Group by City/Region
    const geoMap = {};
    visits.forEach(v => {
      const locale = `${v.city}, ${v.region}`;
      if (locale !== 'Unknown, Unknown') {
        geoMap[locale] = (geoMap[locale] || 0) + 1;
      }
    });
    
    const topRegions = Object.entries(geoMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Group by Day for the chart (last 30 days)
    const dailyVisits = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dailyVisits[key] = 0;
    }

    visits.forEach(v => {
      const dateKey = new Date(v.timestamp).toISOString().split('T')[0];
      if (dailyVisits[dateKey] !== undefined) {
        dailyVisits[dateKey]++;
      }
    });

    const chartData = {
      labels: Object.keys(dailyVisits),
      values: Object.values(dailyVisits)
    };

    await activationService.recordEvent(userEmail(req), 'analytics_visit');

    const trackerLocals = await loadSalesTrackerLocals(req);

    const siteAuditLocals =
      reportsTab === 'site-audit'
        ? await buildSiteAuditReportLocals(req, leads)
        : {
            reportAuditViews: [],
            reportAuditViews24h: 0,
            reportAuditUniqueLeads24h: 0,
            reportAuditAvgDuration24h: 0,
            reportAuditRubricLegend: [
              { name: 'Findability', max: 25 },
              { name: 'Conversion', max: 25 },
              { name: 'Trust', max: 20 },
              { name: 'Performance', max: 20 },
              { name: 'Technical', max: 10 },
            ],
          };

    res.render('analytics', {
      user: req.user,
      reportsTab,
      analyticsMetric,
      analyticsRange,
      reportsScope,
      workspaceCompare,
      totalVisits,
      uniqueIPs,
      topRegions,
      chartData,
      recentVisits: visits.slice(0, 10),
      leadCount: leads.length,
      isDemo: false,
      ...trackerLocals,
      ...siteAuditLocals,
      trackerSavedNotice: req.query.trackerSaved === '1',
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
