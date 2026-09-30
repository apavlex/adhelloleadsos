/**
 * Keep Pavlex chat scoped to the workspace the user is looking at.
 * The session's active workspace can change in another tab / the PWA, so the
 * client sends the workspace id its page was rendered for and we act on that.
 */
const dbService = require('../database');
const { userEmail, roleForEmail, canManageTeam } = require('../workspaceService');
const { userCanAccessWorkspace } = require('../workspaceBootstrap');

/**
 * Point req at `requestedId` for this request only (session untouched).
 * @param {import('express').Request} req
 * @param {string} [requestedId]
 */
async function pinPavlexWorkspace(req, requestedId) {
  const wid = String(requestedId || '').trim();
  if (!wid || wid === String(req.workspaceId || '')) return false;
  const email = userEmail(req);
  const ws = await dbService.getWorkspace(wid);
  if (!ws || !userCanAccessWorkspace(ws, email)) {
    const err = new Error('You no longer have access to that workspace. Reload the page.');
    err.status = 403;
    throw err;
  }
  req.workspace = ws;
  req.workspaceId = ws.id || wid;
  req.workspaceRole = roleForEmail(ws, email);
  req.canManageWorkspace = canManageTeam(req.workspaceRole);
  return true;
}

/**
 * Chat history channel for one user in one workspace.
 * @param {string} workspaceId
 * @param {string} email
 * @param {string} [conversationId]
 */
function pavlexChatChannel(workspaceId, email, conversationId) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  const em = String(email || '').trim().toLowerCase() || 'anon';
  const conv = String(conversationId || '').trim().slice(0, 80);
  return `pavlex:${wid}:${em}${conv ? `:${conv}` : ''}`;
}

module.exports = {
  pinPavlexWorkspace,
  pavlexChatChannel,
};
