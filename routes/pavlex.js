/**
 * Pavlex agent API — central AI gateway for all website chat surfaces.
 */
const express = require('express');
const router = express.Router();
const { runPavlexChat } = require('../services/pavlex/pavlexAgent');
const { assertPavlexAuth } = require('../services/pavlex/pavlexAuth');

router.post('/chat', express.json({ limit: '120kb' }), async (req, res, next) => {
  try {
    assertPavlexAuth(req);

    const message = String(req.body.message || '').trim();
    let history = Array.isArray(req.body.history) ? req.body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-14)
      .map((m) => ({
        role: m.role,
        content: String(m.content).slice(0, 6000),
      }));

    const conversationId = String(req.body.conversationId || '').trim() || undefined;
    const platform = String(req.body.platform || 'automate').toLowerCase() === 'assistant'
      ? 'assistant'
      : 'automate';

    const result = await runPavlexChat(req, {
      message,
      history,
      conversationId,
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
