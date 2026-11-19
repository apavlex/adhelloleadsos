/**
 * Direct CRM tool execution for common Pavlex questions — no OpenAI required.
 */
const { executeCrmTool } = require('../mcp/mcpToolExecutor');
const pavlexLogger = require('./pavlexLogger');

const CONFIRM_DELETE_EMPTY =
  /^(confirm(\s+delete)?(\s+empty)?(\s+folders?)?|yes[,.]?\s*(delete|remove)(\s+(all|empty))?(\s+folders?)?|delete\s+them)\s*[!.]?$/i;

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

function formatDeleteFolder(result) {
  if (!result || result.success === false) return null;
  return result.message || 'Folder deleted.';
}

function emptyFoldersFromList(result) {
  const folders = (result && result.folders) || [];
  return folders
    .filter((f) => f && f.key && !f.isPipelineDefault && (Number(f.leadCount) || 0) === 0)
    .sort((a, b) => {
      const depth = (f) => String(f.path || f.name || '').split(' / ').length;
      return depth(b) - depth(a) || String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function previewDeleteEmptyFolders(result) {
  const empty = emptyFoldersFromList(result);
  if (!empty.length) {
    return 'There are no empty folders to delete. System folders (Businesses, Permits, and the rest) stay put.';
  }
  const lines = empty.slice(0, 40).map((f) => `- ${f.path || f.name}`);
  const more = empty.length > 40 ? `\n…and ${empty.length - 40} more` : '';
  return (
    `I can delete ${empty.length} empty folder${empty.length === 1 ? '' : 's'} (leads stay unfiled; system folders stay):\n` +
    `${lines.join('\n')}${more}\n\n` +
    `Reply **confirm delete empty folders** to proceed.`
  );
}

/**
 * Map natural-language CRM questions to tool calls.
 * @returns {{ tool: string, args: object, formatter: Function, kind?: string } | null}
 */
function matchDirectCrmQuery(message) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const q = raw.toLowerCase();

  if (CONFIRM_DELETE_EMPTY.test(raw)) {
    return { tool: 'list_folders', args: {}, formatter: previewDeleteEmptyFolders, kind: 'delete_empty_confirm' };
  }

  if (
    /^(remove|delete|clear)\s+(all\s+)?(empty\s+)?folders?\??$/i.test(raw) ||
    /^(remove|delete|clear)\s+all\s+(the\s+)?(empty\s+)?folders?\??$/i.test(raw) ||
    /^delete\s+empty\s+folders?\??$/i.test(raw) ||
    /^remove\s+empty\s+folders?\??$/i.test(raw)
  ) {
    return { tool: 'list_folders', args: {}, formatter: previewDeleteEmptyFolders, kind: 'delete_empty_preview' };
  }

  const deleteOne =
    raw.match(/^(?:delete|remove)\s+(?:the\s+)?(.+?)\s+folder\??$/i) ||
    raw.match(/^(?:delete|remove)\s+folder\s+(.+?)\??$/i);
  if (deleteOne && deleteOne[1]) {
    const folderName = deleteOne[1].trim().replace(/^["']|["']$/g, '');
    if (folderName && !/^(all|every|empty)$/i.test(folderName)) {
      return {
        tool: 'manage_folder',
        args: { action: 'delete', folder: folderName },
        formatter: formatDeleteFolder,
      };
    }
  }

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

async function deleteEmptyFoldersNow(ctx, listResult) {
  const empty = emptyFoldersFromList(listResult);
  if (!empty.length) {
    return {
      content: 'There are no empty folders to delete. System folders stay put.',
      provider: 'crm-direct',
      mcpEnabled: true,
      mcpMode: 'direct_tools',
      toolsUsed: ['list_folders'],
    };
  }
  const deleted = [];
  const failed = [];
  const toolsUsed = ['list_folders'];
  for (const folder of empty) {
    // eslint-disable-next-line no-await-in-loop
    const del = await executeCrmTool(ctx, 'manage_folder', { action: 'delete', folder: folder.key });
    toolsUsed.push('manage_folder');
    if (!del || del.success === false) {
      failed.push({ name: folder.path || folder.name, error: (del && del.error) || 'failed' });
    } else {
      deleted.push(folder.path || folder.name);
    }
  }
  const lines = deleted.slice(0, 40).map((name) => `- ${name}`);
  const more = deleted.length > 40 ? `\n…and ${deleted.length - 40} more` : '';
  let content =
    deleted.length > 0
      ? `Deleted ${deleted.length} empty folder${deleted.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`
      : 'No empty folders were deleted.';
  if (failed.length) {
    content += `\n\nCould not delete ${failed.length}: ${failed
      .slice(0, 8)
      .map((f) => f.name)
      .join(', ')}.`;
  }
  content += '\nSystem folders were left alone. Refresh Folder manager to see the update.';
  return {
    content,
    provider: 'crm-direct',
    mcpEnabled: true,
    mcpMode: 'direct_tools',
    toolsUsed,
    deletedCount: deleted.length,
    failedCount: failed.length,
  };
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

  if (match.kind === 'delete_empty_confirm') {
    const out = await deleteEmptyFoldersNow(ctx, result);
    pavlexLogger.toolExecution({
      user: ctx.userEmail,
      question: message,
      tool: 'manage_folder',
      args: { action: 'delete_empty', confirm: true },
      response: { deletedCount: out.deletedCount, failedCount: out.failedCount },
      latencyMs: Date.now() - started,
      mcpConnected: true,
    });
    return { ...out, latencyMs: Date.now() - started };
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
  emptyFoldersFromList,
  CONFIRM_DELETE_EMPTY,
};
