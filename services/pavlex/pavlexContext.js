/**
 * Shared Pavlex system context — identity, MCP tools, memory.
 * CRM data comes from MCP tools only (not injected snippets that enable guessing).
 */
const fs = require('fs');
const { loadWorkspaceMcpConfig } = require('./pavlexMcpConfig');
const { CRM_COMMAND_HINTS } = require('./pavlexConstants');

const CHAT_PAGE_FORMAT = `
CHAT PAGE FORMATTING (markdown is rendered):
- Use **bold**, short headings, bullet or numbered lists, and tables (e.g. Name | City | Phone | Status) when listing several leads.
- Link each lead you name as [Business Name](/focus?lead=KEY) — KEY is the lead key from a tool result without the "lead:" prefix.
- Link folders as [Folder Name](/prospecting?tab=pipeline&folderKey=FOLDER_KEY) using the folder key from a tool result.
- Only link keys a tool returned; never invent keys or URLs.
- Up to ~400 words when a list or script needs it; otherwise stay brief.`;

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

/** "Wednesday 2026-09-30 17:09 America/Los_Angeles (GMT-07:00)" so the model can turn "tomorrow at 10" into a due date. */
function nowInTimezone(tz) {
  const zone = String(tz || '').trim() || 'America/Los_Angeles';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${zone} (${p.timeZoneName})`;
  } catch {
    return new Date().toISOString();
  }
}

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** One line from the workspace setup answers, e.g. "Camas Flooring · Flooring · sells to Interior Designers · area: Camas, WA". */
function describeBusinessProfile(workspace) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const si = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const icp = ws.icp && typeof ws.icp === 'object' ? ws.icp : {};
  const area = [clip(icp.city, 60), clip(icp.state, 30)].filter(Boolean).join(', ');
  const bits = [
    clip(si.businessName, 80),
    clip(si.vertical, 60) || clip(icp.keyword, 60),
    si.offerName ? `offer: ${clip(si.offerName, 80)}` : '',
    si.targetAudience ? `sells to ${clip(si.targetAudience, 100)}` : '',
    si.differentiator ? `differentiator: ${clip(si.differentiator, 100)}` : '',
    area ? `area: ${area}` : '',
  ].filter(Boolean);
  return bits.join(' · ');
}

/**
 * @param {import('express').Request} req
 * @param {object} auth — from resolvePavlexAuth
 * @param {object} opts
 */
async function buildPavlexContext(req, auth, { platform = 'global', message = '', page = '' } = {}) {
  const mcpConfig = await loadWorkspaceMcpConfig(req);
  const memoryCtx = readMemoryFile(MEMORY_FILE);
  const userCtx = readMemoryFile(USER_FILE);

  const platformLabels = {
    assistant: 'Agency OS floating chat',
    automate: 'Automate Command Center (CEO dashboard)',
    global: 'Agency OS (site-wide Alex chat)',
    chat: 'Agency OS Alex chat page',
  };
  const platformLabel = platformLabels[platform] || platformLabels.global;
  const pagePath = String(page || '').trim();

  const toolsList = (mcpConfig.availableTools || []).join(', ');
  const workspaceName = String((req.workspace && req.workspace.name) || '').trim();
  const businessProfile = describeBusinessProfile(req.workspace);

  const instructions = `You are Alex, the AI receptionist and sales assistant. You have access to this user's CRM via MCP tools. Your name is Alex; if memory or earlier messages call you Pavlex, that was your old name — always introduce yourself as Alex.

Use CRM tools whenever the user asks about: leads, folders, finding new leads / referral partners, bookmarks, tags, GHL sync, scripts, contacts, pipeline, prospecting stages, status, enrichment, tasks (including assigning them to teammates), follow-ups, daily suggestions, counts, search, or updates.

AVAILABLE MCP TOOLS: ${toolsList || 'list_folders, get_folder, create_folder, rename_folder, count_leads, list_leads, get_lead, update_lead, bulk_update_leads, search_leads, find_leads, get_search_status, bookmark_leads, list_tags, tag_leads, sync_leads_to_ghl, get_ghl_sync_status, save_script, list_opportunity_pipelines, get_opportunity_board, create_opportunity_pipeline, move_opportunity, move_opportunities, enrich_lead, list_team_members, list_tasks, create_task, update_task, list_followups, suggest_daily_leads'}

USER PROFILE:
${userCtx}

MEMORY / CONTEXT:
${memoryCtx}

SESSION:
- Platform: ${platformLabel}
- Current page: ${pagePath || 'unknown'}
- User: ${auth.email}
- Now: ${nowInTimezone(req.workspace && req.workspace.timezone)}
- Workspace: ${workspaceName ? `${workspaceName} (${auth.workspaceId})` : auth.workspaceId}
- Business profile: ${businessProfile || 'not set up — ask what they sell and where if it matters'}
- MCP server: ${mcpConfig.serverUrl || 'inline CRM execution'}
- Permissions: read=${auth.permissions.canReadCrm} write=${auth.permissions.canWriteCrm}

${CRM_COMMAND_HINTS}

RULES:
- Every tool call reads and writes only the workspace above${workspaceName ? ` ("${workspaceName}")` : ''}. Memory or earlier messages about other workspaces or niches do not change that.
- Be extremely concise. Use CRM tools — never invent lead counts or folder data.
- Do exactly what was asked with the matching tool. If nothing matches, say so plainly instead of doing something similar.
- Run lead searches (find_leads) without asking for confirmation; mention they finish in the background.
- Immediate action over analysis.
- Keep responses under 300 words unless asked for detail.
- Direct, pragmatic tone.
${platform === 'assistant' || platform === 'global' ? '- Plain text only. No markdown asterisks or backticks.' : ''}${platform === 'chat' ? CHAT_PAGE_FORMAT : ''}`;

  return {
    instructions,
    mcpConfig,
    platform,
  };
}

module.exports = {
  buildPavlexContext,
  describeBusinessProfile,
};
