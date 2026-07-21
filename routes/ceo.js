const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const { runPavlexChat, runPavlexMcpDebug } = require('../services/pavlex/pavlexAgent');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlClient = require('../services/ghlClient');

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
      const st = String(l.stage || l.pipelineStage || 'unknown');
      stages[st] = (stages[st] || 0) + 1;
    });

    // Active clients
    const activeClients = leads.filter(l => {
      const st = String(l.stage || l.pipelineStage || '').toLowerCase();
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
      .map(l => {
        let stageLabel = 'new';
        if (l.stage != null && l.stage !== '') {
          stageLabel = String(l.stage).replace(/_/g, ' ');
        } else if (l.pipelineStage != null && l.pipelineStage !== '') {
          stageLabel = `Stage ${l.pipelineStage}`;
        } else if (l.status) {
          stageLabel = String(l.status);
        }
        return {
        title: l.title || l.company || 'Lead',
        city: l.city || '',
        stage: stageLabel,
        created: l.created_at || l.createdAt || new Date().toISOString(),
        phone: l.phone || '',
        email: l.email || '',
      };
      });

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
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const ghlConfigured = ghlClient.isConfigured(integrationEnv);
    const systems = [
      { name: 'AdHello.ai Website', status: 'live' },
      { name: 'Leads OS API', status: 'live' },
      { name: 'Chatbot', status: 'live' },
      { name: 'GBP Audit Generator', status: 'live' },
      { name: 'Cron Jobs', status: 'active' },
      { name: 'Google Drive Sync', status: 'active' },
      { name: 'GHL Integration', status: ghlConfigured ? 'live' : 'pending' },
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
 * POST /ceo/chat — legacy alias for Automate Pavlex chat (delegates to Pavlex agent).
 */
router.post('/chat', express.json(), async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const result = await runPavlexChat(req, {
      message,
      history,
      platform: 'automate',
      persistHistory: true,
    });

    try {
      const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
      const telegramChatId = process.env.TELEGRAM_CHAT_ID || '7325499142';
      if (telegramToken) {
        const telegramMsg = `💬 *AdHello CEO Chat*\n\n👤 You: ${message.substring(0, 200)}\n\n😊 Pavlex: ${result.reply.substring(0, 300)}${result.reply.length > 300 ? '...' : ''}`;
        fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: telegramMsg,
            parse_mode: 'Markdown',
          }),
        }).catch(function () {});
      }
    } catch (e) {
      /* silent */
    }

    res.json({
      success: true,
      reply: result.reply,
      provider: result.provider,
      mcpEnabled: result.mcpEnabled,
      mcpMode: result.mcpMode,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[CEO CHAT] Error:', err.message);
    next(err);
  }
});

// GET /ceo/mcp-diagnostics — MCP connection + list_folders probe for Pavlex chat
router.get('/mcp-diagnostics', async (req, res, next) => {
  try {
    const report = await runPavlexMcpDebug(req);
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
});

// GET /ceo/chat/history — return persisted chat messages for the dashboard
router.get('/chat/history', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const history = dbService.getChatHistory('ceo', limit);
    res.json({ success: true, messages: history });
  } catch (err) {
    console.error('[CEO CHAT HISTORY] Error:', err.message);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

// DELETE /ceo/chat/history — clear chat history
router.delete('/chat/history', async (req, res) => {
  try {
    dbService.deleteChatHistory('ceo');
    res.json({ success: true });
  } catch (err) {
    console.error('[CEO CHAT CLEAR] Error:', err.message);
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

/**
 * GET /ceo/tasks — Full-page task manager for the CEO dashboard.
 */
router.get('/tasks', async (req, res) => {
  try {
    const email = userEmail(req);
    const tasks = await dbService.listUserTasks(req.workspaceId, email);

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

    const openTasks = tasks.filter(t => t.column !== 'done').length;
    const doneTasks = tasks.filter(t => t.column === 'done').length;

    res.render('ceo-tasks', {
      user: req.user,
      activePage: 'ceo',
      workspace: req.workspace || null,
      taskColumns,
      tasksByColumn,
      openTasks,
      doneTasks,
    });
  } catch (err) {
    console.error('[CEO TASKS] Error:', err.message);
    res.status(500).send(err.message);
  }
});

// ── MCP access token (for ChatGPT / OpenAI Responses API connectors) ─────────

const {
  generateWorkspaceMcpToken,
  revokeWorkspaceMcpToken,
  getWorkspaceMcpTokenStatus,
} = require('../services/mcp/mcpAuth');

router.get('/mcp/token/status', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Workspace admin required.' });
    }
    res.json({
      success: true,
      token: getWorkspaceMcpTokenStatus(req.workspace),
      endpoint: `${req.protocol}://${req.get('host')}/ceo/mcp`,
      manifest: `${req.protocol}://${req.get('host')}/ceo/mcp/manifest.json`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/mcp/token', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Workspace admin required.' });
    }
    const email = userEmail(req);
    const issued = await generateWorkspaceMcpToken(req.workspaceId, email);
    res.json({
      success: true,
      token: issued.token,
      hint: issued.hint,
      createdAt: issued.createdAt,
      endpoint: `${req.protocol}://${req.get('host')}/ceo/mcp`,
      manifest: `${req.protocol}://${req.get('host')}/ceo/mcp/manifest.json`,
      note: 'Copy this token now — it will not be shown again. Use Authorization: Bearer <token> in ChatGPT MCP settings.',
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/mcp/token', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Workspace admin required.' });
    }
    const result = await revokeWorkspaceMcpToken(req.workspaceId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
