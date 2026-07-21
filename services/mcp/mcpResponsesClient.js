/**
 * OpenAI Responses API + hosted remote MCP tool (CEO Chief of Staff CRM access).
 */
const { CRM_MCP_TOOL_NAMES, isResponsesMcpReady } = require('./mcpConnection');
const mcpLogger = require('./mcpLogger');

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

function defaultResponsesModel() {
  return (
    String(process.env.OPENAI_RESPONSES_MODEL || '').trim() ||
    String(process.env.OPENAI_MODEL || '').trim() ||
    'gpt-4.1'
  );
}

function extractResponsesOutputText(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data && data.output) ? data.output : [];
  const parts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const chunk of item.content) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (chunk.type === 'output_text' && chunk.text) parts.push(String(chunk.text));
        else if (chunk.type === 'text' && chunk.text) parts.push(String(chunk.text));
      }
    }
  }
  const joined = parts.join('\n').trim();
  return joined || null;
}

function extractMcpActivityFromResponse(data) {
  const activity = { toolsListed: [], toolCalls: [] };
  const output = Array.isArray(data && data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'mcp_list_tools' && Array.isArray(item.tools)) {
      activity.toolsListed = item.tools.map((t) => t.name || t).filter(Boolean);
    }
    if (item.type === 'mcp_call') {
      activity.toolCalls.push({
        name: item.name || item.tool_name || 'unknown',
        status: item.status || null,
        output: item.output != null ? String(item.output).slice(0, 500) : null,
      });
    }
  }
  return activity;
}

function buildResponsesInput({ message, history = [] }) {
  const input = [];
  for (const m of history || []) {
    if (!m || !m.content) continue;
    if (m.role === 'user' || m.role === 'assistant') {
      input.push({ role: m.role, content: String(m.content) });
    }
  }
  input.push({ role: 'user', content: String(message || '').trim() });
  return input;
}

/**
 * @param {object} opts
 * @param {string} opts.instructions — system/developer instructions
 * @param {string} opts.message — latest user message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {string} opts.serverUrl — public MCP endpoint (Streamable HTTP)
 * @param {string} opts.bearerToken — MCP access token for Authorization header
 * @param {string} [opts.model]
 * @param {string} [opts.workspaceId]
 * @param {string} [opts.userEmail]
 * @returns {Promise<{ content: string|null, provider: string, error?: boolean, detail?: string, toolActivity?: object }>}
 */
async function chiefOfStaffResponsesWithMcp({
  instructions,
  message,
  history = [],
  serverUrl,
  bearerToken,
  model,
  workspaceId,
  userEmail,
}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const resolvedModel = model || defaultResponsesModel();

  if (!isResponsesMcpReady({ serverUrl, bearerToken, openaiApiKey: apiKey })) {
    return {
      content: null,
      provider: 'openai-responses-mcp',
      error: true,
      detail: 'Responses MCP not configured (OPENAI_API_KEY, BASE_URL, bearer token required).',
    };
  }

  mcpLogger.connectionStatus({
    layer: 'responses_api',
    serverUrl,
    workspaceId,
    userEmail,
    tools: CRM_MCP_TOOL_NAMES,
  });

  const body = {
    model: resolvedModel,
    instructions: String(instructions || '').trim(),
    input: buildResponsesInput({ message, history }),
    tools: [
      {
        type: 'mcp',
        server_label: 'adhello_ceo_crm',
        server_description:
          'AdHello CEO Command Center CRM — list folders, query leads, search, and update enrichment fields.',
        server_url: serverUrl,
        authorization: bearerToken,
        require_approval: 'never',
        allowed_tools: CRM_MCP_TOOL_NAMES,
      },
    ],
  };

  try {
    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (data && data.error && data.error.message) ||
        (data && data.message) ||
        `OpenAI Responses API HTTP ${res.status}`;
      mcpLogger.transportError({ layer: 'responses_api', error: msg, status: res.status });
      return { content: null, provider: 'openai-responses-mcp', error: true, detail: msg };
    }

    const toolActivity = extractMcpActivityFromResponse(data);
    if (toolActivity.toolsListed.length) {
      mcpLogger.toolsDiscovered({ source: 'responses_api', tools: toolActivity.toolsListed });
    }
    for (const call of toolActivity.toolCalls) {
      mcpLogger.toolInvoke({ source: 'responses_api', tool: call.name, status: call.status });
      if (call.output) {
        mcpLogger.toolResponse({ source: 'responses_api', tool: call.name, summary: call.output.slice(0, 200) });
      }
    }

    const content = extractResponsesOutputText(data);
    if (!content) {
      return {
        content: null,
        provider: 'openai-responses-mcp',
        error: true,
        detail: 'Empty response from OpenAI Responses API.',
        toolActivity,
      };
    }

    return {
      content,
      provider: 'openai-responses-mcp',
      error: false,
      model: resolvedModel,
      toolActivity,
    };
  } catch (err) {
    mcpLogger.transportError({ layer: 'responses_api', error: err.message });
    return {
      content: null,
      provider: 'openai-responses-mcp',
      error: true,
      detail: err.message || 'Request failed',
    };
  }
}

module.exports = {
  chiefOfStaffResponsesWithMcp,
  extractResponsesOutputText,
  extractMcpActivityFromResponse,
  defaultResponsesModel,
};
