/**
 * In-process OpenAI-compatible function-calling for CRM tools.
 *
 * Runs the agent loop (model → tool calls → results → model …) until a final answer,
 * trying each tool-capable model in resolvePavlexToolLlmChain() until one succeeds.
 */
const { executeCrmTool, getOpenAiFunctionTools } = require('./mcpToolExecutor');
const { resolvePavlexToolLlmChain } = require('../pavlex/pavlexLlmConfig');
const {
  stripThinking,
  looksLikeLeakedReasoning,
  extractTextToolCalls,
  sanitizeAssistantText,
  sanitizeHistory,
  parseToolArgumentList,
} = require('../pavlex/pavlexReplyParse');
const { extractOpenRouterApiError } = require('../llmClient');
const mcpLogger = require('./mcpLogger');

const MAX_TOOL_ROUNDS = 8;
const MAX_NUDGES = 2;
const MAX_TOOL_RESULT_CHARS = 16000;
const LLM_TIMEOUT_MS = Number(process.env.PAVLEX_LLM_TIMEOUT_MS) || 40000;

const NUDGE_FINAL =
  'Reply to me directly now. Either call the tool you need (as a real tool call) or give the final answer. ' +
  'Do not describe your reasoning or print tool-call markup.';
const NUDGE_TOOLS =
  'Use the CRM tools to actually do this (call them now), then tell me the result. Do not guess CRM data.';

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : '')).join('');
  }
  return '';
}

function timeoutSignal() {
  if (typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return undefined;
  return AbortSignal.timeout(LLM_TIMEOUT_MS);
}

async function callChatCompletions(llm, body) {
  try {
    const res = await fetch(llm.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
        ...(llm.extraHeaders || {}),
      },
      body: JSON.stringify({ ...body, model: llm.model, stream: false }),
      signal: timeoutSignal(),
    });
    const data = await res.json().catch(() => ({}));
    const choiceError = data && data.choices && data.choices[0] && data.choices[0].error;
    if (!res.ok || (data && data.error) || choiceError) {
      const detail = extractOpenRouterApiError(choiceError ? { error: choiceError } : data, res.status);
      mcpLogger.transportError({
        layer: `inline_${llm.provider}`,
        model: llm.model,
        status: res.status,
        toolChoice: body.tool_choice,
        error: detail,
      });
      return { ok: false, status: res.status, detail };
    }
    return { ok: true, data };
  } catch (err) {
    const detail = err && err.name === 'TimeoutError' ? `timed out after ${LLM_TIMEOUT_MS}ms` : (err && err.message) || 'request failed';
    mcpLogger.transportError({ layer: `inline_${llm.provider}`, model: llm.model, error: detail });
    return { ok: false, status: 0, detail };
  }
}

function serializeToolResult(result) {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
}

/**
 * One model's agent loop over the shared `messages` array.
 * @returns {Promise<{ content?: string, detail?: string }>}
 */
