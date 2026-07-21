/**
 * Resolve public MCP server URL and bearer token for OpenAI Responses API callbacks.
 */
const dbService = require('../database');
const { generateWorkspaceMcpToken, getWorkspaceMcpTokenStatus } = require('./mcpAuth');

const CRM_MCP_TOOL_NAMES = [
  'list_folders',
  'get_folder',
  'list_leads',
  'get_lead',
  'update_lead',
  'bulk_update_leads',
  'search_leads',
];

function getMcpServerUrl(req) {
  const base = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/ceo/mcp`;
  if (req && req.get && req.protocol) {
    return `${req.protocol}://${req.get('host')}/ceo/mcp`;
  }
  return '';
}

function envMcpBearerToken(workspaceId) {
  const token = String(process.env.MCP_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const scopedWid = String(process.env.MCP_WORKSPACE_ID || '').trim();
  if (scopedWid && scopedWid !== String(workspaceId || '').trim()) return null;
  return token;
}

/**
 * Bearer token OpenAI can send when calling our MCP server.
 * Uses MCP_ACCESS_TOKEN when set; otherwise auto-provisions a workspace token once.
 *
 * @returns {Promise<{ token: string|null, autoProvisioned: boolean, status: object }>}
 */
async function resolveMcpBearerToken(workspaceId, { autoProvision = false, createdByEmail = '' } = {}) {
  const envToken = envMcpBearerToken(workspaceId);
  if (envToken) {
    return {
      token: envToken,
      autoProvisioned: false,
      status: getWorkspaceMcpTokenStatus(await dbService.getWorkspace(workspaceId)),
    };
  }

  const ws = await dbService.getWorkspace(workspaceId);
  const status = getWorkspaceMcpTokenStatus(ws);

  if (status.configured) {
    return { token: null, autoProvisioned: false, status };
  }

  if (!autoProvision || !createdByEmail) {
    return { token: null, autoProvisioned: false, status };
  }

  const issued = await generateWorkspaceMcpToken(workspaceId, createdByEmail);
  return {
    token: issued.token,
    autoProvisioned: true,
    status: {
      configured: true,
      hint: issued.hint,
      createdAt: issued.createdAt,
      createdBy: String(createdByEmail || '').trim().toLowerCase(),
    },
  };
}

function isResponsesMcpReady({ serverUrl, bearerToken, openaiApiKey }) {
  return Boolean(
    String(openaiApiKey || process.env.OPENAI_API_KEY || '').trim() &&
      String(serverUrl || '').trim() &&
      String(bearerToken || '').trim(),
  );
}

module.exports = {
  CRM_MCP_TOOL_NAMES,
  getMcpServerUrl,
  envMcpBearerToken,
  resolveMcpBearerToken,
  isResponsesMcpReady,
};
