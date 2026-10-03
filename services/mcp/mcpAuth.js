/**
 * MCP authentication: browser session (CEO dashboard) or Bearer MCP access token.
 */
const crypto = require('crypto');
const dbService = require('../database');
const attachWorkspace = require('../../middleware/withWorkspace');
const workspaceService = require('../workspaceService');

const { userEmail } = workspaceService;
const { verifyMcpSessionToken } = require('./mcpSessionToken');
const mcpOAuth = require('./mcpOAuth');
const { getPublicBaseUrl } = require('../../lib/publicBaseUrl');
const mcpLogger = require('./mcpLogger');

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
  if (match) return match[1].trim();
  // OpenAI Responses API forwards the MCP tool `authorization` field as-is (often without Bearer).
  if (auth) return auth;
  // Agents that can only set a custom header.
  return String(req.headers['x-api-key'] || req.headers['x-mcp-token'] || '').trim();
}

async function validateMcpBearerToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;

  if (raw.startsWith(mcpOAuth.ACCESS_PREFIX)) {
    const oauthAuth = await mcpOAuth.validateAccessToken(raw);
    if (!oauthAuth) return null;
    return {
      workspaceId: oauthAuth.workspaceId,
      workspace: oauthAuth.workspace,
      authMethod: 'oauth',
      userEmail: oauthAuth.userEmail,
      grantId: oauthAuth.grantId,
      allWorkspaces: oauthAuth.allWorkspaces,
      clientName: oauthAuth.clientName || '',
    };
  }

  const sessionAuth = verifyMcpSessionToken(raw);
  if (sessionAuth) {
    const ws = await dbService.getWorkspace(sessionAuth.workspaceId);
    return {
      workspaceId: sessionAuth.workspaceId,
      workspace: ws || { id: sessionAuth.workspaceId, name: 'Workspace' },
      authMethod: sessionAuth.authMethod,
      userEmail: sessionAuth.userEmail,
    };
  }

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
    if (!ws) continue;
    const named = (Array.isArray(ws.mcpAccessTokens) ? ws.mcpAccessTokens : []).find((t) => t && t.hash === hash);
    if (named) {
      if (!isMember(ws, named.createdBy)) return null;
      touchNamedToken(wid, named.id);
      return {
        workspaceId: wid,
        workspace: ws,
        authMethod: 'agent_token',
        userEmail: named.createdBy || '',
        clientName: named.label || '',
        tokenId: named.id,
      };
    }
    if (!ws.mcpAccessTokenHash || ws.mcpAccessTokenHash !== hash) continue;
    return {
      workspaceId: wid,
      workspace: ws,
      authMethod: 'workspace_token',
      userEmail: ws.mcpAccessTokenCreatedBy || '',
    };
  }
  return null;
}

const AGENT_TOKEN_PREFIX = 'ahmcp_';
const MAX_AGENT_TOKENS = 25;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

function isMember(ws, email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || !ws) return false;
  if (String(ws.ownerUserId || '').trim().toLowerCase() === em) return true;
  return workspaceService.roleForEmail(ws, em) !== 'viewer' || Boolean(ws.members && ws.members[em]);
}

function touchNamedToken(workspaceId, tokenId) {
  setImmediate(async () => {
    try {
      const ws = await dbService.getWorkspace(workspaceId);
      const list = Array.isArray(ws && ws.mcpAccessTokens) ? ws.mcpAccessTokens : [];
      const t = list.find((x) => x && x.id === tokenId);
      if (!t || (t.lastUsedAt && Date.now() - Date.parse(t.lastUsedAt) < TOUCH_EVERY_MS)) return;
      t.lastUsedAt = new Date().toISOString();
      await dbService.saveWorkspace(workspaceId, { ...ws, mcpAccessTokens: list });
    } catch (_) {
      /* last-used is informational */
    }
  });
}

function presentAgentToken(t) {
  return {
    id: t.id,
    label: t.label,
    hint: t.hint,
    createdAt: t.createdAt || null,
    createdBy: t.createdBy || '',
    lastUsedAt: t.lastUsedAt || null,
  };
}

