/**
 * Pavlex agent execution engine — OpenAI Responses API + MCP CRM tools.
 */
const fs = require('fs');
const dbService = require('../database');
const { userEmail } = require('../workspaceService');
const { buildAssistantContext } = require('../assistantSearch');
const { pavlexChatWithCrmTools } = require('../mcp/mcpChatRuntime');
const { runMcpDiagnostics } = require('../mcp/mcpDiagnostics');
const { loadWorkspaceMcpConfig } = require('./pavlexMcpConfig');
const mcpLogger = require('../mcp/mcpLogger');

const MEMORY_FILE = '/opt/data/memories/MEMORY.md';
const USER_FILE = '/opt/data/memories/USER.md';

function readMemoryFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('§').map((s) => s.trim()).filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

const CRM_COMMAND_HINTS = `
CRM MCP TOOLS — use these automatically when the user asks about leads or folders:
- "List my folders" / "list folders" → call list_folders
- "How many leads in [folder]?" → call count_leads with folder_name or folder_id
- "Show leads in [folder]" / "first N leads" → call list_leads with folder_name or folder_id and limit
- "Update this lead" / change phone, email, status, tags → call update_lead with lead_id and fields
- Search across CRM → search_leads
Always use tools for CRM questions instead of guessing.`;

async function buildPavlexInstructions(req, { platform = 'automate', message = '' } = {}) {
  const memoryCtx = readMemoryFile(MEMORY_FILE);
  const userCtx = readMemoryFile(USER_FILE);
  const email = userEmail(req);
  const mcpConfig = await loadWorkspaceMcpConfig(req);

  let workspaceBlock = '';
  if (platform === 'assistant' && req.workspaceId && email) {
    const { contextText } = await buildAssistantContext({
      workspaceId: req.workspaceId,
      email,
      query: String(message || '').trim(),
    });
    workspaceBlock = `\nWORKSPACE DATA (leads, pipeline, resources):\n${contextText}\n`;
  }

  const platformLabel =
    platform === 'assistant'
      ? 'Agency OS floating chat (sales coach widget)'
      : 'Automate Command Center (CEO dashboard)';

  return `You are Pavlex, the AI Chief of Staff for Alex Pavlenko. You operate across all his ventures: AdHello.ai agency, personal brand, futures trading coach, coffee shop, and client consulting.

You have the SAME memory and context as the Hermes agent on Telegram. When Alex talks to you here, it should feel identical — same knowledge, same tasks, same personality.

USER PROFILE:
${userCtx}

MEMORY / CONTEXT:
${memoryCtx}
${workspaceBlock}
CURRENT SESSION:
- Platform: ${platformLabel}
- User: ${email || 'Alex Pavlenko'} (logged in)
- Workspace: ${req.workspaceId || 'default'}
- MCP server: ${mcpConfig.serverUrl || 'inline execution'}
- Time: ${new Date().toISOString()}

${CRM_COMMAND_HINTS}

RULES:
- Be extremely concise. One-word directions from Alex are normal.
- Immediate action over analysis. Strategy → execute.
- Use CRM MCP tools for folder/lead questions — never invent counts or lead data.
- If Alex asks you to do something (create task, research, write content), DO it — don't just suggest.
- Keep responses under 300 words unless asked for detail.
- Same tone as Telegram: direct, pragmatic, no hand-holding.
${platform === 'assistant' ? '- Plain text only. No markdown asterisks or backticks.' : ''}`;
}

/**
 * @param {import('express').Request} req
 * @param {object} opts
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {'automate'|'assistant'} [opts.platform]
 * @param {boolean} [opts.persistHistory]
 * @param {string} [opts.historyChannel]
 */
