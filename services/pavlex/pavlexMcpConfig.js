/**
 * Load MCP configuration from workspace Integrations (database-backed).
 */
const dbService = require('../database');
const { userEmail } = require('../workspaceService');
const { getWorkspaceMcpTokenStatus } = require('../mcp/mcpAuth');
const {
  getMcpServerUrl,
  resolveMcpBearerTokenForChat,
  CRM_MCP_TOOL_NAMES,
} = require('../mcp/connection');
const { listToolDefinitions } = require('../mcp/tools');
const { resolveOpenAiDirectKey, hasPavlexToolLlm } = require('./pavlexLlmConfig');

/**
 * Integration record stored on workspace (Integrations page).
 * @param {import('express').Request} req
 */
async function loadMcpIntegrationRecord(req) {
  const workspaceId = req.workspaceId;
  const email = userEmail(req);
  const ws = workspaceId ? await dbService.getWorkspace(workspaceId) : null;
  const tokenStatus = getWorkspaceMcpTokenStatus(ws);

  return {
    id: workspaceId ? `mcp:${workspaceId}` : null,
    user_id: email || null,
    workspace_id: workspaceId || null,
    provider: 'mcp',
    mcp_url: getMcpServerUrl(req) || null,
    encrypted_token: tokenStatus.configured ? 'stored' : null,
    token_hint: tokenStatus.hint || null,
    status: tokenStatus.configured ? 'active' : 'session_auto',
    created_at: tokenStatus.createdAt || null,
    created_by: tokenStatus.createdBy || null,
  };
}

/**
 * @param {import('express').Request} req
 */
async function loadWorkspaceMcpConfig(req) {
  const integration = await loadMcpIntegrationRecord(req);
  const session = resolveMcpBearerTokenForChat(req);
  const tools = listToolDefinitions();
  const openaiConfigured = Boolean(resolveOpenAiDirectKey());
  const toolLlmConfigured = hasPavlexToolLlm();
  const baseUrlConfigured = Boolean(String(process.env.BASE_URL || '').trim());
  const serverUrl = integration.mcp_url;
  const manifestUrl = serverUrl ? `${serverUrl.replace(/\/$/, '')}/manifest.json` : '';

  return {
    workspaceId: integration.workspace_id,
    userEmail: integration.user_id,
    serverUrl,
    manifestUrl,
    sessionToken: session.token || null,
    authMethod: session.authMethod || 'session_token',
    integrationsTokenConfigured: Boolean(integration.encrypted_token),
    integrationsTokenHint: integration.token_hint,
    integrationsTokenCreatedAt: integration.created_at,
    integration,
    availableTools: tools.map((t) => t.name),
    toolNames: CRM_MCP_TOOL_NAMES,
    openaiConfigured,
    toolLlmConfigured,
    baseUrlConfigured,
    runtimeReady: Boolean(session.token && toolLlmConfigured),
    responsesMcpReady: Boolean(session.token && openaiConfigured && serverUrl),
  };
}

module.exports = {
  loadWorkspaceMcpConfig,
  loadMcpIntegrationRecord,
};
