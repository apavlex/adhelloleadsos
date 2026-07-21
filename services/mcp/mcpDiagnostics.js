/**
 * MCP diagnostics for Pavlex chat runtime (connection, auth, tools, list_folders probe).
 */
const { getMcpServerUrl, resolveMcpBearerTokenForChat, CRM_MCP_TOOL_NAMES } = require('./mcpConnection');
const { createMcpSessionToken } = require('./mcpSessionToken');
const { executeCrmTool } = require('./mcpToolExecutor');
const { getOpenAiToolManifest } = require('./mcpServerFactory');
const { userEmail } = require('../workspaceService');
const mcpLogger = require('./mcpLogger');

async function probeRemoteMcp(serverUrl, token) {
  const result = {
    serverReachable: false,
    manifestOk: false,
    discoveredTools: [],
    error: null,
  };
  if (!serverUrl || !token) {
    result.error = 'Missing server URL or session token';
    return result;
  }

  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/manifest.json`, {
      headers: { Authorization: token },
    });
    result.serverReachable = true;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      result.error = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      return result;
    }
    result.manifestOk = true;
    result.discoveredTools = Array.isArray(data.tools)
      ? data.tools.map((t) => t.name).filter(Boolean)
      : CRM_MCP_TOOL_NAMES;
    mcpLogger.toolsDiscovered({
      source: 'diagnostics_manifest',
      tools: result.discoveredTools,
    });
  } catch (err) {
    result.error = err.message || 'Manifest probe failed';
    mcpLogger.transportError({ layer: 'diagnostics_manifest', error: result.error });
  }
  return result;
}

/**
 * @param {import('express').Request} req
 */
async function runMcpDiagnostics(req) {
  const email = userEmail(req);
  const workspaceId = req.workspaceId;
  const ctx = { workspaceId, userEmail: email };
  const serverUrl = getMcpServerUrl(req);
  const session = resolveMcpBearerTokenForChat(req);
  const token = session.token || createMcpSessionToken({ workspaceId, userEmail: email });

  const remote = await probeRemoteMcp(serverUrl, token);

  let listFoldersResult = null;
  let listFoldersError = null;
  try {
    listFoldersResult = await executeCrmTool(ctx, 'list_folders', {});
    if (!listFoldersResult.success) {
      listFoldersError = listFoldersResult.error || 'list_folders failed';
    }
  } catch (err) {
    listFoldersError = err.message || 'list_folders threw';
  }

  const manifest = getOpenAiToolManifest();
  const mcpConnected =
    Boolean(listFoldersResult && listFoldersResult.success) &&
    Array.isArray(listFoldersResult.folders);

  const report = {
    mcpConnected,
    serverReachable: remote.serverReachable,
    manifestOk: remote.manifestOk,
    authenticatedUser: email || null,
    workspaceId: workspaceId || null,
    serverUrl: serverUrl || null,
    authMethod: session.authMethod || 'session_token',
    availableTools: manifest.tools.map((t) => t.name),
    discoveredTools: remote.discoveredTools.length ? remote.discoveredTools : CRM_MCP_TOOL_NAMES,
    listFolders: listFoldersResult,
    listFoldersError,
    remoteProbeError: remote.error,
    openaiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    baseUrlConfigured: Boolean(String(process.env.BASE_URL || '').trim()),
  };

  mcpLogger.connectionStatus({
    source: 'diagnostics',
    ...report,
  });

  return report;
}

module.exports = {
  runMcpDiagnostics,
  probeRemoteMcp,
};
