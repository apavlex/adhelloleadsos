/**
 * MCP client — connect, discover tools, invoke CRM actions for Pavlex.
 */
const { CRM_MCP_TOOL_NAMES } = require('./connection');
const { executeCrmTool, discoverToolsFromManifest, TOOL_NAMES } = require('./tools');
const mcpLogger = require('./mcpLogger');

/**
 * Connect to MCP server (manifest probe) or confirm inline CRM access.
 *
 * @param {object} opts
 * @param {string} [opts.serverUrl]
 * @param {string} [opts.token]
 * @param {string} opts.userId — user email
 * @param {string} opts.workspaceId
 * @param {string} [opts.userEmail]
 */
async function connectMCP({ serverUrl, token, userId, workspaceId, userEmail }) {
  const started = Date.now();
  const email = String(userEmail || userId || '').trim().toLowerCase();
  const ctx = { workspaceId, userEmail: email };
  let connected = false;
  let tools = TOOL_NAMES.slice();
  let error = null;
  let transport = 'inline';

  if (serverUrl && token) {
    transport = 'remote';
    try {
      const url = `${String(serverUrl).replace(/\/$/, '')}/manifest.json`;
      const res = await fetch(url, {
        headers: { Authorization: token },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const discovered = discoverToolsFromManifest(data);
        if (discovered.length) tools = discovered;
        connected = true;
        mcpLogger.toolsDiscovered({ source: 'mcp_client', tools, workspaceId });
      } else {
        error = `Manifest HTTP ${res.status}`;
      }
    } catch (err) {
      error = err.message || 'Manifest probe failed';
      mcpLogger.transportError({ layer: 'mcp_client', error });
    }
  }

  if (!connected && workspaceId && email) {
    connected = true;
    transport = 'inline';
    tools = TOOL_NAMES.slice();
  }

  mcpLogger.connectionStatus({
    source: 'mcp_client',
    connected,
    transport,
    workspaceId,
    userEmail: email,
    serverUrl: serverUrl || null,
    latencyMs: Date.now() - started,
    error,
  });

  return {
    connected,
    transport,
    serverUrl: serverUrl || null,
    tools,
    ctx,
    latencyMs: Date.now() - started,
    error,
  };
}

/**
 * Invoke a CRM MCP tool in-process (same handlers as remote MCP server).
 */
async function invokeMcpTool(ctx, toolName, args, meta) {
  const started = Date.now();
  const result = await executeCrmTool(ctx, toolName, args);
  const latencyMs = Date.now() - started;
  return {
    tool: toolName,
    args: args || {},
    result,
    latencyMs,
    ok: Boolean(result && result.success),
    meta: meta || {},
  };
}

module.exports = {
  connectMCP,
  invokeMcpTool,
  CRM_MCP_TOOL_NAMES,
};
