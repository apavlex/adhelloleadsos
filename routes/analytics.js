const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

/**
 * GET /analytics
 * Renders the dashboard with visit data
 */
router.get('/', async (req, res) => {
  try {
    const visits = await dbService.getAllVisits();
    const leads = await dbService.getAllLeads();
    
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

    res.render('analytics', {
      user: req.user,
      totalVisits,
      uniqueIPs,
      topRegions,
      chartData,
      recentVisits: visits.slice(0, 10),
      leadCount: leads.length
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
