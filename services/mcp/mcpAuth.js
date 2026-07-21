/**
 * MCP authentication: browser session (CEO dashboard) or Bearer MCP access token.
 */
const crypto = require('crypto');
const dbService = require('../database');
const attachWorkspace = require('../../middleware/withWorkspace');
const { userEmail } = require('../workspaceService');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tokenHint(token) {
  const t = String(token || '');
  return t.length <= 4 ? t : t.slice(-4);
}

function readBearerToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function validateMcpBearerToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;

  const envToken = String(process.env.MCP_ACCESS_TOKEN || '').trim();
  if (envToken && raw === envToken) {
    const wid = String(process.env.MCP_WORKSPACE_ID || 'default').trim() || 'default';
    const ws = await dbService.getWorkspace(wid);
    return {
      workspaceId: wid,
      workspace: ws || { id: wid, name: 'Default' },
      authMethod: 'env_token',
      userEmail: process.env.MCP_USER_EMAIL || '',
    };
  }

  const hash = sha256(raw);
  const workspaceIds = await dbService.listWorkspaceIds();
  for (const wid of workspaceIds) {
    const ws = await dbService.getWorkspace(wid);
    if (!ws || !ws.mcpAccessTokenHash) continue;
    if (ws.mcpAccessTokenHash !== hash) continue;
    return {
      workspaceId: wid,
      workspace: ws,
      authMethod: 'workspace_token',
      userEmail: ws.mcpAccessTokenCreatedBy || '',
    };
  }
  return null;
}

async function generateWorkspaceMcpToken(workspaceId, createdByEmail) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws) {
    const err = new Error('Workspace not found.');
    err.status = 404;
    throw err;
  }
  const next = {
    ...ws,
    mcpAccessTokenHash: sha256(token),
    mcpAccessTokenHint: tokenHint(token),
    mcpAccessTokenCreatedAt: new Date().toISOString(),
    mcpAccessTokenCreatedBy: String(createdByEmail || '').trim().toLowerCase(),
  };
  await dbService.saveWorkspace(workspaceId, next);
  return { token, hint: next.mcpAccessTokenHint, createdAt: next.mcpAccessTokenCreatedAt };
}

async function revokeWorkspaceMcpToken(workspaceId) {
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws) return { revoked: false };
  const next = { ...ws };
  delete next.mcpAccessTokenHash;
  delete next.mcpAccessTokenHint;
  delete next.mcpAccessTokenCreatedAt;
  delete next.mcpAccessTokenCreatedBy;
  await dbService.saveWorkspace(workspaceId, next);
  return { revoked: true };
}

function getWorkspaceMcpTokenStatus(workspace) {
  if (!workspace) return { configured: false };
  return {
    configured: Boolean(workspace.mcpAccessTokenHash),
    hint: workspace.mcpAccessTokenHint || null,
    createdAt: workspace.mcpAccessTokenCreatedAt || null,
    createdBy: workspace.mcpAccessTokenCreatedBy || null,
  };
}

/**
 * Resolve workspace + user for MCP requests.
 * Accepts an active browser session OR Authorization: Bearer <mcp token>.
 */
async function mcpAuthContext(req, res, next) {
  try {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return attachWorkspace(req, res, () => {
        req.mcpAuthMethod = 'session';
        req.mcpUserEmail = userEmail(req);
        next();
      });
    }

    const bearer = readBearerToken(req);
    if (!bearer) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Sign in or provide Authorization: Bearer <MCP token>.' },
      });
    }

    const auth = await validateMcpBearerToken(bearer);
    if (!auth) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Invalid MCP access token.' },
      });
    }

    req.workspaceId = auth.workspaceId;
    req.workspace = auth.workspace;
    req.mcpAuthMethod = auth.authMethod;
    req.mcpUserEmail = auth.userEmail || '';
    return next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  mcpAuthContext,
  generateWorkspaceMcpToken,
  revokeWorkspaceMcpToken,
  getWorkspaceMcpTokenStatus,
  readBearerToken,
  validateMcpBearerToken,
};
