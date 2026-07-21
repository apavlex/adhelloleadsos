const express = require('express');
const router = express.Router();
const workspaceService = require('../services/workspaceService');
const { buildAssistantContext } = require('../services/assistantSearch');
const { runPavlexChat, runPavlexMcpDebug } = require('../services/pavlex/pavlexAgent');

/** @deprecated Use POST /api/pavlex/chat with platform=assistant */
router.post('/chat', express.json({ limit: '120kb' }), async (req, res, next) => {
  try {
    const email = workspaceService.userEmail(req);
    if (!email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.workspaceId) {
      return res.status(400).json({ error: 'No active workspace' });
    }

    const message = String(req.body.message || '').trim();
    let history = Array.isArray(req.body.history) ? req.body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-14)
      .map((m) => ({
        role: m.role,
        content: String(m.content).slice(0, 6000),
      }));

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const { citations } = await buildAssistantContext({
      workspaceId: req.workspaceId,
      email,
      query: message,
    });

    const result = await runPavlexChat(req, {
      message,
      history,
      platform: 'assistant',
      persistHistory: false,
    });

    res.json({
      reply: result.reply,
      provider: result.provider,
      mcpEnabled: result.mcpEnabled,
      mcpMode: result.mcpMode,
      llmDegraded: false,
      citations: (citations || []).slice(0, 12),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.warn('[assistant/chat]', err.message);
    next(err);
  }
});

router.get('/mcp-diagnostics', async (req, res, next) => {
  try {
    const report = await runPavlexMcpDebug(req);
    res.json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
