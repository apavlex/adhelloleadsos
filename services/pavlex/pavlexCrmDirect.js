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

function formatDuplicateLeads(result) {
  const groups = (result && result.groups) || [];
  const found = typeof result.groups_found === 'number' ? result.groups_found : groups.length;
  const note = result && result.note ? `\n(${result.note})` : '';
  const mode = result && result.match_by === 'strict' ? 'strict match' : 'same name across locations';
  if (!found) {
    return `No duplicate lead groups found (${mode}) — nothing to merge.${note}`;
  }
  const lines = groups.slice(0, 10).map((g, i) => {
    const locs =
      Array.isArray(g.locations) && g.locations.length
        ? g.locations.join(' · ')
        : (g.leads || [])
            .map((l) => [l.city, l.state].filter(Boolean).join(', '))
            .filter(Boolean)
            .join(' · ');
    const names = [
      ...new Set((g.leads || []).map((l) => l.title || l.business || '').filter(Boolean)),
    ].join(' / ');
    const ids = (g.leads || []).map((l) => l.id).filter(Boolean).join(', ');
    return `${i + 1}. ${names}${locs ? ` — ${locs}` : ''}${ids ? ` [${ids}]` : ''}`;
  });
  return (
    `Found ${found} same-name group${found === 1 ? '' : 's'} across locations (${mode}).${note}\n` +
    `${lines.join('\n')}\n` +
    `Say which group to merge (e.g. "merge group 1") — locations fold into one lead; nothing merges until you confirm.`
  );
}

/** "find 20 interior designers in Camas WA…" is a new lead search (find_leads), not a CRM lookup. */
function looksLikeLeadGenRequest(text) {
  const s = String(text || '').trim();
  return (
    /^\d+\s/.test(s) ||
    /\b(in|near|around)\s+[a-z]/i.test(s) ||
    /\b(referral|partners?|folders?|put|save|bookmark|opportunit\w*|and)\b/i.test(s)
  );
}

/** Tasks, tags, GHL and teammates need their own tools, not a lead text search. */
function mentionsCrmAction(text) {
  return /\b(tasks?|tag(s|ged)?|ghl|gohighlevel|assign\w*|team\w*)\b/i.test(String(text || ''));
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

  // Same business name across cities/locations — never invent a folder_id from place-name chat.
  if (
    /^(find|scan|show|list|check)\s+(my\s+)?duplicates?\??$/i.test(raw) ||
    /^(clean\s*up|merge)\s+(my\s+)?duplicates?\??$/i.test(raw) ||
    /^duplicates?\??$/i.test(raw) ||
    /^find duplicate leads?\??$/i.test(raw) ||
    /^(merge|combine)\s+(same\s+)?(names?|locations?)\??$/i.test(raw) ||
    /^merge\s+locations?\s+to\s+(a\s+)?single\s+name\??$/i.test(raw) ||
    /^same\s+names?\s+(different\s+)?locations?\??$/i.test(raw)
  ) {
    return {
      tool: 'find_duplicate_leads',
      args: { match_by: 'name' },
      formatter: formatDuplicateLeads,
    };
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

  // CRM lookup by place ("leads in Vancouver WA 98682") — not a Maps scrape.
  const leadsInPlace =
    raw.match(/^(?:show|list|get)\s+leads?\s+(?:in|near|around|from)\s+(.+?)\??$/i) ||
    raw.match(/^leads?\s+(?:in|near|around|from)\s+(.+?)\??$/i);
  if (leadsInPlace && leadsInPlace[1] && !mentionsCrmAction(leadsInPlace[1])) {
    return {
      tool: 'search_leads',
      args: { query: leadsInPlace[1].trim(), limit: 15 },
      formatter: formatSearchLeads,
    };
  }

  const search =
    raw.match(/^find\s+(.+?)(?:\s+lead)?\??$/i) ||
    raw.match(/^search(?:\s+for)?\s+(.+?)(?:\s+lead)?\??$/i);
  if (search && search[1] && !looksLikeLeadGenRequest(search[1]) && !mentionsCrmAction(search[1])) {
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
  looksLikeLeadGenRequest,
  matchDirectCrmQuery,
  tryDirectCrmChat,
};
