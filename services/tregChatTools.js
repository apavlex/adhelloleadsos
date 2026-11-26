/**
 * Treg catalog tools for Pavlex chat.
 * When the workspace top bar is on Treg, search, the chat page, and the
 * floating chatbot can search the catalog and call any tool through three
 * functions — the same loop as https://treg.to/mcp/ (catalog_search, catalog_get, call).
 * Stuffing all 4,200 schemas into the prompt is not how Treg is meant to be used.
 */

const tregClient = require('./tregClient');
const tregSearchMode = require('./tregSearchMode');

const TOOL_NAMES = ['treg_catalog_search', 'treg_catalog_get', 'treg_call'];
const CALL_CAP_USD = 3;
const TURN_CAP_USD = 8;
const MAX_CALLS = 6;
const RESULT_CHARS = 8000;

function enabled(integrationEnv) {
  return tregSearchMode.isOn(integrationEnv) && tregClient.isConfigured();
}

function enabledForWorkspace(workspaceId, workspace) {
  if (!tregClient.isConfigured()) return false;
  if (workspace && workspace.isDemo) return false;
  return tregSearchMode.getMode(workspaceId) === 'treg';
}

function systemNote() {
  return `
TREG (this workspace is switched to Treg):
Search, this chat, and the floating chatbot can use the Treg catalog, about 4,200 tools, through three tools in order:
1. treg_catalog_search with the job in plain words (not a vendor name).
2. treg_catalog_get on the id you will call, and read its price and parameters.
3. treg_call to run it. Prefer a routed treg.* tool when one matches the job.
CRM questions (folders, leads already saved, pipeline, tasks, scripts) still use the CRM tools.
Live web, maps, social, ads, people, company, SEO, and media questions use Treg.
Say the cost of what you ran. Each call is capped at $${CALL_CAP_USD} and this message at $${TURN_CAP_USD}. Set max_cost_usd to the catalog price. Do not start image, video, or voice generation unless the user asked for that media.`;
}

function openAiFunctionTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'treg_catalog_search',
        description:
          'Search the Treg catalog for tools that do a job. Returns ids and prices. Call this before treg_call when you do not already know the endpoint id.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The job, in plain words. Example: "TikTok videos about roofers".' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'treg_catalog_get',
        description: 'Read one Treg tool: parameters, method, and price. Use the id from treg_catalog_search.',
        parameters: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', description: 'Catalog id, such as treg.web.search' },
          },
          required: ['endpoint'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'treg_call',
        description:
          'Call one Treg catalog tool. Send only the parameters treg_catalog_get listed. max_cost_usd is the most this call may spend (default 1, hard cap 3). A chat message stops at $8.',
        parameters: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            method: { type: 'string', enum: ['GET', 'POST'] },
            query: { type: 'object', description: 'Query parameters. Values are strings or numbers.' },
            body: { type: 'object', description: 'JSON body for POST tools.' },
            max_cost_usd: { type: 'number', description: 'Spend ceiling for this call. Use the catalog price.' },
          },
          required: ['endpoint'],
          additionalProperties: false,
        },
      },
    },
  ];
}

function appendTools(tools, integrationEnv) {
  if (!enabled(integrationEnv)) return tools;
  return tools.concat(openAiFunctionTools());
}

function endpointId(raw) {
  const id = String(raw || '').trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/.test(id) ||
    id.includes('..') ||
    id.includes('//') ||
    id.includes('://')
  ) {
    return '';
  }
  return id;
}

function budget(ctx) {
  if (!ctx || typeof ctx !== 'object') return { spentUsd: 0, calls: 0 };
  if (!ctx.tregTurn) ctx.tregTurn = { spentUsd: 0, calls: 0 };
  return ctx.tregTurn;
}

function clampMaxCost(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(CALL_CAP_USD, Math.round(n * 100) / 100);
}

function scalarQuery(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function jsonBody(raw) {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    const err = new Error('Treg call body must be an object.');
    err.code = 'TREG_BAD_ARGS';
    throw err;
  }
  const text = JSON.stringify(raw);
  if (text.length > 20000) {
    const err = new Error('That Treg request is too large to send from chat.');
    err.code = 'TREG_BAD_ARGS';
    throw err;
  }
  return raw;
}

function present(value) {
  if (value && typeof value === 'object') {
    const copy = Array.isArray(value) ? value.slice(0, 20) : { ...value };
    if (!Array.isArray(copy)) {
      delete copy.raw;
    }
    const text = JSON.stringify(copy);
    if (text.length <= RESULT_CHARS) return copy;
    return { truncated: true, preview: text.slice(0, RESULT_CHARS) };
  }
  return value;
}

