/**
 * Full-page Pavlex chat (/chat) + conversation history API (/api/pavlex/conversations).
 */
const express = require('express');
const { assertPavlexAuth } = require('../services/pavlex/pavlexAuth');
const { pinPavlexWorkspace } = require('../services/pavlex/pavlexWorkspaceScope');
const conversations = require('../services/pavlex/pavlexConversations');

const pageRouter = express.Router();
const apiRouter = express.Router();

pageRouter.get('/', (req, res) => {
  const initialConversationId = conversations.isValidConversationId(req.query.c) ? String(req.query.c) : '';
  res.render('chat', {
    title: 'Pavlex | Agency OS',
    activePage: 'chat',
    initialConversationId,
  });
});

/** Auth + pin to the page's workspace; returns { wid, email }. */
async function scope(req) {
  const workspaceId = (req.body && req.body.workspaceId) || req.query.workspaceId;
  await pinPavlexWorkspace(req, workspaceId);
  const auth = assertPavlexAuth(req);
  return { wid: auth.workspaceId, email: auth.email };
}

function notFound(res) {
  return res.status(404).json({ success: false, error: 'Conversation not found.' });
}

function sendError(res, next, err) {
  if (err && err.status) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  return next(err);
}

apiRouter.get('/conversations', async (req, res, next) => {
  try {
    const { wid, email } = await scope(req);
    const list = conversations.listConversations(wid, email, { q: req.query.q });
    res.json({ success: true, conversations: list });
  } catch (err) {
    sendError(res, next, err);
  }
});

apiRouter.post('/conversations', express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const { wid, email } = await scope(req);
    const conversation = conversations.createConversation(wid, email, { title: req.body.title });
    res.status(201).json({ success: true, conversation });
  } catch (err) {
    sendError(res, next, err);
  }
});

apiRouter.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const { wid, email } = await scope(req);
    const conversation = conversations.getConversation(wid, email, req.params.id);
    if (!conversation) return notFound(res);
    const messages = conversations.getConversationMessages(wid, email, req.params.id, 200) || [];
    res.json({ success: true, conversation, messages });
  } catch (err) {
    sendError(res, next, err);
  }
});

apiRouter.patch('/conversations/:id', express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const { wid, email } = await scope(req);
    const patch = {};
    if (typeof req.body.title === 'string') patch.title = req.body.title;
    if (typeof req.body.pinned === 'boolean') patch.pinned = req.body.pinned;
    const conversation = conversations.updateConversation(wid, email, req.params.id, patch);
    if (!conversation) return notFound(res);
    res.json({ success: true, conversation });
  } catch (err) {
    sendError(res, next, err);
  }
});

apiRouter.delete('/conversations/:id', async (req, res, next) => {
  try {
    const { wid, email } = await scope(req);
    if (!conversations.deleteConversation(wid, email, req.params.id)) return notFound(res);
    res.json({ success: true });
  } catch (err) {
    sendError(res, next, err);
  }
});

module.exports = { pageRouter, apiRouter };