async function runToolLoop({ llm, messages, tools, toolNames, ctx, requireTools, state }) {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const wantRequired = requireTools && state.toolsUsed.length === 0 && !state.requiredUnsupported && !state.toolNudged;
    const body = { messages, tools, tool_choice: wantRequired ? 'required' : 'auto', temperature: 0.4, max_tokens: 1200 };
    let res = await callChatCompletions(llm, body);
    if (!res.ok && wantRequired && res.status !== 401 && res.status !== 402) {
      // Many providers reject tool_choice "required"; retry once with "auto".
      state.requiredUnsupported = true;
      res = await callChatCompletions(llm, { ...body, tool_choice: 'auto' });
    }
    if (!res.ok) return { detail: res.detail, status: res.status };

    const msg = res.data.choices && res.data.choices[0] && res.data.choices[0].message;
    if (!msg) return { detail: 'Empty response from the AI model.' };

    let content = stripThinking(contentText(msg.content));
    let toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
      .filter((c) => c && c.function && c.function.name)
      .flatMap((c, i) => {
        const id = c.id || `call_${state.callSeq}_${i}`;
        const argList = parseToolArgumentList(c.function.arguments);
        return argList.map((args, j) => ({
          id: argList.length > 1 ? `${id}_${j}` : id,
          type: 'function',
          function: { name: String(c.function.name), arguments: JSON.stringify(args) },
        }));
      });

    if (!toolCalls.length) {
      const reasoning = stripThinking(contentText(msg.reasoning || msg.reasoning_content));
      let parsed = extractTextToolCalls(content || reasoning, toolNames);
      if (!parsed.calls.length && content && reasoning) {
        const fromReasoning = extractTextToolCalls(reasoning, toolNames);
        if (fromReasoning.calls.length) parsed = { calls: fromReasoning.calls, cleaned: parsed.cleaned };
      }
      if (parsed.calls.length) {
        mcpLogger.chatRuntime({
          phase: 'text_tool_calls',
          model: llm.model,
          tools: parsed.calls.map((c) => c.name),
        });
        toolCalls = parsed.calls.map((c, i) => ({
          id: `call_txt_${state.callSeq}_${i}`,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
        }));
        content = content ? parsed.cleaned : '';
      }
    }

    if (toolCalls.length) {
      state.callSeq += 1;
      messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const toolName = call.function.name;
        const args = parseToolArguments(call.function.arguments);
        state.toolsUsed.push(toolName);
        const result = toolNames.has(toolName)
          ? await executeCrmTool(ctx, toolName, args)
          : { success: false, error: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' };
        messages.push({ role: 'tool', tool_call_id: call.id, content: serializeToolResult(result) });
      }
      continue;
    }

    const text = sanitizeAssistantText(content, toolNames);
    if (!text || looksLikeLeakedReasoning(text)) {
      if (state.nudges < MAX_NUDGES) {
        state.nudges += 1;
        messages.push({ role: 'user', content: NUDGE_FINAL });
        continue;
      }
      return { detail: text ? 'The AI model replied with its reasoning instead of an answer.' : 'The AI model returned no text.' };
    }

    if (requireTools && state.toolsUsed.length === 0 && !state.toolNudged && state.nudges < MAX_NUDGES) {
      state.toolNudged = true;
      state.nudges += 1;
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: NUDGE_TOOLS });
      continue;
    }

    return { content: text };
  }
  return { detail: 'Exceeded maximum CRM tool rounds.' };
}

/**
 * @param {object} opts
 * @param {string} opts.instructions
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {{ workspaceId: string, userEmail?: string }} opts.ctx
 * @param {boolean} [opts.requireTools]
 */
async function inlineCrmToolChat({ instructions, message, history = [], ctx, requireTools = false }) {
  const chain = resolvePavlexToolLlmChain();
  if (!chain.length) {
    return {
      content: null,
      provider: 'inline-tools',
      error: true,
      detail: 'No LLM configured (set OPENAI_API_KEY or OPENROUTER_API_KEY).',
    };
  }

  const tools = getOpenAiFunctionTools();
  const toolNames = new Set(tools.map((t) => t.function.name));

  mcpLogger.toolsDiscovered({
    workspaceId: ctx.workspaceId,
    tools: [...toolNames],
    source: `inline_${chain[0].provider}`,
    models: chain.map((c) => c.model),
  });

  const messages = [{ role: 'system', content: String(instructions || '').trim() }];
  messages.push(...sanitizeHistory(history, toolNames));
  messages.push({ role: 'user', content: String(message || '').trim() });

  const state = { toolsUsed: [], nudges: 0, callSeq: 0, toolNudged: false, requiredUnsupported: false };
  const failures = [];
  const rejectedKeys = new Set();
  let lastStatus = 0;

  for (const llm of chain) {
    if (rejectedKeys.has(llm.provider)) continue;
    state.nudges = 0;
    state.requiredUnsupported = false;
    // eslint-disable-next-line no-await-in-loop
    const out = await runToolLoop({ llm, messages, tools, toolNames, ctx, requireTools, state });
    if (out.content) {
      return {
        content: out.content,
        provider: `inline-${llm.provider}`,
        error: false,
        model: llm.model,
        toolsUsed: state.toolsUsed,
        fallbacks: failures,
      };
    }
    lastStatus = out.status || lastStatus;
    failures.push(`${llm.provider} ${llm.model}: ${out.detail || 'failed'}`);
    mcpLogger.chatRuntime({ phase: 'inline_model_failed', model: llm.model, detail: out.detail });
    if (out.status === 401) rejectedKeys.add(llm.provider);
  }

  return {
    content: null,
    provider: `inline-${chain[0].provider}`,
    error: true,
    status: lastStatus,
    detail: failures.join('; '),
    toolsUsed: state.toolsUsed,
  };
}

module.exports = {
  inlineCrmToolChat,
};
