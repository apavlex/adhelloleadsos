/**
 * In-process OpenAI-compatible function-calling for CRM tools.
 */
const { executeCrmTool, getOpenAiFunctionTools } = require('./mcpToolExecutor');
const { resolvePavlexToolLlm } = require('../pavlex/pavlexLlmConfig');
const mcpLogger = require('./mcpLogger');
const { defaultResponsesModel } = require('./mcpResponsesClient');

const MAX_TOOL_ROUNDS = 6;

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
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
  const llm = resolvePavlexToolLlm();
  if (!llm) {
    return {
      content: null,
      provider: 'inline-tools',
      error: true,
      detail: 'No LLM configured (set OPENAI_API_KEY or OPENROUTER_API_KEY).',
    };
  }

  const model = llm.model || defaultResponsesModel();
  const tools = getOpenAiFunctionTools();
  const toolsUsed = [];

  mcpLogger.toolsDiscovered({
    workspaceId: ctx.workspaceId,
    tools: tools.map((t) => t.function.name),
    source: `inline_${llm.provider}`,
  });

  const messages = [{ role: 'system', content: String(instructions || '').trim() }];
  for (const m of history || []) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      messages.push({ role: m.role, content: String(m.content) });
    }
  }
  messages.push({ role: 'user', content: String(message || '').trim() });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const toolChoice =
        requireTools && toolsUsed.length === 0 && round === 0 ? 'required' : 'auto';

      const res = await fetch(llm.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llm.apiKey}`,
          ...(llm.extraHeaders || {}),
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: toolChoice,
          temperature: 0.4,
          max_tokens: 1200,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data && data.error && data.error.message) ||
          `LLM chat HTTP ${res.status}`;
        mcpLogger.transportError({ layer: `inline_${llm.provider}`, error: msg });
        return { content: null, provider: `inline-${llm.provider}`, error: true, detail: msg };
      }

      const choice = data.choices && data.choices[0];
      const assistantMsg = choice && choice.message;
      if (!assistantMsg) {
        return {
          content: null,
          provider: `inline-${llm.provider}`,
          error: true,
          detail: 'Empty inline tool response.',
        };
      }

      messages.push(assistantMsg);

      const toolCalls = Array.isArray(assistantMsg.tool_calls) ? assistantMsg.tool_calls : [];
      if (!toolCalls.length) {
        const text = String(assistantMsg.content || '').trim();
        if (requireTools && toolsUsed.length === 0) {
          return {
            content: null,
            provider: `inline-${llm.provider}`,
            error: true,
            detail: 'Model answered without calling CRM tools.',
            toolsUsed,
          };
        }
        if (!text) {
          return {
            content: null,
            provider: `inline-${llm.provider}`,
            error: true,
            detail: 'Model returned no text.',
          };
        }
        return {
          content: text,
          provider: `inline-${llm.provider}`,
          error: false,
          model,
          toolRounds: round,
          toolsUsed,
        };
      }

      for (const call of toolCalls) {
        const fn = call.function || {};
        const toolName = fn.name;
        const args = parseToolArguments(fn.arguments);
        toolsUsed.push(toolName);
        const result = await executeCrmTool(ctx, toolName, args);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      content: null,
      provider: `inline-${llm.provider}`,
      error: true,
      detail: 'Exceeded maximum CRM tool rounds.',
      toolsUsed,
    };
  } catch (err) {
    mcpLogger.transportError({ layer: 'inline_tools', error: err.message });
    return {
      content: null,
      provider: 'inline-tools',
      error: true,
      detail: err.message || 'Inline tool chat failed',
      toolsUsed,
    };
  }
}

module.exports = {
  inlineCrmToolChat,
};
