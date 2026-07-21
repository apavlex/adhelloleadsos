/**
 * Shared Pavlex system context — identity, workspace, MCP tools, memory.
 */
const fs = require('fs');
const { buildAssistantContext } = require('../assistantSearch');
const { loadWorkspaceMcpConfig } = require('./pavlexMcpConfig');
const { CRM_COMMAND_HINTS } = require('./pavlexConstants');

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

/**
 * @param {import('express').Request} req
 * @param {object} auth — from resolvePavlexAuth
 * @param {object} opts
 */
async function buildPavlexContext(req, auth, { platform = 'automate', message = '' } = {}) {
  const mcpConfig = await loadWorkspaceMcpConfig(req);
  const memoryCtx = readMemoryFile(MEMORY_FILE);
  const userCtx = readMemoryFile(USER_FILE);

  let workspaceBlock = '';
  if (platform === 'assistant' && auth.workspaceId && auth.email) {
    const { contextText } = await buildAssistantContext({
      workspaceId: auth.workspaceId,
      email: auth.email,
      query: String(message || '').trim(),
    });
    workspaceBlock = `\nWORKSPACE DATA (leads, pipeline, resources):\n${contextText}\n`;
  }

  const platformLabel =
    platform === 'assistant'
      ? 'Agency OS floating chat'
      : 'Automate Command Center (CEO dashboard)';

  const toolsList = (mcpConfig.availableTools || []).join(', ');

  const instructions = `You are Pavlex, the AI Chief of Staff. You have access to this user's CRM via MCP tools.

Use CRM tools whenever the user asks about: leads, folders, contacts, pipeline, counts, search, or updates.

AVAILABLE MCP TOOLS: ${toolsList || 'list_folders, count_leads, list_leads, get_lead, search_leads, update_lead, bulk_update_leads'}

USER PROFILE:
${userCtx}

MEMORY / CONTEXT:
${memoryCtx}
${workspaceBlock}
SESSION:
- Platform: ${platformLabel}
- User: ${auth.email}
- Workspace: ${auth.workspaceId}
- MCP server: ${mcpConfig.serverUrl || 'inline CRM execution'}
- Permissions: read=${auth.permissions.canReadCrm} write=${auth.permissions.canWriteCrm}

${CRM_COMMAND_HINTS}

RULES:
- Be extremely concise. Use CRM tools — never invent lead counts or folder data.
- Immediate action over analysis.
- Keep responses under 300 words unless asked for detail.
- Direct, pragmatic tone.
${platform === 'assistant' ? '- Plain text only. No markdown asterisks or backticks.' : ''}`;

  return {
    instructions,
    mcpConfig,
    platform,
  };
}

module.exports = {
  buildPavlexContext,
};
