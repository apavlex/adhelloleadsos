const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const { chatCompletion } = require('../services/llmClient');

/**
 * GET /ceo — CEO Dashboard showing all ventures in one view.
 */
router.get('/', async (req, res) => {
  try {
    const email = userEmail(req);
    const leads = await dbService.getAllLeads(req.workspaceId);
    const visits = await dbService.getAllVisits();
    const tasks = await dbService.listUserTasks(req.workspaceId, email);

    // ── Agency Metrics ──────────────────────────────────────────────────────
    const totalLeads = leads.length;
    const totalVisits = visits.length;
    const uniqueIPs = new Set(visits.map(v => v.ip)).size;
    const conversionRate = totalVisits > 0 ? ((totalLeads / totalVisits) * 100).toFixed(1) : 0;
    const leadsThisWeek = leads.filter(l => {
      const d = new Date(l.created_at || l.createdAt || Date.now());
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return d.getTime() > weekAgo;
    }).length;
    const openTasks = tasks.filter(t => t.column !== 'done').length;
    const doneTasks = tasks.filter(t => t.column === 'done').length;

    // Pipeline estimate: leads with a stage
    const pipelineLeads = leads.filter(l => l.stage || l.pipelineStage);
    const stages = {};
    pipelineLeads.forEach(l => {
      const st = l.stage || l.pipelineStage || 'unknown';
      stages[st] = (stages[st] || 0) + 1;
    });

    // Active clients
    const activeClients = leads.filter(l => {
      const st = (l.stage || l.pipelineStage || '').toLowerCase();
      return st === 'client' || st === 'won' || st === 'active' || st === 'closed_won';
    }).length;

    // ── Daily Activity ──────────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const visitsToday = visits.filter(v => {
      const d = new Date(v.timestamp || v.created_at || 0);
      return d >= today;
    }).length;
    const leadsToday = leads.filter(l => {
      const d = new Date(l.created_at || l.createdAt || 0);
      return d >= today;
    }).length;

    // ── Recent Activity ─────────────────────────────────────────────────────
    const recentLeads = [...leads]
      .sort((a, b) => {
        const da = new Date(a.created_at || a.createdAt || 0);
        const db = new Date(b.created_at || b.createdAt || 0);
        return db - da;
      })
      .slice(0, 8)
      .map(l => ({
        title: l.title || l.company || 'Lead',
        city: l.city || '',
        stage: l.stage || l.pipelineStage || 'new',
        created: l.created_at || l.createdAt || new Date().toISOString(),
        phone: l.phone || '',
        email: l.email || '',
      }));

    // ── Geo Data (top cities) ──────────────────────────────────────────────
    const geoMap = {};
    leads.forEach(l => {
      if (l.city) {
        const key = `${l.city}, ${l.state || ''}`;
        geoMap[key] = (geoMap[key] || 0) + 1;
      }
    });
    const topCities = Object.entries(geoMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    // ── Visit Trend (last 14 days) ─────────────────────────────────────────
    const dailyVisits = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyVisits[d.toISOString().split('T')[0]] = 0;
    }
    visits.forEach(v => {
      const key = new Date(v.timestamp || v.created_at || 0).toISOString().split('T')[0];
      if (dailyVisits[key] !== undefined) dailyVisits[key]++;
    });

    // ── System Status ──────────────────────────────────────────────────────
    const systems = [
      { name: 'AdHello.ai Website', status: 'live' },
      { name: 'Leads OS API', status: 'live' },
      { name: 'Chatbot', status: 'live' },
      { name: 'GBP Audit Generator', status: 'live' },
      { name: 'Cron Jobs', status: 'active' },
      { name: 'Google Drive Sync', status: 'active' },
      { name: 'GHL Integration', status: 'pending' },
    ];

    // ── Tasks by column for kanban ──────────────────────────────────────────
    const taskColumns = [
      { id: 'backlog', label: 'Backlog' },
      { id: 'todo', label: 'To Do' },
      { id: 'doing', label: 'Doing' },
      { id: 'done', label: 'Done' },
    ];
    const tasksByColumn = {};
    taskColumns.forEach(c => { tasksByColumn[c.id] = []; });
    tasks.forEach(t => {
      const col = tasksByColumn[t.column] ? t.column : 'todo';
      tasksByColumn[col].push(t);
    });

    res.render('ceo', {
      user: req.user,
      activePage: 'ceo',
      workspace: req.workspace || null,
      workspaceAccent: (req.workspace && req.workspace.accentColor) || '#CA8A04',
      canManageWorkspace: true,

      // Agency metrics
      totalLeads,
      totalVisits,
      uniqueIPs,
      conversionRate,
      leadsThisWeek,
      openTasks,
      doneTasks,
      activeClients,
      pipelineLeads: pipelineLeads.length,
      stages: Object.entries(stages).sort((a, b) => b[1] - a[1]),

      // Daily
      visitsToday,
      leadsToday,

      // Lists
      recentLeads,
      topCities,
      chartData: {
        labels: Object.keys(dailyVisits),
        values: Object.values(dailyVisits),
      },

      // Systems
      systems,

      // Tasks
      tasks,
      taskColumns,
      tasksByColumn,

      // External links
      adhelloUrl: 'https://adhello.ai',
      leadsUrl: 'https://adhelloleadsos.onrender.com',
      chatbotUrl: process.env.CHATBOT_PUBLIC_URL || '',
      hermesWebUiUrl: process.env.HERMES_WEBUI_URL || '',
    });
  } catch (err) {
    console.error('[CEO] Dashboard error:', err.message);
    res.status(500).send(err.message);
  }
});

/**
 * POST /ceo/chat — AI chat endpoint for the CEO dashboard widget.
 * Uses the same LLM client as the rest of the app.
 */
router.post('/chat', express.json(), async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const systemPrompt = `You are OWL, the AI assistant for AdHello's CEO Command Center. You help Alex Pavlenko manage his agency ventures, leads, tasks, and operations. Be concise, direct, and actionable. You have access to the AdHello leads OS and can help with prospecting, pipeline management, content ideas, and business strategy. Keep responses under 300 words unless asked for detail.`;

    const messages = [{ role: 'system', content: systemPrompt }];
    (history || []).forEach(m => {
      if (m.role && m.content) messages.push({ role: m.role, content: m.content });
    });
    messages.push({ role: 'user', content: String(message).trim() });

    const { content, error } = await chatCompletion({
      messages,
      max_tokens: 800,
      temperature: 0.7,
    });

    if (error || !content) {
      return res.status(502).json({ error: 'AI unavailable. Try again in a moment.' });
    }

    res.json({ success: true, reply: content });
  } catch (err) {
    console.error('[CEO CHAT] Error:', err.message);
    res.status(500).json({ error: 'Chat failed.' });
  }
});

module.exports = router;
