/**
 * Pavlex agent API — central AI gateway for all website chat surfaces.
 */
const express = require('express');
const router = express.Router();
const { runPavlexChat } = require('../services/pavlex/pavlexAgent');
const { assertPavlexAuth } = require('../services/pavlex/pavlexAuth');
const { pinPavlexWorkspace } = require('../services/pavlex/pavlexWorkspaceScope');
const pavlexConversations = require('../services/pavlex/pavlexConversations');

router.post('/chat', express.json({ limit: '120kb' }), async (req, res, next) => {
  try {
    assertPavlexAuth(req);
    await pinPavlexWorkspace(req, req.body.workspaceId);

    const message = String(req.body.message || '').trim();
    let history = Array.isArray(req.body.history) ? req.body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-14)
      .map((m) => ({
        role: m.role,
        content: String(m.content).slice(0, 6000),
      }));

    let conversationId = String(req.body.conversationId || '').trim() || undefined;
    const platformRaw = String(req.body.platform || 'global').toLowerCase();
    const platform =
      platformRaw === 'assistant'
        ? 'assistant'
        : platformRaw === 'automate'
          ? 'automate'
          : platformRaw === 'chat'
            ? 'chat'
            : 'global';
    const page = String(req.body.page || '').trim().slice(0, 500) || undefined;

    const auth = assertPavlexAuth(req);
    let createdConversation = null;
    if (conversationId) {
      if (!pavlexConversations.getConversation(auth.workspaceId, auth.email, conversationId)) {
        return res.status(404).json({ success: false, error: 'Conversation not found.' });
      }
    } else if (platform === 'chat' && message) {
      createdConversation = pavlexConversations.createConversation(auth.workspaceId, auth.email);
      conversationId = createdConversation.id;
    }
    if (conversationId) {
      const stored = pavlexConversations.getConversationMessages(auth.workspaceId, auth.email, conversationId, 14);
      if (stored && stored.length) {
        history = stored.map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
      }
    }

    let result;
    try {
      result = await runPavlexChat(req, {
        message,
        history,
        conversationId,
        platform,
        page,
        persistHistory: platform === 'automate' || platform === 'global' || platform === 'chat',
      });
    } catch (err) {
      if (createdConversation) {
        pavlexConversations.deleteConversation(auth.workspaceId, auth.email, createdConversation.id);
      }
      throw err;
    }

    const conversation = conversationId
      ? pavlexConversations.recordExchange(auth.workspaceId, auth.email, conversationId, {
          userMessage: message,
          reply: result.reply,
          toolsUsed: result.toolsUsed,
        })
      : null;

    res.json({
      success: true,
      ...result,
      ...(conversation ? { conversation } : {}),
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
