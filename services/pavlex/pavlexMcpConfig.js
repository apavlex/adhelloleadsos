/**
 * Load MCP configuration for the logged-in user's workspace (Integrations settings).
 */
const dbService = require('../database');
const { userEmail } = require('../workspaceService');
const { getWorkspaceMcpTokenStatus } = require('../mcp/mcpAuth');
const {
  getMcpServerUrl,
  resolveMcpBearerTokenForChat,
  CRM_MCP_TOOL_NAMES,
} = require('../mcp/mcpConnection');
const { getOpenAiToolManifest } = require('../mcp/mcpServerFactory');

/**
 * @param {import('express').Request} req
 * @returns {Promise<object>}
 */
async function loadWorkspaceMcpConfig(req) {
  const workspaceId = req.workspaceId;
  const email = userEmail(req);
  const ws = workspaceId ? await dbService.getWorkspace(workspaceId) : null;
  const tokenStatus = getWorkspaceMcpTokenStatus(ws);
  const serverUrl = getMcpServerUrl(req);
  const manifestUrl = serverUrl ? `${serverUrl.replace(/\/$/, '')}/manifest.json` : '';
  const session = resolveMcpBearerTokenForChat(req);
  const manifest = getOpenAiToolManifest();
  const openaiConfigured = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const baseUrlConfigured = Boolean(String(process.env.BASE_URL || '').trim());

  return {
    workspaceId: workspaceId || null,
    userEmail: email || null,
    serverUrl: serverUrl || null,
    manifestUrl: manifestUrl || null,
    sessionToken: session.token || null,
    authMethod: session.authMethod || 'session_token',
    integrationsTokenConfigured: tokenStatus.configured,
    integrationsTokenHint: tokenStatus.hint || null,
    integrationsTokenCreatedAt: tokenStatus.createdAt || null,
    availableTools: manifest.tools.map((t) => t.name),
    toolNames: CRM_MCP_TOOL_NAMES,
    openaiConfigured,
    baseUrlConfigured,
    runtimeReady: Boolean(session.token && openaiConfigured),
    responsesMcpReady: Boolean(session.token && openaiConfigured && serverUrl),
  };
}

module.exports = {
  loadWorkspaceMcpConfig,
};