async function runPavlexChat(req, opts) {
  const message = String(opts.message || '').trim();
  const history = Array.isArray(opts.history) ? opts.history : [];
  const platform = opts.platform === 'assistant' ? 'assistant' : 'automate';
  const persistHistory = opts.persistHistory !== false;
  const historyChannel = opts.historyChannel || (platform === 'assistant' ? 'assistant' : 'ceo');

  if (!message) {
    const err = new Error('Message is required.');
    err.status = 400;
    throw err;
  }

  const mcpConfig = await loadWorkspaceMcpConfig(req);
  mcpLogger.chatRuntime({
    phase: 'pavlex_agent_start',
    platform,
    workspaceId: mcpConfig.workspaceId,
    userEmail: mcpConfig.userEmail,
    runtimeReady: mcpConfig.runtimeReady,
    responsesMcpReady: mcpConfig.responsesMcpReady,
  });

  const instructions = await buildPavlexInstructions(req, { platform, message });
  const legacyMessages = [{ role: 'system', content: instructions }];

  if (platform === 'automate' && persistHistory) {
    const persisted = dbService.getRecentChatContext('ceo', 10);
    persisted.forEach((m) => {
      if (m.role && m.content) legacyMessages.push({ role: m.role, content: m.content });
    });
  }

  history.slice(-10).forEach((m) => {
    if (m && m.role && m.content) {
      legacyMessages.push({ role: m.role, content: String(m.content) });
    }
  });
  legacyMessages.push({ role: 'user', content: message });

  const chatOut = await pavlexChatWithCrmTools({
    req,
    instructions,
    message,
    history: history.slice(-10),
    legacyMessages,
    mcpConfig,
    maxTokens: platform === 'assistant' ? 1000 : 1200,
    temperature: platform === 'assistant' ? 0.52 : 0.7,
  });

  if (!chatOut.content || chatOut.error) {
    const err = new Error('AI unavailable. Configure OPENAI_API_KEY on the server.');
    err.status = 502;
    err.detail = chatOut.mcpMode || 'unavailable';
    throw err;
  }

  if (persistHistory && platform === 'automate') {
    dbService.saveChatMessage('ceo', 'user', message, 'web');
    dbService.saveChatMessage('ceo', 'assistant', chatOut.content, 'web');
  }

  return {
    reply: chatOut.content,
    provider: chatOut.provider || 'none',
    mcpEnabled: !!chatOut.mcpEnabled,
    mcpMode: chatOut.mcpMode || null,
    mcpConfig: {
      serverUrl: mcpConfig.serverUrl,
      authMethod: mcpConfig.authMethod,
      availableTools: mcpConfig.availableTools,
    },
  };
}

/**
 * Debug probe for Pavlex MCP runtime.
 * @param {import('express').Request} req
 */
async function runPavlexMcpDebug(req) {
  const mcpConfig = await loadWorkspaceMcpConfig(req);
  const diagnostics = await runMcpDiagnostics(req);

  return {
    mcpConnectionStatus: diagnostics.mcpConnected ? 'connected' : 'disconnected',
    mcpConnected: diagnostics.mcpConnected,
    serverReachable: diagnostics.serverReachable,
    authenticatedUser: diagnostics.authenticatedUser,
    workspaceId: diagnostics.workspaceId,
    availableTools: diagnostics.availableTools,
    discoveredTools: diagnostics.discoveredTools,
    listFolders: diagnostics.listFolders,
    listFoldersError: diagnostics.listFoldersError,
    integrations: {
      serverUrl: mcpConfig.serverUrl,
      manifestUrl: mcpConfig.manifestUrl,
      sessionAuth: mcpConfig.authMethod,
      longLivedTokenConfigured: mcpConfig.integrationsTokenConfigured,
      longLivedTokenHint: mcpConfig.integrationsTokenHint,
      runtimeReady: mcpConfig.runtimeReady,
      responsesMcpReady: mcpConfig.responsesMcpReady,
      openaiConfigured: mcpConfig.openaiConfigured,
      baseUrlConfigured: mcpConfig.baseUrlConfigured,
    },
    remoteProbeError: diagnostics.remoteProbeError || null,
  };
}

module.exports = {
  runPavlexChat,
  runPavlexMcpDebug,
  buildPavlexInstructions,
  CRM_COMMAND_HINTS,
};
