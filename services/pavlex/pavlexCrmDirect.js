/**
 * Direct CRM tool execution for common Pavlex questions — no OpenAI required.
 */
const { executeCrmTool } = require('../mcp/mcpToolExecutor');
const pavlexLogger = require('./pavlexLogger');

function formatListFolders(result) {
  const folders = (result && result.folders) || [];
  if (!folders.length) return 'You have no lead folders yet.';
  const lines = folders.map(
    (f) => `- ${f.name} (${f.leadCount != null ? f.leadCount : 0} leads)`,
  );
  const totalLeads = folders.reduce((sum, f) => sum + (Number(f.leadCount) || 0), 0);
  return `You have ${folders.length} folder${folders.length === 1 ? '' : 's'} (${totalLeads} leads total):\n${lines.join('\n')}`;
}

function formatCountLeads(result) {
  if (!result || typeof result.count !== 'number') return null;
  if (result.scope === 'workspace') {
    return `You have ${result.count} lead${result.count === 1 ? '' : 's'} in this workspace.`;
  }
  const name = (result.folder && result.folder.name) || 'that folder';
  return `${name}: ${result.count} lead${result.count === 1 ? '' : 's'}.`;
}

function formatListLeads(result) {
  const leads = (result && result.leads) || [];
  const folder = (result && result.folder && result.folder.name) || 'folder';
  if (!leads.length) return `No leads found in ${folder}.`;
  const lines = leads.map((l) => {
    const bits = [l.title || l.business || 'Untitled'];
    if (l.city) bits.push(l.city);
    if (l.phone && l.phone !== 'N/A') bits.push(l.phone);
    return `- ${bits.join(' · ')}`;
  });
  const total = (result.pagination && result.pagination.total) || leads.length;
  return `${leads.length} of ${total} leads in ${folder}:\n${lines.join('\n')}`;
}

function formatSearchLeads(result) {
  const leads = (result && result.leads) || [];
  if (!leads.length) return 'No leads matched that search.';
  const lines = leads.slice(0, 15).map((l) => {
    const bits = [l.title || 'Untitled'];
    if (l.folderName) bits.push(l.folderName);
    if (l.city) bits.push(l.city);
    return `- ${bits.join(' · ')}`;
  });
  return `Found ${leads.length} match${leads.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`;
}

/**
 * Map natural-language CRM questions to tool calls.
 * @returns {{ tool: string, args: object, formatter: Function } | null}
 */
function matchDirectCrmQuery(message) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const q = raw.toLowerCase();

  if (
    /^(list|show)\s+(my\s+)?folders?\??$/i.test(raw) ||
    /^(list|show)\s+(my\s+)?pipeline\??$/i.test(raw) ||
    /^(list|show)\s+(me\s+)?(my\s+)?pipeline\??$/i.test(raw) ||
    /^(list|show)\s+(me\s+)?(my\s+)?folders?\??$/i.test(raw) ||
    /^what folders? do i have\??$/i.test(raw) ||
    /^show me my pipeline\??$/i.test(raw) ||
    /^show my pipeline\??$/i.test(raw)
  ) {
    return { tool: 'list_folders', args: {}, formatter: formatListFolders };
  }

  if (
    /how many leads? do i have\??/i.test(raw) ||
    /how many leads?\??$/i.test(raw) ||
    /^total leads?\??$/i.test(raw) ||
    /^count (all )?leads?\??$/i.test(raw) ||
    /^how many leads? are there\??$/i.test(raw)
  ) {
    return { tool: 'count_leads', args: {}, formatter: formatCountLeads };
  }

  const folderCount =
    raw.match(/how many leads?(?: are)?(?: in| inside)?(?: the)? (.+?)(?:\s+folder)?\??$/i) ||
    raw.match(/count leads?(?: in| inside)?(?: the)? (.+?)(?:\s+folder)?\??$/i);
  if (folderCount && folderCount[1]) {
    const folderName = folderCount[1].trim();
    if (folderName && !/^do i have$/i.test(folderName)) {
      return {
        tool: 'count_leads',
        args: { folder_name: folderName },
        formatter: formatCountLeads,
      };
    }
  }

  const listLeads =
    raw.match(
      /(?:show|list|get)\s+(?:me\s+)?(?:the\s+)?(?:first\s+)?(\d+)?\s*leads?(?:\s+in|\s+from|\s+inside)?(?:\s+the)?\s+(.+?)(?:\s+folder)?\??$/i,
    ) ||
    raw.match(/(?:show|list)\s+(?:first\s+)?(\d+)\s+(.+?)\s+leads?\??$/i);
  if (listLeads) {
    const limit = Math.min(Math.max(parseInt(listLeads[1], 10) || 10, 1), 100);
    const folderName = (listLeads[2] || listLeads[1] || '').trim();
    if (folderName && !/^\d+$/.test(folderName)) {
      return {
        tool: 'list_leads',
        args: { folder_name: folderName, limit, offset: 0 },
        formatter: formatListLeads,
      };
    }
  }

  const search =
    raw.match(/^find\s+(.+?)(?:\s+lead)?\??$/i) ||
    raw.match(/^search(?:\s+for)?\s+(.+?)(?:\s+lead)?\??$/i);
  if (search && search[1]) {
    return {
      tool: 'search_leads',
      args: { query: search[1].trim(), limit: 10 },
      formatter: formatSearchLeads,
    };
  }

  return null;
}

/**
 * Execute a matched CRM query without OpenAI.
 * @param {{ workspaceId: string, userEmail: string }} ctx
 */
async function tryDirectCrmChat(ctx, message) {
  const match = matchDirectCrmQuery(message);
  if (!match) return null;

  const started = Date.now();
  const result = await executeCrmTool(ctx, match.tool, match.args);
  const latencyMs = Date.now() - started;

  if (!result || result.success === false) {
    pavlexLogger.error({
      user: ctx.userEmail,
      question: message,
      detail: `${match.tool} failed: ${(result && result.error) || 'unknown'}`,
    });
    return {
      content: null,
      error: true,
      detail: (result && result.error) || `${match.tool} failed`,
      tool: match.tool,
    };
  }

  const reply = match.formatter(result);
  if (!reply) {
    return { content: null, error: true, detail: 'Could not format CRM response.' };
  }

  pavlexLogger.toolExecution({
    user: ctx.userEmail,
    question: message,
    tool: match.tool,
    args: match.args,
    response: result,
    latencyMs,
    mcpConnected: true,
  });

  return {
    content: reply,
    provider: 'crm-direct',
    mcpEnabled: true,
    mcpMode: 'direct_tools',
    toolsUsed: [match.tool],
    latencyMs,
  };
}

module.exports = {
  matchDirectCrmQuery,
  tryDirectCrmChat,
};
