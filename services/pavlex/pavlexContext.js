/**
 * Shared Pavlex system context — identity, MCP tools, memory.
 * CRM data comes from MCP tools only (not injected snippets that enable guessing).
 */
const fs = require('fs');
const dbService = require('../database');
const { loadWorkspaceMcpConfig } = require('./pavlexMcpConfig');
const { CRM_COMMAND_HINTS } = require('./pavlexConstants');
const { CRM_MCP_TOOL_NAMES } = require('../mcp/connection');
const {
  describePageForSession,
  formatFolderCatalog,
} = require('./pavlexPageContext');
const { getEmployee, DEFAULT_EMPLOYEE_ID } = require('./pavlexEmployees');
const tregChatTools = require('../tregChatTools');

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

async function loadFolderCatalog(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || typeof dbService.listFoldersLite !== 'function') return [];
  try {
    return await dbService.listFoldersLite(wid, { failFast: true });
  } catch {
    try {
      return await dbService.listFoldersLite(wid);
    } catch {
      try {
        const full = await dbService.listFolders(wid);
        return Array.isArray(full) ? full : [];
      } catch {
        return [];
      }
    }
  }
}

/**
 * @param {import('express').Request} req
 * @param {object} auth — from resolvePavlexAuth
 * @param {object} opts
 */
async function buildPavlexContext(
  req,
  auth,
  {
    platform = 'global',
    message = '',
    page = '',
    pageTitle = '',
    ui = null,
    employeeId = DEFAULT_EMPLOYEE_ID,
  } = {},
) {
  const mcpConfig = await loadWorkspaceMcpConfig(req);
  const memoryCtx = readMemoryFile(MEMORY_FILE);
  const userCtx = readMemoryFile(USER_FILE);
  const employee = getEmployee(employeeId, auth.workspaceId);

  const platformLabels = {
    assistant: 'Agency OS floating chat',
    automate: 'Automate Command Center (CEO dashboard)',
    global: 'Agency OS (site-wide Alex chat)',
    chat: 'Agency OS team chat page',
  };
  const platformLabel = platformLabels[platform] || platformLabels.global;
  const pageInfo = describePageForSession(page, pageTitle, ui);
  const folders = await loadFolderCatalog(auth.workspaceId);
  const folderCatalog = formatFolderCatalog(folders);

  const toolsList = (mcpConfig.availableTools || []).join(', ');
  const tregOn = tregChatTools.enabledForWorkspace(auth.workspaceId, req.workspace);
  const workspaceName = String((req.workspace && req.workspace.name) || '').trim();
  const businessProfile = describeBusinessProfile(req.workspace);

  const instructions = `${employee.identityPrompt}

Use CRM / platform tools whenever the user asks about: leads, folders, finding new leads / referral partners, bookmarks, tags, GHL sync, scripts, contacts, pipeline, prospecting stages, status, enrichment, tasks (including assigning them to teammates), follow-ups, daily suggestions, referral network, trades pool jobs, team field work, appointment packages / marketplace, Marketing Studio / direct mail, Social Posts, Facebook Groups, SOPs, SEO / Local Rank / Maps / GBP / keyword gaps / backlinks / business review replies / search volume / category keyword research (DataForSEO), messaging (SMS/email), Ops agents (Prospect SDR, Opportunity SDR, Dispatcher, Network Coach, Ops bot), counts, search, or updates.

AVAILABLE MCP TOOLS: ${toolsList || CRM_MCP_TOOL_NAMES.join(', ')}

USER PROFILE:
${userCtx}

MEMORY / CONTEXT:
${memoryCtx}

SESSION:
- Platform: ${platformLabel}
- Chat employee: ${employee.name} (${employee.id}) — ${employee.title}
${pageInfo.text}
- User: ${auth.email}
- Now: ${nowInTimezone(req.workspace && req.workspace.timezone)}
- Workspace: ${workspaceName ? `${workspaceName} (${auth.workspaceId})` : auth.workspaceId}
- Business profile: ${businessProfile || 'not set up — ask what they sell and where if it matters'}
- CRM tools: built into this app (call them directly)
- Permissions: read=${auth.permissions.canReadCrm} write=${auth.permissions.canWriteCrm}
- All folders in this workspace (use these names/keys; call list_folders only if you need live counts):
${folderCatalog}

${CRM_COMMAND_HINTS}

RULES:
- Every tool call reads and writes only the workspace above${workspaceName ? ` ("${workspaceName}")` : ''}. Memory or earlier messages about other workspaces or niches do not change that.
- Be extremely concise. Use CRM tools — never invent lead counts or folder data.
- You already know every folder name above. Prefer folder_name / folder_id from that catalog (or the open folder on the page) instead of asking which folder.
- If the user is vague ("these leads", "here", "this folder", "clean this up"), use the Looking at / Open folder / Selected leads lines in SESSION.
- "Leads in Vancouver / zip 98682 / Camas" already in the CRM → search_leads with that query (not find_leads). find_leads is only for scraping new businesses.
- Do exactly what was asked with the matching tool. If nothing matches, say so plainly instead of doing something similar.
${tregOn ? tregChatTools.systemNote() : ''}
- Run lead searches (find_leads) without asking for confirmation; mention they finish in the background.
- Immediate action over analysis.
- Never show your reasoning, plans or tool-call markup to the user — call tools, then reply with the result.
- Keep responses under 300 words unless asked for detail.
- Direct, pragmatic tone.
${platform === 'assistant' || platform === 'global' ? '- Plain text only. No markdown asterisks or backticks.' : ''}${platform === 'chat' ? CHAT_PAGE_FORMAT : ''}`;

  return {
    instructions,
    mcpConfig,
    platform,
    pageInfo,
    folderCount: folders.length,
    employeeId: employee.id,
    preferredOpenRouterModels: [...(employee.preferredOpenRouterModels || [])],
    preferredXaiModels: [...(employee.preferredXaiModels || [])],
  };
}

module.exports = {
  buildPavlexContext,
  describeBusinessProfile,
};
