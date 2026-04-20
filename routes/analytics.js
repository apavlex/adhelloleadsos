const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { computeOutreachStreak, buildDailyChartSeries, buildDayRollup } = require('../services/trackerStats');
const { buildOutreachCoachSnapshot } = require('../services/outreachCoachSnapshot');

async function loadSalesTrackerLocals(req) {
  const email = userEmail(req);
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = await dbService.getDailyTracker(email, today);
  const history = await dbService.listDailyTrackers(email, 14);
  const history60 = await dbService.listDailyTrackers(email, 62);
  const chartSeries = buildDailyChartSeries(today, history, 14);
  const streak = computeOutreachStreak(history60, today);
  const checklistWeek = buildDayRollup(today, history60, 7);
  const checklistMonth = buildDayRollup(today, history60, 30);
  const outreachCoach = await buildOutreachCoachSnapshot(req);
  return {
    today,
    todayRow: todayRow || {
      coldEmails: 0,
      coldDms: 0,
      coldCalls: 0,
      upworkBids: 0,
      socialPosts: 0,
      adCreatives: 0,
      notes: '',
      callNotes: '',
    },
    chartSeries,
    streak,
    checklistWeek,
    checklistMonth,
    outreachCoach,
    trackerReturnTo: '/analytics?tab=tracker',
  };
}

/**
 * GET /analytics
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
    const reportsTab = tabQ === 'analytics' ? 'analytics' : 'tracker';

    const visits = await dbService.getAllVisits();
    const leads = await dbService.getAllLeads();

    const demoMode =
      (process.env.ANALYTICS_UI_DEMO === '1' || req.query.preview === '1') && visits.length === 0;

    if (demoMode) {
      const d = buildDemoAnalytics(visits, leads);
      const trackerLocals = await loadSalesTrackerLocals(req);
      await activationService.recordEvent(userEmail(req), 'analytics_visit');
      return res.render('analytics', {
        user: req.user,
        reportsTab,
        ...d,
        ...trackerLocals,
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

    res.render('analytics', {
      user: req.user,
      reportsTab,
      totalVisits,
      uniqueIPs,
      topRegions,
      chartData,
      recentVisits: visits.slice(0, 10),
      leadCount: leads.length,
      isDemo: false,
      ...trackerLocals,
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
