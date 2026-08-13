const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail } = require('../services/workspaceService');
const { runPavlexChat, runPavlexMcpDebug } = require('../services/pavlex/pavlexAgent');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlClient = require('../services/ghlClient');
const { listAutomationsForWorkspace } = require('../services/automationsRegistry');
const {
  loadFolderOutreachFromFolder,
  normalizeFolderOutreachSettings,
  runFolderOutreach,
  kickoffFolderOutreachInBackground,
} = require('../services/folderOutreachAutomation');
const { normalizeAutoPoolSettings, runAutoPool } = require('../services/prospectingAutoPool');

/**
 * GET /ceo — Automate command center (folder outreach, searches, cadences).
 */
router.get('/', async (req, res) => {
  try {
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const ghlConfigured = ghlClient.isConfigured(integrationEnv);

    const { automations, summary: automationsSummary, reportStats } =
      await listAutomationsForWorkspace(wid);

    const recentAutomationActivity = automations
      .filter((a) => a.lastActivity)
      .slice(0, 8)
      .map((a) => ({
        name: a.name,
        type: a.type,
        status: a.status,
        lastActivity: a.lastActivity,
        detail: a.lastRunDetail || a.subtitle || '',
        link: a.settingsLink || null,
      }));

    res.render('ceo', {
      user: req.user,
      activePage: 'ceo',
      workspace: req.workspace || null,
      workspaceAccent: (req.workspace && req.workspace.accentColor) || '#CA8A04',
      canManageWorkspace: !!req.canManageWorkspace,
      automations,
      automationsSummary,
      reportStats,
      automationsTimezoneLabel: (reportStats && reportStats.timezoneLabel) || '',
      recentAutomationActivity,
      ghlConfigured,
      ghlDashboardUrl: integrationEnv.ghlDashboardUrl || process.env.GHL_DASHBOARD_URL || '',
    });
  } catch (err) {
    console.error('[CEO] Dashboard error:', err.message);
    res.status(500).send(err.message);
  }
});

/**
 * GET /ceo/automations — JSON list of workspace automations (for refresh).
 */
router.get('/automations', async (req, res, next) => {
  try {
    const { automations, summary } = await listAutomationsForWorkspace(req.workspaceId);
    res.json({ success: true, automations, summary });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ceo/automations/action — pause/resume/run/stop automations from the command center.
 * Body: { id, action: 'pause'|'resume'|'run'|'stop', folderKey?, scheduleKey? }
 */
router.post('/automations/action', express.json(), async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can manage automations.' });
    }

    const wid = req.workspaceId;
    const id = String(req.body.id || '').trim();
    const action = String(req.body.action || '').trim().toLowerCase();
    if (!id || !action) {
      return res.status(400).json({ success: false, error: 'id and action are required.' });
    }

    if (id === 'auto_pool') {
      const ws = (await dbService.getWorkspace(wid)) || { id: wid };
      const prospecting =
        ws.prospecting && typeof ws.prospecting === 'object' ? { ...ws.prospecting } : {};
      const prev = normalizeAutoPoolSettings(prospecting.autoPool);

      if (action === 'pause') {
        prospecting.autoPool = normalizeAutoPoolSettings({ ...prev, enabled: false });
        await dbService.saveWorkspace(wid, { ...ws, prospecting });
        return res.json({ success: true, action, id, enabled: false });
      }
      if (action === 'resume') {
        const next = normalizeAutoPoolSettings({ ...prev, enabled: true });
        prospecting.autoPool = next;
        await dbService.saveWorkspace(wid, { ...ws, prospecting });
        const justEnabled = !prev.enabled;
        if (justEnabled) {
          setImmediate(() => {
            runAutoPool({ workspaceId: wid, settings: next }).catch((e) => {
              console.error('[AUTO-POOL] resume kickoff failed:', e && e.message ? e.message : e);
            });
          });
        }
        return res.json({
          success: true,
          action,
          id,
          enabled: true,
          runStarted: justEnabled,
        });
      }
      if (action === 'run') {
        const result = await runAutoPool({ workspaceId: wid, settings: { ...prev, enabled: true } });
        return res.json({ success: true, action, id, ...result });
      }
      return res.status(400).json({ success: false, error: 'Invalid action for auto-pool.' });
    }

    if (id.startsWith('folder_outreach:')) {
      const folderKey = String(req.body.folderKey || id.slice('folder_outreach:'.length)).trim();
      if (!folderKey) {
        return res.status(400).json({ success: false, error: 'folderKey is required.' });
      }
      const folder = await dbService.getFolder(wid, folderKey);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found.' });
      }
      const prev = loadFolderOutreachFromFolder(folder);

      if (action === 'pause') {
        const outreachAutomation = normalizeFolderOutreachSettings({ ...prev, enabled: false });
        await dbService.updateFolder(wid, folderKey, { outreachAutomation });
        return res.json({ success: true, action, id, enabled: false });
      }
      if (action === 'resume') {
        const outreachAutomation = normalizeFolderOutreachSettings({ ...prev, enabled: true });
        await dbService.updateFolder(wid, folderKey, { outreachAutomation });
        const justEnabled = !prev.enabled;
        if (justEnabled) {
          kickoffFolderOutreachInBackground({
            workspaceId: wid,
            folderKey,
            settings: outreachAutomation,
          });
        }
        return res.json({
          success: true,
          action,
          id,
          enabled: true,
          runStarted: justEnabled,
        });
      }
      if (action === 'run') {
        const startedAt = new Date().toISOString();
        const outreachAutomation = normalizeFolderOutreachSettings({
          ...prev,
          enabled: true,
          lastRunAt: startedAt,
          lastSkipSummary: 'drip running…',
        });
        await dbService.updateFolder(wid, folderKey, { outreachAutomation });
        kickoffFolderOutreachInBackground({
          workspaceId: wid,
          folderKey,
          settings: { ...prev, enabled: true },
        });
        return res.json({
          success: true,
          action,
          id,
          runStarted: true,
          message:
            'Drip started in the background (email hunt can take a few minutes). Refresh shortly for enroll counts.',
        });
      }
      return res.status(400).json({ success: false, error: 'Invalid action for folder outreach.' });
    }

    if (id.startsWith('schedule:') && action === 'stop') {
      const scheduleKey = String(req.body.scheduleKey || id.slice('schedule:'.length)).trim();
      if (!scheduleKey) {
        return res.status(400).json({ success: false, error: 'scheduleKey is required.' });
      }
      await dbService.deleteSchedule(scheduleKey);
      return res.json({ success: true, action, id, deleted: true });
    }

    return res.status(400).json({ success: false, error: 'Unknown automation or unsupported action.' });
  } catch (err) {
    next(err);
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
