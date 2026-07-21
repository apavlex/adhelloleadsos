/**
 * Pavlex agent API — canonical chat runtime for Automate + assistant surfaces.
 */
const express = require('express');
const router = express.Router();
const { userEmail } = require('../services/workspaceService');
const { runPavlexChat } = require('../services/pavlex/pavlexAgent');

router.post('/chat', express.json({ limit: '120kb' }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) {
      return res.status(401).json({ success: false, error: 'Sign in required.' });
    }
    if (!req.workspaceId) {
      return res.status(400).json({ success: false, error: 'No active workspace.' });
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

    const platform = String(req.body.platform || 'automate').toLowerCase() === 'assistant'
      ? 'assistant'
      : 'automate';

    const result = await runPavlexChat(req, {
      message,
      history,
      platform,
      persistHistory: platform === 'automate',
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.message,
        detail: err.detail || null,
      });
    }
    next(err);
  }
});

module.exports = router;