function hits(body) {
  const rows = body && Array.isArray(body.results) ? body.results : [];
  return rows.slice(0, 8).map((hit) => ({
    id: hit.id || hit.endpoint_id || '',
    name: String(hit.name || hit.summary || '').slice(0, 160),
    summary: String(hit.summary || hit.description || '').slice(0, 240),
    costUsd: hit.cost && hit.cost.usd != null ? hit.cost.usd : hit.price != null ? hit.price : null,
  })).filter((hit) => hit.id);
}

function assertWorkspace(ctx) {
  const workspaceId = ctx && ctx.workspaceId;
  if (!enabledForWorkspace(workspaceId, ctx && ctx.workspace)) {
    const err = new Error('Treg is off for this workspace. Switch the top bar to Treg first.');
    err.code = 'TREG_OFF';
    throw err;
  }
  return String(workspaceId);
}

async function execute(ctx, toolName, args, opts = {}) {
  const workspaceId = assertWorkspace(ctx);
  const name = String(toolName || '').trim();
  const input = args && typeof args === 'object' ? args : {};
  const fetchImpl = opts.fetchImpl;

  if (name === 'treg_catalog_search') {
    const query = String(input.query || '').trim().slice(0, 200);
    if (!query) {
      const err = new Error('Say what job to search the Treg catalog for.');
      err.code = 'TREG_BAD_ARGS';
      throw err;
    }
    const body = await tregClient.tregGet(
      `/catalog/search?q=${encodeURIComponent(query)}&limit=8`,
      { workspaceId, feature: 'chat-catalog', fetchImpl },
    );
    return {
      query,
      tools: hits(body),
      next: 'Call treg_catalog_get with the id, then treg_call.',
    };
  }

  if (name === 'treg_catalog_get') {
    const id = endpointId(input.endpoint);
    if (!id) {
      const err = new Error('That is not a Treg endpoint id.');
      err.code = 'TREG_BAD_ARGS';
      throw err;
    }
    const body = await tregClient.tregGet(`/catalog/endpoints/${encodeURIComponent(id)}`, {
      workspaceId,
      feature: 'chat-catalog',
      fetchImpl,
    });
    const endpoint = (body && body.endpoint) || body || {};
    return {
      id,
      name: endpoint.name || '',
      summary: String(endpoint.summary || '').slice(0, 400),
      method: endpoint.method || '',
      cost: endpoint.cost || null,
      input: present(endpoint.input || null),
    };
  }

  if (name === 'treg_call') {
    const id = endpointId(input.endpoint);
    if (!id) {
      const err = new Error('That is not a Treg endpoint id.');
      err.code = 'TREG_BAD_ARGS';
      throw err;
    }
    const turn = budget(ctx);
    const maxCost = clampMaxCost(input.max_cost_usd);
    if (turn.calls >= MAX_CALLS) {
      const err = new Error(`This chat message already made ${MAX_CALLS} Treg calls. Ask again to continue.`);
      err.code = 'TREG_TURN_CAP';
      throw err;
    }
    if (turn.spentUsd + maxCost > TURN_CAP_USD + 0.001) {
      const err = new Error(
        `This chat message is near the $${TURN_CAP_USD} Treg cap (spent $${turn.spentUsd.toFixed(2)}). Ask again to continue.`,
      );
      err.code = 'TREG_TURN_CAP';
      throw err;
    }
    const method = String(input.method || (input.body ? 'POST' : 'GET')).toUpperCase() === 'POST' ? 'POST' : 'GET';
    const result = await tregClient.tregCall(id, {
      method,
      query: scalarQuery(input.query),
      body: jsonBody(input.body),
      feature: 'chat',
      workspaceId,
      maxCostUsd: maxCost,
      fetchImpl,
      timeoutMs: 70000,
    });
    const spent = (Number(result.costMicro) || 0) / 1000000;
    turn.calls += 1;
    turn.spentUsd = Math.round((turn.spentUsd + spent) * 1000000) / 1000000;
    return {
      endpoint: id,
      callId: result.callId || '',
      costUsd: Math.round(spent * 10000) / 10000,
      spentThisMessageUsd: Math.round(turn.spentUsd * 10000) / 10000,
      servedBy: result.servedBy || '',
      result: present(result.body),
    };
  }

  const err = new Error(`Unknown Treg tool: ${name}`);
  err.code = 'UNKNOWN_TOOL';
  throw err;
}

module.exports = {
  TOOL_NAMES,
  CALL_CAP_USD,
  TURN_CAP_USD,
  enabled,
  enabledForWorkspace,
  systemNote,
  openAiFunctionTools,
  appendTools,
  execute,
};