/** Named token for one AI agent (Muse, Grok, a script). Acts as the person who created it; activity shows under the label. */
async function createAgentMcpToken(workspaceId, { label, createdBy }) {
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws) {
    const err = new Error('Workspace not found.');
    err.status = 404;
    throw err;
  }
  const name = String(label || '').trim().slice(0, 60) || 'AI agent';
  const list = Array.isArray(ws.mcpAccessTokens) ? ws.mcpAccessTokens.filter(Boolean) : [];
  if (list.length >= MAX_AGENT_TOKENS) {
    const err = new Error(`You can keep up to ${MAX_AGENT_TOKENS} agent tokens. Revoke one you no longer use.`);
    err.status = 400;
    throw err;
  }
  const token = `${AGENT_TOKEN_PREFIX}${crypto.randomBytes(30).toString('base64url')}`;
  const row = {
    id: `tok_${crypto.randomBytes(8).toString('hex')}`,
    label: name,
    hash: sha256(token),
    hint: tokenHint(token),
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || '').trim().toLowerCase(),
  };
  await dbService.saveWorkspace(workspaceId, { ...ws, mcpAccessTokens: [...list, row] });
  return { token, ...presentAgentToken(row) };
}

function listAgentMcpTokens(ws, { email, canManage } = {}) {
  const me = String(email || '').trim().toLowerCase();
  return (Array.isArray(ws && ws.mcpAccessTokens) ? ws.mcpAccessTokens : [])
    .filter((t) => t && (canManage || t.createdBy === me))
    .map(presentAgentToken);
}

async function revokeAgentMcpToken(workspaceId, tokenId, { email, canManage } = {}) {
  const ws = await dbService.getWorkspace(workspaceId);
  const list = Array.isArray(ws && ws.mcpAccessTokens) ? ws.mcpAccessTokens : [];
  const t = list.find((x) => x && x.id === tokenId);
  if (!t) return { revoked: false, status: 404 };
  if (!canManage && t.createdBy !== String(email || '').trim().toLowerCase()) return { revoked: false, status: 403 };
  await dbService.saveWorkspace(workspaceId, { ...ws, mcpAccessTokens: list.filter((x) => x !== t) });
  return { revoked: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidTokenMessage(raw, base) {
  const where = `${base}/workspace/ai-apps`;
  if (UUID_RE.test(String(raw || '').trim())) {
    return `That is a workspace ID, not an MCP access token. In AdHello open Settings → AI Connector (${where}), create an agent token and send it as Authorization: Bearer <token>.`;
  }
  return `Invalid MCP access token. Create a new one in AdHello under Settings → AI Connector (${where}) and send it as Authorization: Bearer <token>.`;
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
        mcpLogger.connectionStatus({
          authMethod: 'session',
          workspaceId: req.workspaceId,
          userEmail: req.mcpUserEmail,
          path: req.path,
        });
        next();
      });
    }

    const base = getPublicBaseUrl(req);
    const resourceMetadata = `${base}/.well-known/oauth-protected-resource`;
    const bearer = readBearerToken(req);
    if (!bearer) {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`);
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: `Sign in with OAuth, or send Authorization: Bearer <MCP token>. Agents can create a token in AdHello under Settings → AI Connector (${base}/workspace/ai-apps).`,
        },
      });
    }

    const auth = await validateMcpBearerToken(bearer);
    if (!auth) {
      mcpLogger.authError({ reason: 'invalid_bearer', path: req.path });
      res.set('WWW-Authenticate', `Bearer error="invalid_token", resource_metadata="${resourceMetadata}"`);
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: invalidTokenMessage(bearer, base) },
      });
    }

    mcpLogger.connectionStatus({
      authMethod: auth.authMethod,
      workspaceId: auth.workspaceId,
      userEmail: auth.userEmail,
      path: req.path,
    });

    req.workspaceId = auth.workspaceId;
    req.workspace = auth.workspace;
    req.mcpAuthMethod = auth.authMethod;
    req.mcpUserEmail = auth.userEmail || '';
    req.mcpGrantId = auth.grantId || '';
    req.mcpAllWorkspaces = !!auth.allWorkspaces;
    req.mcpClientName = auth.clientName || '';
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
  createAgentMcpToken,
  listAgentMcpTokens,
  revokeAgentMcpToken,
  AGENT_TOKEN_PREFIX,
  readBearerToken,
  validateMcpBearerToken,
};
